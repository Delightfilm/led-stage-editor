const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`v0.6.5 web: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementSafetyV065WebPlugin() {
  return {
    name: 'management-safety-v065-web',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      out = replaceRequired(out, "  const [stageMode, setStageMode] = useState('A')", "  const [stageMode, setStageMode] = useState('A')\n  const [liveUncertain, setLiveUncertain] = useState(false)", 'uncertain state')
      out = replaceRequired(out, '  const bStartSentRef = useRef(false)', '  const bStartSentRef = useRef(false)\n  const liveUncertainRef = useRef(false)', 'uncertain ref')

      const stageAnchor = "  const stageLive = stageMode === 'A_LIVE' || stageMode === 'B_LIVE'"
      out = replaceRequired(
        out,
        stageAnchor,
        `${stageAnchor}
  const bundleHashHex = String(firmwareBundle.bundleHashHex || '').toUpperCase()
  const firmwareSafetyReady = masterProtocolReady && !!bundleHashHex && window.__LSM_MASTER_V065_PORT__ === serialPortRef.current && window.__LSM_MASTER_V065_BUNDLE__ === bundleHashHex
  const anyRxLocalLive = rxMon.some((rx) => !!rx.playing)`,
        'safety derived state'
      )

      const oldHandshake = `    if (line.includes('LSM_READY LSM-B1 AB_DUAL V064')) {
      window.__LSM_MASTER_V064_PORT__ = serialPortRef.current
    }`
      const newHandshake = `    const v065Ready = line.match(/^LSM_READY LSM-B1 AB_DUAL V065 BUNDLE ([0-9A-Fa-f]{8})$/)
    if (v065Ready) {
      window.__LSM_MASTER_V065_PORT__ = serialPortRef.current
      window.__LSM_MASTER_V065_BUNDLE__ = String(v065Ready[1] || '').toUpperCase()
    }
    if (line === 'BUSY LIVE') {
      bStartSentRef.current = false
      liveUncertainRef.current = true
      setLiveUncertain(true)
      setStageMode('B_LIVE')
    }
    if (line.startsWith('A_LIVE_STARTED ') || line.startsWith('LIVE_STARTED ')) {
      liveUncertainRef.current = false
      setLiveUncertain(false)
    }`
      out = replaceRequired(out, oldHandshake, newHandshake, 'v0.6.5 handshake')

      const writeOld = `    const payload = new TextEncoder().encode(\`${'${line}'}\\n\`)
    serialWriteQueueRef.current = serialWriteQueueRef.current
      .then(() => writer.write(payload))
      .catch((error) => {
        setMasterStatus('USB 쓰기 오류')
        addMasterLog(\`! ${'${error?.message || \'write error\'}'}\`)
      })
    await serialWriteQueueRef.current
    return true`
      const writeNew = `    const payload = new TextEncoder().encode(\`${'${line}'}\\n\`)
    let writeOk = true
    serialWriteQueueRef.current = serialWriteQueueRef.current
      .then(() => writer.write(payload))
      .catch((error) => {
        writeOk = false
        setMasterStatus('USB 쓰기 오류')
        addMasterLog(\`! ${'${error?.message || \'write error\'}'}\`)
      })
    await serialWriteQueueRef.current
    return writeOk`
      out = replaceRequired(out, writeOld, writeNew, 'truthful serial write result')

      const oldAGuard = `    if (!masterProtocolReady) { showToast('MASTER v0.6.4 펌웨어 연결 후 사용할 수 있어요.'); return }
    if (window.__LSM_MASTER_V064_PORT__ !== serialPortRef.current) {
      showToast('안전 잠금 · MASTER v0.6.4 펌웨어를 업로드한 뒤 다시 연결해 주세요.')
      return
    }`
      const newAGuard = `    if (!firmwareSafetyReady) { showToast(masterProtocolReady ? '안전 잠금 · 사이트와 MASTER BUNDLE 불일치 · v0.6.5 펌웨어를 다시 업로드해 주세요.' : 'MASTER v0.6.5 펌웨어 연결 후 사용할 수 있어요.'); return }
    if (!stageLive && anyRxLocalLive) { showToast('안전 잠금 · RX LOCAL LIVE가 남아 있어 새 START를 막았습니다.'); return }`
      out = replaceRequired(out, oldAGuard, newAGuard, 'A bundle guard')

      const armStart = out.indexOf('  const armModeB = async () => {')
      const armEnd = out.indexOf('\n\n  const ', armStart + 10)
      if (armStart < 0 || armEnd < 0) throw new Error('v0.6.5 web: B helper bounds missing')
      let armBlock = out.slice(armStart, armEnd)
      armBlock = replaceRequired(
        armBlock,
        "    if (!masterProtocolReady) { showToast('MASTER A/B 펌웨어 연결 후 사용할 수 있어요.'); return }",
        "    if (!firmwareSafetyReady) { showToast(masterProtocolReady ? '안전 잠금 · 사이트와 MASTER BUNDLE 불일치 · v0.6.5 펌웨어를 다시 업로드해 주세요.' : 'MASTER v0.6.5 펌웨어 연결 후 사용할 수 있어요.'); return }\n    if (anyRxLocalLive && !stageLive) { showToast('안전 잠금 · RX LOCAL LIVE 감지 · 중복 START 차단'); return }\n    if (liveUncertainRef.current) { showToast('LIVE STATE UNKNOWN · 재START 잠금'); return }",
        'B safety guard'
      )
      armBlock = replaceRequired(armBlock, "    setStageMode('B_LIVE')\n", '', 'remove optimistic B LIVE')
      const successToast = "    showToast(`${rehearsalMode ? '연습실' : 'B'} LIVE GO · ${fmtTime(goOffsetMs / 1000)}${userLeadMs > 0 ? ` · START LEAD ${userLeadMs}ms` : ''}`)"
      const waitBlock = `    window.setTimeout(() => {
      if (!bStartSentRef.current) return
      liveUncertainRef.current = true
      setLiveUncertain(true)
      setStageMode('B_LIVE')
      sendSerialLine('STATUS')
      showToast('B START 확인 불명 · 재START 잠금 · 실제 RX 상태를 확인하세요.')
    }, 1800)
    showToast(\`B LIVE START 전송 · MASTER LIVE_STARTED 확인 대기 · ${'${fmtTime(goOffsetMs / 1000)}'}\`)`
      armBlock = replaceRequired(armBlock, successToast, waitBlock, 'B acknowledgement wait')
      out = out.slice(0, armStart) + armBlock + out.slice(armEnd)

      const oldAOutcome = `    if (!outcome.ok) {
      if (!wasPlaying) pause(false)
      const reason = outcome.line.includes('TIMEOUT')
        ? 'MASTER 확인 응답이 없어 시작을 차단했습니다.'
        : outcome.line
      showToast(\`A CLOCK LOCK 취소 · ${'${reason}'}\`)
      return
    }`
      const newAOutcome = `    if (!outcome.ok) {
      if (outcome.line.includes('TIMEOUT')) {
        liveUncertainRef.current = true
        setLiveUncertain(true)
        bArmedOffsetRef.current = goOffsetMs
        bLivePrimedRef.current = true
        setStageMode('A_LIVE')
        sendSerialLine('STATUS')
        showToast('A START 확인 불명 · 재START 잠금 · 실제 RX 상태를 확인하세요.')
        return
      }
      if (!wasPlaying) pause(false)
      showToast(\`A CLOCK LOCK 취소 · ${'${outcome.line}'}\`)
      return
    }`
      out = replaceRequired(out, oldAOutcome, newAOutcome, 'A unknown timeout')
      out = replaceRequired(out, `    setCurrentTime(clamp(confirmedTime, 0, duration))\n    setStageMode('A_LIVE')`, `    liveUncertainRef.current = false\n    setLiveUncertain(false)\n    setCurrentTime(clamp(confirmedTime, 0, duration))\n    setStageMode('A_LIVE')`, 'A success clear')

      out = replaceRequired(
        out,
        `      const rows = line.slice(6).split(',').map((v) => { const [id, state, us, age, retry] = v.split(':'); return { id: Number(id), state, us: Number(us) || 0, age: Number(age), retry: Number(retry) || 0 } })`,
        `      const rows = line.slice(6).split(',').map((v) => { const [id, state, us, age, retry, playingRaw, activeSeqRaw] = v.split(':'); return { id: Number(id), state, us: Number(us) || 0, age: Number(age), retry: Number(retry) || 0, playing: Number(playingRaw) === 1, activeSeq: Number(activeSeqRaw) || 0 } })`,
        'RXMON parser'
      )
      const oldLabel = `{s==='O'?(stageLive?'LIVE / ONLINE':'ONLINE'):s==='V'?'QUARANTINE V':s==='?'?(stageLive?'JOIN WAIT ?':'ACK ?'):s==='W'?'WAIT':(stageLive?'HOLD / JOIN WAIT':'OFFLINE')}`
      const newLabel = `{s==='O'?(rx.playing?'LIVE / LOCAL':stageLive?'JOIN WAIT / ONLINE':'ONLINE'):s==='V'?'QUARANTINE V':s==='?'?(rx.playing?'HOLD / LOCAL':stageLive?'JOIN WAIT ?':'ACK ?'):s==='W'?'WAIT':(rx.playing?'HOLD / LOCAL':stageLive?'JOIN WAIT':'OFFLINE')}`
      out = replaceRequired(out, oldLabel, newLabel, 'RX live label')

      out = replaceRequired(out, '  const syncFromEditor = async (providedSession = cloudSession) => {', `  const syncFromEditor = async (providedSession = cloudSession) => {\n    if (stageLive || liveUncertainRef.current) { showToast('LIVE 안전 잠금 · 공연 중 EDITOR 동기화를 막았습니다.'); return }`, 'sync lock')
      out = replaceRequired(out, `  const stepFrame = (direction) => {\n    pause()`, `  const stepFrame = (direction) => {\n    if (stageLive || liveUncertainRef.current) { showToast('LIVE 안전 잠금 · 프레임 이동을 막았습니다.'); return }\n    pause()`, 'frame lock')
      out = replaceRequired(out, `  const startScrub = (event) => {\n    if (event.button !== 0) return`, `  const startScrub = (event) => {\n    if (stageLive || liveUncertainRef.current) { showToast('LIVE 안전 잠금 · 타임라인 이동을 막았습니다.'); return }\n    if (event.button !== 0) return`, 'scrub lock')

      out = out.replaceAll('disabled={syncBusy || !online}', 'disabled={syncBusy || !online || stageLive || liveUncertain}')
      out = out.replace(`<button className={\`tbtn play ${'${playing ? \'playing\' : \'\'}'}\`} onClick={() => playing ? pause() : play()}>`, `<button className={\`tbtn play ${'${playing ? \'playing\' : \'\'}'}\`} disabled={stageLive || liveUncertain} onClick={() => playing ? pause() : play()}>`)
      out = out.replace('<button className="transportPlay" onClick={() => playing ? pause() : play()}>', '<button className="transportPlay" disabled={stageLive || liveUncertain} onClick={() => playing ? pause() : play()}>')

      const badge = '<span className="readOnlyBadge">A안 → B안 READ ONLY</span>'
      if (out.includes(badge)) out = out.replace(badge, `${badge}\n          <span className="readOnlyBadge" style={{ color: firmwareSafetyReady ? '#62e7a2' : masterConnected ? '#ffb85c' : '#8d98a8' }}>{firmwareSafetyReady ? \`FW MATCH · ${'${bundleHashHex}'}\` : masterConnected ? 'FW/BUNDLE VERIFY' : 'FW —'}</span>\n          {liveUncertain && <span className="readOnlyBadge" style={{ color: '#ff657a' }}>⚠ LIVE STATE UNKNOWN · RESTART LOCK</span>}`)

      if (!out.includes('WEB v0.6.4')) throw new Error('v0.6.5 web: version marker missing')
      out = out.replace('WEB v0.6.4', 'WEB v0.6.5')

      return { code: out, map: null }
    },
  }
}
