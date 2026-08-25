const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`stable A clock v0.6.3 safety: ${label} anchor not found`)
  return source.replace(from, to)
}

export function applyStableAClockMasterSafetyV063(source) {
  let code = source

  code = replaceRequired(
    code,
    `  // Stability first: verify/sync every unique RX before choosing the epoch. Any ACK
  // retry variation happens here, before the scheduled clock exists, so it cannot
  // move the final GO time relative to the media timeline.
  sendAllReceivers(CMD_SYNC, true, 1);`,
    `  // Fail closed: refresh every configured RX immediately before A CLOCK LOCK.
  // pingOne() verifies both RF ACK and the exact expected timeline/firmware hash.
  // A will not schedule if even one configured RX is X / ? / V.
  for (byte i = 0; i < RECEIVER_COUNT; i++) pingOne(i);
  if (!allReady()) return false;

  // Stability first: sync every verified unique RX before choosing the epoch. Any ACK
  // retry variation happens here, before the scheduled clock exists, so it cannot
  // move the final GO time relative to the media timeline.
  sendAllReceivers(CMD_SYNC, true, 1);`,
    'MASTER strict RX preflight'
  )

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
    'MASTER explicit schedule denial'
  )

  return code
}

export function applyStableAClockReceiverSafetyV063(source) {
  let code = source

  code = replaceRequired(
    code,
    `bool aClockPending = false;
uint16_t aClockPendingSeq = 0;`,
    `bool aClockPending = false;
bool aClockOwnsLive = false;
uint16_t aClockPendingSeq = 0;`,
    'RX CLOCK LOCK ownership state'
  )

  code = replaceRequired(
    code,
    `void armStableASchedule(const RadioPacket& p) {
  // Normal operation has already been clock-synced by the MASTER preflight burst.`,
    `void armStableASchedule(const RadioPacket& p) {
  // Ignore a duplicate late PREPARE after this exact A epoch already owns LIVE.
  if (aClockOwnsLive && p.seq == activeCueSeq && p.showStartMasterMs == playbackStartMasterMs) return;
  // Normal operation has already been clock-synced by the MASTER preflight burst.`,
    'RX duplicate schedule guard'
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
    'RX A epoch ownership commit'
  )

  code = replaceRequired(
    code,
    `    if (p.type == CMD_FORCE_STOP) { cancelStableASchedule(); activeCueSeq = p.seq; stopPlayback(); continue; }`,
    `    if (p.type == CMD_FORCE_STOP) { cancelStableASchedule(); aClockOwnsLive = false; activeCueSeq = p.seq; stopPlayback(); continue; }`,
    'RX force stop ownership clear'
  )

  code = replaceRequired(
    code,
    `    if (p.type == CMD_START) {
      syncClock(p.masterTimeMs);`,
    `    if (p.type == CMD_START) {
      // Once the scheduled A epoch owns LIVE, a delayed packet from the old B epoch
      // must never re-anchor this RX backwards. Matching A recovery packets remain valid.
      if (aClockOwnsLive && (p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs)) continue;
      syncClock(p.masterTimeMs);`,
    'RX stale START rejection'
  )

  code = replaceRequired(
    code,
    `    if (p.type == CMD_SHOW_STATE) {
      syncClock(p.masterTimeMs);`,
    `    if (p.type == CMD_SHOW_STATE) {
      // Same protection for a late B SHOW_STATE that was already in flight at A GO.
      if (aClockOwnsLive && (p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs)) continue;
      syncClock(p.masterTimeMs);`,
    'RX stale SHOW_STATE rejection'
  )

  return code
}
