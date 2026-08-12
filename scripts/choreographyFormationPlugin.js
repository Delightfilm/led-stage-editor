export function choreographyFormationPlugin() {
  return {
    name: 'choreography-formation-editor',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code
      const replace = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`formation editor: ${label} anchor not found`)
        out = out.replace(from, to)
      }

      // State + refs.
      const stateAnchor = '  const [snapGuide, setSnapGuide] = useState(null); // 스냅(자석)이 걸렸을 때 보여줄 안내선 시각(초)'
      replace(stateAnchor, stateAnchor + '\n  const [formations, setFormations] = useState([]);\n  const [formationDraft, setFormationDraft] = useState(null);', 'state')
      const refAnchor = '  const lastCommitRef = useRef({ key: null, time: 0 });'
      replace(refAnchor, refAnchor + '\n  const formationStageRef = useRef(null);\n  const formationDragRef = useRef(null);', 'refs')

      // Persist formations in local JSON + Supabase project JSON/version history.
      replace(
        '    costumes,\n    blocks,\n    customPresets,\n  });',
        '    costumes,\n    blocks,\n    customPresets,\n    formations,\n  });',
        'cloud save data'
      )
      replace(
        '    if (Array.isArray(data.blocks)) setBlocks(data.blocks);',
        '    if (Array.isArray(data.blocks)) setBlocks(data.blocks);\n    setFormations(Array.isArray(data.formations) ? data.formations : []);\n    setFormationDraft(null);',
        'cloud restore'
      )
      out = out.replaceAll(
        '[costumes, blocks, customPresets, manualDuration, cloudAudioMeta, cloudMediaMeta, cloudSession, cloudReady]',
        '[costumes, blocks, customPresets, manualDuration, formations, cloudAudioMeta, cloudMediaMeta, cloudSession, cloudReady]'
      )
      out = out.replaceAll(
        '[costumes, blocks, customPresets, manualDuration, cloudAudioMeta, cloudSession, cloudReady]',
        '[costumes, blocks, customPresets, manualDuration, formations, cloudAudioMeta, cloudSession, cloudReady]'
      )
      replace(
        '      blocks,\n      customPresets,\n    };',
        '      blocks,\n      customPresets,\n      formations,\n    };',
        'local save data'
      )
      replace(
        '      setBlocks(data.blocks || []);',
        '      setBlocks(data.blocks || []);\n      setFormations(Array.isArray(data.formations) ? data.formations : []);\n      setFormationDraft(null);',
        'local restore'
      )

      // Formation engine: keyframes + linear movement preview between keyframes.
      const helperAnchor = '  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;'
      const helpers = [
        '  // ───────────── Choreography formation editor ─────────────',
        '  const defaultFormationPositions = (list = costumes) => {',
        '    const r = {};',
        '    const n = Math.max(1, list.length);',
        '    const front = n <= 4 ? n : Math.ceil(n / 2);',
        '    const back = Math.max(0, n - front);',
        '    list.forEach((c, i) => {',
        '      const firstRow = i < front;',
        '      const j = firstRow ? i : i - front;',
        '      const count = firstRow ? front : back;',
        '      r[c.id] = { x: ((j + 1) * 100) / (count + 1), y: firstRow ? (n <= 4 ? 50 : 34) : 69 };',
        '    });',
        '    return r;',
        '  };',
        '  const normalizeFormation = (positions) => {',
        '    const d = defaultFormationPositions(costumes);',
        '    const r = {};',
        '    costumes.forEach((c) => {',
        '      const p = positions?.[c.id] || d[c.id] || { x: 50, y: 50 };',
        '      r[c.id] = { x: Math.max(5, Math.min(95, Number(p.x) || 50)), y: Math.max(13, Math.min(88, Number(p.y) || 50)) };',
        '    });',
        '    return r;',
        '  };',
        '  const orderedFormations = useMemo(() => [...formations].sort((a, b) => Number(a.time) - Number(b.time)), [formations]);',
        '  const interpolatedFormation = useMemo(() => {',
        '    if (!orderedFormations.length) return defaultFormationPositions(costumes);',
        '    if (currentTime <= Number(orderedFormations[0].time)) return normalizeFormation(orderedFormations[0].positions);',
        '    const last = orderedFormations[orderedFormations.length - 1];',
        '    if (currentTime >= Number(last.time)) return normalizeFormation(last.positions);',
        '    let a = orderedFormations[0], b = last;',
        '    for (let i = 1; i < orderedFormations.length; i++) if (Number(orderedFormations[i].time) >= currentTime) { a = orderedFormations[i - 1]; b = orderedFormations[i]; break; }',
        '    const pa = normalizeFormation(a.positions), pb = normalizeFormation(b.positions);',
        '    const mix = Math.max(0, Math.min(1, (currentTime - Number(a.time)) / Math.max(0.000001, Number(b.time) - Number(a.time))));',
        '    const r = {};',
        '    costumes.forEach((c) => { r[c.id] = { x: pa[c.id].x + (pb[c.id].x - pa[c.id].x) * mix, y: pa[c.id].y + (pb[c.id].y - pa[c.id].y) * mix }; });',
        '    return r;',
        '  }, [orderedFormations, currentTime, costumes]);',
        '  const stageFormation = formationDraft ? normalizeFormation(formationDraft) : interpolatedFormation;',
        '',
        '  const startFormationDrag = (e, costumeId) => {',
        '    e.preventDefault(); e.stopPropagation();',
        '    if (playing) pause();',
        '    const stage = formationStageRef.current;',
        '    if (!stage) return;',
        '    setPreviewCostumeId(costumeId);',
        '    const base = normalizeFormation(formationDraft || interpolatedFormation);',
        '    setFormationDraft(base);',
        '    formationDragRef.current = costumeId;',
        '    const move = (ev) => {',
        '      if (!formationDragRef.current) return;',
        '      const rect = stage.getBoundingClientRect();',
        '      const x = Math.max(5, Math.min(95, ((ev.clientX - rect.left) / rect.width) * 100));',
        '      const y = Math.max(13, Math.min(88, ((ev.clientY - rect.top) / rect.height) * 100));',
        '      setFormationDraft((prev) => ({ ...normalizeFormation(prev || base), [costumeId]: { x, y } }));',
        '    };',
        '    const up = () => { formationDragRef.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };',
        '    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);',
        '  };',
        '  const saveFormationAtPlayhead = () => {',
        '    const rate = typeof fps === "number" && fps > 0 ? fps : 30;',
        '    const t = Math.max(0, Math.round(currentTime * rate) / rate);',
        '    const positions = normalizeFormation(formationDraft || interpolatedFormation);',
        '    const tol = 0.5 / rate;',
        '    setFormations((prev) => {',
        '      const list = [...prev];',
        '      const idx = list.findIndex((f) => Math.abs(Number(f.time) - t) <= tol);',
        '      if (idx >= 0) list[idx] = { ...list[idx], time: t, positions };',
        '      else list.push({ id: uid(), time: t, name: `대형 ${list.length + 1}`, positions });',
        '      return list.sort((x, y) => Number(x.time) - Number(y.time));',
        '    });',
        '    setFormationDraft(null);',
        '    showToast("🎭 " + fmtTime(t) + " 위치에 대형을 저장했어요.");',
        '  };',
        '  const clonePreviousFormation = () => {',
        '    const prev = [...orderedFormations].reverse().find((f) => Number(f.time) <= currentTime + 0.001);',
        '    setFormationDraft(normalizeFormation(prev?.positions || interpolatedFormation));',
        '    showToast(prev ? "🎭 이전 대형을 복제했어요. 위치를 바꾼 뒤 저장하세요." : "🎭 기본 대형을 편집 상태로 불러왔어요.");',
        '  };',
        '  const deleteFormationAtPlayhead = () => {',
        '    if (!orderedFormations.length) return showToast("🎭 삭제할 대형이 없어요.");',
        '    let target = orderedFormations[0];',
        '    orderedFormations.forEach((f) => { if (Math.abs(Number(f.time) - currentTime) < Math.abs(Number(target.time) - currentTime)) target = f; });',
        '    if (Math.abs(Number(target.time) - currentTime) > 0.5) return showToast("🎭 대형 마커 가까이 재생헤드를 옮긴 뒤 삭제하세요.");',
        '    if (!window.confirm(`${target.name || "대형"}을 삭제할까요?`)) return;',
        '    setFormations((prev) => prev.filter((f) => f.id !== target.id)); setFormationDraft(null);',
        '  };',
        '',
      ].join('\n')
      replace(helperAnchor, helpers + helperAnchor, 'helpers')

      // Add formation keyframe track below waveform.
      const trackAnchor = '\n\n              {tracks.map((tr) =>'
      const track = [
        '',
        '              <div className="formationTrack" onClick={(e) => seek(timeFromEvent(e))}>',
        '                <div className="formationTrackLabel">🎭 대형</div>',
        '                {orderedFormations.map((f, i) => (',
        '                  <button key={f.id} type="button" className="formationMarker" style={{ left: Number(f.time) * pps }}',
        '                    title={`${f.name || `대형 ${i + 1}`} · ${fmtTime(Number(f.time))}`}',
        '                    onClick={(e) => { e.stopPropagation(); setFormationDraft(null); seek(Number(f.time)); }}>',
        '                    <span>◆</span><small>{f.name || `대형 ${i + 1}`}</small>',
        '                  </button>',
        '                ))}',
        '              </div>',
      ].join('\n')
      replace(trackAnchor, '\n' + track + trackAnchor, 'formation track')

      // Replace top costume-card strip created by workspace cleanup with a 2D stage editor.
      const stripStart = out.indexOf('        <div className="topCostumeStrip"')
      const inputAnchor = '        <input ref={fileInputRef}'
      const inputPos = out.indexOf(inputAnchor, stripStart)
      if (stripStart < 0 || inputPos < 0) throw new Error('formation editor: top strip bounds not found')
      const editor = [
        '        <section className="formationEditor">',
        '          <div className="formationHead">',
        '            <div><b>🎭 전체 무대 대형</b> <span>{orderedFormations.length ? `${orderedFormations.length}개 저장` : "대형 미저장"}</span> {formationDraft && <em>편집 중</em>}</div>',
        '            <div className="formationButtons">',
        '              <button type="button" onClick={clonePreviousFormation}>⧉ 이전 대형 복제</button>',
        '              <button type="button" className="saveFormation" onClick={saveFormationAtPlayhead}>＋ 현재 위치 저장</button>',
        '              <button type="button" className="deleteFormation" onClick={deleteFormationAtPlayhead}>삭제</button>',
        '            </div>',
        '          </div>',
        '          <div className="formationStage" ref={formationStageRef}>',
        '            <div className="upstage">UP STAGE</div><div className="audience">▼ CAMERA / 관객석</div>',
        '            <div className="stageV" /><div className="stageH h1" /><div className="stageH h2" />',
        '            {allCostumePreviews.map(({ costume, zoneColors: zc }, i) => {',
        '              const p = stageFormation[costume.id] || { x: 50, y: 50 };',
        '              return <button key={costume.id} type="button" className={`formationActor ${previewCostumeId === costume.id ? "active" : ""}`}',
        '                style={{ left: p.x + "%", top: p.y + "%", "--cc": costume.color }} onMouseDown={(e) => startFormationDrag(e, costume.id)}',
        '                title={`${costume.name} · 드래그해서 위치 변경`}>',
        '                <span className="formationAvatar"><AvatarPreview zoneColors={zc} glowId={`glow-form-${i}`} compact /></span>',
        '                <span className="formationName"><b>{i + 1}</b> {costume.name}</span>',
        '              </button>;',
        '            })}',
        '          </div>',
        '        </section>',
        '',
      ].join('\n')
      out = out.slice(0, stripStart) + editor + out.slice(inputPos)

      // Formation styling overrides the previous compact card strip.
      const cssAnchor = '.toast {'
      const css = [
        '/* choreography formation editor */',
        '.toolbar{min-height:232px;align-items:flex-start}',
        '.formationEditor{position:absolute;left:50%;top:7px;transform:translateX(-50%);width:min(860px,55vw);height:216px;z-index:3;border:1px solid rgba(255,255,255,.08);border-radius:11px;background:#0b101a;overflow:hidden}',
        '.formationHead{height:37px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 7px 5px 10px;background:#151b2a;border-bottom:1px solid rgba(255,255,255,.07);font-size:10px}',
        '.formationHead span{color:#8792aa;margin-left:6px}.formationHead em{font-style:normal;color:#ffd86a;margin-left:6px}',
        '.formationButtons{display:flex;gap:5px}.formationButtons button{border:1px solid #303a54;border-radius:6px;background:#171d2c;color:#dce3f6;font-size:9px;padding:5px 7px;cursor:pointer}.formationButtons .saveFormation{color:#aeeaff;border-color:#3f8da7}.formationButtons .deleteFormation{color:#ff879d}',
        '.formationStage{position:relative;height:calc(100% - 37px);overflow:hidden;background:linear-gradient(180deg,#121827,#0a0f18 70%,#121723);user-select:none}',
        '.formationStage:before{content:"";position:absolute;left:8%;right:8%;top:13%;bottom:13%;border:1px solid rgba(130,154,199,.13);border-radius:4px}.stageV,.stageH{position:absolute;background:rgba(130,154,199,.09);pointer-events:none}.stageV{top:13%;bottom:13%;left:50%;width:1px}.stageH{left:8%;right:8%;height:1px}.stageH.h1{top:39%}.stageH.h2{top:66%}',
        '.upstage,.audience{position:absolute;left:50%;transform:translateX(-50%);z-index:1;font-size:8px;font-weight:800;letter-spacing:1px;color:rgba(175,190,220,.43);pointer-events:none}.upstage{top:4px}.audience{bottom:3px;color:rgba(220,190,120,.5)}',
        '.formationActor{position:absolute;z-index:4;width:54px;height:78px;transform:translate(-50%,-50%);padding:0;border:0;background:transparent;color:#e7ecfa;cursor:grab}.formationActor:active{cursor:grabbing}.formationActor.active{filter:drop-shadow(0 0 7px color-mix(in srgb,var(--cc) 66%,transparent))}',
        '.formationAvatar{display:block;width:46px;height:61px;margin:auto;overflow:hidden;border:1px solid color-mix(in srgb,var(--cc) 50%,#2d3448);border-radius:7px;background:#0d111b}.formationAvatar .avatarCompact{width:46px;height:69px;transform:translateY(-4px);display:block}',
        '.formationName{display:block;max-width:70px;margin:1px -8px 0;padding:1px 4px;border-radius:5px;background:rgba(8,11,18,.86);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:8px;line-height:13px;text-align:center}.formationName b{color:var(--cc)}',
        '.formationTrack{position:relative;height:31px;border-top:1px solid rgba(255,255,255,.05);border-bottom:1px solid rgba(255,255,255,.08);background:#111725}.formationTrackLabel{position:sticky;left:5px;z-index:5;width:max-content;padding:7px;font-size:9px;font-weight:800;color:#b9c5df;pointer-events:none}',
        '.formationMarker{position:absolute;top:2px;z-index:6;height:27px;transform:translateX(-50%);display:flex;align-items:center;gap:3px;padding:0 4px;border:0;background:transparent;color:#e0c16f;cursor:pointer}.formationMarker span{font-size:14px}.formationMarker small{max-width:65px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9faac2;font-size:8px}',
        '@media(max-width:1180px){.toolbar{min-height:244px}.formationEditor{width:58vw;height:226px}.formationButtons button{padding:5px;font-size:8px}}',
        '@media(max-width:900px){.toolbar{min-height:258px}.formationEditor{left:44px;right:8px;width:auto;transform:none;height:240px}.toolbar .transport,.toolbar>.toolGroup{margin-top:42px}.formationButtons button:first-child{display:none}}',
        '',
      ].join('\n')
      replace(cssAnchor, css + cssAnchor, 'css')

      if (!out.includes('className="formationEditor"') || !out.includes('className="formationTrack"') || !out.includes('formations,')) {
        throw new Error('formation editor: build assertions failed')
      }
      return { code: out, map: null }
    },
  }
}
