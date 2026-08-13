import { buildNrf24MasterSketch } from "./nrf24UnicastMasterCodegen.js";
import { buildNrf24ReceiverSketch as buildCompressedReceiverSketch } from "./nrf24CompressedCodegen.js";

export { buildNrf24MasterSketch };

export function buildNrf24ReceiverSketch(args) {
  let code = buildCompressedReceiverSketch(args);

  code = code.replace(
    " * LINK address:",
    " * LINK RX pipe: 1 / Broadcast RX pipe: 0\n * LINK address:"
  );

  code = code.replace(
    " * Safe rejoin: missed START / radio dropout / receiver reboot can seek to current show position.",
    " * RF holdover: once START is accepted, the local timeline keeps running even if RF disappears.\n * Safe rejoin: missed START / receiver reboot can seek to the current show position when RF returns."
  );

  code = code.replace(
    " * Relay outputs are ACTIVE LOW by default.",
    " * Relay outputs are ACTIVE HIGH by default."
  );

  code = code.replace(
    "#define RELAY_ACTIVE_LOW 1",
    "#define RELAY_ACTIVE_LOW 0"
  );

  code = code.replace(
    "radio.writeAckPayload(0, &statusPayload, sizeof(statusPayload));",
    "radio.writeAckPayload(1, &statusPayload, sizeof(statusPayload));"
  );

  code = code.replace(
    "uint32_t playbackStartMasterMs = 0;",
    [
      "uint32_t playbackStartMasterMs = 0;",
      "uint32_t localPlaybackStartMs = 0;",
      "uint32_t lastElapsedMs = 0;",
    ].join("\n")
  );

  code = code.replace(
    [
      "void stopPlayback() {",
      "  playing = false;",
      "  allOff();",
      "}",
    ].join("\n"),
    [
      "void stopPlayback() {",
      "  playing = false;",
      "  lastElapsedMs = 0;",
      "  allOff();",
      "}",
    ].join("\n")
  );

  code = code.replace(
    [
      "void armOrRejoin(uint16_t seq, uint32_t showStartMs) {",
      "  activeCueSeq = seq;",
      "  playbackStartMasterMs = showStartMs;",
      "  playing = true;",
      "",
      "  const uint32_t now = masterNow();",
      "  if ((int32_t)(now - playbackStartMasterMs) < 0) {",
      "    resetTimeline();",
      "    return;",
      "  }",
      "",
      "  const uint32_t elapsed = now - playbackStartMasterMs;",
      "  if (elapsed >= END_MS) {",
      "    stopPlayback();",
      "    return;",
      "  }",
      "",
      "  seekTimeline(elapsed);",
      "}",
    ].join("\n"),
    [
      "void armOrRejoin(uint16_t seq, uint32_t showStartMs) {",
      "  activeCueSeq = seq;",
      "  playbackStartMasterMs = showStartMs;",
      "  playing = true;",
      "",
      "  const uint32_t nowMaster = masterNow();",
      "  const uint32_t nowLocal = millis();",
      "  if ((int32_t)(nowMaster - playbackStartMasterMs) < 0) {",
      "    const uint32_t waitMs = playbackStartMasterMs - nowMaster;",
      "    localPlaybackStartMs = nowLocal + waitMs;",
      "    lastElapsedMs = 0;",
      "    resetTimeline();",
      "    return;",
      "  }",
      "",
      "  const uint32_t elapsed = nowMaster - playbackStartMasterMs;",
      "  if (elapsed >= END_MS) {",
      "    stopPlayback();",
      "    return;",
      "  }",
      "",
      "  // From this point onward the show clock is local. RF is only a gentle time reference.",
      "  localPlaybackStartMs = nowLocal - elapsed;",
      "  lastElapsedMs = elapsed;",
      "  seekTimeline(elapsed);",
      "}",
      "",
      "void disciplinePlaybackClock(const RadioPacket& p) {",
      "  if (!playing) return;",
      "  if (p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) return;",
      "  if ((int32_t)(p.masterTimeMs - p.showStartMasterMs) < 0) return;",
      "  if ((int32_t)(millis() - localPlaybackStartMs) < 0) return;",
      "",
      "  const uint32_t masterElapsed = p.masterTimeMs - p.showStartMasterMs;",
      "  const uint32_t localElapsed = millis() - localPlaybackStartMs;",
      "  const int32_t error = (int32_t)(masterElapsed - localElapsed);",
      "",
      "  // Slew by at most 1 ms per valid RF update. Never jump or restart the timeline.",
      "  if (error > 2) localPlaybackStartMs -= 1;",
      "  else if (error < -2) localPlaybackStartMs += 1;",
      "}",
      "",
      "void runLocalTimeline() {",
      "  if (!playing) return;",
      "  const uint32_t nowLocal = millis();",
      "  if ((int32_t)(nowLocal - localPlaybackStartMs) < 0) return;",
      "",
      "  uint32_t elapsed = nowLocal - localPlaybackStartMs;",
      "  if (elapsed < lastElapsedMs) elapsed = lastElapsedMs;",
      "  lastElapsedMs = elapsed;",
      "",
      "  if (elapsed >= END_MS) {",
      "    stopPlayback();",
      "    return;",
      "  }",
      "  updateTimeline(elapsed);",
      "}",
    ].join("\n")
  );

  code = code.replace(
    [
      "  radio.openReadingPipe(0, UNIQUE_ADDRESS);",
      "  radio.openReadingPipe(1, BROADCAST_ADDRESS);",
      "  radio.setAutoAck(0, true);",
      "  radio.setAutoAck(1, false);",
    ].join("\n"),
    [
      "  // Keep the ACK/unicast link on pipe 1, matching the proven simple test.",
      "  // Broadcast remains available on pipe 0 as a compatibility fallback.",
      "  // Performance commands from the current MASTER use the unique pipe 1 address.",
      "  radio.openReadingPipe(0, BROADCAST_ADDRESS);",
      "  radio.openReadingPipe(1, UNIQUE_ADDRESS);",
      "  radio.setAutoAck(0, true);",
      "  radio.setAutoAck(1, true);",
    ].join("\n")
  );

  code = code.replace(
    [
      "void loop() {",
      "  byte pipe = 0;",
      "  while (radio.available(&pipe)) {",
    ].join("\n"),
    [
      "void loop() {",
      "  // Timeline has priority over radio handling. Even a wedged/noisy nRF cannot starve playback.",
      "  runLocalTimeline();",
      "",
      "  byte pipe = 0;",
      "  for (byte packetBudget = 0; packetBudget < 4 && radio.available(&pipe); packetBudget++) {",
    ].join("\n")
  );

  code = code.replace(
    [
      "    if (p.type == CMD_SYNC) {",
      "      syncClock(p.masterTimeMs);",
      "      continue;",
      "    }",
    ].join("\n"),
    [
      "    if (p.type == CMD_SYNC) {",
      "      syncClock(p.masterTimeMs);",
      "      disciplinePlaybackClock(p);",
      "      continue;",
      "    }",
    ].join("\n")
  );

  code = code.replace(
    [
      "    if (p.type == CMD_STOP) {",
      "      syncClock(p.masterTimeMs);",
      "      activeCueSeq = p.seq;",
      "      stopPlayback();",
      "      continue;",
      "    }",
    ].join("\n"),
    [
      "    if (p.type == CMD_STOP) {",
      "      syncClock(p.masterTimeMs);",
      "      // Once a show is running, RF is not allowed to stop it. END_MS owns the finish.",
      "      if (!playing) { activeCueSeq = p.seq; allOff(); }",
      "      loadStatusAck();",
      "      continue;",
      "    }",
    ].join("\n")
  );

  code = code.replace(
    [
      "    if (p.type == CMD_START) {",
      "      syncClock(p.masterTimeMs);",
      "      if (!playing || p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) {",
      "        armOrRejoin(p.seq, p.showStartMasterMs);",
      "      }",
      "      continue;",
      "    }",
    ].join("\n"),
    [
      "    if (p.type == CMD_START) {",
      "      syncClock(p.masterTimeMs);",
      "      if (!playing || p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) {",
      "        armOrRejoin(p.seq, p.showStartMasterMs);",
      "      } else {",
      "        disciplinePlaybackClock(p);",
      "      }",
      "      // START may arrive on an ACK-enabled unique pipe in compatibility paths.",
      "      loadStatusAck();",
      "      continue;",
      "    }",
    ].join("\n")
  );

  code = code.replace(
    [
      "    if (p.type == CMD_SHOW_STATE) {",
      "      syncClock(p.masterTimeMs);",
      "      const bool masterPlaying = (p.flags & FLAG_PLAYING) != 0;",
      "      if (!masterPlaying) {",
      "        if (playing) stopPlayback();",
      "        activeCueSeq = p.seq;",
      "        continue;",
      "      }",
      "",
      "      if (!playing || p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) {",
      "        armOrRejoin(p.seq, p.showStartMasterMs);",
      "      }",
      "      continue;",
      "    }",
    ].join("\n"),
    [
      "    if (p.type == CMD_SHOW_STATE) {",
      "      syncClock(p.masterTimeMs);",
      "      const bool masterPlaying = (p.flags & FLAG_PLAYING) != 0;",
      "      if (!masterPlaying) {",
      "        // Ignore transient/stale idle state while a local show is already running.",
      "        if (!playing) { activeCueSeq = p.seq; allOff(); }",
      "        continue;",
      "      }",
      "",
      "      if (!playing || p.seq != activeCueSeq || p.showStartMasterMs != playbackStartMasterMs) {",
      "        armOrRejoin(p.seq, p.showStartMasterMs);",
      "      } else {",
      "        disciplinePlaybackClock(p);",
      "      }",
      "      continue;",
      "    }",
    ].join("\n")
  );

  code = code.replace(
    [
      "  if (!playing || !clockSynced) return;",
      "  const uint32_t now = masterNow();",
      "  if ((int32_t)(now - playbackStartMasterMs) < 0) return;",
      "",
      "  const uint32_t elapsed = now - playbackStartMasterMs;",
      "  if (elapsed >= END_MS) {",
      "    stopPlayback();",
      "    return;",
      "  }",
      "  updateTimeline(elapsed);",
      "}",
    ].join("\n"),
    [
      "  // Run again after RF work so dense packet bursts cannot delay relay events.",
      "  runLocalTimeline();",
      "}",
    ].join("\n")
  );

  return code;
}
