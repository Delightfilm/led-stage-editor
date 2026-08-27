const replaceBetween = (code, start, end, replacement, label) => {
  const from = code.indexOf(start)
  if (from < 0) throw new Error(`sync live V5: ${label} start anchor not found`)
  const to = code.indexOf(end, from)
  if (to < 0) throw new Error(`sync live V5: ${label} end anchor not found`)
  return code.slice(0, from) + replacement + code.slice(to)
}

export function syncLiveTimeLockV5Plugin() {
  return {
    name: 'sync-live-time-lock-v5',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/SyncLiveAppV3.jsx')) return null

      let next = code

      const engineImport = "import { buildReferenceFingerprint, extractFeature, formatTime, SyncMatcher, SYNC_LIVE_CONSTANTS } from './syncLiveEngine.js'\n"
      if (!next.includes(engineImport)) throw new Error('sync live V5: engine import anchor not found')
      next = next.replace(
        engineImport,
        engineImport + "import { SyncLiveTimeLockV5, SYNC_LIVE_V5 } from './syncLiveTimeLockV5.js'\n",
      )

      const matchState = "  const [match, setMatch] = useState({ state: 'SEARCHING', confidence: 0, positionSec: null, score: 0, margin: 0 })\n"
      if (!next.includes(matchState)) throw new Error('sync live V5: match state anchor not found')
      next = next.replace(matchState, matchState + [
        "  const [v5Status, setV5Status] = useState({ state: 'SEARCHING', positionSec: null, confidence: 0, candidateReady: false, timeLocked: false, passCount: 0, verifyTotal: 0, avgConfidence: 0, window: null, evidenceSource: 'NONE', rejectedCount: 0 })",
        "  const [windowIn, setWindowIn] = useState(0)",
        "  const [windowOut, setWindowOut] = useState(2)",
        "  const [windowEnabled, setWindowEnabled] = useState(false)",
        "",
      ].join('\n'))

      const matcherRef = "  const matcherRef = useRef(null)\n"
      if (!next.includes(matcherRef)) throw new Error('sync live V5: matcher ref anchor not found')
      next = next.replace(matcherRef, matcherRef + "  const timeLockRef = useRef(null)\n")

      const referenceInit = "      matcherRef.current = new SyncMatcher(fp)\n      setReference(fp)"
      if (!next.includes(referenceInit)) throw new Error('sync live V5: reference init anchor not found')
      next = next.replace(referenceInit, "      matcherRef.current = new SyncMatcher(fp)\n      timeLockRef.current = new SyncLiveTimeLockV5(fp)\n      setV5Status(timeLockRef.current.snapshot(performance.now(), null))\n      setReference(fp)")

      const v5Functions = [
        "  const setV5MatchDisplay = (status, raw = {}) => {",
        "    if (!status) return",
        "    setV5Status(status)",
        "    setMatch({",
        "      ...raw,",
        "      state: status.state,",
        "      confidence: status.confidence,",
        "      positionSec: status.positionSec,",
        "      score: Number(raw.score || 0),",
        "      margin: Number(raw.margin || 0),",
        "    })",
        "  }",
        "",
        "  const applyRollingWindow = () => {",
        "    const ctl = timeLockRef.current",
        "    if (!ctl) return notify('REFERENCE 준비 후 사용할 수 있습니다.')",
        "    const a = Math.max(0, Number(windowIn) || 0)",
        "    const b = Math.max(0, Number(windowOut) || 0)",
        "    if (Math.abs(b - a) < 0.2) return notify('IN/OUT 간격을 최소 0.2초 이상 지정해 주세요.')",
        "    const status = ctl.setWindow(a, b, performance.now(), true)",
        "    setWindowEnabled(true)",
        "    setV5Status(ctl.snapshot(performance.now(), ctl.lastEvidence))",
        "    log(`ROLLING WINDOW START · ${formatTime(status.inSec)} ~ ${formatTime(status.outSec)} · width ${status.widthSec.toFixed(2)}s`)",
        "  }",
        "",
        "  const disableRollingWindow = () => {",
        "    const ctl = timeLockRef.current",
        "    if (!ctl) return",
        "    ctl.disableWindow(); setWindowEnabled(false)",
        "    setV5Status(ctl.snapshot(performance.now(), ctl.lastEvidence))",
        "    log('ROLLING WINDOW OFF · GLOBAL SEARCH')",
        "  }",
        "",
        "  const setWindowPointFromVideo = (kind) => {",
        "    const t = Number(videoRef.current?.currentTime)",
        "    if (!Number.isFinite(t)) return notify('푸티지를 먼저 준비해 주세요.')",
        "    if (kind === 'in') { setWindowIn(Number(t.toFixed(3))); log(`SET IN · ${formatTime(t)}`) }",
        "    else { setWindowOut(Number(t.toFixed(3))); log(`SET OUT · ${formatTime(t)}`) }",
        "  }",
        "",
        "  const confirmV5Candidate = async () => {",
        "    const ctl = timeLockRef.current",
        "    if (!ctl || !v5Status.candidateReady) return",
        "    const candidateConfidence = v5Status.confidence",
        "    const status = ctl.confirmCandidate(performance.now())",
        "    setV5MatchDisplay(status)",
        "    if (status.positionSec != null) followFootage(status.positionSec, candidateConfidence)",
        "    log(`TIME LOCK CONFIRMED · ${formatTime(status.positionSec)} · verified ${v5Status.passCount}/${v5Status.verifyTotal} · avg ${v5Status.avgConfidence}%`)",
        "    if (rt.current.armed && rt.current.autoStart && !rt.current.showRunning && status.positionSec != null) {",
        "      await liveStart(status.positionSec, 'TIME LOCK CONFIRM', candidateConfidence)",
        "    }",
        "  }",
        "",
        "  const rejectV5Candidate = () => {",
        "    const ctl = timeLockRef.current",
        "    if (!ctl || !v5Status.candidateReady) return",
        "    const rejectedAt = v5Status.positionSec",
        "    const status = ctl.rejectCandidate(performance.now())",
        "    matcherRef.current?.reset()",
        "    setV5MatchDisplay(status)",
        "    holdFootage('HOLD · CANDIDATE REJECTED · 다음 후보 탐색')",
        "    log(`CANDIDATE REJECT · ${formatTime(rejectedAt)} · 주변 ±2.5s 제외`)",
        "  }",
        "",
        "  const unlockV5Time = () => {",
        "    const ctl = timeLockRef.current",
        "    if (!ctl) return",
        "    const old = v5Status.positionSec",
        "    const status = ctl.unlock(performance.now())",
        "    matcherRef.current?.reset()",
        "    setV5MatchDisplay(status)",
        "    holdFootage('HOLD · TIME LOCK 해제 · 재탐색')",
        "    log(`TIME LOCK RELEASE · ${formatTime(old)}`)",
        "  }",
        "",
      ].join('\n')

      const onFeatureStart = "  const onFeature = (feature) => {"
      if (!next.includes(onFeatureStart)) throw new Error('sync live V5: onFeature anchor not found')
      next = next.replace(onFeatureStart, v5Functions + "\n  const onFeature = (feature) => {")

      const onFeatureBlock = [
        "  const onFeature = (feature) => {",
        "    const matcher = matcherRef.current; if (!matcher) return",
        "    const raw = matcher.push(feature)",
        "    const ctl = timeLockRef.current",
        "    if (!ctl) { setMatch(raw); return }",
        "    const status = ctl.push(feature, raw, performance.now())",
        "    rt.current.lastConfidence = status.confidence",
        "    setV5MatchDisplay(status, raw)",
        "",
        "    if ((status.candidateReady || status.timeLocked) && status.positionSec != null) {",
        "      followFootage(status.positionSec, status.confidence)",
        "    } else if (status.state === 'VERIFYING') {",
        "      holdFootage('VERIFYING · 후보 시간축 검증 중')",
        "    } else {",
        "      holdFootage(rt.current.lastLockedPosition == null ? 'SEARCHING · 후보 탐색' : 'HOLD · SEARCHING · 마지막 프레임')",
        "    }",
        "",
        "    if (rt.current.armed && rt.current.autoResync && rt.current.showRunning && status.timeLocked && rt.current.anchor && status.positionSec != null) {",
        "      const expected = rt.current.anchor.sec + (performance.now() - rt.current.anchor.at) / 1000",
        "      const driftMs = Math.round((status.positionSec - expected) * 1000)",
        "      if (Math.abs(driftMs) > 450 && performance.now() - rt.current.lastTrigger > 5000) log(`DRIFT ${driftMs}ms · TIME LOCK clock은 자동 수정하지 않음`)",
        "    }",
        "  }",
        "",
      ].join('\n')

      next = replaceBetween(next, "  const onFeature = (feature) => {", "  const refreshMicDevices = async", onFeatureBlock, 'onFeature')

      const micReset = "      matcherRef.current?.reset(); rt.current.lastLockedPosition = null"
      if (next.includes(micReset)) {
        next = next.replace(micReset, "      matcherRef.current?.reset(); timeLockRef.current?.resetSession({ preserveWindow: true }); rt.current.lastLockedPosition = null; if (timeLockRef.current) setV5Status(timeLockRef.current.snapshot(performance.now(), null))")
      }

      const readiness = "  const readiness = { reference: !!reference, mic: micActive && inputDb > -55, master: masterConnected && masterReady, lock: match.state === 'LOCKED' && match.confidence >= 90 }"
      if (!next.includes(readiness)) throw new Error('sync live V5: readiness anchor not found')
      next = next.replace(readiness, "  const readiness = { reference: !!reference, mic: micActive && inputDb > -55, master: masterConnected && masterReady, lock: !!v5Status.timeLocked }")

      const matchSection = [
        "      <section className={`sl-card sl-match ${String(v5Status.state || 'searching').toLowerCase()}`}>",
        "        <div className=\"sl-card-head\"><h2>MATCH ENGINE · V5 TIME LOCK</h2><span>{v5Status.state}</span></div>",
        "        <div className=\"sl-match-main\"><div><b>{formatTime(v5Status.positionSec)}</b><small>{v5Status.timeLocked ? 'MASTER CLOCK · FIXED AXIS' : v5Status.candidateReady ? 'CANDIDATE CLOCK · PREVIEW FIXED' : 'DETECTED POSITION'}</small></div><div><b>{v5Status.confidence}%</b><small>{v5Status.timeLocked ? 'VERIFY CONFIDENCE · CLOCK에는 영향 없음' : 'CONFIDENCE'}</small></div></div>",
        "        <div className=\"sl-confidence\"><i style={{ width: `${v5Status.confidence}%` }} /></div>",
        "        <div className=\"sl-diagnostics\"><span>verify {v5Status.passCount}/{v5Status.verifyTotal || SYNC_LIVE_V5.verifyFrames}</span><span>avg {v5Status.avgConfidence}%</span><span>source {v5Status.evidenceSource}</span><span>rejected {v5Status.rejectedCount}</span></div>",
        "        {v5Status.candidateReady ? <div className=\"sl-control-row\"><button className=\"sl-btn primary\" onClick={confirmV5Candidate}>이 위치 확정 · TIME LOCK</button><button className=\"sl-btn danger\" onClick={rejectV5Candidate}>틀림 · 다음 후보 찾기</button></div> : null}",
        "        {v5Status.timeLocked ? <div className=\"sl-control-row\"><button className=\"sl-btn danger\" onClick={unlockV5Time}>TIME LOCK 해제 · 다시 찾기</button><span className=\"sl-meta\">현재 clock은 matcher가 수정하지 않습니다.</span></div> : null}",
        "        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.12)' }}>",
        "          <div className=\"sl-card-head\"><h2>ROLLING IN / OUT WINDOW</h2><span>{windowEnabled ? 'MOVING' : 'OFF / STATIC'}</span></div>",
        "          <div className=\"sl-control-row\"><label>IN <input type=\"number\" min=\"0\" step=\"0.1\" value={windowIn} onChange={(e) => setWindowIn(Math.max(0, Number(e.target.value) || 0))} /></label><button className=\"sl-btn\" onClick={() => setWindowPointFromVideo('in')}>현재 영상 → IN</button></div>",
        "          <div className=\"sl-control-row\"><label>OUT <input type=\"number\" min=\"0\" step=\"0.1\" value={windowOut} onChange={(e) => setWindowOut(Math.max(0, Number(e.target.value) || 0))} /></label><button className=\"sl-btn\" onClick={() => setWindowPointFromVideo('out')}>현재 영상 → OUT</button></div>",
        "          <div className=\"sl-control-row\"><button className=\"sl-btn primary\" onClick={applyRollingWindow}>MOVING WINDOW START / RESET</button>{windowEnabled ? <button className=\"sl-btn\" onClick={disableRollingWindow}>WINDOW OFF · GLOBAL</button> : null}</div>",
        "          <div className=\"sl-meta\">현재 검색창: {v5Status.window ? `${formatTime(v5Status.window.inSec)} ~ ${formatTime(v5Status.window.outSec)} · width ${Number(v5Status.window.widthSec || 0).toFixed(2)}s` : '미지정'} · 시작 후 1초가 지나면 IN/OUT도 각각 +1초 이동합니다.</div>",
        "        </div>",
        "        <div className=\"sl-safety-note\">후보 확정 기준: 기본 최근 2초/20회 중 16회 PASS + 평균 confidence ≥ 85% + 시간축 편차 ±250ms. 초고신뢰는 ≥93% 8회 연속이면 빠른 후보 확정. 후보가 확정되면 영상 미리보기 시간축도 고정되며, 사용자가 승인하기 전에는 SHOW TIME LOCK으로 승격되지 않습니다.</div>",
        "      </section>",
        "",
      ].join('\n')

      next = replaceBetween(
        next,
        "      <section className={`sl-card sl-match ${match.state.toLowerCase()}`}>",
        '      <section className="sl-card sl-footage">',
        matchSection,
        'match card',
      )

      next = next.replace("<video ref={videoRef}", "<video controls ref={videoRef}")

      next = next.replace(
        "<span className={`sl-footage-state ${match.state === 'LOCKED' ? 'locked' : ''}`}>{match.state === 'LOCKED' ? 'SYNCED FOOTAGE' : 'HOLD / SEARCH'}</span><strong>{formatTime(match.state === 'LOCKED' ? match.positionSec : rt.current.lastLockedPosition)}</strong>",
        "<span className={`sl-footage-state ${(v5Status.timeLocked || v5Status.candidateReady) ? 'locked' : ''}`}>{v5Status.timeLocked ? 'TIME LOCKED FOOTAGE' : v5Status.candidateReady ? 'CANDIDATE PREVIEW' : 'HOLD / SEARCH'}</span><strong>{formatTime((v5Status.timeLocked || v5Status.candidateReady) ? v5Status.positionSec : rt.current.lastLockedPosition)}</strong>",
      )

      next = next.replace(
        "disabled={!armed || showRunning || match.state !== 'LOCKED'} onClick={() => match.positionSec != null && liveStart(match.positionSec, 'MANUAL LOCK', match.confidence)}",
        "disabled={!armed || showRunning || !v5Status.timeLocked} onClick={() => v5Status.positionSec != null && liveStart(v5Status.positionSec, 'MANUAL TIME LOCK', v5Status.confidence)}",
      )

      next = next.replace(
        "영상 모니터는 LED 제어와 독립입니다. LOCKED일 때만 인식 위치를 따라가고 SEARCHING/CANDIDATE/LOST에서는 마지막 확정 프레임을 HOLD합니다. AUTO START: ARMED + MASTER READY + confidence ≥ 90%인 연속 LOCK 5회.",
        "영상 모니터는 LED 제어와 독립입니다. V5는 후보 검증 후 사용자가 TIME LOCK을 승인하면 그 시간축을 실시간 clock으로 고정합니다. 이후 confidence 저하는 clock을 멈추거나 수정하지 않습니다. AUTO START는 ARMED 상태에서 사용자가 TIME LOCK을 확정한 순간에만 실행됩니다.",
      )

      next = next.replace(
        'detail={`${match.state} ${match.confidence}%`}',
        'detail={v5Status.timeLocked ? `TIME LOCKED · verify ${v5Status.confidence}%` : `${v5Status.state} · ${v5Status.passCount}/${v5Status.verifyTotal || SYNC_LIVE_V5.verifyFrames}`}',
      )

      next = next.replace('>LOCK POSITION START</button>', '>TIME LOCK POSITION START</button>')

      return { code: next, map: null }
    },
  }
}
