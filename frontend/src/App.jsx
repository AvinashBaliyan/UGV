// src/App.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import './index.css';

import Header from './components/Header';
import VideoFeed from './components/VideoFeed';
import AILog from './components/AILog';
import MapView from './components/MapView';
import Controls from './components/Controls';
import TerrainStats from './components/TerrainStats';
import ConnectionPanel from './components/ConnectionPanel';
import IntroScreen from './components/IntroScreen';

const BACKEND = 'ws://localhost:8000/ws';
const BACKEND_HTTP = 'http://localhost:8000';
const MAP_CELL_AREA_M2 = 0.01;

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function App() {
  const [showIntro, setShowIntro] = useState(true);
  // ─── Connection state ───
  const ws = useRef(null);
  const intentionalClose = useRef(false);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [streamUrl, setStreamUrl] = useState('');
  const [geminiKey, setGeminiKey] = useState('');

  // ─── Feature toggles ───
  const [aiActive, setAiActive] = useState(false);
  const [mapActive, setMapActive] = useState(false);

  // ─── Vehicle state ───
  const [speed, setSpeed] = useState(180);
  const [vehiclePos, setVehiclePos] = useState({ x: 0, y: 0, angle: 0 });
  const [path, setPath] = useState([{ x: 0, y: 0 }]);
  const [mapObjects, setMapObjects] = useState([]);
  const [mapSummary, setMapSummary] = useState({ terrain: 'unknown', summary: 'Waiting for terrain analysis.', action: 'stop', confidence: 0, obstacles: 0 });
  const [mapData, setMapData] = useState([]);
  const [savedMaps, setSavedMaps] = useState([]);

  // ─── AI / Stats ───
  const [logs, setLogs] = useState([
    { time: ts(), type: 'sys', text: 'TRINETRA initialized.' },
    { time: ts(), type: 'sys', text: 'Connect to ESP32 and enter Gemini API key to begin.' },
  ]);
  const [analysis, setAnalysis] = useState({
    terrain: null, confidence: 0, obstacles: 0,
    covered_m2: 0, map_cells: 0, ai_scans: 0,
    terrainBreakdown: { clear: 0, obstacle: 0, grass: 0, rock: 0, unknown: 100 },
  });
  const [latestFrame, setLatestFrame] = useState(null);
  const [videoJob, setVideoJob] = useState(null);

  const addLog = useCallback((type, text) => {
    setLogs(prev => [...prev.slice(-199), { time: ts(), type, text }]);
  }, []);

  const loadSavedMaps = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_HTTP}/maps`);
      if (!res.ok) return;
      const items = await res.json();
      setSavedMaps(
        (items || []).map(m => ({
          id: m.id,
          name: m.name,
          cells: m.cell_count,
          sourceType: m.source_type,
          date: m.created_at ? new Date(m.created_at).toLocaleDateString() : '-',
        }))
      );
    } catch {
      // Ignore fetch errors when backend is unavailable.
    }
  }, []);

  // ─── WebSocket connect to backend ───
  const connectBackend = useCallback((espUrl) => {
    if (ws.current?.readyState === WebSocket.OPEN) return;
    intentionalClose.current = false;
    setWsStatus('connecting');
    addLog('sys', `Connecting to backend (ESP32: ${espUrl})…`);

    const sock = new WebSocket(`${BACKEND}?esp=${encodeURIComponent(espUrl)}`);
    ws.current = sock;

    sock.onopen = () => {
      setWsStatus('connected');
      addLog('sys', 'Connected to backend successfully.');
      loadSavedMaps();
    };

    sock.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        handleServerMessage(msg);
      } catch { /* ignore non-JSON */ }
    };

    sock.onclose = (event) => {
      setWsStatus('disconnected');
      if (intentionalClose.current) {
        addLog('sys', 'Connection closed.');
      } else {
        const detail = event.reason ? ` (${event.reason})` : ` (code ${event.code})`;
        addLog('warn', `WebSocket connection closed${detail}.`);
      }
    };

    sock.onerror = () => {
      setWsStatus('disconnected');
      if (!intentionalClose.current) addLog('warn', 'WebSocket error — check the selected vehicle connection.');
    };
  }, [addLog, loadSavedMaps]);

  useEffect(() => {
    if (wsStatus !== 'connected' || !geminiKey.trim()) return undefined;

    const timer = window.setTimeout(() => {
      const enabled = true;
      ws.current?.send(JSON.stringify({ type: 'ai_toggle', enabled, key: geminiKey.trim() }));
      setAiActive(true);
      addLog('sys', 'Gemini AI enabled for live feed analysis.');
    }, 500);

    return () => window.clearTimeout(timer);
  }, [geminiKey, wsStatus, addLog]);

  const disconnectBackend = useCallback(() => {
    intentionalClose.current = true;
    ws.current?.close();
    ws.current = null;
    setWsStatus('disconnected');
    addLog('sys', 'Disconnected from backend.');
  }, [addLog]);

  const handleServerMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'ai_analysis':
        setLatestFrame({
          terrain: msg.terrain || 'unknown',
          confidence: msg.confidence || 0,
          summary: msg.summary || 'No scene description returned.',
          obstacleCount: msg.obstacle_count || 0,
          objects: Array.isArray(msg.objects) ? msg.objects : [],
          recommendedAction: msg.recommended_action || 'stop',
        });
        const objects = Array.isArray(msg.objects)
          ? msg.objects.map(object => object.label || object.name).filter(Boolean).join(', ')
          : '';
        addLog('ai', `[${msg.terrain || 'N/A'}] ${msg.summary || 'Live scene analyzed.'}${objects ? ` Objects: ${objects}` : ''}`);
        setAnalysis(prev => ({
          ...prev,
          terrain: msg.terrain,
          confidence: msg.confidence || 0,
          obstacles: msg.obstacle_count || prev.obstacles,
          ai_scans: prev.ai_scans + 1,
          terrainBreakdown: msg.breakdown || prev.terrainBreakdown,
        }));
        if (msg.has_obstacle) addLog('warn', '⚠ Obstacle detected in path!');
        setMapSummary({
          terrain: msg.terrain || 'unknown',
          summary: msg.summary || 'No condition summary available.',
          action: msg.recommended_action || 'stop',
          confidence: msg.confidence || 0,
          obstacles: msg.obstacle_count || 0,
        });
        break;

      case 'ai_error':
        setAiActive(false);
        addLog('warn', msg.message || 'Gemini could not analyze the live feed.');
        break;

      case 'map_update':
        setMapData(msg.cells || []);
        setVehiclePos(msg.vehicle || { x: 0, y: 0, angle: 0 });
        setPath(msg.path || []);
        setAnalysis(prev => ({
          ...prev,
          map_cells: msg.cells?.length || prev.map_cells,
          covered_m2: ((msg.cells?.length || 0) * MAP_CELL_AREA_M2),
        }));
        break;

      case 'map_saved':
        addLog('sys', `Map saved to database: "${msg.name}"`);
        loadSavedMaps();
        break;

      case 'status':
        if (/^(Failed to connect|Connection failed|No RTSP|RTSP)/i.test(msg.message || '')) {
          setWsStatus('disconnected');
        }
        addLog('sys', msg.message);
        break;

      default:
        break;
    }
  }, [addLog, loadSavedMaps]);

  const loadMapById = useCallback(async (mapMeta) => {
    if (!mapMeta?.id) {
      addLog('warn', 'Invalid saved map entry selected.');
      return;
    }
    try {
      const res = await fetch(`${BACKEND_HTTP}/maps/${mapMeta.id}`);
      if (res.status === 404) {
        addLog('warn', `Map "${mapMeta.name}" was not found on server.`);
        loadSavedMaps();
        return;
      }
      if (!res.ok) {
        addLog('warn', 'Failed to load saved map.');
        return;
      }
      const data = await res.json();
      setMapData(data.cells || []);
      setVehiclePos(data.vehicle || { x: 0, y: 0, angle: 0 });
      const detections = data.metadata?.detections || [];
      const savedPath = data.metadata?.path?.length
        ? data.metadata.path
        : detections.length > 1
          ? detections.map((_, index) => ({
            x: Number(data.vehicle?.x || 0) * (index / (detections.length - 1)),
            y: Number(data.vehicle?.y || 0) * (index / (detections.length - 1)),
          }))
          : [];
      setPath(savedPath);
      setMapObjects(detections.flatMap((detection, index) => {
        const point = savedPath[index] || savedPath[savedPath.length - 1] || { x: 0, y: 0 };
        return (detection.objects || []).map(object => ({
          x: Number(point.x || 0) / 0.1,
          y: Number(point.y || 0) / 0.1,
          label: object.label || 'object',
          position: object.position || 'center',
          obstacle: Boolean(detection.has_obstacle),
          time: detection.time_seconds,
          distanceM: Math.hypot(Number(point.x || 0), Number(point.y || 0)),
        }));
      }));
      const lastDetection = detections[detections.length - 1];
      if (lastDetection) setMapSummary({
        terrain: lastDetection.terrain || 'unknown',
        summary: lastDetection.summary || 'No condition summary available.',
        action: lastDetection.recommended_action || 'stop',
        confidence: 0,
        obstacles: lastDetection.obstacle_count || 0,
      });
      setAnalysis(prev => ({
        ...prev,
        map_cells: data.cell_count || (data.cells?.length || 0),
        covered_m2: (data.cell_count || (data.cells?.length || 0)) * MAP_CELL_AREA_M2,
      }));
      addLog('sys', `Loaded map "${data.name}" (${data.cell_count || data.cells?.length || 0} cells).`);
    } catch {
      addLog('warn', 'Error while loading saved map.');
    }
  }, [addLog, loadSavedMaps]);

  const deleteMapById = useCallback(async (mapMeta) => {
    if (!mapMeta?.id) return;
    try {
      const res = await fetch(`${BACKEND_HTTP}/maps/${mapMeta.id}`, { method: 'DELETE' });
      if (!res.ok) {
        addLog('warn', `Failed to delete map "${mapMeta.name}".`);
        return;
      }
      addLog('sys', `Deleted map "${mapMeta.name}".`);
      loadSavedMaps();
    } catch {
      addLog('warn', 'Error while deleting saved map.');
    }
  }, [addLog, loadSavedMaps]);

  // ─── Motor commands ───
  const sendCommand = useCallback((cmd) => {
    if (wsStatus === 'connected' && ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'cmd', command: cmd, speed }));
    }
    addLog('cmd', `Command: ${cmd} @ speed ${speed}`);
  }, [wsStatus, speed, addLog]);

  const toggleAI = useCallback(() => {
    const next = !aiActive;
    if (next && !geminiKey.trim()) {
      addLog('warn', 'Enter a Gemini API key before enabling live analysis.');
      return;
    }
    setAiActive(next);
    if (wsStatus === 'connected') {
      ws.current?.send(JSON.stringify({ type: 'ai_toggle', enabled: next, key: geminiKey }));
    }
    addLog('sys', `Gemini AI ${next ? 'enabled' : 'disabled'}.`);
  }, [aiActive, wsStatus, geminiKey, addLog]);

  const toggleMap = useCallback(() => {
    const next = !mapActive;
    setMapActive(next);
    if (wsStatus === 'connected') {
      ws.current?.send(JSON.stringify({ type: 'map_toggle', enabled: next }));
    }
    addLog('sys', `Terrain mapping ${next ? 'started' : 'stopped'}.`);
  }, [mapActive, wsStatus, addLog]);

  const saveMap = useCallback(() => {
    if (wsStatus === 'connected') {
      const name = `Map_${new Date().toISOString().slice(0, 19).replace('T', '_')}`;
      ws.current?.send(JSON.stringify({ type: 'save_map', name }));
    } else {
      addLog('warn', 'Not connected — cannot save map.');
    }
  }, [wsStatus, addLog]);

  const uploadVideoMemory = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', file.name.replace(/\.[^.]+$/, '') || 'road_memory');

    try {
      const res = await fetch(`${BACKEND_HTTP}/maps/upload-video`, {
        method: 'POST',
        body: formData,
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.detail || 'Upload failed');
      }

      addLog('sys', `Uploaded road/forest video as memory: "${payload.name}"`);
      loadSavedMaps();
    } catch (error) {
      addLog('warn', `Video upload failed: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  }, [addLog, loadSavedMaps]);

  const analyzeVideo = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!geminiKey.trim()) {
      addLog('warn', 'Enter a Gemini API key before analyzing a video.');
      event.target.value = '';
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', file.name.replace(/\.[^.]+$/, '') || 'video_map');
    formData.append('gemini_key', geminiKey.trim());
    try {
      const res = await fetch(`${BACKEND_HTTP}/maps/analyze-video`, { method: 'POST', body: formData });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.detail || 'Video analysis failed');
      addLog('sys', `Video analysis started for "${payload.name}".`);
      const poll = window.setInterval(async () => {
        const statusRes = await fetch(`${BACKEND_HTTP}/maps/video-jobs/${payload.job_id}`);
        const status = await statusRes.json();
        if (status.status === 'processing') addLog('sys', `Video mapping: ${status.progress}% (${status.processed_frames} frames).`);
        if (status.status === 'completed') {
          window.clearInterval(poll);
          addLog('sys', `Video map saved to server with ${status.frames_analyzed} analyzed frames.`);
          loadSavedMaps();
          if (status.map_id) loadMapById({ id: status.map_id, name: payload.name });
        } else if (status.status === 'failed') {
          window.clearInterval(poll);
          addLog('warn', `Video mapping failed: ${status.error}`);
        }
      }, 3000);
    } catch (error) {
      addLog('warn', `Video analysis failed: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  }, [addLog, geminiKey, loadMapById, loadSavedMaps]);

  const analyzeSavedVideo = useCallback(async () => {
    if (!geminiKey.trim()) {
      addLog('warn', 'Enter a Gemini API key before analyzing the saved video.');
      return;
    }
    const savedVideo = savedMaps.find(map => map.sourceType === 'video');
    if (!savedVideo) {
      addLog('warn', 'No saved video is available on the server.');
      return;
    }
    const formData = new FormData();
    formData.append('gemini_key', geminiKey.trim());
    try {
      const res = await fetch(`${BACKEND_HTTP}/maps/${savedVideo.id}/analyze-video`, { method: 'POST', body: formData });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.detail || 'Saved video analysis failed');
      setVideoJob(payload);
      addLog('sys', `Saved video analysis started for "${payload.name}".`);
      const poll = window.setInterval(async () => {
        const statusRes = await fetch(`${BACKEND_HTTP}/maps/video-jobs/${payload.job_id}`);
        const status = await statusRes.json();
        setVideoJob(status);
        if (status.status === 'processing') addLog('sys', `Video mapping: ${status.progress}% (${status.processed_frames} frames).`);
        if (status.status === 'completed') {
          window.clearInterval(poll);
          addLog('sys', `Saved video map completed with ${status.frames_analyzed} analyzed frames.`);
          loadSavedMaps();
          loadMapById({ id: status.map_id, name: payload.name });
        } else if (status.status === 'failed') {
          window.clearInterval(poll);
          addLog('warn', `Saved video mapping failed: ${status.error}`);
        } else if (status.status === 'cancelled') {
          window.clearInterval(poll);
          addLog('sys', 'Video mapping cancelled. No partial map was saved.');
        }
      }, 3000);
    } catch (error) {
      addLog('warn', `Saved video analysis failed: ${error.message}`);
    }
  }, [addLog, geminiKey, loadMapById, loadSavedMaps, savedMaps]);

  const cancelVideoAnalysis = useCallback(async () => {
    if (!videoJob?.job_id) return;
    try {
      await fetch(`${BACKEND_HTTP}/maps/video-jobs/${videoJob.job_id}/cancel`, { method: 'POST' });
      addLog('sys', 'Stopping video analysis...');
    } catch {
      addLog('warn', 'Could not cancel video analysis.');
    }
  }, [addLog, videoJob]);

  if (showIntro) {
    return <IntroScreen onEnter={() => setShowIntro(false)} />;
  }

  return (
    <div className="app dashboard-reveal">
      <Header
        camStatus={wsStatus}
        aiActive={aiActive}
        mapActive={mapActive}
        onToggleAI={toggleAI}
        onToggleMap={toggleMap}
      />

      <div className="content">
        {/* Column 1: Video + AI Log */}
        <div className="col">
          <div className="card glass" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: '0 0 auto' }}>
            <div className="card-header">
              <div className="card-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
                  <circle cx="12" cy="13" r="3"/>
                </svg>
                Live Feed
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                {streamUrl === '__localcam__' ? 'Laptop camera (browser preview)' : (streamUrl || 'No stream configured')}
              </span>
            </div>
            <VideoFeed streamUrl={streamUrl} isConnected={wsStatus === 'connected'} latestFrame={latestFrame} />
          </div>
          <AILog entries={logs} latestFrame={latestFrame} />
        </div>

        {/* Column 2: Map + Terrain Stats */}
        <div className="col">
          <MapView
            mapData={mapData}
            vehiclePos={vehiclePos}
            path={path}
            mapObjects={mapObjects}
            mapSummary={mapSummary}
            savedMaps={savedMaps}
            streamUrl={streamUrl}
            isConnected={wsStatus === 'connected'}
            onLoadMap={loadMapById}
            onDeleteMap={deleteMapById}
          />
          <TerrainStats analysis={analysis} />
        </div>

        {/* Column 3: Controls + Connection */}
        <div className="col">
          <ConnectionPanel
            wsStatus={wsStatus}
            streamUrl={streamUrl}
            onConnect={connectBackend}
            onDisconnect={disconnectBackend}
            onStreamUrlChange={setStreamUrl}
            geminiKey={geminiKey}
            onGeminiKeyChange={setGeminiKey}
          />
          <Controls
            onCommand={sendCommand}
            speed={speed}
            onSpeedChange={setSpeed}
          />
          {/* Quick Actions */}
          <div className="card glass" style={{ gap: '0.6rem', display: 'flex', flexDirection: 'column' }}>
            <div className="card-header">
              <div className="card-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M5.34 18.66l-1.41 1.41M2 12H4m16 0h2M5.34 5.34 3.93 3.93M18.66 18.66l1.41 1.41M12 2v2m0 16v2"/>
                </svg>
                Quick Actions
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                id="btn-save-map"
                className="btn btn-success"
                style={{ width: '100%', padding: '0.65rem' }}
                onClick={saveMap}
              >
                💾 Save Current Map
              </button>
              <label className="btn btn-accent" style={{ width: '100%', padding: '0.65rem', cursor: 'pointer', textAlign: 'center' }}>
                🎬 Upload Road/Forest Video
                <input type="file" accept="video/*" onChange={uploadVideoMemory} style={{ display: 'none' }} />
              </label>
              <label className="btn btn-success" style={{ width: '100%', padding: '0.65rem', cursor: 'pointer', textAlign: 'center' }}>
                🗺 Analyze Video &amp; Build Map
                <input type="file" accept="video/*" onChange={analyzeVideo} style={{ display: 'none' }} />
              </label>
              <button
                id="btn-analyze-saved-video"
                className="btn btn-success"
                style={{ width: '100%', padding: '0.65rem' }}
                onClick={analyzeSavedVideo}
              >
                ▶ Analyze Saved Forest Video
              </button>
              {videoJob && ['queued', 'processing', 'cancelling'].includes(videoJob.status) && (
                <button
                  id="btn-cancel-video-analysis"
                  className="btn btn-ghost"
                  style={{ width: '100%', padding: '0.65rem' }}
                  onClick={cancelVideoAnalysis}
                >
                  ■ Stop Video Analysis ({Math.round(videoJob.progress || 0)}%)
                </button>
              )}
              <button
                id="btn-clear-log"
                className="btn btn-ghost"
                style={{ width: '100%', padding: '0.65rem' }}
                onClick={() => setLogs([{ time: ts(), type: 'sys', text: 'Log cleared.' }])}
              >
                🗑 Clear Log
              </button>
              <button
                id="btn-reset-map"
                className="btn btn-ghost"
                style={{ width: '100%', padding: '0.65rem' }}
                onClick={() => {
                  setMapData([]); setMapObjects([]); setMapSummary({ terrain: 'unknown', summary: 'Waiting for terrain analysis.', action: 'stop', confidence: 0, obstacles: 0 }); setPath([{ x: 0, y: 0 }]); setVehiclePos({ x: 0, y: 0, angle: 0 });
                  setAnalysis(prev => ({ ...prev, covered_m2: 0, map_cells: 0, obstacles: 0 }));
                  addLog('sys', 'Map reset.');
                }}
              >
                🔄 Reset Map
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
