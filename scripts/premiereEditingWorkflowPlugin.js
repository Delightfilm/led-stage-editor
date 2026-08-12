export function premiereEditingWorkflowPlugin() {
  return {
    name: 'premiere-editing-workflow',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const replaceStrict = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`editing workflow: ${label} anchor not found`)
        out = out.replace(from, to)
      }

      // Independent workspace sizing controls.
      replaceStrict(
        '  const [pps, setPps] = useState(40);',
        [
          '  const [pps, setPps] = useState(40);',
          '  const [programHeight, setProgramHeight] = useState(280);',
          '  const [waveHeight, setWaveHeight] = useState(72);',
          '  const [trackHeight, setTrackHeight] = useState(34);',
        ].join('\n'),
        'workspace size state'
      )

      replaceStrict(
        '  const dragRef = useRef(null);',
        '  const dragRef = useRef(null);\n  const clipboardBlockRef = useRef(null);',
        'clipboard ref'
      )

      // Best-effort waveform extraction from the audio track inside video files.
      // Chrome can decode the common MP4/AAC and WebM audio combinations used for editing.
      replaceStrict(
        '      if (!Number.isFinite(d) || d <= 0) throw new Error("duration");\n      setAudioInfo(null);',
        [
          '      if (!Number.isFinite(d) || d <= 0) throw new Error("duration");',
          '      let videoPeaks = null;',
          '      let waveformCtx = null;',
          '      try {',
          '        const mediaBuffer = await file.arrayBuffer();',
          '        waveformCtx = new (window.AudioContext || window.webkitAudioContext)();',
          '        const decodedAudio = await waveformCtx.decodeAudioData(mediaBuffer);',
          '        const channel = decodedAudio.getChannelData(0);',
          '        const N = 1600;',
          '        const step = Math.max(1, Math.floor(channel.length / N));',
          '        const peaks = new Array(N);',
          '        for (let i = 0; i < N; i++) {',
          '          let max = 0;',
          '          const base = i * step;',
          '          for (let j = 0; j < step; j += 16) {',
          '            const v = Math.abs(channel[base + j] || 0);',
          '            if (v > max) max = v;',
          '          }',
          '          peaks[i] = max;',
          '        }',
          '        videoPeaks = peaks;',
          '      } catch (waveErr) {',
          '        videoPeaks = null;',
          '      } finally {',
          '        if (waveformCtx) { try { await waveformCtx.close(); } catch {} }',
          '      }',
          '      setAudioInfo(videoPeaks ? { name: file.name, duration: d, peaks: videoPeaks, fromVideo: true } : null);',
        ].join('\n'),
        'video waveform extraction'
      )

      replaceStrict(
        '    const W = timelineW, H = 56;',
        '    const W = timelineW, H = waveHeight;',
        'waveform height drawing'
      )
      replaceStrict(
        '  }, [audioInfo, videoInfo, timelineW]);',
        '  }, [audioInfo, videoInfo, timelineW, waveHeight]);',
        'waveform redraw dependency'
      )

      // Premiere-style zoom: keep the red playhead at the same screen X while zooming.
      const oldZoom = [
        '  const zoomOut = () => setPps((p) => Math.max(8, Math.round(p / 1.5)));',
        '  const zoomIn = () => setPps((p) => Math.min(2400, Math.round(p * 1.5)));',
      ].join('\n')
      const newZoom = [
        '  const zoomToPps = (valueOrUpdater) => {',
        '    setPps((prev) => {',
        '      const requested = typeof valueOrUpdater === "function" ? valueOrUpdater(prev) : valueOrUpdater;',
        '      const next = Math.max(8, Math.min(2400, Math.round(Number(requested) || prev)));',
        '      if (next === prev) return prev;',
        '      const el = timelineScrollRef.current;',
        '      const playheadViewportX = el ? (currentTime * prev - el.scrollLeft) : 0;',
        '      requestAnimationFrame(() => {',
        '        const scrollEl = timelineScrollRef.current;',
        '        if (!scrollEl) return;',
        '        scrollEl.scrollLeft = Math.max(0, currentTime * next - playheadViewportX);',
        '      });',
        '      return next;',
        '    });',
        '  };',
        '  const zoomOut = () => zoomToPps((p) => p / 1.5);',
        '  const zoomIn = () => zoomToPps((p) => p * 1.5);',
      ].join('\n')
      replaceStrict(oldZoom, newZoom, 'playhead anchored zoom')
      replaceStrict(
        '                onChange={(e) => setPps(+e.target.value)}',
        '                onChange={(e) => zoomToPps(+e.target.value)}',
        'zoom slider anchor'
      )

      // Internal block clipboard. Ctrl+C copies the selected block. Ctrl+V pastes it at
      // the red playhead onto the currently selected costume, matching the source part name.
      const clipboardInsertAnchor = '  /** 프리미어의 면도날(Razor) 도구처럼, 블록을 재생 헤드 위치에서 둘로 잘라요 */'
      const clipboardHelpers = [
        '  const copySelectedBlock = () => {',
        '    const source = blocks.find((b) => b.id === selectedBlockId);',
        '    if (!source) { showToast("📋 복사할 블록을 먼저 선택해 주세요."); return; }',
        '    const sourceCostume = costumes.find((c) => c.id === source.costumeId);',
        '    const sourcePart = sourceCostume?.parts?.find((p) => p.id === source.partId);',
        '    clipboardBlockRef.current = { block: JSON.parse(JSON.stringify(source)), partName: sourcePart?.name || null };',
        '    showToast("📋 블록 복사됨 · 붙여넣을 의상을 선택하고 Ctrl+V");',
        '  };',
        '',
        '  const pasteCopiedBlock = () => {',
        '    const copied = clipboardBlockRef.current;',
        '    if (!copied?.block) { showToast("📋 먼저 블록을 Ctrl+C로 복사해 주세요."); return; }',
        '    const targetCostume = costumes.find((c) => c.id === previewCostumeId);',
        '    if (!targetCostume) { showToast("👗 붙여넣을 의상을 먼저 선택해 주세요."); return; }',
        '    const targetPart = targetCostume.parts.find((p) => copied.partName && p.name === copied.partName) || targetCostume.parts[0];',
        '    if (!targetPart) { showToast("⚠️ 선택한 의상에 붙여넣을 파츠가 없어요."); return; }',
        '    const start = Math.max(0, Math.min(duration, currentTime));',
        '    const room = duration - start;',
        '    if (room <= 0.001) { showToast("⚠️ 타임라인 마지막 프레임에는 붙여넣을 수 없어요."); return; }',
        '    const newBlock = {',
        '      ...JSON.parse(JSON.stringify(copied.block)),',
        '      id: uid(),',
        '      costumeId: targetCostume.id,',
        '      partId: targetPart.id,',
        '      start,',
        '      dur: Math.max(0.02, Math.min(copied.block.dur, room)),',
        '    };',
        '    commitHistory();',
        '    setBlocks((bs) => [...bs, newBlock]);',
        '    setSelectedBlockId(newBlock.id);',
        '    setPreviewCostumeId(targetCostume.id);',
        '    showToast(`📌 ${targetCostume.name} · 재생헤드 ${fmtTime(start)}에 붙여넣었어요.`);',
        '  };',
        '',
        '  useEffect(() => {',
        '    const onClipboardKey = (e) => {',
        '      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);',
        '      if (typing || !(e.ctrlKey || e.metaKey) || e.altKey) return;',
        '      const key = e.key.toLowerCase();',
        '      if (key === "c") { e.preventDefault(); copySelectedBlock(); }',
        '      else if (key === "v") { e.preventDefault(); pasteCopiedBlock(); }',
        '    };',
        '    window.addEventListener("keydown", onClipboardKey);',
        '    return () => window.removeEventListener("keydown", onClipboardKey);',
        '  }, [selectedBlockId, blocks, costumes, previewCostumeId, currentTime, duration]);',
        '',
      ].join('\n')
      replaceStrict(clipboardInsertAnchor, clipboardHelpers + clipboardInsertAnchor, 'clipboard helpers')

      // Resize video monitor, audio waveform, and timeline track height independently.
      const viewportOld = '<div className="programViewport" style={{ aspectRatio: videoInfo?.width && videoInfo?.height ? (videoInfo.width + " / " + videoInfo.height) : "16 / 9", maxWidth: videoInfo?.width && videoInfo?.height ? ((videoInfo.width / videoInfo.height) * 38) + "vh" : "67.56vh" }}>'
      const viewportNew = '<div className="programViewport workspaceSized" style={{ "--programH": programHeight + "px", aspectRatio: videoInfo?.width && videoInfo?.height ? (videoInfo.width + " / " + videoInfo.height) : "16 / 9", maxWidth: "100%" }}>'
      replaceStrict(viewportOld, viewportNew, 'program viewport sizing')

      replaceStrict(
        '<div className="waveRow scrubSurface" onMouseDown={startPlayheadScrub}>',
        '<div className="waveRow scrubSurface" style={{ height: waveHeight }} onMouseDown={startPlayheadScrub}>',
        'waveform row sizing'
      )

      replaceStrict('  const TRACK_H = 34;', '  const TRACK_H = trackHeight;', 'track height')

      replaceStrict(
        '          <div className="timelineFooter">',
        [
          '          <div className="timelineFooter">',
          '            <div className="workspaceSizes" title="작업 영역 크기">',
          '              <label>🎬 <input type="range" min={120} max={600} step={10} value={programHeight} onChange={(e) => setProgramHeight(+e.target.value)} /><span>{programHeight}px</span></label>',
          '              <label>〰 <input type="range" min={32} max={180} step={4} value={waveHeight} onChange={(e) => setWaveHeight(+e.target.value)} /><span>{waveHeight}px</span></label>',
          '              <label>▤ <input type="range" min={24} max={80} step={2} value={trackHeight} onChange={(e) => setTrackHeight(+e.target.value)} /><span>{trackHeight}px</span></label>',
          '            </div>',
        ].join('\n'),
        'workspace size controls'
      )

      const cssAnchor = '.timelineScroll.panning { cursor: grabbing; user-select: none; }'
      replaceStrict(
        cssAnchor,
        cssAnchor + '\n' + [
          '.programViewport.workspaceSized { height:var(--programH) !important; max-height:none !important; width:100%; }',
          '.waveRow canvas { height:100% !important; }',
          '.workspaceSizes { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:2px 4px; }',
          '.workspaceSizes label { display:flex; align-items:center; gap:4px; color:var(--dim); font-size:10.5px; white-space:nowrap; }',
          '.workspaceSizes input[type="range"] { width:70px; accent-color:var(--accent); }',
          '.workspaceSizes span { min-width:38px; text-align:right; font-family:monospace; font-size:10px; }',
        ].join('\n'),
        'workspace sizing css'
      )

      if (!out.includes('zoomToPps') || !out.includes('clipboardBlockRef') || !out.includes('workspaceSizes')) {
        throw new Error('editing workflow: build assertions failed')
      }

      return { code: out, map: null }
    },
  }
}
