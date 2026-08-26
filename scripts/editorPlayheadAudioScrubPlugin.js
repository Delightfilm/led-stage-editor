export function editorPlayheadAudioScrubPlugin() {
  return {
    name: 'editor-playhead-audio-scrub',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const replaceStrict = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`editor scrub: ${label} anchor not found`)
        out = out.replace(from, to)
      }

      // Deep zoom can make timelineW hundreds of thousands of CSS pixels wide.
      // Keep the canvas backing store bounded and stretch only the CSS box so the
      // browser never hits its maximum canvas bitmap width (the white-block bug).
      const waveformCanvasPattern = /    const W = timelineW, H = (waveHeight|56);\n    cv\.width = W; cv\.height = H;/
      const waveformMatch = out.match(waveformCanvasPattern)
      if (!waveformMatch) throw new Error('editor scrub: bounded waveform canvas anchor not found')
      const waveformHeightExpr = waveformMatch[1]
      out = out.replace(
        waveformCanvasPattern,
        [
          `    const W = Math.max(600, Math.min(4096, Math.round(timelineW))), H = ${waveformHeightExpr};`,
          '    cv.width = W; cv.height = H;',
          '    cv.style.width = timelineW + "px";',
          '    cv.style.height = H + "px";',
        ].join('\n')
      )

      // Preserve the pre-scrub playback state, then let the underlying media element
      // play while the mouse continuously seeks it. The result is intentionally a
      // choppy/jog-style audible preview, which is much more useful than silent seeking.
      replaceStrict(
        '    pause();\n    const apply = (ev) => {',
        '    const resumeAfterScrub = playing;\n    pause();\n    const apply = (ev) => {',
        'scrub playback state'
      )

      replaceStrict(
        '    apply(e);\n    const move = (ev) => apply(ev);',
        [
          '    apply(e);',
          '    const scrubMediaEl = getMediaEl();',
          '    if (scrubMediaEl && (audioInfo || videoInfo)) {',
          '      scrubMediaEl.play().catch(() => {});',
          '    }',
          '    document.body.classList.add("scrubbingPlayhead");',
          '    const move = (ev) => apply(ev);',
        ].join('\n'),
        'audible scrub start'
      )

      replaceStrict(
        [
          '    const up = () => {',
          '      setSnapGuide(null);',
          '      window.removeEventListener("mousemove", move);',
          '      window.removeEventListener("mouseup", up);',
          '    };',
        ].join('\n'),
        [
          '    const up = () => {',
          '      setSnapGuide(null);',
          '      if (scrubMediaEl) scrubMediaEl.pause();',
          '      document.body.classList.remove("scrubbingPlayhead");',
          '      window.removeEventListener("mousemove", move);',
          '      window.removeEventListener("mouseup", up);',
          '      if (resumeAfterScrub) play();',
          '    };',
        ].join('\n'),
        'audible scrub stop'
      )

      // The ruler and waveform were already scrub surfaces, but the red playhead itself
      // had pointer-events:none. Make the actual playhead draggable too.
      replaceStrict(
        '<div className="playhead" style={{ left: currentTime * pps }}>',
        '<div className="playhead" style={{ left: currentTime * pps }} onMouseDown={startPlayheadScrub} title="재생헤드를 드래그해 이동 · 미디어가 있으면 스크럽 소리 재생">',
        'playhead mouse handler'
      )

      replaceStrict(
        [
          '.playhead {',
          '  position: absolute; top: 0; bottom: 0; width: 2px; z-index: 8;',
          '  background: #FF3B6B; box-shadow: 0 0 10px #FF3B6B; pointer-events: none;',
          '}',
        ].join('\n'),
        [
          '.playhead {',
          '  position: absolute; top: 0; bottom: 0; width: 2px; z-index: 8;',
          '  background: #FF3B6B; box-shadow: 0 0 10px #FF3B6B; pointer-events: auto;',
          '  cursor: ew-resize; touch-action: none;',
          '}',
          '.playhead::before {',
          '  content: ""; position: absolute; top: 0; bottom: 0; left: -7px; width: 16px;',
          '}',
          'body.scrubbingPlayhead, body.scrubbingPlayhead * {',
          '  cursor: ew-resize !important; user-select: none !important;',
          '}',
        ].join('\n'),
        'playhead hit area css'
      )

      replaceStrict(
        'title="드래그 또는 마우스 휠로 좌우 이동 · +/− 키로 확대/축소 · C: 선택 블록 자르기 · SHIFT+C: 전체 트랙 자르기 · 블록 드래그 중 SHIFT: 자석처럼 스냅(다른 의상 블록에도 붙어요) · CTRL+Z: 되돌리기 · CTRL+SHIFT+Z: 다시 실행"',
        'title="빨간 재생헤드/눈금자/파형 드래그: 시간 이동 + 스크럽 소리 · 빈 공간 드래그/마우스 휠: 이동 · +/−: 확대/축소 · C: 선택 블록 자르기 · SHIFT+C: 전체 트랙 자르기 · 블록 드래그 중 SHIFT: 스냅 · CTRL+Z: 되돌리기"',
        'timeline help text'
      )

      if (!out.includes('scrubMediaEl.play().catch') || !out.includes('Math.min(4096') || !out.includes('onMouseDown={startPlayheadScrub} title="재생헤드를 드래그해 이동')) {
        throw new Error('editor scrub: build assertions failed')
      }

      return { code: out, map: null }
    },
  }
}
