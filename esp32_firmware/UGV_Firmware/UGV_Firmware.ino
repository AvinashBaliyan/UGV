/*
 * UGV_Firmware.ino
 * ─────────────────────────────────────────────────────────
 * Hardware:  ESP32-CAM (AI-Thinker), L298N Motor Driver, 4x BO motors
 *
 * Features:
 *  1. Connects to WiFi
 *  2. Starts MJPEG camera stream server on port 80
 *     - /stream  → MJPEG stream
 *     - /capture → single JPEG snapshot (used by AI backend)
 *  3. Opens WebSocket server on port 81
 *     - Receives JSON motor commands from the Python backend
 *     - {"cmd": "FORWARD", "speed": 180}
 *
 * ─── Pin Wiring ───────────────────────────────────────────
 *  ESP32-CAM Pin  │  L298N Pin
 *  ───────────────┼────────────
 *  GPIO 12        │  IN1 (Motor A)
 *  GPIO 13        │  IN2 (Motor A)
 *  GPIO 15        │  IN3 (Motor B)
 *  GPIO 14        │  IN4 (Motor B)
 *  GPIO 2         │  ENA (PWM A) — optional, tie to 5V for full speed
 *  GPIO 4         │  ENB (PWM B) — optional
 *
 *  IMPORTANT: ESP32-CAM uses GPIO 4 for the onboard LED.
 *  If using ENB on GPIO 4, disable the LED or use a different pin.
 *  ────────────────────────────────────────────────────────
 *
 * Library dependencies (install via Arduino Library Manager):
 *  - ArduinoJson         (Benoit Blanchon)
 *  - ArduinoWebsockets   (Gil Maimon)
 *  - ESP32 Arduino Core  (Espressif)
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoWebsockets.h>
#include <ArduinoJson.h>

using namespace websockets;

// ── WiFi Credentials ───────────────────────────────────────
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// ── Camera Model (AI-Thinker ESP32-CAM) ───────────────────
#define CAMERA_MODEL_AI_THINKER
#include "camera_pins.h"   // available in ESP32 Arduino core examples

// ── Motor Driver Pins ─────────────────────────────────────
// Motor A = Left wheels
#define IN1 12
#define IN2 13
#define ENA  2   // PWM pin for Motor A speed

// Motor B = Right wheels
#define IN3 15
#define IN4 14
#define ENB  4   // PWM pin for Motor B speed (avoid if using flash LED)

// PWM channels (ESP32 LEDC)
#define PWM_CH_A   0
#define PWM_CH_B   1
#define PWM_FREQ   1000   // 1 kHz
#define PWM_RES    8      // 8-bit (0-255)

// ── Global State ──────────────────────────────────────────
WebServer httpServer(80);
WebsocketsServer wsServer;
WebsocketsClient wsClient;
bool wsClientConnected = false;

int currentSpeed = 180;

// ─────────────────────────────────────────────────────────
// Motor Control Functions
// ─────────────────────────────────────────────────────────
void setMotors(int leftDir, int rightDir, int speed) {
  // Left Motor A
  digitalWrite(IN1, leftDir == 1 ? HIGH : LOW);
  digitalWrite(IN2, leftDir == 1 ? LOW : HIGH);
  // Right Motor B
  digitalWrite(IN3, rightDir == 1 ? HIGH : LOW);
  digitalWrite(IN4, rightDir == 1 ? LOW : HIGH);
  // Set PWM speed
  ledcWrite(PWM_CH_A, (leftDir == 0 && rightDir == 0) ? 0 : speed);
  ledcWrite(PWM_CH_B, (leftDir == 0 && rightDir == 0) ? 0 : speed);
}

void motorStop()    { setMotors(0, 0, 0); }
void motorForward(int spd) { setMotors(1, 1, spd); }
void motorBackward(int spd){ setMotors(-1, -1, spd); }
void motorLeft(int spd)    { setMotors(-1, 1, spd); }  // spin left
void motorRight(int spd)   { setMotors(1, -1, spd); }  // spin right

// ─────────────────────────────────────────────────────────
// Execute command string
// ─────────────────────────────────────────────────────────
void executeCommand(const String& cmd, int speed) {
  if      (cmd == "FORWARD")  motorForward(speed);
  else if (cmd == "BACKWARD") motorBackward(speed);
  else if (cmd == "LEFT")     motorLeft(speed);
  else if (cmd == "RIGHT")    motorRight(speed);
  else                        motorStop();
}

// ─────────────────────────────────────────────────────────
// WebSocket Event Handler
// ─────────────────────────────────────────────────────────
void onWsMessage(WebsocketsClient& client, WebsocketsMessage msg) {
  if (!msg.isText()) return;

  StaticJsonDocument<128> doc;
  DeserializationError err = deserializeJson(doc, msg.data());
  if (err) {
    Serial.printf("[WS] JSON parse error: %s\n", err.c_str());
    return;
  }

  const char* cmd = doc["cmd"] | "STOP";
  int speed = doc["speed"] | 180;
  currentSpeed = speed;

  Serial.printf("[WS] CMD: %s @ speed %d\n", cmd, speed);
  executeCommand(String(cmd), speed);

  // Echo back status
  client.send("{\"status\":\"ok\"}");
}

// ─────────────────────────────────────────────────────────
// HTTP: MJPEG Stream Handler
// ─────────────────────────────────────────────────────────
void handleStream() {
  WiFiClient client = httpServer.client();
  String boundary = "frame";

  httpServer.sendContent(
    "HTTP/1.1 200 OK\r\n"
    "Content-Type: multipart/x-mixed-replace;boundary=frame\r\n"
    "Access-Control-Allow-Origin: *\r\n"
    "\r\n"
  );

  while (client.connected()) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) { delay(10); continue; }

    String header = "--frame\r\nContent-Type: image/jpeg\r\n"
                    "Content-Length: " + String(fb->len) + "\r\n\r\n";
    client.print(header);
    client.write(fb->buf, fb->len);
    client.print("\r\n");
    esp_camera_fb_return(fb);

    delay(33);  // ~30 fps
  }
}

// ─────────────────────────────────────────────────────────
// HTTP: Single Snapshot for Gemini AI
// ─────────────────────────────────────────────────────────
void handleCapture() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    httpServer.send(503, "text/plain", "Camera capture failed");
    return;
  }
  httpServer.sendHeader("Access-Control-Allow-Origin", "*");
  httpServer.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

// ─────────────────────────────────────────────────────────
// Camera Initialization
// ─────────────────────────────────────────────────────────
bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    config.frame_size   = FRAMESIZE_VGA;  // 640x480
    config.jpeg_quality = 12;
    config.fb_count     = 2;
  } else {
    config.frame_size   = FRAMESIZE_QVGA; // 320x240
    config.jpeg_quality = 15;
    config.fb_count     = 1;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }

  // Improve image quality
  sensor_t* s = esp_camera_sensor_get();
  s->set_brightness(s, 1);
  s->set_contrast(s, 1);
  s->set_saturation(s, 0);
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  s->set_exposure_ctrl(s, 1);
  s->set_aec2(s, 1);
  s->set_gainceiling(s, (gainceiling_t)2);

  Serial.println("Camera initialized OK.");
  return true;
}

// ─────────────────────────────────────────────────────────
// setup()
// ─────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== UGV Firmware Booting ===");

  // Motor pins
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  ledcSetup(PWM_CH_A, PWM_FREQ, PWM_RES);
  ledcSetup(PWM_CH_B, PWM_FREQ, PWM_RES);
  ledcAttachPin(ENA, PWM_CH_A);
  ledcAttachPin(ENB, PWM_CH_B);
  motorStop();

  // Camera
  if (!initCamera()) {
    Serial.println("FATAL: Camera init failed. Halting.");
    while (true) delay(1000);
  }

  // WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to WiFi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500); Serial.print("."); attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nConnected! IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("Camera stream: http://%s/stream\n", WiFi.localIP().toString().c_str());
    Serial.printf("Snapshot URL:  http://%s/capture\n", WiFi.localIP().toString().c_str());
    Serial.printf("WebSocket:     ws://%s:81/ws\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\nWiFi connection failed!");
  }

  // HTTP routes
  httpServer.on("/stream",  HTTP_GET, handleStream);
  httpServer.on("/capture", HTTP_GET, handleCapture);
  httpServer.on("/health",  HTTP_GET, [](){
    httpServer.send(200, "application/json", "{\"status\":\"ok\"}");
  });
  httpServer.begin();
  Serial.println("HTTP server started on port 80.");

  // WebSocket server
  wsServer.listen(81);
  Serial.println("WebSocket server started on port 81.");
}

// ─────────────────────────────────────────────────────────
// loop()
// ─────────────────────────────────────────────────────────
void loop() {
  httpServer.handleClient();

  if (wsServer.poll()) {
    WebsocketsClient newClient = wsServer.accept();
    if (newClient.available()) {
      wsClient = newClient;
      wsClientConnected = true;
      wsClient.onMessage(onWsMessage);
      Serial.println("[WS] Client connected.");
    }
  }

  if (wsClientConnected && wsClient.available()) {
    wsClient.poll();
  }
}
