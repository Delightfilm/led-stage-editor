export function premiereProjectWorkspacePlugin() {
  return {
    name: 'premiere-project-workspace',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const required = (ok, label) => {
        if (!ok) throw new Error(`project workspace: ${label} anchor not found`)
      }
      const replaceOnce = (from, to, label) => {
        required(out.includes(from), label)
        out = out.replace(from, to)
      }

      // PROJECT bin + per-sequence media state.
      const stateAnchor = '  const [marquee, setMarquee] = useState(null);'
      if (!out.includes('const [projectAssets, setProjectAssets]')) {
        replaceOnce(stateAnchor, stateAnchor + '\n' + [
          '  const [projectPanelOpen, setProjectPanelOpen] = useState(true);',
          '  const [projectAssets, setProjectAssets] = useState([]);',
          '  const [mediaClips, setMediaClips] = useState([]);',
          '  const [loadedProjectAssetId, setLoadedProjectAssetId] = useState(null);',
        ].join('\n'), 'sequence state')
      }

      const refAnchor = '  const sequenceClipboardRef = useRef(null);'
      if (!out.includes('projectAssetRuntimeRef')) {
        replaceOnce(refAnchor, refAnchor + '\n' + [
          '  const projectAssetRuntimeRef = useRef(new Map());',
          '  const sequenceClockRef = useRef({ at: 0, time: 0 });',
        ].join('\n'), 'sequence refs')
      }

      // Sequence duration is authoritative. Footage duration no longer owns the timeline length.
      out = out.replace(
        '  const duration = videoInfo ? videoInfo.duration : (audioInfo ? audioInfo.duration : manualDuration);',
        '  const duration = Math.max(1, Number(manualDuration) || 60);'
      )
      required(out.includes('const duration = Math.max(1, Number(manualDuration) || 60);'), 'independent sequence duration')

      const sequenceHelperAnchor = '  // ───────────── Premiere-style sequences ─────────────'
      if (!out.includes('const rememberProjectAsset =')) {
        required(out.includes(sequenceHelperAnchor), 'sequence helper')
        const helpers = [
          '  // ───────────── PROJECT / footage bin ─────────────',
          '  const rememberProjectAsset = (file, kind, sourceDuration) => {',
          '    if (!file) return null;',
          '    const signature = `${kind}:${file.name}:${Number(file.size) || 0}:${Number(file.lastModified) || 0}`;',
          '    const existing = projectAssets.find((asset) => asset.signature === signature);',
          '    const assetId = existing?.id || uid();',
          '    const asset = {',
          '      id: assetId, signature, kind, name: file.name || (kind === "video" ? "Video" : "Audio"),',
          '      duration: Math.max(0, Number(sourceDuration) || 0), type: file.type || "",',
          '      size: Number(file.size) || 0, lastModified: Number(file.lastModified) || 0,',
          '    };',
          '    projectAssetRuntimeRef.current.set(assetId, file);',
          '    setProjectAssets((prev) => {',
          '      const index = prev.findIndex((item) => item.id === assetId || item.signature === signature);',
          '      if (index < 0) return [...prev, asset];',
          '      const next = [...prev]; next[index] = { ...next[index], ...asset }; return next;',
          '    });',
          '    setLoadedProjectAssetId(assetId);',
          '    return assetId;',
          '  };',
          '',
          '  const attachAssetToSequence = (assetId, kind, sourceDuration, name) => {',
          '    if (!assetId) return;',
          '    setMediaClips([{',
          '      id: uid(), assetId, kind, name: name || (kind === "video" ? "Video" : "Audio"),',
          '      start: 0, in: 0, duration: Math.max(0.01, Number(sourceDuration) || 0.01),',
          '      sourceDuration: Math.max(0.01, Number(sourceDuration) || 0.01),',
          '    }]);',
          '  };',
          '',
          '  const loadProjectAsset = async (assetId) => {',
          '    const asset = projectAssets.find((item) => item.id === assetId);',
          '    const file = projectAssetRuntimeRef.current.get(assetId);',
          '    if (!asset || !file) {',
          '      showToast("📁 이 푸티지의 원본 파일을 다시 불러와 주세요. 프로젝트 메타데이터는 유지됩니다.");',
          '      return;',
          '    }',
          '    await onMediaFile(file);',
          '  };',
          '',
          '  const updateSequenceDuration = (id, value) => {',
          '    const nextDuration = Math.max(1, Math.min(21600, Number(value) || 1));',
          '    setSequences((list) => list.map((seq) => seq.id === id ? { ...seq, manualDuration: nextDuration } : seq));',
          '    if (id === activeSequenceId) {',
          '      setManualDuration(nextDuration);',
          '      if (currentTime > nextDuration) seek(nextDuration);',
          '    }',
          '  };',
          '',
          '  const activeSequenceMediaClipAt = (time) => {',
          '    const t = Number(time) || 0;',
          '    const explicit = mediaClips.find((clip) => t >= Number(clip.start || 0) && t < Number(clip.start || 0) + Number(clip.duration || 0));',
          '    if (explicit) return explicit;',
          '    if (!mediaClips.length && (videoInfo || audioInfo)) {',
          '      const d = Number(videoInfo?.duration || audioInfo?.duration) || 0;',
          '      if (t >= 0 && t < d) return { id: "implicit-media", start: 0, in: 0, duration: d, sourceDuration: d, kind: videoInfo ? "video" : "audio" };',
          '    }',
          '    return null;',
          '  };',
          '',
          '  const syncMediaForSequenceTime = (time, shouldPlay = false) => {',
          '    const mediaEl = getMediaEl();',
          '    if (!mediaEl) return;',
          '    const clip = activeSequenceMediaClipAt(time);',
          '    if (!clip) { if (!mediaEl.paused) mediaEl.pause(); return; }',
          '    const sourceDuration = Number(clip.sourceDuration || mediaEl.duration || videoInfo?.duration || audioInfo?.duration) || 0;',
          '    const mediaTime = Math.max(0, Math.min(sourceDuration || 1e9, Number(clip.in || 0) + Number(time) - Number(clip.start || 0)));',
          '    if (Number.isFinite(mediaTime) && Math.abs((mediaEl.currentTime || 0) - mediaTime) > (shouldPlay ? 0.30 : 0.02)) mediaEl.currentTime = mediaTime;',
          '    if (shouldPlay && mediaEl.paused) mediaEl.play().catch(() => null);',
          '  };',
          '',
          '  const startMediaClipDrag = (e, clip) => {',
          '    if (e.button !== 0) return;',
          '    e.preventDefault(); e.stopPropagation(); pause();',
          '    const startX = e.clientX;',
          '    const start = Number(clip.start) || 0;',
          '    const move = (ev) => {',
          '      const maxStart = Math.max(0, duration - Math.min(duration, Number(clip.duration) || 0));',
          '      const nextStart = Math.max(0, Math.min(maxStart, start + (ev.clientX - startX) / pps));',
          '      setMediaClips((clips) => clips.map((item) => item.id === clip.id ? { ...item, start: nextStart } : item));',
          '    };',
          '    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };',
          '    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);',
          '  };',
          '',
        ].join('\n')
        out = out.replace(sequenceHelperAnchor, helpers + sequenceHelperAnchor)
      }

      // Sequence snapshots own blocks, formations, footage clips, playhead and settings.
      out = out.replace(
        '? { ...seq, blocks: cloneJson(blocks), manualDuration, playhead: currentTime }',
        '? { ...seq, blocks: cloneJson(blocks), formations: cloneJson(formations), mediaClips: cloneJson(mediaClips), manualDuration, playhead: currentTime }'
      )
      out = out.replace(
        '    setBlocks(cloneJson(seq.blocks || []));\n    if (!videoInfo && !audioInfo && Number(seq.manualDuration) > 0) setManualDuration(Number(seq.manualDuration));',
        '    setBlocks(cloneJson(seq.blocks || []));\n    setFormations(cloneJson(seq.formations || []));\n    setMediaClips(cloneJson(seq.mediaClips || []));\n    setManualDuration(Math.max(1, Number(seq.manualDuration) || 60));'
      )
      out = out.replace(
        '    const nextTime = Math.max(0, Math.min(Number(seq.playhead) || 0, videoInfo?.duration || audioInfo?.duration || Number(seq.manualDuration) || duration));',
        '    const nextTime = Math.max(0, Math.min(Number(seq.playhead) || 0, Math.max(1, Number(seq.manualDuration) || 60)));'
      )
      out = out.replace(
        'const seq = { id: uid(), name: sequenceName(`Sequence ${String(list.length + 1).padStart(2, "0")}`, list), blocks: [], manualDuration: duration || 60, playhead: 0 };',
        'const seq = { id: uid(), name: sequenceName(`Sequence ${String(list.length + 1).padStart(2, "0")}`, list), blocks: [], formations: [], mediaClips: [], manualDuration: Math.max(1, Number(manualDuration) || 60), playhead: 0 };'
      )

      // Restore new per-sequence fields while retaining old project migration.
      out = out.replace(
        /^(\s*)playhead: Number\(seq\.playhead\) \|\| 0,(?!\n\1formations:)/gm,
        '$1playhead: Number(seq.playhead) || 0,\n$1formations: Array.isArray(seq.formations) ? seq.formations : [],\n$1mediaClips: Array.isArray(seq.mediaClips) ? seq.mediaClips : [],'
      )
      out = out.replaceAll(
        'const legacy = { id: "seq-main", name: "Sequence 01", blocks: legacyBlocks, manualDuration: Number(data.duration || 60), playhead: 0 };',
        'const legacy = { id: "seq-main", name: "Sequence 01", blocks: legacyBlocks, formations: Array.isArray(data.formations) ? data.formations : [], mediaClips: [], manualDuration: Number(data.duration || 60), playhead: 0 };'
      )
      out = out.replaceAll(
        'const legacy = { id: "seq-main", name: "Sequence 01", blocks: legacyBlocks, manualDuration: Number(data.duration || data.manualDuration || 60), playhead: 0 };',
        'const legacy = { id: "seq-main", name: "Sequence 01", blocks: legacyBlocks, formations: Array.isArray(data.formations) ? data.formations : [], mediaClips: [], manualDuration: Number(data.duration || data.manualDuration || 60), playhead: 0 };'
      )
      out = out.replaceAll(
        'setBlocks(restoredActive.blocks || []);',
        'setBlocks(restoredActive.blocks || []);\n        setFormations(Array.isArray(restoredActive.formations) ? restoredActive.formations : []);\n        setMediaClips(Array.isArray(restoredActive.mediaClips) ? restoredActive.mediaClips : []);'
      )
      out = out.replaceAll(
        'setBlocks(cloudActive.blocks || []);',
        'setBlocks(cloudActive.blocks || []);\n      setFormations(Array.isArray(cloudActive.formations) ? cloudActive.formations : []);\n      setMediaClips(Array.isArray(cloudActive.mediaClips) ? cloudActive.mediaClips : []);'
      )

      // Persist PROJECT footage metadata with cloud / portable JSON.
      out = out.replace(
        '    activeSequenceId,\n    customPresets,',
        '    activeSequenceId,\n    projectAssets,\n    customPresets,'
      )
      const cloudApplyAnchor = '  const applyCloudProjectData = (data) => {'
      const cloudApplyPos = out.indexOf(cloudApplyAnchor)
      if (cloudApplyPos >= 0) {
        const cloudApplyEnd = out.indexOf('  const loadCloudForSession =', cloudApplyPos)
        if (cloudApplyEnd > cloudApplyPos) {
          let region = out.slice(cloudApplyPos, cloudApplyEnd)
          if (!region.includes('setProjectAssets(')) {
            const costumesLine = '    if (Array.isArray(data.costumes)) setCostumes(data.costumes);'
            if (region.includes(costumesLine)) {
              region = region.replace(costumesLine, costumesLine + '\n    setProjectAssets(Array.isArray(data.projectAssets) ? data.projectAssets : []);')
              out = out.slice(0, cloudApplyPos) + region + out.slice(cloudApplyEnd)
            }
          }
        }
      }

      // Register uploaded files as PROJECT footage and place them on the active sequence media track.
      const videoInfoLine = '      setVideoInfo({ name: file.name, duration: d, type: file.type });'
      if (out.includes(videoInfoLine) && !out.includes('rememberProjectAsset(file, "video", d)')) {
        out = out.replace(videoInfoLine, videoInfoLine + '\n' + [
          '      const projectAssetId = rememberProjectAsset(file, "video", d);',
          '      attachAssetToSequence(projectAssetId, "video", d, file.name);',
          '      if (!mediaClips.length && !blocks.length && Math.abs(Number(manualDuration) - 60) < 0.001) setManualDuration(d);',
        ].join('\n'))
      }
      const audioInfoLine = '      setAudioInfo({ name: file.name, duration: decoded.duration, peaks });'
      if (out.includes(audioInfoLine) && !out.includes('rememberProjectAsset(file, "audio", decoded.duration)')) {
        out = out.replace(audioInfoLine, audioInfoLine + '\n' + [
          '      const projectAssetId = rememberProjectAsset(file, "audio", decoded.duration);',
          '      attachAssetToSequence(projectAssetId, "audio", decoded.duration, file.name);',
          '      if (!mediaClips.length && !blocks.length && Math.abs(Number(manualDuration) - 60) < 0.001) setManualDuration(decoded.duration);',
        ].join('\n'))
      }
      // The old video loader forced sequence length to source duration. Remove that coupling.
      out = out.replace('      setManualDuration(d);', '      // sequence duration is independent from source footage duration')

      // Sequence clock drives playback. Media is slaved to the media clip instead of owning timeline time.
      const playbackStart = out.indexOf('  /* ── 재생 루프 ── */')
      const playStart = out.indexOf('  const play = async () => {', playbackStart)
      required(playbackStart >= 0 && playStart > playbackStart, 'playback loop')
      const playback = [
        '  /* ── 재생 루프 · sequence clock owns time ── */',
        '  useEffect(() => {',
        '    if (!playing) return;',
        '    sequenceClockRef.current = { at: performance.now(), time: currentTime };',
        '    let raf;',
        '    const tick = (now) => {',
        '      const next = sequenceClockRef.current.time + (now - sequenceClockRef.current.at) / 1000;',
        '      if (next >= duration) {',
        '        setCurrentTime(duration);',
        '        syncMediaForSequenceTime(duration, false);',
        '        setPlaying(false);',
        '        return;',
        '      }',
        '      setCurrentTime(next);',
        '      syncMediaForSequenceTime(next, true);',
        '      raf = requestAnimationFrame(tick);',
        '    };',
        '    raf = requestAnimationFrame(tick);',
        '    return () => cancelAnimationFrame(raf);',
        '  }, [playing, duration, mediaClips, videoInfo, audioInfo]);',
        '',
      ].join('\n')
      out = out.slice(0, playbackStart) + playback + out.slice(playStart)

      const playEnd = out.indexOf('  const pause = () => {', playStart)
      required(playEnd > playStart, 'play function')
      const playFn = [
        '  const play = async () => {',
        '    sequenceClockRef.current = { at: performance.now(), time: currentTime };',
        '    syncMediaForSequenceTime(currentTime, true);',
        '    setPlaying(true);',
        '  };',
        '',
      ].join('\n')
      out = out.slice(0, playStart) + playFn + out.slice(playEnd)

      // A media ended event must not end a longer sequence.
      out = out.replaceAll('    const onEnded = () => setPlaying(false);', '    const onEnded = () => syncMediaForSequenceTime(currentTime, false);')

      const seekStart = out.indexOf('  const seek = (t, snapToFrame = true) => {')
      const seekEnd = out.indexOf('  const stepFrame = (direction) => {', seekStart)
      required(seekStart >= 0 && seekEnd > seekStart, 'seek function')
      const seekFn = [
        '  const seek = (t, snapToFrame = true) => {',
        '    let nt = Math.max(0, Math.min(duration, t));',
        '    if (snapToFrame && fps > 0) nt = Math.round(nt * fps) / fps;',
        '    nt = Math.max(0, Math.min(duration, nt));',
        '    setCurrentTime(nt);',
        '    sequenceClockRef.current = { at: performance.now(), time: nt };',
        '    syncMediaForSequenceTime(nt, playing);',
        '  };',
        '',
      ].join('\n')
      out = out.slice(0, seekStart) + seekFn + out.slice(seekEnd)

      out = out.replace(
        '    const bw = W / peaks.length;',
        '    const mediaDrawWidth = Math.min(W, Math.max(1, Number(audioInfo?.duration || videoInfo?.duration || duration)) * pps);\n    const bw = mediaDrawWidth / peaks.length;'
      )
      out = out.replaceAll(
        'manualDuration, formations, cloudAudioMeta',
        'manualDuration, formations, mediaClips, projectAssets, cloudAudioMeta'
      )
      out = out.replaceAll(
        'manualDuration, formations, cloudMediaMeta',
        'manualDuration, formations, mediaClips, projectAssets, cloudMediaMeta'
      )

      // PROJECT hierarchy above SEQUENCES.
      const sequenceDockAnchor = '          <div className="sequenceDock">'
      if (!out.includes('className="projectDock"')) {
        required(out.includes(sequenceDockAnchor), 'sequence dock')
        const projectDock = [
          '          <div className="projectDock">',
          '            <button type="button" className={`projectFolderBtn ${projectPanelOpen ? "on" : ""}`} onClick={() => setProjectPanelOpen((v) => !v)}>📁 PROJECT</button>',
          '            <span className="projectPath">FOOTAGE {projectAssets.length} · SEQUENCES {sequences.length}</span>',
          '            <button type="button" className="projectImportBtn" onClick={() => fileInputRef.current?.click()}>＋ 푸티지</button>',
          '          </div>',
          '          {projectPanelOpen && (',
          '            <section className="projectPanel">',
          '              <div className="projectTreeGroup">',
          '                <div className="projectTreeTitle">▾ 🎞 FOOTAGE <span>{projectAssets.length}</span></div>',
          '                <div className="projectAssetList">',
          '                  {projectAssets.length ? projectAssets.map((asset) => (',
          '                    <div key={asset.id} className={`projectAssetRow ${asset.id === loadedProjectAssetId ? "loaded" : ""}`}>',
          '                      <span className="assetIcon">{asset.kind === "video" ? "🎬" : "🎵"}</span>',
          '                      <div><b>{asset.name}</b><small>{asset.kind.toUpperCase()} · {fmtTime(asset.duration || 0)}</small></div>',
          '                      <button type="button" onClick={() => loadProjectAsset(asset.id)}>{asset.id === loadedProjectAssetId ? "재배치" : "시퀀스에 배치"}</button>',
          '                    </div>',
          '                  )) : <div className="projectEmpty">미디어 버튼 또는 ＋ 푸티지로 영상/음원을 추가하세요.</div>}',
          '                </div>',
          '              </div>',
          '              <div className="projectTreeGroup sequenceTree">',
          '                <div className="projectTreeTitle">▾ ▤ SEQUENCES <span>{sequences.length}</span></div>',
          '                {sequences.map((seq, index) => <button key={seq.id} type="button" className={`projectSequenceRow ${seq.id === activeSequenceId ? "on" : ""}`} onClick={() => switchSequence(seq.id)}><span>{String(index + 1).padStart(2, "0")}</span><b>{seq.name}</b><small>{fmtTime(seq.id === activeSequenceId ? manualDuration : seq.manualDuration || 60)}</small></button>)}',
          '              </div>',
          '            </section>',
          '          )}',
          '',
          sequenceDockAnchor,
        ].join('\n')
        out = out.replace(sequenceDockAnchor, projectDock)
      }
      out = out.replace('>▤ SEQUENCES</button>', '>↳ SEQUENCES</button>')
      out = out.replace(
        '<div className="sequenceManagerHead"><b>시퀀스 관리</b><span>각 시퀀스는 블록 타임라인이 서로 독립적입니다.</span></div>',
        '<div className="sequenceManagerHead"><b>시퀀스 설정</b><span>길이는 영상/음향 푸티지와 독립적입니다.</span></div>'
      )

      const sequenceNameInput = '<input value={seq.name} onChange={(e) => renameSequence(seq.id, e.target.value)} onFocus={() => { if (seq.id !== activeSequenceId) switchSequence(seq.id); }} />'
      if (out.includes(sequenceNameInput) && !out.includes('className="sequenceDurationEdit"')) {
        out = out.replace(sequenceNameInput, sequenceNameInput + '\n' +
          '                    <label className="sequenceDurationEdit"><span>길이</span><input type="number" min="1" max="21600" step="0.1" value={seq.id === activeSequenceId ? manualDuration : (seq.manualDuration || 60)} onChange={(e) => updateSequenceDuration(seq.id, e.target.value)} /><em>sec</em></label>')
      }

      // Video / audio clip lanes above the EL formation and costume tracks.
      const formationTrackAnchor = '              <div className="formationTrack" onClick={(e) => seek(timeFromEvent(e))}>'
      if (!out.includes('className="projectMediaTrack videoMediaTrack"')) {
        required(out.includes(formationTrackAnchor), 'formation track')
        const mediaTracks = [
          '              <div className="projectMediaTrack videoMediaTrack">',
          '                <div className="projectMediaTrackLabel">V1</div>',
          '                {mediaClips.filter((clip) => clip.kind === "video").map((clip) => (',
          '                  <div key={clip.id} className="mediaClip videoClip" style={{ left: Number(clip.start || 0) * pps, width: Math.max(12, Math.min(Number(clip.duration || 0), Math.max(0, duration - Number(clip.start || 0))) * pps) }} onMouseDown={(e) => startMediaClipDrag(e, clip)} title={`${clip.name || "Video"} · ${fmtTime(clip.start || 0)}`}>',
          '                    <b>🎬 {clip.name || projectAssets.find((a) => a.id === clip.assetId)?.name || "Video"}</b>',
          '                  </div>',
          '                ))}',
          '              </div>',
          '              <div className="projectMediaTrack audioMediaTrack">',
          '                <div className="projectMediaTrackLabel">A1</div>',
          '                {mediaClips.map((clip) => (',
          '                  <div key={`audio-${clip.id}`} className="mediaClip audioClip" style={{ left: Number(clip.start || 0) * pps, width: Math.max(12, Math.min(Number(clip.duration || 0), Math.max(0, duration - Number(clip.start || 0))) * pps) }} onMouseDown={(e) => startMediaClipDrag(e, clip)} title={`${clip.name || "Audio"} · ${fmtTime(clip.start || 0)}`}>',
          '                    <b>{clip.kind === "video" ? "🔊" : "🎵"} {clip.name || projectAssets.find((a) => a.id === clip.assetId)?.name || "Audio"}</b>',
          '                  </div>',
          '                ))}',
          '              </div>',
          '',
          formationTrackAnchor,
        ].join('\n')
        out = out.replace(formationTrackAnchor, mediaTracks)
      }

      // Show sequence identity in the program monitor.
      out = out.replace(
        '<span>프로그램</span>',
        '<span>프로그램 · {sequences.find((seq) => seq.id === activeSequenceId)?.name || "Sequence"}</span>'
      )

      const styleAnchor = '      <style>{CSS}</style>'
      if (!out.includes('.projectDock {')) {
        required(out.includes(styleAnchor), 'style root')
        const style = [
          styleAnchor,
          '      <style>{`',
          '.projectDock{flex:0 0 auto;min-height:34px;display:flex;align-items:center;gap:8px;padding:4px 8px;background:#0c1016;border-top:1px solid #28303b;border-bottom:1px solid #222a34}',
          '.projectFolderBtn,.projectImportBtn{height:26px;border:1px solid #384454;border-radius:5px;background:#171e27;color:#d7e0ed;padding:0 9px;font-size:10px;font-weight:800;cursor:pointer}.projectFolderBtn.on{border-color:#6c83ff;background:#202c48;color:#fff}.projectImportBtn{margin-left:auto;color:#9de5ff}',
          '.projectPath{color:#657286;font:9.5px ui-monospace,monospace;letter-spacing:.02em}',
          '.projectPanel{flex:0 0 auto;display:grid;grid-template-columns:minmax(260px,1.2fr) minmax(230px,.8fr);gap:8px;max-height:220px;overflow:auto;padding:8px;background:#0e1218;border-bottom:1px solid #303846}',
          '.projectTreeGroup{border:1px solid #252e3a;border-radius:6px;background:#121821;overflow:hidden}.projectTreeTitle{height:29px;display:flex;align-items:center;gap:6px;padding:0 9px;background:#171e28;color:#cdd7e5;font-size:10px;font-weight:900}.projectTreeTitle span{margin-left:auto;color:#687589}',
          '.projectAssetList{display:grid;gap:3px;padding:5px}.projectAssetRow{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:7px;align-items:center;min-height:42px;padding:4px 6px;border:1px solid transparent;border-radius:5px;background:#10151c}.projectAssetRow.loaded{border-color:#376e63;background:#10201e}.projectAssetRow b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e0e7f2;font-size:10px}.projectAssetRow small{display:block;color:#687589;font-size:8.5px;margin-top:2px}.projectAssetRow button{border:1px solid #344151;border-radius:4px;background:#1a222d;color:#aebbd0;font-size:9px;padding:4px 6px;cursor:pointer}.assetIcon{font-size:16px}.projectEmpty{padding:10px;color:#667386;font-size:9px}',
          '.sequenceTree{padding-bottom:5px}.projectSequenceRow{width:calc(100% - 10px);margin:3px 5px 0;display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:6px;align-items:center;border:1px solid transparent;border-radius:5px;background:#10151c;color:#aeb9c8;padding:6px 7px;cursor:pointer;text-align:left}.projectSequenceRow.on{border-color:#596fce;background:#192239;color:#fff}.projectSequenceRow span{font-family:monospace;color:#687589}.projectSequenceRow b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.projectSequenceRow small{color:#7e8ca1;font-size:8.5px}',
          '.sequenceManagerRow{grid-template-columns:34px minmax(130px,1fr) 150px 70px auto auto auto!important}.sequenceDurationEdit{height:27px;display:grid!important;grid-template-columns:auto 1fr auto;align-items:center;gap:4px;padding:0 5px;border:1px solid #303a48;border-radius:4px;background:#0e1218;color:#77859a;font-size:8.5px}.sequenceDurationEdit input{height:22px!important;border:0!important;padding:0 3px!important;text-align:right}.sequenceDurationEdit em{font-style:normal;color:#617085}',
          '.projectMediaTrack{position:relative;height:30px;border-bottom:1px solid #202836;background:#0e1420}.projectMediaTrackLabel{position:sticky;left:0;z-index:9;width:42px;height:100%;display:flex;align-items:center;justify-content:center;background:#151d29;border-right:1px solid #2d394a;color:#8795ab;font:900 9px ui-monospace,monospace}.mediaClip{position:absolute;top:3px;bottom:3px;min-width:12px;border-radius:3px;display:flex;align-items:center;padding:0 7px;overflow:hidden;cursor:grab;z-index:5}.mediaClip:active{cursor:grabbing}.mediaClip b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px}.videoClip{border:1px solid #4d6fa8;background:#1e3150;color:#bdd9ff}.audioClip{border:1px solid #3d806d;background:#17352d;color:#acf1dc}',
          '@media(max-width:980px){.projectPanel{grid-template-columns:1fr}.sequenceManagerRow{grid-template-columns:32px minmax(110px,1fr) 130px auto auto!important}.sequenceMeta{display:none}}',
          '`}</style>',
        ].join('\n')
        out = out.replace(styleAnchor, style)
      }

      if (!out.includes('projectAssets') || !out.includes('mediaClips') || !out.includes('projectMediaTrack') || !out.includes('updateSequenceDuration') || !out.includes('formations: cloneJson(formations)')) {
        throw new Error('project workspace: build assertions failed')
      }

      return { code: out, map: null }
    },
  }
}
