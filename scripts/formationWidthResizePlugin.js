export function formationWidthResizePlugin() {
  return {
    name: 'formation-width-resize',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const replaceStrict = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`formation resize: ${label} anchor not found`)
        out = out.replace(from, to)
      }

      // Local fallback makes refresh immediate; Supabase remains the cross-device source of truth.
      replaceStrict(
        '  const [formations, setFormations] = useState([]);',
        [
          '  const [formations, setFormations] = useState(() => {',
          '    try {',
          '      const saved = JSON.parse(localStorage.getItem("led-stage-formations-v1") || "[]");',
          '      return Array.isArray(saved) ? saved : [];',
          '    } catch {',
          '      return [];',
          '    }',
          '  });',
        ].join('\n'),
        'formation local fallback state'
      )

      const stateAnchor = '  const [formationDraft, setFormationDraft] = useState(null);'
      replaceStrict(
        stateAnchor,
        stateAnchor + '\n' + [
          '  const [formationWidth, setFormationWidth] = useState(() => {',
          '    const saved = Number(localStorage.getItem("led-stage-formation-width"));',
          '    if (Number.isFinite(saved) && saved >= 560) return saved;',
          '    return Math.round(Math.min(1280, Math.max(900, window.innerWidth * 0.68)));',
          '  });',
          '  const [formationHeight, setFormationHeight] = useState(() => {',
          '    const saved = Number(localStorage.getItem("led-stage-formation-height"));',
          '    if (Number.isFinite(saved) && saved >= 180) return saved;',
          '    return 216;',
          '  });',
        ].join('\n'),
        'size state'
      )

      replaceStrict(
        '  const formationDragRef = useRef(null);',
        '  const formationDragRef = useRef(null);\n  const formationPersistTimerRef = useRef(null);',
        'persistence timer ref'
      )

      // Store both formation keyframes and editor dimensions in the existing JSONB project_data.
      replaceStrict(
        '    customPresets,\n    formations,\n  });',
        '    customPresets,\n    formations,\n    formationView: { width: formationWidth, height: formationHeight },\n  });',
        'cloud formation view data'
      )
      replaceStrict(
        '      customPresets,\n      formations,\n    };',
        '      customPresets,\n      formations,\n      formationView: { width: formationWidth, height: formationHeight },\n    };',
        'local formation view data'
      )

      const restoreNeedle = 'setFormations(Array.isArray(data.formations) ? data.formations : []);'
      if (!out.includes(restoreNeedle)) throw new Error('formation resize: formation restore anchor not found')
      const restoreBlock = [
        'if (Array.isArray(data.formations)) {',
        '  setFormations(data.formations);',
        '  try { localStorage.setItem("led-stage-formations-v1", JSON.stringify(data.formations)); } catch {}',
        '}',
        'if (data.formationView && typeof data.formationView === "object") {',
        '  const restoredFormationWidth = Number(data.formationView.width);',
        '  const restoredFormationHeight = Number(data.formationView.height);',
        '  if (Number.isFinite(restoredFormationWidth) && restoredFormationWidth >= 560) {',
        '    setFormationWidth(restoredFormationWidth);',
        '    try { localStorage.setItem("led-stage-formation-width", String(restoredFormationWidth)); } catch {}',
        '  }',
        '  if (Number.isFinite(restoredFormationHeight) && restoredFormationHeight >= 180) {',
        '    setFormationHeight(restoredFormationHeight);',
        '    try { localStorage.setItem("led-stage-formation-height", String(restoredFormationHeight)); } catch {}',
        '  }',
        '}',
      ].join('\n')
      out = out.replaceAll(restoreNeedle, restoreBlock)

      const helperAnchor = '  const startFormationDrag = (e, costumeId) => {'
      const helper = [
        '  const startFormationResize = (e, side) => {',
        '    if (e.button !== 0) return;',
        '    e.preventDefault();',
        '    e.stopPropagation();',
        '    const startX = e.clientX;',
        '    const startY = e.clientY;',
        '    const startWidth = formationWidth;',
        '    const startHeight = formationHeight;',
        '    const vertical = side === "top" || side === "bottom";',
        '    document.body.classList.add(vertical ? "resizingFormationY" : "resizingFormationX");',
        '    const move = (ev) => {',
        '      if (vertical) {',
        '        const dy = ev.clientY - startY;',
        '        const delta = side === "bottom" ? dy : -dy;',
        '        const maxHeight = Math.max(180, Math.min(760, window.innerHeight - 100));',
        '        setFormationHeight(Math.max(180, Math.min(maxHeight, Math.round(startHeight + delta))));',
        '      } else {',
        '        const dx = ev.clientX - startX;',
        '        const delta = side === "right" ? dx * 2 : -dx * 2;',
        '        const maxWidth = Math.max(560, window.innerWidth - 120);',
        '        setFormationWidth(Math.max(560, Math.min(maxWidth, Math.round(startWidth + delta))));',
        '      }',
        '    };',
        '    const up = () => {',
        '      document.body.classList.remove("resizingFormationX", "resizingFormationY");',
        '      setFormationWidth((w) => { try { localStorage.setItem("led-stage-formation-width", String(w)); } catch {} return w; });',
        '      setFormationHeight((h) => { try { localStorage.setItem("led-stage-formation-height", String(h)); } catch {} return h; });',
        '      window.removeEventListener("mousemove", move);',
        '      window.removeEventListener("mouseup", up);',
        '    };',
        '    window.addEventListener("mousemove", move);',
        '    window.addEventListener("mouseup", up);',
        '  };',
        '',
      ].join('\n')
      replaceStrict(helperAnchor, helper + helperAnchor, 'resize helper')

      // Dedicated 600ms debounce for formation data so a quick refresh cannot beat the generic autosave.
      const selectedBlockAnchor = '  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;'
      const persistEffect = [
        '  useEffect(() => {',
        '    try {',
        '      localStorage.setItem("led-stage-formations-v1", JSON.stringify(formations));',
        '      localStorage.setItem("led-stage-formation-width", String(formationWidth));',
        '      localStorage.setItem("led-stage-formation-height", String(formationHeight));',
        '    } catch {}',
        '    if (!cloudSession || !cloudReady) return;',
        '    if (formationPersistTimerRef.current) clearTimeout(formationPersistTimerRef.current);',
        '    formationPersistTimerRef.current = setTimeout(async () => {',
        '      try {',
        '        const row = await saveCloudProject(cloudSession, buildCloudProjectData());',
        '        const savedAt = row?.updated_at ? new Date(row.updated_at) : new Date();',
        '        setCloudStatus("대형 저장됨 · " + savedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));',
        '      } catch (err) {',
        '        console.warn("formation cloud save failed", err);',
        '      }',
        '    }, 600);',
        '    return () => { if (formationPersistTimerRef.current) clearTimeout(formationPersistTimerRef.current); };',
        '  }, [formations, formationWidth, formationHeight, cloudSession, cloudReady]);',
        '',
      ].join('\n')
      replaceStrict(selectedBlockAnchor, persistEffect + selectedBlockAnchor, 'formation persistence effect')

      replaceStrict(
        '        <section className="formationEditor">',
        [
          '        <section className="formationEditor" style={{ width: formationWidth, height: formationHeight }}>',
          '          <div className="formationResizeHandle left" onMouseDown={(e) => startFormationResize(e, "left")} title="드래그해서 대형 편집기 너비 조절" />',
          '          <div className="formationResizeHandle right" onMouseDown={(e) => startFormationResize(e, "right")} title="드래그해서 대형 편집기 너비 조절" />',
          '          <div className="formationResizeHandle top" onMouseDown={(e) => startFormationResize(e, "top")} title="드래그해서 대형 편집기 높이 조절" />',
          '          <div className="formationResizeHandle bottom" onMouseDown={(e) => startFormationResize(e, "bottom")} title="드래그해서 대형 편집기 높이 조절" />',
        ].join('\n'),
        'editor section'
      )

      replaceStrict(
        '<header className="toolbar">',
        '<header className="toolbar" style={{ minHeight: formationHeight + 16 }}>',
        'toolbar dynamic height'
      )

      replaceStrict(
        '<b>🎭 전체 무대 대형</b>',
        '<b>🎭 전체 무대 대형</b> <small className="formationSizeLabel">{formationWidth}×{formationHeight}px · 가장자리를 드래그해 크기 조절</small>',
        'size label'
      )

      const cssAnchor = '.toast {'
      const css = [
        '/* resizable choreography stage width + height */',
        '.formationEditor{max-width:calc(100vw - 120px);max-height:760px}',
        '.formationResizeHandle{position:absolute;z-index:30;background:transparent}',
        '.formationResizeHandle.left,.formationResizeHandle.right{top:0;bottom:0;width:12px;cursor:ew-resize}',
        '.formationResizeHandle.left{left:-1px}.formationResizeHandle.right{right:-1px}',
        '.formationResizeHandle.top,.formationResizeHandle.bottom{left:0;right:0;height:10px;cursor:ns-resize}',
        '.formationResizeHandle.top{top:-1px}.formationResizeHandle.bottom{bottom:-1px}',
        '.formationResizeHandle.left:hover,.formationResizeHandle.right:hover{background:linear-gradient(90deg,transparent,rgba(94,224,255,.32),transparent)}',
        '.formationResizeHandle.top:hover,.formationResizeHandle.bottom:hover{background:linear-gradient(180deg,transparent,rgba(94,224,255,.32),transparent)}',
        '.formationResizeHandle.left:after,.formationResizeHandle.right:after{content:"";position:absolute;top:42%;bottom:42%;left:5px;width:2px;border-radius:2px;background:rgba(190,205,235,.35)}',
        '.formationResizeHandle.top:after,.formationResizeHandle.bottom:after{content:"";position:absolute;left:47%;right:47%;top:4px;height:2px;border-radius:2px;background:rgba(190,205,235,.35)}',
        '.formationResizeHandle:hover:after{background:#5ee0ff;box-shadow:0 0 8px rgba(94,224,255,.8)}',
        '.formationSizeLabel{margin-left:7px;color:#6f7b93;font-size:8px;font-weight:500;white-space:nowrap}',
        'body.resizingFormationX,body.resizingFormationX *{cursor:ew-resize!important;user-select:none!important}',
        'body.resizingFormationY,body.resizingFormationY *{cursor:ns-resize!important;user-select:none!important}',
        '@media(max-width:900px){.formationEditor{width:auto!important;max-width:none}.formationResizeHandle,.formationSizeLabel{display:none}}',
        '',
      ].join('\n')
      replaceStrict(cssAnchor, css + cssAnchor, 'css')

      return { code: out, map: null }
    },
  }
}
