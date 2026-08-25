import { buildManagementFirmwareBundle } from './managementProjectFirmware.js'

const cppString = (value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
const hashHex = (value) => (Number(value) >>> 0).toString(16).padStart(8, '0').toUpperCase()

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

const buildReceiverSketch = (rx, previewSafeLimitMs) => {
  const endMs = Math.max(0, ...rx.parts.map((part) => Math.round(Number(part.endMs) || 0)))
  const safeLimitMs = Math.max(0, Math.round(Number(previewSafeLimitMs) || 0))
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
 * EL Stage ESP32 RX${rx.receiverId} — ESP-NOW v0.6.11 feature-parity receiver
 * Costume: ${cppString(rx.costumeName)}
 * State-machine parity target: proven nRF24 Management A/B receiver.
 * Transport only: RF24/SPI/ACK-payload -> ESP-NOW packets + explicit status ACK.
 * IMPORTANT: keep the nRF24 firmware as the fallback until ESP-NOW field tests pass.
 * Relay outputs are ACTIVE HIGH by default.
 */
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_arduino_version.h>

#define RECEIVER_ID ${rx.receiverId}
#define SHOW_HASH 0x${hashHex(rx.showHash)}UL
#define END_MS ${endMs}UL
#define PREVIEW_SAFE_LIMIT_MS ${safeLimitMs}UL
#define A_CLOCK_RESERVE_MS 100UL
#define RELAY_ACTIVE_HIGH 1
#define ESPNOW_CHANNEL 6
#define RX_QUEUE_SIZE 12

const uint8_t MAGIC = 0xA5;
const uint8_t FLAG_PLAYING = 0x01;
const uint8_t FLAG_A_CLOCK = 0x02;
const uint8_t CMD_PING = 1;
const uint8_t CMD_SYNC = 2;
const uint8_t CMD_START = 3;
const uint8_t CMD_STOP = 4;
const uint8_t CMD_SHOW_STATE = 5;
const uint8_t CMD_PREVIEW_SEEK = 6;
const uint8_t CMD_PREVIEW_PLAY = 7;
const uint8_t CMD_PREVIEW_PAUSE = 8;
const uint8_t CMD_PREVIEW_STOP = 9;
const uint8_t CMD_FORCE_STOP = 10;
const uint8_t CMD_A_SCHEDULE = 11;
const uint8_t CMD_ACK = 100;

struct __attribute__((packed)) StagePacket {
  uint8_t magic;
  uint8_t type;
  uint8_t targetId;
  uint8_t flags;
  uint16_t seq;
  uint32_t masterTimeMs;
  uint32_t showStartMasterMs;
  uint32_t showHash;
};
static_assert(sizeof(StagePacket) <= 250, "ESP-NOW packet too large");

struct RxEnvelope {
  StagePacket packet;
  uint8_t sourceMac[6];
};

${arrays}
uint16_t partIndex[${Math.max(1, rx.parts.length)}] = {0};
int32_t masterOffsetMs = 0;
bool clockSynced = false;
bool playing = false;
uint16_t activeCueSeq = 0;
uint32_t playbackStartMasterMs = 0;
uint32_t localPlaybackStartMs = 0;
uint32_t lastElapsedMs = 0;
const uint8_t PREVIEW_OFF = 0, PREVIEW_HOLD = 1, PREVIEW_RUNNING = 2;
uint8_t previewState = PREVIEW_OFF;
uint32_t previewBaseElapsedMs = 0;
uint32_t previewAnchorLocalMs = 0;
bool aClockPending = false;
bool aClockOwnsLive = false;
bool completedEpochValid = false;
uint16_t completedCueSeq = 0;
uint32_t completedShowStartMasterMs = 0;
uint16_t aClockPendingSeq = 0;
uint32_t aClockGoMasterMs = 0;
uint32_t aClockAnchorMasterMs = 0;
uint8_t masterMac[6] = {0};
bool masterKnown = false;
RxEnvelope rxQueue[RX_QUEUE_SIZE];
volatile uint8_t rxQueueHead = 0;
volatile uint8_t rxQueueTail = 0;
portMUX_TYPE rxQueueMux = portMUX_INITIALIZER_UNLOCKED;

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

void updateTimeline(uint32_t elapsedMs) {
${applyParts}
}

void seekTimeline(uint32_t elapsedMs) {
  resetTimeline();
  if (elapsedMs >= END_MS) return;
${rx.parts.map((_, index) => `  while (partIndex[${index}] + 1 < PART_${index}_COUNT && elapsedMs >= PART_${index}_T[partIndex[${index}] + 1]) partIndex[${index}]++;`).join('\n')}
  updateTimeline(elapsedMs);
}

void syncClock(uint32_t masterMs) {
  const int32_t observed = (int32_t)(masterMs - millis());
  if (!clockSynced) {
    masterOffsetMs = observed;
    clockSynced = true;
    return;
  }
  const int32_t error = observed - masterOffsetMs;
  masterOffsetMs += error / 4;
}

uint32_t masterNow() {
  return (uint32_t)((int32_t)millis() + masterOffsetMs);
}

void ensurePeer(const uint8_t* mac) {
  if (!mac || esp_now_is_peer_exist(mac)) return;
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, mac, 6);
  peer.channel = ESPNOW_CHANNEL;
  peer.encrypt = false;
  esp_now_add_peer(&peer);
}

void sendStatusAck(const uint8_t* mac, uint32_t echoedMasterMs = 0) {
  if (!mac) return;
  ensurePeer(mac);
  StagePacket ack = {};
  ack.magic = MAGIC;
  ack.type = CMD_ACK;
  ack.targetId = RECEIVER_ID;
  ack.flags = playing ? FLAG_PLAYING : 0;
  if (aClockOwnsLive) ack.flags |= FLAG_A_CLOCK;
  ack.seq = activeCueSeq;
  ack.masterTimeMs = echoedMasterMs;
  ack.showStartMasterMs = playbackStartMasterMs;
  ack.showHash = SHOW_HASH;
  esp_now_send(mac, reinterpret_cast<const uint8_t*>(&ack), sizeof(ack));
}

void stopPlayback() {
  if (playing) {
    completedEpochValid = true;
    completedCueSeq = activeCueSeq;
    completedShowStartMasterMs = playbackStartMasterMs;
  }
  playing = false;
  aClockOwnsLive = false;
  previewState = PREVIEW_OFF;
  lastElapsedMs = 0;
  allOff();
}

void armOrRejoin(uint16_t seq, uint32_t showStartMs) {
  previewState = PREVIEW_OFF;
  activeCueSeq = seq;
  playbackStartMasterMs = showStartMs;
  playing = true;

  const uint32_t nowMaster = masterNow();
  const uint32_t nowLocal = millis();
  if ((int32_t)(nowMaster - playbackStartMasterMs) < 0) {
    const uint32_t waitMs = playbackStartMasterMs - nowMaster;
    localPlaybackStartMs = nowLocal + waitMs;
    lastElapsedMs = 0;
    resetTimeline();
    return;
  }

  const uint32_t elapsed = nowMaster - playbackStartMasterMs;
  if (elapsed >= END_MS) {
    stopPlayback();
    return;
  }

  localPlaybackStartMs = nowLocal - elapsed;
  lastElapsedMs = elapsed;
  seekTimeline(elapsed);
}

void disciplinePlaybackClock(const StagePacket& p) {
  if (!playing) return;
  if (p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) return;
  if ((int32_t)(p.masterTimeMs - p.showStartMasterMs) < 0) return;
  if ((int32_t)(millis() - localPlaybackStartMs) < 0) return;

  const uint32_t masterElapsed = p.masterTimeMs - p.showStartMasterMs;
  const uint32_t localElapsed = millis() - localPlaybackStartMs;
  const int32_t error = (int32_t)(masterElapsed - localElapsed);
  if (error > 2) localPlaybackStartMs -= 1;
  else if (error < -2) localPlaybackStartMs += 1;
}

void runLocalTimeline() {
  if (!playing) return;
  const uint32_t nowLocal = millis();
  if ((int32_t)(nowLocal - localPlaybackStartMs) < 0) return;

  uint32_t elapsed = nowLocal - localPlaybackStartMs;
  if (elapsed < lastElapsedMs) elapsed = lastElapsedMs;
  lastElapsedMs = elapsed;
  if (elapsed >= END_MS) {
    stopPlayback();
    return;
  }
  updateTimeline(elapsed);
}

uint32_t clampPreviewElapsed(uint32_t elapsedMs) {
  if (PREVIEW_SAFE_LIMIT_MS == 0) return 0;
  const uint32_t maxSafe = PREVIEW_SAFE_LIMIT_MS - 1;
  return elapsedMs > maxSafe ? maxSafe : elapsedMs;
}

void previewSeek(uint32_t elapsedMs) {
  if (playing) return;
  if (PREVIEW_SAFE_LIMIT_MS == 0) {
    previewState = PREVIEW_HOLD;
    previewBaseElapsedMs = 0;
    resetTimeline();
    return;
  }
  previewBaseElapsedMs = clampPreviewElapsed(elapsedMs);
  previewState = PREVIEW_HOLD;
  seekTimeline(previewBaseElapsedMs);
}

void previewPlay(uint32_t elapsedMs) {
  if (playing) return;
  if (PREVIEW_SAFE_LIMIT_MS == 0) { previewSeek(0); return; }
  previewBaseElapsedMs = clampPreviewElapsed(elapsedMs);
  previewAnchorLocalMs = millis();
  previewState = PREVIEW_RUNNING;
  seekTimeline(previewBaseElapsedMs);
}

void previewPause() {
  if (playing || previewState != PREVIEW_RUNNING) return;
  uint32_t elapsed = previewBaseElapsedMs + (millis() - previewAnchorLocalMs);
  elapsed = clampPreviewElapsed(elapsed);
  previewBaseElapsedMs = elapsed;
  previewState = PREVIEW_HOLD;
  seekTimeline(elapsed);
}

void previewStop() {
  if (playing) return;
  previewState = PREVIEW_OFF;
  previewBaseElapsedMs = 0;
  resetTimeline();
}

void runPreviewTimeline() {
  if (playing || previewState != PREVIEW_RUNNING) return;
  if (PREVIEW_SAFE_LIMIT_MS == 0) { previewStop(); return; }
  uint32_t elapsed = previewBaseElapsedMs + (millis() - previewAnchorLocalMs);
  if (elapsed >= PREVIEW_SAFE_LIMIT_MS) {
    previewBaseElapsedMs = PREVIEW_SAFE_LIMIT_MS - 1;
    previewState = PREVIEW_HOLD;
    seekTimeline(previewBaseElapsedMs);
    return;
  }
  updateTimeline(elapsed);
}

void armStableASchedule(const StagePacket& p) {
  if (aClockOwnsLive && p.seq == activeCueSeq && p.showStartMasterMs == playbackStartMasterMs) return;
  if (!clockSynced) syncClock(p.masterTimeMs);
  aClockPending = true;
  aClockPendingSeq = p.seq;
  aClockGoMasterMs = p.masterTimeMs + A_CLOCK_RESERVE_MS;
  aClockAnchorMasterMs = p.showStartMasterMs;
}

void cancelStableASchedule() {
  aClockPending = false;
}

void runStableASchedule() {
  if (!aClockPending) return;
  const uint32_t nowMaster = masterNow();
  if ((int32_t)(nowMaster - aClockGoMasterMs) < 0) return;

  const uint16_t nextSeq = aClockPendingSeq;
  const uint32_t nextAnchor = aClockAnchorMasterMs;
  aClockPending = false;
  aClockOwnsLive = true;
  previewState = PREVIEW_OFF;
  activeCueSeq = nextSeq;
  playbackStartMasterMs = nextAnchor;
  completedEpochValid = false;
  playing = true;

  const uint32_t elapsed = nowMaster - playbackStartMasterMs;
  if (elapsed >= END_MS) {
    stopPlayback();
    return;
  }
  const uint32_t nowLocal = millis();
  localPlaybackStartMs = nowLocal - elapsed;
  lastElapsedMs = elapsed;
  seekTimeline(elapsed);
}

bool popEnvelope(RxEnvelope& out) {
  bool have = false;
  portENTER_CRITICAL(&rxQueueMux);
  if (rxQueueTail != rxQueueHead) {
    out = rxQueue[rxQueueTail];
    rxQueueTail = (uint8_t)((rxQueueTail + 1) % RX_QUEUE_SIZE);
    have = true;
  }
  portEXIT_CRITICAL(&rxQueueMux);
  return have;
}

void queueEnvelope(const uint8_t* sourceMac, const uint8_t* data, int len) {
  if (!sourceMac || !data || len != sizeof(StagePacket)) return;
  StagePacket p;
  memcpy(&p, data, sizeof(p));
  if (p.magic != MAGIC) return;
  if (p.targetId != 0 && p.targetId != RECEIVER_ID) return;

  portENTER_CRITICAL(&rxQueueMux);
  const uint8_t next = (uint8_t)((rxQueueHead + 1) % RX_QUEUE_SIZE);
  if (next != rxQueueTail) {
    rxQueue[rxQueueHead].packet = p;
    memcpy(rxQueue[rxQueueHead].sourceMac, sourceMac, 6);
    rxQueueHead = next;
  }
  portEXIT_CRITICAL(&rxQueueMux);
}

void handlePacket(const uint8_t* sourceMac, const StagePacket& p) {
  if (p.targetId != 0 && p.targetId != RECEIVER_ID) return;
  memcpy(masterMac, sourceMac, 6);
  masterKnown = true;

  if (p.type == CMD_PING) {
    sendStatusAck(sourceMac, p.masterTimeMs);
    return;
  }

  if (p.type == CMD_A_SCHEDULE) {
    if (p.showHash && p.showHash != SHOW_HASH) return;
    armStableASchedule(p);
    sendStatusAck(sourceMac, p.masterTimeMs);
    return;
  }

  if (p.type == CMD_FORCE_STOP) {
    cancelStableASchedule();
    stopPlayback();
    activeCueSeq = p.seq;
    sendStatusAck(sourceMac, p.masterTimeMs);
    return;
  }

  if (p.type == CMD_PREVIEW_SEEK) { if (!playing) previewSeek(p.showStartMasterMs); sendStatusAck(sourceMac, p.masterTimeMs); return; }
  if (p.type == CMD_PREVIEW_PLAY) { if (!playing) previewPlay(p.showStartMasterMs); sendStatusAck(sourceMac, p.masterTimeMs); return; }
  if (p.type == CMD_PREVIEW_PAUSE) { if (!playing) previewPause(); sendStatusAck(sourceMac, p.masterTimeMs); return; }
  if (p.type == CMD_PREVIEW_STOP) { if (!playing) previewStop(); sendStatusAck(sourceMac, p.masterTimeMs); return; }

  if (p.type == CMD_SYNC) {
    syncClock(p.masterTimeMs);
    disciplinePlaybackClock(p);
    return;
  }

  if (p.type == CMD_STOP) {
    syncClock(p.masterTimeMs);
    if (!playing && previewState == PREVIEW_OFF) {
      activeCueSeq = p.seq;
      allOff();
    } else if (playing && PREVIEW_SAFE_LIMIT_MS > 0 && lastElapsedMs <= PREVIEW_SAFE_LIMIT_MS + 100UL) {
      activeCueSeq = p.seq;
      stopPlayback();
    }
    sendStatusAck(sourceMac, p.masterTimeMs);
    return;
  }

  if (p.type == CMD_START) {
    if (p.showHash && p.showHash != SHOW_HASH) return;
    const bool packetMatchesActive = p.seq == activeCueSeq && p.showStartMasterMs == playbackStartMasterMs;
    const bool packetMatchesCompleted = completedEpochValid && p.seq == completedCueSeq && p.showStartMasterMs == completedShowStartMasterMs;
    if (playing && !packetMatchesActive) return;
    if (!playing && packetMatchesCompleted) return;
    const bool packetIsAClock = (p.flags & FLAG_A_CLOCK) != 0;
    syncClock(p.masterTimeMs);
    if (!playing) {
      completedEpochValid = false;
      armOrRejoin(p.seq, p.showStartMasterMs);
      if (packetIsAClock) aClockOwnsLive = true;
    } else {
      disciplinePlaybackClock(p);
    }
    sendStatusAck(sourceMac, p.masterTimeMs);
    return;
  }

  if (p.type == CMD_SHOW_STATE) {
    if (p.showHash && p.showHash != SHOW_HASH) return;
    const bool packetMatchesActive = p.seq == activeCueSeq && p.showStartMasterMs == playbackStartMasterMs;
    const bool packetMatchesCompleted = completedEpochValid && p.seq == completedCueSeq && p.showStartMasterMs == completedShowStartMasterMs;
    const bool packetIsAClock = (p.flags & FLAG_A_CLOCK) != 0;
    const bool masterPlaying = (p.flags & FLAG_PLAYING) != 0;
    if (playing && !packetMatchesActive) return;
    if (!playing && masterPlaying && packetMatchesCompleted) return;

    syncClock(p.masterTimeMs);
    if (!masterPlaying) {
      if (!playing && previewState == PREVIEW_OFF) {
        activeCueSeq = p.seq;
        allOff();
        sendStatusAck(sourceMac, p.masterTimeMs);
      }
      return;
    }

    if (!playing) {
      completedEpochValid = false;
      armOrRejoin(p.seq, p.showStartMasterMs);
      if (packetIsAClock) aClockOwnsLive = true;
    } else {
      disciplinePlaybackClock(p);
    }
    sendStatusAck(sourceMac, p.masterTimeMs);
  }
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onEspNowReceive(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  if (!info) return;
  queueEnvelope(info->src_addr, data, len);
}
#else
void onEspNowReceive(const uint8_t* mac, const uint8_t* data, int len) {
  queueEnvelope(mac, data, len);
}
#endif

void setup() {
  Serial.begin(115200);
${pinModes}
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);
  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP_NOW_INIT_FAIL");
    return;
  }
  esp_now_register_recv_cb(onEspNowReceive);
  Serial.print("ESP32_RX_READY id=${rx.receiverId} mac=");
  Serial.print(WiFi.macAddress());
  Serial.print(" hash=");
  Serial.println(SHOW_HASH, HEX);
}

void loop() {
  runStableASchedule();
  runLocalTimeline();
  runPreviewTimeline();

  RxEnvelope env;
  for (uint8_t packetBudget = 0; packetBudget < 4 && popEnvelope(env); packetBudget++) {
    handlePacket(env.sourceMac, env.packet);
  }

  runStableASchedule();
  runLocalTimeline();
  runPreviewTimeline();
  delay(1);
}
`
}

const buildMasterSketch = ({ receiverCount, showDurationMs, previewSafeLimitMs, receiverHashes, bundleHash, bundleHashHex }) => {
  const count = Math.max(1, receiverCount)
  const hashes = Array.from({ length: count }, (_, i) => `0x${hashHex(receiverHashes[i] || 0)}UL`).join(', ')
  const bundleHex = String(bundleHashHex || hashHex(bundleHash || 0)).toUpperCase().padStart(8, '0')

  return `/*
 * EL Stage ESP32 MASTER — ESP-NOW v0.6.11 feature-parity A/B controller
 * State-machine parity target: proven nRF24 Management MASTER/RX behavior.
 * Transport only: RF24/SPI/ACK-payload -> ESP-NOW broadcast-targeted packets + explicit ACK.
 * Web Serial compatibility: v0.6.11 UI with v0.6.5 bundle handshake retained.
 * LCD: 1602 I2C, SDA=GPIO21, SCL=GPIO22, default address 0x27.
 * START rocker: GPIO27 -> GND (INPUT_PULLUP).
 * IMPORTANT: keep UNO+nRF24 as the fallback until ESP-NOW field tests pass.
 * Library required: LiquidCrystal_I2C.
 */
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_arduino_version.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

#define SERIAL_BAUD 115200
#define START_PIN 27
#define LCD_SDA 21
#define LCD_SCL 22
#define ESPNOW_CHANNEL 6
#define RECEIVER_COUNT ${count}
#define SHOW_DURATION_MS ${Math.max(0, Math.round(showDurationMs || 0))}UL
#define PREVIEW_SAFE_LIMIT_MS ${Math.max(0, Math.round(previewSafeLimitMs || 0))}UL
#define DEFAULT_START_LEAD_MS 80UL
#define MAX_START_LEAD_MS 10000UL
#define A_CLOCK_RESERVE_MS 100UL
#define LINK_TIMEOUT_MS 1800UL
#define TELEMETRY_INTERVAL_MS 500UL
#define SHOW_STATE_INTERVAL_MS 500UL
#define SYNC_INTERVAL_MS 250UL
#define LIVE_ABORT_GUARD_MS 40UL
#define FIRMWARE_BUNDLE_HASH 0x${bundleHex}UL

LiquidCrystal_I2C lcd(0x27, 16, 2);
const uint8_t BROADCAST_MAC[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};
const uint32_t EXPECTED_HASH[RECEIVER_COUNT] = { ${hashes} };

const uint8_t MAGIC = 0xA5;
const uint8_t FLAG_PLAYING = 0x01;
const uint8_t FLAG_A_CLOCK = 0x02;
const uint8_t CMD_PING = 1;
const uint8_t CMD_SYNC = 2;
const uint8_t CMD_START = 3;
const uint8_t CMD_STOP = 4;
const uint8_t CMD_SHOW_STATE = 5;
const uint8_t CMD_PREVIEW_SEEK = 6;
const uint8_t CMD_PREVIEW_PLAY = 7;
const uint8_t CMD_PREVIEW_PAUSE = 8;
const uint8_t CMD_PREVIEW_STOP = 9;
const uint8_t CMD_FORCE_STOP = 10;
const uint8_t CMD_A_SCHEDULE = 11;
const uint8_t CMD_ACK = 100;

struct __attribute__((packed)) StagePacket {
  uint8_t magic;
  uint8_t type;
  uint8_t targetId;
  uint8_t flags;
  uint16_t seq;
  uint32_t masterTimeMs;
  uint32_t showStartMasterMs;
  uint32_t showHash;
};
static_assert(sizeof(StagePacket) <= 250, "ESP-NOW packet too large");

uint32_t lastSeenMs[RECEIVER_COUNT] = {0};
uint32_t seenHash[RECEIVER_COUNT] = {0};
uint32_t lastPingRttUs[RECEIVER_COUNT] = {0};
uint32_t lastPingSampleMs[RECEIVER_COUNT] = {0};
uint32_t pingStartedUs[RECEIVER_COUNT] = {0};
uint8_t receiverFlags[RECEIVER_COUNT] = {0};
uint16_t receiverActiveSeq[RECEIVER_COUNT] = {0};
uint16_t cueSeq = 0;
uint32_t runtimeStartLeadMs = DEFAULT_START_LEAD_MS;
uint32_t armedOffsetMs = 0;
uint32_t showStartMasterMs = 0;
uint32_t liveOffsetMs = 0;
uint32_t liveGoMasterMs = 0;
uint32_t lastTelemetryMs = 0;
uint32_t lastShowStateMs = 0;
uint32_t lastSyncMs = 0;
uint32_t lastPingMs = 0;
uint8_t pingIndex = 0;
bool pcHandshake = false;
bool bArmed = false;
bool showPlaying = false;
bool aClockPending = false;
bool aClockLive = false;
uint16_t aClockPendingSeq = 0;
uint32_t aClockGoMasterMs = 0;
uint32_t aClockAnchorMasterMs = 0;
uint32_t aClockTargetOffsetMs = 0;
bool lastStart = false;
char serialLine[96] = {0};
uint8_t serialLineLen = 0;
portMUX_TYPE telemetryMux = portMUX_INITIALIZER_UNLOCKED;

char receiverState(uint8_t i) {
  if (!lastSeenMs[i] || millis() - lastSeenMs[i] > LINK_TIMEOUT_MS) return 'X';
  if (!seenHash[i]) return '?';
  if (seenHash[i] != EXPECTED_HASH[i]) return 'V';
  return 'O';
}

bool receiverHashCompatible(uint8_t i) {
  return seenHash[i] != 0 && seenHash[i] == EXPECTED_HASH[i];
}

uint8_t readyCount() {
  uint8_t n = 0;
  for (uint8_t i = 0; i < RECEIVER_COUNT; i++) if (receiverState(i) == 'O') n++;
  return n;
}

uint8_t compatibleOnlineCount() {
  uint8_t n = 0;
  for (uint8_t i = 0; i < RECEIVER_COUNT; i++) if (receiverState(i) == 'O' && receiverHashCompatible(i)) n++;
  return n;
}

uint8_t joinWaitCount() {
  uint8_t n = 0;
  for (uint8_t i = 0; i < RECEIVER_COUNT; i++) if (!seenHash[i] || (receiverHashCompatible(i) && receiverState(i) == 'X')) n++;
  return n;
}

uint8_t quarantineCount() {
  uint8_t n = 0;
  for (uint8_t i = 0; i < RECEIVER_COUNT; i++) if (seenHash[i] && !receiverHashCompatible(i)) n++;
  return n;
}

void refreshLcd() {
  lcd.setCursor(0,0);
  lcd.print("ESP ");
  lcd.print(showPlaying ? (aClockLive ? "A-LIVE" : "B-LIVE") : (bArmed ? "B-ARM " : "READY "));
  lcd.print("       ");
  lcd.setCursor(0,1);
  for (uint8_t i = 0; i < RECEIVER_COUNT && i < 8; i++) lcd.print(receiverState(i));
  lcd.print(" "); lcd.print(readyCount()); lcd.print("/"); lcd.print(RECEIVER_COUNT); lcd.print("   ");
}

void sendPacketRaw(uint8_t type, uint8_t targetId, uint8_t flags, uint16_t seq, uint32_t masterTimeMs, uint32_t startMasterMs, uint32_t hash) {
  StagePacket p = {};
  p.magic = MAGIC;
  p.type = type;
  p.targetId = targetId;
  p.flags = flags;
  p.seq = seq;
  p.masterTimeMs = masterTimeMs;
  p.showStartMasterMs = startMasterMs;
  p.showHash = hash;
  esp_now_send(BROADCAST_MAC, reinterpret_cast<const uint8_t*>(&p), sizeof(p));
}

void sendPacket(uint8_t type, uint8_t targetId, uint8_t repeats = 1, uint32_t previewElapsedMs = 0) {
  for (uint8_t r = 0; r < repeats; r++) {
    const uint32_t now = millis();
    const uint8_t flags = showPlaying ? (uint8_t)(FLAG_PLAYING | (aClockLive ? FLAG_A_CLOCK : 0)) : 0;
    const uint32_t hash = targetId >= 1 && targetId <= RECEIVER_COUNT ? EXPECTED_HASH[targetId - 1] : 0;
    const uint32_t startValue = (type >= CMD_PREVIEW_SEEK && type <= CMD_PREVIEW_STOP) ? previewElapsedMs : showStartMasterMs;
    sendPacketRaw(type, targetId, flags, cueSeq, now, startValue, hash);
    if (repeats > 1 && r + 1 < repeats) delayMicroseconds(350);
  }
}

void sendCompatibleReceivers(uint8_t type, uint8_t repeats = 1) {
  for (uint8_t r = 0; r < repeats; r++) {
    for (uint8_t i = 0; i < RECEIVER_COUNT; i++) {
      if (!receiverHashCompatible(i)) continue;
      const uint8_t flags = showPlaying ? (uint8_t)(FLAG_PLAYING | (aClockLive ? FLAG_A_CLOCK : 0)) : 0;
      sendPacketRaw(type, i + 1, flags, cueSeq, millis(), showStartMasterMs, EXPECTED_HASH[i]);
      delayMicroseconds(250);
    }
    if (r + 1 < repeats) delay(1);
  }
}

void sendSync() {
  sendPacketRaw(CMD_SYNC, 0, showPlaying ? (uint8_t)(FLAG_PLAYING | (aClockLive ? FLAG_A_CLOCK : 0)) : 0, cueSeq, millis(), showStartMasterMs, 0);
}

void sendShowState() {
  if (!pcHandshake) {
    sendPacket(CMD_SHOW_STATE, 0, 1);
    return;
  }
  sendCompatibleReceivers(CMD_SHOW_STATE, 1);
}

void sendPreviewAll(uint8_t type, uint32_t elapsedMs, uint8_t repeats = 2) {
  if (showPlaying) return;
  sendPacket(type, 0, repeats, elapsedMs);
}

void printRxMonitor() {
  const uint32_t now = millis();
  Serial.print("RXMON ");
  for (uint8_t i = 0; i < RECEIVER_COUNT; i++) {
    if (i) Serial.print(',');
    Serial.print(i + 1); Serial.print(':');
    Serial.print(receiverState(i)); Serial.print(':');
    Serial.print(lastPingRttUs[i]); Serial.print(':');
    Serial.print(lastPingSampleMs[i] ? now - lastPingSampleMs[i] : 0xFFFFFFFFUL); Serial.print(':');
    Serial.print(0); Serial.print(':');
    Serial.print((receiverFlags[i] & FLAG_PLAYING) ? 1 : 0); Serial.print(':');
    Serial.print(receiverActiveSeq[i]);
  }
  Serial.println();
}

void handleAck(const StagePacket& p) {
  if (p.magic != MAGIC || p.type != CMD_ACK || p.targetId < 1 || p.targetId > RECEIVER_COUNT) return;
  const uint8_t i = p.targetId - 1;
  const uint32_t nowUs = micros();
  portENTER_CRITICAL(&telemetryMux);
  lastSeenMs[i] = millis();
  lastPingSampleMs[i] = lastSeenMs[i];
  seenHash[i] = p.showHash;
  receiverFlags[i] = p.flags;
  receiverActiveSeq[i] = p.seq;
  if (pingStartedUs[i]) {
    lastPingRttUs[i] = nowUs - pingStartedUs[i];
    pingStartedUs[i] = 0;
  }
  portEXIT_CRITICAL(&telemetryMux);
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onEspNowReceive(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  (void)info;
  if (!data || len != sizeof(StagePacket)) return;
  StagePacket p; memcpy(&p, data, sizeof(p)); handleAck(p);
}
#else
void onEspNowReceive(const uint8_t* mac, const uint8_t* data, int len) {
  (void)mac;
  if (!data || len != sizeof(StagePacket)) return;
  StagePacket p; memcpy(&p, data, sizeof(p)); handleAck(p);
}
#endif

uint32_t clampPreview(uint32_t value) {
  if (!PREVIEW_SAFE_LIMIT_MS) return 0;
  return value >= PREVIEW_SAFE_LIMIT_MS ? PREVIEW_SAFE_LIMIT_MS - 1 : value;
}

uint32_t livePositionNow() {
  if (!showPlaying) return liveOffsetMs;
  const uint32_t now = millis();
  if ((int32_t)(now - showStartMasterMs) < 0) return 0;
  return now - showStartMasterMs;
}

bool canAbortBeforeFirstCue() {
  if (!showPlaying || PREVIEW_SAFE_LIMIT_MS == 0) return false;
  const uint32_t now = millis();
  if ((int32_t)(now - showStartMasterMs) < 0) return true;
  return (now - showStartMasterMs) + LIVE_ABORT_GUARD_MS < PREVIEW_SAFE_LIMIT_MS;
}

void sendStartFromOffsetWithLead(uint32_t offsetMs, uint32_t leadMs) {
  if (showPlaying || aClockPending) return;
  if (SHOW_DURATION_MS > 0 && offsetMs >= SHOW_DURATION_MS) offsetMs = SHOW_DURATION_MS - 1;
  cueSeq++;
  liveOffsetMs = offsetMs;
  liveGoMasterMs = millis() + leadMs;
  showStartMasterMs = liveGoMasterMs - offsetMs;
  showPlaying = true;
  aClockLive = false;
  bArmed = false;

  if (pcHandshake) sendCompatibleReceivers(CMD_START, 2);
  else sendPacket(CMD_START, 0, 5);
  lastShowStateMs = 0;

  if (pcHandshake) {
    Serial.print("LIVE_STARTED ");
    Serial.print(offsetMs);
    Serial.print(' ');
    Serial.println(livePositionNow());
  }
}

void sendStartFromOffset(uint32_t offsetMs) {
  sendStartFromOffsetWithLead(offsetMs, runtimeStartLeadMs);
}

void sendStartFromOffsetNow(uint32_t offsetMs) {
  sendStartFromOffsetWithLead(offsetMs, 0);
}

void abortBeforeFirstCue() {
  if (!showPlaying) return;
  if (!canAbortBeforeFirstCue()) {
    Serial.print("LIVE_STOP_DENIED "); Serial.println(livePositionNow());
    return;
  }
  cueSeq++;
  showPlaying = false;
  aClockLive = false;
  aClockPending = false;
  sendPacket(CMD_STOP, 0, 4);
  showStartMasterMs = 0;
  liveOffsetMs = 0;
  liveGoMasterMs = 0;
  bArmed = false;
  Serial.println("LIVE_ABORTED");
}

void forceStopShow() {
  aClockPending = false;
  cueSeq++;
  showPlaying = false;
  aClockLive = false;
  sendPacket(CMD_FORCE_STOP, 0, 5);
  showStartMasterMs = 0;
  liveOffsetMs = 0;
  liveGoMasterMs = 0;
  bArmed = false;
  if (pcHandshake) Serial.println("LIVE_FORCE_STOPPED");
}

void finishShow() {
  aClockPending = false;
  showPlaying = false;
  aClockLive = false;
  showStartMasterMs = 0;
  liveOffsetMs = 0;
  liveGoMasterMs = 0;
  bArmed = false;
  if (pcHandshake) Serial.println("LIVE_FINISHED");
}

void requestStart() {
  if (showPlaying || aClockPending) return;
  const bool useBStart = pcHandshake && bArmed;
  const uint32_t offsetMs = useBStart ? armedOffsetMs : 0;
  if (useBStart) sendStartFromOffset(offsetMs);
  else sendStartFromOffsetNow(0);
}

void sendAClockSchedulePackets(uint16_t scheduleSeq, uint32_t scheduleMasterMs, uint32_t anchorMasterMs) {
  for (uint8_t i = 0; i < RECEIVER_COUNT; i++) {
    if (!receiverHashCompatible(i)) continue;
    for (uint8_t r = 0; r < 3; r++) {
      sendPacketRaw(CMD_A_SCHEDULE, i + 1, FLAG_PLAYING | FLAG_A_CLOCK, scheduleSeq, scheduleMasterMs, anchorMasterMs, EXPECTED_HASH[i]);
      delayMicroseconds(350);
    }
  }
}

bool scheduleStableAFromOffset(uint32_t capturedOffsetMs) {
  if (aClockPending || showPlaying) return false;
  const uint32_t commandReceivedMasterMs = millis();
  for (uint8_t i = 0; i < RECEIVER_COUNT; i++) {
    pingStartedUs[i] = micros();
    sendPacketRaw(CMD_PING, i + 1, 0, cueSeq, millis(), 0, EXPECTED_HASH[i]);
    delay(1);
  }
  sendSync();
  sendSync();
  sendSync();

  const uint32_t scheduleMasterMs = millis();
  const uint32_t preparationMs = scheduleMasterMs - commandReceivedMasterMs;
  uint32_t offsetAtScheduleMs = capturedOffsetMs + preparationMs;
  if (SHOW_DURATION_MS > 0) {
    if (offsetAtScheduleMs >= SHOW_DURATION_MS) return false;
    if (SHOW_DURATION_MS - offsetAtScheduleMs <= A_CLOCK_RESERVE_MS + 20UL) return false;
  }

  aClockPendingSeq = cueSeq + 1;
  aClockGoMasterMs = scheduleMasterMs + A_CLOCK_RESERVE_MS;
  aClockAnchorMasterMs = scheduleMasterMs - offsetAtScheduleMs;
  aClockTargetOffsetMs = offsetAtScheduleMs + A_CLOCK_RESERVE_MS;
  aClockPending = true;
  bArmed = false;
  sendAClockSchedulePackets(aClockPendingSeq, scheduleMasterMs, aClockAnchorMasterMs);
  return true;
}

void commitStableAIfDue() {
  if (!aClockPending) return;
  const uint32_t now = millis();
  if ((int32_t)(now - aClockGoMasterMs) < 0) return;

  cueSeq = aClockPendingSeq;
  showStartMasterMs = aClockAnchorMasterMs;
  liveGoMasterMs = aClockGoMasterMs;
  liveOffsetMs = aClockTargetOffsetMs;
  showPlaying = true;
  aClockLive = true;
  bArmed = false;
  armedOffsetMs = 0;
  aClockPending = false;
  lastShowStateMs = 0;
  sendCompatibleReceivers(CMD_START, 2);

  if (pcHandshake) {
    Serial.print("A_LIVE_STARTED ");
    Serial.print(liveOffsetMs); Serial.print(' ');
    Serial.print(A_CLOCK_RESERVE_MS); Serial.print(' ');
    Serial.print(compatibleOnlineCount()); Serial.print(' ');
    Serial.print(joinWaitCount()); Serial.print(' ');
    Serial.println(quarantineCount());
  }
}

uint32_t parseUInt(const char* p) {
  while (*p == ' ') p++;
  return (uint32_t)strtoul(p, nullptr, 10);
}

void printStatus() {
  Serial.print("STATUS mode=");
  Serial.print(showPlaying ? (aClockLive ? "A_LIVE" : "B_LIVE") : (bArmed ? "B_ARMED" : (pcHandshake ? "B_CONNECTED" : "A")));
  Serial.print(" live="); Serial.print(showPlaying ? 1 : 0);
  Serial.print(" delay="); Serial.print(runtimeStartLeadMs);
  Serial.print(" offset="); Serial.print(showPlaying ? livePositionNow() : armedOffsetMs);
  Serial.print(" ready="); Serial.print(readyCount()); Serial.print('/'); Serial.print(RECEIVER_COUNT);
  Serial.print(" bundle="); Serial.println(FIRMWARE_BUNDLE_HASH, HEX);
}

void processSerialLine(char* line) {
  if (!line[0]) return;

  if (strcmp(line, "HELLO LSM-B1") == 0 || strcmp(line, "HELLO") == 0) {
    pcHandshake = true;
    Serial.println("LSM_READY LSM-B1 AB_DUAL V065 BUNDLE ${bundleHex}");
    printStatus();
    return;
  }
  if (strcmp(line, "PING") == 0) {
    pcHandshake = true;
    Serial.print("PONG "); Serial.println(millis());
    printRxMonitor();
    return;
  }
  if (strcmp(line, "STATUS") == 0) { printStatus(); return; }

  if (strncmp(line, "SET_DELAY ", 10) == 0) {
    uint32_t value = parseUInt(line + 10);
    if (value > MAX_START_LEAD_MS) value = MAX_START_LEAD_MS;
    runtimeStartLeadMs = value;
    pcHandshake = true;
    Serial.print("DELAY_OK "); Serial.println(runtimeStartLeadMs);
    return;
  }

  if (strncmp(line, "SEEK ", 5) == 0) {
    if (showPlaying) { Serial.println("BUSY LIVE"); return; }
    const uint32_t value = clampPreview(parseUInt(line + 5));
    sendPreviewAll(CMD_PREVIEW_SEEK, value, 2);
    Serial.print("SEEK_OK "); Serial.println(value);
    return;
  }
  if (strncmp(line, "PREVIEW_PLAY ", 13) == 0) {
    if (showPlaying) { Serial.println("BUSY LIVE"); return; }
    const uint32_t value = clampPreview(parseUInt(line + 13));
    sendPreviewAll(CMD_PREVIEW_PLAY, value, 2);
    Serial.print("PREVIEW_PLAY_OK "); Serial.println(value);
    return;
  }
  if (strcmp(line, "PREVIEW_PAUSE") == 0) {
    if (showPlaying) { Serial.println("BUSY LIVE"); return; }
    sendPreviewAll(CMD_PREVIEW_PAUSE, 0, 2);
    Serial.println("PREVIEW_PAUSE_OK");
    return;
  }
  if (strcmp(line, "PREVIEW_STOP") == 0) {
    if (showPlaying) { Serial.println("BUSY LIVE"); return; }
    sendPreviewAll(CMD_PREVIEW_STOP, 0, 2);
    bArmed = false;
    Serial.println("PREVIEW_STOP_OK");
    return;
  }

  if (strncmp(line, "ARM_B ", 6) == 0) {
    if (showPlaying || aClockPending) { Serial.println("BUSY LIVE"); return; }
    pcHandshake = true;
    armedOffsetMs = clampPreview(parseUInt(line + 6));
    bArmed = true;
    sendPreviewAll(CMD_PREVIEW_SEEK, armedOffsetMs, 2);
    Serial.print("ARM_OK "); Serial.print(armedOffsetMs); Serial.print(' '); Serial.println(runtimeStartLeadMs);
    return;
  }

  if (strcmp(line, "MODE_A") == 0) {
    if (showPlaying || aClockPending) { Serial.println("BUSY LIVE"); return; }
    bArmed = false;
    armedOffsetMs = 0;
    Serial.println("MODE_A_READY");
    return;
  }

  if (strncmp(line, "LIVE_START_NOW ", 15) == 0) {
    if (showPlaying || aClockPending) { Serial.println("BUSY LIVE"); return; }
    pcHandshake = true;
    sendStartFromOffsetNow(parseUInt(line + 15));
    return;
  }
  if (strncmp(line, "LIVE_START ", 11) == 0) {
    if (showPlaying || aClockPending) { Serial.println("BUSY LIVE"); return; }
    pcHandshake = true;
    sendStartFromOffset(parseUInt(line + 11));
    return;
  }

  if (strcmp(line, "LIVE_STOP") == 0) {
    if (!showPlaying) { Serial.println("LIVE_ABORTED"); return; }
    abortBeforeFirstCue();
    return;
  }
  if (strcmp(line, "LIVE_FORCE_STOP") == 0) {
    pcHandshake = true;
    forceStopShow();
    return;
  }
  if (strcmp(line, "LIVE_COMPLETE") == 0) {
    if (showPlaying) finishShow();
    else Serial.println("LIVE_FINISHED");
    return;
  }

  if (strncmp(line, "A_LIVE_START_NOW ", 17) == 0) {
    Serial.println("ERR A_CLOCK_REQUIRES_WEB_V063");
    return;
  }
  if (strncmp(line, "A_LIVE_SCHEDULE ", 16) == 0) {
    pcHandshake = true;
    if (!scheduleStableAFromOffset(parseUInt(line + 16))) {
      Serial.println("A_SCHEDULE_DENIED END_OR_BUSY");
      return;
    }
    Serial.print("A_SCHEDULED ");
    Serial.print(parseUInt(line + 16)); Serial.print(' '); Serial.println(A_CLOCK_RESERVE_MS);
    return;
  }
}

void pollSerial() {
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialLineLen) {
        serialLine[serialLineLen] = 0;
        processSerialLine(serialLine);
        serialLineLen = 0;
      }
    } else if (serialLineLen < sizeof(serialLine) - 1) {
      serialLine[serialLineLen++] = c;
    }
  }
}

void pingOne(uint8_t i) {
  if (i >= RECEIVER_COUNT) return;
  pingStartedUs[i] = micros();
  sendPacketRaw(CMD_PING, i + 1, 0, cueSeq, millis(), showStartMasterMs, EXPECTED_HASH[i]);
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  pinMode(START_PIN, INPUT_PULLUP);
  Wire.begin(LCD_SDA, LCD_SCL);
  lcd.init();
  lcd.backlight();
  lcd.clear();

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);
  if (esp_now_init() != ESP_OK) {
    lcd.print("ESP-NOW FAIL");
    Serial.println("ESP_NOW_INIT_FAIL");
    return;
  }
  esp_now_register_recv_cb(onEspNowReceive);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST_MAC, 6);
  peer.channel = ESPNOW_CHANNEL;
  peer.encrypt = false;
  esp_now_add_peer(&peer);

  Serial.print("ESP32_MASTER_READY mac=");
  Serial.print(WiFi.macAddress());
  Serial.print(" bundle=");
  Serial.println(FIRMWARE_BUNDLE_HASH, HEX);
  refreshLcd();
}

void loop() {
  pollSerial();
  const uint32_t now = millis();
  commitStableAIfDue();

  const bool startPressed = digitalRead(START_PIN) == LOW;
  if (startPressed && !lastStart) requestStart();
  lastStart = startPressed;

  if (now - lastPingMs >= 180) {
    lastPingMs = now;
    pingOne(pingIndex);
    pingIndex = (uint8_t)((pingIndex + 1) % RECEIVER_COUNT);
  }

  if (now - lastSyncMs >= SYNC_INTERVAL_MS) {
    lastSyncMs = now;
    sendSync();
  }

  if (showPlaying) {
    const uint32_t position = livePositionNow();
    if (SHOW_DURATION_MS > 0 && position >= SHOW_DURATION_MS) {
      finishShow();
    } else if (now - lastShowStateMs >= SHOW_STATE_INTERVAL_MS) {
      lastShowStateMs = now;
      sendShowState();
    }
  }

  if (pcHandshake && now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;
    printRxMonitor();
  }

  static uint32_t lastLcdMs = 0;
  if (now - lastLcdMs >= 250) {
    lastLcdMs = now;
    refreshLcd();
  }
  delay(1);
}
`
}

export function buildManagementEsp32FirmwareBundle({ costumes = [], blocks = [] } = {}) {
  const source = buildManagementFirmwareBundle({ costumes, blocks })
  const receivers = source.receivers.map((rx) => ({
    ...rx,
    filename: `ESP32_RX${rx.receiverId}_ESP_NOW_V0611.ino`,
    code: buildReceiverSketch(rx, source.previewSafeLimitMs),
  }))
  return {
    master: {
      filename: 'ESP32_Master_ESP_NOW_V0611.ino',
      code: buildMasterSketch(source),
    },
    receivers,
    receiverCount: source.receiverCount,
    showDurationMs: source.showDurationMs,
    previewSafeLimitMs: source.previewSafeLimitMs,
    receiverHashes: source.receiverHashes,
    bundleHash: source.bundleHash,
    bundleHashHex: source.bundleHashHex,
  }
}
