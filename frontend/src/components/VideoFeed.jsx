// src/components/VideoFeed.jsx
import React, { useEffect, useRef, useState } from 'react';

const CameraOffIcon = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <line x1="2" y1="2" x2="22" y2="22"/><path d="M7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16"/><path d="M9.5 4h5L17 7h3a2 2 0 0 1 2 2v7.5"/><circle cx="12" cy="13" r="3"/>
  </svg>
);

const ACTION_LABELS = {
  proceed: 'MOVE FORWARD',
  slow_down: 'SLOW DOWN',
  turn_left: 'TURN LEFT',
  turn_right: 'TURN RIGHT',
  stop: 'STOP',
};

export default function VideoFeed({ streamUrl, isConnected, latestFrame }) {
  const localMode = streamUrl === '__localcam__';
  const localVideoRef = useRef(null);

  useEffect(() => {
    if (!localMode || !isConnected) return;

    let mediaStream = null;
    let mounted = true;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) return;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        if (!mounted || !localVideoRef.current) return;
        localVideoRef.current.srcObject = mediaStream;
        localVideoRef.current.muted = true;
        await localVideoRef.current.play().catch(() => {});
      } catch (error) {
        console.error('Local camera preview failed:', error);
      }
    };

    start();

    return () => {
      mounted = false;
      if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
    };
  }, [localMode, isConnected]);

  return (
    <div className="video-wrapper">
      {isConnected && streamUrl && !localMode ? (
        <img
          id="video-feed-img"
          src={streamUrl}
          alt="UGV Live Feed"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={e => { e.target.style.display = 'none'; }}
        />
      ) : localMode && isConnected ? (
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div className="video-offline">
          <CameraOffIcon />
          <span>Camera feed offline</span>
          <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>
            {localMode ? 'Browser camera is shown on the map preview' : 'Connect to ESP32 stream to begin'}
          </span>
        </div>
      )}
      {/* HUD overlay */}
      <div className="video-hud">
        {isConnected && (
          <span className="chip chip-live" style={{ fontSize: '0.7rem', padding: '0.2rem 0.65rem' }}>
            <span className="chip-dot"/> REC
          </span>
        )}
      </div>
      {isConnected && latestFrame && (
        <div className={`video-guidance ${latestFrame.obstacleCount > 0 || latestFrame.recommendedAction === 'stop' ? 'video-guidance-danger' : ''}`}>
          <span className="video-guidance-action">
            {ACTION_LABELS[latestFrame.recommendedAction] || 'ANALYZING'}
          </span>
          <span className="video-guidance-detail">
            {latestFrame.obstacleCount > 0
              ? `${latestFrame.obstacleCount} obstacle${latestFrame.obstacleCount === 1 ? '' : 's'} detected`
              : `${Math.round(latestFrame.confidence * 100)}% confidence`}
          </span>
        </div>
      )}
      {/* Scan line effect */}
      {isConnected && <div className="video-scan-line" />}
      {/* Corner brackets */}
      <div className="video-corner vc-tl"/>
      <div className="video-corner vc-tr"/>
      <div className="video-corner vc-bl"/>
      <div className="video-corner vc-br"/>
    </div>
  );
}
