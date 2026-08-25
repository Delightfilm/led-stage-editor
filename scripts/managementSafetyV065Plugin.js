const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`safety v0.6.5 plugin: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementSafetyV065Plugin() {
  return {
    name: 'management-safety-v065',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('src/managementProjectFirmware.js')) {
        let out = code

        const v064Import = 'import { applyResilientJoinMasterV064, applyResilientJoinReceiverV064 } from "./managementResilientJoinV064.js";'
        const v065Import = 'import { applySafetyMasterV065, applySafetyReceiverV065 } from "./managementSafetyV065.js";'
        if (!out.includes(v064Import)) throw new Error('v0.6.5: v0.6.4 firmware import missing')
        if (!out.includes(v065Import)) out = out.replace(v064Import, `${v064Import}\n${v065Import}`)

        const bundleHelperAnchor = 'export function buildManagementFirmwareBundle'
        const bundleHelper = `const hashBundleV065 = (receiverHashes, showDurationMs, receiverCount) => {
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
        if (!out.includes('const hashBundleV065 =')) {
          if (!out.includes(bundleHelperAnchor)) throw new Error('v0.6.5: bundle helper anchor missing')
          out = out.replace(bundleHelperAnchor, bundleHelper + bundleHelperAnchor)
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
    const invalidPins = relayPins.filter((pin) => !Number.isInteger(pin) || pin < 2 || pin > 8);
    if (invalidPins.length) throw new Error(\`RX\${index + 1} relay pin must be UNO D2-D8. D0/D1 are Serial and D9-D13 are nRF24 reserved.\`);
    if (new Set(relayPins).size !== relayPins.length) throw new Error(\`RX\${index + 1} has duplicate relay pins. Each EL part needs a unique D2-D8 pin.\`);`,
          'receiver relay pin validation'
        )

        out = replaceRequired(
          out,
          '      on = Math.floor(local * Math.max(0.01, Number(block.speed) || 5) * 2) % 2 === 0;',
          '      on = Math.floor(local * Math.min(RELAY_SAFE_HZ, Math.max(0.01, Number(block.speed) || 5)) * 2) % 2 === 0;',
          'relay-safe strobe clamp'
        )

        const receiverCountAnchor = '  const receiverCount = Math.max(1, receivers.length || 1);'
        if (!out.includes('const bundleHash = hashBundleV065')) {
          out = replaceRequired(
            out,
            receiverCountAnchor,
            `${receiverCountAnchor}\n  const bundleHash = hashBundleV065(receiverHashes, showDurationMs, receiverCount);`,
            'bundle hash creation'
          )
        }

        const masterCall = '  masterCode = applyResilientJoinMasterV064(masterCode);'
        out = replaceRequired(
          out,
          masterCall,
          `${masterCall}\n  masterCode = applySafetyMasterV065(masterCode, bundleHash);`,
          'master v0.6.5 safety call'
        )

        const rxCall = '    code: applyResilientJoinReceiverV064(applyV063FailClosedReceiver(applyStableAClockReceiverV063(hardenStageReceiverFirmware(buildNrf24ManagementReceiverSketch({ ...rx, showHash: receiverHashes[index] || 0 }))))), '
        out = replaceRequired(
          out,
          rxCall,
          '    code: applySafetyReceiverV065(applyResilientJoinReceiverV064(applyV063FailClosedReceiver(applyStableAClockReceiverV063(hardenStageReceiverFirmware(buildNrf24ManagementReceiverSketch({ ...rx, showHash: receiverHashes[index] || 0 }))))))), ',
          'receiver v0.6.5 safety call'
        )

        const hashAnchor = '  feed("mgmt-resilient-join-v064");'
        out = replaceRequired(out, hashAnchor, `${hashAnchor}\n  feed("mgmt-safety-v065");`, 'v0.6.5 receiver hash marker')

        out = replaceRequired(
          out,
          '    receiverHashes,\n    showDurationMs,',
          `    receiverHashes,
    bundleHash,
    bundleHashHex: bundleHash.toString(16).padStart(8, '0').toUpperCase(),
    showDurationMs,`,
          'bundle hash return value'
        )

        return { code: out, map: null }
      }

      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      out = replaceRequired(
        out,
        "  const [stageMode, setStageMode] = useState('A')",
        "  const [stageMode, setStageMode] = useState('A')\n  const [liveUncertain, setLiveUncertain] = useState(false)",
        'web uncertain live state'
      )

      out = replaceRequired(
        out,
        '  const bStartSentRef = useRef(false)',
        '  const bStartSentRef = useRef(false)\n  const liveUncertainRef = useRef(false)',
        'web uncertain live ref'
      )

      const stageLiveAnchor = "  const stageLive = stageMode === 'A_LIVE' || stageMode === 'B_LIVE'"
      out = replaceRequired(
        out,
        stageLiveAnchor,
        `${stageLiveAnchor}
  const bundleHashHex = String(firmwareBundle.bundleHashHex || '').toUpperCase()
  const masterBundleMatches = !!bundleHashHex && window.__LSM_MASTER_V065_PORT__ === serialPortRef.current && window.__LSM_MASTER_V065_BUNDLE__ === bundleHashHex
  const firmwareSafetyReady = masterProtocolReady && masterBundleMatches
  const anyRxLocalLive = rxMon.some((rx) => !!rx.playing)`,
        'web firmware safety derived state'
      )

      const oldHandshake = `    if (line.includes('LSM_READY LSM-B1 AB_DUAL V064')) {
      window.__LSM_MASTER_V064_PORT__ = serialPortRef.current
    }`
      const newHandshake = `    const v065Ready = line.match(/^LSM_READY LSM-B1 AB_DUAL V065 BUNDLE ([0-9A-Fa-f]{8})$/)
    if (v065Ready) {
      window.__LSM_MASTER_V065_PORT__ = serialPortRef.current
      window.__LSM_MASTER_V065_BUNDLE__ = String(v065Ready[1] || '').toUpperCase()
    }
    if (line.startsWith('LIVE_STARTED ')) {
      window.dispatchEvent(new CustomEvent('lsm-b-v065-started', { detail: { line } }))
    }
    if (line === 'BUSY LIVE' || line.startsWith('ERR ')) {
      window.dispatchEvent(new CustomEvent('lsm-b-v065-denied', { detail: { line } }))
    }
    if (line.startsWith('A_LIVE_STARTED ')) {
      liveUncertainRef.current = false
      setLiveUncertain(false)
    }`
      out = replaceRequired(out, oldHandshake, newHandshake, 'web v0.6.5 handshake and result events')

      out = replaceRequired(
        out,
        `    const payload = new TextEncoder().encode(\`${'${line}'}\\n\`)
    serialWriteQueueRef.current = serialWriteQueueRef.current
      .then(() => writer.write(payload))
      .catch((error) => {
        setMasterStatus('USB 쓰기 오류')
        addMasterLog(\`! ${'${error?.message || \'write error\'}'}\`)
      })
    await serialWriteQueueRef.current
    return true`,
        `    const payload = new TextEncoder().encode(\`${'${line}'}\\n\`)
    let writeOk = true
    serialWriteQueueRef.current = serialWriteQueueRef.current
      .then(() => writer.write(payload))
      .catch((error) => {
        writeOk = false
        setMasterStatus('USB 쓰기 오류')
        addMasterLog(\`! ${'${error?.message || \'write error\'}'}\`)
      })
    await serialWriteQueueRef.current
    return writeOk`,
        'serial write truthful result'
      )

      out = replaceRequired(
        out,
        `    if (!masterProtocolReady) { showToast('MASTER v0.6.4 펌웨어 연결 후 사용할 수 있어요.'); return }
    if (window.__LSM_MASTER_V064_PORT__ !== serialPortRef.current) {
      showToast('안전 잠금 · MASTER v0.6.4 펌웨어를 업로드한 뒤 다시 연결해 주세요.')
      return
    }`,
        `    if (!firmwareSafetyReady) {
      showToast(masterProtocolReady ? '안전 잠금 · 사이트 타임라인과 MASTER 펌웨어 BUNDLE이 다릅니다. v0.6.5 펌웨어를 다시 업로드해 주세요.' : 'MASTER v0.6.5 펌웨어 연결 후 사용할 수 있어요.')
      return
    }
    if (!stageLive && anyRxLocalLive) {
      showToast('안전 잠금 · RX에서 기존 LOCAL LIVE가 감지됩니다. 새 START를 보내지 않습니다.')
      return
    }`,
        'A bundle and orphan-live guard'
      )

      const armStart = out.indexOf('  const armModeB = async () => {')
      const armEnd = out.indexOf('\n\n  const ', armStart + 10)
      if (armStart < 0 || armEnd < 0) throw new Error('v0.6.5: B LIVE helper bounds missing')
      const robustB = `  const armModeB = async () => {
    if (!firmwareSafetyReady) {
      showToast(masterProtocolReady ? '안전 잠금 · 사이트와 MASTER BUNDLE이 다릅니다. v0.6.5 펌웨어를 다시 업로드해 주세요.' : 'MASTER v0.6.5 펌웨어 연결 후 사용할 수 있어요.')
      return
    }
    if (anyRxLocalLive && !stageLive) { showToast('안전 잠금 · RX LOCAL LIVE 감지 · 중복 START 차단'); return }
    if (stageLive || liveUncertainRef.current || bStartSentRef.current) { showToast('LIVE가 진행 중이거나 START 확인 중입니다.'); return }
    const mediaEl = getMediaEl()
    const liveTime = mediaEl && Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : currentTime
    const initialOffsetMs = Math.max(0, Math.round(liveTime * 1000))
    const showEndMs = Math.max(0, Number(firmwareBundle.showDurationMs) || 0)
    if (showEndMs && initialOffsetMs >= showEndMs - 5) { showToast('타임라인 끝에서는 LIVE START를 할 수 없어요.'); return }
    if (!rehearsalMode && (!firmwareBundle.previewSafeLimitMs || initialOffsetMs >= firmwareBundle.previewSafeLimitMs)) {
      showToast('공연 모드 B LIVE START는 첫 실제 EL ON 이전 구간에서만 가능합니다. 연습 중간 시작은 연습실 모드를 켜주세요.')
      return
    }

    const wasPlaying = mediaEl ? !mediaEl.paused : playing
    bStartSentRef.current = true
    spaceResumeRef.current = false
    bLivePrimedRef.current = true

    if (!wasPlaying) {
      playLocalAt(initialOffsetMs / 1000, false)
      const startingEl = getMediaEl()
      if (startingEl) {
        const startSample = Number.isFinite(startingEl.currentTime) ? startingEl.currentTime : liveTime
        await new Promise((resolve) => {
          const deadline = performance.now() + 1200
          const check = () => {
            const sample = Number.isFinite(startingEl.currentTime) ? startingEl.currentTime : startSample
            if ((!startingEl.paused && startingEl.readyState >= 2 && sample - startSample >= 0.02) || performance.now() >= deadline) return resolve()
            requestAnimationFrame(check)
          }
          requestAnimationFrame(check)
        })
      } else await new Promise((resolve) => requestAnimationFrame(resolve))
    }

    const goMediaEl = getMediaEl()
    const goTime = goMediaEl && Number.isFinite(goMediaEl.currentTime) ? goMediaEl.currentTime : liveTime
    const goOffsetMs = Math.max(0, Math.round(goTime * 1000))
    bArmedOffsetRef.current = goOffsetMs
    setCurrentTime(clamp(goTime, 0, duration))
    const userLeadMs = delayEnabled ? Math.max(0, Math.round(Number(delayMs) || 0)) : 0

    const outcomePromise = new Promise((resolve) => {
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        window.removeEventListener('lsm-b-v065-started', onStarted)
        window.removeEventListener('lsm-b-v065-denied', onDenied)
        window.clearTimeout(timer)
        resolve(value)
      }
      const onStarted = (event) => finish({ ok: true, line: event?.detail?.line || '' })
      const onDenied = (event) => finish({ ok: false, line: event?.detail?.line || 'B_START_DENIED' })
      window.addEventListener('lsm-b-v065-started', onStarted)
      window.addEventListener('lsm-b-v065-denied', onDenied)
      const timer = window.setTimeout(() => finish({ ok: false, line: 'B_START_TIMEOUT' }), 1800)
    })

    const delaySent = await sendSerialLine(\`SET_DELAY ${'${userLeadMs}'}\`)
    const startSent = delaySent && await sendSerialLine(\`${'${userLeadMs > 0 ? \'LIVE_START\' : \'LIVE_START_NOW\'}'} ${'${goOffsetMs}'}\`)
    if (!startSent) {
      bStartSentRef.current = false
      bLivePrimedRef.current = false
      if (!wasPlaying) pause(false)
      showToast('B LIVE START USB 전송 실패 · MASTER 연결을 확인해 주세요.')
      return
    }

    const outcome = await outcomePromise
    bStartSentRef.current = false
    if (!outcome.ok && outcome.line.includes('TIMEOUT')) {
      liveUncertainRef.current = true
      setLiveUncertain(true)
      setStageMode('B_LIVE')
      sendSerialLine('STATUS')
      showToast('B START 확인 불명 · 재START 잠금 · 실제 RX 상태를 확인하세요.')
      return
    }
    if (!outcome.ok) {
      bLivePrimedRef.current = false
      if (!wasPlaying) pause(false)
      setStageMode('A')
      showToast(\`B LIVE START 거부 · ${'${outcome.line}'}\`)
      return
    }

    liveUncertainRef.current = false
    setLiveUncertain(false)
    setStageMode('B_LIVE')
    showToast(\`${'${rehearsalMode ? \'연습실\' : \'B\'}'} LIVE GO 확인 · ${'${fmtTime(goOffsetMs / 1000)}'}${'${userLeadMs > 0 ? ` · START LEAD ${userLeadMs}ms` : \'\'}'}\`)
  }`
      out = out.slice(0, armStart) + robustB + out.slice(armEnd)

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
        bStartSentRef.current = false
        bLivePrimedRef.current = true
        spaceResumeRef.current = false
        setStageMode('A_LIVE')
        sendSerialLine('STATUS')
        showToast('A START 확인 불명 · 재START 잠금 · 실제 RX 상태를 확인하세요.')
        return
      }
      if (!wasPlaying) pause(false)
      showToast(\`A CLOCK LOCK 취소 · ${'${outcome.line}'}\`)
      return
    }`
      out = replaceRequired(out, oldAOutcome, newAOutcome, 'A timeout unknown-state safety')

      out = replaceRequired(
        out,
        `    setCurrentTime(clamp(confirmedTime, 0, duration))
    setStageMode('A_LIVE')`,
        `    liveUncertainRef.current = false
    setLiveUncertain(false)
    setCurrentTime(clamp(confirmedTime, 0, duration))
    setStageMode('A_LIVE')`,
        'A success clears uncertainty'
      )

      out = replaceRequired(
        out,
        `      const rows = line.slice(6).split(',').map((v) => { const [id, state, us, age, retry] = v.split(':'); return { id: Number(id), state, us: Number(us) || 0, age: Number(age), retry: Number(retry) || 0 } })`,
        `      const rows = line.slice(6).split(',').map((v) => { const [id, state, us, age, retry, playingRaw, activeSeqRaw] = v.split(':'); return { id: Number(id), state, us: Number(us) || 0, age: Number(age), retry: Number(retry) || 0, playing: Number(playingRaw) === 1, activeSeq: Number(activeSeqRaw) || 0 } })`,
        'RXMON extended live parser'
      )

      const oldRxLabel = `{s==='O'?(stageLive?'LIVE / ONLINE':'ONLINE'):s==='V'?'QUARANTINE V':s==='?'?(stageLive?'JOIN WAIT ?':'ACK ?'):s==='W'?'WAIT':(stageLive?'HOLD / JOIN WAIT':'OFFLINE')}`
      const newRxLabel = `{s==='O'?(rx.playing?'LIVE / LOCAL':stageLive?'JOIN WAIT / ONLINE':'ONLINE'):s==='V'?'QUARANTINE V':s==='?'?(rx.playing?'HOLD / LOCAL':stageLive?'JOIN WAIT ?':'ACK ?'):s==='W'?'WAIT':(rx.playing?'HOLD / LOCAL':stageLive?'JOIN WAIT':'OFFLINE')}`
      out = replaceRequired(out, oldRxLabel, newRxLabel, 'RX actual live label')

      out = replaceRequired(
        out,
        '  const syncFromEditor = async (providedSession = cloudSession) => {',
        `  const syncFromEditor = async (providedSession = cloudSession) => {
    if (stageLive || liveUncertainRef.current) { showToast('LIVE 안전 잠금 · 공연 중에는 EDITOR 동기화를 할 수 없어요.'); return }`,
        'live editor sync lock'
      )

      out = replaceRequired(
        out,
        `  const stepFrame = (direction) => {
    pause()`,
        `  const stepFrame = (direction) => {
    if (stageLive || liveUncertainRef.current) { showToast('LIVE 안전 잠금 · 프레임 이동을 막았습니다.'); return }
    pause()`,
        'live frame-step lock'
      )

      out = replaceRequired(
        out,
        `  const startScrub = (event) => {
    if (event.button !== 0) return`,
        `  const startScrub = (event) => {
    if (stageLive || liveUncertainRef.current) { showToast('LIVE 안전 잠금 · 타임라인 이동을 막았습니다.'); return }
    if (event.button !== 0) return`,
        'live scrub lock'
      )

      out = out.replaceAll(
        'disabled={syncBusy || !online}',
        'disabled={syncBusy || !online || stageLive || liveUncertain}'
      )
      out = out.replaceAll(
        'disabled={typeof stageLive !== \'undefined\' && stageLive}',
        'disabled={(typeof stageLive !== \'undefined\' && stageLive) || liveUncertain}'
      )

      out = out.replace(
        `<button className={\`tbtn play ${'${playing ? \'playing\' : \'\'}'}\`} onClick={() => playing ? pause() : play()}>`,
        `<button className={\`tbtn play ${'${playing ? \'playing\' : \'\'}'}\`} disabled={stageLive || liveUncertain} onClick={() => playing ? pause() : play()}>`
      )
      out = out.replace(
        '<button className="transportPlay" onClick={() => playing ? pause() : play()}>',
        '<button className="transportPlay" disabled={stageLive || liveUncertain} onClick={() => playing ? pause() : play()}>'
      )
      out = out.replace(
        '<button onClick={() => stepFrame(-1)} title="이전 프레임">',
        '<button disabled={stageLive || liveUncertain} onClick={() => stepFrame(-1)} title="이전 프레임">'
      )
      out = out.replace(
        '<button onClick={() => stepFrame(1)} title="다음 프레임">',
        '<button disabled={stageLive || liveUncertain} onClick={() => stepFrame(1)} title="다음 프레임">'
      )

      const badgeAnchor = '<span className="readOnlyBadge">A안 → B안 READ ONLY</span>'
      if (out.includes(badgeAnchor)) {
        out = out.replace(
          badgeAnchor,
          `${badgeAnchor}\n          <span className="readOnlyBadge" style={{ color: firmwareSafetyReady ? '#62e7a2' : masterConnected ? '#ffb85c' : '#8d98a8' }}>{firmwareSafetyReady ? \`FW MATCH · ${'${bundleHashHex}'}\` : masterConnected ? 'FW/BUNDLE VERIFY' : 'FW —'}</span>\n          {liveUncertain && <span className="readOnlyBadge" style={{ color: '#ff657a', borderColor: '#7b3542' }}>⚠ LIVE STATE UNKNOWN · RESTART LOCK</span>}`
        )
      }

      if (!out.includes('WEB v0.6.4')) throw new Error('v0.6.5: WEB v0.6.4 marker missing')
      out = out.replace('WEB v0.6.4', 'WEB v0.6.5')

      return { code: out, map: null }
    },
  }
}
