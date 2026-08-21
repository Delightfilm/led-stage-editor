const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`stage firmware harden: ${label} anchor not found`)
  return source.replace(from, to)
}

export function hardenStageMasterFirmware(source) {
  let code = source

  code = replaceRequired(
    code,
    '#include <LiquidCrystal_I2C.h>',
    '#include <LiquidCrystal_I2C.h>\n#include <avr/wdt.h>',
    'master watchdog include'
  )

  code = replaceRequired(
    code,
    '#define TELEMETRY_INTERVAL_MS 500UL',
    '#define TELEMETRY_INTERVAL_MS 1000UL',
    'master telemetry rate'
  )

  code = replaceRequired(
    code,
    '#define LINK_SCAN_INTERVAL_MS 60UL',
    '#define LINK_SCAN_INTERVAL_MS 100UL',
    'master link scan rate'
  )

  if (!code.includes('radio.setRetries(3, 5);')) {
    throw new Error('stage firmware harden: master RF retry anchor not found')
  }
  code = code.replaceAll('radio.setRetries(3, 5);', 'radio.setRetries(1, 3);')

  code = replaceRequired(
    code,
    '  if (pcHandshake) { Serial.print("RXPULSE " ); Serial.println(i + 1); }',
    '  // Do not emit one Serial line per RF ping. RXMON is throttled and carries the same data.',
    'master RXPULSE flood removal'
  )

  code = replaceRequired(
    code,
    'void printRxMonitorSerial() {\n  const uint32_t now = millis();',
    'void printRxMonitorSerial() {\n  if (!pcHandshake || Serial.availableForWrite() < 32) return;\n  const uint32_t now = millis();',
    'master telemetry backpressure'
  )

  code = replaceRequired(
    code,
    'bool lastStart = false;',
    'bool lastStart = false;\nbool startRawState = false;\nuint32_t startRawChangedMs = 0;',
    'master nonblocking start state'
  )

  code = replaceRequired(
    code,
    'const byte CMD_PREVIEW_SEEK = 6, CMD_PREVIEW_PLAY = 7, CMD_PREVIEW_PAUSE = 8, CMD_PREVIEW_STOP = 9;',
    'const byte CMD_PREVIEW_SEEK = 6, CMD_PREVIEW_PLAY = 7, CMD_PREVIEW_PAUSE = 8, CMD_PREVIEW_STOP = 9;\nconst byte CMD_FORCE_STOP = 10;',
    'master force-stop command'
  )

  const oldFinish = `void finishShow() {
  cueSeq++;
  showPlaying = false;
  showStartMasterMs = 0;
  bArmed = false;
  sendAllReceivers(CMD_STOP, true, 2);
  lastShowStateMs = 0;
  if (pcHandshake) Serial.println("LIVE_FINISHED");
}`

  const newFinish = `void finishShow() {
  cueSeq++;
  showPlaying = false;
  showStartMasterMs = 0;
  liveOffsetMs = 0;
  liveGoMasterMs = 0;
  armedOffsetMs = 0;
  bArmed = false;
  // Natural completion is a real terminal state: force every RX OFF, then advertise READY immediately.
  sendBroadcastNoAck(CMD_FORCE_STOP, 6);
  sendAllReceivers(CMD_FORCE_STOP, false, 2);
  lastShowStateMs = 0;
  drawLcd();
  if (pcHandshake) Serial.println("LIVE_FINISHED");
}

void forceStopShow() {
  cueSeq++;
  showPlaying = false;
  showStartMasterMs = 0;
  liveOffsetMs = 0;
  liveGoMasterMs = 0;
  armedOffsetMs = 0;
  bArmed = false;
  sendBroadcastNoAck(CMD_FORCE_STOP, 6);
  sendAllReceivers(CMD_FORCE_STOP, false, 3);
  lastShowStateMs = 0;
  drawLcd();
}`
  code = replaceRequired(code, oldFinish, newFinish, 'master finishShow')

  code = replaceRequired(
    code,
    'void sendStart() { sendStartFromOffset(0); }',
    `void sendStart() { sendStartFromOffset(0); }

void sendStartFromOffsetNow(uint32_t offsetMs) {
  const uint32_t savedLeadMs = runtimeStartLeadMs;
  runtimeStartLeadMs = 0;
  sendStartFromOffset(offsetMs);
  runtimeStartLeadMs = savedLeadMs;
}`,
    'master immediate start helper'
  )

  code = replaceRequired(
    code,
    '  sendAllReceivers(CMD_STOP, true, 3);',
    `  sendBroadcastNoAck(CMD_FORCE_STOP, 6);
  sendAllReceivers(CMD_FORCE_STOP, false, 3);
  drawLcd();`,
    'master early stop transport'
  )

  code = replaceRequired(
    code,
    'uint32_t parseSerialUInt(const char* p) {',
    `void pollStartSwitchFast() {
  const bool raw = digitalRead(START_PIN) == LOW;
  const uint32_t now = millis();
  if (raw != startRawState) {
    startRawState = raw;
    startRawChangedMs = now;
    return;
  }
  if (raw != lastStart && now - startRawChangedMs >= 20UL) {
    lastStart = raw;
    if (raw) requestStart();
  }
}

uint32_t parseSerialUInt(const char* p) {`,
    'master fast start poller'
  )

  code = replaceRequired(
    code,
    'void pollSerial() {\n  while (Serial.available() > 0) {',
    'void pollSerial() {\n  byte serialBudget = 24;\n  while (serialBudget-- > 0 && Serial.available() > 0) {',
    'master serial work budget'
  )

  code = replaceRequired(
    code,
    'void setup() {\n  Serial.begin(SERIAL_BAUD);',
    'void setup() {\n  MCUSR = 0;\n  wdt_disable();\n  Serial.begin(SERIAL_BAUD);',
    'master watchdog setup start'
  )

  code = replaceRequired(
    code,
    '  lastStart = digitalRead(START_PIN) == LOW;',
    '  lastStart = digitalRead(START_PIN) == LOW;\n  startRawState = lastStart;\n  startRawChangedMs = millis();',
    'master start debounce init'
  )

  code = replaceRequired(
    code,
    '  Serial.println("LSM_READY LSM-B1 AB_DUAL");\n}',
    '  Serial.println("LSM_READY LSM-B1 AB_DUAL");\n  wdt_enable(WDTO_2S);\n  wdt_reset();\n}',
    'master watchdog enable'
  )

  const liveStartAnchor = '  if (strncmp(line, "LIVE_START " , 11) == 0) {'
  const extraCommands = `  if (strcmp(line, "LIVE_FORCE_STOP") == 0) {
    if (showPlaying) forceStopShow();
    else { bArmed = false; drawLcd(); }
    Serial.println("LIVE_FORCE_STOPPED");
    return;
  }

  if (strncmp(line, "LIVE_START_NOW " , 15) == 0) {
    if (showPlaying) { Serial.println("BUSY LIVE"); return; }
    pcHandshake = true;
    uint32_t value = parseSerialUInt(line + 15);
    if (SHOW_DURATION_MS > 0 && value >= SHOW_DURATION_MS) value = SHOW_DURATION_MS - 1;
    bArmed = false;
    sendStartFromOffsetNow(value);
    Serial.print("LIVE_STARTED " ); Serial.print(value); Serial.print(' '); Serial.println(livePositionNow());
    return;
  }

${liveStartAnchor}`
  code = replaceRequired(code, liveStartAnchor, extraCommands, 'master live serial commands')

  code = replaceRequired(
    code,
    '\n  if (now - lastShowStateMs >= SHOW_STATE_INTERVAL_MS) {',
    '\n  else if (now - lastShowStateMs >= SHOW_STATE_INTERVAL_MS) {',
    'master stagger show-state RF work'
  )

  code = replaceRequired(
    code,
    '\n  if (now - lastScanMs >= LINK_SCAN_INTERVAL_MS) {',
    '\n  else if (now - lastScanMs >= LINK_SCAN_INTERVAL_MS) {',
    'master stagger link-scan RF work'
  )

  const oldStartTail = `  const bool start = digitalRead(START_PIN) == LOW;
  if (start != lastStart) {
    delay(20);
    const bool v = digitalRead(START_PIN) == LOW;
    if (v != lastStart) {
      lastStart = v;
      if (v) requestStart();  // OFF -> ON only
      // ON -> OFF only rearms the physical switch; it never sends STOP.
    }
  }`
  code = replaceRequired(
    code,
    oldStartTail,
    '  pollStartSwitchFast();\n  wdt_reset();',
    'master blocking D2 debounce removal'
  )

  const loopAnchor = `void loop() {
  pollSerial();
  const uint32_t now = millis();`
  code = replaceRequired(
    code,
    loopAnchor,
    `void loop() {
  // Physical START is the highest-priority path. It is sampled before and after
  // bounded Serial work so RF diagnostics can never starve D2.
  pollStartSwitchFast();
  pollSerial();
  pollStartSwitchFast();
  wdt_reset();
  const uint32_t now = millis();

  // HARD_END_GUARD: resolve PLAY before RF/telemetry work at the exact programmed end.
  if (showPlaying && SHOW_DURATION_MS > 0 && (int32_t)(now - showStartMasterMs) >= 0 && (now - showStartMasterMs) >= SHOW_DURATION_MS) {
    finishShow();
    wdt_reset();
    return;
  }`,
    'master hard end + fast-input guard'
  )

  return code
}

export function hardenStageReceiverFirmware(source) {
  let code = source
  code = replaceRequired(
    code,
    'const byte CMD_PREVIEW_SEEK = 6, CMD_PREVIEW_PLAY = 7, CMD_PREVIEW_PAUSE = 8, CMD_PREVIEW_STOP = 9;',
    'const byte CMD_PREVIEW_SEEK = 6, CMD_PREVIEW_PLAY = 7, CMD_PREVIEW_PAUSE = 8, CMD_PREVIEW_STOP = 9;\nconst byte CMD_FORCE_STOP = 10;',
    'receiver force-stop command'
  )

  const previewAnchor = '    // PREVIEW is intentionally ignored once LIVE has started.'
  code = replaceRequired(
    code,
    previewAnchor,
    `    // Rehearsal force-stop and natural show completion must always win over local LIVE holdover.
    if (p.type == CMD_FORCE_STOP) { activeCueSeq = p.seq; stopPlayback(); continue; }

${previewAnchor}`,
    'receiver force-stop handler'
  )
  return code
}
