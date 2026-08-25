const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`autonomous handoff: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementAutonomousHandoffPlugin() {
  return {
    name: 'management-autonomous-handoff',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      // B LIVE has already established the authoritative show anchor in MASTER/RX.
      // A handoff must therefore be a UI-only ownership change: no MODE_A, SEEK,
      // PAUSE, START or delay command is sent here. That guarantees zero transport
      // discontinuity at the handoff boundary and lets the running local timelines
      // survive a subsequent browser/USB/RF management-path loss.
      const oldSelectModeA = [
        "  const selectModeA = async () => {",
        "    if (!masterProtocolReady) { showToast('MASTER A/B 펌웨어 연결 후 사용할 수 있어요.'); return }",
        "    if (stageLive) { showToast('LIVE 재생 중에는 모드를 바꿀 수 없어요.'); return }",
        "    await sendSerialLine('MODE_A')",
        "    setStageMode('A')",
        "    bArmedOffsetRef.current = 0",
        "    bStartSentRef.current = false",
        "    spaceResumeRef.current = false",
        "    showToast('A 독립 모드: D2 START는 타임라인 0초부터 시작합니다.')",
        "  }",
      ].join('\n')

      const newSelectModeA = [
        "  const selectModeA = async () => {",
        "    if (stageMode === 'B_LIVE') {",
        "      // Seamless B -> A autonomous ownership handoff. MASTER/RX keep the exact",
        "      // showStartMasterMs/cueSeq they already have; sending MODE_A here would add",
        "      // unnecessary serial/RF work at the most timing-sensitive moment.",
        "      bStartSentRef.current = false",
        "      spaceResumeRef.current = false",
        "      setStageMode('A_LIVE')",
        "      showToast(`A 독립 인계 완료 · ${fmtTime(currentTime)} · MASTER/RX 자체 진행`)",
        "      return",
        "    }",
        "    if (stageMode === 'A_LIVE') { showToast('이미 A 독립 LIVE로 자체 진행 중입니다.'); return }",
        "    if (!masterProtocolReady) { showToast('MASTER A/B 펌웨어 연결 후 사용할 수 있어요.'); return }",
        "    await sendSerialLine('MODE_A')",
        "    setStageMode('A')",
        "    bArmedOffsetRef.current = 0",
        "    bStartSentRef.current = false",
        "    spaceResumeRef.current = false",
        "    showToast('A 독립 모드: 다음 D2 START는 타임라인 0초부터 시작합니다.')",
        "  }",
      ].join('\n')
      out = replaceRequired(out, oldSelectModeA, newSelectModeA, 'selectModeA')

      const oldAButton = '          <button className="tbtn compact" disabled={!masterProtocolReady || stageLive} onClick={selectModeA}>A 독립 · 0초</button>'
      const newAButton = '          <button className="tbtn compact" disabled={stageMode === \'A_LIVE\' || (stageMode !== \'B_LIVE\' && !masterProtocolReady)} onClick={selectModeA}>{stageMode === \'B_LIVE\' ? \'A 독립 인계 · 계속 진행\' : stageMode === \'A_LIVE\' ? \'A 독립 진행 중\' : \'A 독립 · 0초\'}</button>'
      out = replaceRequired(out, oldAButton, newAButton, 'A button')

      // Once ownership has been handed to A, rehearsal force-stop is intentionally
      // locked. This matches standalone A semantics: an already-running show is not
      // interruptible from the management site.
      const oldForceGate = [
        "    if (!rehearsalMode) { showToast('중간 강제종료는 연습실 모드에서만 사용할 수 있어요.'); return }",
        "    if (!stageLive) { showToast('현재 LIVE가 진행 중이 아니에요.'); return }",
        "    if (!masterProtocolReady) { showToast('MASTER 연결을 확인해 주세요.'); return }",
      ].join('\n')
      const newForceGate = [
        "    if (stageMode === 'A_LIVE') { showToast('A 독립 LIVE는 중간 정지/강제종료가 잠겨 있습니다.'); return }",
        "    if (!rehearsalMode) { showToast('중간 강제종료는 연습실 모드에서만 사용할 수 있어요.'); return }",
        "    if (stageMode !== 'B_LIVE') { showToast('B LIVE 진행 중에만 연습실 강제종료를 사용할 수 있어요.'); return }",
        "    if (!masterProtocolReady) { showToast('MASTER 연결을 확인해 주세요.'); return }",
      ].join('\n')
      out = replaceRequired(out, oldForceGate, newForceGate, 'force-stop gate')

      const oldForceButton = '          <button className="tbtn compact" disabled={!rehearsalMode || !stageLive || !masterProtocolReady} onClick={forceStopRehearsal} style={{ color: rehearsalMode && stageLive ? \'#ff657a\' : undefined, borderColor: rehearsalMode && stageLive ? \'#7b3542\' : undefined }}>■ 중간 강제종료</button>'
      const newForceButton = '          <button className="tbtn compact" disabled={!rehearsalMode || stageMode !== \'B_LIVE\' || !masterProtocolReady} onClick={forceStopRehearsal} style={{ color: rehearsalMode && stageMode === \'B_LIVE\' ? \'#ff657a\' : undefined, borderColor: rehearsalMode && stageMode === \'B_LIVE\' ? \'#7b3542\' : undefined }}>■ 중간 강제종료</button>'
      out = replaceRequired(out, oldForceButton, newForceButton, 'force-stop button')

      // The browser completion timer is only a UI/USB backup; MASTER owns the real
      // end time. Base the backup on the current media clock so changing B_LIVE to
      // A_LIVE cannot accidentally restart a full remaining-duration timer.
      const oldRemaining = [
        "    const startMs = stageMode === 'B_LIVE' ? Math.max(0, Number(bArmedOffsetRef.current) || 0) : 0",
        "    const remainingMs = Math.max(0, showEndMs - startMs)",
      ].join('\n')
      const newRemaining = [
        "    const mediaEl = getMediaEl()",
        "    const positionMs = mediaEl && Number.isFinite(mediaEl.currentTime)",
        "      ? Math.max(0, Math.round(mediaEl.currentTime * 1000))",
        "      : Math.max(0, Math.round(currentTime * 1000))",
        "    const remainingMs = Math.max(0, showEndMs - positionMs)",
      ].join('\n')
      out = replaceRequired(out, oldRemaining, newRemaining, 'completion remaining time')

      out = out.replace(
        "const stageModeLabel = stageMode === 'A_LIVE' ? 'A · LIVE' :",
        "const stageModeLabel = stageMode === 'A_LIVE' ? 'A · INDEPENDENT LIVE' :"
      )

      return { code: out, map: null }
    },
  }
}
