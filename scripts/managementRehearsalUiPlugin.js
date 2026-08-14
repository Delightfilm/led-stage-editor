export function managementRehearsalUiPlugin() {
  return {
    name: 'management-rehearsal-ui',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      const stateAnchor = "  const [stageMode, setStageMode] = useState('A')"
      if (!out.includes('const [rehearsalMode, setRehearsalMode]')) {
        if (!out.includes(stateAnchor)) throw new Error('rehearsal ui: stage mode state anchor not found')
        out = out.replace(stateAnchor, stateAnchor + "\n  const [rehearsalMode, setRehearsalMode] = useState(false)")
      }

      const armStart = out.indexOf("  const armModeB = async () => {")
      if (armStart < 0) throw new Error('rehearsal ui: armModeB start not found')
      const armEnd = out.indexOf("\n\n  const ", armStart + 10)
      if (armEnd < 0) throw new Error('rehearsal ui: armModeB end not found')
      const instantArm = [
        "  const armModeB = async () => {",
        "    if (!masterProtocolReady) { showToast('MASTER A/B 펌웨어 연결 후 사용할 수 있어요.'); return }",
        "    if (stageLive || bStartSentRef.current) { showToast('이미 LIVE가 진행 중이거나 START 전송 중입니다.'); return }",
        "    const mediaEl = getMediaEl()",
        "    const liveTime = mediaEl && !mediaEl.paused && Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : currentTime",
        "    const offsetMs = Math.max(0, Math.round(liveTime * 1000))",
        "    const showEndMs = Math.max(0, Number(firmwareBundle.showDurationMs) || 0)",
        "    if (showEndMs && offsetMs >= showEndMs - 5) { showToast('타임라인 끝에서는 LIVE START를 할 수 없어요.'); return }",
        "    if (!rehearsalMode && (!firmwareBundle.previewSafeLimitMs || offsetMs >= firmwareBundle.previewSafeLimitMs)) {",
        "      showToast('공연 모드 B LIVE START는 첫 실제 EL ON 이전 구간에서만 가능합니다. 연습 중간 시작은 연습실 모드를 켜주세요.')",
        "      return",
        "    }",
        "    const wasPlaying = playing",
        "    bArmedOffsetRef.current = offsetMs",
        "    bStartSentRef.current = true",
        "    spaceResumeRef.current = false",
        "    bLivePrimedRef.current = true",
        "    setStageMode('B_LIVE')",
        "    // Already-playing preview is never paused or re-seeked: the moving media clock is the GO reference.",
        "    if (!wasPlaying) playLocalAt(offsetMs / 1000, false)",
        "    const sent = await sendSerialLine(`LIVE_START_NOW ${offsetMs}`)",
        "    if (!sent) {",
        "      bStartSentRef.current = false",
        "      bLivePrimedRef.current = false",
        "      setStageMode('A')",
        "      if (!wasPlaying) pause(false)",
        "      showToast('B LIVE START 전송 실패 · MASTER 연결을 확인해 주세요.')",
        "      return",
        "    }",
        "    showToast(`${rehearsalMode ? '연습실' : 'B'} LIVE 즉시 GO · ${fmtTime(offsetMs / 1000)}`)",
        "  }",
      ].join('\n')
      out = out.slice(0, armStart) + instantArm + out.slice(armEnd)

      const selectAnchor = "  const selectModeA = async () => {"
      if (!out.includes('const forceStopRehearsal = async')) {
        if (!out.includes(selectAnchor)) throw new Error('rehearsal ui: select A anchor not found')
        out = out.replace(selectAnchor, [
          "  const forceStopRehearsal = async () => {",
          "    if (!rehearsalMode) { showToast('중간 강제종료는 연습실 모드에서만 사용할 수 있어요.'); return }",
          "    if (!stageLive) { showToast('현재 LIVE가 진행 중이 아니에요.'); return }",
          "    if (!masterProtocolReady) { showToast('MASTER 연결을 확인해 주세요.'); return }",
          "    pause(false)",
          "    const sent = await sendSerialLine('LIVE_FORCE_STOP')",
          "    if (!sent) showToast('연습실 강제종료 전송 실패 · MASTER 연결을 확인해 주세요.')",
          "    else showToast('연습실 강제종료 전송 · MASTER/RX OFF 확인 중')",
          "  }",
          "",
          selectAnchor,
        ].join('\n'))
      }

      const parserAnchor = "    if (line === 'LIVE_FINISHED') window.dispatchEvent(new CustomEvent('lsm-live-finished'))"
      if (!out.includes("lsm-live-force-stopped")) {
        if (!out.includes(parserAnchor)) throw new Error('rehearsal ui: parser anchor not found')
        out = out.replace(parserAnchor, "    if (line === 'LIVE_FORCE_STOPPED') window.dispatchEvent(new CustomEvent('lsm-live-force-stopped'))\n" + parserAnchor)
      }

      const watchdogAnchor = "  // LIVE_COMPLETE watchdog: MASTER also has its own SHOW_DURATION_MS auto-finish."
      if (!out.includes('REHEARSAL_FORCE_STOP_FOLLOW')) {
        if (!out.includes(watchdogAnchor)) throw new Error('rehearsal ui: watchdog anchor not found')
        const effects = [
          "  // REHEARSAL_FORCE_STOP_FOLLOW",
          "  useEffect(() => {",
          "    const finalizeUi = () => {",
          "      pause(false)",
          "      bLivePrimedRef.current = false",
          "      bStartSentRef.current = false",
          "      bArmedOffsetRef.current = 0",
          "      spaceResumeRef.current = false",
          "      liveCompleteSentRef.current = false",
          "      setStageMode('A')",
          "    }",
          "    const onForceStopped = () => { finalizeUi(); showToast('연습실 강제종료 완료 · 현재 위치에서 다시 B LIVE START 가능') }",
          "    const onFinishedHardReset = () => { finalizeUi() }",
          "    window.addEventListener('lsm-live-force-stopped', onForceStopped)",
          "    window.addEventListener('lsm-live-finished', onFinishedHardReset)",
          "    return () => {",
          "      window.removeEventListener('lsm-live-force-stopped', onForceStopped)",
          "      window.removeEventListener('lsm-live-finished', onFinishedHardReset)",
          "    }",
          "  }, [mediaKind])",
          "",
          "  // Browser-independent completion backup. MASTER also auto-finishes by SHOW_DURATION_MS.",
          "  useEffect(() => {",
          "    if (!stageLive || !masterConnected || !masterProtocolReady) return undefined",
          "    const showEndMs = Math.max(0, Number(firmwareBundle.showDurationMs) || 0)",
          "    if (!showEndMs) return undefined",
          "    const startMs = stageMode === 'B_LIVE' ? Math.max(0, Number(bArmedOffsetRef.current) || 0) : 0",
          "    const remainingMs = Math.max(0, showEndMs - startMs)",
          "    const timer = window.setTimeout(() => {",
          "      if (liveCompleteSentRef.current) return",
          "      liveCompleteSentRef.current = true",
          "      sendSerialLine('LIVE_COMPLETE').then((sent) => { if (!sent) liveCompleteSentRef.current = false })",
          "    }, remainingMs + 120)",
          "    return () => window.clearTimeout(timer)",
          "  }, [stageLive, stageMode, masterConnected, masterProtocolReady, firmwareBundle.showDurationMs])",
          "",
          watchdogAnchor,
        ].join('\n')
        out = out.replace(watchdogAnchor, effects)
      }

      out = out.replace(
        'disabled={!masterProtocolReady || !previewSafe || stageLive} onClick={armModeB}>B LIVE START @ {fmtTime(currentTime)}',
        'disabled={!masterProtocolReady || (!rehearsalMode && !previewSafe) || stageLive} onClick={armModeB}>B LIVE START @ {fmtTime(currentTime)}'
      )

      const earlyStopButton = "          <button className=\"tbtn compact\" disabled={stageMode !== 'B_LIVE' || !canAbortLive} onClick={requestStageStop} style={{ color: canAbortLive ? '#ff657a' : undefined }}>■ STOP BEFORE CUE</button>"
      if (!out.includes('>연습실 모드<')) {
        if (!out.includes(earlyStopButton)) throw new Error('rehearsal ui: early stop button anchor not found')
        const controls = [
          earlyStopButton,
          "          <label title=\"연습 중에만 켜세요. 타임라인 중간 시작과 공연 중 강제종료를 허용합니다.\" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 7px', height: 26, border: rehearsalMode ? '1px solid #a76b2b' : '1px solid #343b46', borderRadius: 4, color: rehearsalMode ? '#ffb85c' : '#8d98a8', background: rehearsalMode ? '#2a1d0f' : '#171b21', cursor: 'pointer' }}>",
          "            <input type=\"checkbox\" checked={rehearsalMode} onChange={(e) => setRehearsalMode(e.target.checked)} /> <span>연습실 모드</span>",
          "          </label>",
          "          <button className=\"tbtn compact\" disabled={!rehearsalMode || !stageLive || !masterProtocolReady} onClick={forceStopRehearsal} style={{ color: rehearsalMode && stageLive ? '#ff657a' : undefined, borderColor: rehearsalMode && stageLive ? '#7b3542' : undefined }}>■ 중간 강제종료</button>",
        ].join('\n')
        out = out.replace(earlyStopButton, controls)
      }

      out = out.replace(
        "canAbortLive ? 'LIVE · 첫 큐 전 STOP 가능' : stageLive ? 'LIVE · STOP 잠금' : 'B 버튼 = 즉시 LIVE GO · SPACE = Preview · D2 = A 독립 GO'",
        "rehearsalMode ? (stageLive ? '연습실 LIVE · 중간 강제종료 가능' : '연습실 · 타임라인 어디서든 B LIVE START') : canAbortLive ? 'LIVE · 첫 큐 전 STOP 가능' : stageLive ? 'LIVE · STOP 잠금' : 'B 버튼 = 즉시 LIVE GO · SPACE = Preview · D2 = A 독립 GO'"
      )

      return { code: out, map: null }
    },
  }
}
