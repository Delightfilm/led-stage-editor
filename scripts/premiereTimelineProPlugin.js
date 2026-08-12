export function premiereTimelineProPlugin() {
  return {
    name: 'premiere-timeline-pro',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const replaceStrict = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`premiere pro: ${label} anchor not found`)
        out = out.replace(from, to)
      }

      // SHIFT while moving/resizing a clip already snaps to getSnapPoints(), which includes currentTime.
      // Increase the magnet radius so the clip start/end locks to the red playhead more like Premiere.
      replaceStrict(
        '      const threshold = 8 / pps; // 8px 반경 안에 있으면 스냅',
        '      const threshold = 16 / pps; // SHIFT: 16px 자석 반경 · 재생헤드/다른 블록 시작·끝에 스냅',
        'clip snap radius'
      )

      // Deep timeline zoom: at 2400 px/sec a 60fps frame is 40px wide.
      replaceStrict(
        '  const zoomOut = () => setPps((p) => Math.max(8, Math.round(p / 1.25)));\n  const zoomIn = () => setPps((p) => Math.min(240, Math.round(p * 1.25)));',
        '  const zoomOut = () => setPps((p) => Math.max(8, Math.round(p / 1.5)));\n  const zoomIn = () => setPps((p) => Math.min(2400, Math.round(p * 1.5)));',
        'zoom functions'
      )
      replaceStrict('                max={200}', '                max={2400}', 'zoom slider max')
      replaceStrict(
        '                value={Math.min(200, Math.max(8, pps))}',
        '                value={Math.min(2400, Math.max(8, pps))}',
        'zoom slider value'
      )

      const rulerFrom = '<div className="ruler scrubSurface" onMouseDown={startPlayheadScrub} title="클릭/드래그: 프레임 단위 재생 헤드 이동">'
      const rulerTo = '<div className={"ruler scrubSurface" + (pps / fps >= 6 ? " frameZoom" : "")} style={{ "--framePx": (pps / fps) + "px" }} onMouseDown={startPlayheadScrub} title="클릭/드래그: 프레임 단위 재생 헤드 이동 · SHIFT: 블록 시작/끝 스냅">'
      replaceStrict(rulerFrom, rulerTo, 'frame ruler')

      const cssAnchor = '.scrubSurface { cursor:ew-resize !important; user-select:none; }'
      replaceStrict(
        cssAnchor,
        cssAnchor + '\n.ruler.frameZoom { background-color:#11151F; background-image:repeating-linear-gradient(90deg, rgba(120,132,156,.28) 0 1px, transparent 1px var(--framePx)); }\n.ruler.frameZoom .mark { border-left-color:rgba(210,220,240,.55); }',
        'frame grid css'
      )

      return { code: out, map: null }
    },
  }
}
