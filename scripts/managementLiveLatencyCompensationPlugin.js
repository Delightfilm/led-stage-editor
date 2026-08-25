const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`live latency compensation: ${label} anchor not found`)
  return source.replace(from, to)
}

const B_LIVE_EARLY_CORRECTION_MS = 300

export function managementLiveLatencyCompensationPlugin() {
  return {
    name: 'management-live-latency-compensation',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      // B LIVE has a measured ~300 ms early visual start relative to the program audio.
      // Keep this correction separate from the general DELAY / START LEAD control so
      // Preview and standalone A timing are not disturbed by a B-only calibration.
      const refAnchor = '  const liveCompleteSentRef = useRef(false)'
      if (!out.includes('const bLiveDelayRef = useRef(0)')) {
        out = replaceRequired(
          out,
          refAnchor,
          `${refAnchor}\n  const bLiveDelayRef = useRef(0)`,
          'live delay ref'
        )
      }

      // LIVE_START_NOW at (offset - correction) means the RX timeline is intentionally
      // 300 ms behind the browser clock at GO. Therefore a cue located at the browser's
      // current position is reached 300 ms later, correcting the observed early LED start.
      //
      // Near timeline zero a negative offset is impossible, so use MASTER's existing
      // scheduled LIVE_START path for the remaining lead instead.
      const oldSend = '    const sent = await sendSerialLine(`LIVE_START_NOW ${offsetMs}`)'
      const newSend = [
        `    const compensationMs = ${B_LIVE_EARLY_CORRECTION_MS}`,
        "    bLiveDelayRef.current = compensationMs",
        "    let sent = false",
        "    if (compensationMs > offsetMs) {",
        "      await sendSerialLine(`SET_DELAY ${compensationMs}`)",
        "      sent = await sendSerialLine(`LIVE_START ${offsetMs}`)",
        "    } else {",
        "      const compensatedOffsetMs = Math.max(0, offsetMs - compensationMs)",
        "      sent = await sendSerialLine(`LIVE_START_NOW ${compensatedOffsetMs}`)",
        "    }",
      ].join('\n')
      out = replaceRequired(out, oldSend, newSend, 'B LIVE compensated start')

      // The immediate currentTime-based completion watchdog is only valid with zero
      // correction. With B correction active MASTER intentionally reaches SHOW_DURATION_MS
      // later than the browser media element.
      const watchdogAnchor = '    if (!showEndMs || Math.round(currentTime * 1000) + 20 < showEndMs) return'
      out = replaceRequired(
        out,
        watchdogAnchor,
        "    if (bLiveDelayRef.current > 0) return\n" + watchdogAnchor,
        'early completion watchdog'
      )

      // Keep the timer-based USB backup after the corrected MASTER end point.
      const remainingAnchor = '    const remainingMs = Math.max(0, showEndMs - positionMs)'
      out = replaceRequired(
        out,
        remainingAnchor,
        '    const remainingMs = Math.max(0, showEndMs - positionMs + Math.max(0, Number(bLiveDelayRef.current) || 0))',
        'completion timer compensation'
      )

      // Clear the frozen B correction only after LIVE really leaves the live state.
      // A B_LIVE -> A_LIVE autonomous handoff keeps stageLive=true, so correction survives.
      const inactiveAnchor = [
        "    if (!stageLive) {",
        "      liveCompleteSentRef.current = false",
        "      return",
        "    }",
      ].join('\n')
      const inactiveReplacement = [
        "    if (!stageLive) {",
        "      liveCompleteSentRef.current = false",
        "      bLiveDelayRef.current = 0",
        "      return",
        "    }",
      ].join('\n')
      out = replaceRequired(out, inactiveAnchor, inactiveReplacement, 'live delay reset')

      const toastAnchor = "    showToast(`${rehearsalMode ? '연습실' : 'B'} LIVE 즉시 GO · ${fmtTime(offsetMs / 1000)}`)"
      out = replaceRequired(
        out,
        toastAnchor,
        "    showToast(`${rehearsalMode ? '연습실' : 'B'} LIVE GO · ${fmtTime(offsetMs / 1000)} · 300ms 후행 보정`)",
        'compensation toast'
      )

      // Make the active production calibration unmistakable before the user presses GO.
      // This also gives us a visible build marker to rule out a stale browser tab/cache.
      const liveButtonAnchor = '          <button className="tbtn compact" disabled={!masterProtocolReady || (!rehearsalMode && !previewSafe) || stageLive} onClick={armModeB}>B LIVE START @ {fmtTime(currentTime)}</button>'
      out = replaceRequired(
        out,
        liveButtonAnchor,
        '          <button className="tbtn compact" disabled={!masterProtocolReady || (!rehearsalMode && !previewSafe) || stageLive} onClick={armModeB}>B LIVE START · +300ms 후행 @ {fmtTime(currentTime)}</button>',
        'visible B LIVE correction marker'
      )

      out = replaceRequired(
        out,
        '<div className="logoSub">B · LIVE IN CALIBRATION</div>',
        '<div className="logoSub">B · LIVE SYNC FIX · +300ms LATE</div>',
        'production sync marker'
      )

      return { code: out, map: null }
    },
  }
}
