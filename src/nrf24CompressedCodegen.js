import { buildNrf24MasterSketch } from "./nrf24MasterSafetyCodegen.js";

export { buildNrf24MasterSketch };

const clean = (v) => String(v ?? "").replace(/[\r\n]+/g, " ").replace(/\*\//g, "* /");
const rxAddr = (id) => `EL${String(id).padStart(3, "0")}`;
const EVENT_TICK_MS = 10;
const COMPACT16_MAX_TICK = 0x7fff;

export function buildNrf24ReceiverSketch({ receiverId, costumeName, parts = [], showHash = 0 }) {
  const id = Math.max(1, Math.min(8, Number(receiverId) || 1));
  const hash = Number(showHash) >>> 0;
  const hashHex = `0x${hash.toString(16).padStart(8, "0").toUpperCase()}UL`;
  const normalized = (parts.length
    ? parts
    : [{ name: "EL", pin: 4, frames: [{ t: 0, on: false }], endMs: 0 }]
  ).map((p, i) => ({
    name: clean(p.name || `PART ${i + 1}`),
    pin: Number.isFinite(Number(p.pin)) ? Number(p.pin) : 4,
    frames: Array.isArray(p.frames) && p.frames.length ? p.frames : [{ t: 0, on: false }],
    endMs: Math.max(0, Number(p.endMs) || 0),
  }));

  const endMs = normalized.reduce((m, p) => Math.max(m, p.endMs), 0);
  const maxTick = normalized.reduce(
    (m, p) => Math.max(m, ...p.frames.map((f) => Math.max(0, Math.round((Number(f.t) || 0) / EVENT_TICK_MS)))),
    0
  );
  const compact16 = maxTick <= COMPACT16_MAX_TICK;
  const packedType = compact16 ? "uint16_t" : "uint32_t";
  const readFn = compact16 ? "pgm_read_word" : "pgm_read_dword";
  const suffix = compact16 ? "U" : "UL";
  const bytesPerEvent = compact16 ? 2 : 4;
  const totalEvents = normalized.reduce((sum, p) => sum + p.frames.length, 0);
  const packedBytes = totalEvents * bytesPerEvent;

  const frameBlocks = normalized
    .map((p, i) => {
      const rows = p.frames
        .map((f) => {
          const tick = Math.max(0, Math.round((Number(f.t) || 0) / EVENT_TICK_MS));
          const packed = tick * 2 + (f.on ? 1 : 0);
          return `  ${packed}${suffix}`;
        })
        .join(",\n");
      return `// PART ${i + 1}: ${p.name} / D${p.pin}\nconst PackedEvent PART_${i}_FRAMES[] PROGMEM = {\n${rows}\n};\nconst uint16_t PART_${i}_COUNT = sizeof(PART_${i}_FRAMES) / sizeof(PART_${i}_FRAMES[0]);`;
    })
    .join("\n\n");

  const runtime = normalized
    .map((p, i) => `  {${p.pin}, PART_${i}_FRAMES, PART_${i}_COUNT, 0}`)
    .join(",\n");

  return `/* nRF24 EL Stage Receiver RX${id} — ${clean(costumeName || `의상 ${id}`)}
 * UNO + YL-105 + nRF24L01+PA+LNA
 * CE D9 / CSN D10 / MOSI D11 / MISO D12 / SCK D13
 * RF: CH90 / 250kbps / PA_HIGH
 * LINK address: ${rxAddr(id)} / Broadcast: ELCMD
 * Relay outputs are ACTIVE LOW by default.
 * Safe rejoin: missed START / radio dropout / receiver reboot can seek to current show position.
 * Timeline compression: ${EVENT_TICK_MS}ms tick + ON/OFF bit packed into ${bytesPerEvent} bytes/event.
 * Packed timeline data: ${totalEvents} events / about ${packedBytes} bytes in flash.
 * SHOW HASH: ${hashHex}
 */
#include <SPI.h>
#include <RF24.h>
#include <avr/pgmspace.h>

RF24 radio(9, 10);
#define RECEIVER_ID ${id}
#define RELAY_ACTIVE_LOW 1
#define END_MS ${Math.max(0, Math.round(endMs))}UL
#define EVENT_TICK_MS ${EVENT_TICK_MS}UL
#define SHOW_HASH ${hashHex}

const byte UNIQUE_ADDRESS[6] = "${rxAddr(id)}";
const byte BROADCAST_ADDRESS[6] = "ELCMD";
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

typedef ${packedType} PackedEvent;

${frameBlocks}

struct PartRuntime { byte pin; const PackedEvent* frames; uint16_t frameCount; uint16_t nextIndex; };
PartRuntime PARTS[] = {
${runtime}
};
const byte PART_COUNT = sizeof(PARTS) / sizeof(PARTS[0]);

ReceiverStatus statusPayload = { STATUS_MAGIC, RECEIVER_ID, 0, SHOW_HASH };
int32_t masterOffsetMs = 0;
bool clockSynced = false;
bool playing = false;
uint16_t activeCueSeq = 0;
uint32_t playbackStartMasterMs = 0;

void loadStatusAck() {
  radio.writeAckPayload(0, &statusPayload, sizeof(statusPayload));
}

void writePart(byte pin, bool on) {
#if RELAY_ACTIVE_LOW
  digitalWrite(pin, on ? LOW : HIGH);
#else
  digitalWrite(pin, on ? HIGH : LOW);
#endif
}

void allOff() {
  for (byte i = 0; i < PART_COUNT; i++) writePart(PARTS[i].pin, false);
}

void resetTimeline() {
  for (byte i = 0; i < PART_COUNT; i++) PARTS[i].nextIndex = 0;
  allOff();
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

uint32_t packedEventRaw(const PartRuntime& p, uint16_t i) {
  return (uint32_t)${readFn}(&p.frames[i]);
}

uint32_t frameTime(const PartRuntime& p, uint16_t i) {
  return (packedEventRaw(p, i) >> 1) * EVENT_TICK_MS;
}

bool frameOn(const PartRuntime& p, uint16_t i) {
  return (packedEventRaw(p, i) & 0x01U) != 0;
}

void updateTimeline(uint32_t elapsed) {
  for (byte n = 0; n < PART_COUNT; n++) {
    PartRuntime& p = PARTS[n];
    while (p.nextIndex < p.frameCount && frameTime(p, p.nextIndex) <= elapsed) {
      writePart(p.pin, frameOn(p, p.nextIndex));
      p.nextIndex++;
    }
  }
}

// Safe SEEK: never replay missed relay transitions rapidly.
// Calculate only the correct state at the current show position.
void seekTimeline(uint32_t elapsed) {
  for (byte n = 0; n < PART_COUNT; n++) {
    PartRuntime& p = PARTS[n];
    bool currentOn = false;
    uint16_t i = 0;
    while (i < p.frameCount && frameTime(p, i) <= elapsed) {
      currentOn = frameOn(p, i);
      i++;
    }
    writePart(p.pin, currentOn);
    p.nextIndex = i;
  }
}

void stopPlayback() {
  playing = false;
  allOff();
}

void armOrRejoin(uint16_t seq, uint32_t showStartMs) {
  activeCueSeq = seq;
  playbackStartMasterMs = showStartMs;
  playing = true;

  const uint32_t now = masterNow();
  if ((int32_t)(now - playbackStartMasterMs) < 0) {
    resetTimeline();
    return;
  }

  const uint32_t elapsed = now - playbackStartMasterMs;
  if (elapsed >= END_MS) {
    stopPlayback();
    return;
  }

  seekTimeline(elapsed);
}

void setup() {
  for (byte i = 0; i < PART_COUNT; i++) pinMode(PARTS[i].pin, OUTPUT);
  allOff();

  if (!radio.begin()) while (1) { allOff(); delay(500); }
  radio.setDataRate(RF24_250KBPS);
  radio.setChannel(90);
  radio.setPALevel(RF24_PA_HIGH);
  radio.setCRCLength(RF24_CRC_16);
  radio.setAddressWidth(5);
  radio.enableAckPayload();
  radio.openReadingPipe(0, UNIQUE_ADDRESS);
  radio.openReadingPipe(1, BROADCAST_ADDRESS);
  radio.setAutoAck(0, true);
  radio.setAutoAck(1, false);
  loadStatusAck();
  radio.startListening();
}

void loop() {
  byte pipe = 0;
  while (radio.available(&pipe)) {
    RadioPacket p;
    radio.read(&p, sizeof(p));
    if (p.magic != MAGIC) continue;
    if (p.target != 0 && p.target != RECEIVER_ID) continue;

    if (p.type == CMD_PING) {
      // The preloaded ACK payload was consumed by this PING. Refill it for the next PING.
      loadStatusAck();
      continue;
    }

    if (p.type == CMD_SYNC) {
      syncClock(p.masterTimeMs);
      continue;
    }

    if (p.type == CMD_STOP) {
      syncClock(p.masterTimeMs);
      activeCueSeq = p.seq;
      stopPlayback();
      continue;
    }

    if (p.type == CMD_START) {
      syncClock(p.masterTimeMs);
      if (!playing || p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) {
        armOrRejoin(p.seq, p.showStartMasterMs);
      }
      continue;
    }

    if (p.type == CMD_SHOW_STATE) {
      syncClock(p.masterTimeMs);
      const bool masterPlaying = (p.flags & FLAG_PLAYING) != 0;
      if (!masterPlaying) {
        if (playing) stopPlayback();
        activeCueSeq = p.seq;
        continue;
      }

      if (!playing || p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) {
        armOrRejoin(p.seq, p.showStartMasterMs);
      }
      continue;
    }
  }

  if (!playing || !clockSynced) return;
  const uint32_t now = masterNow();
  if ((int32_t)(now - playbackStartMasterMs) < 0) return;

  const uint32_t elapsed = now - playbackStartMasterMs;
  if (elapsed >= END_MS) {
    stopPlayback();
    return;
  }
  updateTimeline(elapsed);
}
`;
}
