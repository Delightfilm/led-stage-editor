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
    "radio.writeAckPayload(0, &statusPayload, sizeof(statusPayload));",
    "radio.writeAckPayload(1, &statusPayload, sizeof(statusPayload));"
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
      "      activeCueSeq = p.seq;",
      "      stopPlayback();",
      "      // STOP is sent with AutoAck on the unique pipe; refill status for the next ACK.",
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
      "      }",
      "      // START is sent with AutoAck on the unique pipe; refill status for the next ACK.",
      "      loadStatusAck();",
      "      continue;",
      "    }",
    ].join("\n")
  );

  return code;
}
