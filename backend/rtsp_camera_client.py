"""Open an RTSP camera and expose JPEG frames to the dashboard backend."""

import asyncio
import logging
import threading
from typing import Optional

try:
    import cv2
    _CV2_AVAILABLE = True
except ImportError:  # pragma: no cover
    cv2 = None
    _CV2_AVAILABLE = False

log = logging.getLogger(__name__)


class RTSPCameraClient:
    def __init__(self, url: str):
        self._url = url
        self._capture = None
        self._connected = False
        self._lock = threading.Lock()

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def stream_url(self) -> str:
        return ""

    async def connect(self) -> bool:
        if not _CV2_AVAILABLE:
            log.error("opencv-python is not installed; RTSP camera mode unavailable.")
            return False

        loop = asyncio.get_running_loop()
        ok = await asyncio.wait_for(
            loop.run_in_executor(None, self._open_stream),
            timeout=12,
        )
        self._connected = ok
        return ok

    def _open_stream(self) -> bool:
        if cv2 is None:
            return False

        capture = cv2.VideoCapture(self._url)
        if not capture.isOpened():
            capture.release()
            log.warning("Could not open RTSP stream %s", self._url)
            return False

        with self._lock:
            self._capture = capture
        log.info("Connected to RTSP camera %s", self._url)
        return True

    async def disconnect(self):
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._release_stream)
        self._connected = False
        log.info("Disconnected RTSP camera.")

    def _release_stream(self):
        with self._lock:
            capture = self._capture
            self._capture = None
        if capture is not None:
            capture.release()

    async def send_command(self, cmd: str, speed: int):
        return

    async def get_frame(self) -> Optional[bytes]:
        if not self._connected:
            return None
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._read_jpeg)

    def _read_jpeg(self) -> Optional[bytes]:
        with self._lock:
            if self._capture is None or cv2 is None:
                return None
            ok, frame = self._capture.read()

        if not ok or frame is None:
            return None
        ok, encoded = cv2.imencode('.jpg', frame)
        return encoded.tobytes() if ok else None