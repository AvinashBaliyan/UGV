"""
UGV Backend Server — main.py
FastAPI WebSocket server bridging:
  - The web dashboard (frontend)
  - The ESP32 (camera stream + motor control via raw WebSocket)
  - Gemini API (real-time AI terrain analysis)
  - SQLite database (map storage)
"""

import asyncio
import base64
import json
import logging
import time
import uuid
from datetime import datetime
from typing import Optional

import google.generativeai as genai
import cv2
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware

try:
    from serial.tools import list_ports
except ImportError:  # pragma: no cover
    list_ports = None

from database import DatabaseManager
from mapper import TerrainMapper
from esp32_client import ESP32Client
from local_camera_client import LocalCameraClient
from bluetooth_client import BluetoothClient
from rtsp_camera_client import RTSPCameraClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="TRINETRA Control Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

db = DatabaseManager()
VIDEO_MEMORY_DIR = Path(__file__).resolve().parent / "memory_videos"
VIDEO_MEMORY_DIR.mkdir(exist_ok=True, parents=True)
active_rtsp_client = None
video_jobs = {}

# ─── Active session state ───────────────────────────────────────────────────
class Session:
    def __init__(self):
        self.ai_enabled: bool = False
        self.auto_enabled: bool = False
        self.map_enabled: bool = False
        self.gemini_key: Optional[str] = None
        self.speed: int = 180
        self.last_ai_scan: float = 0
        self.ai_interval: float = 2.5  # seconds between Gemini calls
        self.esp_client = None
        self.model = None  # Gemini model instance


ACTION_TO_COMMAND = {
    "proceed": "FORWARD",
    "turn_left": "LEFT",
    "turn_right": "RIGHT",
    "stop": "STOP",
    "slow_down": "FORWARD",
}

# ─── Gemini Analysis ────────────────────────────────────────────────────────
ANALYSIS_PROMPT = """You are the AI brain of an Unmanned Ground Vehicle (UGV) equipped with a forward-facing camera.

Analyze this image and return a JSON object with these fields:
- terrain: one of ["clear", "grass", "gravel", "rock", "sand", "water", "unknown"]
- confidence: float 0-1
- has_obstacle: boolean (true if vehicle's path is blocked within ~1 meter)
- obstacle_count: integer
- objects: array of visible objects, each with label, confidence (0-1), and position (left, center, or right)
- summary: brief 1-sentence description of what you see
- breakdown: object with keys clear, obstacle, grass, rock, unknown each as percentage (0-100, must sum to 100)
- recommended_action: one of ["proceed", "turn_left", "turn_right", "stop", "slow_down"]

Return ONLY valid JSON, no markdown."""

async def analyze_frame(model, frame_bytes: bytes) -> Optional[dict]:
    if not model:
        return None
    try:
        img_part = {"mime_type": "image/jpeg", "data": base64.b64encode(frame_bytes).decode()}
        response = model.generate_content([ANALYSIS_PROMPT, img_part])
        text = response.text.strip()
        # Strip possible markdown code fences
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text.strip())
    except Exception as e:
        log.warning(f"Gemini analysis failed: {e}")
        return {"_error": str(e)}


async def process_video_job(job_id: str, video_path: Path, name: str, api_key: str):
    job = video_jobs[job_id]
    mapper = TerrainMapper()
    mapper.start_session()
    detections = []
    capture = None
    try:
        model = create_gemini_model(api_key)
        capture = cv2.VideoCapture(str(video_path))
        if not capture.isOpened():
            raise ValueError("Unable to open uploaded video.")
        fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        duration = frame_count / fps if frame_count else 0
        sample_every = max(1, int(fps * 1.0))
        frame_index = 0
        sampled = 0
        while True:
            if job.get('cancel_requested'):
                job.update({'status': 'cancelled', 'error': 'Video analysis cancelled by user.'})
                return
            ok, frame = await asyncio.to_thread(capture.read)
            if not ok:
                break
            if frame_index % sample_every != 0:
                frame_index += 1
                continue
            success, encoded = cv2.imencode('.jpg', frame)
            if not success:
                frame_index += 1
                continue
            result = await analyze_frame(model, encoded.tobytes())
            if not result or result.get('_error'):
                raise ValueError(result.get('_error', 'No analysis returned.'))
            action = str(result.get('recommended_action', 'stop')).lower()
            command = ACTION_TO_COMMAND.get(action, 'STOP')
            mapper.record_observation(command, 180, 1.0)
            detections.append({
                'frame': frame_index,
                'time_seconds': round(frame_index / fps, 2),
                'terrain': result.get('terrain', 'unknown'),
                'has_obstacle': bool(result.get('has_obstacle', False)),
                'obstacle_count': int(result.get('obstacle_count', 0) or 0),
                'objects': result.get('objects', []),
                'recommended_action': action,
                'summary': result.get('summary', ''),
            })
            sampled += 1
            job.update({'status': 'processing', 'processed_frames': sampled, 'total_frames': frame_count, 'progress': round((frame_index / max(frame_count, 1)) * 100, 1)})
            frame_index += 1
        if not detections:
            raise ValueError('No readable frames were found in the uploaded video.')
        map_id = db.save_map(
            name,
            mapper.all_cells(),
            mapper.vehicle_state(),
            source_type='video_map',
            file_path=str(video_path),
            metadata={
                'duration_seconds': round(duration, 2),
                'frames_analyzed': len(detections),
                'detections': detections,
                'path': mapper.path(),
            },
        )
        job.update({'status': 'completed', 'progress': 100, 'map_id': map_id, 'frames_analyzed': len(detections)})
    except Exception as exc:
        log.exception('Video analysis failed for job %s', job_id)
        job.update({'status': 'failed', 'error': str(exc)})
    finally:
        if capture is not None:
            capture.release()

def create_gemini_model(api_key: str):
    genai.configure(api_key=api_key)
    model_name = "models/gemini-3.6-flash"
    log.info("Using requested Gemini model %s", model_name)
    return genai.GenerativeModel(model_name)

# ─── WebSocket: Dashboard ────────────────────────────────────────────────────
@app.websocket("/ws")
async def dashboard_ws(websocket: WebSocket):
    global active_rtsp_client
    await websocket.accept()
    session = Session()
    mapper = TerrainMapper()

    params = websocket.query_params
    esp_url = params.get("esp", "")

    log.info(f"Dashboard connected. ESP: {esp_url}")
    await websocket.send_json({"type": "status", "message": f"Backend ready. ESP target: {esp_url}"})

    # Connect to ESP32, HC-05 Bluetooth serial transport, or local laptop camera if URL provided
    if esp_url:
        if esp_url.startswith("localcam://"):
            camera_index_text = esp_url.replace("localcam://", "", 1) or "0"
            try:
                camera_index = int(camera_index_text)
            except ValueError:
                camera_index = 0
            session.esp_client = LocalCameraClient(camera_index=camera_index)
            target_name = f"local laptop camera #{camera_index}"
        elif esp_url.startswith("bluetooth://"):
            port = esp_url.replace("bluetooth://", "", 1) or "/dev/rfcomm0"
            session.esp_client = BluetoothClient(port=port)
            target_name = f"HC-05 Bluetooth on {port}"
        elif esp_url.startswith("rtsp://"):
            session.esp_client = RTSPCameraClient(esp_url)
            active_rtsp_client = session.esp_client
            target_name = "RTSP phone camera"
        else:
            session.esp_client = ESP32Client(esp_url)
            target_name = "ESP32"
        try:
            connected = await session.esp_client.connect()
            if connected:
                await websocket.send_json({"type": "status", "message": f"Connected to {target_name}."})
            else:
                await websocket.send_json({"type": "status", "message": f"Failed to connect to {target_name}. Check that the phone stream is running, the URL starts with rtsp://, and both devices share the same Wi-Fi."})
        except Exception as e:
            await websocket.send_json({"type": "status", "message": f"Connection failed: {target_name}. {e or 'Timed out after 12 seconds.'}"})

    async def ai_loop():
        """Background task: periodically grab a frame and run Gemini on it."""
        while True:
            await asyncio.sleep(0.5)
            if not session.ai_enabled or not session.esp_client:
                continue
            now = time.time()
            if now - session.last_ai_scan < session.ai_interval:
                continue
            session.last_ai_scan = now

            frame = await session.esp_client.get_frame()
            if frame is None:
                continue

            result = await analyze_frame(session.model, frame)
            if result and result.get("_error"):
                session.ai_enabled = False
                await websocket.send_json({
                    "type": "ai_error",
                    "message": f"Gemini analysis failed: {result['_error']}",
                })
                continue
            if result:
                try:
                    if session.auto_enabled and session.esp_client:
                        rec = str(result.get("recommended_action", "stop")).lower()
                        cmd = ACTION_TO_COMMAND.get(rec, "STOP")
                        auto_speed = max(60, int(session.speed * 0.55)) if rec == "slow_down" else session.speed
                        await session.esp_client.send_command(cmd, auto_speed)
                        if session.map_enabled:
                            mapper.record_command(cmd, auto_speed)

                    await websocket.send_json({
                        "type": "ai_analysis",
                        **result
                    })
                    # If mapping is on, update map based on AI result
                    if session.map_enabled:
                        cells = mapper.update(result)
                        vehicle = mapper.vehicle_state()
                        path = mapper.path()
                        await websocket.send_json({
                            "type": "map_update",
                            "cells": cells,
                            "vehicle": vehicle,
                            "path": path,
                        })
                except Exception:
                    break

    ai_task = asyncio.create_task(ai_loop())

    try:
        async for raw in websocket.iter_text():
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            mtype = msg.get("type")

            if mtype == "cmd":
                cmd = msg.get("command", "STOP")
                spd = msg.get("speed", session.speed)
                session.speed = spd

                if cmd == "AUTO":
                    session.auto_enabled = True
                    if not session.ai_enabled:
                        session.ai_enabled = True
                        await websocket.send_json({"type": "status", "message": "AI enabled for auto-explore."})
                    await websocket.send_json({"type": "status", "message": "Auto-explore enabled."})
                    continue

                if cmd == "MANUAL":
                    session.auto_enabled = False
                    await websocket.send_json({"type": "status", "message": "Manual mode enabled."})
                    continue

                if session.auto_enabled:
                    session.auto_enabled = False
                    await websocket.send_json({"type": "status", "message": "Auto-explore disabled by manual command."})

                log.info(f"CMD: {cmd} @ {spd}")
                if session.esp_client:
                    await session.esp_client.send_command(cmd, spd)
                if session.map_enabled:
                    mapper.record_command(cmd, spd)

            elif mtype == "ai_toggle":
                session.ai_enabled = msg.get("enabled", False)
                if not session.ai_enabled and session.auto_enabled:
                    session.auto_enabled = False
                    await websocket.send_json({"type": "status", "message": "Auto-explore disabled because AI was turned off."})
                new_key = msg.get("key", "")
                if new_key and new_key != session.gemini_key:
                    try:
                        session.model = create_gemini_model(new_key)
                        session.gemini_key = new_key
                        await websocket.send_json({"type": "status", "message": "Gemini API key accepted and model selected."})
                    except Exception as exc:
                        session.model = None
                        session.gemini_key = None
                        session.ai_enabled = False
                        await websocket.send_json({"type": "ai_error", "message": f"Gemini setup failed: {exc}"})
                        continue
                if session.ai_enabled and not session.model:
                    await websocket.send_json({"type": "status", "message": "Enter a Gemini API key to analyze the live feed."})
                    continue
                await websocket.send_json({"type": "status", "message": f"AI {'enabled' if session.ai_enabled else 'disabled'}."})

            elif mtype == "map_toggle":
                session.map_enabled = msg.get("enabled", False)
                if session.map_enabled:
                    mapper.start_session()
                await websocket.send_json({"type": "status", "message": f"Mapping {'started' if session.map_enabled else 'stopped'}."})

            elif mtype == "save_map":
                name = msg.get("name", f"map_{int(time.time())}")
                cells = mapper.all_cells()
                map_id = db.save_map(name, cells, mapper.vehicle_state())
                await websocket.send_json({
                    "type": "map_saved",
                    "name": name,
                    "id": map_id,
                    "cells": len(cells),
                })

    except WebSocketDisconnect:
        log.info("Dashboard disconnected.")
    finally:
        ai_task.cancel()
        if session.esp_client:
            await session.esp_client.disconnect()
        if active_rtsp_client is session.esp_client:
            active_rtsp_client = None

@app.get("/camera/stream")
async def camera_stream():
    async def frames():
        while active_rtsp_client is not None and active_rtsp_client.is_connected:
            frame = await active_rtsp_client.get_frame()
            if frame is None:
                await asyncio.sleep(0.1)
                continue
            yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n"

    if active_rtsp_client is None or not active_rtsp_client.is_connected:
        raise HTTPException(status_code=404, detail="No RTSP camera is connected.")
    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.post("/maps/upload-video")
async def upload_video_memory(file: UploadFile = File(...), name: str = Form("video_memory")):
    if not file.filename:
        raise HTTPException(status_code=400, detail="A video file is required.")

    safe_name = (name or file.filename).strip() or "video_memory"
    safe_name = ''.join(ch if ch.isalnum() or ch in "._- " else "_" for ch in safe_name)
    file_ext = Path(file.filename).suffix or ".mp4"
    saved_path = VIDEO_MEMORY_DIR / f"{safe_name}{file_ext}"

    counter = 1
    while saved_path.exists():
        saved_path = VIDEO_MEMORY_DIR / f"{safe_name}_{counter}{file_ext}"
        counter += 1

    try:
        contents = await file.read()
        saved_path.write_bytes(contents)
        saved_id = db.save_video_memory(safe_name, str(saved_path))
        return {
            "status": "uploaded",
            "id": saved_id,
            "name": safe_name,
            "source_type": "video",
            "file_path": str(saved_path),
            "message": "Video was stored in UGV memory as a map source.",
        }
    except Exception as exc:
        log.exception("Failed to save uploaded video memory")
        raise HTTPException(status_code=500, detail=f"Unable to save uploaded video: {exc}") from exc

@app.post("/maps/analyze-video")
async def analyze_uploaded_video(file: UploadFile = File(...), name: str = Form("video_map"), gemini_key: str = Form("")):
    if not file.filename:
        raise HTTPException(status_code=400, detail="A video file is required.")
    if not gemini_key.strip():
        raise HTTPException(status_code=400, detail="A Gemini API key is required for prototype video analysis.")
    safe_name = ''.join(ch if ch.isalnum() or ch in "._- " else "_" for ch in (name or file.filename).strip()) or "video_map"
    file_ext = Path(file.filename).suffix or ".mp4"
    saved_path = VIDEO_MEMORY_DIR / f"{safe_name}_{uuid.uuid4().hex[:8]}{file_ext}"
    try:
        saved_path.write_bytes(await file.read())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to save uploaded video: {exc}") from exc
    job_id = uuid.uuid4().hex
    video_jobs[job_id] = {'status': 'queued', 'progress': 0, 'processed_frames': 0, 'total_frames': 0}
    asyncio.create_task(process_video_job(job_id, saved_path, safe_name, gemini_key.strip()))
    return {'job_id': job_id, 'name': safe_name, 'status': 'queued'}

@app.post("/maps/{map_id}/analyze-video")
async def analyze_saved_video(map_id: int, gemini_key: str = Form("")):
    if not gemini_key.strip():
        raise HTTPException(status_code=400, detail="A Gemini API key is required for prototype video analysis.")
    saved_map = db.get_map(map_id)
    if saved_map is None or saved_map.get("source_type") != "video":
        raise HTTPException(status_code=404, detail="Saved video not found")
    video_path = Path(saved_map["file_path"])
    if not video_path.is_file():
        raise HTTPException(status_code=404, detail="Saved video file is missing from the server")
    job_id = uuid.uuid4().hex
    video_jobs[job_id] = {'status': 'queued', 'progress': 0, 'processed_frames': 0, 'total_frames': 0}
    asyncio.create_task(process_video_job(job_id, video_path, saved_map["name"], gemini_key.strip()))
    return {'job_id': job_id, 'name': saved_map["name"], 'status': 'queued'}

@app.get("/maps/video-jobs/{job_id}")
async def video_job_status(job_id: str):
    job = video_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Video analysis job not found")
    return {'job_id': job_id, **job}

@app.post("/maps/video-jobs/{job_id}/cancel")
async def cancel_video_job(job_id: str):
    job = video_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Video analysis job not found")
    if job.get('status') in {'completed', 'failed', 'cancelled'}:
        return {'job_id': job_id, **job}
    job['cancel_requested'] = True
    job['status'] = 'cancelling'
    return {'job_id': job_id, **job}

@app.get("/bluetooth/devices")
async def list_bluetooth_devices():
    if list_ports is None:
        raise HTTPException(status_code=503, detail="pyserial is not installed on the backend.")

    devices = []
    for port in list_ports.comports():
        description = port.description or "Serial Bluetooth device"
        identity = f"{port.device} {description} {port.hwid or ''}".lower()
        if any(term in identity for term in ("bluetooth", "hc-05", "hc05", "rfcomm", "usb serial", "usb-serial")):
            devices.append({
                "port": port.device,
                "name": port.description if port.description and port.description.lower() != "n/a" else port.device,
                "description": description,
                "hardware_id": port.hwid or "",
            })

    return {"devices": devices, "message": "Pair the HC-05 in macOS first if no device is listed."}

@app.get("/maps")
async def list_maps():
    return db.list_maps()

@app.get("/maps/{map_id}")
async def get_map(map_id: int):
    result = db.get_map(map_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Map not found")
    return result

@app.delete("/maps/{map_id}")
async def delete_map(map_id: int):
    db.delete_map(map_id)
    return {"status": "deleted"}

@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
