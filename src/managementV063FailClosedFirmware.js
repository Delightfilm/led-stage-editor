const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`v0.6.3 fail-closed firmware: ${label} anchor not found`)
  return source.replace(from, to)
}

export function applyV063FailClosedMaster(source) {
  let code = source

  const oldPreflight = `  // Stability first: verify/sync every unique RX before choosing the epoch. Any ACK
  // retry variation happens here, before the scheduled clock exists, so it cannot
  // move the final GO time relative to the media timeline.
  sendAllReceivers(CMD_SYNC, true, 1);
  // A short common broadcast sync burst reduces per-RX clock skew immediately before
  // the epoch snapshot. It is still before scheduleMasterMs, so its duration is safe.
  sendBroadcastNoAck(CMD_SYNC, 3);`

  const newPreflight = `  // Stability first: force a fresh ACK + timeline-hash check of every RX immediately
  // before creating the epoch. Cached link state is not trusted for A CLOCK LOCK.
  for (byte i = 0; i < RECEIVER_COUNT; i++) {
    pingOne(i);
  }
  if (!allReady()) {
    return false;
  }

  // Only after all receivers are verified do we discipline their clocks. Any ACK retry
  // variation is still before scheduleMasterMs, so it cannot move the final GO epoch.
  sendAllReceivers(CMD_SYNC, true, 1);
  sendBroadcastNoAck(CMD_SYNC, 3);`

  code = replaceRequired(code, oldPreflight, newPreflight, 'fresh receiver preflight')

  code = replaceRequired(
    code,
    `    if (!scheduleStableAFromOffset(capturedOffsetMs)) {
      Serial.println("A_SCHEDULE_DENIED END_OR_BUSY");
      return;
    }`,
    `    if (!scheduleStableAFromOffset(capturedOffsetMs)) {
      if (!allReady()) Serial.println("A_SCHEDULE_DENIED RX_NOT_READY");
      else Serial.println("A_SCHEDULE_DENIED END_OR_BUSY");
      return;
    }`,
    'explicit schedule denial'
  )

  return code
}

export function applyV063FailClosedReceiver(source) {
  let code = source

  code = replaceRequired(
    code,
    `bool aClockPending = false;
uint16_t aClockPendingSeq = 0;`,
    `bool aClockPending = false;
bool aClockOwnsLive = false;
uint16_t aClockPendingSeq = 0;`,
    'CLOCK LOCK ownership state'
  )

  code = replaceRequired(
    code,
    `void armStableASchedule(const RadioPacket& p) {
  // Normal operation has already been clock-synced by the MASTER preflight burst.`,
    `void armStableASchedule(const RadioPacket& p) {
  // A delayed duplicate PREPARE must never restart an A epoch that already owns LIVE.
  if (aClockOwnsLive && p.seq == activeCueSeq && p.showStartMasterMs == playbackStartMasterMs) return;
  // Normal operation has already been clock-synced by the MASTER preflight burst.`,
    'duplicate PREPARE guard'
  )

  code = replaceRequired(
    code,
    `  aClockPending = false;
  previewState = PREVIEW_OFF;
  activeCueSeq = nextSeq;`,
    `  aClockPending = false;
  aClockOwnsLive = true;
  previewState = PREVIEW_OFF;
  activeCueSeq = nextSeq;`,
    'A epoch ownership commit'
  )

  code = replaceRequired(
    code,
    `    if (p.type == CMD_FORCE_STOP) { cancelStableASchedule(); activeCueSeq = p.seq; stopPlayback(); continue; }`,
    `    if (p.type == CMD_FORCE_STOP) { cancelStableASchedule(); aClockOwnsLive = false; activeCueSeq = p.seq; stopPlayback(); continue; }`,
    'force stop ownership clear'
  )

  code = replaceRequired(
    code,
    `    if (p.type == CMD_START) {
      syncClock(p.masterTimeMs);`,
    `    if (p.type == CMD_START) {
      // After A CLOCK LOCK commits, an old B START already in flight is stale forever.
      // Only packets matching the exact A seq+epoch may discipline/recover this RX.
      if (aClockOwnsLive && (p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs)) continue;
      syncClock(p.masterTimeMs);`,
    'stale START rejection'
  )

  code = replaceRequired(
    code,
    `    if (p.type == CMD_SHOW_STATE) {
      syncClock(p.masterTimeMs);`,
    `    if (p.type == CMD_SHOW_STATE) {
      // Same protection for a late B SHOW_STATE around the A epoch boundary.
      if (aClockOwnsLive && (p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs)) continue;
      syncClock(p.masterTimeMs);`,
    'stale SHOW_STATE rejection'
  )

  return code
}
