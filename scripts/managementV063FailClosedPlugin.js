const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`v0.6.3 fail-closed: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementV063FailClosedPlugin() {
  return {
    name: 'management-v063-fail-closed',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('src/managementProjectFirmware.js')) {
        let out = code

        // This transform runs after managementStableClockV063Plugin. Wrap the generated
        // MASTER once more so A CLOCK LOCK performs a fresh ACK + hash preflight of every
        // receiver immediately before scheduling. Any X/?/V receiver makes the command
        // fail closed; the common epoch is never armed.
        const stableImport = 'import { applyStableAClockMasterV063, applyStableAClockReceiverV063 } from "./managementStableClockV063.js";'
        const guardImport = 'import { applyV063FailClosedMaster } from "./managementV063FailClosedFirmware.js";'
        if (!out.includes(stableImport)) throw new Error('v0.6.3 fail-closed: stable import anchor not found')
        if (!out.includes(guardImport)) out = out.replace(stableImport, `${stableImport}\n${guardImport}`)

        const stableMasterCall = '  masterCode = applyStableAClockMasterV063(masterCode);'
        if (!out.includes(stableMasterCall)) throw new Error('v0.6.3 fail-closed: stable master call anchor not found')
        out = out.replace(stableMasterCall, `${stableMasterCall}\n  masterCode = applyV063FailClosedMaster(masterCode);`)
        return { code: out, map: null }
      }

      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      // Convert MASTER responses into explicit browser events. A serial write success is
      // not treated as a LIVE success; only A_LIVE_STARTED from the current MASTER counts.
      const handshakeMarker = `    if (line.includes('LSM_READY LSM-B1 AB_DUAL V063')) {
      window.__LSM_MASTER_V063_PORT__ = serialPortRef.current
    }`
      const responseEvents = `${handshakeMarker}
    if (line.startsWith('A_LIVE_STARTED ')) {
      window.dispatchEvent(new CustomEvent('lsm-a-v063-started', { detail: { line } }))
    }
    if (line.startsWith('A_SCHEDULE_DENIED') || line.startsWith('A_SCHEDULE_BUSY') || line.startsWith('ERR A_CLOCK')) {
      window.dispatchEvent(new CustomEvent('lsm-a-v063-denied', { detail: { line } }))
    }`
      out = replaceRequired(out, handshakeMarker, responseEvents, 'web MASTER response events')

      const oldSend = `    const sent = await sendSerialLine(\`A_LIVE_SCHEDULE \${goOffsetMs}\`)
    if (!sent) {
      if (!wasPlaying) pause(false)
      showToast('A 독립 START 전송 실패 · MASTER 연결을 확인해 주세요.')
      return
    }

    bArmedOffsetRef.current = goOffsetMs
    bStartSentRef.current = false
    bLivePrimedRef.current = true
    spaceResumeRef.current = false
    setCurrentTime(clamp(goTime, 0, duration))
    setStageMode('A_LIVE')
    showToast(\`A 독립 CLOCK LOCK · \${fmtTime(goOffsetMs / 1000)} · 안정화 예약 100ms\`)`

      const newSend = `    // Install the outcome listeners BEFORE the USB write so even a very fast MASTER
    // response cannot race the browser. Fail closed on deny or timeout.
    const aClockOutcome = new Promise((resolve) => {
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        window.removeEventListener('lsm-a-v063-started', onStarted)
        window.removeEventListener('lsm-a-v063-denied', onDenied)
        window.clearTimeout(timer)
        resolve(value)
      }
      const onStarted = (event) => finish({ ok: true, line: event?.detail?.line || '' })
      const onDenied = (event) => finish({ ok: false, line: event?.detail?.line || 'A_SCHEDULE_DENIED' })
      window.addEventListener('lsm-a-v063-started', onStarted)
      window.addEventListener('lsm-a-v063-denied', onDenied)
      const timer = window.setTimeout(() => finish({ ok: false, line: 'A_CLOCK_TIMEOUT' }), 1800)
    })

    const sent = await sendSerialLine(\`A_LIVE_SCHEDULE \${goOffsetMs}\`)
    if (!sent) {
      window.dispatchEvent(new CustomEvent('lsm-a-v063-denied', { detail: { line: 'USB_WRITE_FAILED' } }))
      if (!wasPlaying) pause(false)
      showToast('A CLOCK LOCK 전송 실패 · MASTER 연결을 확인해 주세요.')
      return
    }

    showToast(\`A CLOCK LOCK 준비 · RX1~RX7 재검증 중 · \${fmtTime(goOffsetMs / 1000)}\`)
    const outcome = await aClockOutcome
    if (!outcome.ok) {
      if (!wasPlaying) pause(false)
      showToast(\`A CLOCK LOCK 취소 · \${outcome.line}\`)
      return
    }

    // Only the MASTER's actual scheduled-GO acknowledgement may transition the UI to
    // A_LIVE. This prevents a denied/missing RX preflight from looking successful.
    bArmedOffsetRef.current = goOffsetMs
    bStartSentRef.current = false
    bLivePrimedRef.current = true
    spaceResumeRef.current = false
    const confirmedMediaEl = getMediaEl()
    const confirmedTime = confirmedMediaEl && Number.isFinite(confirmedMediaEl.currentTime) ? confirmedMediaEl.currentTime : goTime
    setCurrentTime(clamp(confirmedTime, 0, duration))
    setStageMode('A_LIVE')
    showToast(\`A 독립 CLOCK LOCK 완료 · START LEAD 0ms · 공통 예약 100ms\`)`

      out = replaceRequired(out, oldSend, newSend, 'web A schedule confirmation')
      return { code: out, map: null }
    },
  }
}
