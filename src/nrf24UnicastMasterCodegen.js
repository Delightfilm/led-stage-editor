import { buildNrf24MasterSketch as buildBaseMasterSketch } from "./nrf24MasterSafetyCodegen.js";

export function buildNrf24MasterSketch(args) {
  let code = buildBaseMasterSketch(args);

  code = code.replace(
    " * RF FIX: broadcast packets use per-packet NO_ACK. AutoAck/ACK-payload stays enabled for link PINGs.",
    " * RF MODE: START uses a low-latency ELCMD broadcast with per-packet NO_ACK.\n * STOP uses each RX unique address with AutoAck; periodic SYNC/SHOW_STATE use per-packet NO_ACK on each unique address.\n * Missed START packets are recovered by periodic SHOW_STATE safe-rejoin messages."
  );

  code = code.replace(
    "#define START_LEAD_MS 300UL",
    "#define START_LEAD_MS 80UL"
  );

  const oldTransport = `void broadcastPacket(byte type, byte repeats = 1) {
  radio.stopListening();
  radio.openWritingPipe(BROADCAST_ADDRESS);

  RadioPacket p = makePacket(type, 0);
  for (byte i = 0; i < repeats; i++) {
    p.masterTimeMs = millis();
    p.flags = showPlaying ? FLAG_PLAYING : 0;
    p.seq = cueSeq;
    p.showStartMasterMs = showStartMasterMs;

    // multicast=true sends this ONE packet with NO_ACK while preserving
    // AutoAck + ACK-payload configuration for the individual PINGs.
    radio.write(&p, sizeof(p), true);
    if (repeats > 1) delay(3);
  }
}

void sendSync() { broadcastPacket(CMD_SYNC); }
void sendShowState() { broadcastPacket(CMD_SHOW_STATE); }`;

  const newTransport = `void drainAckPayload() {
  while (radio.isAckPayloadAvailable()) {
    ReceiverStatus ignored = {};
    radio.read(&ignored, sizeof(ignored));
  }
}

bool sendToReceiver(byte i, byte type, bool requestAck, byte repeats = 1) {
  radio.stopListening();
  radio.openWritingPipe(RECEIVER_ADDRESSES[i]);
  if (requestAck) radio.setRetries(3, 5);

  bool anyOk = false;
  for (byte r = 0; r < repeats; r++) {
    RadioPacket p = makePacket(type, i + 1);
    p.masterTimeMs = millis();
    p.flags = showPlaying ? FLAG_PLAYING : 0;
    p.seq = cueSeq;
    p.showStartMasterMs = showStartMasterMs;

    const bool ok = requestAck
      ? radio.write(&p, sizeof(p))
      : radio.write(&p, sizeof(p), true);

    if (requestAck) drainAckPayload();
    anyOk = anyOk || ok;
    if (repeats > 1) delay(2);
  }
  return anyOk;
}

void sendAllReceivers(byte type, bool requestAck = false, byte repeats = 1) {
  for (byte i = 0; i < RECEIVER_COUNT; i++) {
    sendToReceiver(i, type, requestAck, repeats);
  }
}

void sendBroadcastNoAck(byte type, byte repeats = 1) {
  radio.stopListening();
  radio.openWritingPipe(BROADCAST_ADDRESS);

  RadioPacket p = makePacket(type, 0);
  for (byte r = 0; r < repeats; r++) {
    p.masterTimeMs = millis();
    p.flags = showPlaying ? FLAG_PLAYING : 0;
    p.seq = cueSeq;
    p.showStartMasterMs = showStartMasterMs;
    // The shared START packet is intentionally sent without waiting for ACKs.
    // All receivers get the same future showStartMasterMs, preserving sync.
    radio.write(&p, sizeof(p), true);
    if (repeats > 1) delay(2);
  }
}

void sendSync() { sendAllReceivers(CMD_SYNC, false, 1); }
void sendShowState() { sendAllReceivers(CMD_SHOW_STATE, false, 1); }`;

  if (!code.includes(oldTransport)) {
    throw new Error("unicast master codegen: transport anchor not found");
  }
  code = code.replace(oldTransport, newTransport);

  code = code.replace(
    "  broadcastPacket(CMD_START, 5);",
    "  // Low-latency show trigger: one shared START is repeated quickly without ACK waits.\n  // If a receiver misses all START copies, periodic SHOW_STATE will safe-rejoin it.\n  sendBroadcastNoAck(CMD_START, 5);"
  );

  code = code.replace(
    "  broadcastPacket(CMD_STOP, 5);",
    "  sendAllReceivers(CMD_STOP, true, 2);"
  );

  return code;
}
