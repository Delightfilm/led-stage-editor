export function applyAckFreshnessReceiverV065(source) {
  const from = `void loadStatusAck() {
  statusPayload.flags = playing ? FLAG_PLAYING : 0;
  if (aClockOwnsLive) statusPayload.flags |= FLAG_A_CLOCK;
  statusPayload.activeSeq = activeCueSeq;
  radio.writeAckPayload(1, &statusPayload, sizeof(statusPayload));
}`
  const to = `void loadStatusAck() {
  statusPayload.flags = playing ? FLAG_PLAYING : 0;
  if (aClockOwnsLive) statusPayload.flags |= FLAG_A_CLOCK;
  statusPayload.activeSeq = activeCueSeq;
  // nRF24 ACK payloads share the TX FIFO. Keep exactly one current status payload;
  // otherwise repeated SHOW_STATE/START updates can queue stale playing/seq reports.
  radio.flush_tx();
  radio.writeAckPayload(1, &statusPayload, sizeof(statusPayload));
}`

  if (!source.includes(from)) throw new Error('v0.6.5 ACK freshness: dynamic status payload anchor not found')
  return source.replace(from, to)
}
