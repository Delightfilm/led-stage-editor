export function applyScheduleTelemetryReceiverV065(source) {
  const from = `  completedEpochValid = false;
  playing = true;

  uint32_t elapsed = nowMaster - playbackStartMasterMs;`
  const to = `  completedEpochValid = false;
  playing = true;
  // A CLOCK LOCK starts locally without a new RF packet at GO. Preload the updated
  // LIVE status immediately so the very next PING reports playing=1 for this epoch.
  loadStatusAck();

  uint32_t elapsed = nowMaster - playbackStartMasterMs;`

  if (!source.includes(from)) throw new Error('v0.6.5 schedule telemetry: A epoch commit anchor not found')
  return source.replace(from, to)
}
