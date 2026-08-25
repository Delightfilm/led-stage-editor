const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`v0.6.10 A CLOCK diagnostics: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementV0610AClockDiagnosticsPlugin() {
  return {
    name: 'management-v0610-a-clock-diagnostics',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      // WEB-only observability/fail-clarity patch. MASTER/RX firmware behavior is unchanged.
      const stateAnchor = "  const [liveUncertain, setLiveUncertain] = useState(false)"
      out = replaceRequired(
        out,
        stateAnchor,
        `${stateAnchor}\n  const [aClockDiag, setAClockDiag] = useState('IDLE')`,
        'diagnostic state'
      )

      const parserAnchor = "    const v065Ready = line.match(/^LSM_READY LSM-B1 AB_DUAL V065 BUNDLE ([0-9A-Fa-f]{8})$/)"
      out = replaceRequired(
        out,
        parserAnchor,
        `    // v0.6.10: keep A CLOCK progress visible instead of letting heartbeat PONG/RXMON\n    // overwrite the only clue about a failed hardware GO.\n    if (line.startsWith('A_SCHEDULED ')) setAClockDiag(\`MASTER SCHEDULED · \${line}\`)\n    if (line.startsWith('A_LIVE_STARTED ')) setAClockDiag(\`LIVE CONFIRMED · \${line}\`)\n    if (line.startsWith('A_SCHEDULE_DENIED') || line.startsWith('A_SCHEDULE_BUSY') || line.startsWith('ERR A_CLOCK')) {\n      setAClockDiag(\`DENIED · \${line}\`)\n    }\n    if (line === 'LIVE_FINISHED' || line === 'LIVE_FORCE_STOPPED') setAClockDiag('IDLE')\n${parserAnchor}`,
        'serial A progress parser'
      )

      const selectHeader = "  const selectModeA = async () => {"
      out = replaceRequired(
        out,
        selectHeader,
        `${selectHeader}\n    setAClockDiag('REQUEST')`,
        'A request entry'
      )

      const oldAGuard = `    if (!firmwareSafetyReady) { showToast(masterProtocolReady ? '안전 잠금 · 사이트와 MASTER BUNDLE 불일치 · v0.6.5 펌웨어를 다시 업로드해 주세요.' : 'MASTER v0.6.5 펌웨어 연결 후 사용할 수 있어요.'); return }\n    if (!stageLive && anyRxLocalLive) { showToast('안전 잠금 · RX LOCAL LIVE가 남아 있어 새 START를 막았습니다.'); return }`
      const newAGuard = `    if (!firmwareSafetyReady) { setAClockDiag('BLOCKED · FW/BUNDLE'); showToast(masterProtocolReady ? '안전 잠금 · 사이트와 MASTER BUNDLE 불일치 · v0.6.5 펌웨어를 다시 업로드해 주세요.' : 'MASTER v0.6.5 펌웨어 연결 후 사용할 수 있어요.'); return }\n    if (!stageLive && anyRxLocalLive) { setAClockDiag('BLOCKED · RX LOCAL LIVE'); showToast('안전 잠금 · RX LOCAL LIVE가 남아 있어 새 START를 막았습니다.'); return }`
      out = replaceRequired(out, oldAGuard, newAGuard, 'A safety guard diagnostics')

      const busyBlock = `    if (window.__LSM_A_V063_REQUEST_BUSY__) {\n      showToast('A CLOCK LOCK 준비 중 · 중복 START를 안전상 차단했습니다.')\n      return\n    }`
      out = replaceRequired(
        out,
        busyBlock,
        `    if (window.__LSM_A_V063_REQUEST_BUSY__) {\n      setAClockDiag('BLOCKED · REQUEST BUSY')\n      showToast('A CLOCK LOCK 준비 중 · 중복 START를 안전상 차단했습니다.')\n      return\n    }`,
        'A request busy diagnostics'
      )

      out = replaceRequired(
        out,
        `    window.__LSM_A_V063_REQUEST_BUSY__ = true\n\n    // Install the outcome listeners BEFORE the USB write so even a very fast MASTER`,
        `    window.__LSM_A_V063_REQUEST_BUSY__ = true\n    setAClockDiag('USB SEND · A_LIVE_SCHEDULE')\n\n    // Install the outcome listeners BEFORE the USB write so even a very fast MASTER`,
        'A USB send state'
      )

      const sendFailure = `    if (!sent) {\n      window.__LSM_A_V063_REQUEST_BUSY__ = false\n      window.dispatchEvent(new CustomEvent('lsm-a-v063-denied', { detail: { line: 'USB_WRITE_FAILED' } }))\n      if (!wasPlaying) pause(false)\n      showToast('A CLOCK LOCK 전송 실패 · MASTER 연결을 확인해 주세요.')\n      return\n    }`
      out = replaceRequired(
        out,
        sendFailure,
        `    if (!sent) {\n      window.__LSM_A_V063_REQUEST_BUSY__ = false\n      window.dispatchEvent(new CustomEvent('lsm-a-v063-denied', { detail: { line: 'USB_WRITE_FAILED' } }))\n      setAClockDiag('FAILED · USB WRITE')\n      // A hardware GO failed: stop local playback even if it had already been running,\n      // so the browser cannot visually impersonate a successful LIVE show.\n      pause(false)\n      showToast('A CLOCK LOCK 전송 실패 · MASTER 연결을 확인해 주세요.')\n      return\n    }`,
        'A USB failure clarity'
      )

      const prepareToast = `    showToast(\`A CLOCK LOCK 준비 · O 즉시참여 / X·? JOIN WAIT / V 격리 · \${fmtTime(goOffsetMs / 1000)}\`)`
      out = replaceRequired(
        out,
        prepareToast,
        `    setAClockDiag('WAITING · MASTER GO')\n${prepareToast}`,
        'A waiting state'
      )

      const oldOutcome = `    if (!outcome.ok) {\n      if (outcome.line.includes('TIMEOUT')) {\n        liveUncertainRef.current = true\n        setLiveUncertain(true)\n        bArmedOffsetRef.current = goOffsetMs\n        bLivePrimedRef.current = true\n        setStageMode('A_LIVE')\n        sendSerialLine('STATUS')\n        showToast('A START 확인 불명 · 재START 잠금 · 실제 RX 상태를 확인하세요.')\n        return\n      }\n      if (!wasPlaying) pause(false)\n      showToast(\`A CLOCK LOCK 취소 · \${outcome.line}\`)\n      return\n    }`
      const newOutcome = `    if (!outcome.ok) {\n      if (outcome.line.includes('TIMEOUT')) {\n        setAClockDiag('TIMEOUT · STATUS CHECK')\n        liveUncertainRef.current = true\n        setLiveUncertain(true)\n        bArmedOffsetRef.current = goOffsetMs\n        bLivePrimedRef.current = true\n        setStageMode('A_LIVE')\n        sendSerialLine('STATUS')\n        showToast('A START 확인 불명 · 재START 잠금 · 실제 RX 상태를 확인하세요.')\n        return\n      }\n      setAClockDiag(\`DENIED · \${outcome.line}\`)\n      // A was explicitly denied by MASTER. Freeze the browser so failure is obvious.\n      pause(false)\n      showToast(\`A CLOCK LOCK 취소 · \${outcome.line}\`)\n      return\n    }`
      out = replaceRequired(out, oldOutcome, newOutcome, 'A deny/timeout diagnostics')

      out = replaceRequired(
        out,
        `    liveUncertainRef.current = false\n    setLiveUncertain(false)\n    setCurrentTime(clamp(confirmedTime, 0, duration))\n    setStageMode('A_LIVE')`,
        `    setAClockDiag(\`LIVE CONFIRMED · \${outcome.line}\`)\n    liveUncertainRef.current = false\n    setLiveUncertain(false)\n    setCurrentTime(clamp(confirmedTime, 0, duration))\n    setStageMode('A_LIVE')`,
        'A confirmed state'
      )

      const modeLabel = `          <b style={{ color: stageModeColor }}>{stageModeLabel}</b>`
      out = replaceRequired(
        out,
        modeLabel,
        `${modeLabel}\n          <span title="A CLOCK diagnostic state" style={{ color: aClockDiag.startsWith('LIVE CONFIRMED') ? '#62e7a2' : aClockDiag.startsWith('DENIED') || aClockDiag.startsWith('FAILED') || aClockDiag.startsWith('BLOCKED') ? '#ff657a' : aClockDiag === 'IDLE' ? '#687385' : '#ffd84a', fontWeight: 800 }}>A CLOCK · {aClockDiag}</span>`,
        'visible A diagnostic badge'
      )

      if (!out.includes('WEB v0.6.9')) throw new Error('v0.6.10 A CLOCK diagnostics: WEB v0.6.9 marker missing')
      out = out.replace('WEB v0.6.9', 'WEB v0.6.10')

      return { code: out, map: null }
    },
  }
}
