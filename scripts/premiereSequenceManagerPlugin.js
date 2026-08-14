export function premiereSequenceManagerPlugin() {
  return {
    name: 'premiere-sequence-manager',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const required = (ok, label) => {
        if (!ok) throw new Error(`sequence manager: ${label} anchor not found`)
      }

      // ── sequence + multi-selection state ──
      const selectedState = '  const [selectedBlockId, setSelectedBlockId] = useState(null);'
      required(out.includes(selectedState), 'selected state')
      if (!out.includes('const [sequences, setSequences]')) {
        out = out.replace(selectedState, selectedState + '\n' + [
          '  const [selectedBlockIds, setSelectedBlockIds] = useState([]);',
          '  const [sequences, setSequences] = useState([{ id: "seq-main", name: "Sequence 01", blocks: [], manualDuration: 60, playhead: 0 }]);',
          '  const [activeSequenceId, setActiveSequenceId] = useState("seq-main");',
          '  const [sequenceManagerOpen, setSequenceManagerOpen] = useState(false);',
          '  const [marquee, setMarquee] = useState(null);',
        ].join('\n'))
      }

      const clipboardRefAnchor = '  const clipboardBlockRef = useRef(null);'
      required(out.includes(clipboardRefAnchor), 'clipboard ref')
      if (!out.includes('sequenceClipboardRef')) {
        out = out.replace(clipboardRefAnchor, clipboardRefAnchor + '\n  const sequenceClipboardRef = useRef(null);')
      }

      // Keep legacy single-selection consumers compatible while allowing a multi-selection set.
      const playbackAnchor = '  /* ── 재생 루프 ── */'
      required(out.includes(playbackAnchor), 'playback section')
      if (!out.includes('const materializeSequences =')) {
        const helpers = [
          '  // ───────────── Premiere-style sequences ─────────────',
          '  const cloneJson = (value) => JSON.parse(JSON.stringify(value));',
          '  const materializeSequences = () => sequences.map((seq) =>',
          '    seq.id === activeSequenceId',
          '      ? { ...seq, blocks: cloneJson(blocks), manualDuration, playhead: currentTime }',
          '      : cloneJson(seq)',
          '  );',
          '',
          '  const setBlockSelection = (ids, primary = null) => {',
          '    const clean = [...new Set((ids || []).filter(Boolean))];',
          '    setSelectedBlockIds(clean);',
          '    setSelectedBlockId(primary && clean.includes(primary) ? primary : (clean[0] || null));',
          '  };',
          '',
          '  useEffect(() => {',
          '    if (!selectedBlockId) {',
          '      if (selectedBlockIds.length) setSelectedBlockIds([]);',
          '      return;',
          '    }',
          '    if (!selectedBlockIds.includes(selectedBlockId)) setSelectedBlockIds([selectedBlockId]);',
          '  }, [selectedBlockId]);',
          '',
          '  const sequenceName = (base, list = sequences) => {',
          '    const root = String(base || "Sequence").trim() || "Sequence";',
          '    const names = new Set(list.map((s) => s.name));',
          '    if (!names.has(root)) return root;',
          '    let n = 2;',
          '    while (names.has(`${root} ${n}`)) n++;',
          '    return `${root} ${n}`;',
          '  };',
          '',
          '  const activateSequenceSnapshot = (seq, list) => {',
          '    if (!seq) return;',
          '    pause();',
          '    setSequences(list);',
          '    setActiveSequenceId(seq.id);',
          '    setBlocks(cloneJson(seq.blocks || []));',
          '    if (!videoInfo && !audioInfo && Number(seq.manualDuration) > 0) setManualDuration(Number(seq.manualDuration));',
          '    const nextTime = Math.max(0, Math.min(Number(seq.playhead) || 0, videoInfo?.duration || audioInfo?.duration || Number(seq.manualDuration) || duration));',
          '    setCurrentTime(nextTime);',
          '    const mediaEl = getMediaEl();',
          '    if (mediaEl && Number.isFinite(nextTime)) mediaEl.currentTime = nextTime;',
          '    setBlockSelection([]);',
          '    setSnapGuide(null);',
          '  };',
          '',
          '  const switchSequence = (id) => {',
          '    if (!id || id === activeSequenceId) return;',
          '    const list = materializeSequences();',
          '    const target = list.find((seq) => seq.id === id);',
          '    activateSequenceSnapshot(target, list);',
          '  };',
          '',
          '  const createSequence = () => {',
          '    commitHistory();',
          '    const list = materializeSequences();',
          '    const seq = { id: uid(), name: sequenceName(`Sequence ${String(list.length + 1).padStart(2, "0")}`, list), blocks: [], manualDuration: duration || 60, playhead: 0 };',
          '    activateSequenceSnapshot(seq, [...list, seq]);',
          '    showToast(`＋ ${seq.name} 만들었어요.`);',
          '  };',
          '',
          '  const renameSequence = (id, name) => {',
          '    const value = String(name ?? "").slice(0, 48);',
          '    setSequences((list) => list.map((seq) => seq.id === id ? { ...seq, name: value } : seq));',
          '  };',
          '',
          '  const duplicateSequence = (id = activeSequenceId) => {',
          '    commitHistory();',
          '    const list = materializeSequences();',
          '    const source = list.find((seq) => seq.id === id);',
          '    if (!source) return;',
          '    const duplicated = {',
          '      ...cloneJson(source),',
          '      id: uid(),',
          '      name: sequenceName(`${source.name || "Sequence"} Copy`, list),',
          '      blocks: (source.blocks || []).map((b) => ({ ...cloneJson(b), id: uid() })),',
          '      playhead: 0,',
          '    };',
          '    activateSequenceSnapshot(duplicated, [...list, duplicated]);',
          '    showToast(`⧉ ${duplicated.name} 복제했어요.`);',
          '  };',
          '',
          '  const copySequence = (id = activeSequenceId) => {',
          '    const list = materializeSequences();',
          '    const source = list.find((seq) => seq.id === id);',
          '    if (!source) return;',
          '    sequenceClipboardRef.current = cloneJson(source);',
          '    setSequences(list);',
          '    showToast(`📋 ${source.name} 시퀀스를 복사했어요.`);',
          '  };',
          '',
          '  const pasteSequence = () => {',
          '    const source = sequenceClipboardRef.current;',
          '    if (!source) { showToast("📋 먼저 시퀀스를 복사해 주세요."); return; }',
          '    commitHistory();',
          '    const list = materializeSequences();',
          '    const pasted = {',
          '      ...cloneJson(source),',
          '      id: uid(),',
          '      name: sequenceName(`${source.name || "Sequence"} Copy`, list),',
          '      blocks: (source.blocks || []).map((b) => ({ ...cloneJson(b), id: uid() })),',
          '      playhead: 0,',
          '    };',
          '    activateSequenceSnapshot(pasted, [...list, pasted]);',
          '    showToast(`📌 ${pasted.name} 시퀀스를 붙여넣었어요.`);',
          '  };',
          '',
          '  const deleteSequence = (id) => {',
          '    const list = materializeSequences();',
          '    if (list.length <= 1) { showToast("⚠️ 시퀀스는 최소 1개가 있어야 해요."); return; }',
          '    const source = list.find((seq) => seq.id === id);',
          '    if (!source || !window.confirm(`“${source.name}” 시퀀스를 삭제할까요?`)) return;',
          '    commitHistory();',
          '    const remaining = list.filter((seq) => seq.id !== id);',
          '    if (id === activeSequenceId) activateSequenceSnapshot(remaining[0], remaining);',
          '    else setSequences(remaining);',
          '    showToast("🗑 시퀀스를 삭제했어요.");',
          '  };',
          '',
        ].join('\n')
        out = out.replace(playbackAnchor, helpers + playbackAnchor)
      }

      // ── group drag: selected blocks move together; resize remains single-block ──
      const dragStart = out.indexOf('  const startBlockDrag = (e, block, mode) => {')
      const dragEnd = out.indexOf('  const masterAllOn = () => {', dragStart)
      required(dragStart >= 0 && dragEnd > dragStart, 'block drag region')
      const groupDrag = [
        '  const startBlockDrag = (e, block, mode) => {',
        '    e.stopPropagation();',
        '    e.preventDefault();',
        '',
        '    if ((e.ctrlKey || e.metaKey) && mode === "move") {',
        '      const exists = selectedBlockIds.includes(block.id);',
        '      const next = exists ? selectedBlockIds.filter((id) => id !== block.id) : [...selectedBlockIds, block.id];',
        '      setBlockSelection(next, exists ? next[0] : block.id);',
        '      setPreviewCostumeId(block.costumeId);',
        '      return;',
        '    }',
        '',
        '    let movingIds = mode === "move" && selectedBlockIds.includes(block.id) ? [...selectedBlockIds] : [block.id];',
        '    if (mode !== "move") movingIds = [block.id];',
        '    setBlockSelection(movingIds, block.id);',
        '    setPreviewCostumeId(block.costumeId);',
        '    commitHistory();',
        '',
        '    const group = blocks.filter((b) => movingIds.includes(b.id)).map((b) => ({ id: b.id, start: b.start, dur: b.dur }));',
        '    const originById = new Map(group.map((b) => [b.id, b]));',
        '    const otherSnapPoints = [0, currentTime];',
        '    blocks.forEach((b) => { if (!movingIds.includes(b.id)) otherSnapPoints.push(b.start, b.start + b.dur); });',
        '    dragRef.current = { mode, id: block.id, ids: movingIds, startX: e.clientX, s0: block.start, d0: block.dur, group };',
        '',
        '    const move = (ev) => {',
        '      const d = dragRef.current;',
        '      if (!d) return;',
        '      let dt = (ev.clientX - d.startX) / pps;',
        '      let guideT = null;',
        '',
        '      if (d.mode === "move") {',
        '        const minStart = Math.min(...d.group.map((g) => g.start));',
        '        const maxEnd = Math.max(...d.group.map((g) => g.start + g.dur));',
        '        dt = Math.max(-minStart, Math.min(duration - maxEnd, dt));',
        '        if (ev.shiftKey) {',
        '          const threshold = 8 / pps;',
        '          const clicked = originById.get(d.id);',
        '          const rawStart = clicked.start + dt;',
        '          const rawEnd = rawStart + clicked.dur;',
        '          const snapStart = snapTime(rawStart, otherSnapPoints, threshold);',
        '          const snapEnd = snapTime(rawEnd, otherSnapPoints, threshold);',
        '          const startDelta = snapStart - rawStart;',
        '          const endDelta = snapEnd - rawEnd;',
        '          const correction = Math.abs(startDelta) <= Math.abs(endDelta) ? startDelta : endDelta;',
        '          if (Math.abs(correction) <= threshold) {',
        '            dt = Math.max(-minStart, Math.min(duration - maxEnd, dt + correction));',
        '            guideT = Math.abs(startDelta) <= Math.abs(endDelta) ? snapStart : snapEnd;',
        '          }',
        '        }',
        '        setBlocks((bs) => bs.map((b) => {',
        '          const origin = originById.get(b.id);',
        '          return origin ? { ...b, start: origin.start + dt } : b;',
        '        }));',
        '        setSnapGuide(guideT);',
        '        return;',
        '      }',
        '',
        '      const threshold = 8 / pps;',
        '      setBlocks((bs) => bs.map((b) => {',
        '        if (b.id !== d.id) return b;',
        '        const minDur = b.type === "solid" ? 0.01 : 0.2;',
        '        if (d.mode === "l") {',
        '          let ns = Math.max(0, Math.min(d.s0 + d.d0 - minDur, d.s0 + dt));',
        '          if (ev.shiftKey) { const s = snapTime(ns, otherSnapPoints, threshold); if (s !== ns) guideT = s; ns = Math.max(0, Math.min(d.s0 + d.d0 - minDur, s)); }',
        '          return { ...b, start: ns, dur: d.s0 + d.d0 - ns };',
        '        }',
        '        let nd = Math.max(minDur, Math.min(duration - d.s0, d.d0 + dt));',
        '        if (ev.shiftKey) { const endT = d.s0 + nd; const s = snapTime(endT, otherSnapPoints, threshold); if (s !== endT) guideT = s; nd = Math.max(minDur, Math.min(duration - d.s0, s - d.s0)); }',
        '        return { ...b, dur: nd };',
        '      }));',
        '      setSnapGuide(guideT);',
        '    };',
        '    const up = () => {',
        '      dragRef.current = null;',
        '      setSnapGuide(null);',
        '      window.removeEventListener("mousemove", move);',
        '      window.removeEventListener("mouseup", up);',
        '    };',
        '    window.addEventListener("mousemove", move);',
        '    window.addEventListener("mouseup", up);',
        '  };',
        '',
      ].join('\n')
      out = out.slice(0, dragStart) + groupDrag + out.slice(dragEnd)

      // ── replace single-block clipboard with multi-block clipboard ──
      const selectedRegionStart = out.indexOf('  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;')
      const razorAnchor = '  /** 프리미어의 면도날(Razor) 도구처럼, 블록을 재생 헤드 위치에서 둘로 잘라요 */'
      const selectedRegionEnd = out.indexOf(razorAnchor, selectedRegionStart)
      required(selectedRegionStart >= 0 && selectedRegionEnd > selectedRegionStart, 'selected/clipboard region')
      const multiClipboard = [
        '  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;',
        '  const patchBlock = (patch) => {',
        '    if (!selectedBlockId) return;',
        '    commitHistory(`patch:${selectedBlockId}`);',
        '    setBlocks((bs) => bs.map((b) => (b.id === selectedBlockId ? { ...b, ...patch } : b)));',
        '  };',
        '  const deleteBlock = () => {',
        '    const ids = selectedBlockIds.length ? selectedBlockIds : (selectedBlockId ? [selectedBlockId] : []);',
        '    if (!ids.length) return;',
        '    commitHistory();',
        '    const set = new Set(ids);',
        '    setBlocks((bs) => bs.filter((b) => !set.has(b.id)));',
        '    setBlockSelection([]);',
        '    showToast(`🗑 블록 ${ids.length}개를 삭제했어요.`);',
        '  };',
        '',
        '  const copySelectedBlock = () => {',
        '    const ids = selectedBlockIds.length ? selectedBlockIds : (selectedBlockId ? [selectedBlockId] : []);',
        '    const picked = blocks.filter((b) => ids.includes(b.id));',
        '    if (!picked.length) { showToast("📋 복사할 블록을 먼저 선택해 주세요."); return; }',
        '    const baseStart = Math.min(...picked.map((b) => b.start));',
        '    clipboardBlockRef.current = { blocks: cloneJson(picked), baseStart };',
        '    showToast(`📋 블록 ${picked.length}개 복사됨 · 재생헤드에서 Ctrl+V`);',
        '  };',
        '',
        '  const pasteCopiedBlock = () => {',
        '    const copied = clipboardBlockRef.current;',
        '    if (!copied?.blocks?.length) { showToast("📋 먼저 블록을 Ctrl+C로 복사해 주세요."); return; }',
        '    const base = Number(copied.baseStart) || 0;',
        '    const pasted = copied.blocks.map((source) => {',
        '      const start = Math.max(0, currentTime + (source.start - base));',
        '      const room = duration - start;',
        '      if (room <= 0.001) return null;',
        '      return { ...cloneJson(source), id: uid(), start, dur: Math.max(source.type === "solid" ? 0.01 : 0.2, Math.min(source.dur, room)) };',
        '    }).filter(Boolean);',
        '    if (!pasted.length) { showToast("⚠️ 현재 위치에는 붙여넣을 공간이 없어요."); return; }',
        '    commitHistory();',
        '    setBlocks((bs) => [...bs, ...pasted]);',
        '    setBlockSelection(pasted.map((b) => b.id), pasted[0].id);',
        '    setPreviewCostumeId(pasted[0].costumeId);',
        '    showToast(`📌 블록 ${pasted.length}개를 ${fmtTime(currentTime)}부터 붙여넣었어요.`);',
        '  };',
        '',
        '  useEffect(() => {',
        '    const onClipboardKey = (e) => {',
        '      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);',
        '      if (typing || !(e.ctrlKey || e.metaKey) || e.altKey) return;',
        '      const key = e.key.toLowerCase();',
        '      if (key === "c") { e.preventDefault(); copySelectedBlock(); }',
        '      else if (key === "v") { e.preventDefault(); pasteCopiedBlock(); }',
        '      else if (key === "a") { e.preventDefault(); setBlockSelection(blocks.map((b) => b.id), blocks[0]?.id || null); }',
        '    };',
        '    window.addEventListener("keydown", onClipboardKey);',
        '    return () => window.removeEventListener("keydown", onClipboardKey);',
        '  }, [selectedBlockId, selectedBlockIds, blocks, currentTime, duration]);',
        '',
      ].join('\n')
      out = out.slice(0, selectedRegionStart) + multiClipboard + out.slice(selectedRegionEnd)

      // Delete/Backspace should work for a marquee selection too.
      out = out.replace(
        '&& selectedBlockId && !typing) {\n        deleteBlock();',
        '&& selectedBlockIds.length > 0 && !typing) {\n        deleteBlock();'
      )

      // ── marquee selection on blank timeline; Alt+drag preserves the old pan behavior ──
      const panStart = out.indexOf('  const startTimelinePan = (e) => {')
      const panEnd = out.indexOf('  const previewCostume =', panStart)
      required(panStart >= 0 && panEnd > panStart, 'timeline pan region')
      const marqueeHandler = [
        '  const startTimelinePan = (e) => {',
        '    if (e.button !== 0) return;',
        '    if (e.target.closest(".block, .handle, input, button, .ruler, .waveRow, .groupRow, .trackLabel")) return;',
        '    const scrollEl = timelineScrollRef.current;',
        '    const contentEl = contentRef.current;',
        '    if (!scrollEl || !contentEl) return;',
        '',
        '    if (e.altKey) {',
        '      const startX = e.clientX;',
        '      const startScroll = scrollEl.scrollLeft;',
        '      const movePan = (ev) => { ev.preventDefault(); scrollEl.classList.add("panning"); scrollEl.scrollLeft = startScroll - (ev.clientX - startX); };',
        '      const upPan = () => { scrollEl.classList.remove("panning"); window.removeEventListener("mousemove", movePan); window.removeEventListener("mouseup", upPan); };',
        '      window.addEventListener("mousemove", movePan);',
        '      window.addEventListener("mouseup", upPan);',
        '      return;',
        '    }',
        '',
        '    e.preventDefault();',
        '    const contentRect = contentEl.getBoundingClientRect();',
        '    const startClientX = e.clientX;',
        '    const startClientY = e.clientY;',
        '    const startX = startClientX - contentRect.left;',
        '    const startY = startClientY - contentRect.top;',
        '    const additive = e.shiftKey || e.ctrlKey || e.metaKey;',
        '    const baseIds = additive ? [...selectedBlockIds] : [];',
        '    let moved = false;',
        '',
        '    const move = (ev) => {',
        '      if (!moved && Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) < 3) return;',
        '      moved = true;',
        '      const nowRect = contentEl.getBoundingClientRect();',
        '      const x2 = ev.clientX - nowRect.left;',
        '      const y2 = ev.clientY - nowRect.top;',
        '      const left = Math.min(startX, x2);',
        '      const top = Math.min(startY, y2);',
        '      const width = Math.abs(x2 - startX);',
        '      const height = Math.abs(y2 - startY);',
        '      setMarquee({ left, top, width, height });',
        '',
        '      const selClient = { left: Math.min(startClientX, ev.clientX), right: Math.max(startClientX, ev.clientX), top: Math.min(startClientY, ev.clientY), bottom: Math.max(startClientY, ev.clientY) };',
        '      const hits = [];',
        '      contentEl.querySelectorAll(".block[data-block-id]").forEach((el) => {',
        '        const r = el.getBoundingClientRect();',
        '        if (r.right >= selClient.left && r.left <= selClient.right && r.bottom >= selClient.top && r.top <= selClient.bottom) hits.push(el.dataset.blockId);',
        '      });',
        '      const ids = [...new Set([...baseIds, ...hits])];',
        '      setBlockSelection(ids, ids[0] || null);',
        '    };',
        '    const up = () => {',
        '      if (!moved && !additive) setBlockSelection([]);',
        '      setMarquee(null);',
        '      window.removeEventListener("mousemove", move);',
        '      window.removeEventListener("mouseup", up);',
        '    };',
        '    window.addEventListener("mousemove", move);',
        '    window.addEventListener("mouseup", up);',
        '  };',
        '',
      ].join('\n')
      out = out.slice(0, panStart) + marqueeHandler + out.slice(panEnd)

      // Render multi-selected blocks and expose DOM ids for marquee hit-testing.
      out = out.replace(
        'className={`block ${selectedBlockId === b.id ? "sel" : ""}`}',
        'data-block-id={b.id}\n                          className={`block ${selectedBlockIds.includes(b.id) ? "sel" : ""}`}'
      )

      const playheadAnchor = '              <div className="playhead" style={{ left: currentTime * pps }}>'
      required(out.includes(playheadAnchor), 'playhead render')
      if (!out.includes('className="marqueeSelect"')) {
        out = out.replace(playheadAnchor,
          '              {marquee && <div className="marqueeSelect" style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }} />}\n' + playheadAnchor)
      }

      // ── sequence tabs/dock above the timeline ──
      const timelineAnchor = '          <div\n            className="timelineScroll"'
      required(out.includes(timelineAnchor), 'timeline dock')
      if (!out.includes('className="sequenceDock"')) {
        const dock = [
          '          <div className="sequenceDock">',
          '            <button type="button" className={`sequenceManagerToggle ${sequenceManagerOpen ? "on" : ""}`} onClick={() => setSequenceManagerOpen((v) => !v)}>▤ SEQUENCES</button>',
          '            <div className="sequenceTabs">',
          '              {sequences.map((seq) => (',
          '                <button type="button" key={seq.id} className={`sequenceTab ${seq.id === activeSequenceId ? "on" : ""}`} onClick={() => switchSequence(seq.id)}>',
          '                  <span>{seq.name || "Untitled Sequence"}</span>',
          '                  <small>{seq.id === activeSequenceId ? blocks.length : (seq.blocks?.length || 0)} blocks</small>',
          '                </button>',
          '              ))}',
          '            </div>',
          '            <button type="button" className="sequenceAction primary" onClick={createSequence}>＋</button>',
          '            <button type="button" className="sequenceAction" onClick={() => copySequence()}>복사</button>',
          '            <button type="button" className="sequenceAction" onClick={pasteSequence}>붙여넣기</button>',
          '          </div>',
          '          {sequenceManagerOpen && (',
          '            <section className="sequenceManagerPanel">',
          '              <div className="sequenceManagerHead"><b>시퀀스 관리</b><span>각 시퀀스는 블록 타임라인이 서로 독립적입니다.</span></div>',
          '              <div className="sequenceManagerList">',
          '                {sequences.map((seq, index) => (',
          '                  <div key={seq.id} className={`sequenceManagerRow ${seq.id === activeSequenceId ? "on" : ""}`}>',
          '                    <button type="button" className="sequenceIndex" onClick={() => switchSequence(seq.id)}>{String(index + 1).padStart(2, "0")}</button>',
          '                    <input value={seq.name} onChange={(e) => renameSequence(seq.id, e.target.value)} onFocus={() => { if (seq.id !== activeSequenceId) switchSequence(seq.id); }} />',
          '                    <span className="sequenceMeta">{seq.id === activeSequenceId ? blocks.length : (seq.blocks?.length || 0)} blocks</span>',
          '                    <button type="button" onClick={() => copySequence(seq.id)}>복사</button>',
          '                    <button type="button" onClick={() => duplicateSequence(seq.id)}>복제</button>',
          '                    <button type="button" className="danger" onClick={() => deleteSequence(seq.id)}>삭제</button>',
          '                  </div>',
          '                ))}',
          '              </div>',
          '            </section>',
          '          )}',
          '',
          timelineAnchor,
        ].join('\n')
        out = out.replace(timelineAnchor, dock)
      }

      // Update timeline help text: normal drag selects, Alt+drag pans.
      out = out.replaceAll(
        '드래그 또는 마우스 휠로 좌우 이동',
        '빈 공간 드래그=다중 선택 · ALT+드래그/마우스 휠=좌우 이동'
      )

      // ── local JSON save/load: sequences are additive, old projects migrate to Sequence 01 ──
      const saveStart = out.indexOf('  const saveProject = () => {')
      const loadStart = out.indexOf('  const loadProject = async (file) => {', saveStart)
      const exportStart = out.indexOf('  const arduinoExportTargets', loadStart)
      required(saveStart >= 0 && loadStart > saveStart && exportStart > loadStart, 'project save/load region')
      const saveRegion = out.slice(saveStart, loadStart)
      if (!saveRegion.includes('sequences: materializeSequences()')) {
        required(saveRegion.includes('      blocks,'), 'local blocks save')
        const nextSave = saveRegion.replace('      blocks,', '      blocks,\n      sequences: materializeSequences(),\n      activeSequenceId,')
        out = out.slice(0, saveStart) + nextSave + out.slice(loadStart)
      }

      // Re-resolve indexes after save mutation.
      const loadStart2 = out.indexOf('  const loadProject = async (file) => {')
      const exportStart2 = out.indexOf('  const arduinoExportTargets', loadStart2)
      let loadRegion = out.slice(loadStart2, exportStart2)
      if (!loadRegion.includes('restoredSequences')) {
        required(loadRegion.includes('      setBlocks(data.blocks || []);'), 'local blocks load')
        loadRegion = loadRegion.replace(
          '      setBlocks(data.blocks || []);',
          [
            '      if (Array.isArray(data.sequences) && data.sequences.length) {',
            '        const restoredSequences = data.sequences.map((seq, index) => ({',
            '          id: seq.id || uid(),',
            '          name: seq.name || `Sequence ${String(index + 1).padStart(2, "0")}`,',
            '          blocks: Array.isArray(seq.blocks) ? seq.blocks : [],',
            '          manualDuration: Number(seq.manualDuration || seq.duration || data.duration || 60),',
            '          playhead: Number(seq.playhead) || 0,',
            '        }));',
            '        const restoredActiveId = restoredSequences.some((seq) => seq.id === data.activeSequenceId) ? data.activeSequenceId : restoredSequences[0].id;',
            '        const restoredActive = restoredSequences.find((seq) => seq.id === restoredActiveId) || restoredSequences[0];',
            '        setSequences(restoredSequences);',
            '        setActiveSequenceId(restoredActiveId);',
            '        setBlocks(restoredActive.blocks || []);',
            '        if (!audioInfo && !videoInfo && restoredActive.manualDuration > 0) setManualDuration(restoredActive.manualDuration);',
            '      } else {',
            '        const legacyBlocks = data.blocks || [];',
            '        const legacy = { id: "seq-main", name: "Sequence 01", blocks: legacyBlocks, manualDuration: Number(data.duration || 60), playhead: 0 };',
            '        setSequences([legacy]);',
            '        setActiveSequenceId(legacy.id);',
            '        setBlocks(legacyBlocks);',
            '      }',
          ].join('\n')
        )
        loadRegion = loadRegion.replace('      setSelectedBlockId(null);', '      setSelectedBlockId(null);\n      setSelectedBlockIds([]);')
        loadRegion = loadRegion.replace(
          '      if (!audioInfo && data.duration) setManualDuration(data.duration);',
          '      if (!audioInfo && !videoInfo && data.duration && !(Array.isArray(data.sequences) && data.sequences.length)) setManualDuration(data.duration);'
        )
        out = out.slice(0, loadStart2) + loadRegion + out.slice(exportStart2)
      }

      // ── cloud save/load also persists all sequences, while top-level blocks stays the active sequence for MANAGEMENT ──
      const cloudBuildStart = out.indexOf('  const buildCloudProjectData = () => ({')
      if (cloudBuildStart >= 0) {
        const cloudBuildEnd = out.indexOf('  });', cloudBuildStart)
        let cloudBuild = out.slice(cloudBuildStart, cloudBuildEnd + 5)
        if (!cloudBuild.includes('sequences: materializeSequences()')) {
          required(cloudBuild.includes('    blocks,'), 'cloud blocks save')
          cloudBuild = cloudBuild.replace('    blocks,', '    blocks,\n    sequences: materializeSequences(),\n    activeSequenceId,')
          out = out.slice(0, cloudBuildStart) + cloudBuild + out.slice(cloudBuildEnd + 5)
        }
      }

      const cloudApplyStart = out.indexOf('  const applyCloudProjectData = (data) => {')
      const cloudApplyEnd = out.indexOf('  const loadCloudForSession =', cloudApplyStart)
      if (cloudApplyStart >= 0 && cloudApplyEnd > cloudApplyStart) {
        let cloudApply = out.slice(cloudApplyStart, cloudApplyEnd)
        if (!cloudApply.includes('cloudRestoredSequences')) {
          required(cloudApply.includes('    if (Array.isArray(data.blocks)) setBlocks(data.blocks);'), 'cloud blocks load')
          cloudApply = cloudApply.replace(
            '    if (Array.isArray(data.blocks)) setBlocks(data.blocks);',
            [
              '    let sequenceDuration = null;',
              '    if (Array.isArray(data.sequences) && data.sequences.length) {',
              '      const cloudRestoredSequences = data.sequences.map((seq, index) => ({',
              '        id: seq.id || uid(),',
              '        name: seq.name || `Sequence ${String(index + 1).padStart(2, "0")}`,',
              '        blocks: Array.isArray(seq.blocks) ? seq.blocks : [],',
              '        manualDuration: Number(seq.manualDuration || seq.duration || data.duration || 60),',
              '        playhead: Number(seq.playhead) || 0,',
              '      }));',
              '      const cloudActiveId = cloudRestoredSequences.some((seq) => seq.id === data.activeSequenceId) ? data.activeSequenceId : cloudRestoredSequences[0].id;',
              '      const cloudActive = cloudRestoredSequences.find((seq) => seq.id === cloudActiveId) || cloudRestoredSequences[0];',
              '      setSequences(cloudRestoredSequences);',
              '      setActiveSequenceId(cloudActiveId);',
              '      setBlocks(cloudActive.blocks || []);',
              '      sequenceDuration = cloudActive.manualDuration;',
              '    } else {',
              '      const legacyBlocks = Array.isArray(data.blocks) ? data.blocks : [];',
              '      const legacy = { id: "seq-main", name: "Sequence 01", blocks: legacyBlocks, manualDuration: Number(data.duration || data.manualDuration || 60), playhead: 0 };',
              '      setSequences([legacy]);',
              '      setActiveSequenceId(legacy.id);',
              '      setBlocks(legacyBlocks);',
              '      sequenceDuration = legacy.manualDuration;',
              '    }',
            ].join('\n')
          )
          cloudApply = cloudApply.replace(
            '    const restoredDuration = Number(data.duration || data.manualDuration);',
            '    const restoredDuration = Number(sequenceDuration || data.duration || data.manualDuration);'
          )
          cloudApply = cloudApply.replace('    setSelectedBlockId(null);', '    setSelectedBlockId(null);\n    setSelectedBlockIds([]);')
          out = out.slice(0, cloudApplyStart) + cloudApply + out.slice(cloudApplyEnd)
        }
      }

      out = out.replaceAll(
        '[costumes, blocks, customPresets, manualDuration, cloudAudioMeta, cloudMediaMeta, cloudSession, cloudReady]',
        '[costumes, blocks, sequences, activeSequenceId, customPresets, manualDuration, cloudAudioMeta, cloudMediaMeta, cloudSession, cloudReady]'
      )
      out = out.replaceAll(
        '[costumes, blocks, customPresets, manualDuration, cloudAudioMeta, cloudSession, cloudReady]',
        '[costumes, blocks, sequences, activeSequenceId, customPresets, manualDuration, cloudAudioMeta, cloudSession, cloudReady]'
      )
      out = out.replaceAll(
        '[costumes, blocks, customPresets, manualDuration, cloudSession, cloudReady]',
        '[costumes, blocks, sequences, activeSequenceId, customPresets, manualDuration, cloudSession, cloudReady]'
      )

      // ── CSS ──
      const styleAnchor = '      <style>{CSS}</style>'
      required(out.includes(styleAnchor), 'style root')
      if (!out.includes('.sequenceDock {')) {
        const style = [
          styleAnchor,
          '      <style>{`',
          '.sequenceDock { flex:0 0 auto; min-height:42px; display:flex; align-items:stretch; gap:6px; padding:5px 8px; background:#11151c; border-top:1px solid #262d38; border-bottom:1px solid #2a3340; overflow:hidden; }',
          '.sequenceManagerToggle,.sequenceAction { border:1px solid #384454; background:#1b222c; color:#cdd7e5; border-radius:5px; padding:0 9px; font-size:10.5px; font-weight:800; cursor:pointer; white-space:nowrap; }',
          '.sequenceManagerToggle.on,.sequenceAction.primary { border-color:#627dff; color:#fff; background:#26345e; }',
          '.sequenceTabs { display:flex; align-items:stretch; gap:3px; overflow:auto; flex:1; min-width:0; }',
          '.sequenceTab { min-width:120px; max-width:210px; display:flex; flex-direction:column; justify-content:center; align-items:flex-start; gap:1px; border:1px solid #303946; border-radius:5px; background:#181e26; color:#aeb9c8; padding:4px 9px; cursor:pointer; overflow:hidden; }',
          '.sequenceTab span { width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; font-weight:800; text-align:left; }',
          '.sequenceTab small { color:#657185; font-size:9px; }',
          '.sequenceTab.on { border-color:#6d82ff; background:#222d48; color:#fff; box-shadow:inset 0 -2px #6d82ff; }',
          '.sequenceManagerPanel { flex:0 0 auto; padding:8px; background:#0f1319; border-bottom:1px solid #2c3541; }',
          '.sequenceManagerHead { display:flex; align-items:baseline; gap:10px; margin-bottom:7px; color:#e8eef8; font-size:12px; }',
          '.sequenceManagerHead span { color:#748195; font-size:10px; }',
          '.sequenceManagerList { display:grid; gap:4px; max-height:190px; overflow:auto; }',
          '.sequenceManagerRow { display:grid; grid-template-columns:34px minmax(140px,1fr) 80px auto auto auto; gap:5px; align-items:center; padding:4px; border:1px solid #252d38; border-radius:5px; background:#151a21; }',
          '.sequenceManagerRow.on { border-color:#5369c9; background:#192137; }',
          '.sequenceManagerRow input { min-width:0; height:27px; border:1px solid #303a48; border-radius:4px; background:#0e1218; color:#e4ebf5; padding:0 7px; }',
          '.sequenceManagerRow button { height:27px; border:1px solid #344050; border-radius:4px; background:#1d2530; color:#c8d1dd; font-size:10px; cursor:pointer; }',
          '.sequenceManagerRow button.danger { color:#ff929d; border-color:#623741; }',
          '.sequenceIndex { font-family:monospace; font-weight:900; }',
          '.sequenceMeta { color:#738095; font-size:9.5px; text-align:right; }',
          '.marqueeSelect { position:absolute; z-index:70; pointer-events:none; border:1px solid #7f9cff; background:rgba(93,126,255,.14); box-shadow:0 0 0 1px rgba(0,0,0,.25) inset; }',
          '.block.sel { outline:2px solid #d9e2ff !important; outline-offset:1px; filter:brightness(1.15); }',
          '`}</style>',
        ].join('\n')
        out = out.replace(styleAnchor, style)
      }

      if (!out.includes('materializeSequences') || !out.includes('marqueeSelect') || !out.includes('sequenceDock') || !out.includes('selectedBlockIds.includes(b.id)')) {
        throw new Error('sequence manager: build assertions failed')
      }

      return { code: out, map: null }
    },
  }
}
