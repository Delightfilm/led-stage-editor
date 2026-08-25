const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`stable A clock v0.6.3: ${label} anchor not found`)
  return source.replace(from, to)
}

export function applyStableAClockMasterV063(source) {
  let code = source

  code = replaceRequired(
    code,
    '#define SERIAL_BAUD 115200',
    '#define SERIAL_BAUD 115200\n#define A_CLOCK_RESERVE_MS 100UL',
    'master reserve define'
  )

  code = replaceRequired(
    code,
    'const byte CMD_PREVIEW_SEEK = 6, CMD_PREVIEW_PLAY = 7, CMD_PREVIEW_PAUSE = 8, CMD_PREVIEW_STOP = 9;\nconst byte CMD_FORCE_STOP = 10;',
    'const byte CMD_PREVIEW_SEEK = 6, CMD_PREVIEW_PLAY = 7, CMD_PREVIEW_PAUSE = 8, CMD_PREVIEW_STOP = 9;\nconst byte CMD_FORCE_STOP = 10;\nconst byte CMD_A_SCHEDULE = 11;',
    'master A schedule command id'
  )

  code = replaceRequired(
    code,
    'byte serialLineLen = 0;',
    [
      'byte serialLineLen = 0;',
      'bool aClockPending = false;',
      'uint16_t aClockPendingSeq = 0;',
      'uint32_t aClockGoMasterMs = 0;',
      'uint32_t aClockAnchorMasterMs = 0;',
      'uint32_t aClockTargetOffsetMs = 0;',
    ].join('\n'),
    'master A schedule state'
  )

  const syncAnchor = 'void sendSync() { sendAllReceivers(CMD_SYNC, false, 1); }'
  const scheduleTransport = `void sendAClockSchedulePackets(uint16_t scheduleSeq, uint32_t scheduleMasterMs, uint32_t anchorMasterMs) {
  // Every copy carries the exact same epoch. Packet arrival time is never the GO time.
  RadioPacket p = makePacket(CMD_A_SCHEDULE, 0);
  p.masterTimeMs = scheduleMasterMs;
  p.flags = FLAG_PLAYING;
  p.seq = scheduleSeq;
  p.showStartMasterMs = anchorMasterMs;

  radio.stopListening();
  radio.openWritingPipe(BROADCAST_ADDRESS);
  for (byte r = 0; r < 8; r++) {
    p.target = 0;
    radio.write(&p, sizeof(p), true);
    if (r < 7) delay(1);
  }

  // Deterministic NO_ACK backup copies for every RX. These are sent before the
  // reserved GO epoch; a late unique copy still arms the exact same future epoch.
  for (byte i = 0; i < RECEIVER_COUNT; i++) {
    radio.stopListening();
    radio.openWritingPipe(RECEIVER_ADDRESSES[i]);
    p.target = i + 1;
    for (byte r = 0; r < 2; r++) {
      radio.write(&p, sizeof(p), true);
      if (r == 0) delay(1);
    }
  }
}

${syncAnchor}`
  code = replaceRequired(code, syncAnchor, scheduleTransport, 'master A schedule transport')

  const immediateHelper = `void sendStartFromOffsetNow(uint32_t offsetMs) {
  const uint32_t savedLeadMs = runtimeStartLeadMs;
  runtimeStartLeadMs = 0;
  sendStartFromOffset(offsetMs);
  runtimeStartLeadMs = savedLeadMs;
}`
  const stableHelpers = `${immediateHelper}

bool scheduleStableAFromOffset(uint32_t capturedOffsetMs) {
  if (aClockPending) return false;

  // The browser timestamp was captured just before the serial command. Measure all
  // variable MASTER-side preparation before defining the common RF epoch, then add
  // that measured preparation to the media offset. This removes RF-health-dependent
  // timing variation from the final A anchor.
  const uint32_t commandReceivedMasterMs = millis();

  // Stability first: verify/sync every unique RX before choosing the epoch. Any ACK
  // retry variation happens here, before the scheduled clock exists, so it cannot
  // move the final GO time relative to the media timeline.
  sendAllReceivers(CMD_SYNC, true, 1);
  // A short common broadcast sync burst reduces per-RX clock skew immediately before
  // the epoch snapshot. It is still before scheduleMasterMs, so its duration is safe.
  sendBroadcastNoAck(CMD_SYNC, 3);

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

  // Atomic epoch commit. Pre-armed RX units switch locally at the same master epoch;
  // these START packets are only a recovery path for an RX that missed PREPARE.
  cueSeq = aClockPendingSeq;
  showStartMasterMs = aClockAnchorMasterMs;
  liveGoMasterMs = aClockGoMasterMs;
  liveOffsetMs = aClockTargetOffsetMs;
  showPlaying = true;
  bArmed = false;
  armedOffsetMs = 0;
  aClockPending = false;
  lastShowStateMs = 0;
  drawLcd();

  sendBroadcastNoAck(CMD_START, 3);
  sendAllReceivers(CMD_START, false, 1);

  if (pcHandshake && Serial.availableForWrite() >= 24) {
    Serial.print("A_LIVE_STARTED " );
    Serial.print(liveOffsetMs);
    Serial.print(' ');
    Serial.println(A_CLOCK_RESERVE_MS);
  }
}`
  code = replaceRequired(code, immediateHelper, stableHelpers, 'master stable A helpers')

  code = replaceRequired(
    code,
    `void requestStart() {
  // Once a LIVE show is running, physical D2 never interrupts or restarts it.
  if (showPlaying) return;`,
    `void requestStart() {
  // Once a LIVE show is running, physical D2 never interrupts or restarts it.
  // A pending web CLOCK LOCK also owns the upcoming epoch; D2 cannot race it.
  if (showPlaying || aClockPending) return;`,
    'master D2 pending guard'
  )

  code = replaceRequired(
    code,
    'void finishShow() {\n  cueSeq++;',
    'void finishShow() {\n  aClockPending = false;\n  cueSeq++;',
    'master finish cancels schedule'
  )

  code = replaceRequired(
    code,
    'void forceStopShow() {\n  cueSeq++;',
    'void forceStopShow() {\n  aClockPending = false;\n  cueSeq++;',
    'master force stop cancels schedule'
  )

  code = replaceRequired(
    code,
    'void abortBeforeFirstCue() {\n  cueSeq++;',
    'void abortBeforeFirstCue() {\n  aClockPending = false;\n  cueSeq++;',
    'master abort cancels schedule'
  )

  const oldACommand = `  if (strncmp(line, "A_LIVE_START_NOW " , 17) == 0) {
    // A independent re-anchor is intentionally allowed even while B LIVE is running.
    // The new cueSeq makes every RX accept the fresh anchor, and START LEAD is forced
    // to 0 ms only for this command. The user's B START LEAD setting is preserved.
    pcHandshake = true;
    uint32_t value = parseSerialUInt(line + 17);
    if (SHOW_DURATION_MS > 0 && value >= SHOW_DURATION_MS) value = SHOW_DURATION_MS - 1;
    bArmed = false;
    sendStartFromOffsetNow(value);
    Serial.print("A_LIVE_STARTED " ); Serial.println(value);
    return;
  }`

  const newACommands = `  if (strncmp(line, "A_LIVE_START_NOW " , 17) == 0) {
    // Fail closed for a cached v0.6.2 web client. Immediate A start is intentionally
    // disabled in v0.6.3 so an old tab cannot re-introduce non-deterministic timing.
    Serial.println("ERR A_CLOCK_REQUIRES_WEB_V063");
    return;
  }

  if (strncmp(line, "A_LIVE_SCHEDULE " , 16) == 0) {
    pcHandshake = true;
    if (aClockPending) { Serial.println("A_SCHEDULE_BUSY"); return; }
    const uint32_t capturedOffsetMs = parseSerialUInt(line + 16);
    if (!scheduleStableAFromOffset(capturedOffsetMs)) {
      Serial.println("A_SCHEDULE_DENIED END_OR_BUSY");
      return;
    }
    Serial.print("A_SCHEDULED " );
    Serial.print(capturedOffsetMs);
    Serial.print(' ');
    Serial.println(A_CLOCK_RESERVE_MS);
    return;
  }`
  code = replaceRequired(code, oldACommand, newACommands, 'master A schedule serial command')

  code = replaceRequired(
    code,
    '    else { bArmed = false; drawLcd(); }',
    '    else { aClockPending = false; bArmed = false; drawLcd(); }',
    'master idle force stop cancels schedule'
  )

  code = replaceRequired(
    code,
    '  const uint32_t now = millis();\n\n  // HARD_END_GUARD:',
    '  const uint32_t now = millis();\n  commitStableAIfDue();\n\n  // HARD_END_GUARD:',
    'master scheduled commit loop'
  )

  // Handshake versioning is deliberately strict so v0.6.3 web can refuse an old
  // MASTER instead of silently falling back to the unsafe immediate command path.
  code = code.replaceAll('LSM_READY LSM-B1 AB_DUAL', 'LSM_READY LSM-B1 AB_DUAL V063')

  return code
}

export function applyStableAClockReceiverV063(source) {
  let code = source

  code = replaceRequired(
    code,
    '#define EVENT_TICK_MS 10UL',
    '#define EVENT_TICK_MS 10UL\n#define A_CLOCK_RESERVE_MS 100UL',
    'receiver reserve define'
  )

  code = replaceRequired(
    code,
    'const byte CMD_PREVIEW_SEEK = 6, CMD_PREVIEW_PLAY = 7, CMD_PREVIEW_PAUSE = 8, CMD_PREVIEW_STOP = 9;\nconst byte CMD_FORCE_STOP = 10;',
    'const byte CMD_PREVIEW_SEEK = 6, CMD_PREVIEW_PLAY = 7, CMD_PREVIEW_PAUSE = 8, CMD_PREVIEW_STOP = 9;\nconst byte CMD_FORCE_STOP = 10;\nconst byte CMD_A_SCHEDULE = 11;',
    'receiver A schedule command id'
  )

  code = replaceRequired(
    code,
    'uint32_t previewAnchorLocalMs = 0;',
    [
      'uint32_t previewAnchorLocalMs = 0;',
      'bool aClockPending = false;',
      'uint16_t aClockPendingSeq = 0;',
      'uint32_t aClockGoMasterMs = 0;',
      'uint32_t aClockAnchorMasterMs = 0;',
    ].join('\n'),
    'receiver A schedule state'
  )

  const setupAnchor = 'void setup() {'
  const scheduleRuntime = `void armStableASchedule(const RadioPacket& p) {
  // Normal operation has already been clock-synced by the MASTER preflight burst.
  // This fallback only covers an RX that booted immediately before the schedule.
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
  previewState = PREVIEW_OFF;
  activeCueSeq = nextSeq;
  playbackStartMasterMs = nextAnchor;
  playing = true;

  uint32_t elapsed = nowMaster - playbackStartMasterMs;
  if (elapsed >= END_MS) {
    stopPlayback();
    return;
  }

  const uint32_t nowLocal = millis();
  localPlaybackStartMs = nowLocal - elapsed;
  lastElapsedMs = elapsed;
  seekTimeline(elapsed);
}

${setupAnchor}`
  code = replaceRequired(code, setupAnchor, scheduleRuntime, 'receiver A schedule runtime')

  const forceStop = '    if (p.type == CMD_FORCE_STOP) { activeCueSeq = p.seq; stopPlayback(); continue; }'
  const scheduleHandler = `    if (p.type == CMD_A_SCHEDULE) {
      armStableASchedule(p);
      continue;
    }

    if (p.type == CMD_FORCE_STOP) { cancelStableASchedule(); activeCueSeq = p.seq; stopPlayback(); continue; }`
  code = replaceRequired(code, forceStop, scheduleHandler, 'receiver A schedule handler')

  code = replaceRequired(
    code,
    '  // Timeline has priority over radio handling. Even a wedged/noisy nRF cannot starve playback.\n  runLocalTimeline();\n  runPreviewTimeline();',
    '  // Scheduled A epoch is checked before any existing timeline work.\n  runStableASchedule();\n  // Timeline has priority over radio handling. Even a wedged/noisy nRF cannot starve playback.\n  runLocalTimeline();\n  runPreviewTimeline();',
    'receiver A schedule loop head'
  )

  code = replaceRequired(
    code,
    '  // Run again after RF work so dense packet bursts cannot delay relay events.\n  runLocalTimeline();\n  runPreviewTimeline();',
    '  // Apply a GO that became due while RF packets were being drained, then run the\n  // timeline again so packet processing cannot add a frame of output latency.\n  runStableASchedule();\n  // Run again after RF work so dense packet bursts cannot delay relay events.\n  runLocalTimeline();\n  runPreviewTimeline();',
    'receiver A schedule loop tail'
  )

  return code
}
