import {
  buildNrf24MasterSketch,
  buildNrf24ReceiverSketch as buildCompressedReceiverSketch,
} from "./nrf24CompressedCodegen.js";

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
      "  // Broadcast lives on pipe 0. Keep EN_AA enabled on pipe 0 because RF24 ACK-payload",
      "  // support depends on pipe 0 AutoAck being enabled. MASTER broadcasts already use",
      "  // per-packet NO_ACK, so broadcast packets still do not request acknowledgements.",
      "  radio.openReadingPipe(0, BROADCAST_ADDRESS);",
      "  radio.openReadingPipe(1, UNIQUE_ADDRESS);",
      "  radio.setAutoAck(0, true);",
      "  radio.setAutoAck(1, true);",
    ].join("\n")
  );

  return code;
}
