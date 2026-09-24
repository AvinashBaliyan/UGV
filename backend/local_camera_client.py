"""
local_camera_client.py — Async camera client for laptop webcam testing.

Implements the same interface used by main.py:
  - connect() -> bool
  - disconnect()
  - send_command(cmd, speed)  # no-op for local camera
  - get_frame() -> Optional[bytes]
"""
import asyncio
import logging
from typing import Optional

try:
    import cv2
    _CV2_AVAILABLE = True
except ImportError:
    cv2 = None
    _CV2_AVAILABLE = False


log = logging.getLogger(__name__)


class LocalCameraClient:
    def __init__(self, camera_index: int = 0):
        self._camera_index = camera_index
        self._capture = None
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    async def connect(self) -> bool:
        if not _CV2_AVAILABLE:
            log.error("opencv-python is not installed; local camera mode unavailable.")
            return False

        loop = asyncio.get_running_loop()
        ok = await loop.run_in_executor(None, self._open_camera)
        self._connected = ok
        return ok

    def _open_camera(self) -> bool:
        if cv2 is None:
            return False
        cap = cv2.VideoCapture(self._camera_index)
        if not cap.isOpened():
            return False

        # Reasonable default test resolution.
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        self._capture = cap
        log.info("Connected to local camera index %s", self._camera_index)
        return True

    async def disconnect(self):
        if self._capture is not None:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, self._release_camera)
        self._connected = False
        log.info("Disconnected local camera.")

    def _release_camera(self):
        try:
            if self._capture is not None:
                self._capture.release()
        finally:
            self._capture = None

    async def send_command(self, cmd: str, speed: int):
        # No motor control in local test mode.
        return

    async def get_frame(self) -> Optional[bytes]:
        if not self._connected or self._capture is None:
            return None

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._read_jpeg)

    def _read_jpeg(self) -> Optional[bytes]:
        if self._capture is None or cv2 is None:
            return None

        ok, frame = self._capture.read()
        if not ok or frame is None:
            return None

        ok, encoded = cv2.imencode('.jpg', frame)
        if not ok:
            return None
        return encoded.tobytes()
