const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`autonomous firmware v0.6.2: ${label} anchor not found`)
  return source.replace(from, to)
}

export function applyAutonomousAFirmwareV062(source) {
  let code = source

  const oldRequestStart = `void requestStart() {
  // Once a LIVE show is running, neither D2 nor PC preview may interrupt it.
  if (showPlaying) return;

  // A = standalone, always starts from timeline 0.
  // B = only after an explicit ARM_B from the PC; D2 then starts from that pre-roll offset.
  const uint32_t offsetMs = (pcHandshake && bArmed) ? armedOffsetMs : 0;
  sendStartFromOffset(offsetMs);
  bArmed = false;
  if (pcHandshake) {
    Serial.print("LIVE_STARTED " );
    Serial.println(offsetMs);
  }
}`

  const newRequestStart = `void requestStart() {
  // Once a LIVE show is running, physical D2 never interrupts or restarts it.
  if (showPlaying) return;

  const bool useBStart = pcHandshake && bArmed;
  const uint32_t offsetMs = useBStart ? armedOffsetMs : 0;

  // v0.6.2 timing split:
  // - B D2 start uses the user-selected runtimeStartLeadMs.
  // - Standalone A D2 is always immediate (0 ms START LEAD).
  if (useBStart) sendStartFromOffset(offsetMs);
  else sendStartFromOffsetNow(0);

  bArmed = false;
  if (pcHandshake) {
    Serial.print("LIVE_STARTED " );
    Serial.println(offsetMs);
  }
}`
  code = replaceRequired(code, oldRequestStart, newRequestStart, 'requestStart A/B split')

  const commandAnchor = `  if (strcmp(line, "LIVE_FORCE_STOP") == 0) {`
  const autonomousCommand = `  if (strncmp(line, "A_LIVE_START_NOW " , 17) == 0) {
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
  }

${commandAnchor}`
  code = replaceRequired(code, commandAnchor, autonomousCommand, 'A live re-anchor command')

  return code
}
