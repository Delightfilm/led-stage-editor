export function syncLiveNoiseV5Plugin() {
  return {
    name: 'sync-live-v8',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/SyncLiveAppV3.jsx')) return null

      const oldImport = "import { SyncLiveTimeLockV5, SYNC_LIVE_V5 } from './syncLiveTimeLockV5.js'"
      if (!code.includes(oldImport)) throw new Error('sync live V8: V5 time-lock transform must run first')

      let next = code.replace(
        oldImport,
        "import { SyncLiveMatcherV8 as SyncLiveTimeLockV5, SYNC_LIVE_V5 } from './syncLiveMatcherV8.js'",
      )

      const onFeatureOld = '  const onFeature = (feature) => {'
      if (!next.includes(onFeatureOld)) throw new Error('sync live V8: onFeature signature anchor not found')
      next = next.replace(onFeatureOld, '  const onFeature = (feature, liveDb = null) => {')

      const pushOld = '    const status = ctl.push(feature, raw, performance.now())'
      if (!next.includes(pushOld)) throw new Error('sync live V8: controller push anchor not found')
      next = next.replace(pushOld, '    const status = ctl.push(feature, raw, performance.now(), { inputDb: liveDb })')

      const workletFeatureOld = 'onFeature(extractFeature(samples.subarray(0, FFT_SIZE), ctx.sampleRate))'
      if (!next.includes(workletFeatureOld)) throw new Error('sync live V8: AudioWorklet feature anchor not found')
      next = next.replace(workletFeatureOld, 'onFeature(extractFeature(samples.subarray(0, FFT_SIZE), ctx.sampleRate), db)')

      next = next.replace('MATCH ENGINE · V5 TIME LOCK', 'MATCH ENGINE · V8 ENSEMBLE')

      const diagOld = '<span>source {v5Status.evidenceSource}</span><span>rejected {v5Status.rejectedCount}</span>'
      const diagNew = '<span>source {v5Status.evidenceSource}</span><span>ensemble {v5Status.ensembleScore || 0}%</span><span>validators {v5Status.ensembleValidators || 0}/5</span><span>spectral {v5Status.spectralVote || 0}</span><span>tonal {v5Status.tonalVote || 0}</span><span>onset {v5Status.onsetVote || 0}</span><span>temporal {v5Status.temporalVote || 0}</span><span>landmark {v5Status.landmarkVote || 0}</span><span>margin {v5Status.ensembleMargin || \'0.000\'}</span><span>noise {v5Status.noiseStatus || \'CALIBRATING\'}</span><span>SNR {v5Status.snrDb || \'-60.0\'} dB</span><span>candidates {v5Status.candidateCount || 0}</span><span>ambiguous {v5Status.candidateAmbiguous ? \'YES\' : \'NO\'}</span><span>EQ Δ {v5Status.eqCorrectionRms || \'0.000\'}</span><span>rejected {v5Status.rejectedCount}</span>'
      if (!next.includes(diagOld)) throw new Error('sync live V8: diagnostics anchor not found')
      next = next.replace(diagOld, diagNew)

      const noteOld = '후보가 확정되면 영상 미리보기 시간축도 고정되며, 사용자가 승인하기 전에는 SHOW TIME LOCK으로 승격되지 않습니다.'
      const noteNew = '후보가 확정되면 영상 미리보기 시간축도 고정되며, 사용자가 승인하기 전에는 SHOW TIME LOCK으로 승격되지 않습니다. V8은 spectral, tonal profile, onset timing, temporal continuity, landmark의 5개 독립 검증 중 최소 3개가 합의해야 후보 증거로 사용합니다.'
      if (next.includes(noteOld)) next = next.replace(noteOld, noteNew)

      return { code: next, map: null }
    },
  }
}
