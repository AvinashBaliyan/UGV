// src/components/ConnectionPanel.jsx
import React, { useEffect, useState } from 'react';

const BACKEND_HTTP = 'http://localhost:8000';

const LinkIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>
);

export default function ConnectionPanel({ wsStatus, streamUrl, onConnect, onDisconnect, onStreamUrlChange, geminiKey, onGeminiKeyChange }) {
  const [hostInput, setHostInput] = useState('192.168.1.100');
  const [useLaptopCam, setUseLaptopCam] = useState(false);
  const [useBluetooth, setUseBluetooth] = useState(false);
  const [useRtsp, setUseRtsp] = useState(false);
  const [rtspUrl, setRtspUrl] = useState('');
  const [bluetoothDevices, setBluetoothDevices] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [bluetoothMessage, setBluetoothMessage] = useState('');

  const scanBluetoothDevices = async () => {
    setIsScanning(true);
    setBluetoothMessage('Scanning paired serial devices...');
    try {
      const response = await fetch(`${BACKEND_HTTP}/bluetooth/devices`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || 'Bluetooth scan failed.');
      const devices = payload.devices || [];
      setBluetoothDevices(devices);
      if (!hostInput.trim() && devices.length) {
        const preferred = devices.find(device => /hc-?05/i.test(`${device.name} ${device.port}`)) || devices[0];
        setHostInput(preferred.port);
      }
      setBluetoothMessage(
        devices.length
          ? 'Select the HC-05 port, then connect.'
          : (payload.message || 'No Bluetooth serial device found.')
      );
    } catch (error) {
      setBluetoothDevices([]);
      setBluetoothMessage(error.message);
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    if (useBluetooth) scanBluetoothDevices();
  }, [useBluetooth]);

  const handleConnect = () => {
    if (useLaptopCam) {
      onStreamUrlChange('__localcam__');
      onConnect('localcam://0');
      return;
    }

    if (useBluetooth) {
      const port = hostInput.trim();
      if (!port) {
        setBluetoothMessage('Scan and select an HC-05 serial port first.');
        return;
      }
      onStreamUrlChange('');
      onConnect(`bluetooth://${port}`);
      return;
    }

    if (useRtsp) {
      const url = rtspUrl.trim();
      if (!url.startsWith('rtsp://')) {
        setBluetoothMessage('Enter a valid RTSP URL starting with rtsp://');
        return;
      }
      onStreamUrlChange(`${BACKEND_HTTP}/camera/stream`);
      onConnect(url);
      return;
    }

    const wsUrl = `ws://${hostInput}:81/ws`;
    const mjpeg = `http://${hostInput}/stream`;
    onStreamUrlChange(mjpeg);
    onConnect(wsUrl);
  };

  return (
    <div className="card glass connection-card">
      <div className="card-header">
        <div className="card-title"><LinkIcon /> Connection</div>
        <span className={`chip ${wsStatus === 'connected' ? 'chip-live' : wsStatus === 'connecting' ? 'chip-ai' : 'chip-offline'}`} style={{ fontSize: '0.68rem', padding: '0.15rem 0.55rem' }}>
          <span className="chip-dot"/> {wsStatus.toUpperCase()}
        </span>
      </div>
      <div className="conn-row">
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
          {useBluetooth ? 'Bluetooth vehicle connection' : useRtsp ? 'Phone RTSP camera URL' : 'ESP32 IP Address'}
        </div>
        <div className="conn-input-row">
          {useBluetooth ? (
            <select
              id="bluetooth-device-select"
              className="conn-input"
              value={hostInput}
              onChange={e => setHostInput(e.target.value)}
              disabled={useLaptopCam || isScanning}
            >
              <option value="">Select a paired Bluetooth device</option>
              {bluetoothDevices.map(device => (
                <option key={device.port} value={device.port}>
                  {device.name} ({device.port})
                </option>
              ))}
            </select>
          ) : useRtsp ? (
            <input
              id="rtsp-url-input"
              className="conn-input"
              placeholder="rtsp://user:password@phone-ip:8554/live"
              value={rtspUrl}
              onChange={e => setRtspUrl(e.target.value)}
              disabled={useLaptopCam}
            />
          ) : (
            <input
              id="esp32-ip-input"
              className="conn-input"
              placeholder="192.168.x.x"
              value={hostInput}
              onChange={e => setHostInput(e.target.value)}
              disabled={useLaptopCam}
            />
          )}
          {useBluetooth && (
            <button type="button" className="btn btn-ghost" onClick={scanBluetoothDevices} disabled={isScanning}>
              {isScanning ? 'Scanning...' : 'Scan'}
            </button>
          )}
          {wsStatus === 'connected'
            ? <button id="btn-disconnect" className="btn btn-danger" onClick={onDisconnect}>Disconnect</button>
            : <button id="btn-connect" className="btn btn-accent" onClick={handleConnect}>Connect</button>
          }
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--text-secondary)', fontSize: '0.74rem', marginTop: '0.15rem' }}>
          <input
            id="use-laptop-cam"
            type="checkbox"
            checked={useLaptopCam}
            onChange={e => {
              if (e.target.checked && wsStatus === 'connected') onDisconnect();
              setUseLaptopCam(e.target.checked);
              if (e.target.checked) setUseBluetooth(false);
              if (e.target.checked) setUseRtsp(false);
            }}
          />
          Use laptop camera for testing
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--text-secondary)', fontSize: '0.74rem', marginTop: '0.15rem' }}>
          <input
            id="use-bluetooth"
            type="checkbox"
            checked={useBluetooth}
            onChange={e => {
              if (e.target.checked && wsStatus === 'connected') onDisconnect();
              setUseBluetooth(e.target.checked);
              if (e.target.checked) setUseLaptopCam(false);
              if (e.target.checked) setUseRtsp(false);
              if (e.target.checked) setHostInput('');
            }}
          />
          Use HC-05 Bluetooth for vehicle control
        </label>
        <label className="connection-option">
          <input
            id="use-rtsp-camera"
            type="checkbox"
            checked={useRtsp}
            onChange={e => {
              if (e.target.checked && wsStatus === 'connected') onDisconnect();
              setUseRtsp(e.target.checked);
              if (e.target.checked) {
                setUseLaptopCam(false);
                setUseBluetooth(false);
              }
            }}
          />
          Use phone RTSP camera
        </label>
        {useBluetooth && bluetoothMessage && (
          <div style={{ color: bluetoothDevices.length ? 'var(--success)' : 'var(--warning)', fontSize: '0.72rem', lineHeight: 1.4 }}>
            {bluetoothMessage}
          </div>
        )}
        {useRtsp && (
          <div className="connection-help">
            The backend converts RTSP to browser-compatible video. Your phone and laptop must be on the same network.
          </div>
        )}
      </div>
      <div className="conn-row">
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Gemini API Key</div>
        <div className="api-key-row">
          <input
            id="gemini-api-key-input"
            className="api-key-input"
            type="password"
            placeholder="AIza..."
            value={geminiKey}
            onChange={e => onGeminiKeyChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
