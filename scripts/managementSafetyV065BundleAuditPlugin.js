export function managementSafetyV065BundleAuditPlugin() {
  return {
    name: 'management-safety-v065-bundle-audit',
    generateBundle(_options, bundle) {
      const code = Object.values(bundle)
        .filter((item) => item?.type === 'chunk')
        .map((item) => item.code || '')
        .join('\n')

      const required = [
        ['WEB v0.6.11', 'visible web version'],
        ['① B LIVE START', 'first-stage B LIVE control'],
        ['② A 독립 전환 · 공연 LOCK', 'second-stage A performance lock'],
        ['A LOCK · COMMITTED', 'committed independent performance state'],
        ['A LOCK · B LIVE REQUIRED', 'standby A lock guard'],
        ['MASTER/RF 손실 허용', 'independent handoff operator feedback'],
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
        ['A CLOCK LOCK starts locally without a new RF packet at GO', 'retained legacy physical A schedule safety'],
        ['completedEpochValid', 'completed epoch tombstone'],
        ['LIVE STATE UNKNOWN', 'uncertain START restart lock'],
        ['FW MATCH', 'web/firmware bundle match indicator'],
        ['relay pin must be UNO D2-D8', 'relay pin validation'],
        ['QUARANTINE V', 'hash mismatch isolation'],
        ['JOIN WAIT', 'offline receiver join state'],
        ['LIVE / LOCAL', 'actual RX local-live telemetry'],
        ['A 독립 LIVE는 중간 정지/강제종료가 잠겨 있습니다.', 'A force-stop lock'],
      ]

      const missing = required.filter(([needle]) => !code.includes(needle))
      if (missing.length) {
        throw new Error(`v0.6.11 bundle audit missing: ${missing.map(([, label]) => label).join(', ')}`)
      }
    },
  }
}
