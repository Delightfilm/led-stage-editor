import { buildNrf24MasterSketch as buildProductionMasterSketch } from "./nrf24UnicastMasterCodegen.js";
import { buildNrf24ReceiverSketch as buildProductionReceiverSketch } from "./nrf24Pipe1Codegen.js";

const replaceStrict = (code, from, to, label) => {
  if (!code.includes(from)) throw new Error(`management firmware: ${label} anchor not found`);
  return code.replace(from, to);
};

const firstOnMsFromParts = (parts = []) => {
  let first = Number.POSITIVE_INFINITY;
  for (const part of parts) {
    for (const frame of part?.frames || []) {
      if (frame?.on) first = Math.min(first, Math.max(0, Math.round(Number(frame.t) || 0)));
    }
  }
  return Number.isFinite(first) ? first : null;
};

export function buildNrf24ManagementMasterSketch({ previewSafeLimitMs = 0, ...args } = {}) {
  let code = buildProductionMasterSketch(args);
  const safeLimit = Math.max(0, Math.round(Number(previewSafeLimitMs) || 0));

  code = replaceStrict(
    code,
    " * Missed START packets are recovered by periodic SHOW_STATE safe-rejoin messages.",
    " * Missed START packets are recovered by periodic SHOW_STATE safe-rejoin messages.\n * A/B dual mode: no PC = standalone A. PC HELLO + ARM_B = B.\n * Once LIVE START is accepted by an RX, its stored local timeline owns playback even if RF disappears.\n * PREVIEW commands are accepted only before LIVE and are clamped before the first real ON cue.",
    "master comment"
  );

  code = replaceStrict(
    code,
    "#define START_LEAD_MS 80UL",
    [
      "#define DEFAULT_START_LEAD_MS 80UL",
      "#define MAX_START_LEAD_MS 10000UL",
      `#define PREVIEW_SAFE_LIMIT_MS ${safeLimit}UL`,
      "#define SERIAL_BAUD 115200",
    ].join("\n"),
    "master timing defines"
  );

  code = replaceStrict(
    code,
    "const byte CMD_PING = 1, CMD_SYNC = 2, CMD_START = 3, CMD_STOP = 4, CMD_SHOW_STATE = 5;",
    [
      "const byte CMD_PING = 1, CMD_SYNC = 2, CMD_START = 3, CMD_STOP = 4, CMD_SHOW_STATE = 5;",
      "const byte CMD_PREVIEW_SEEK = 6, CMD_PREVIEW_PLAY = 7, CMD_PREVIEW_PAUSE = 8, CMD_PREVIEW_STOP = 9;",
    ].join("\n"),
    "master command ids"
  );

  code = replaceStrict(
    code,
    "bool lastStart = false;",
    [
      "bool lastStart = false;",
      "uint32_t runtimeStartLeadMs = DEFAULT_START_LEAD_MS;",
      "uint32_t armedOffsetMs = 0;",
      "bool pcHandshake = false;",
      "bool bArmed = false;",
      "char serialLine[64] = {0};",
      "byte serialLineLen = 0;",
    ].join("\n"),
    "master state"
  );

  const transportAnchor = [
    "void sendSync() { sendAllReceivers(CMD_SYNC, false, 1); }",
    "void sendShowState() { sendAllReceivers(CMD_SHOW_STATE, false, 1); }",
  ].join("\n");
  const transportWithPreview = [
    transportAnchor,
    "",
    "uint32_t clampPreviewElapsed(uint32_t elapsedMs) {",
    "  if (PREVIEW_SAFE_LIMIT_MS == 0) return 0;",
    "  const uint32_t maxSafe = PREVIEW_SAFE_LIMIT_MS - 1;",
    "  return elapsedMs > maxSafe ? maxSafe : elapsedMs;",
    "}",
    "",
    "void sendPreviewAll(byte type, uint32_t elapsedMs, byte repeats = 2) {",
    "  if (showPlaying) return;",
    "  elapsedMs = clampPreviewElapsed(elapsedMs);",
    "  for (byte i = 0; i < RECEIVER_COUNT; i++) {",
    "    radio.stopListening();",
    "    radio.openWritingPipe(RECEIVER_ADDRESSES[i]);",
    "    for (byte r = 0; r < repeats; r++) {",
    "      RadioPacket p = makePacket(type, i + 1);",
    "      p.masterTimeMs = millis();",
    "      p.flags = 0;",
    "      p.seq = cueSeq;",
    "      // PREVIEW only: reuse showStartMasterMs as elapsed timeline position.",
    "      p.showStartMasterMs = elapsedMs;",
    "      radio.write(&p, sizeof(p), true);",
    "      if (repeats > 1) delay(1);",
    "    }",
    "  }",
    "}",
  ].join("\n");
  code = replaceStrict(code, transportAnchor, transportWithPreview, "master preview transport");

  const oldStart = [
    "void sendStart() {",
    "  cueSeq++;",
    "  showStartMasterMs = millis() + START_LEAD_MS;",
    "  showPlaying = true;",
    "  // Low-latency show trigger: one shared START is repeated quickly without ACK waits.",
    "  // If a receiver misses all START copies, periodic SHOW_STATE will safe-rejoin it.",
    "  sendBroadcastNoAck(CMD_START, 5);",
    "  lastShowStateMs = 0;",
    "}",
  ].join("\n");
  const newStart = [
    "void sendStartFromOffset(uint32_t offsetMs) {",
    "  cueSeq++;",
    "  if (SHOW_DURATION_MS > 0 && offsetMs >= SHOW_DURATION_MS) offsetMs = SHOW_DURATION_MS - 1;",
    "  // Effective show anchor can be in the past when B starts from a pre-roll offset.",
    "  // RX arithmetic is uint32 wrap-safe for these short show durations.",
    "  showStartMasterMs = millis() + runtimeStartLeadMs - offsetMs;",
    "  showPlaying = true;",
    "  // Shared START x5, then two unique NO_ACK copies per RX. This improves delivery probability",
    "  // without making LIVE timing depend on ACK success. SHOW_STATE remains the safe-rejoin path.",
    "  sendBroadcastNoAck(CMD_START, 5);",
    "  sendAllReceivers(CMD_START, false, 2);",
    "  lastShowStateMs = 0;",
    "}",
    "",
    "void sendStart() { sendStartFromOffset(0); }",
  ].join("\n");
  code = replaceStrict(code, oldStart, newStart, "master live start");

  const oldFinish = [
    "void finishShow() {",
    "  cueSeq++;",
    "  showPlaying = false;",
    "  showStartMasterMs = 0;",
    "  sendAllReceivers(CMD_STOP, true, 2);",
    "  lastShowStateMs = 0;",
    "}",
  ].join("\n");
  const newFinish = [
    "void finishShow() {",
    "  cueSeq++;",
    "  showPlaying = false;",
    "  showStartMasterMs = 0;",
    "  bArmed = false;",
    "  sendAllReceivers(CMD_STOP, true, 2);",
    "  lastShowStateMs = 0;",
    "  if (pcHandshake) Serial.println(\"LIVE_FINISHED\");",
    "}",
  ].join("\n");
  code = replaceStrict(code, oldFinish, newFinish, "master finish");

  const oldRequestStart = [
    "void requestStart() {",
    "  // Once a show is running, physical switch movement must not interrupt",
    "  // or restart the timeline. The next start is allowed only after natural finish.",
    "  if (showPlaying) return;",
    "",
    "  // Start the show even if some receivers are currently offline.",
    "  // A receiver that reconnects later uses SHOW_STATE to seek to the current position.",
    "  sendStart();",
    "}",
  ].join("\n");
  const newRequestStart = [
    "void requestStart() {",
    "  // Once a LIVE show is running, neither D2 nor PC preview may interrupt it.",
    "  if (showPlaying) return;",
    "",
    "  // A = standalone, always starts from timeline 0.",
    "  // B = only after an explicit ARM_B from the PC; D2 then starts from that pre-roll offset.",
    "  const uint32_t offsetMs = (pcHandshake && bArmed) ? armedOffsetMs : 0;",
    "  sendStartFromOffset(offsetMs);",
    "  bArmed = false;",
    "  if (pcHandshake) {",
    "    Serial.print(\"LIVE_STARTED \" );",
    "    Serial.println(offsetMs);",
    "  }",
    "}",
  ].join("\n");
  code = replaceStrict(code, oldRequestStart, newRequestStart, "master D2 start");

  const setupAnchor = "void setup() {\n  pinMode(START_PIN, INPUT_PULLUP);";
  const serialFunctions = [
    "uint32_t parseSerialUInt(const char* p) {",
    "  while (*p == ' ') p++;",
    "  return (uint32_t)strtoul(p, nullptr, 10);",
    "}",
    "",
    "void printStatusSerial() {",
    "  Serial.print(\"STATUS mode=\");",
    "  Serial.print((pcHandshake && bArmed) ? \"B_ARMED\" : (pcHandshake ? \"B_CONNECTED\" : \"A\"));",
    "  Serial.print(\" live=\"); Serial.print(showPlaying ? 1 : 0);",
    "  Serial.print(\" delay=\"); Serial.print(runtimeStartLeadMs);",
    "  Serial.print(\" offset=\"); Serial.print(armedOffsetMs);",
    "  Serial.print(\" ready=\"); Serial.print(readyCount());",
    "  Serial.print('/'); Serial.println(RECEIVER_COUNT);",
    "}",
    "",
    "void processSerialLine(char* line) {",
    "  if (!line[0]) return;",
    "",
    "  if (strcmp(line, \"HELLO LSM-B1\") == 0 || strcmp(line, \"HELLO\") == 0) {",
    "    pcHandshake = true;",
    "    Serial.println(\"LSM_READY LSM-B1 AB_DUAL\");",
    "    printStatusSerial();",
    "    return;",
    "  }",
    "  if (strcmp(line, \"PING\") == 0) {",
    "    Serial.print(\"PONG \" ); Serial.println(millis());",
    "    return;",
    "  }",
    "  if (strcmp(line, \"STATUS\") == 0) { printStatusSerial(); return; }",
    "",
    "  if (strncmp(line, \"SET_DELAY \" , 10) == 0) {",
    "    uint32_t value = parseSerialUInt(line + 10);",
    "    if (value > MAX_START_LEAD_MS) value = MAX_START_LEAD_MS;",
    "    runtimeStartLeadMs = value;",
    "    pcHandshake = true;",
    "    Serial.print(\"DELAY_OK \" ); Serial.println(runtimeStartLeadMs);",
    "    return;",
    "  }",
    "",
    "  if (strncmp(line, \"SEEK \" , 5) == 0) {",
    "    if (showPlaying) { Serial.println(\"BUSY LIVE\"); return; }",
    "    const uint32_t value = clampPreviewElapsed(parseSerialUInt(line + 5));",
    "    sendPreviewAll(CMD_PREVIEW_SEEK, value, 2);",
    "    Serial.print(\"SEEK_OK \" ); Serial.println(value);",
    "    return;",
    "  }",
    "  if (strncmp(line, \"PREVIEW_PLAY \" , 13) == 0) {",
    "    if (showPlaying) { Serial.println(\"BUSY LIVE\"); return; }",
    "    const uint32_t value = clampPreviewElapsed(parseSerialUInt(line + 13));",
    "    sendPreviewAll(CMD_PREVIEW_PLAY, value, 2);",
    "    Serial.print(\"PREVIEW_PLAY_OK \" ); Serial.println(value);",
    "    return;",
    "  }",
    "  if (strcmp(line, \"PREVIEW_PAUSE\") == 0) {",
    "    if (showPlaying) { Serial.println(\"BUSY LIVE\"); return; }",
    "    sendPreviewAll(CMD_PREVIEW_PAUSE, 0, 2);",
    "    Serial.println(\"PREVIEW_PAUSE_OK\");",
    "    return;",
    "  }",
    "  if (strcmp(line, \"PREVIEW_STOP\") == 0) {",
    "    if (showPlaying) { Serial.println(\"BUSY LIVE\"); return; }",
    "    sendPreviewAll(CMD_PREVIEW_STOP, 0, 2);",
    "    bArmed = false;",
    "    Serial.println(\"PREVIEW_STOP_OK\");",
    "    return;",
    "  }",
    "",
    "  if (strncmp(line, \"ARM_B \" , 6) == 0) {",
    "    if (showPlaying) { Serial.println(\"BUSY LIVE\"); return; }",
    "    pcHandshake = true;",
    "    armedOffsetMs = clampPreviewElapsed(parseSerialUInt(line + 6));",
    "    bArmed = true;",
    "    sendPreviewAll(CMD_PREVIEW_SEEK, armedOffsetMs, 2);",
    "    Serial.print(\"ARM_OK \" ); Serial.print(armedOffsetMs);",
    "    Serial.print(' '); Serial.println(runtimeStartLeadMs);",
    "    return;",
    "  }",
    "  if (strcmp(line, \"DISARM_B\") == 0 || strcmp(line, \"MODE_A\") == 0) {",
    "    bArmed = false;",
    "    sendPreviewAll(CMD_PREVIEW_STOP, 0, 2);",
    "    Serial.println(\"MODE_A_READY\");",
    "    return;",
    "  }",
    "  if (strncmp(line, \"LIVE_START \" , 11) == 0) {",
    "    if (showPlaying) { Serial.println(\"BUSY LIVE\"); return; }",
    "    pcHandshake = true;",
    "    const uint32_t value = clampPreviewElapsed(parseSerialUInt(line + 11));",
    "    bArmed = false;",
    "    sendStartFromOffset(value);",
    "    Serial.print(\"LIVE_STARTED \" ); Serial.println(value);",
    "    return;",
    "  }",
    "",
    "  Serial.print(\"ERR UNKNOWN \" ); Serial.println(line);",
    "}",
    "",
    "void pollSerial() {",
    "  while (Serial.available() > 0) {",
    "    const char c = (char)Serial.read();",
    "    if (c == '\\r') continue;",
    "    if (c == '\\n') {",
    "      serialLine[serialLineLen] = 0;",
    "      processSerialLine(serialLine);",
    "      serialLineLen = 0;",
    "      serialLine[0] = 0;",
    "      continue;",
    "    }",
    "    if (serialLineLen < sizeof(serialLine) - 1) serialLine[serialLineLen++] = c;",
    "  }",
    "}",
    "",
    "void setup() {",
    "  Serial.begin(SERIAL_BAUD);",
    "  pinMode(START_PIN, INPUT_PULLUP);",
  ].join("\n");
  code = replaceStrict(code, setupAnchor, serialFunctions, "master serial protocol");

  const setupReadyAnchor = [
    "  delay(300);",
    "  lcd.clear();",
    "  drawLcd();",
    "}",
  ].join("\n");
  code = replaceStrict(
    code,
    setupReadyAnchor,
    [
      "  delay(300);",
      "  lcd.clear();",
      "  drawLcd();",
      "  Serial.println(\"LSM_READY LSM-B1 AB_DUAL\");",
      "}",
    ].join("\n"),
    "master serial ready"
  );

  code = replaceStrict(
    code,
    "void loop() {\n  const uint32_t now = millis();",
    "void loop() {\n  pollSerial();\n  const uint32_t now = millis();",
    "master loop serial"
  );

  return code;
}

export function buildNrf24ManagementReceiverSketch(args = {}) {
  let code = buildProductionReceiverSketch(args);
  const firstOn = firstOnMsFromParts(args.parts || []);
  const endMs = Math.max(0, ...(args.parts || []).map((p) => Math.max(0, Math.round(Number(p?.endMs) || 0))));
  const safeLimit = firstOn == null ? Math.max(1, endMs) : Math.max(0, firstOn);

  code = replaceStrict(
    code,
    " * RF holdover: once START is accepted, the local timeline keeps running even if RF disappears.",
    " * RF holdover: once LIVE START is accepted, the stored local timeline keeps running even if RF disappears.\n * PREVIEW is pre-show only and can never cross the first real ON cue.",
    "receiver comment"
  );

  code = replaceStrict(
    code,
    "#define SHOW_HASH ",
    "#define PREVIEW_SAFE_LIMIT_MS " + safeLimit + "UL\n#define SHOW_HASH ",
    "receiver preview limit"
  );

  code = replaceStrict(
    code,
    "const byte CMD_PING = 1, CMD_SYNC = 2, CMD_START = 3, CMD_STOP = 4, CMD_SHOW_STATE = 5;",
    [
      "const byte CMD_PING = 1, CMD_SYNC = 2, CMD_START = 3, CMD_STOP = 4, CMD_SHOW_STATE = 5;",
      "const byte CMD_PREVIEW_SEEK = 6, CMD_PREVIEW_PLAY = 7, CMD_PREVIEW_PAUSE = 8, CMD_PREVIEW_STOP = 9;",
    ].join("\n"),
    "receiver command ids"
  );

  code = replaceStrict(
    code,
    "uint32_t lastElapsedMs = 0;",
    [
      "uint32_t lastElapsedMs = 0;",
      "const byte PREVIEW_OFF = 0, PREVIEW_HOLD = 1, PREVIEW_RUNNING = 2;",
      "byte previewState = PREVIEW_OFF;",
      "uint32_t previewBaseElapsedMs = 0;",
      "uint32_t previewAnchorLocalMs = 0;",
    ].join("\n"),
    "receiver preview state"
  );

  code = replaceStrict(
    code,
    [
      "void stopPlayback() {",
      "  playing = false;",
      "  lastElapsedMs = 0;",
      "  allOff();",
      "}",
    ].join("\n"),
    [
      "void stopPlayback() {",
      "  playing = false;",
      "  previewState = PREVIEW_OFF;",
      "  lastElapsedMs = 0;",
      "  allOff();",
      "}",
    ].join("\n"),
    "receiver stop live"
  );

  code = replaceStrict(
    code,
    "void armOrRejoin(uint16_t seq, uint32_t showStartMs) {\n  activeCueSeq = seq;",
    "void armOrRejoin(uint16_t seq, uint32_t showStartMs) {\n  previewState = PREVIEW_OFF;\n  activeCueSeq = seq;",
    "receiver live overrides preview"
  );

  const setupAnchor = "void setup() {";
  const previewRuntime = [
    "uint32_t clampPreviewElapsed(uint32_t elapsedMs) {",
    "  if (PREVIEW_SAFE_LIMIT_MS == 0) return 0;",
    "  const uint32_t maxSafe = PREVIEW_SAFE_LIMIT_MS - 1;",
    "  return elapsedMs > maxSafe ? maxSafe : elapsedMs;",
    "}",
    "",
    "void previewSeek(uint32_t elapsedMs) {",
    "  if (playing) return;",
    "  if (PREVIEW_SAFE_LIMIT_MS == 0) { previewState = PREVIEW_HOLD; previewBaseElapsedMs = 0; resetTimeline(); return; }",
    "  previewBaseElapsedMs = clampPreviewElapsed(elapsedMs);",
    "  previewState = PREVIEW_HOLD;",
    "  seekTimeline(previewBaseElapsedMs);",
    "}",
    "",
    "void previewPlay(uint32_t elapsedMs) {",
    "  if (playing) return;",
    "  if (PREVIEW_SAFE_LIMIT_MS == 0) { previewSeek(0); return; }",
    "  previewBaseElapsedMs = clampPreviewElapsed(elapsedMs);",
    "  previewAnchorLocalMs = millis();",
    "  previewState = PREVIEW_RUNNING;",
    "  seekTimeline(previewBaseElapsedMs);",
    "}",
    "",
    "void previewPause() {",
    "  if (playing || previewState != PREVIEW_RUNNING) return;",
    "  uint32_t elapsed = previewBaseElapsedMs + (millis() - previewAnchorLocalMs);",
    "  elapsed = clampPreviewElapsed(elapsed);",
    "  previewBaseElapsedMs = elapsed;",
    "  previewState = PREVIEW_HOLD;",
    "  seekTimeline(elapsed);",
    "}",
    "",
    "void previewStop() {",
    "  if (playing) return;",
    "  previewState = PREVIEW_OFF;",
    "  previewBaseElapsedMs = 0;",
    "  resetTimeline();",
    "}",
    "",
    "void runPreviewTimeline() {",
    "  if (playing || previewState != PREVIEW_RUNNING) return;",
    "  if (PREVIEW_SAFE_LIMIT_MS == 0) { previewStop(); return; }",
    "  uint32_t elapsed = previewBaseElapsedMs + (millis() - previewAnchorLocalMs);",
    "  if (elapsed >= PREVIEW_SAFE_LIMIT_MS) {",
    "    previewBaseElapsedMs = PREVIEW_SAFE_LIMIT_MS - 1;",
    "    previewState = PREVIEW_HOLD;",
    "    seekTimeline(previewBaseElapsedMs);",
    "    return;",
    "  }",
    "  updateTimeline(elapsed);",
    "}",
    "",
    "void setup() {",
  ].join("\n");
  code = replaceStrict(code, setupAnchor, previewRuntime, "receiver preview runtime");

  code = replaceStrict(
    code,
    "  // Timeline has priority over radio handling. Even a wedged/noisy nRF cannot starve playback.\n  runLocalTimeline();",
    "  // Timeline has priority over radio handling. Even a wedged/noisy nRF cannot starve playback.\n  runLocalTimeline();\n  runPreviewTimeline();",
    "receiver loop preview priority"
  );

  const pingAnchor = [
    "    if (p.type == CMD_PING) {",
    "      // The preloaded ACK payload was consumed by this PING. Refill it for the next PING.",
    "      loadStatusAck();",
    "      continue;",
    "    }",
  ].join("\n");
  const previewHandlers = [
    pingAnchor,
    "",
    "    // PREVIEW is intentionally ignored once LIVE has started.",
    "    if (p.type == CMD_PREVIEW_SEEK) { if (!playing) previewSeek(p.showStartMasterMs); continue; }",
    "    if (p.type == CMD_PREVIEW_PLAY) { if (!playing) previewPlay(p.showStartMasterMs); continue; }",
    "    if (p.type == CMD_PREVIEW_PAUSE) { if (!playing) previewPause(); continue; }",
    "    if (p.type == CMD_PREVIEW_STOP) { if (!playing) previewStop(); continue; }",
  ].join("\n");
  code = replaceStrict(code, pingAnchor, previewHandlers, "receiver preview handlers");

  code = replaceStrict(
    code,
    "      if (!playing) { activeCueSeq = p.seq; allOff(); }",
    "      if (!playing && previewState == PREVIEW_OFF) { activeCueSeq = p.seq; allOff(); }",
    "receiver STOP preview isolation"
  );

  code = code.replaceAll(
    "        if (!playing) { activeCueSeq = p.seq; allOff(); }",
    "        if (!playing && previewState == PREVIEW_OFF) { activeCueSeq = p.seq; allOff(); }"
  );

  code = replaceStrict(
    code,
    "  // Run again after RF work so dense packet bursts cannot delay relay events.\n  runLocalTimeline();",
    "  // Run again after RF work so dense packet bursts cannot delay relay events.\n  runLocalTimeline();\n  runPreviewTimeline();",
    "receiver loop preview tail"
  );

  return code;
}
