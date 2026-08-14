export function managementFrameScrubPlugin() {
  return {
    name: 'management-frame-scrub',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      // Replace either the original scrub implementation or the previous lightweight
      // frame-scrub implementation. PLAYHEAD motion remains immediate, while video
      // decode seeks are serialized so the browser never builds a stale seek backlog.
      const originalStart = out.indexOf('  const scrub = (event) => {')
      const enhancedStart = out.indexOf('  const scrubTimeFromEvent = (event) => {')
      const scrubStart = originalStart >= 0 ? originalStart : enhancedStart
      const panStart = out.indexOf('  const startTimelinePan = (event) => {', scrubStart)

      if (scrubStart < 0 || panStart < 0) {
        if (!out.includes('const queueVideoScrubSeek =')) {
          throw new Error('management frame scrub: scrub region not found')
        }
      } else {
        const replacement = [
          '  const videoScrubStateRef = useRef({ busy: false, desired: null, token: 0, timer: 0 })',
          '',
          '  const queueVideoScrubSeek = (time, force = false) => {',
          '    const video = videoRef.current',
          "    if (!video || mediaKind !== 'video' || !Number.isFinite(time)) return",
          '    const state = videoScrubStateRef.current',
          '    state.desired = time',
          '',
          '    const pump = () => {',
          '      const current = videoRef.current',
          "      if (!current || mediaKind !== 'video') { state.busy = false; return }",
          '      if (state.busy && !force) return',
          '      const target = state.desired',
          '      if (!Number.isFinite(target)) { state.busy = false; return }',
          '',
          '      state.busy = true',
          '      const token = ++state.token',
          '      const done = () => {',
          '        if (state.token !== token) return',
          '        if (state.timer) { window.clearTimeout(state.timer); state.timer = 0 }',
          '        state.busy = false',
          '        const latest = state.desired',
          '        if (Number.isFinite(latest) && Math.abs(latest - current.currentTime) > Math.max(0.004, 0.35 / fps)) {',
          '          window.requestAnimationFrame(pump)',
          '        }',
          '      }',
          '',
          "      current.addEventListener('seeked', done, { once: true })",
          '      try {',
          '        current.currentTime = target',
          '      } catch {',
          "        current.removeEventListener('seeked', done)",
          '        state.busy = false',
          '        return',
          '      }',
          '',
          '      // Some browser/codec combinations delay or omit seeked while rapidly',
          '      // scrubbing. Release the queue after a short guard so the latest frame wins.',
          '      state.timer = window.setTimeout(() => {',
          "        try { current.removeEventListener('seeked', done) } catch {}",
          '        done()',
          '      }, 90)',
          '    }',
          '',
          '    if (!state.busy || force) pump()',
          '  }',
          '',
          '  const scrubTargetFromEvent = (event) => {',
          '    let time = timeFromPointer(event)',
          '    if (event.shiftKey) time = snapTime(time)',
          '    let next = clamp(Number(time) || 0, 0, duration)',
          '    if (!event.altKey && fps > 0) next = clamp(Math.round(next * fps) / fps, 0, duration)',
          '    return next',
          '  }',
          '',
          '  const applyScrubTarget = (event, forceVideo = false) => {',
          '    const next = scrubTargetFromEvent(event)',
          '    // PLAYHEAD and all timeline-derived previews move immediately, independent',
          '    // of how long the compressed video decoder needs for the requested frame.',
          '    setCurrentTime(next)',
          '    queueVideoScrubSeek(next, forceVideo)',
          '    sendSeekToMaster(next, forceVideo)',
          '    return next',
          '  }',
          '',
          '  const startScrub = (event) => {',
          '    if (event.button !== 0) return',
          '    event.preventDefault()',
          '    event.stopPropagation()',
          '',
          '    // Stop playback only once. Repeated PREVIEW_PAUSE calls during pointermove',
          '    // used to compete with local video seeking and RF/USB preview traffic.',
          '    pause()',
          '',
          '    let raf = 0',
          '    let pending = null',
          '    const paint = () => {',
          '      raf = 0',
          '      if (!pending) return',
          '      const ev = pending',
          '      pending = null',
          '      applyScrubTarget(ev, false)',
          '    }',
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
          '      const finalNext = applyScrubTarget(ev, true)',
          '      // Force a final exact frame request after the pointer is released.',
          '      queueVideoScrubSeek(finalNext, true)',
          "      window.removeEventListener('pointermove', move)",
          "      window.removeEventListener('pointerup', up)",
          '    }',
          "    window.addEventListener('pointermove', move)",
          "    window.addEventListener('pointerup', up)",
          '  }',
          '',
        ].join('\n')
        out = out.slice(0, scrubStart) + replacement + out.slice(panStart)
      }

      out = out.replace(
        '<video ref={videoRef} className={`programVideo ${mediaKind === \'video\' ? \'visible\' : \'\'}`} preload="metadata" playsInline />',
        '<video ref={videoRef} className={`programVideo ${mediaKind === \'video\' ? \'visible\' : \'\'}`} preload="auto" playsInline disablePictureInPicture />'
      )
      out = out.replace(
        '<video ref={videoRef} className={`programVideo ${mediaKind === \'video\' ? \'visible\' : \'\'}`} preload="auto" playsInline />',
        '<video ref={videoRef} className={`programVideo ${mediaKind === \'video\' ? \'visible\' : \'\'}`} preload="auto" playsInline disablePictureInPicture />'
      )

      const plainPlayhead = '<div className="playhead redHead" style={{ left: playheadLeft }}><div className="phTop" /><span>PLAYHEAD</span></div>'
      const previousPlayhead = '<div className="playhead redHead" style={{ left: playheadLeft, cursor: \'ew-resize\', touchAction: \'none\' }} onPointerDown={startScrub} title="PLAYHEAD 드래그 · 영상 프레임 실시간 프리뷰"><div className="phTop" /><span>PLAYHEAD</span></div>'
      const enhancedPlayhead = '<div className="playhead redHead" style={{ left: playheadLeft, cursor: \'ew-resize\', touchAction: \'none\', willChange: \'left\' }} onPointerDown={startScrub} title="PLAYHEAD 드래그 · 디코더 최적화 실시간 스크럽"><div className="phTop" /><span>PLAYHEAD</span></div>'
      if (out.includes(plainPlayhead)) out = out.replace(plainPlayhead, enhancedPlayhead)
      else if (out.includes(previousPlayhead)) out = out.replace(previousPlayhead, enhancedPlayhead)
      else if (!out.includes('디코더 최적화 실시간 스크럽')) throw new Error('management frame scrub: playhead anchor not found')

      return { code: out, map: null }
    },
  }
}
