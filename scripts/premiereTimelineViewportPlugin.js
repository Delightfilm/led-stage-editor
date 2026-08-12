export function premiereTimelineViewportPlugin() {
  return {
    name: 'premiere-timeline-viewport',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const replaceStrict = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`timeline viewport: ${label} anchor not found`)
        out = out.replace(from, to)
      }

      const oldWheel = [
        '  useEffect(() => {',
        '    const el = timelineScrollRef.current;',
        '    if (!el) return;',
        '    const onWheel = (e) => {',
        '      // 세로 스크롤/트랙패드를 타임라인 좌우 이동으로 사용',
        '      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;',
        '      if (dx === 0) return;',
        '      e.preventDefault();',
        '      el.scrollLeft += dx;',
        '    };',
        '    el.addEventListener("wheel", onWheel, { passive: false });',
        '    return () => el.removeEventListener("wheel", onWheel);',
        '  }, []);',
      ].join('\n')

      const newWheel = [
        '  useEffect(() => {',
        '    const el = timelineScrollRef.current;',
        '    if (!el) return;',
        '    const onWheel = (e) => {',
        '      const canScrollY = el.scrollHeight > el.clientHeight + 2;',
        '      const horizontalGesture = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);',
        '',
        '      // 트랙이 화면 높이를 넘으면 일반 휠은 세로 트랙 스크롤로 사용.',
        '      // Shift+휠 또는 트랙패드의 가로 제스처만 타임라인 좌우 이동으로 사용.',
        '      if (canScrollY && !horizontalGesture) return;',
        '',
        '      const dx = e.shiftKey',
        '        ? e.deltaY',
        '        : (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY);',
        '      if (dx === 0) return;',
        '      e.preventDefault();',
        '      el.scrollLeft += dx;',
        '    };',
        '    el.addEventListener("wheel", onWheel, { passive: false });',
        '    return () => el.removeEventListener("wheel", onWheel);',
        '  }, []);',
      ].join('\n')
      replaceStrict(oldWheel, newWheel, 'wheel behavior')

      replaceStrict(
        '.timelineScroll { flex: 1; overflow-x: auto; overflow-y: hidden; cursor: grab; }',
        '.timelineScroll { flex: 1 1 auto; min-height: 0; overflow: auto; cursor: grab; overscroll-behavior: contain; scrollbar-gutter: stable; }',
        'timeline overflow'
      )

      const cssAnchor = '.timelineScroll.panning { cursor: grabbing; user-select: none; }'
      replaceStrict(
        cssAnchor,
        cssAnchor + '\n.timelineScroll::-webkit-scrollbar { width: 10px; height: 10px; }\n.timelineScroll::-webkit-scrollbar-thumb { background: #343D55; border-radius: 999px; border: 2px solid #11151F; }\n.timelineScroll::-webkit-scrollbar-track { background: #11151F; }\n@media (max-height: 760px) { .programViewport { max-height: 27vh !important; } }\n@media (max-height: 620px) { .programViewport { max-height: 21vh !important; } }',
        'timeline scrollbar css'
      )

      return { code: out, map: null }
    },
  }
}
