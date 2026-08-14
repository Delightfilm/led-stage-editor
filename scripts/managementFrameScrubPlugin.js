export function managementFrameScrubPlugin() {
  return {
    name: 'management-frame-scrub',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      const oldScrub = [
        '  const scrub = (event) => {',
        '    pause()',
        '    let time = timeFromPointer(event)',
        '    if (event.shiftKey) time = snapTime(time)',
        '    const next = seek(time, !event.altKey, true)',
        '    sendSeekToMaster(next)',
        '  }',
        '',
        '  const startScrub = (event) => {',
        '    if (event.button !== 0) return',
        '    event.preventDefault()',
        '    event.stopPropagation()',
        '    scrub(event)',
        '    const move = (ev) => scrub(ev)',
        '    const up = (ev) => {',
        '      scrub(ev)',
        '      sendSeekToMaster(timeFromPointer(ev), true)',
        "      window.removeEventListener('pointermove', move)",
        "      window.removeEventListener('pointerup', up)",
        '    }',
        "    window.addEventListener('pointermove', move)",
        "    window.addEventListener('pointerup', up)",
        '  }',
      ].join('\n')

      const newScrub = [
        '  const scrubTimeFromEvent = (event) => {',
        '    let time = timeFromPointer(event)',
        '    if (event.shiftKey) time = snapTime(time)',
        '    return seek(time, !event.altKey, false)',
        '  }',
        '',
        '  const startScrub = (event) => {',
        '    if (event.button !== 0) return',
        '    event.preventDefault()',
        '    event.stopPropagation()',
        '',
        '    // Pause once at scrub start. Repeating pause() on every pointermove was',
        '    // starving video seeks and made the program monitor update only after release.',
        '    pause()',
        '',
        '    let raf = 0',
        '    let pending = null',
        '    let lastNext = currentTime',
        '',
        '    const paint = () => {',
        '      raf = 0',
        '      if (!pending) return',
        '      const nextEvent = pending',
        '      pending = null',
        '      lastNext = scrubTimeFromEvent(nextEvent)',
        '      // MASTER seek remains throttled by sendSeekToMaster(); video.currentTime',
        '      // is updated immediately by seek() on every rendered scrub frame.',
        '      sendSeekToMaster(lastNext)',
        '    }',
        '',
        '    const queue = (ev) => {',
        '      pending = { clientX: ev.clientX, shiftKey: ev.shiftKey, altKey: ev.altKey }',
        '      if (!raf) raf = window.requestAnimationFrame(paint)',
        '    }',
        '',
        '    queue(event)',
        '    const move = (ev) => queue(ev)',
        '    const up = (ev) => {',
        '      if (raf) { window.cancelAnimationFrame(raf); raf = 0 }',
        '      pending = null',
        '      lastNext = scrubTimeFromEvent(ev)',
        '      sendSeekToMaster(lastNext, true)',
        "      window.removeEventListener('pointermove', move)",
        "      window.removeEventListener('pointerup', up)",
        '    }',
        "    window.addEventListener('pointermove', move)",
        "    window.addEventListener('pointerup', up)",
        '  }',
      ].join('\n')

      if (!out.includes(oldScrub)) {
        if (!out.includes('const scrubTimeFromEvent')) throw new Error('management frame scrub: scrub anchor not found')
      } else {
        out = out.replace(oldScrub, newScrub)
      }

      out = out.replace(
        '<video ref={videoRef} className={`programVideo ${mediaKind === \'video\' ? \'visible\' : \'\'}`} preload="metadata" playsInline />',
        '<video ref={videoRef} className={`programVideo ${mediaKind === \'video\' ? \'visible\' : \'\'}`} preload="auto" playsInline />'
      )

      const oldPlayhead = '<div className="playhead redHead" style={{ left: playheadLeft }}><div className="phTop" /><span>PLAYHEAD</span></div>'
      const newPlayhead = '<div className="playhead redHead" style={{ left: playheadLeft, cursor: \'ew-resize\', touchAction: \'none\' }} onPointerDown={startScrub} title="PLAYHEAD 드래그 · 영상 프레임 실시간 프리뷰"><div className="phTop" /><span>PLAYHEAD</span></div>'
      if (out.includes(oldPlayhead)) out = out.replace(oldPlayhead, newPlayhead)
      else if (!out.includes('영상 프레임 실시간 프리뷰')) throw new Error('management frame scrub: playhead anchor not found')

      return { code: out, map: null }
    },
  }
}
