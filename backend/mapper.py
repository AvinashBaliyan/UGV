"""
mapper.py — Command-based dead-reckoning terrain mapper.

Since we use only the ESP32-CAM (no LiDAR / encoders), we build a 2D
occupancy grid using:
  - Motor commands + timestamps  →  estimated displacement
  - Gemini AI terrain tags       →  cell type labels
"""
import math
import time
import logging
from typing import List, Dict, Tuple

log = logging.getLogger(__name__)

# How many meters per second at full speed (255 PWM)
MAX_SPEED_MPS = 0.25
# Resolution: each grid cell represents CELL_SIZE meters
CELL_SIZE = 0.1  # 10 cm

class TerrainMapper:
    def __init__(self):
        self._cells: Dict[Tuple[int, int], str] = {}   # (gx, gy) -> type
        self._path: List[Dict] = []                     # list of {x, y}
        self._pos = [0.0, 0.0]                          # meters
        self._angle = 0.0                               # degrees (0 = forward)
        self._last_cmd: str = "STOP"
        self._last_speed: int = 0
        self._last_cmd_time: float = time.time()
        self._current_terrain: str = "unknown"
        self._session_started: float = time.time()

    def start_session(self):
        """Reset for a new mapping session."""
        self._cells.clear()
        self._path.clear()
        self._pos = [0.0, 0.0]
        self._angle = 0.0
        self._last_cmd = "STOP"
        self._last_speed = 0
        self._last_cmd_time = time.time()
        self._path.append({"x": 0.0, "y": 0.0})
        log.info("Mapping session started.")

    def record_command(self, cmd: str, speed: int):
        """Called every time a motor command is issued."""
        self._integrate_until_now()
        self._last_cmd = cmd
        self._last_speed = speed
        self._last_cmd_time = time.time()

    def record_observation(self, cmd: str, speed: int, duration: float):
        """Advance a recorded-video route without waiting on wall-clock time."""
        self._apply_motion(cmd, speed, max(0.0, duration))
        self._last_cmd = cmd
        self._last_speed = speed
        self._last_cmd_time = time.time()

    def _integrate_until_now(self):
        """Advance pose using the last command/speed over elapsed wall time."""
        now = time.time()
        dt = now - self._last_cmd_time
        if dt <= 0:
            return
        self._apply_motion(self._last_cmd, self._last_speed, dt)
        self._last_cmd_time = now

    def _apply_motion(self, cmd: str, speed: int, dt: float):
        """Update position/angle based on previous command."""
        if cmd == "STOP" or dt <= 0:
            return

        velocity = (speed / 255.0) * MAX_SPEED_MPS  # m/s
        angle_rad = math.radians(self._angle)

        if cmd == "FORWARD":
            self._pos[0] += velocity * dt * math.sin(angle_rad)
            self._pos[1] += velocity * dt * math.cos(angle_rad)
        elif cmd == "BACKWARD":
            self._pos[0] -= velocity * dt * math.sin(angle_rad)
            self._pos[1] -= velocity * dt * math.cos(angle_rad)
        elif cmd == "LEFT":
            self._angle -= 45 * dt  # angular velocity
        elif cmd == "RIGHT":
            self._angle += 45 * dt

        self._angle %= 360
        self._mark_current_cell()
        self._path.append({"x": round(self._pos[0], 3), "y": round(self._pos[1], 3)})

    def _mark_current_cell(self):
        gx = int(self._pos[0] / CELL_SIZE)
        gy = int(self._pos[1] / CELL_SIZE)
        self._cells[(gx, gy)] = self._current_terrain

    def update(self, ai_result: dict) -> List[Dict]:
        """
        Called with every Gemini AI result.
        Updates the current terrain type and marks cells around vehicle as
        obstacle / clear based on AI analysis.
        Returns the serialized cells list.
        """
        self._integrate_until_now()
        self._current_terrain = ai_result.get("terrain", "unknown")
        has_obs = ai_result.get("has_obstacle", False)

        # Mark current position
        gx = int(self._pos[0] / CELL_SIZE)
        gy = int(self._pos[1] / CELL_SIZE)
        self._cells[(gx, gy)] = self._current_terrain

        # If obstacle detected, mark cell ahead as obstacle
        if has_obs:
            angle_rad = math.radians(self._angle)
            ox = gx + round(math.sin(angle_rad))
            oy = gy + round(math.cos(angle_rad))
            self._cells[(ox, oy)] = "obstacle"

        return self.all_cells()

    def all_cells(self) -> List[Dict]:
        return [
            {"x": k[0], "y": k[1], "type": v}
            for k, v in self._cells.items()
        ]

    def vehicle_state(self) -> Dict:
        self._integrate_until_now()
        return {"x": round(self._pos[0], 3), "y": round(self._pos[1], 3), "angle": round(self._angle, 1)}

    def path(self) -> List[Dict]:
        self._integrate_until_now()
        return self._path[-500:]  # keep last 500 points to avoid huge messages
