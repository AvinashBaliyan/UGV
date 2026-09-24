// src/components/Header.jsx
import React from 'react';

const CameraIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
    <circle cx="12" cy="13" r="3"/>
  </svg>
);
const BrainIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
  </svg>
);

export default function Header({ camStatus, aiActive, mapActive, onToggleAI, onToggleMap }) {
  const statusChip = () => {
    if (camStatus === 'connected') return <span className="chip chip-live"><span className="chip-dot"/> LIVE</span>;
    if (camStatus === 'connecting') return <span className="chip chip-offline"><span className="chip-dot"/> CONNECTING...</span>;
    return <span className="chip chip-offline"><span className="chip-dot"/> CAMERA OFFLINE</span>;
  };

  return (
    <header className="header">
      <div className="header-logo">
        <div className="logo-icon">🤖</div>
        <div>
          <div className="logo-text">TRINETRA</div>
          <div className="logo-sub">ESP32-CAM · Gemini AI · Autonomous Mapping</div>
        </div>
      </div>
      <div className="header-center">
        {statusChip()}
        {aiActive && <span className="chip chip-ai"><span className="chip-dot"/> GEMINI ACTIVE</span>}
        {mapActive && <span className="chip chip-map"><span className="chip-dot"/> MAPPING</span>}
      </div>
      <div className="header-right">
        <button
          id="btn-toggle-ai"
          className={`btn ${aiActive ? 'btn-accent' : 'btn-ghost'}`}
          onClick={onToggleAI}
        >
          <BrainIcon /> {aiActive ? 'AI ON' : 'Enable AI'}
        </button>
        <button
          id="btn-toggle-map"
          className={`btn ${mapActive ? 'btn-success' : 'btn-ghost'}`}
          onClick={onToggleMap}
        >
          <CameraIcon /> {mapActive ? 'Mapping ON' : 'Start Mapping'}
        </button>
      </div>
    </header>
  );
}
