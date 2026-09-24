// src/hooks/useWebSocket.js
import { useEffect, useRef, useCallback, useState } from 'react';

export function useWebSocket(url) {
  const ws = useRef(null);
  const [status, setStatus] = useState('disconnected'); // 'connected' | 'disconnected' | 'connecting'

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return;
    setStatus('connecting');
    try {
      ws.current = new WebSocket(url);
      ws.current.onopen = () => setStatus('connected');
      ws.current.onclose = () => setStatus('disconnected');
      ws.current.onerror = () => setStatus('disconnected');
    } catch {
      setStatus('disconnected');
    }
  }, [url]);

  const disconnect = useCallback(() => {
    ws.current?.close();
    ws.current = null;
    setStatus('disconnected');
  }, []);

  const send = useCallback((msg) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
  }, []);

  useEffect(() => () => ws.current?.close(), []);

  return { status, connect, disconnect, send, ws };
}
