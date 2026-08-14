const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`stage firmware harden: ${label} anchor not found`)
  return source.replace(from, to)
}

export function hardenStageMasterFirmware(source) {
  let code = source

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

  const loopAnchor = `void loop() {
  pollSerial();
  const uint32_t now = millis();`
  code = replaceRequired(
    code,
    loopAnchor,
    `${loopAnchor}

  // HARD_END_GUARD: resolve PLAY before RF/telemetry work at the exact programmed end.
  if (showPlaying && SHOW_DURATION_MS > 0 && (int32_t)(now - showStartMasterMs) >= 0 && (now - showStartMasterMs) >= SHOW_DURATION_MS) {
    finishShow();
    return;
  }`,
    'master hard end guard'
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
