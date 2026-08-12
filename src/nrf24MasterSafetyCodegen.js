export function buildNrf24MasterSketch({ receiverCount = 7, showDurationMs = 180000, receiverHashes = [] } = {}) {
  const count = Math.max(1, Math.min(8, Number(receiverCount) || 7));
  const duration = Math.max(0, Math.round(Number(showDurationMs) || 0));
  const hashes = Array.from({ length: 8 }, (_, i) => Number(receiverHashes?.[i] || 0) >>> 0);
  const hashRows = hashes
    .map((hash) => `0x${hash.toString(16).padStart(8, "0").toUpperCase()}UL`)
    .join(", ");

  return `/* nRF24 EL Stage MASTER — receiver pre-flight build
 * UNO + nRF24L01+PA+LNA + I2C 1602 LCD
 * nRF24: CE D9 / CSN D10 / MOSI D11 / MISO D12 / SCK D13
 * LCD: SDA A4 / SCL A5 / 5V / GND
 * ENABLE rocker: D2-GND (LOW=ON, OPEN=OFF), START rocker: D3-GND
 * Default receiver count: 7 costumes.
 * LINK scan: about 0.5 s / receiver, FAIL after about 1.0 s without ACK.
 * PRE-FLIGHT: O=ready, X=link fail, V=timeline version mismatch, ?=version unknown.
 * OVERRIDE: if PRE-FLIGHT is not ready, first START arms override; OFF->ON again within 5 s forces start.
 * Each RX has its own expected timeline hash, so unchanged receivers do not need reflashing.
 */
#include <SPI.h>
#include <RF24.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

RF24 radio(9, 10);
LiquidCrystal_I2C lcd(0x27, 16, 2);

#define ENABLE_PIN 2
#define START_PIN 3
#define RECEIVER_COUNT ${count}
#define SHOW_DURATION_MS ${duration}UL
#define START_LEAD_MS 300UL
#define SYNC_INTERVAL_MS 100UL
#define SHOW_STATE_INTERVAL_MS 100UL
#define LINK_SCAN_INTERVAL_MS 60UL
#define LINK_FAIL_MS 1000UL
#define OVERRIDE_WINDOW_MS 5000UL

const byte BROADCAST_ADDRESS[6] = "ELCMD";
const byte RECEIVER_ADDRESSES[8][6] = {
  "EL001", "EL002", "EL003", "EL004", "EL005", "EL006", "EL007", "EL008"
};
const uint32_t EXPECTED_HASHES[8] = { ${hashRows} };

const byte MAGIC = 0xA5;
const byte STATUS_MAGIC = 0x5A;
const byte FLAG_PLAYING = 0x01;
const byte CMD_PING = 1, CMD_SYNC = 2, CMD_START = 3, CMD_STOP = 4, CMD_SHOW_STATE = 5;

struct __attribute__((packed)) RadioPacket {
  byte magic;
  byte type;
  byte target;
  byte flags;
  uint16_t seq;
  uint32_t masterTimeMs;
  uint32_t showStartMasterMs;
};

struct __attribute__((packed)) ReceiverStatus {
  byte magic;
  byte receiverId;
  uint16_t reserved;
  uint32_t showHash;
};

static_assert(sizeof(RadioPacket) <= 32, "nRF24 payload too large");
static_assert(sizeof(ReceiverStatus) <= 32, "nRF24 ACK payload too large");

bool linkOk[8] = {0};
bool versionKnown[8] = {0};
bool versionOk[8] = {0};
uint32_t lastLinkOkMs[8] = {0};
byte scanIndex = 0;

uint16_t cueSeq = 0;
bool showPlaying = false;
uint32_t showStartMasterMs = 0;

uint32_t lastSyncMs = 0;
uint32_t lastShowStateMs = 0;
uint32_t lastScanMs = 0;

bool lastEnable = false;
bool lastStart = false;
bool overrideArmed = false;
uint32_t overrideUntilMs = 0;

RadioPacket makePacket(byte type, byte target = 0) {
  RadioPacket p = {};
  p.magic = MAGIC;
  p.type = type;
  p.target = target;
  p.flags = showPlaying ? FLAG_PLAYING : 0;
  p.seq = cueSeq;
  p.masterTimeMs = millis();
  p.showStartMasterMs = showStartMasterMs;
  return p;
}

void broadcastPacket(byte type, byte repeats = 1) {
  radio.stopListening();
  radio.setAutoAck(false);
  radio.openWritingPipe(BROADCAST_ADDRESS);

  RadioPacket p = makePacket(type, 0);
  for (byte i = 0; i < repeats; i++) {
    p.masterTimeMs = millis();
    p.flags = showPlaying ? FLAG_PLAYING : 0;
    p.seq = cueSeq;
    p.showStartMasterMs = showStartMasterMs;
    radio.write(&p, sizeof(p));
    if (repeats > 1) delay(3);
  }
}

void sendSync() { broadcastPacket(CMD_SYNC); }
void sendShowState() { broadcastPacket(CMD_SHOW_STATE); }

void sendStart() {
  cueSeq++;
  showStartMasterMs = millis() + START_LEAD_MS;
  showPlaying = true;
  overrideArmed = false;
  broadcastPacket(CMD_START, 5);
  lastShowStateMs = 0;
}

void sendStop() {
  cueSeq++;
  showPlaying = false;
  showStartMasterMs = 0;
  overrideArmed = false;
  broadcastPacket(CMD_STOP, 5);
  lastShowStateMs = 0;
}

bool allReady() {
  for (byte i = 0; i < RECEIVER_COUNT; i++) {
    if (!linkOk[i] || !versionKnown[i] || !versionOk[i]) return false;
  }
  return true;
}

byte readyCount() {
  byte ok = 0;
  for (byte i = 0; i < RECEIVER_COUNT; i++) {
    if (linkOk[i] && versionKnown[i] && versionOk[i]) ok++;
  }
  return ok;
}

void pingOne(byte i) {
  radio.stopListening();
  radio.setAutoAck(true);
  radio.setRetries(3, 5);
  radio.openWritingPipe(RECEIVER_ADDRESSES[i]);

  RadioPacket p = makePacket(CMD_PING, i + 1);
  const bool ok = radio.write(&p, sizeof(p));
  const uint32_t now = millis();

  if (ok) {
    linkOk[i] = true;
    lastLinkOkMs[i] = now;

    versionKnown[i] = false;
    versionOk[i] = false;
    if (radio.isAckPayloadAvailable()) {
      ReceiverStatus status = {};
      radio.read(&status, sizeof(status));
      if (status.magic == STATUS_MAGIC && status.receiverId == i + 1) {
        versionKnown[i] = true;
        versionOk[i] = status.showHash == EXPECTED_HASHES[i];
      }
    }
  } else if (now - lastLinkOkMs[i] >= LINK_FAIL_MS) {
    linkOk[i] = false;
    versionKnown[i] = false;
    versionOk[i] = false;
  }
}

void printPadded(const char* text) {
  lcd.print(text);
  byte n = strlen(text);
  while (n++ < 16) lcd.print(' ');
}

void drawLcd() {
  if (overrideArmed && (int32_t)(overrideUntilMs - millis()) > 0) {
    lcd.setCursor(0, 0);
    lcd.print("PREFLIGHT ");
    lcd.print(readyCount());
    lcd.print('/');
    lcd.print(RECEIVER_COUNT);
    lcd.print("   ");
    lcd.setCursor(0, 1);
    printPadded("START=OVERRIDE");
    return;
  }

  lcd.setCursor(0, 0);
  if (lastEnable) printPadded("MASTER ON  7RX");
  else printPadded("MASTER OFF 7RX");

  lcd.setCursor(0, 1);
  for (byte i = 0; i < RECEIVER_COUNT; i++) {
    if (!linkOk[i]) lcd.print('X');
    else if (!versionKnown[i]) lcd.print('?');
    else if (!versionOk[i]) lcd.print('V');
    else lcd.print('O');
  }
  lcd.print(' ');
  lcd.print(readyCount());
  lcd.print('/');
  lcd.print(RECEIVER_COUNT);
  if (showPlaying) lcd.print(" P");
  else lcd.print("  ");
  lcd.print("   ");
}

void requestStart() {
  if (!lastEnable) return;

  if (allReady()) {
    sendStart();
    return;
  }

  const uint32_t now = millis();
  if (overrideArmed && (int32_t)(overrideUntilMs - now) > 0) {
    sendStart();
    return;
  }

  overrideArmed = true;
  overrideUntilMs = now + OVERRIDE_WINDOW_MS;
  drawLcd();
}

void setup() {
  pinMode(ENABLE_PIN, INPUT_PULLUP);
  pinMode(START_PIN, INPUT_PULLUP);

  lcd.init();
  lcd.backlight();
  lcd.print("EL STAGE BOOT");

  if (!radio.begin()) {
    lcd.setCursor(0, 1);
    lcd.print("NRF24 FAIL");
    while (1) delay(500);
  }

  radio.setDataRate(RF24_250KBPS);
  radio.setChannel(90);
  radio.setPALevel(RF24_PA_HIGH);
  radio.setCRCLength(RF24_CRC_16);
  radio.setAddressWidth(5);
  radio.enableAckPayload();

  lastEnable = digitalRead(ENABLE_PIN) == LOW;
  lastStart = digitalRead(START_PIN) == LOW;

  if (lastEnable) sendShowState();
  else sendStop();

  delay(300);
  lcd.clear();
  drawLcd();
}

void loop() {
  const uint32_t now = millis();

  if (overrideArmed && (int32_t)(now - overrideUntilMs) >= 0) {
    overrideArmed = false;
    drawLcd();
  }

  if (now - lastSyncMs >= SYNC_INTERVAL_MS) {
    lastSyncMs = now;
    sendSync();
  }

  if (now - lastShowStateMs >= SHOW_STATE_INTERVAL_MS) {
    lastShowStateMs = now;
    sendShowState();
  }

  if (now - lastScanMs >= LINK_SCAN_INTERVAL_MS) {
    lastScanMs = now;
    pingOne(scanIndex);
    scanIndex = (scanIndex + 1) % RECEIVER_COUNT;
    drawLcd();
  }

  if (showPlaying && SHOW_DURATION_MS > 0 && (int32_t)(now - showStartMasterMs) >= 0) {
    const uint32_t elapsed = now - showStartMasterMs;
    if (elapsed >= SHOW_DURATION_MS) sendStop();
  }

  const bool enable = digitalRead(ENABLE_PIN) == LOW;
  const bool start = digitalRead(START_PIN) == LOW;

  if (enable != lastEnable) {
    delay(20);
    const bool v = digitalRead(ENABLE_PIN) == LOW;
    if (v != lastEnable) {
      lastEnable = v;
      if (v) {
        showPlaying = false;
        showStartMasterMs = 0;
        overrideArmed = false;
        sendShowState();
      } else {
        sendStop();
      }
      drawLcd();
    }
  }

  if (start != lastStart) {
    delay(20);
    const bool v = digitalRead(START_PIN) == LOW;
    if (v != lastStart) {
      lastStart = v;
      if (v) requestStart();
    }
  }
}
`;
}
