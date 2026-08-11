import { buildNrf24MasterSketch } from "./nrf24Codegen.js";

export { buildNrf24MasterSketch };

const clean = (v) => String(v ?? "").replace(/[\r\n]+/g, " ").replace(/\*\//g, "* /");
const rxAddr = (id) => `EL${String(id).padStart(3, "0")}`;
const EVENT_TICK_MS = 20;
const COMPACT16_MAX_TICK = 0x7fff;

export function buildNrf24ReceiverSketch({ receiverId, costumeName, parts = [] }) {
  const id = Math.max(1, Math.min(8, Number(receiverId) || 1));
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

  return `/* nRF24 EL Stage Receiver RX${id} — ${clean(costumeName || `의상 ${id}`)}\n * UNO + YL-105 + nRF24L01+PA+LNA\n * CE D9 / CSN D10 / MOSI D11 / MISO D12 / SCK D13\n * RF: CH90 / 250kbps / PA_HIGH\n * LINK address: ${rxAddr(id)} / Broadcast: ELCMD\n * Relay outputs are ACTIVE LOW by default.\n * Safe rejoin: missed START / radio dropout / receiver reboot can seek to current show position.\n * Timeline compression: ${EVENT_TICK_MS}ms tick + ON/OFF bit packed into ${bytesPerEvent} bytes/event.\n * Packed timeline data: ${totalEvents} events / about ${packedBytes} bytes in flash.\n */\n#include <SPI.h>\n#include <RF24.h>\n#include <avr/pgmspace.h>\n\nRF24 radio(9, 10);\n#define RECEIVER_ID ${id}\n#define RELAY_ACTIVE_LOW 1\n#define END_MS ${Math.max(0, Math.round(endMs))}UL\n#define EVENT_TICK_MS ${EVENT_TICK_MS}UL\n\nconst byte UNIQUE_ADDRESS[6] = "${rxAddr(id)}";\nconst byte BROADCAST_ADDRESS[6] = "ELCMD";\nconst byte MAGIC = 0xA5;\nconst byte FLAG_PLAYING = 0x01;\nconst byte CMD_PING = 1, CMD_SYNC = 2, CMD_START = 3, CMD_STOP = 4, CMD_SHOW_STATE = 5;\n\nstruct __attribute__((packed)) RadioPacket {\n  byte magic;\n  byte type;\n  byte target;\n  byte flags;\n  uint16_t seq;\n  uint32_t masterTimeMs;\n  uint32_t showStartMasterMs;\n};\nstatic_assert(sizeof(RadioPacket) <= 32, "nRF24 payload too large");\n\ntypedef ${packedType} PackedEvent;\n\n${frameBlocks}\n\nstruct PartRuntime { byte pin; const PackedEvent* frames; uint16_t frameCount; uint16_t nextIndex; };\nPartRuntime PARTS[] = {\n${runtime}\n};\nconst byte PART_COUNT = sizeof(PARTS) / sizeof(PARTS[0]);\n\nint32_t masterOffsetMs = 0;\nbool clockSynced = false;\nbool playing = false;\nuint16_t activeCueSeq = 0;\nuint32_t playbackStartMasterMs = 0;\n\nvoid writePart(byte pin, bool on) {\n#if RELAY_ACTIVE_LOW\n  digitalWrite(pin, on ? LOW : HIGH);\n#else\n  digitalWrite(pin, on ? HIGH : LOW);\n#endif\n}\n\nvoid allOff() {\n  for (byte i = 0; i < PART_COUNT; i++) writePart(PARTS[i].pin, false);\n}\n\nvoid resetTimeline() {\n  for (byte i = 0; i < PART_COUNT; i++) PARTS[i].nextIndex = 0;\n  allOff();\n}\n\nvoid syncClock(uint32_t masterMs) {\n  const int32_t observed = (int32_t)(masterMs - millis());\n  if (!clockSynced) {\n    masterOffsetMs = observed;\n    clockSynced = true;\n    return;\n  }\n  const int32_t error = observed - masterOffsetMs;\n  masterOffsetMs += error / 4;\n}\n\nuint32_t masterNow() {\n  return (uint32_t)((int32_t)millis() + masterOffsetMs);\n}\n\nuint32_t packedEventRaw(const PartRuntime& p, uint16_t i) {\n  return (uint32_t)${readFn}(&p.frames[i]);\n}\n\nuint32_t frameTime(const PartRuntime& p, uint16_t i) {\n  return (packedEventRaw(p, i) >> 1) * EVENT_TICK_MS;\n}\n\nbool frameOn(const PartRuntime& p, uint16_t i) {\n  return (packedEventRaw(p, i) & 0x01U) != 0;\n}\n\nvoid updateTimeline(uint32_t elapsed) {\n  for (byte n = 0; n < PART_COUNT; n++) {\n    PartRuntime& p = PARTS[n];\n    while (p.nextIndex < p.frameCount && frameTime(p, p.nextIndex) <= elapsed) {\n      writePart(p.pin, frameOn(p, p.nextIndex));\n      p.nextIndex++;\n    }\n  }\n}\n\n// Safe SEEK: never replay missed relay transitions rapidly.\n// Calculate only the correct state at the current show position.\nvoid seekTimeline(uint32_t elapsed) {\n  for (byte n = 0; n < PART_COUNT; n++) {\n    PartRuntime& p = PARTS[n];\n    bool currentOn = false;\n    uint16_t i = 0;\n    while (i < p.frameCount && frameTime(p, i) <= elapsed) {\n      currentOn = frameOn(p, i);\n      i++;\n    }\n    writePart(p.pin, currentOn);\n    p.nextIndex = i;\n  }\n}\n\nvoid stopPlayback() {\n  playing = false;\n  allOff();\n}\n\nvoid armOrRejoin(uint16_t seq, uint32_t showStartMs) {\n  activeCueSeq = seq;\n  playbackStartMasterMs = showStartMs;\n  playing = true;\n\n  const uint32_t now = masterNow();\n  if ((int32_t)(now - playbackStartMasterMs) < 0) {\n    resetTimeline();\n    return;\n  }\n\n  const uint32_t elapsed = now - playbackStartMasterMs;\n  if (elapsed >= END_MS) {\n    stopPlayback();\n    return;\n  }\n\n  seekTimeline(elapsed);\n}\n\nvoid setup() {\n  for (byte i = 0; i < PART_COUNT; i++) pinMode(PARTS[i].pin, OUTPUT);\n  allOff();\n\n  if (!radio.begin()) while (1) { allOff(); delay(500); }\n  radio.setDataRate(RF24_250KBPS);\n  radio.setChannel(90);\n  radio.setPALevel(RF24_PA_HIGH);\n  radio.setCRCLength(RF24_CRC_16);\n  radio.setAddressWidth(5);\n  radio.openReadingPipe(0, UNIQUE_ADDRESS);\n  radio.openReadingPipe(1, BROADCAST_ADDRESS);\n  radio.setAutoAck(0, true);\n  radio.setAutoAck(1, false);\n  radio.startListening();\n}\n\nvoid loop() {\n  byte pipe = 0;\n  while (radio.available(&pipe)) {\n    RadioPacket p;\n    radio.read(&p, sizeof(p));\n    if (p.magic != MAGIC) continue;\n    if (p.target != 0 && p.target != RECEIVER_ID) continue;\n\n    if (p.type == CMD_PING) continue;\n\n    if (p.type == CMD_SYNC) {\n      syncClock(p.masterTimeMs);\n      continue;\n    }\n\n    if (p.type == CMD_STOP) {\n      syncClock(p.masterTimeMs);\n      activeCueSeq = p.seq;\n      stopPlayback();\n      continue;\n    }\n\n    if (p.type == CMD_START) {\n      syncClock(p.masterTimeMs);\n      if (!playing || p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) {\n        armOrRejoin(p.seq, p.showStartMasterMs);\n      }\n      continue;\n    }\n\n    if (p.type == CMD_SHOW_STATE) {\n      syncClock(p.masterTimeMs);\n      const bool masterPlaying = (p.flags & FLAG_PLAYING) != 0;\n      if (!masterPlaying) {\n        if (playing) stopPlayback();\n        activeCueSeq = p.seq;\n        continue;\n      }\n\n      if (!playing || p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) {\n        armOrRejoin(p.seq, p.showStartMasterMs);\n      }\n      continue;\n    }\n  }\n\n  if (!playing || !clockSynced) return;\n  const uint32_t now = masterNow();\n  if ((int32_t)(now - playbackStartMasterMs) < 0) return;\n\n  const uint32_t elapsed = now - playbackStartMasterMs;\n  if (elapsed >= END_MS) {\n    stopPlayback();\n    return;\n  }\n  updateTimeline(elapsed);\n}\n`;
}
