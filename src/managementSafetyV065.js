const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`safety v0.6.5: ${label} anchor not found`)
  return source.replace(from, to)
}

const hashHex = (value) => (Number(value) >>> 0).toString(16).padStart(8, '0').toUpperCase()

export function applySafetyMasterV065(source, bundleHash = 0) {
  let code = source
  const bundleHex = hashHex(bundleHash)

  code = replaceRequired(
    code,
    '#define SERIAL_BAUD 115200\n#define A_CLOCK_RESERVE_MS 100UL',
    `#define SERIAL_BAUD 115200\n#define A_CLOCK_RESERVE_MS 100UL\n#define FIRMWARE_BUNDLE_HASH 0x${bundleHex}UL`,
    'master bundle define'
  )

  code = code.replaceAll(
    'LSM_READY LSM-B1 AB_DUAL V064',
    `LSM_READY LSM-B1 AB_DUAL V065 BUNDLE ${bundleHex}`
  )

  const oldStatusStruct = `struct __attribute__((packed)) ReceiverStatus {
  byte magic;
  byte receiverId;
  uint16_t reserved;
  uint32_t showHash;
};`
  const newStatusStruct = `struct __attribute__((packed)) ReceiverStatus {
  byte magic;
  byte receiverId;
  byte flags;
  byte reserved;
  uint16_t activeSeq;
  uint32_t showHash;
};`
  code = replaceRequired(code, oldStatusStruct, newStatusStruct, 'master receiver status payload')

  code = replaceRequired(
    code,
    'bool versionOk[8] = {0};',
    'bool versionOk[8] = {0};\nbool receiverPlaying[8] = {0};\nuint16_t receiverActiveSeq[8] = {0};',
    'master receiver live telemetry state'
  )

  code = replaceRequired(
    code,
    `    versionKnown[i] = false;
    versionOk[i] = false;`,
    `    versionKnown[i] = false;
    versionOk[i] = false;
    receiverPlaying[i] = false;
    receiverActiveSeq[i] = 0;`,
    'master clear stale receiver live state'
  )

  code = replaceRequired(
    code,
    '        versionOk[i] = status.showHash == EXPECTED_HASHES[i];',
    `        versionOk[i] = status.showHash == EXPECTED_HASHES[i];
        receiverPlaying[i] = (status.flags & FLAG_PLAYING) != 0;
        receiverActiveSeq[i] = status.activeSeq;`,
    'master parse receiver live status'
  )

  code = replaceRequired(
    code,
    `    Serial.print(lastPingRetryCount[i]);
  }
  Serial.println();`,
    `    Serial.print(lastPingRetryCount[i]);
    Serial.print(':');
    Serial.print(receiverPlaying[i] ? 1 : 0);
    Serial.print(':');
    Serial.print(receiverActiveSeq[i]);
  }
  Serial.println();`,
    'master RXMON live fields'
  )

  code = replaceRequired(
    code,
    `  Serial.print(" ready=" ); Serial.print(readyCount());
  Serial.print('/'); Serial.println(RECEIVER_COUNT);`,
    `  Serial.print(" ready=" ); Serial.print(readyCount());
  Serial.print('/'); Serial.print(RECEIVER_COUNT);
  Serial.print(" bundle=" ); Serial.println(FIRMWARE_BUNDLE_HASH, HEX);`,
    'master status bundle field'
  )

  return code
}

export function applySafetyReceiverV065(source) {
  let code = source

  const oldStatusStruct = `struct __attribute__((packed)) ReceiverStatus {
  byte magic;
  byte receiverId;
  uint16_t reserved;
  uint32_t showHash;
};`
  const newStatusStruct = `struct __attribute__((packed)) ReceiverStatus {
  byte magic;
  byte receiverId;
  byte flags;
  byte reserved;
  uint16_t activeSeq;
  uint32_t showHash;
};`
  code = replaceRequired(code, oldStatusStruct, newStatusStruct, 'receiver live status payload')

  code = replaceRequired(
    code,
    'ReceiverStatus statusPayload = { STATUS_MAGIC, RECEIVER_ID, 0, SHOW_HASH };',
    'ReceiverStatus statusPayload = { STATUS_MAGIC, RECEIVER_ID, 0, 0, 0, SHOW_HASH };',
    'receiver status initializer'
  )

  code = replaceRequired(
    code,
    `void loadStatusAck() {
  radio.writeAckPayload(1, &statusPayload, sizeof(statusPayload));
}`,
    `void loadStatusAck() {
  statusPayload.flags = playing ? FLAG_PLAYING : 0;
  if (aClockOwnsLive) statusPayload.flags |= FLAG_A_CLOCK;
  statusPayload.activeSeq = activeCueSeq;
  radio.writeAckPayload(1, &statusPayload, sizeof(statusPayload));
}`,
    'receiver dynamic ACK status'
  )

  code = replaceRequired(
    code,
    'bool aClockOwnsLive = false;',
    `bool aClockOwnsLive = false;
bool completedEpochValid = false;
uint16_t completedCueSeq = 0;
uint32_t completedShowStartMasterMs = 0;`,
    'receiver completed epoch tombstone state'
  )

  code = replaceRequired(
    code,
    `void stopPlayback() {
  playing = false;
  lastElapsedMs = 0;
  allOff();
}`,
    `void stopPlayback() {
  if (playing) {
    completedEpochValid = true;
    completedCueSeq = activeCueSeq;
    completedShowStartMasterMs = playbackStartMasterMs;
  }
  playing = false;
  aClockOwnsLive = false;
  lastElapsedMs = 0;
  allOff();
  loadStatusAck();
}`,
    'receiver terminal epoch tombstone'
  )

  const oldForceStop = '    if (p.type == CMD_FORCE_STOP) { cancelStableASchedule(); aClockOwnsLive = false; activeCueSeq = p.seq; stopPlayback(); continue; }'
  const newForceStop = '    if (p.type == CMD_FORCE_STOP) { cancelStableASchedule(); stopPlayback(); activeCueSeq = p.seq; loadStatusAck(); continue; }'
  code = replaceRequired(code, oldForceStop, newForceStop, 'receiver force stop ordering')

  const oldStart = `    if (p.type == CMD_START) {
      // After A CLOCK LOCK commits, an old B START already in flight is stale forever.
      if (aClockOwnsLive && (p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs)) continue;
      const bool packetIsAClock = (p.flags & FLAG_A_CLOCK) != 0;
      syncClock(p.masterTimeMs);
      if (!playing || p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) {
        armOrRejoin(p.seq, p.showStartMasterMs);
        if (packetIsAClock) aClockOwnsLive = true;
      } else {
        disciplinePlaybackClock(p);
      }
      loadStatusAck();
      continue;
    }`
  const newStart = `    if (p.type == CMD_START) {
      const bool packetMatchesActive = p.seq == activeCueSeq && p.showStartMasterMs == playbackStartMasterMs;
      const bool packetMatchesCompleted = completedEpochValid && p.seq == completedCueSeq && p.showStartMasterMs == completedShowStartMasterMs;
      // Once any A or B LIVE epoch is running, its local timeline owns playback.
      // A MASTER reboot or an accidental second START cannot move a running costume.
      if (playing && !packetMatchesActive) continue;
      // Never resurrect an epoch that this RX already completed locally.
      if (!playing && packetMatchesCompleted) continue;
      const bool packetIsAClock = (p.flags & FLAG_A_CLOCK) != 0;
      syncClock(p.masterTimeMs);
      if (!playing) {
        completedEpochValid = false;
        armOrRejoin(p.seq, p.showStartMasterMs);
        if (packetIsAClock) aClockOwnsLive = true;
      } else {
        disciplinePlaybackClock(p);
      }
      loadStatusAck();
      continue;
    }`
  code = replaceRequired(code, oldStart, newStart, 'receiver generalized START ownership')

  const oldShowState = `    if (p.type == CMD_SHOW_STATE) {
      // OXOOOOO after GO: localPlaybackStartMs remains authoritative, so RF loss never
      // pauses a running costume. OOOXOOO at GO: once that RX later validates as O,
      // this SHOW_STATE seeks directly to the current position without replaying misses.
      if (aClockOwnsLive && (p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs)) continue;
      const bool packetIsAClock = (p.flags & FLAG_A_CLOCK) != 0;
      syncClock(p.masterTimeMs);
      const bool masterPlaying = (p.flags & FLAG_PLAYING) != 0;
      if (!masterPlaying) {
        if (!playing && previewState == PREVIEW_OFF) { activeCueSeq = p.seq; allOff(); }
        continue;
      }

      if (!playing || p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) {
        armOrRejoin(p.seq, p.showStartMasterMs);
        if (packetIsAClock) aClockOwnsLive = true;
      } else {
        disciplinePlaybackClock(p);
      }
      continue;
    }`
  const newShowState = `    if (p.type == CMD_SHOW_STATE) {
      const bool packetMatchesActive = p.seq == activeCueSeq && p.showStartMasterMs == playbackStartMasterMs;
      const bool packetMatchesCompleted = completedEpochValid && p.seq == completedCueSeq && p.showStartMasterMs == completedShowStartMasterMs;
      const bool packetIsAClock = (p.flags & FLAG_A_CLOCK) != 0;
      const bool masterPlaying = (p.flags & FLAG_PLAYING) != 0;

      // A running RX is holdover-first: only its exact current epoch may discipline it.
      if (playing && !packetMatchesActive) continue;
      if (!playing && masterPlaying && packetMatchesCompleted) continue;

      syncClock(p.masterTimeMs);
      if (!masterPlaying) {
        if (!playing && previewState == PREVIEW_OFF) { activeCueSeq = p.seq; allOff(); loadStatusAck(); }
        continue;
      }

      if (!playing) {
        completedEpochValid = false;
        armOrRejoin(p.seq, p.showStartMasterMs);
        if (packetIsAClock) aClockOwnsLive = true;
      } else {
        disciplinePlaybackClock(p);
      }
      loadStatusAck();
      continue;
    }`
  code = replaceRequired(code, oldShowState, newShowState, 'receiver generalized SHOW_STATE ownership')

  code = replaceRequired(
    code,
    `  activeCueSeq = nextSeq;
  playbackStartMasterMs = nextAnchor;
  playing = true;`,
    `  activeCueSeq = nextSeq;
  playbackStartMasterMs = nextAnchor;
  completedEpochValid = false;
  playing = true;`,
    'receiver A schedule clears completed tombstone'
  )

  return code
}
