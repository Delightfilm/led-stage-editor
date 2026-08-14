export function managementABModePlugin() {
  return {
    name: 'management-ab-mode-controls',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const stateAnchor = "  const [toast, setToast] = useState(null)"
      if (!out.includes("const [stageMode, setStageMode]")) {
        if (!out.includes(stateAnchor)) throw new Error('A/B mode: state anchor not found')
        out = out.replace(stateAnchor, stateAnchor + "\n  const [stageMode, setStageMode] = useState('A')")
      }

      const refAnchor = "  const syntheticPlayRef = useRef({ at: 0, time: 0 })"
      if (!out.includes('const spaceResumeRef')) {
        if (!out.includes(refAnchor)) throw new Error('A/B mode: synthetic play ref anchor not found')
        out = out.replace(refAnchor, refAnchor + "\n  const spaceResumeRef = useRef(false)")
      }

      const helperAnchor = "  const showToast = (message) => {"
      if (!out.includes('const selectModeA = async')) {
        if (!out.includes(helperAnchor)) throw new Error('A/B mode: helper anchor not found')
        const helpers = [
          "  const previewSafe = firmwareBundle.previewSafeLimitMs > 0 && Math.round(currentTime * 1000) < firmwareBundle.previewSafeLimitMs",
          "  const stageLive = stageMode === 'A_LIVE' || stageMode === 'B_LIVE'",
          "  const stageModeLabel = stageMode === 'A_LIVE' ? 'A · LIVE' : stageMode === 'B_LIVE' ? 'B · LIVE' : stageMode === 'B_ARMED' ? 'B · ARMED' : 'A · STANDALONE'",
          "  const stageModeColor = stageLive ? '#ff657a' : stageMode === 'A' ? '#62e7a2' : '#ffd84a'",
          "",
          "  const playLocalAt = async (time, notifyMaster = true) => {",
          "    const next = clamp(Number(time) || 0, 0, duration)",
          "    setCurrentTime(next)",
          "    const el = getMediaEl()",
          "    if (el) {",
          "      try {",
          "        el.currentTime = next",
          "        await el.play()",
          "        setPlaying(true)",
          "        if (notifyMaster && masterConnected) sendSerialLine(`PREVIEW_PLAY ${Math.round(next * 1000)}`)",
          "      } catch {",
          "        showToast('브라우저에서 재생이 차단됐어요. 다시 SPACE 또는 ▶를 눌러 주세요.')",
          "      }",
          "      return",
          "    }",
          "    syntheticPlayRef.current = { at: performance.now(), time: next }",
          "    setPlaying(true)",
          "    if (notifyMaster && masterConnected) sendSerialLine(`PREVIEW_PLAY ${Math.round(next * 1000)}`)",
          "  }",
          "",
          "  const playFromActualIn = async () => {",
          "    spaceResumeRef.current = false",
          "    await playLocalAt(actualInTime, true)",
          "  }",
          "",
          "  const selectModeA = async () => {",
          "    if (!masterProtocolReady) { showToast('MASTER A/B 펌웨어 연결 후 사용할 수 있어요.'); return }",
          "    if (stageLive) { showToast('LIVE 재생 중에는 모드를 바꿀 수 없어요.'); return }",
          "    await sendSerialLine('MODE_A')",
          "    setStageMode('A')",
          "    spaceResumeRef.current = false",
          "    showToast('A 독립 모드: D2 START는 타임라인 0초부터 시작합니다.')",
          "  }",
          "",
          "  const armModeB = async () => {",
          "    if (!masterProtocolReady) { showToast('MASTER A/B 펌웨어 연결 후 사용할 수 있어요.'); return }",
          "    if (stageLive) { showToast('LIVE 재생 중에는 B ARM을 변경할 수 없어요.'); return }",
          "    const offsetMs = Math.round(currentTime * 1000)",
          "    if (!firmwareBundle.previewSafeLimitMs || offsetMs >= firmwareBundle.previewSafeLimitMs) {",
          "      showToast('B ARM은 첫 실제 LED ON 이전 구간에서만 가능합니다.')",
          "      return",
          "    }",
          "    await sendSerialLine(`SET_DELAY ${delayEnabled ? delayMs : 0}`)",
          "    await sendSerialLine(`ARM_B ${offsetMs}`)",
          "    setStageMode('B_ARMED')",
          "    spaceResumeRef.current = false",
          "    showToast(`B ARM: ${fmtTime(currentTime)} 위치 · 이제 D2로 LIVE START`)",
          "  }",
          "",
        ].join('\n')
        out = out.replace(helperAnchor, helpers + helperAnchor)
      }

      out = out.replace(
        "/ACK|DELAY_OK|SEEK_OK/i.test(line)",
        "/ACK|DELAY_OK|SEEK_OK|ARM_OK|MODE_A_READY|PREVIEW_.*_OK|LIVE_STARTED/i.test(line)"
      )

      const keyEffectAnchor = "  useEffect(() => {\n    const onKey = (event) => {"
      if (!out.includes("window.addEventListener('lsm-live-started'")) {
        if (!out.includes(keyEffectAnchor)) throw new Error('A/B mode: keyboard effect anchor not found')
        const liveFollowEffect = [
          "  useEffect(() => {",
          "    const onLiveStarted = (event) => {",
          "      const offsetMs = Math.max(0, Number(event?.detail?.offsetMs) || 0)",
          "      const actualStart = clamp(offsetMs / 1000 + effectiveDelay / 1000, 0, duration)",
          "      const wasBArmed = stageMode === 'B_ARMED'",
          "      spaceResumeRef.current = false",
          "      setStageMode(wasBArmed ? 'B_LIVE' : 'A_LIVE')",
          "      playLocalAt(actualStart, false)",
          "      showToast(`${wasBArmed ? 'B' : 'A'} LIVE · 웹 타임라인 ${fmtTime(actualStart)}부터 추종`)",
          "    }",
          "    const onLiveFinished = () => {",
          "      pause(false)",
          "      spaceResumeRef.current = false",
          "      setStageMode('A')",
          "      showToast('LIVE 종료 · 웹 타임라인 정지')",
          "    }",
          "    window.addEventListener('lsm-live-started', onLiveStarted)",
          "    window.addEventListener('lsm-live-finished', onLiveFinished)",
          "    return () => {",
          "      window.removeEventListener('lsm-live-started', onLiveStarted)",
          "      window.removeEventListener('lsm-live-finished', onLiveFinished)",
          "    }",
          "  }, [effectiveDelay, duration, mediaKind, stageMode])",
          "",
          keyEffectAnchor,
        ].join('\n')
        out = out.replace(keyEffectAnchor, liveFollowEffect)
      }

      const oldSpace = [
        "      if (event.code === 'Space') {",
        "        event.preventDefault()",
        "        playing ? pause() : play()",
        "      } else if (event.key === 'ArrowLeft') {",
      ].join('\n')
      const newSpace = [
        "      if (event.code === 'Space') {",
        "        event.preventDefault()",
        "        if (playing) {",
        "          pause()",
        "          spaceResumeRef.current = true",
        "        } else if (spaceResumeRef.current) {",
        "          spaceResumeRef.current = false",
        "          play()",
        "        } else {",
        "          playFromActualIn()",
        "        }",
        "      } else if (event.key === 'ArrowLeft') {",
      ].join('\n')
      if (out.includes(oldSpace)) out = out.replace(oldSpace, newSpace)

      const timelineAnchor = "        <div className=\"timelineScroll\" ref={timelineScrollRef} onDragStart={(e) => e.preventDefault()}>"
      if (!out.includes('B ARM · D2 START')) {
        if (!out.includes(timelineAnchor)) throw new Error('A/B mode: timeline anchor not found')
        const bar = [
          "        <section style={{ flex: '0 0 34px', display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px', borderBottom: '1px solid #242a32', background: '#101318', color: '#8d98a8', fontSize: 9 }}>",
          "          <b style={{ color: stageModeColor }}>{stageModeLabel}</b>",
          "          <button className=\"tbtn compact\" disabled={!masterProtocolReady || stageLive} onClick={selectModeA}>A 독립 · 0초</button>",
          "          <button className=\"tbtn compact\" disabled={!masterProtocolReady || !previewSafe || stageLive} onClick={armModeB}>B ARM · D2 START @ {fmtTime(currentTime)}</button>",
          "          <span>안전 PREVIEW 0 ~ {(firmwareBundle.previewSafeLimitMs / 1000).toFixed(3)}s</span>",
          "          <span style={{ marginLeft: 'auto', color: '#687385' }}>SPACE = ACTUAL IN 재생 · D2 LIVE = 웹 타임라인 자동 추종</span>",
          "        </section>",
          "",
          timelineAnchor,
        ].join('\n')
        out = out.replace(timelineAnchor, bar)
      }

      return { code: out, map: null }
    },
  }
}
