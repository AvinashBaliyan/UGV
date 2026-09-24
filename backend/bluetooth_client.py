"""
bluetooth_client.py — Serial Bluetooth client for HC-05 / Arduino-based UGV control.

This mimics the ESP32 client interface used by main.py:
  - connect() -> bool
  - disconnect()
  - send_command(cmd, speed) -> None
  - get_frame() -> Optional[bytes]

The actual vehicle movement is controlled through an Arduino + HC-05 module on a serial port
like /dev/rfcomm0 or COM3. The Arduino sketch receives one-character commands:
    F, B, L, R, S
"""

import asyncio
import logging
from typing import Optional

try:
    import serial
    _SERIAL_AVAILABLE = True
except ImportError:  # pragma: no cover
    serial = None
    _SERIAL_AVAILABLE = False

log = logging.getLogger(__name__)


class BluetoothClient:
    def __init__(self, port: str = "/dev/rfcomm0", baud_rate: int = 9600):
        self._port = port
        self._baud_rate = baud_rate
        self._serial = None
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def stream_url(self) -> str:
        return ""

    async def connect(self) -> bool:
        if not _SERIAL_AVAILABLE:
            log.error("pyserial is not installed; Bluetooth control is unavailable.")
            return False

        try:
            loop = asyncio.get_running_loop()
            ok = await loop.run_in_executor(None, self._open_serial)
            self._connected = ok
            if ok:
                log.info("Connected to HC-05 Bluetooth serial port %s", self._port)
            return ok
        except Exception as exc:  # pragma: no cover - defensive
            log.warning("Could not connect to Bluetooth serial port %s: %s", self._port, exc)
            self._connected = False
            return False

    def _open_serial(self) -> bool:
        if serial is None:
            return False

        try:
            self._serial = serial.Serial(self._port, self._baud_rate, timeout=1)
            self._serial.reset_input_buffer()
            self._serial.reset_output_buffer()
            return self._serial.is_open
        except Exception as exc:  # pragma: no cover
            log.warning("Bluetooth serial open failed for %s: %s", self._port, exc)
            self._serial = None
            return False

    async def disconnect(self):
        if self._serial is not None:
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, self._close_serial)
            except Exception:  # pragma: no cover
                pass
        self._serial = None
        self._connected = False
        log.info("Disconnected from Bluetooth serial port.")

    def _close_serial(self):
        if self._serial is not None:
            try:
                self._serial.close()
            except Exception:  # pragma: no cover
                pass

    async def send_command(self, cmd: str, speed: int):
        if not self._connected or self._serial is None:
            log.debug("HC-05 not connected, skipping command: %s", cmd)
            return

        mapped = self._map_command(cmd, speed)
        if not mapped:
            return

        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, self._write_command, mapped)
        except Exception as exc:  # pragma: no cover
            log.warning("Error sending command to HC-05: %s", exc)
            self._connected = False

    def _write_command(self, payload: str):
        if self._serial is not None and self._serial.is_open:
            self._serial.write((payload + "\n").encode("ascii"))
            self._serial.flush()

    def _map_command(self, cmd: str, speed: int) -> Optional[str]:
        cmd_key = str(cmd).upper()
        if cmd_key in {"FORWARD", "F", "UP", "W"}:
            return "F"
        if cmd_key in {"BACKWARD", "B", "DOWN", "S"}:
            return "B"
        if cmd_key in {"LEFT", "L", "A"}:
            return "L"
        if cmd_key in {"RIGHT", "R", "D"}:
            return "R"
        if cmd_key in {"STOP", "STAY", "X"}:
            return "S"
        return None

    async def get_frame(self) -> Optional[bytes]:
        return None
