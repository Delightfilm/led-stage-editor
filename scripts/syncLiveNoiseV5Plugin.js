export function syncLiveNoiseV5Plugin() {
  return {
    name: 'sync-live-v9',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/SyncLiveAppV3.jsx')) return null

      const oldImport = "import { SyncLiveTimeLockV5, SYNC_LIVE_V5 } from './syncLiveTimeLockV5.js'"
      if (!code.includes(oldImport)) throw new Error('sync live V9: V5 time-lock transform must run first')

      let next = code.replace(
        oldImport,
        "import { SyncLiveMatcherV9 as SyncLiveTimeLockV5, SYNC_LIVE_V5 } from './syncLiveMatcherV9.js'",
      )

      const onFeatureOld = '  const onFeature = (feature) => {'
      if (!next.includes(onFeatureOld)) throw new Error('sync live V9: onFeature signature anchor not found')
      next = next.replace(onFeatureOld, '  const onFeature = (feature, liveDb = null) => {')

      const pushOld = '    const status = ctl.push(feature, raw, performance.now())'
      if (!next.includes(pushOld)) throw new Error('sync live V9: controller push anchor not found')
      next = next.replace(pushOld, '    const status = ctl.push(feature, raw, performance.now(), { inputDb: liveDb })')

      const workletFeatureOld = 'onFeature(extractFeature(samples.subarray(0, FFT_SIZE), ctx.sampleRate))'
      if (!next.includes(workletFeatureOld)) throw new Error('sync live V9: AudioWorklet feature anchor not found')
      next = next.replace(workletFeatureOld, 'onFeature(extractFeature(samples.subarray(0, FFT_SIZE), ctx.sampleRate), db)')

      next = next.replace('MATCH ENGINE · V5 TIME LOCK', 'MATCH ENGINE · V9 SEGMENT AWARE')

      const diagOld = '<span>source {v5Status.evidenceSource}</span><span>rejected {v5Status.rejectedCount}</span>'
      const diagNew = '<span>source {v5Status.evidenceSource}</span><span>ensemble {v5Status.ensembleScore || 0}%</span><span>validators {v5Status.ensembleValidators || 0}/5</span><span>uniqueness {v5Status.uniqueness ?? 100}%</span><span>segment {v5Status.segmentClass || \'--\'}</span><span>remote sim {v5Status.remoteSimilarity || 0}%</span><span>context {v5Status.contextSec || \'0.0\'}s</span><span>repeat hold {v5Status.repeatedHold ? \'YES\' : \'NO\'}</span><span>margin {v5Status.ensembleMargin || \'0.000\'}</span><span>noise {v5Status.noiseStatus || \'CALIBRATING\'}</span><span>SNR {v5Status.snrDb || \'-60.0\'} dB</span><span>candidates {v5Status.candidateCount || 0}</span><span>rejected {v5Status.rejectedCount}</span>'
      if (!next.includes(diagOld)) throw new Error('sync live V9: diagnostics anchor not found')
      next = next.replace(diagOld, diagNew)

      const noteOld = '후보가 확정되면 영상 미리보기 시간축도 고정되며, 사용자가 승인하기 전에는 SHOW TIME LOCK으로 승격되지 않습니다.'
      const noteNew = '후보가 확정되면 영상 미리보기 시간축도 고정되며, 사용자가 승인하기 전에는 SHOW TIME LOCK으로 승격되지 않습니다. V9은 기준 음원을 사전 segment 분석해 반복 후렴/유사 구간의 uniqueness를 계산합니다. 반복구간에서는 충분한 시간 문맥과 후보 margin이 생길 때까지 확정을 보류합니다.'
      if (next.includes(noteOld)) next = next.replace(noteOld, noteNew)

      return { code: next, map: null }
    },
  }
}
