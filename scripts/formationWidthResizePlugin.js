export function formationWidthResizePlugin() {
  return {
    name: 'formation-width-resize',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const replaceStrict = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`formation width: ${label} anchor not found`)
        out = out.replace(from, to)
      }

      const stateAnchor = '  const [formationDraft, setFormationDraft] = useState(null);'
      replaceStrict(
        stateAnchor,
        stateAnchor + '\n' + [
          '  const [formationWidth, setFormationWidth] = useState(() => {',
          '    const saved = Number(localStorage.getItem("led-stage-formation-width"));',
          '    if (Number.isFinite(saved) && saved >= 560) return saved;',
          '    return Math.round(Math.min(1280, Math.max(900, window.innerWidth * 0.68)));',
          '  });',
        ].join('\n'),
        'width state'
      )

      const helperAnchor = '  const startFormationDrag = (e, costumeId) => {'
      const helper = [
        '  const startFormationWidthResize = (e, side) => {',
        '    if (e.button !== 0) return;',
        '    e.preventDefault();',
        '    e.stopPropagation();',
        '    const startX = e.clientX;',
        '    const startWidth = formationWidth;',
        '    document.body.classList.add("resizingFormation");',
        '    const move = (ev) => {',
        '      const dx = ev.clientX - startX;',
        '      const delta = side === "right" ? dx * 2 : -dx * 2;',
        '      const maxWidth = Math.max(560, window.innerWidth - 120);',
        '      const next = Math.max(560, Math.min(maxWidth, Math.round(startWidth + delta)));',
        '      setFormationWidth(next);',
        '    };',
        '    const up = () => {',
        '      document.body.classList.remove("resizingFormation");',
        '      setFormationWidth((w) => { localStorage.setItem("led-stage-formation-width", String(w)); return w; });',
        '      window.removeEventListener("mousemove", move);',
        '      window.removeEventListener("mouseup", up);',
        '    };',
        '    window.addEventListener("mousemove", move);',
        '    window.addEventListener("mouseup", up);',
        '  };',
        '',
      ].join('\n')
      replaceStrict(helperAnchor, helper + helperAnchor, 'resize helper')

      replaceStrict(
        '        <section className="formationEditor">',
        '        <section className="formationEditor" style={{ width: formationWidth }}>\n          <div className="formationWidthHandle left" onMouseDown={(e) => startFormationWidthResize(e, "left")} title="드래그해서 대형 편집기 너비 조절" />\n          <div className="formationWidthHandle right" onMouseDown={(e) => startFormationWidthResize(e, "right")} title="드래그해서 대형 편집기 너비 조절" />',
        'editor section'
      )

      replaceStrict(
        '<b>🎭 전체 무대 대형</b>',
        '<b>🎭 전체 무대 대형</b> <small className="formationWidthLabel">{formationWidth}px · 양옆을 드래그해 너비 조절</small>',
        'width label'
      )

      const cssAnchor = '.toast {'
      const css = [
        '/* resizable choreography stage width */',
        '.formationEditor{max-width:calc(100vw - 120px)}',
        '.formationWidthHandle{position:absolute;top:0;bottom:0;width:12px;z-index:30;cursor:ew-resize;background:transparent}',
        '.formationWidthHandle.left{left:-1px}.formationWidthHandle.right{right:-1px}',
        '.formationWidthHandle:hover{background:linear-gradient(90deg,transparent,rgba(94,224,255,.32),transparent)}',
        '.formationWidthHandle:after{content:"";position:absolute;top:42%;bottom:42%;left:5px;width:2px;border-radius:2px;background:rgba(190,205,235,.35)}',
        '.formationWidthHandle:hover:after{background:#5ee0ff;box-shadow:0 0 8px rgba(94,224,255,.8)}',
        '.formationWidthLabel{margin-left:7px;color:#6f7b93;font-size:8px;font-weight:500;white-space:nowrap}',
        'body.resizingFormation,body.resizingFormation *{cursor:ew-resize!important;user-select:none!important}',
        '@media(max-width:900px){.formationEditor{width:auto!important;max-width:none}.formationWidthHandle,.formationWidthLabel{display:none}}',
        '',
      ].join('\n')
      replaceStrict(cssAnchor, css + cssAnchor, 'css')

      return { code: out, map: null }
    },
  }
}
