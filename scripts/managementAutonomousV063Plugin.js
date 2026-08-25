const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`autonomous web v0.6.3: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementAutonomousV063Plugin() {
  return {
    name: 'management-autonomous-v063',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      const lineAnchor = `    const line = String(rawLine || '').trim()
    if (!line) return`
      out = replaceRequired(
        out,
        lineAnchor,
        `${lineAnchor}
    // Bind v0.6.3 capability to the actual currently open Web Serial port. A stale
    // browser session can never reuse a capability flag from a previously connected MASTER.
    if (line.includes('LSM_READY LSM-B1 AB_DUAL V063')) {
      window.__LSM_MASTER_V063_PORT__ = serialPortRef.current
    }`,
        'MASTER v0.6.3 handshake marker'
      )

      const oldReadyGuard = `    if (!masterProtocolReady) { showToast('MASTER v0.6.2 펌웨어 연결 후 사용할 수 있어요.'); return }`
      const newReadyGuard = `    if (!masterProtocolReady) { showToast('MASTER v0.6.3 펌웨어 연결 후 사용할 수 있어요.'); return }
    if (window.__LSM_MASTER_V063_PORT__ !== serialPortRef.current) {
      showToast('안전 잠금 · MASTER v0.6.3 펌웨어를 업로드한 뒤 다시 연결해 주세요.')
      return
    }`
      out = replaceRequired(out, oldReadyGuard, newReadyGuard, 'A v0.6.3 MASTER guard')

      out = replaceRequired(
        out,
        `    if (showEndMs && initialOffsetMs >= showEndMs - 5) { showToast('타임라인 끝에서는 A 독립 START를 할 수 없어요.'); return }`,
        `    if (showEndMs && initialOffsetMs >= showEndMs - 250) { showToast('타임라인 종료 250ms 이내에서는 안전상 A CLOCK LOCK을 막습니다.'); return }`,
        'A end safety margin'
      )

      const oldPausedStart = `    if (!wasPlaying) {
      playLocalAt(initialOffsetMs / 1000, false)
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

      const newPausedStart = `    if (!wasPlaying) {
      playLocalAt(initialOffsetMs / 1000, false)
      const startingEl = getMediaEl()
      if (startingEl) {
        // Do not trust only the browser 'playing' event. It can fire before the media
        // clock is genuinely advancing. Require measurable currentTime progression so
        // A CLOCK LOCK samples a live clock instead of a decoder-start transient.
        const startSample = Number.isFinite(startingEl.currentTime) ? startingEl.currentTime : initialTime
        await new Promise((resolve) => {
          const deadline = performance.now() + 1200
          const check = () => {
            const nowSample = Number.isFinite(startingEl.currentTime) ? startingEl.currentTime : startSample
            if ((!startingEl.paused && startingEl.readyState >= 2 && nowSample - startSample >= 0.02) || performance.now() >= deadline) {
              resolve()
              return
            }
            requestAnimationFrame(check)
          }
          requestAnimationFrame(check)
        })
        await new Promise((resolve) => requestAnimationFrame(resolve))
      } else {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
    }`
      out = replaceRequired(out, oldPausedStart, newPausedStart, 'A media clock stabilization')

      const oldSend = `    const sent = await sendSerialLine(\`A_LIVE_START_NOW \${goOffsetMs}\`)`
      const newSend = `    if (showEndMs && goOffsetMs >= showEndMs - 250) {
      if (!wasPlaying) pause(false)
      showToast('타임라인 종료 250ms 이내에서는 안전상 A CLOCK LOCK을 막습니다.')
      return
    }
    const sent = await sendSerialLine(\`A_LIVE_SCHEDULE \${goOffsetMs}\`)`
      out = replaceRequired(out, oldSend, newSend, 'A scheduled serial command')

      out = replaceRequired(
        out,
        `    showToast(\`A 독립 LIVE · \${fmtTime(goOffsetMs / 1000)} · START LEAD 0ms\`)`,
        `    showToast(\`A 독립 CLOCK LOCK · \${fmtTime(goOffsetMs / 1000)} · 안정화 예약 100ms\`)`,
        'A stable clock toast'
      )

      out = replaceRequired(
        out,
        `stageMode === 'B_LIVE' ? \`A 독립 재앵커 @ \${fmtTime(currentTime)}\` : stageMode === 'A_LIVE' ? 'A 독립 진행 중 · 0ms' : \`A 독립 START @ \${fmtTime(currentTime)}\``,
        `stageMode === 'B_LIVE' ? \`A CLOCK LOCK @ \${fmtTime(currentTime)}\` : stageMode === 'A_LIVE' ? 'A 독립 진행 중 · CLOCK LOCK' : \`A 독립 CLOCK START @ \${fmtTime(currentTime)}\``,
        'A button label'
      )

      if (!out.includes('WEB v0.6.2')) throw new Error('autonomous web v0.6.3: version marker v0.6.2 not found')
      out = out.replace('WEB v0.6.2', 'WEB v0.6.3')

      return { code: out, map: null }
    },
  }
}
