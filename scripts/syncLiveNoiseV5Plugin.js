export function syncLiveNoiseV5Plugin() {
  return {
    name: 'sync-live-v6',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/SyncLiveAppV3.jsx')) return null

      const oldImport = "import { SyncLiveTimeLockV5, SYNC_LIVE_V5 } from './syncLiveTimeLockV5.js'"
      if (!code.includes(oldImport)) throw new Error('sync live V6: V5 time-lock transform must run first')

      let next = code.replace(
        oldImport,
        "import { SyncLiveMatcherV6 as SyncLiveTimeLockV5, SYNC_LIVE_V5 } from './syncLiveMatcherV6.js'",
      )

      const onFeatureOld = '  const onFeature = (feature) => {'
      if (!next.includes(onFeatureOld)) throw new Error('sync live V6: onFeature signature anchor not found')
      next = next.replace(onFeatureOld, '  const onFeature = (feature, liveDb = null) => {')

      const pushOld = '    const status = ctl.push(feature, raw, performance.now())'
      if (!next.includes(pushOld)) throw new Error('sync live V6: controller push anchor not found')
      next = next.replace(pushOld, '    const status = ctl.push(feature, raw, performance.now(), { inputDb: liveDb })')

      const workletFeatureOld = 'onFeature(extractFeature(samples.subarray(0, FFT_SIZE), ctx.sampleRate))'
      if (!next.includes(workletFeatureOld)) throw new Error('sync live V6: AudioWorklet feature anchor not found')
      next = next.replace(workletFeatureOld, 'onFeature(extractFeature(samples.subarray(0, FFT_SIZE), ctx.sampleRate), db)')

      next = next.replace('MATCH ENGINE · V5 TIME LOCK', 'MATCH ENGINE · V6 FIELD NORMALIZED')

      const diagOld = '<span>source {v5Status.evidenceSource}</span><span>rejected {v5Status.rejectedCount}</span>'
      const diagNew = '<span>source {v5Status.evidenceSource}</span><span>noise {v5Status.noiseStatus || \'CALIBRATING\'}</span><span>quality {v5Status.noiseQuality || 0}%</span><span>SNR {v5Status.snrDb || \'-60.0\'} dB</span><span>gate {v5Status.gateReason || \'CALIBRATING\'}</span><span>speech {v5Status.speechDominance || 0}%</span><span>persist {v5Status.persistence || 0}%</span><span>EQ Δ {v5Status.eqCorrectionRms || \'0.000\'}</span><span>telemetry {v5Status.telemetryCount || 0}</span><span>skipped {v5Status.noiseFramesSkipped || 0}</span><span>rejected {v5Status.rejectedCount}</span>'
      if (!next.includes(diagOld)) throw new Error('sync live V6: diagnostics anchor not found')
      next = next.replace(diagOld, diagNew)

      const noteOld = '후보가 확정되면 영상 미리보기 시간축도 고정되며, 사용자가 승인하기 전에는 SHOW TIME LOCK으로 승격되지 않습니다.'
      const noteNew = '후보가 확정되면 영상 미리보기 시간축도 고정되며, 사용자가 승인하기 전에는 SHOW TIME LOCK으로 승격되지 않습니다. V6은 V5.1 소음 필터에 현장 PA/마이크 EQ 정규화, 저역 rumble 억제, 60초 telemetry ring을 추가합니다.'
      if (next.includes(noteOld)) next = next.replace(noteOld, noteNew)

      return { code: next, map: null }
    },
  }
}
