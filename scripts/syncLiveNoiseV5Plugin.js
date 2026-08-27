export function syncLiveNoiseV5Plugin() {
  return {
    name: 'sync-live-noise-v5-1',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/SyncLiveAppV3.jsx')) return null

      const oldImport = "import { SyncLiveTimeLockV5, SYNC_LIVE_V5 } from './syncLiveTimeLockV5.js'"
      if (!code.includes(oldImport)) throw new Error('sync live noise V5.1: V5 time-lock transform must run first')

      let next = code.replace(
        oldImport,
        "import { SyncLiveTimeLockV51Noise as SyncLiveTimeLockV5, SYNC_LIVE_V5 } from './syncLiveTimeLockV51Noise.js'",
      )

      const onFeatureOld = '  const onFeature = (feature) => {'
      if (!next.includes(onFeatureOld)) throw new Error('sync live noise V5.1: onFeature signature anchor not found')
      next = next.replace(onFeatureOld, '  const onFeature = (feature, liveDb = null) => {')

      const pushOld = '    const status = ctl.push(feature, raw, performance.now())'
      if (!next.includes(pushOld)) throw new Error('sync live noise V5.1: controller push anchor not found')
      next = next.replace(pushOld, '    const status = ctl.push(feature, raw, performance.now(), { inputDb: liveDb })')

      const workletFeatureOld = 'onFeature(extractFeature(samples.subarray(0, FFT_SIZE), ctx.sampleRate))'
      if (!next.includes(workletFeatureOld)) throw new Error('sync live noise V5.1: AudioWorklet feature anchor not found')
      next = next.replace(workletFeatureOld, 'onFeature(extractFeature(samples.subarray(0, FFT_SIZE), ctx.sampleRate), db)')

      next = next.replace('MATCH ENGINE · V5 TIME LOCK', 'MATCH ENGINE · V5.1 NOISE RESISTANT')

      const diagOld = '<span>source {v5Status.evidenceSource}</span><span>rejected {v5Status.rejectedCount}</span>'
      const diagNew = '<span>source {v5Status.evidenceSource}</span><span>noise {v5Status.noiseStatus || \'CALIBRATING\'}</span><span>quality {v5Status.noiseQuality || 0}%</span><span>SNR {v5Status.snrDb || \'-60.0\'} dB</span><span>gate {v5Status.gateReason || \'CALIBRATING\'}</span><span>speech {v5Status.speechDominance || 0}%</span><span>persist {v5Status.persistence || 0}%</span><span>floor {v5Status.noiseFloorLevel || \'0.000\'}</span><span>skipped {v5Status.noiseFramesSkipped || 0}</span><span>rejected {v5Status.rejectedCount}</span>'
      if (!next.includes(diagOld)) throw new Error('sync live noise V5.1: diagnostics anchor not found')
      next = next.replace(diagOld, diagNew)

      const noteOld = '후보가 확정되면 영상 미리보기 시간축도 고정되며, 사용자가 승인하기 전에는 SHOW TIME LOCK으로 승격되지 않습니다.'
      const noteNew = '후보가 확정되면 영상 미리보기 시간축도 고정되며, 사용자가 승인하기 전에는 SHOW TIME LOCK으로 승격되지 않습니다. V5.1은 adaptive noise floor + speech-band downweight + transient persistence + SNR gating을 사용하며, 판단 불가능한 프레임은 NO DECISION으로 PASS/FAIL 집계에서 제외합니다.'
      if (next.includes(noteOld)) next = next.replace(noteOld, noteNew)

      return { code: next, map: null }
    },
  }
}
