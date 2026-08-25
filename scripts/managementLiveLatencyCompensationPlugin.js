const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`live latency compensation: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementLiveLatencyCompensationPlugin() {
  return {
    name: 'management-live-latency-compensation',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      // Freeze the configured output-latency compensation for the lifetime of one LIVE.
      // B -> A autonomous handoff must keep the same value until the show naturally ends.
      const refAnchor = '  const liveCompleteSentRef = useRef(false)'
      if (!out.includes('const bLiveDelayRef = useRef(0)')) {
        out = replaceRequired(
          out,
          refAnchor,
          `${refAnchor}\n  const bLiveDelayRef = useRef(0)`,
          'live delay ref'
        )
      }

      // LIVE_START_NOW deliberately bypasses the MASTER start lead. Compensate on the
      // transmitted timeline position instead, so mid-show rehearsal starts remain
      // unrestricted by PREVIEW_SAFE_LIMIT while the RX timeline trails the browser
      // media clock by exactly the configured output delay.
      //
      // For the first few milliseconds where offset < delay, a negative timeline is
      // impossible. In that narrow case use the existing delayed LIVE_START path so
      // MASTER schedules timeline 0 in the future by the remaining compensation time.
      const oldSend = '    const sent = await sendSerialLine(`LIVE_START_NOW ${offsetMs}`)'
      const newSend = [
        "    const compensationMs = Math.max(0, Math.min(DELAY_HARD_MAX, Math.round(Number(effectiveDelay) || 0)))",
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
      // output compensation. With compensation active, MASTER intentionally reaches
      // SHOW_DURATION_MS later than the browser media element does.
      const watchdogAnchor = '    if (!showEndMs || Math.round(currentTime * 1000) + 20 < showEndMs) return'
      out = replaceRequired(
        out,
        watchdogAnchor,
        "    if (bLiveDelayRef.current > 0) return\n" + watchdogAnchor,
        'early completion watchdog'
      )

      // Keep the timer-based backup after the compensated MASTER end point. MASTER is
      // still authoritative and normally finishes by itself; this timer is only a USB
      // backup and therefore must never terminate a compensated show early.
      const remainingAnchor = '    const remainingMs = Math.max(0, showEndMs - positionMs)'
      out = replaceRequired(
        out,
        remainingAnchor,
        '    const remainingMs = Math.max(0, showEndMs - positionMs + Math.max(0, Number(bLiveDelayRef.current) || 0))',
        'completion timer compensation'
      )

      // Clear the frozen compensation only after LIVE really leaves the live state.
      // A B_LIVE -> A_LIVE handoff stays stageLive=true, so its compensation survives.
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

      // Make the applied correction visible during testing without changing controls.
      const toastAnchor = "    showToast(`${rehearsalMode ? '연습실' : 'B'} LIVE 즉시 GO · ${fmtTime(offsetMs / 1000)}`)"
      out = replaceRequired(
        out,
        toastAnchor,
        "    showToast(`${rehearsalMode ? '연습실' : 'B'} LIVE GO · ${fmtTime(offsetMs / 1000)} · 출력보정 ${compensationMs}ms`)",
        'compensation toast'
      )

      return { code: out, map: null }
    },
  }
}
