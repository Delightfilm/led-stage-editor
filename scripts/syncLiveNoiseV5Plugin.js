export function syncLiveNoiseV5Plugin() {
  return {
    name: 'sync-live-noise-v5',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/SyncLiveAppV3.jsx')) return null

      const oldImport = "import { SyncLiveTimeLockV5, SYNC_LIVE_V5 } from './syncLiveTimeLockV5.js'"
      if (!code.includes(oldImport)) throw new Error('sync live noise V5.0: V5 time-lock transform must run first')

      let next = code.replace(
        oldImport,
        "import { SyncLiveTimeLockV5Noise as SyncLiveTimeLockV5, SYNC_LIVE_V5 } from './syncLiveTimeLockV5Noise.js'",
      )

      const pushOld = '    const status = ctl.push(feature, raw, performance.now())'
      if (!next.includes(pushOld)) throw new Error('sync live noise V5.0: controller push anchor not found')
      next = next.replace(pushOld, '    const status = ctl.push(feature, raw, performance.now(), { inputDb })')

      next = next.replace('MATCH ENGINE · V5 TIME LOCK', 'MATCH ENGINE · V5.0 NOISE RESISTANT')

      const diagOld = '<span>source {v5Status.evidenceSource}</span><span>rejected {v5Status.rejectedCount}</span>'
      const diagNew = '<span>source {v5Status.evidenceSource}</span><span>noise {v5Status.noiseStatus || \'CALIBRATING\'}</span><span>quality {v5Status.noiseQuality || 0}%</span><span>speech {v5Status.speechDominance || 0}%</span><span>skipped {v5Status.noiseFramesSkipped || 0}</span><span>rejected {v5Status.rejectedCount}</span>'
      if (!next.includes(diagOld)) throw new Error('sync live noise V5.0: diagnostics anchor not found')
      next = next.replace(diagOld, diagNew)

      const noteOld = '후보가 확정되면 영상 미리보기 시간축도 고정되며, 사용자가 승인하기 전에는 SHOW TIME LOCK으로 승격되지 않습니다.'
      const noteNew = '후보가 확정되면 영상 미리보기 시간축도 고정되며, 사용자가 승인하기 전에는 SHOW TIME LOCK으로 승격되지 않습니다. 현장 소음이 심하면 NO DECISION으로 해당 프레임을 PASS/FAIL 집계에서 제외합니다.'
      if (next.includes(noteOld)) next = next.replace(noteOld, noteNew)

      return { code: next, map: null }
    },
  }
}
