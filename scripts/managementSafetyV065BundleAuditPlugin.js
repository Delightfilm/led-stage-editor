export function managementSafetyV065BundleAuditPlugin() {
  return {
    name: 'management-safety-v065-bundle-audit',
    generateBundle(_options, bundle) {
      const code = Object.values(bundle)
        .filter((item) => item?.type === 'chunk')
        .map((item) => item.code || '')
        .join('\n')

      const required = [
        ['WEB v0.6.8', 'visible web version'],
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
        throw new Error(`v0.6.8 bundle audit missing: ${missing.map(([, label]) => label).join(', ')}`)
      }

      // Runtime transform helpers intentionally retain older protocol strings as
      // search anchors. Positive marker checks verify the generator compatibility
      // shims plus the v0.6.5 firmware safety layers in the final production bundle.
    },
  }
}
