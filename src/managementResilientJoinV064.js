const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`resilient join v0.6.4: ${label} anchor not found`)
  return source.replace(from, to)
}

export function applyResilientJoinMasterV064(source) {
  let code = source

  code = replaceRequired(
    code,
    'const byte FLAG_PLAYING = 0x01;',
    'const byte FLAG_PLAYING = 0x01;\nconst byte FLAG_A_CLOCK = 0x02;',
    'master A clock flag'
  )

  code = replaceRequired(
    code,
    `bool aClockPending = false;\nbool aClockStartedReportPending = false;`,
    `bool aClockPending = false;\nbool aClockLive = false;\nbool aClockStartedReportPending = false;`,
    'master A live ownership state'
  )

  const transportAnchor = `void sendSync() { sendAllReceivers(CMD_SYNC, false, 1); }\nvoid sendShowState() { sendAllReceivers(CMD_SHOW_STATE, false, 1); }`
  const resilientTransport = `bool receiverHashCompatible(byte i) {\n  return versionKnown[i] && versionOk[i];\n}\n\nbyte compatibleOnlineCount() {\n  byte count = 0;\n  for (byte i = 0; i < RECEIVER_COUNT; i++) {\n    if (linkOk[i] && receiverHashCompatible(i)) count++;\n  }\n  return count;\n}\n\nbyte joinWaitCount() {\n  byte count = 0;\n  for (byte i = 0; i < RECEIVER_COUNT; i++) {\n    if (versionKnown[i] && !versionOk[i]) continue;\n    if (!linkOk[i] || !versionKnown[i]) count++;\n  }\n  return count;\n}\n\nbyte quarantineCount() {\n  byte count = 0;\n  for (byte i = 0; i < RECEIVER_COUNT; i++) {\n    if (versionKnown[i] && !versionOk[i]) count++;\n  }\n  return count;\n}\n\nvoid sendCompatibleReceivers(byte type, byte repeats = 1) {\n  for (byte i = 0; i < RECEIVER_COUNT; i++) {\n    if (!receiverHashCompatible(i)) continue;\n    radio.stopListening();\n    radio.openWritingPipe(RECEIVER_ADDRESSES[i]);\n    for (byte r = 0; r < repeats; r++) {\n      RadioPacket p = makePacket(type, i + 1);\n      p.masterTimeMs = millis();\n      p.flags = showPlaying ? FLAG_PLAYING : 0;\n      if (aClockLive) p.flags |= FLAG_A_CLOCK;\n      p.seq = cueSeq;\n      p.showStartMasterMs = showStartMasterMs;\n      radio.write(&p, sizeof(p), true);\n      if (repeats > 1) delay(1);\n    }\n  }\n}\n\nvoid sendSync() { sendAllReceivers(CMD_SYNC, false, 1); }\n// START is never globally blocked by X/?. During LIVE only hash-compatible receivers\n// receive state. An X/? receiver is verified by the normal PING scan first, then the\n// next SHOW_STATE makes it seek directly to the current show position.\nvoid sendShowState() { sendCompatibleReceivers(CMD_SHOW_STATE, 1); }`
  code = replaceRequired(code, transportAnchor, resilientTransport, 'compatible show-state transport')

  const oldScheduleTransport = `void sendAClockSchedulePackets(uint16_t scheduleSeq, uint32_t scheduleMasterMs, uint32_t anchorMasterMs) {\n  // Every copy carries the exact same epoch. Packet arrival time is never the GO time.\n  RadioPacket p = makePacket(CMD_A_SCHEDULE, 0);\n  p.masterTimeMs = scheduleMasterMs;\n  p.flags = FLAG_PLAYING;\n  p.seq = scheduleSeq;\n  p.showStartMasterMs = anchorMasterMs;\n\n  radio.stopListening();\n  radio.openWritingPipe(BROADCAST_ADDRESS);\n  for (byte r = 0; r < 8; r++) {\n    p.target = 0;\n    radio.write(&p, sizeof(p), true);\n    if (r < 7) delay(1);\n  }\n\n  // Deterministic NO_ACK backup copies for every RX. These are sent before the\n  // reserved GO epoch; a late unique copy still arms the exact same future epoch.\n  for (byte i = 0; i < RECEIVER_COUNT; i++) {\n    radio.stopListening();\n    radio.openWritingPipe(RECEIVER_ADDRESSES[i]);\n    p.target = i + 1;\n    for (byte r = 0; r < 2; r++) {\n      radio.write(&p, sizeof(p), true);\n      if (r == 0) delay(1);\n    }\n  }\n}`
  const newScheduleTransport = `void sendAClockSchedulePackets(uint16_t scheduleSeq, uint32_t scheduleMasterMs, uint32_t anchorMasterMs) {\n  // v0.6.4: never broadcast a LIVE schedule. A HASH-V receiver must be physically\n  // excluded from the show even though it can still hear the shared RF channel.\n  // X/? receivers do not block the show; they enter JOIN WAIT and receive SHOW_STATE\n  // only after a future PING proves that their current timeline hash is compatible.\n  for (byte i = 0; i < RECEIVER_COUNT; i++) {\n    if (!receiverHashCompatible(i)) continue;\n    radio.stopListening();\n    radio.openWritingPipe(RECEIVER_ADDRESSES[i]);\n    for (byte r = 0; r < 3; r++) {\n      RadioPacket p = makePacket(CMD_A_SCHEDULE, i + 1);\n      p.masterTimeMs = scheduleMasterMs;\n      p.flags = FLAG_PLAYING | FLAG_A_CLOCK;\n      p.seq = scheduleSeq;\n      p.showStartMasterMs = anchorMasterMs;\n      radio.write(&p, sizeof(p), true);\n      if (r < 2) delay(1);\n    }\n  }\n}`
  code = replaceRequired(code, oldScheduleTransport, newScheduleTransport, 'isolated A schedule transport')

  const oldPreflight = `  // Stability first: force a fresh ACK + timeline-hash check of every RX immediately\n  // before creating the epoch. Cached link state is not trusted for A CLOCK LOCK.\n  for (byte i = 0; i < RECEIVER_COUNT; i++) {\n    pingOne(i);\n  }\n  if (!allReady()) {\n    return false;\n  }\n\n  // Only after all receivers are verified do we discipline their clocks. Any ACK retry\n  // variation is still before scheduleMasterMs, so it cannot move the final GO epoch.\n  sendAllReceivers(CMD_SYNC, true, 1);\n  sendBroadcastNoAck(CMD_SYNC, 3);`
  const newPreflight = `  // Refresh every RX immediately before the epoch, but never make one missing costume\n  // a global show stopper. O joins now. X/? waits. V is quarantined.\n  for (byte i = 0; i < RECEIVER_COUNT; i++) {\n    pingOne(i);\n  }\n\n  // Clock discipline is safe for every RX because SYNC cannot toggle outputs. The\n  // compatibility filter is applied only to START/SCHEDULE/SHOW_STATE.\n  sendAllReceivers(CMD_SYNC, false, 1);\n  sendBroadcastNoAck(CMD_SYNC, 3);`
  code = replaceRequired(code, oldPreflight, newPreflight, 'non-blocking A preflight')

  code = replaceRequired(
    code,
    `    if (!scheduleStableAFromOffset(capturedOffsetMs)) {\n      if (!allReady()) Serial.println("A_SCHEDULE_DENIED RX_NOT_READY");\n      else Serial.println("A_SCHEDULE_DENIED END_OR_BUSY");\n      return;\n    }`,
    `    if (!scheduleStableAFromOffset(capturedOffsetMs)) {\n      Serial.println("A_SCHEDULE_DENIED END_OR_BUSY");\n      return;\n    }`,
    'remove global RX start gate'
  )

  code = replaceRequired(
    code,
    `  showPlaying = true;\n  bArmed = false;\n  armedOffsetMs = 0;`,
    `  showPlaying = true;\n  aClockLive = true;\n  bArmed = false;\n  armedOffsetMs = 0;`,
    'A epoch ownership commit'
  )

  code = replaceRequired(
    code,
    `  sendBroadcastNoAck(CMD_START, 3);\n  sendAllReceivers(CMD_START, false, 1);`,
    `  // Recovery START is also unicast only. HASH-V units never receive LIVE packets.\n  sendCompatibleReceivers(CMD_START, 2);`,
    'A recovery start isolation'
  )

  code = replaceRequired(
    code,
    `  Serial.print("A_LIVE_STARTED " );\n  Serial.print(aClockStartedReportOffsetMs);\n  Serial.print(' ');\n  Serial.println(A_CLOCK_RESERVE_MS);`,
    `  Serial.print("A_LIVE_STARTED " );\n  Serial.print(aClockStartedReportOffsetMs);\n  Serial.print(' ');\n  Serial.print(A_CLOCK_RESERVE_MS);\n  Serial.print(' ');\n  Serial.print(compatibleOnlineCount());\n  Serial.print(' ');\n  Serial.print(joinWaitCount());\n  Serial.print(' ');\n  Serial.println(quarantineCount());`,
    'A start participation report'
  )

  const oldManagedStart = `  showPlaying = true;\n  // Shared START x5, then two unique NO_ACK copies per RX. This improves delivery probability\n  // without making LIVE timing depend on ACK success. SHOW_STATE remains the safe-rejoin path.\n  sendBroadcastNoAck(CMD_START, 5);\n  sendAllReceivers(CMD_START, false, 2);\n  lastShowStateMs = 0;`
  const newManagedStart = `  showPlaying = true;\n  aClockLive = false;\n  if (pcHandshake) {\n    // Managed B/web start: isolate HASH-V units. X/? units join later after verification.\n    sendCompatibleReceivers(CMD_START, 2);\n  } else {\n    // Preserve the existing standalone D2 transport when no management session exists.\n    sendBroadcastNoAck(CMD_START, 5);\n    sendAllReceivers(CMD_START, false, 2);\n  }\n  lastShowStateMs = 0;`
  code = replaceRequired(code, oldManagedStart, newManagedStart, 'managed B compatibility isolation')

  // Terminal paths must not leave an A-mode flag behind for the next show.
  code = code.replaceAll(
    `  showPlaying = false;\n  showStartMasterMs = 0;`,
    `  showPlaying = false;\n  aClockLive = false;\n  showStartMasterMs = 0;`
  )

  code = code.replaceAll('LSM_READY LSM-B1 AB_DUAL V063', 'LSM_READY LSM-B1 AB_DUAL V064')
  return code
}

export function applyResilientJoinReceiverV064(source) {
  let code = source

  code = replaceRequired(
    code,
    'const byte FLAG_PLAYING = 0x01;',
    'const byte FLAG_PLAYING = 0x01;\nconst byte FLAG_A_CLOCK = 0x02;',
    'receiver A clock flag'
  )

  const oldStart = `    if (p.type == CMD_START) {\n      // After A CLOCK LOCK commits, an old B START already in flight is stale forever.\n      // Only packets matching the exact A seq+epoch may discipline/recover this RX.\n      if (aClockOwnsLive && (p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs)) continue;\n      syncClock(p.masterTimeMs);\n      if (!playing || p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) {\n        armOrRejoin(p.seq, p.showStartMasterMs);\n      } else {\n        disciplinePlaybackClock(p);\n      }\n      // START may arrive on an ACK-enabled unique pipe in compatibility paths.\n      loadStatusAck();\n      continue;\n    }`
  const newStart = `    if (p.type == CMD_START) {\n      // After A CLOCK LOCK commits, an old B START already in flight is stale forever.\n      if (aClockOwnsLive && (p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs)) continue;\n      const bool packetIsAClock = (p.flags & FLAG_A_CLOCK) != 0;\n      syncClock(p.masterTimeMs);\n      if (!playing || p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) {\n        armOrRejoin(p.seq, p.showStartMasterMs);\n        if (packetIsAClock) aClockOwnsLive = true;\n      } else {\n        disciplinePlaybackClock(p);\n      }\n      loadStatusAck();\n      continue;\n    }`
  code = replaceRequired(code, oldStart, newStart, 'A ownership on START rejoin')

  const oldShowState = `    if (p.type == CMD_SHOW_STATE) {\n      // Same protection for a late B SHOW_STATE around the A epoch boundary.\n      if (aClockOwnsLive && (p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs)) continue;\n      syncClock(p.masterTimeMs);\n      const bool masterPlaying = (p.flags & FLAG_PLAYING) != 0;\n      if (!masterPlaying) {\n        // Ignore transient/stale idle state while a local show is already running.\n        if (!playing && previewState == PREVIEW_OFF) { activeCueSeq = p.seq; allOff(); }\n        continue;\n      }\n\n      if (!playing || p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) {\n        armOrRejoin(p.seq, p.showStartMasterMs);\n      } else {\n        disciplinePlaybackClock(p);\n      }\n      continue;\n    }`
  const newShowState = `    if (p.type == CMD_SHOW_STATE) {\n      // OXOOOOO after GO: localPlaybackStartMs remains authoritative, so RF loss never\n      // pauses a running costume. OOOXOOO at GO: once that RX later validates as O,\n      // this SHOW_STATE seeks directly to the current position without replaying misses.\n      if (aClockOwnsLive && (p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs)) continue;\n      const bool packetIsAClock = (p.flags & FLAG_A_CLOCK) != 0;\n      syncClock(p.masterTimeMs);\n      const bool masterPlaying = (p.flags & FLAG_PLAYING) != 0;\n      if (!masterPlaying) {\n        if (!playing && previewState == PREVIEW_OFF) { activeCueSeq = p.seq; allOff(); }\n        continue;\n      }\n\n      if (!playing || p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) {\n        armOrRejoin(p.seq, p.showStartMasterMs);\n        if (packetIsAClock) aClockOwnsLive = true;\n      } else {\n        disciplinePlaybackClock(p);\n      }\n      continue;\n    }`
  code = replaceRequired(code, oldShowState, newShowState, 'safe mid-show join ownership')

  return code
}
