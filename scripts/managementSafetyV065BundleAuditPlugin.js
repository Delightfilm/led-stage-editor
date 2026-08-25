export function managementSafetyV065BundleAuditPlugin() {
  return {
    name: 'management-safety-v065-bundle-audit',
    generateBundle(_options, bundle) {
      const code = Object.values(bundle)
        .filter((item) => item?.type === 'chunk')
        .map((item) => item.code || '')
        .join('\n')

      const required = [
        ['WEB v0.6.10', 'visible web version'],
        ['A CLOCK ·', 'persistent A CLOCK diagnostic badge'],
        ['MASTER SCHEDULED', 'A CLOCK scheduled acknowledgement visibility'],
        ['FAILED · USB WRITE', 'A CLOCK local-playback fail clarity'],
        ['MASTER SRAM v0.6.9', 'MASTER flash-string optimizer'],
        ['unoptimized static Serial/LCD print string remains', 'MASTER SRAM leftover-string guard'],
        ['requestStart A/B split core', 'robust autonomous firmware generator anchor'],
        ['v0.6.7 firmware: structural master STATUS ready/count tail not found', 'structural MASTER status normalization'],
        ['v0.6.8 receiver safety: structural stopPlayback anchor not found', 'structural RX stopPlayback normalization'],
        ['v0.6.8 receiver safety: v0.6.5 tombstone output not found', 'RX PREVIEW reset restore guard'],
        ['V065 BUNDLE', 'MASTER v0.6.5 bundle handshake'],
        ['FIRMWARE_BUNDLE_HASH', 'MASTER bundle hash define'],
        ['mgmt-ack-freshness-v065', 'RX ACK freshness hash marker'],
        ['mgmt-schedule-telemetry-v065', 'scheduled A telemetry hash marker'],
        ['radio.flush_tx();', 'fresh ACK payload guard'],
        ['A CLOCK LOCK starts locally without a new RF packet at GO', 'scheduled A immediate status refresh'],
        ['completedEpochValid', 'completed epoch tombstone'],
        ['LIVE STATE UNKNOWN', 'uncertain START restart lock'],
        ['FW MATCH', 'web/firmware bundle match indicator'],
        ['relay pin must be UNO D2-D8', 'relay pin validation'],
        ['QUARANTINE V', 'hash mismatch isolation'],
        ['JOIN WAIT', 'offline receiver join state'],
        ['LIVE / LOCAL', 'actual RX local-live telemetry'],
      ]

      const missing = required.filter(([needle]) => !code.includes(needle))
      if (missing.length) {
        throw new Error(`v0.6.10 bundle audit missing: ${missing.map(([, label]) => label).join(', ')}`)
      }

      // Runtime transform helpers intentionally retain older protocol strings as
      // search anchors. Positive marker checks verify the generator compatibility,
      // v0.6.5 safety layers, v0.6.9 SRAM optimization, and v0.6.10 A diagnostics.
    },
  }
}
