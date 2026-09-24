// src/components/MapView.jsx
import React, { useEffect, useRef, useState } from 'react';

const MapIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
    <line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>
  </svg>
);

/**
 * mapData: Array<{ x: number, y: number, type: 'clear'|'obstacle'|'unknown' }>
 * vehiclePos: { x: number, y: number, angle: number }
 * path: Array<{ x: number, y: number }>
 */
const METERS_PER_CELL = 0.1;

export default function MapView({
  mapData = [],
  vehiclePos,
  path,
  mapObjects = [],
  mapSummary = {},
  savedMaps = [],
  streamUrl = '',
  isConnected = false,
  onLoadMap,
  onDeleteMap,
}) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const viewRef = useRef(null);
  const localVideoRef = useRef(null);
  const localMode = streamUrl === '__localcam__';
  const [localReady, setLocalReady] = useState(false);
  const [zoomFactor, setZoomFactor] = useState(1);
  const safeVehiclePos = vehiclePos && typeof vehiclePos === 'object'
    ? { x: Number(vehiclePos.x ?? 0), y: Number(vehiclePos.y ?? 0), angle: Number(vehiclePos.angle ?? 0) }
    : { x: 0, y: 0, angle: 0 };
  const safePath = Array.isArray(path) && path.length ? path : [{ x: 0, y: 0 }];

  useEffect(() => {
    let media = null;

    const startLocalCamera = async () => {
      if (!isConnected || !localMode || !navigator.mediaDevices?.getUserMedia) {
        setLocalReady(false);
        return;
      }

      try {
        media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = media;
          await localVideoRef.current.play();
          setLocalReady(true);
        }
      } catch (error) {
        console.error('Local camera permission failed:', error);
        setLocalReady(false);
      }
    };

    startLocalCamera();

    return () => {
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (media) media.getTracks().forEach(track => track.stop());
      setLocalReady(false);
    };
  }, [isConnected, localMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = rect.width;
    const H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cellSize = 18;
    const points = [
      ...mapData.map(cell => ({ x: Number(cell.x) || 0, y: Number(cell.y) || 0 })),
      ...safePath.map(point => ({ x: Number(point.x || 0) / METERS_PER_CELL, y: Number(point.y || 0) / METERS_PER_CELL })),
      ...mapObjects.map(object => ({ x: Number(object.x) || 0, y: Number(object.y) || 0 })),
    ];
    const bounds = points.reduce((result, point) => ({
      minX: Math.min(result.minX, point.x), maxX: Math.max(result.maxX, point.x),
      minY: Math.min(result.minY, point.y), maxY: Math.max(result.maxY, point.y),
    }), { minX: 0, maxX: 0, minY: 0, maxY: 0 });
    const spanX = Math.max(8, bounds.maxX - bounds.minX + 8);
    const spanY = Math.max(8, bounds.maxY - bounds.minY + 8);
    const fittedZoom = Math.max(5, Math.min(W / spanX, H / spanY, cellSize));
    const targetZoom = fittedZoom * zoomFactor;
    const targetView = {
      zoom: targetZoom,
      originX: W / 2 - ((bounds.minX + bounds.maxX) / 2) * targetZoom,
      originY: H / 2 + ((bounds.minY + bounds.maxY) / 2) * targetZoom,
    };
    const currentView = viewRef.current || targetView;
    if (!viewRef.current) viewRef.current = { ...targetView };

    const draw = (view, progress) => {
      const zoom = view.zoom;
      const toCanvas = (gx, gy) => ({ cx: view.originX + gx * zoom, cy: view.originY - gy * zoom });
      const metersToCanvas = (xMeters, yMeters) => toCanvas(xMeters / METERS_PER_CELL, yMeters / METERS_PER_CELL);
      ctx.clearRect(0, 0, W, H);

      // Soft map surface and cartographic grid.
      ctx.fillStyle = '#f8fbf9';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(42, 111, 151, 0.09)';
      ctx.lineWidth = 1;
      const gridStep = Math.max(24, zoom * 2);
      for (let x = view.originX % gridStep; x < W; x += gridStep) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = view.originY % gridStep; y < H; y += gridStep) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // De-duplicate cells so repeated observations never stack into darker tiles.
      const uniqueCells = new Map(mapData.map(cell => [`${cell.x}:${cell.y}`, cell]));
      uniqueCells.forEach(({ x, y, type }) => {
        const { cx, cy } = toCanvas(Number(x) || 0, Number(y) || 0);
        const colors = type === 'clear'
          ? ['rgba(0, 168, 75, 0.22)', 'rgba(0, 128, 58, 0.38)']
          : type === 'obstacle'
            ? ['rgba(229, 57, 53, 0.28)', 'rgba(190, 35, 35, 0.48)']
            : ['rgba(245, 124, 0, 0.14)', 'rgba(190, 100, 0, 0.28)'];
        const tile = Math.max(4, zoom - 2);
        ctx.fillStyle = colors[0];
        ctx.strokeStyle = colors[1];
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(cx - tile / 2, cy - tile / 2, tile, tile, Math.min(3, tile / 4));
        ctx.fill(); ctx.stroke();
      });

      // Draw a smooth route with a subtle halo, like a navigation track.
      if (safePath.length > 1) {
        const visiblePath = safePath.slice(0, Math.max(2, Math.ceil(safePath.length * progress)));
        const start = metersToCanvas(visiblePath[0].x, visiblePath[0].y);
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0, 120, 190, 0.18)';
        ctx.lineWidth = Math.max(7, zoom * 0.5);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(start.cx, start.cy);
        visiblePath.slice(1).forEach(point => { const p = metersToCanvas(point.x, point.y); ctx.lineTo(p.cx, p.cy); });
        ctx.stroke();
      }
      const visiblePath = safePath.length > 1
        ? safePath.slice(0, Math.max(2, Math.ceil(safePath.length * progress)))
        : safePath;
      ctx.beginPath();
      ctx.strokeStyle = '#1677b8';
      ctx.lineWidth = Math.max(2, zoom * 0.18);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const start = metersToCanvas(visiblePath[0].x, visiblePath[0].y);
      ctx.moveTo(start.cx, start.cy);
      visiblePath.slice(1).forEach(point => { const p = metersToCanvas(point.x, point.y); ctx.lineTo(p.cx, p.cy); });
      ctx.stroke();

      // Keep labels readable by showing one marker per nearby object label.
      const drawnLabels = new Set();
      mapObjects.forEach(object => {
        const { cx, cy } = toCanvas(object.x, object.y);
        const lateralOffset = object.position === 'left' ? -zoom * 1.2 : object.position === 'right' ? zoom * 1.2 : 0;
        const markerX = cx + lateralOffset;
        const labelKey = `${object.label}:${Math.round(markerX / 18)}:${Math.round(cy / 18)}`;
        const radius = Math.max(7, Math.min(11, zoom * 0.38));
        ctx.fillStyle = object.obstacle ? '#dc3d3d' : '#1268a0';
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(markerX, cy, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        const label = String(object.label || '').toLowerCase();
        ctx.save();
        ctx.translate(markerX, cy);
        ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5;
        if (label.includes('tree') || label.includes('plant') || label.includes('bush')) {
          ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(-5, 4); ctx.lineTo(5, 4); ctx.closePath(); ctx.fill();
          ctx.fillRect(-1, 3, 2, 4);
        } else if (label.includes('rock') || label.includes('boulder')) {
          ctx.beginPath(); ctx.moveTo(-6, 3); ctx.lineTo(-3, -4); ctx.lineTo(3, -5); ctx.lineTo(6, 3); ctx.closePath(); ctx.fill();
        } else if (label.includes('person') || label.includes('human')) {
          ctx.beginPath(); ctx.arc(0, -4, 2, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(0, 5); ctx.moveTo(-4, 1); ctx.lineTo(4, 1); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.roundRect(-6, -3, 12, 7, 2); ctx.fill();
          ctx.fillStyle = object.obstacle ? '#dc3d3d' : '#1268a0';
          ctx.beginPath(); ctx.arc(-3, 5, 2, 0, Math.PI * 2); ctx.arc(3, 5, 2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        if (!drawnLabels.has(labelKey) && zoom > 7) {
          drawnLabels.add(labelKey);
          ctx.font = '600 10px sans-serif'; ctx.fillStyle = '#16324f';
          ctx.fillText(`${object.label} · ${Number(object.distanceM || 0).toFixed(1)}m`, markerX + radius + 4, cy - 4);
        }
      });

      // Draw vehicle marker on top of every layer.
      const { cx: vx, cy: vy } = metersToCanvas(safeVehiclePos.x, safeVehiclePos.y);
      const angle = (safeVehiclePos.angle * Math.PI) / 180;
      ctx.save(); ctx.translate(vx, vy); ctx.rotate(-angle);
      ctx.fillStyle = '#00a84b'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(0, 120, 75, 0.35)'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.roundRect(-8, -6, 16, 12, 4); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(4, -4); ctx.lineTo(4, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    };

    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    const started = performance.now();
    const fromView = { ...currentView };
    const duration = 650;
    const animate = now => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - ((1 - progress) ** 3);
      const view = {
        zoom: fromView.zoom + (targetView.zoom - fromView.zoom) * eased,
        originX: fromView.originX + (targetView.originX - fromView.originX) * eased,
        originY: fromView.originY + (targetView.originY - fromView.originY) * eased,
      };
      viewRef.current = view;
      draw(view, eased);
      if (progress < 1) animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [mapData, mapObjects, mapSummary, safeVehiclePos, safePath, zoomFactor]);

  const adjustZoom = (amount) => {
    setZoomFactor(current => Math.max(0.6, Math.min(4, Number((current + amount).toFixed(1)))));
  };

  return (
    <div className="card glass" style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div className="card-header">
        <div className="card-title"><MapIcon /> Terrain Map</div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          {mapData.length} cells
        </span>
      </div>
      <div className="map-outer" style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          className="map-canvas"
          id="terrain-canvas"
          onWheel={(event) => {
            event.preventDefault();
            setZoomFactor(current => Math.max(0.6, Math.min(4, Number((current + (event.deltaY < 0 ? 0.2 : -0.2)).toFixed(1)))));
          }}
        />
        <div className="map-zoom-controls" aria-label="Map zoom controls">
          <button type="button" title="Zoom in" onClick={() => adjustZoom(0.4)}>+</button>
          <button type="button" title="Zoom out" onClick={() => adjustZoom(-0.4)}>−</button>
          <button type="button" title="Fit map" onClick={() => setZoomFactor(1)}>⌂</button>
        </div>

        {(isConnected && streamUrl) && (
          <div style={{
            position: 'absolute',
            top: '12px',
            left: '12px',
            width: '180px',
            height: '120px',
            borderRadius: '12px',
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(8, 15, 27, 0.75)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            zIndex: 2,
          }}>
            {localMode ? (
              <>
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: localReady ? 'block' : 'none' }}
                />
                {!localReady && (
                  <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#cbd5e1', fontSize: '0.72rem' }}>
                    Camera starting…
                  </div>
                )}
              </>
            ) : (
              <img
                src={streamUrl}
                alt="Camera feed"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.parentElement.style.background = 'rgba(15, 23, 42, 0.75)';
                  e.target.parentElement.innerHTML = '<div style="display:grid;place-items:center;width:100%;height:100%;color:#cbd5e1;font-size:0.72rem;">Camera unavailable</div>';
                }}
              />
            )}
          </div>
        )}

        <div className="map-legend">
          <div className="map-legend-item"><div className="map-legend-dot" style={{ background: 'rgba(0,168,75,0.7)' }}/> Clear</div>
          <div className="map-legend-item"><div className="map-legend-dot" style={{ background: 'rgba(229,57,53,0.7)' }}/> Obstacle</div>
          <div className="map-legend-item"><div className="map-legend-dot" style={{ background: 'rgba(245,124,0,0.7)' }}/> Unknown</div>
          <div className="map-legend-item"><div className="map-legend-dot" style={{ background: '#1565c0' }}/> Object</div>
        </div>
        <div className="map-vehicle-label">
          X:{Number(safeVehiclePos.x ?? 0).toFixed(1)} Y:{Number(safeVehiclePos.y ?? 0).toFixed(1)} θ:{Number(safeVehiclePos.angle ?? 0).toFixed(0)}°
        </div>
        <div className="map-condition-card">
          <div className="map-condition-kicker">Vehicle Assessment</div>
          <div className="map-condition-title">{mapSummary.terrain || 'unknown'} · {mapSummary.action || 'stop'}</div>
          <div className="map-condition-summary">{mapSummary.summary || 'Waiting for terrain analysis.'}</div>
          <div className="map-condition-meta">{mapSummary.obstacles || 0} obstacles · {Math.round((mapSummary.confidence || 0) * 100)}% confidence</div>
        </div>
      </div>
      {/* Saved maps list */}
      {savedMaps.length > 0 && (
        <div style={{ maxHeight: '90px', overflowY: 'auto' }}>
          <div className="map-list">
            {savedMaps.map((m, i) => (
              <div key={m.id ?? i} className="map-entry" onClick={() => onLoadMap && onLoadMap(m)}>
                <div>
                  <div className="map-entry-name">{m.name}</div>
                  <div className="map-entry-meta">{m.cells} cells · {m.date}</div>
                </div>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <span className="map-entry-badge">Load</span>
                  <button
                    type="button"
                    className="map-entry-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteMap && onDeleteMap(m);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
