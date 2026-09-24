// src/components/AILog.jsx
import React, { useEffect, useRef } from 'react';

const BrainIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
  </svg>
);

const LABEL_MAP = {
  sys:  { cls: 'log-label-sys',  text: 'SYS' },
  ai:   { cls: 'log-label-ai',   text: 'AI' },
  cmd:  { cls: 'log-label-cmd',  text: 'CMD' },
  warn: { cls: 'log-label-warn', text: 'WARN' },
};

export default function AILog({ entries, latestFrame }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  return (
    <div className="card glass" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div className="card-header">
        <div className="card-title">
          <BrainIcon /> Gemini AI Telemetry
        </div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          {entries.length} entries
        </span>
      </div>
      <div className="frame-summary" aria-live="polite">
        <div className="frame-summary-header">
          <span>Latest Frame</span>
          {latestFrame ? <span>{Math.round(latestFrame.confidence * 100)}% confidence</span> : <span>Waiting for analysis</span>}
        </div>
        {latestFrame ? (
          <>
            <div className="frame-summary-title">
              {latestFrame.terrain} road · {latestFrame.obstacleCount} obstacle{latestFrame.obstacleCount === 1 ? '' : 's'}
            </div>
            <div className="frame-summary-text">{latestFrame.summary}</div>
            <div className="frame-objects">
              {latestFrame.objects.length ? latestFrame.objects.map((object, index) => (
                <span className="frame-object" key={`${object.label || object.name || 'object'}-${index}`}>
                  {object.label || object.name || 'object'}{object.position ? ` · ${object.position}` : ''}
                </span>
              )) : <span className="frame-empty">No distinct objects detected</span>}
            </div>
            <div className="frame-action">Recommended: {latestFrame.recommendedAction.replaceAll('_', ' ')}</div>
          </>
        ) : <div className="frame-empty">Connect a camera and enable Gemini to analyze the scene.</div>}
      </div>
      <div className="ai-log" id="ai-log-scroll">
        {entries.map((e, i) => {
          const lbl = LABEL_MAP[e.type] || LABEL_MAP.sys;
          return (
            <div key={i} className="log-entry" style={{ animationDelay: `${i * 0.05}s` }}>
              <span className="log-ts">{e.time}</span>
              <span className={`log-label ${lbl.cls}`}>{lbl.text}</span>
              <span className="log-text">{e.text}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
