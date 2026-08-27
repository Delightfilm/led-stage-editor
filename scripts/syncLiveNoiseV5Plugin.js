export function syncLiveNoiseV5Plugin() {
  return {
    name: 'sync-live-v7',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/SyncLiveAppV3.jsx')) return null

      const oldImport = "import { SyncLiveTimeLockV5, SYNC_LIVE_V5 } from './syncLiveTimeLockV5.js'"
      if (!code.includes(oldImport)) throw new Error('sync live V7: V5 time-lock transform must run first')

      let next = code.replace(
        oldImport,
        "import { SyncLiveMatcherV7 as SyncLiveTimeLockV5, SYNC_LIVE_V5 } from './syncLiveMatcherV7.js'",
      )

      const onFeatureOld = '  const onFeature = (feature) => {'
      if (!next.includes(onFeatureOld)) throw new Error('sync live V7: onFeature signature anchor not found')
      next = next.replace(onFeatureOld, '  const onFeature = (feature, liveDb = null) => {')

      const pushOld = '    const status = ctl.push(feature, raw, performance.now())'
      if (!next.includes(pushOld)) throw new Error('sync live V7: controller push anchor not found')
      next = next.replace(pushOld, '    const status = ctl.push(feature, raw, performance.now(), { inputDb: liveDb })')

      const workletFeatureOld = 'onFeature(extractFeature(samples.subarray(0, FFT_SIZE), ctx.sampleRate))'
      if (!next.includes(workletFeatureOld)) throw new Error('sync live V7: AudioWorklet feature anchor not found')
      next = next.replace(workletFeatureOld, 'onFeature(extractFeature(samples.subarray(0, FFT_SIZE), ctx.sampleRate), db)')

      next = next.replace('MATCH ENGINE · V5 TIME LOCK', 'MATCH ENGINE · V7 MULTI CANDIDATE')

      const diagOld = '<span>source {v5Status.evidenceSource}</span><span>rejected {v5Status.rejectedCount}</span>'
      const diagNew = '<span>source {v5Status.evidenceSource}</span><span>noise {v5Status.noiseStatus || \'CALIBRATING\'}</span><span>SNR {v5Status.snrDb || \'-60.0\'} dB</span><span>candidates {v5Status.candidateCount || 0}</span><span>margin {v5Status.candidateMargin || \'0.000\'}</span><span>ambiguous {v5Status.candidateAmbiguous ? \'YES\' : \'NO\'}</span><span>ambiguity skip {v5Status.ambiguitySkipped || 0}</span><span>EQ Δ {v5Status.eqCorrectionRms || \'0.000\'}</span><span>telemetry {v5Status.telemetryCount || 0}</span><span>skipped {v5Status.noiseFramesSkipped || 0}</span><span>rejected {v5Status.rejectedCount}</span>'
      if (!next.includes(diagOld)) throw new Error('sync live V7: diagnostics anchor not found')
      next = next.replace(diagOld, diagNew)

      const noteOld = '후보가 확정되면 영상 미리보기 시간축도 고정되며, 사용자가 승인하기 전에는 SHOW TIME LOCK으로 승격되지 않습니다.'
      const noteNew = '후보가 확정되면 영상 미리보기 시간축도 고정되며, 사용자가 승인하기 전에는 SHOW TIME LOCK으로 승격되지 않습니다. V7은 전체 곡에서 최대 5개 시간 후보를 동시에 추적하고, 상위 후보가 비슷하면 AMBIGUOUS로 검증을 보류합니다. Moving IN/OUT Window가 켜져 있으면 해당 범위를 우선합니다.'
      if (next.includes(noteOld)) next = next.replace(noteOld, noteNew)

      return { code: next, map: null }
    },
  }
}
