const fail = (message) => { throw new Error(`v0.6.11 performance lock: ${message}`) }

export function managementV0611PerformanceLockPlugin() {
  return {
    name: 'management-v0611-performance-lock',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      // v0.6.11 semantics:
      // 1) B LIVE is the only web path that creates/starts the performance epoch.
      // 2) A is a one-way performance COMMIT of that already-running B epoch.
      // 3) A handoff sends NO serial/RF command, performs NO seek/re-anchor/restart,
      //    and therefore cannot disturb the RX local timeline at the handoff boundary.
      // 4) Existing RX firmware already owns any running A/B epoch locally, so RF/USB
      //    loss after the handoff does not stop local playback.
      const fnStart = out.indexOf('  const selectModeA = async () => {')
      if (fnStart < 0) fail('selectModeA start missing')
      const fnEnd = out.indexOf('\n\n  const ', fnStart + 20)
      if (fnEnd < 0) fail('selectModeA end missing')

      const replacement = `  const selectModeA = async () => {
    // A is no longer a START mechanism. It is the second, irreversible performance
    // safety gate applied only to an already-confirmed B LIVE epoch.
    if (stageMode === 'A_LIVE') {
      setAClockDiag('COMMITTED · A PERFORMANCE LOCK')
      showToast('이미 A 독립 공연 LOCK 상태입니다.')
      return
    }
    if (stageMode !== 'B_LIVE') {
      setAClockDiag('BLOCKED · B LIVE REQUIRED')
      showToast('① B LIVE START가 정상 실행된 뒤 ② A 독립 공연 LOCK을 사용할 수 있어요.')
      return
    }
    if (liveUncertainRef.current || liveUncertain) {
      setAClockDiag('BLOCKED · LIVE STATE UNKNOWN')
      showToast('LIVE 상태 확인 중에는 A 공연 LOCK을 걸 수 없어요.')
      return
    }
    if (!firmwareSafetyReady) {
      setAClockDiag('BLOCKED · FW/BUNDLE')
      showToast('FW MATCH가 확인된 MASTER에서만 A 공연 LOCK을 걸 수 있어요.')
      return
    }

    const localLiveCount = rxMon.filter((rx) => !!rx.playing).length
    if (localLiveCount < 1) {
      setAClockDiag('BLOCKED · RX LIVE NOT CONFIRMED')
      showToast('실제 RX LIVE / LOCAL 확인 후 A 공연 LOCK을 걸어 주세요.')
      return
    }

    // Critical invariant: no sendSerialLine(), no media seek, no pause/play, no new
    // cueSeq/showStartMasterMs. The exact B epoch simply continues in every RX.
    window.__LSM_A_V063_REQUEST_BUSY__ = false
    bStartSentRef.current = false
    spaceResumeRef.current = false
    setAClockDiag(\`COMMITTED · \${localLiveCount} RX LOCAL\`)
    setStageMode('A_LIVE')
    showToast(\`A 독립 공연 LOCK 완료 · \${localLiveCount} RX 로컬 계속 진행 · MASTER/RF 손실 허용\`)
  }`

      out = out.slice(0, fnStart) + replacement + out.slice(fnEnd)

      // Replace the final A control structurally so later historical labels cannot
      // accidentally re-expose A CLOCK START from STANDBY.
      const clickMarker = 'onClick={selectModeA}'
      const clickIndex = out.indexOf(clickMarker)
      if (clickIndex < 0) fail('A control button missing')
      const buttonStart = out.lastIndexOf('<button', clickIndex)
      const buttonEnd = out.indexOf('</button>', clickIndex)
      if (buttonStart < 0 || buttonEnd < 0) fail('A control button bounds missing')
      const aButton = `          <button
            className="tbtn compact"
            disabled={stageMode !== 'B_LIVE' || liveUncertain}
            onClick={selectModeA}
            title={stageMode === 'B_LIVE' ? '실행 중인 B LIVE를 재시작 없이 A 독립 공연 LOCK으로 확정' : '먼저 B LIVE START가 필요합니다'}
            style={{ color: stageMode === 'A_LIVE' ? '#62e7a2' : stageMode === 'B_LIVE' ? '#ffd84a' : undefined, borderColor: stageMode === 'B_LIVE' ? '#7a6628' : undefined }}
          >
            {stageMode === 'A_LIVE' ? '✓ A 독립 공연 LOCKED' : stageMode === 'B_LIVE' ? '② A 독립 전환 · 공연 LOCK' : '② A 공연 LOCK · B LIVE 후 사용'}
          </button>`
      out = out.slice(0, buttonStart) + aButton + out.slice(buttonEnd + '</button>'.length)

      if (!out.includes('B LIVE START @ {fmtTime(currentTime)}')) fail('B LIVE button label anchor missing')
      out = out.replace('B LIVE START @ {fmtTime(currentTime)}', '① B LIVE START @ {fmtTime(currentTime)}')

      // Make the operating model unambiguous in the status strip.
      out = out.replace("'A · INDEPENDENT LIVE'", "'A · INDEPENDENT LIVE · LOCKED'")
      out = out.replace("'B · LIVE'", "'B · LIVE · CONTROL'")
      out = out.replace("'A · STANDALONE'", "'STANDBY'")

      // v0.6.10 A CLOCK diagnostics are retained internally for old physical/serial
      // telemetry, but the web control now exposes only the two-stage performance lock.
      const diagStart = out.indexOf('<span title="A CLOCK diagnostic state"')
      if (diagStart < 0) fail('v0.6.10 diagnostic badge missing')
      const diagEnd = out.indexOf('</span>', diagStart)
      if (diagEnd < 0) fail('diagnostic badge end missing')
      const lockBadge = `<span title="Two-stage performance safety state" style={{ color: stageMode === 'A_LIVE' ? '#62e7a2' : stageMode === 'B_LIVE' ? '#ffd84a' : '#687385', fontWeight: 800 }}>{stageMode === 'A_LIVE' ? 'A LOCK · COMMITTED' : stageMode === 'B_LIVE' ? 'A LOCK · READY' : 'A LOCK · B LIVE REQUIRED'}</span>`
      out = out.slice(0, diagStart) + lockBadge + out.slice(diagEnd + '</span>'.length)

      // The existing rehearsal force-stop gate must remain B-only. A is irreversible
      // from the management site until natural completion.
      if (!out.includes("if (stageMode === 'A_LIVE') { showToast('A 독립 LIVE는 중간 정지/강제종료가 잠겨 있습니다.'); return }")) {
        fail('A force-stop hard gate missing')
      }
      if (!out.includes("disabled={!rehearsalMode || stageMode !== 'B_LIVE' || !masterProtocolReady}")) {
        fail('B-only rehearsal force-stop button gate missing')
      }

      // Final build-time invariants for the new A control path.
      const finalAStart = out.indexOf('  const selectModeA = async () => {')
      const finalAEnd = out.indexOf('\n\n  const ', finalAStart + 20)
      const finalABlock = out.slice(finalAStart, finalAEnd)
      if (finalABlock.includes('sendSerialLine(')) fail('A handoff must not send serial commands')
      if (finalABlock.includes('A_LIVE_SCHEDULE') || finalABlock.includes('A_LIVE_START_NOW')) fail('legacy A START command leaked into handoff')
      if (finalABlock.includes('playLocalAt(') || finalABlock.includes('setCurrentTime(') || finalABlock.includes('pause(')) fail('A handoff must not mutate transport')

      if (!out.includes('WEB v0.6.10')) fail('WEB v0.6.10 marker missing')
      out = out.replace('WEB v0.6.10', 'WEB v0.6.11')

      return { code: out, map: null }
    },
  }
}
