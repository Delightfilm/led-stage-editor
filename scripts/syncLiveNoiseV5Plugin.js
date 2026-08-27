export function syncLiveNoiseV5Plugin() {
  return {
    name: 'sync-live-v10',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/SyncLiveAppV3.jsx')) return null

      const oldImport = "import { SyncLiveTimeLockV5, SYNC_LIVE_V5 } from './syncLiveTimeLockV5.js'"
      if (!code.includes(oldImport)) throw new Error('sync live V10: V5 time-lock transform must run first')

      let next = code.replace(
        oldImport,
        "import { SyncLiveMatcherV10 as SyncLiveTimeLockV5, SYNC_LIVE_V5 } from './syncLiveMatcherV10.js'",
      )

      const onFeatureOld = '  const onFeature = (feature) => {'
      if (!next.includes(onFeatureOld)) throw new Error('sync live V10: onFeature signature anchor not found')
      next = next.replace(onFeatureOld, '  const onFeature = (feature, liveDb = null) => {')

      const pushOld = '    const status = ctl.push(feature, raw, performance.now())'
      if (!next.includes(pushOld)) throw new Error('sync live V10: controller push anchor not found')
      next = next.replace(pushOld, '    const status = ctl.push(feature, raw, performance.now(), { inputDb: liveDb })')

      const workletFeatureOld = 'onFeature(extractFeature(samples.subarray(0, FFT_SIZE), ctx.sampleRate))'
      if (!next.includes(workletFeatureOld)) throw new Error('sync live V10: AudioWorklet feature anchor not found')
      next = next.replace(workletFeatureOld, 'onFeature(extractFeature(samples.subarray(0, FFT_SIZE), ctx.sampleRate), db)')

      next = next.replace('MATCH ENGINE · V5 TIME LOCK', 'MATCH ENGINE · V10 PRODUCTION CONSENSUS')

      const diagOld = '<span>source {v5Status.evidenceSource}</span><span>rejected {v5Status.rejectedCount}</span>'
      const diagNew = '<span>source {v5Status.evidenceSource}</span><span>consensus {v5Status.consensusScore || 0}%</span><span>pass {v5Status.consensusPass || 0}/{v5Status.consensusTotal || 0}</span><span>ratio {v5Status.consensusRatio || 0}%</span><span>decision {v5Status.decisionMode || \'WAITING\'}</span><span>time {v5Status.decisionSec || \'0.0\'}s</span><span>ensemble {v5Status.consensusAvgEnsemble || 0}%</span><span>validators {v5Status.consensusAvgValidators || \'0.0\'}/5</span><span>phase {v5Status.consensusPhaseErrorMs || 0}ms</span><span>unique {v5Status.uniqueness ?? 100}%</span><span>context {v5Status.contextSec || \'0.0\'}s</span><span>margin {v5Status.ensembleMargin || \'0.000\'}</span><span>noise {v5Status.noiseStatus || \'CALIBRATING\'}</span><span>SNR {v5Status.snrDb || \'-60.0\'} dB</span><span>candidates {v5Status.candidateCount || 0}</span><span>risk {v5Status.riskCount || 0}</span><span>skip {v5Status.consensusSkipped || 0}</span><span>reanchor {v5Status.reanchors || 0}</span><span>rejected {v5Status.rejectedCount}</span>'
      if (!next.includes(diagOld)) throw new Error('sync live V10: diagnostics anchor not found')
      next = next.replace(diagOld, diagNew)

      const oldSafety = '후보 확정 기준: 기본 최근 2초/20회 중 16회 PASS + 평균 confidence ≥ 85% + 시간축 편차 ±250ms. 초고신뢰는 ≥93% 8회 연속이면 빠른 후보 확정. 후보가 확정되면 영상 미리보기 시간축도 고정되며, 사용자가 승인하기 전에는 SHOW TIME LOCK으로 승격되지 않습니다.'
      const newSafety = 'V10 후보 정책: 고유·초고신뢰 구간도 최소 약 5초/50회 장기 합의, 일반 구간은 최소 약 8초/80회, 반복·유사 구간은 V9 문맥 해제 후 최소 약 12초/120회 추가 검증을 요구합니다. NO DECISION·다중후보·반복구간 HOLD는 실패로 세지 않습니다. CANDIDATE_READY 이후에는 미리보기 clock을 고정하고, 사용자가 승인해야만 SHOW TIME LOCK으로 승격됩니다.'
      if (!next.includes(oldSafety)) throw new Error('sync live V10: safety text anchor not found')
      next = next.replace(oldSafety, newSafety)

      const baseDetail = 'detail={v5Status.timeLocked ? `TIME LOCKED · verify ${v5Status.confidence}%` : `${v5Status.state} · ${v5Status.passCount}/${v5Status.verifyTotal || SYNC_LIVE_V5.verifyFrames}`}'
      const consensusDetail = 'detail={v5Status.timeLocked ? `TIME LOCKED · verify ${v5Status.confidence}%` : `${v5Status.state} · consensus ${v5Status.consensusPass || 0}/${v5Status.consensusTotal || 0} · ${v5Status.consensusScore || 0}%`}'
      if (next.includes(baseDetail)) next = next.replace(baseDetail, consensusDetail)

      const controlAnchor = '{v5Status.timeLocked ? <div className="sl-control-row"><button className="sl-btn danger" onClick={unlockV5Time}>TIME LOCK 해제 · 다시 찾기</button><span className="sl-meta">현재 clock은 matcher가 수정하지 않습니다.</span></div> : null}'
      if (next.includes(controlAnchor)) {
        next = next.replace(controlAnchor, controlAnchor + '<div className="sl-meta">V10 RISK: {(v5Status.riskFlags || []).length ? v5Status.riskFlags.join(" · ") : "NONE"}</div>')
      }

      return { code: next, map: null }
    },
  }
}
