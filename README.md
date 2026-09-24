# TRINETRA

> Real-time Unmanned Ground Vehicle control with ESP32-CAM live video, Gemini AI terrain analysis, and autonomous 2D mapping.

---

## Project Structure

```
UGV/
├── esp32_firmware/
│   └── UGV_Firmware/
│       └── UGV_Firmware.ino   ← Flash to ESP32-CAM
├── backend/
│   ├── main.py                ← FastAPI WebSocket server
│   ├── database.py            ← SQLite map persistence
│   ├── mapper.py              ← Dead-reckoning terrain mapper
│   ├── esp32_client.py        ← ESP32 async client
│   └── requirements.txt
└── frontend/
    └── src/
        ├── App.jsx             ← Main dashboard app
        ├── components/         ← All UI components
        └── index.css           ← Premium dark theme styles
```

---

## Getting Started

### 1. Flash the ESP32

1. Open `esp32_firmware/UGV_Firmware/UGV_Firmware.ino` in Arduino IDE.
2. Install required libraries:
   - `ArduinoJson` by Benoit Blanchon
   - `ArduinoWebsockets` by Gil Maimon
   - ESP32 board support (Espressif)
3. Edit `WIFI_SSID` and `WIFI_PASS` with your network credentials.
4. Select board: **AI Thinker ESP32-CAM**
5. Flash and open Serial Monitor at 115200 baud. Note the IP address printed.

### 2. Run the Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
# Server starts on http://localhost:8000
```

### 3. Run the Frontend

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:5173
```

### 4. Connect via Dashboard

1. Open http://localhost:5173 in your browser.
2. Enter the **ESP32 IP address** (shown in Serial Monitor).
3. Enter your **Gemini API key** (get one at https://makersuite.google.com/app/apikey).
4. Click **Connect**.
5. Toggle **Enable AI** to start real-time terrain analysis.
6. Toggle **Start Mapping** to begin building the terrain map.

---

## Wiring

| ESP32-CAM Pin | L298N Pin | Function |
|:---:|:---:|:---|
| GPIO 12 | IN1 | Motor A direction |
| GPIO 13 | IN2 | Motor A direction |
| GPIO 15 | IN3 | Motor B direction |
| GPIO 14 | IN4 | Motor B direction |
| GPIO 2  | ENA | Motor A PWM speed |
| GPIO 4  | ENB | Motor B PWM speed |

> **Note:** Left motors → Motor A (IN1, IN2). Right motors → Motor B (IN3, IN4).

---

## Architecture

```
Browser Dashboard  ←─── WebSocket ───→  Python Backend
                                              │
                                     ┌────────┼────────┐
                                     ▼        ▼        ▼
                                 ESP32-CAM  Gemini   SQLite
                                 (stream +   API     (maps)
                                  motors)
```

- **Dashboard → Backend**: Motor commands (FORWARD/BACKWARD/LEFT/RIGHT/STOP), AI toggle, map save requests.
- **Backend → ESP32**: Forwarded motor commands via WebSocket; JPEG snapshots fetched for AI via HTTP `/capture`.
- **Backend → Gemini**: Frame + prompt → terrain type, obstacle detection, confidence.
- **Backend → Dashboard**: AI analysis results, map cell updates, vehicle position, saved map confirmations.

---

## Controls

| Key | Action |
|:---:|:---|
| W / ↑ | Forward |
| S / ↓ | Backward |
| A / ← | Turn Left |
| D / → | Turn Right |
| Space | Stop |
