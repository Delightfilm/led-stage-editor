const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`v0.6.5 final guard: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementSafetyV065FinalGuardPlugin() {
  return {
    name: 'management-safety-v065-final-guard',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      // Duration/BUNDLE consistency is owned and verified by
      // managementFirmwareDurationBridgePlugin. Do not duplicate that transform here.

      // This runs after the optimized frame-scrub transform and before React JSX
      // compilation. Inject the guard directly after the function header.
      const scrubHeader = '  const startScrub = (event) => {'
      const scrubGuard = "    if (stageLive || liveUncertainRef.current) { showToast('LIVE 안전 잠금 · 타임라인 이동을 막았습니다.'); return }"
      const scrubIndex = out.indexOf(scrubHeader)
      if (scrubIndex < 0) throw new Error('v0.6.5 final guard: startScrub function not found')
      const scrubWindow = out.slice(scrubIndex, Math.min(out.length, scrubIndex + 500))
      if (!scrubWindow.includes(scrubGuard)) {
        out = out.slice(0, scrubIndex + scrubHeader.length) + '\n' + scrubGuard + out.slice(scrubIndex + scrubHeader.length)
      }

      // SET_DELAY and LIVE_START are one safety transaction. Never start with an old
      // lead value if the SET_DELAY write itself failed.
      out = replaceRequired(
        out,
        `    let sent = false
    if (userLeadMs > 0) {
      await sendSerialLine(\`SET_DELAY \${userLeadMs}\`)
      sent = await sendSerialLine(\`LIVE_START \${goOffsetMs}\`)
    } else {
      await sendSerialLine('SET_DELAY 0')
      sent = await sendSerialLine(\`LIVE_START_NOW \${goOffsetMs}\`)
    }`,
        `    let sent = false
    if (userLeadMs > 0) {
      const delaySent = await sendSerialLine(\`SET_DELAY \${userLeadMs}\`)
      if (delaySent) sent = await sendSerialLine(\`LIVE_START \${goOffsetMs}\`)
    } else {
      const delaySent = await sendSerialLine('SET_DELAY 0')
      if (delaySent) sent = await sendSerialLine(\`LIVE_START_NOW \${goOffsetMs}\`)
    }`,
        'B delay/start atomic write guard'
      )

      // When B starts from a paused media element, require the media clock itself to
      // advance before capturing the LIVE offset. Browser 'playing' alone is too early.
      const oldPausedB = `    if (!wasPlaying) {
      playLocalAt(offsetMs / 1000, false)
      const startingEl = getMediaEl()
      if (startingEl) {
        await new Promise((resolve) => {
          let done = false
          const finish = () => {
            if (done) return
            done = true
            startingEl.removeEventListener('playing', finish)
            startingEl.removeEventListener('timeupdate', finish)
            resolve()
          }
          startingEl.addEventListener('playing', finish, { once: true })
          startingEl.addEventListener('timeupdate', finish, { once: true })
          if (!startingEl.paused && startingEl.readyState >= 2) requestAnimationFrame(finish)
          window.setTimeout(finish, 700)
        })
        await new Promise((resolve) => requestAnimationFrame(resolve))
      } else {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
    }`
      const newPausedB = `    if (!wasPlaying) {
      playLocalAt(offsetMs / 1000, false)
      const startingEl = getMediaEl()
      if (startingEl) {
        const startSample = Number.isFinite(startingEl.currentTime) ? startingEl.currentTime : liveTime
        await new Promise((resolve) => {
          const deadline = performance.now() + 1200
          const check = () => {
            const nowSample = Number.isFinite(startingEl.currentTime) ? startingEl.currentTime : startSample
            if ((!startingEl.paused && startingEl.readyState >= 2 && nowSample - startSample >= 0.02) || performance.now() >= deadline) { resolve(); return }
            requestAnimationFrame(check)
          }
          requestAnimationFrame(check)
        })
        await new Promise((resolve) => requestAnimationFrame(resolve))
      } else {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
    }`
      out = replaceRequired(out, oldPausedB, newPausedB, 'B media clock stabilization')

      // Transport/navigation controls that can stop or seek the browser media are hard
      // locked during LIVE or an uncertain START state.
      out = replaceRequired(
        out,
        '<button onClick={() => seek(0, true, true)} title="처음으로">⏮</button>',
        '<button disabled={stageLive || liveUncertain} onClick={() => seek(0, true, true)} title="처음으로">⏮</button>',
        'go-to-start lock'
      )
      out = replaceRequired(
        out,
        '<button type="button" onClick={() => { window.location.href = \'/\' }} style={{ position: \'fixed\'',
        '<button type="button" disabled={stageLive || liveUncertain} onClick={() => { window.location.href = \'/\' }} style={{ position: \'fixed\'',
        'fixed editor navigation lock'
      )
      out = replaceRequired(
        out,
        '<button type="button" onClick={() => { window.location.href = \'/\' }}>EDITOR</button>',
        '<button type="button" disabled={stageLive || liveUncertain} onClick={() => { window.location.href = \'/\' }}>EDITOR</button>',
        'workspace editor navigation lock'
      )
      out = replaceRequired(
        out,
        '<button className={`tbtn compact ${masterConnected ? \'connectedBtn\' : \'\'}`} onClick={connectMaster}>',
        '<button className={`tbtn compact ${masterConnected ? \'connectedBtn\' : \'\'}`} disabled={stageLive || liveUncertain} onClick={connectMaster}>',
        'master disconnect lock'
      )
      out = replaceRequired(
        out,
        '<input type="checkbox" checked={rehearsalMode} onChange={(e) => setRehearsalMode(e.target.checked)} /> <span>연습실 모드</span>',
        '<input type="checkbox" checked={rehearsalMode} disabled={stageLive || liveUncertain} onChange={(e) => setRehearsalMode(e.target.checked)} /> <span>연습실 모드</span>',
        'rehearsal mode lock'
      )

      // Sequence switching must also remain locked when the hardware start result is
      // uncertain, not only when React already says LIVE.
      out = out.replaceAll(
        "disabled={typeof stageLive !== 'undefined' && stageLive}",
        "disabled={(typeof stageLive !== 'undefined' && stageLive) || liveUncertain}"
      )

      // Warn on refresh/close while the browser media is part of a running show.
      const keyEffectAnchor = `  useEffect(() => {
    const onKey = (event) => {`
      if (!out.includes('V065_BEFOREUNLOAD_GUARD')) {
        out = replaceRequired(
          out,
          keyEffectAnchor,
          `  // V065_BEFOREUNLOAD_GUARD
  useEffect(() => {
    if (!stageLive && !liveUncertain) return undefined
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; return '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [stageLive, liveUncertain])

${keyEffectAnchor}`,
          'beforeunload guard'
        )
      }

      return { code: out, map: null }
    },
  }
}
