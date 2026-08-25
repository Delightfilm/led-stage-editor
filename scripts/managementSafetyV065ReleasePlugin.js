const required = (ok, label) => {
  if (!ok) throw new Error(`v0.6.5 release safety: ${label}`)
}

const replaceRequired = (source, from, to, label) => {
  required(source.includes(from), `${label} anchor not found`)
  return source.replace(from, to)
}

export function managementSafetyV065ReleasePlugin() {
  return {
    name: 'management-safety-v065-release',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('src/managementProjectFirmware.js')) {
        let out = code
        const v064Import = 'import { applyResilientJoinMasterV064, applyResilientJoinReceiverV064 } from "./managementResilientJoinV064.js";'
        const v065Import = 'import { applySafetyMasterV065, applySafetyReceiverV065 } from "./managementSafetyV065.js";'
        required(out.includes(v064Import), 'v0.6.4 firmware import missing')
        if (!out.includes(v065Import)) out = out.replace(v064Import, `${v064Import}\n${v065Import}`)

        if (!out.includes('const hashBundleV065 =')) {
          const anchor = 'export function buildManagementFirmwareBundle'
          required(out.includes(anchor), 'bundle helper anchor missing')
          const helper = `const hashBundleV065 = (receiverHashes, showDurationMs, receiverCount) => {
  let hash = 0x811c9dc5
  const feed = (value) => {
    const s = String(value)
    for (let i = 0; i < s.length; i += 1) {
      hash ^= s.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    hash ^= 0xff
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  feed('LSM-V065')
  feed(showDurationMs)
  feed(receiverCount)
  receiverHashes.forEach(feed)
  return hash >>> 0
}

`
          out = out.replace(anchor, helper + anchor)
        }

        out = replaceRequired(
          out,
          `    const rawParts = Array.isArray(costume.parts) && costume.parts.length
      ? costume.parts
      : [{ id: \`fallback-\${index}\`, name: "EL 와이어", pin: 4 }];`,
          `    const rawParts = Array.isArray(costume.parts) && costume.parts.length
      ? costume.parts
      : [{ id: \`fallback-\${index}\`, name: "EL 와이어", pin: 4 }];
    const relayPins = rawParts.map((part) => Number(part.pin));
    if (relayPins.some((pin) => !Number.isInteger(pin) || pin < 2 || pin > 8)) throw new Error(\`RX\${index + 1}: relay pin must be UNO D2-D8 (D0/D1 Serial, D9-D13 nRF24 reserved).\`);
    if (new Set(relayPins).size !== relayPins.length) throw new Error(\`RX\${index + 1}: duplicate relay pin detected.\`);`,
          'relay pin validation'
        )

        out = replaceRequired(
          out,
          '      on = Math.floor(local * Math.max(0.01, Number(block.speed) || 5) * 2) % 2 === 0;',
          '      on = Math.floor(local * Math.min(RELAY_SAFE_HZ, Math.max(0.01, Number(block.speed) || 5)) * 2) % 2 === 0;',
          'relay strobe clamp'
        )

        const receiverCountAnchor = '  const receiverCount = Math.max(1, receivers.length || 1);'
        out = replaceRequired(
          out,
          receiverCountAnchor,
          `${receiverCountAnchor}\n  const bundleHash = hashBundleV065(receiverHashes, showDurationMs, receiverCount);`,
          'bundle hash creation'
        )

        const masterCall = '  masterCode = applyResilientJoinMasterV064(masterCode);'
        out = replaceRequired(out, masterCall, `${masterCall}\n  masterCode = applySafetyMasterV065(masterCode, bundleHash);`, 'master safety wrapper')

        const rxPrefix = '    code: '
        const rxNeedle = 'applyResilientJoinReceiverV064(applyV063FailClosedReceiver(applyStableAClockReceiverV063(hardenStageReceiverFirmware(buildNrf24ManagementReceiverSketch({ ...rx, showHash: receiverHashes[index] || 0 }))))))'
        required(out.includes(rxPrefix + rxNeedle), 'receiver v0.6.4 expression missing')
        out = out.replace(rxPrefix + rxNeedle, `${rxPrefix}applySafetyReceiverV065(${rxNeedle})`)

        const hashAnchor = '  feed("mgmt-resilient-join-v064");'
        out = replaceRequired(out, hashAnchor, `${hashAnchor}\n  feed("mgmt-safety-v065");`, 'receiver hash marker')

        out = replaceRequired(
          out,
          '    receiverHashes,\n    showDurationMs,',
          `    receiverHashes,
    bundleHash,
    bundleHashHex: bundleHash.toString(16).padStart(8, '0').toUpperCase(),
    showDurationMs,`,
          'bundle return'
        )
        return { code: out, map: null }
      }

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
        'web safety derived state'
      )

      const oldHandshake = `    if (line.includes('LSM_READY LSM-B1 AB_DUAL V064')) {
      window.__LSM_MASTER_V064_PORT__ = serialPortRef.current
    }`
      const newHandshake = `    const v065Ready = line.match(/^LSM_READY LSM-B1 AB_DUAL V065 BUNDLE ([0-9A-Fa-f]{8})$/)
    if (v065Ready) {
      window.__LSM_MASTER_V065_PORT__ = serialPortRef.current
      window.__LSM_MASTER_V065_BUNDLE__ = String(v065Ready[1] || '').toUpperCase()
    }
    if (line === 'BUSY LIVE' || line.startsWith('ERR ')) {
      bStartSentRef.current = false
      bLivePrimedRef.current = false
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
      required(armStart >= 0 && armEnd > armStart, 'B helper bounds missing')
      let armBlock = out.slice(armStart, armEnd)
      armBlock = replaceRequired(
        armBlock,
        "    if (!masterProtocolReady) { showToast('MASTER A/B 펌웨어 연결 후 사용할 수 있어요.'); return }",
        "    if (!firmwareSafetyReady) { showToast(masterProtocolReady ? '안전 잠금 · 사이트와 MASTER BUNDLE 불일치 · v0.6.5 펌웨어를 다시 업로드해 주세요.' : 'MASTER v0.6.5 펌웨어 연결 후 사용할 수 있어요.'); return }\n    if (anyRxLocalLive && !stageLive) { showToast('안전 잠금 · RX LOCAL LIVE 감지 · 중복 START 차단'); return }\n    if (liveUncertainRef.current) { showToast('LIVE STATE UNKNOWN · 재START 잠금'); return }",
        'B safety guard'
      )
      armBlock = replaceRequired(armBlock, "    setStageMode('B_LIVE')\n", '', 'remove optimistic B LIVE transition')
      const bSuccessToastNeedle = "    showToast(`${rehearsalMode ? '연습실' : 'B'} LIVE GO · ${fmtTime(goOffsetMs / 1000)}${userLeadMs > 0 ? ` · START LEAD ${userLeadMs}ms` : ''}`)"
      const bWait = `    window.setTimeout(() => {
      if (!bStartSentRef.current) return
      liveUncertainRef.current = true
      setLiveUncertain(true)
      setStageMode('B_LIVE')
      sendSerialLine('STATUS')
      showToast('B START 확인 불명 · 재START 잠금 · 실제 RX 상태를 확인하세요.')
    }, 1800)
    showToast(\`B LIVE START 전송 · MASTER LIVE_STARTED 확인 대기 · ${'${fmtTime(goOffsetMs / 1000)}'}\`)`
      armBlock = replaceRequired(armBlock, bSuccessToastNeedle, bWait, 'B acknowledgement wait')
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
      out = replaceRequired(out, oldAOutcome, newAOutcome, 'A unknown-state timeout')
      out = replaceRequired(out, `    setCurrentTime(clamp(confirmedTime, 0, duration))\n    setStageMode('A_LIVE')`, `    liveUncertainRef.current = false\n    setLiveUncertain(false)\n    setCurrentTime(clamp(confirmedTime, 0, duration))\n    setStageMode('A_LIVE')`, 'A success clears unknown')

      out = replaceRequired(
        out,
        `      const rows = line.slice(6).split(',').map((v) => { const [id, state, us, age, retry] = v.split(':'); return { id: Number(id), state, us: Number(us) || 0, age: Number(age), retry: Number(retry) || 0 } })`,
        `      const rows = line.slice(6).split(',').map((v) => { const [id, state, us, age, retry, playingRaw, activeSeqRaw] = v.split(':'); return { id: Number(id), state, us: Number(us) || 0, age: Number(age), retry: Number(retry) || 0, playing: Number(playingRaw) === 1, activeSeq: Number(activeSeqRaw) || 0 } })`,
        'RXMON live parser'
      )

      const oldLabel = `{s==='O'?(stageLive?'LIVE / ONLINE':'ONLINE'):s==='V'?'QUARANTINE V':s==='?'?(stageLive?'JOIN WAIT ?':'ACK ?'):s==='W'?'WAIT':(stageLive?'HOLD / JOIN WAIT':'OFFLINE')}`
      const newLabel = `{s==='O'?(rx.playing?'LIVE / LOCAL':stageLive?'JOIN WAIT / ONLINE':'ONLINE'):s==='V'?'QUARANTINE V':s==='?'?(rx.playing?'HOLD / LOCAL':stageLive?'JOIN WAIT ?':'ACK ?'):s==='W'?'WAIT':(rx.playing?'HOLD / LOCAL':stageLive?'JOIN WAIT':'OFFLINE')}`
      out = replaceRequired(out, oldLabel, newLabel, 'RX live status label')

      out = replaceRequired(out, '  const syncFromEditor = async (providedSession = cloudSession) => {', `  const syncFromEditor = async (providedSession = cloudSession) => {\n    if (stageLive || liveUncertainRef.current) { showToast('LIVE 안전 잠금 · 공연 중 EDITOR 동기화를 막았습니다.'); return }`, 'sync lock')
      out = replaceRequired(out, `  const stepFrame = (direction) => {\n    pause()`, `  const stepFrame = (direction) => {\n    if (stageLive || liveUncertainRef.current) { showToast('LIVE 안전 잠금 · 프레임 이동을 막았습니다.'); return }\n    pause()`, 'frame lock')
      out = replaceRequired(out, `  const startScrub = (event) => {\n    if (event.button !== 0) return`, `  const startScrub = (event) => {\n    if (stageLive || liveUncertainRef.current) { showToast('LIVE 안전 잠금 · 타임라인 이동을 막았습니다.'); return }\n    if (event.button !== 0) return`, 'scrub lock')

      out = out.replaceAll('disabled={syncBusy || !online}', 'disabled={syncBusy || !online || stageLive || liveUncertain}')
      out = out.replace(`<button className={\`tbtn play ${'${playing ? \'playing\' : \'\'}'}\`} onClick={() => playing ? pause() : play()}>`, `<button className={\`tbtn play ${'${playing ? \'playing\' : \'\'}'}\`} disabled={stageLive || liveUncertain} onClick={() => playing ? pause() : play()}>`)
      out = out.replace('<button className="transportPlay" onClick={() => playing ? pause() : play()}>', '<button className="transportPlay" disabled={stageLive || liveUncertain} onClick={() => playing ? pause() : play()}>')

      const badge = '<span className="readOnlyBadge">A안 → B안 READ ONLY</span>'
      if (out.includes(badge)) out = out.replace(badge, `${badge}\n          <span className="readOnlyBadge" style={{ color: firmwareSafetyReady ? '#62e7a2' : masterConnected ? '#ffb85c' : '#8d98a8' }}>{firmwareSafetyReady ? \`FW MATCH · ${'${bundleHashHex}'}\` : masterConnected ? 'FW/BUNDLE VERIFY' : 'FW —'}</span>\n          {liveUncertain && <span className="readOnlyBadge" style={{ color: '#ff657a' }}>⚠ LIVE STATE UNKNOWN · RESTART LOCK</span>}`)

      required(out.includes('WEB v0.6.4'), 'web version marker missing')
      out = out.replace('WEB v0.6.4', 'WEB v0.6.5')
      return { code: out, map: null }
    },
  }
}
