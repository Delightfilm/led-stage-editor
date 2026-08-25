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
    '      Serial.println("A_SCHEDULE_DENIED END_OR_BUSY");',
    '      Serial.println("A_SCHEDULE_DENIED PREFLIGHT_OR_END");',
    'explicit schedule denial'
  )

  return code
}
