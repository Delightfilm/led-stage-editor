import { buildManagementFirmwareBundle } from './managementProjectFirmware.js'

const cppString = (value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')

const buildFrameArrays = (rx) => {
  const lines = []
  rx.parts.forEach((part, index) => {
    const frames = part.frames?.length ? part.frames : [{ t: 0, on: false }]
    lines.push(`const uint16_t PART_${index}_COUNT = ${frames.length};`)
    lines.push(`const uint32_t PART_${index}_T[PART_${index}_COUNT] = { ${frames.map((f) => Math.max(0, Math.round(Number(f.t) || 0))).join(', ')} };`)
    lines.push(`const uint8_t PART_${index}_V[PART_${index}_COUNT] = { ${frames.map((f) => f.on ? 1 : 0).join(', ')} };`)
    lines.push('')
  })
  return lines.join('\n')
}

const buildReceiverSketch = (rx) => {
  const endMs = Math.max(0, ...rx.parts.map((part) => Math.round(Number(part.endMs) || 0)))
  const relayPins = rx.parts.map((part) => Number.isFinite(Number(part.pin)) ? Number(part.pin) : 4)
  const arrays = buildFrameArrays(rx)
  const applyParts = rx.parts.map((_, index) => [
    `  while (partIndex[${index}] + 1 < PART_${index}_COUNT && elapsedMs >= PART_${index}_T[partIndex[${index}] + 1]) partIndex[${index}]++;`,
    `  writeRelay(${relayPins[index]}, PART_${index}_V[partIndex[${index}]] != 0);`,
  ].join('\n')).join('\n')
  const resetParts = rx.parts.map((_, index) => `  partIndex[${index}] = 0;`).join('\n')
  const offParts = relayPins.map((pin) => `  writeRelay(${pin}, false);`).join('\n')
  const pinModes = relayPins.map((pin) => `  pinMode(${pin}, OUTPUT); writeRelay(${pin}, false);`).join('\n')

  return `/*
 * EL Stage ESP32 RX${rx.receiverId} — ESP-NOW experimental receiver
 * Costume: ${cppString(rx.costumeName)}
 * Generated from the same Management timeline as the proven nRF24 A/B firmware.
 * IMPORTANT: keep the nRF24 firmware as the fallback until ESP-NOW field tests pass.
 * Relay outputs are ACTIVE HIGH by default.
 */
#include <WiFi.h>
#include <esp_now.h>
#include <esp_arduino_version.h>

#define RECEIVER_ID ${rx.receiverId}
#define SHOW_HASH ${rx.showHash >>> 0}UL
#define END_MS ${endMs}UL
#define RELAY_ACTIVE_HIGH 1

const uint8_t CMD_PING = 1;
const uint8_t CMD_START = 2;
const uint8_t CMD_SHOW_STATE = 3;
const uint8_t CMD_PREVIEW_SEEK = 4;
const uint8_t CMD_PREVIEW_PLAY = 5;
const uint8_t CMD_PREVIEW_PAUSE = 6;
const uint8_t CMD_PREVIEW_STOP = 7;
const uint8_t CMD_ACK = 100;

struct __attribute__((packed)) StagePacket {
  uint8_t type;
  uint8_t targetId;
  uint16_t seq;
  uint32_t timelineMs;
  uint32_t leadMs;
  uint32_t showHash;
};

${arrays}
uint16_t partIndex[${Math.max(1, rx.parts.length)}] = {0};
bool playing = false;
bool previewPlaying = false;
uint16_t activeSeq = 0;
uint32_t localStartMs = 0;
uint32_t previewStartMs = 0;
uint32_t previewOffsetMs = 0;
uint8_t masterMac[6] = {0};
bool masterKnown = false;

void writeRelay(uint8_t pin, bool on) {
  digitalWrite(pin, RELAY_ACTIVE_HIGH ? (on ? HIGH : LOW) : (on ? LOW : HIGH));
}

void allOff() {
${offParts}
}

void resetTimeline() {
${resetParts}
  allOff();
}

void applyTimeline(uint32_t elapsedMs) {
${applyParts}
}

void seekTimeline(uint32_t elapsedMs) {
  resetTimeline();
  if (elapsedMs >= END_MS) return;
${rx.parts.map((_, index) => `  while (partIndex[${index}] + 1 < PART_${index}_COUNT && elapsedMs >= PART_${index}_T[partIndex[${index}] + 1]) partIndex[${index}]++;`).join('\n')}
  applyTimeline(elapsedMs);
}

void ensurePeer(const uint8_t* mac) {
  if (!mac) return;
  if (esp_now_is_peer_exist(mac)) return;
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, mac, 6);
  peer.channel = 0;
  peer.encrypt = false;
  esp_now_add_peer(&peer);
}

void sendAck(const uint8_t* mac) {
  ensurePeer(mac);
  StagePacket ack = {};
  ack.type = CMD_ACK;
  ack.targetId = RECEIVER_ID;
  ack.seq = activeSeq;
  ack.timelineMs = playing ? (uint32_t)(millis() - localStartMs) : previewOffsetMs;
  ack.showHash = SHOW_HASH;
  esp_now_send(mac, reinterpret_cast<const uint8_t*>(&ack), sizeof(ack));
}

void handlePacket(const uint8_t* sourceMac, const StagePacket& p) {
  if (p.targetId != 0 && p.targetId != RECEIVER_ID) return;
  memcpy(masterMac, sourceMac, 6);
  masterKnown = true;

  if (p.type == CMD_PING) {
    sendAck(sourceMac);
    return;
  }

  if (p.type == CMD_START) {
    if (playing && p.seq == activeSeq) return;
    activeSeq = p.seq;
    previewPlaying = false;
    playing = true;
    const uint32_t now = millis();
    localStartMs = now + p.leadMs - p.timelineMs;
    if (p.timelineMs > 0) seekTimeline(p.timelineMs); else resetTimeline();
    sendAck(sourceMac);
    return;
  }

  if (p.type == CMD_SHOW_STATE) {
    if (!playing && p.timelineMs < END_MS) {
      activeSeq = p.seq;
      playing = true;
      localStartMs = millis() - p.timelineMs;
      seekTimeline(p.timelineMs);
    }
    return;
  }

  if (playing) return;

  if (p.type == CMD_PREVIEW_SEEK || p.type == CMD_PREVIEW_PLAY) {
    previewOffsetMs = p.timelineMs;
    seekTimeline(previewOffsetMs);
    previewPlaying = p.type == CMD_PREVIEW_PLAY;
    previewStartMs = millis() - previewOffsetMs;
    sendAck(sourceMac);
    return;
  }
  if (p.type == CMD_PREVIEW_PAUSE) {
    if (previewPlaying) previewOffsetMs = millis() - previewStartMs;
    previewPlaying = false;
    sendAck(sourceMac);
    return;
  }
  if (p.type == CMD_PREVIEW_STOP) {
    previewPlaying = false;
    previewOffsetMs = 0;
    resetTimeline();
    sendAck(sourceMac);
  }
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onEspNowReceive(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  if (!info || len != sizeof(StagePacket)) return;
  StagePacket p;
  memcpy(&p, data, sizeof(p));
  handlePacket(info->src_addr, p);
}
#else
void onEspNowReceive(const uint8_t* mac, const uint8_t* data, int len) {
  if (!mac || len != sizeof(StagePacket)) return;
  StagePacket p;
  memcpy(&p, data, sizeof(p));
  handlePacket(mac, p);
}
#endif

void setup() {
  Serial.begin(115200);
${pinModes}
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP_NOW_INIT_FAIL");
    return;
  }
  esp_now_register_recv_cb(onEspNowReceive);
  Serial.print("ESP32_RX_READY id=${rx.receiverId} mac=");
  Serial.println(WiFi.macAddress());
}

void loop() {
  if (playing) {
    if ((int32_t)(millis() - localStartMs) >= 0) {
      const uint32_t elapsed = millis() - localStartMs;
      if (elapsed >= END_MS) {
        playing = false;
        resetTimeline();
      } else {
        applyTimeline(elapsed);
      }
    }
  } else if (previewPlaying) {
    const uint32_t elapsed = millis() - previewStartMs;
    previewOffsetMs = elapsed;
    if (elapsed >= END_MS) {
      previewPlaying = false;
      resetTimeline();
    } else {
      applyTimeline(elapsed);
    }
  }
  delay(1);
}
`
}

const buildMasterSketch = ({ receiverCount, showDurationMs, previewSafeLimitMs, receiverHashes }) => {
  const hashes = Array.from({ length: Math.max(1, receiverCount) }, (_, i) => `${(receiverHashes[i] || 0) >>> 0}UL`).join(', ')
  return `/*
 * EL Stage ESP32 MASTER — ESP-NOW experimental A/B controller
 * Keeps the existing Web Serial protocol: HELLO LSM-B1, PING, SET_DELAY,
 * SEEK, PREVIEW_PLAY/PAUSE/STOP, MODE_A, ARM_B and LIVE_START.
 * LCD: 1602 I2C, SDA=GPIO21, SCL=GPIO22, default address 0x27.
 * START rocker: GPIO27 -> GND (INPUT_PULLUP).
 * IMPORTANT: this is an additional ESP32 test path. Keep UNO+nRF24 as fallback.
 * Library required: LiquidCrystal_I2C.
 */
#include <WiFi.h>
#include <esp_now.h>
#include <esp_arduino_version.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

#define SERIAL_BAUD 115200
#define START_PIN 27
#define LCD_SDA 21
#define LCD_SCL 22
#define RECEIVER_COUNT ${Math.max(1, receiverCount)}
#define SHOW_DURATION_MS ${Math.max(0, Math.round(showDurationMs || 0))}UL
#define PREVIEW_SAFE_LIMIT_MS ${Math.max(0, Math.round(previewSafeLimitMs || 0))}UL
#define DEFAULT_START_LEAD_MS 80UL
#define MAX_START_LEAD_MS 10000UL
#define LINK_TIMEOUT_MS 1800UL
#define TELEMETRY_INTERVAL_MS 500UL

LiquidCrystal_I2C lcd(0x27, 16, 2);
const uint8_t BROADCAST_MAC[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};
const uint32_t EXPECTED_HASH[RECEIVER_COUNT] = { ${hashes} };

const uint8_t CMD_PING = 1;
const uint8_t CMD_START = 2;
const uint8_t CMD_SHOW_STATE = 3;
const uint8_t CMD_PREVIEW_SEEK = 4;
const uint8_t CMD_PREVIEW_PLAY = 5;
const uint8_t CMD_PREVIEW_PAUSE = 6;
const uint8_t CMD_PREVIEW_STOP = 7;
const uint8_t CMD_ACK = 100;

struct __attribute__((packed)) StagePacket {
  uint8_t type;
  uint8_t targetId;
  uint16_t seq;
  uint32_t timelineMs;
  uint32_t leadMs;
  uint32_t showHash;
};

uint32_t lastSeenMs[RECEIVER_COUNT] = {0};
uint32_t seenHash[RECEIVER_COUNT] = {0};
uint16_t cueSeq = 0;
uint32_t runtimeStartLeadMs = DEFAULT_START_LEAD_MS;
uint32_t armedOffsetMs = 0;
uint32_t showAnchorMs = 0;
uint32_t lastTelemetryMs = 0;
uint32_t lastShowStateMs = 0;
uint32_t lastPingMs = 0;
uint8_t pingIndex = 0;
bool pcHandshake = false;
bool bArmed = false;
bool showPlaying = false;
bool lastStart = false;
char serialLine[96] = {0};
uint8_t serialLineLen = 0;

char receiverState(uint8_t i) {
  if (!lastSeenMs[i] || millis() - lastSeenMs[i] > LINK_TIMEOUT_MS) return 'X';
  if (!seenHash[i]) return '?';
  if (seenHash[i] != EXPECTED_HASH[i]) return 'V';
  return 'O';
}

uint8_t readyCount() {
  uint8_t n = 0;
  for (uint8_t i = 0; i < RECEIVER_COUNT; i++) if (receiverState(i) == 'O') n++;
  return n;
}

void refreshLcd() {
  lcd.setCursor(0,0);
  lcd.print("ESP ");
  lcd.print(showPlaying ? "LIVE " : (bArmed ? "BARM " : "READY"));
  lcd.print("        ");
  lcd.setCursor(0,1);
  for (uint8_t i = 0; i < RECEIVER_COUNT && i < 8; i++) lcd.print(receiverState(i));
  lcd.print(" "); lcd.print(readyCount()); lcd.print("/"); lcd.print(RECEIVER_COUNT); lcd.print("   ");
}

void sendPacket(uint8_t type, uint8_t targetId, uint32_t timelineMs = 0, uint32_t leadMs = 0, uint8_t repeats = 1) {
  StagePacket p = {};
  p.type = type;
  p.targetId = targetId;
  p.seq = cueSeq;
  p.timelineMs = timelineMs;
  p.leadMs = leadMs;
  p.showHash = targetId >= 1 && targetId <= RECEIVER_COUNT ? EXPECTED_HASH[targetId - 1] : 0;
  for (uint8_t i = 0; i < repeats; i++) {
    esp_now_send(BROADCAST_MAC, reinterpret_cast<const uint8_t*>(&p), sizeof(p));
    if (repeats > 1) delay(1);
  }
}

void printRxMonitor() {
  const uint32_t now = millis();
  Serial.print("RXMON ");
  for (uint8_t i = 0; i < RECEIVER_COUNT; i++) {
    if (i) Serial.print(',');
    Serial.print(i + 1); Serial.print(':');
    Serial.print(receiverState(i)); Serial.print(":0:");
    Serial.print(lastSeenMs[i] ? now - lastSeenMs[i] : 0xFFFFFFFFUL); Serial.print(":0");
  }
  Serial.println();
}

void handleAck(const StagePacket& p) {
  if (p.type != CMD_ACK || p.targetId < 1 || p.targetId > RECEIVER_COUNT) return;
  const uint8_t i = p.targetId - 1;
  lastSeenMs[i] = millis();
  seenHash[i] = p.showHash;
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onEspNowReceive(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  (void)info;
  if (len != sizeof(StagePacket)) return;
  StagePacket p; memcpy(&p, data, sizeof(p)); handleAck(p);
}
#else
void onEspNowReceive(const uint8_t* mac, const uint8_t* data, int len) {
  (void)mac;
  if (len != sizeof(StagePacket)) return;
  StagePacket p; memcpy(&p, data, sizeof(p)); handleAck(p);
}
#endif

uint32_t clampPreview(uint32_t value) {
  if (!PREVIEW_SAFE_LIMIT_MS) return 0;
  return value >= PREVIEW_SAFE_LIMIT_MS ? PREVIEW_SAFE_LIMIT_MS - 1 : value;
}

void startLive(uint32_t offsetMs) {
  if (showPlaying) return;
  if (SHOW_DURATION_MS && offsetMs >= SHOW_DURATION_MS) offsetMs = SHOW_DURATION_MS - 1;
  cueSeq++;
  showPlaying = true;
  bArmed = false;
  showAnchorMs = millis() + runtimeStartLeadMs - offsetMs;
  sendPacket(CMD_START, 0, offsetMs, runtimeStartLeadMs, 5);
  lastShowStateMs = 0;
  if (pcHandshake) { Serial.print("LIVE_STARTED "); Serial.println(offsetMs); }
}

void finishLive() {
  showPlaying = false;
  showAnchorMs = 0;
  bArmed = false;
  if (pcHandshake) Serial.println("LIVE_FINISHED");
}

void requestStart() {
  if (showPlaying) return;
  startLive((pcHandshake && bArmed) ? armedOffsetMs : 0);
}

uint32_t parseUInt(const char* p) {
  while (*p == ' ') p++;
  return (uint32_t)strtoul(p, nullptr, 10);
}

void printStatus() {
  Serial.print("STATUS mode=");
  Serial.print(bArmed ? "B_ARMED" : (pcHandshake ? "B_CONNECTED" : "A"));
  Serial.print(" live="); Serial.print(showPlaying ? 1 : 0);
  Serial.print(" delay="); Serial.print(runtimeStartLeadMs);
  Serial.print(" offset="); Serial.print(armedOffsetMs);
  Serial.print(" ready="); Serial.print(readyCount()); Serial.print('/'); Serial.println(RECEIVER_COUNT);
}

void processSerialLine(char* line) {
  if (!line[0]) return;
  if (strcmp(line, "HELLO LSM-B1") == 0 || strcmp(line, "HELLO") == 0) {
    pcHandshake = true;
    Serial.println("LSM_READY LSM-B1 ESP_NOW_AB");
    printStatus(); return;
  }
  if (strcmp(line, "PING") == 0) { pcHandshake = true; Serial.print("PONG "); Serial.println(millis()); printRxMonitor(); return; }
  if (strcmp(line, "STATUS") == 0) { printStatus(); return; }
  if (strcmp(line, "MODE_A") == 0) { bArmed = false; armedOffsetMs = 0; Serial.println("MODE_A_READY"); return; }
  if (strncmp(line, "SET_DELAY ", 10) == 0) {
    runtimeStartLeadMs = min(parseUInt(line + 10), (uint32_t)MAX_START_LEAD_MS);
    pcHandshake = true; Serial.print("DELAY_OK "); Serial.println(runtimeStartLeadMs); return;
  }
  if (strncmp(line, "SEEK ", 5) == 0) {
    uint32_t t = clampPreview(parseUInt(line + 5)); sendPacket(CMD_PREVIEW_SEEK, 0, t, 0, 2);
    Serial.print("SEEK_OK "); Serial.println(t); return;
  }
  if (strncmp(line, "PREVIEW_PLAY ", 13) == 0) {
    uint32_t t = clampPreview(parseUInt(line + 13)); sendPacket(CMD_PREVIEW_PLAY, 0, t, 0, 2);
    Serial.print("PREVIEW_PLAY_OK "); Serial.println(t); return;
  }
  if (strcmp(line, "PREVIEW_PAUSE") == 0) { sendPacket(CMD_PREVIEW_PAUSE, 0, 0, 0, 2); Serial.println("PREVIEW_PAUSE_OK"); return; }
  if (strcmp(line, "PREVIEW_STOP") == 0) { sendPacket(CMD_PREVIEW_STOP, 0, 0, 0, 2); bArmed = false; Serial.println("PREVIEW_STOP_OK"); return; }
  if (strncmp(line, "ARM_B ", 6) == 0) {
    armedOffsetMs = clampPreview(parseUInt(line + 6)); bArmed = true; pcHandshake = true;
    sendPacket(CMD_PREVIEW_SEEK, 0, armedOffsetMs, 0, 2);
    Serial.print("ARM_OK "); Serial.print(armedOffsetMs); Serial.print(' '); Serial.println(runtimeStartLeadMs); return;
  }
  if (strncmp(line, "LIVE_START ", 11) == 0) { pcHandshake = true; startLive(parseUInt(line + 11)); return; }
}

void pollSerial() {
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialLineLen) { serialLine[serialLineLen] = 0; processSerialLine(serialLine); serialLineLen = 0; }
    } else if (serialLineLen < sizeof(serialLine) - 1) serialLine[serialLineLen++] = c;
  }
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  pinMode(START_PIN, INPUT_PULLUP);
  Wire.begin(LCD_SDA, LCD_SCL);
  lcd.init(); lcd.backlight(); lcd.clear();
  WiFi.mode(WIFI_STA); WiFi.disconnect();
  if (esp_now_init() != ESP_OK) { lcd.print("ESP-NOW FAIL"); Serial.println("ESP_NOW_INIT_FAIL"); return; }
  esp_now_register_recv_cb(onEspNowReceive);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST_MAC, 6); peer.channel = 0; peer.encrypt = false;
  esp_now_add_peer(&peer);
  Serial.print("ESP32_MASTER_READY mac="); Serial.println(WiFi.macAddress());
  refreshLcd();
}

void loop() {
  pollSerial();
  const uint32_t now = millis();
  const bool startPressed = digitalRead(START_PIN) == LOW;
  if (startPressed && !lastStart) requestStart();
  lastStart = startPressed;

  if (now - lastPingMs >= 180) {
    lastPingMs = now;
    sendPacket(CMD_PING, pingIndex + 1);
    pingIndex = (pingIndex + 1) % RECEIVER_COUNT;
  }

  if (showPlaying) {
    if ((int32_t)(now - showAnchorMs) >= 0) {
      const uint32_t elapsed = now - showAnchorMs;
      if (elapsed >= SHOW_DURATION_MS) finishLive();
      else if (now - lastShowStateMs >= 500) { lastShowStateMs = now; sendPacket(CMD_SHOW_STATE, 0, elapsed, 0, 1); }
    }
  }

  if (pcHandshake && now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) { lastTelemetryMs = now; printRxMonitor(); }
  static uint32_t lastLcdMs = 0;
  if (now - lastLcdMs >= 250) { lastLcdMs = now; refreshLcd(); }
  delay(1);
}
`
}

export function buildManagementEsp32FirmwareBundle({ costumes = [], blocks = [] } = {}) {
  const source = buildManagementFirmwareBundle({ costumes, blocks })
  const receivers = source.receivers.map((rx) => ({
    ...rx,
    filename: `ESP32_RX${rx.receiverId}_ESP_NOW.ino`,
    code: buildReceiverSketch(rx),
  }))
  return {
    master: {
      filename: 'ESP32_Master_ESP_NOW_AB.ino',
      code: buildMasterSketch(source),
    },
    receivers,
    receiverCount: source.receiverCount,
    showDurationMs: source.showDurationMs,
    previewSafeLimitMs: source.previewSafeLimitMs,
    receiverHashes: source.receiverHashes,
  }
}
