// src/components/Controls.jsx
import React, { useEffect, useState, useCallback } from 'react';

const COMMANDS = {
  ArrowUp: 'FORWARD', w: 'FORWARD',
  ArrowDown: 'BACKWARD', s: 'BACKWARD',
  ArrowLeft: 'LEFT', a: 'LEFT',
  ArrowRight: 'RIGHT', d: 'RIGHT',
  ' ': 'STOP',
};

const GamepadIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/>
    <line x1="15" y1="11" x2="15" y2="11"/><line x1="18" y1="13" x2="18" y2="13"/>
    <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>
  </svg>
);

export default function Controls({ onCommand, speed, onSpeedChange }) {
  const [active, setActive] = useState(null);
  const [mode, setMode] = useState('manual'); // 'manual' | 'auto'

  const triggerCommand = useCallback((cmd) => {
    setActive(cmd);
    onCommand(cmd);
  }, [onCommand]);

  const stopCommand = useCallback(() => {
    setActive(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const cmd = COMMANDS[e.key];
      if (cmd && active !== cmd) triggerCommand(cmd);
    };
    const handleKeyUp = (e) => {
      const cmd = COMMANDS[e.key];
      if (cmd && cmd !== 'STOP') {
        stopCommand();
        onCommand('STOP');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [active, triggerCommand, stopCommand, onCommand]);

  const dpadBtn = (cmd, label, className) => (
    <button
      id={`dpad-${cmd.toLowerCase()}`}
      className={`dpad-btn ${className} ${active === cmd ? 'active' : ''}`}
      onPointerDown={() => triggerCommand(cmd)}
      onPointerUp={() => { stopCommand(); if (cmd !== 'STOP') onCommand('STOP'); }}
      onPointerLeave={() => { if (active === cmd && cmd !== 'STOP') { stopCommand(); onCommand('STOP'); } }}
    >
      {label}
    </button>
  );

  return (
    <div className="card glass manual-override-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem 1.25rem' }}>
      <div className="card-header">
        <div className="card-title"><GamepadIcon /> Manual Override</div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>WASD / Arrow keys</span>
      </div>

      <div className="manual-override-scroll">
        {/* Mode Toggle */}
        <div className="mode-row">
        <button
          id="mode-manual"
          className={`mode-btn ${mode === 'manual' ? 'active' : ''}`}
          onClick={() => {
            setMode('manual');
            onCommand('MANUAL');
          }}
        >
          Manual
        </button>
        <button id="mode-auto" className={`mode-btn ${mode === 'auto' ? 'active' : ''}`} onClick={() => { setMode('auto'); onCommand('AUTO'); }}>
          Auto Explore
        </button>
        </div>

        {/* D-Pad */}
        <div className="dpad">
          {dpadBtn('FORWARD', '▲', 'dpad-up')}
          {dpadBtn('LEFT', '◀', 'dpad-left')}
          <button id="dpad-stop" className="dpad-btn dpad-stop" onPointerDown={() => onCommand('STOP')}>■</button>
          {dpadBtn('RIGHT', '▶', 'dpad-right')}
          {dpadBtn('BACKWARD', '▼', 'dpad-down')}
        </div>

        {/* Speed Slider */}
        <div className="speed-row">
          <span className="speed-label">Speed</span>
          <input
            id="speed-slider"
            type="range" min="30" max="255" step="5"
            value={speed}
            onChange={e => onSpeedChange(Number(e.target.value))}
            className="speed-slider"
          />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--accent)', minWidth: '32px' }}>
            {Math.round((speed / 255) * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
