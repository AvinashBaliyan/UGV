// src/components/TerrainStats.jsx
import React from 'react';

const TERRAINS = [
  { key: 'clear', label: 'Clear Path', color: '#00ff8a' },
  { key: 'obstacle', label: 'Obstacle', color: '#ff3b5c' },
  { key: 'grass', label: 'Grass', color: '#7dff4f' },
  { key: 'rock', label: 'Rock/Gravel', color: '#ffb830' },
  { key: 'unknown', label: 'Unknown', color: '#7b8099' },
];

const ChartIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>
  </svg>
);

export default function TerrainStats({ analysis }) {
  // analysis: { terrain: string, confidence: number, obstacles: number, covered_m2: number, terrainBreakdown: {...} }
  const breakdown = analysis?.terrainBreakdown || {};

  return (
    <div className="card glass">
      <div className="card-header">
        <div className="card-title"><ChartIcon /> Terrain Analysis</div>
        {analysis?.terrain && (
          <span style={{ fontSize: '0.72rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
            {analysis.terrain} ({Math.round((analysis.confidence || 0) * 100)}%)
          </span>
        )}
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Area Covered</div>
          <div className="stat-value">{(analysis?.covered_m2 || 0).toFixed(1)}<span className="stat-unit">m²</span></div>
          <div className="stat-bar"><div className="stat-bar-fill" style={{ width: `${Math.min((analysis?.covered_m2 || 0) * 5, 100)}%`, background: 'var(--accent)' }}/></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Obstacles</div>
          <div className="stat-value">{analysis?.obstacles || 0}</div>
          <div className="stat-bar"><div className="stat-bar-fill" style={{ width: `${Math.min((analysis?.obstacles || 0) * 10, 100)}%`, background: 'var(--danger)' }}/></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Map Cells</div>
          <div className="stat-value">{analysis?.map_cells || 0}</div>
          <div className="stat-bar"><div className="stat-bar-fill" style={{ width: `${Math.min((analysis?.map_cells || 0) / 2, 100)}%`, background: 'var(--success)' }}/></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">AI Scans</div>
          <div className="stat-value">{analysis?.ai_scans || 0}</div>
          <div className="stat-bar"><div className="stat-bar-fill" style={{ width: `${Math.min((analysis?.ai_scans || 0) * 5, 100)}%`, background: 'var(--warning)' }}/></div>
        </div>
      </div>

      {/* Terrain Breakdown */}
      <div className="terrain-bar">
        {TERRAINS.map(t => {
          const pct = breakdown[t.key] || 0;
          return (
            <div key={t.key} className="terrain-item">
              <span className="terrain-name">{t.label}</span>
              <div className="terrain-track">
                <div className="terrain-fill" style={{ width: `${pct}%`, background: t.color }}/>
              </div>
              <span className="terrain-pct">{pct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
