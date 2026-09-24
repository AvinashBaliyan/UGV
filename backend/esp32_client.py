"""
esp32_client.py — Async client that connects to the ESP32.

The ESP32-CAM in this project:
  - Serves MJPEG stream on http://<ip>/stream
  - Accepts motor commands via WebSocket on ws://<ip>:81/ws
    (JSON: {"cmd": "FORWARD", "speed": 180})
  - Serves single JPEG snapshot on http://<ip>/capture  (for Gemini AI)

If the ESP32 is not available (during development), this client
gracefully degrades so the backend doesn't crash.

Requirements (install via: pip install -r requirements.txt):
  websockets>=11.0
"""
import asyncio
import json
import logging
import urllib.request
from typing import Optional

# websockets is installed in the project venv (see requirements.txt).
# Run: source backend/venv/bin/activate && pip install -r backend/requirements.txt
try:
    import websockets
    import websockets.exceptions
    _WS_AVAILABLE = True
except ImportError:
    _WS_AVAILABLE = False
    logging.getLogger(__name__).warning(
        "websockets package not found. "
        "Activate the venv: source backend/venv/bin/activate"
    )

log = logging.getLogger(__name__)


class ESP32Client:
    def __init__(self, esp_url: str):
        """
        esp_url: WebSocket URL like ws://192.168.1.100:81/ws
        The HTTP base URL (for MJPEG stream / snapshot) is derived automatically.
        """
        self._ws_url = esp_url
        self._ws = None
        self._connected = False

        # Derive HTTP base from ws url: ws://192.168.x.x:81/ws → 192.168.x.x
        host = esp_url.replace("ws://", "").split(":")[0]
        self._stream_url = f"http://{host}/stream"
        self._snapshot_url = f"http://{host}/capture"

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def stream_url(self) -> str:
        return self._stream_url

    async def connect(self) -> bool:
        """
        Open WebSocket connection to the ESP32.
        Returns True if successful, False otherwise.
        """
        if not _WS_AVAILABLE:
            log.error("websockets is not installed — cannot connect to ESP32.")
            return False
        try:
            self._ws = await websockets.connect(
                self._ws_url,
                open_timeout=4,
                ping_interval=20,
                ping_timeout=10,
            )
            self._connected = True
            log.info("Connected to ESP32 at %s", self._ws_url)
            return True
        except Exception as e:
            self._connected = False
            log.warning("Could not connect to ESP32 (%s): %s", self._ws_url, e)
            return False

    async def disconnect(self):
        """Close the WebSocket connection cleanly."""
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
        self._ws = None
        self._connected = False
        log.info("Disconnected from ESP32.")

    async def send_command(self, cmd: str, speed: int):
        """
        Send a motor command JSON message to the ESP32.
        Example payload: {"cmd": "FORWARD", "speed": 180}
        """
        if not self._connected or not self._ws:
            log.debug("ESP32 not connected, skipping command: %s", cmd)
            return
        try:
            payload = json.dumps({"cmd": cmd, "speed": speed})
            await self._ws.send(payload)
        except Exception as e:
            log.warning("Error sending command to ESP32: %s", e)
            self._connected = False

    async def get_frame(self) -> Optional[bytes]:
        """
        Grab a single JPEG frame from the ESP32 /capture endpoint.
        Uses run_in_executor so it doesn't block the async event loop.
        Returns raw JPEG bytes, or None on failure.
        """
        loop = asyncio.get_running_loop()
        try:
            frame = await loop.run_in_executor(None, self._fetch_snapshot)
            return frame
        except Exception as e:
            log.debug("Frame capture failed: %s", e)
            return None

    def _fetch_snapshot(self) -> bytes:
        """Synchronous HTTP GET for a single JPEG frame (runs in thread pool)."""
        req = urllib.request.Request(
            self._snapshot_url,
            headers={"User-Agent": "UGV-Backend/1.0"}
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = resp.read()
        if not data:
            raise ValueError("Empty response from /capture endpoint")
        return data
