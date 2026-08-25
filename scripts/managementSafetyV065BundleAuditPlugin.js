export function managementSafetyV065BundleAuditPlugin() {
  return {
    name: 'management-safety-v065-bundle-audit',
    generateBundle(_options, bundle) {
      const code = Object.values(bundle)
        .filter((item) => item?.type === 'chunk')
        .map((item) => item.code || '')
        .join('\n')

      const required = [
        ['WEB v0.6.5', 'visible web version'],
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
        throw new Error(`v0.6.5 bundle audit missing: ${missing.map(([, label]) => label).join(', ')}`)
      }

      // Do not forbid old protocol strings globally here: runtime firmware transform
      // helpers intentionally retain old strings as search anchors. Required-marker
      // checks above verify that the final v0.6.5 safety layers are present.
    },
  }
}
