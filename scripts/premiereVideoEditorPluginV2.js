export function premiereVideoEditorPluginV2() {
  return {
    name: 'premiere-video-editor-v2',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code
      const rep = (from, to) => {
        if (out.includes(from)) out = out.replace(from, to)
      }

      rep(
        '  const [audioInfo, setAudioInfo] = useState(null);',
        '  const [audioInfo, setAudioInfo] = useState(null);\n  const [videoInfo, setVideoInfo] = useState(null);\n  const [fps, setFps] = useState(30);'
      )
      rep(
        '  const audioElRef = useRef(null);',
        '  const audioElRef = useRef(null);\n  const videoElRef = useRef(null);'
      )
      rep(
        '  const duration = audioInfo ? audioInfo.duration : manualDuration;\n  const timelineW = Math.max(600, duration * pps);',
        '  const duration = videoInfo ? videoInfo.duration : (audioInfo ? audioInfo.duration : manualDuration);\n  const timelineW = Math.max(600, duration * pps);\n  const getMediaEl = () => videoInfo ? videoElRef.current : audioElRef.current;\n  const frameNumber = Math.max(0, Math.round(currentTime * fps));'
      )

      rep(
        '    const el = audioElRef.current;\n    if (!el) return;\n    const onEnded = () => setPlaying(false);\n    el.addEventListener("ended", onEnded);\n    return () => el.removeEventListener("ended", onEnded);\n  }, [audioInfo]);',
        '    const el = getMediaEl();\n    if (!el) return;\n    const onEnded = () => setPlaying(false);\n    el.addEventListener("ended", onEnded);\n    return () => el.removeEventListener("ended", onEnded);\n  }, [audioInfo, videoInfo]);'
      )
      rep(
        '      const el = audioElRef.current;\n      if (audioInfo && el) {',
        '      const el = getMediaEl();\n      if ((audioInfo || videoInfo) && el) {'
      )
      rep(
        '  }, [playing, audioInfo, duration]);',
        '  }, [playing, audioInfo, videoInfo, duration]);'
      )
      rep(
        '  const play = async () => {\n    if (audioInfo && audioElRef.current) {\n      try {\n        await audioElRef.current.play();',
        '  const play = async () => {\n    const mediaEl = getMediaEl();\n    if ((audioInfo || videoInfo) && mediaEl) {\n      try {\n        await mediaEl.play();'
      )
      rep(
        '  const pause = () => {\n    if (audioElRef.current) audioElRef.current.pause();\n    setPlaying(false);\n  };',
        '  const pause = () => {\n    const mediaEl = getMediaEl();\n    if (mediaEl) mediaEl.pause();\n    setPlaying(false);\n  };'
      )

      const seekBlock = [
        '  const seek = (t, snapToFrame = true) => {',
        '    let nt = Math.max(0, Math.min(duration, t));',
        '    if (snapToFrame && fps > 0) nt = Math.round(nt * fps) / fps;',
        '    nt = Math.max(0, Math.min(duration, nt));',
        '    setCurrentTime(nt);',
        '    const mediaEl = getMediaEl();',
        '    if (mediaEl && Number.isFinite(nt)) mediaEl.currentTime = nt;',
        '  };',
        '',
        '  const stepFrame = (direction) => {',
        '    pause();',
        '    seek(currentTime + direction / fps, true);',
        '  };',
        '',
        '  const startPlayheadScrub = (e) => {',
        '    if (e.button !== 0) return;',
        '    e.preventDefault();',
        '    e.stopPropagation();',
        '    pause();',
        '    const apply = (ev) => seek(timeFromEvent(ev), true);',
        '    apply(e);',
        '    const move = (ev) => apply(ev);',
        '    const up = () => {',
        '      window.removeEventListener("mousemove", move);',
        '      window.removeEventListener("mouseup", up);',
        '    };',
        '    window.addEventListener("mousemove", move);',
        '    window.addEventListener("mouseup", up);',
        '  };',
      ].join('\n')
      rep(
        '  const seek = (t) => {\n    const nt = Math.max(0, Math.min(duration, t));\n    setCurrentTime(nt);\n    if (audioElRef.current) audioElRef.current.currentTime = nt;\n  };',
        seekBlock
      )

      rep(
        '  const onAudioFile = async (file) => {\n    if (!file) return;',
        '  const onAudioFile = async (file) => {\n    if (!file) return;\n    setVideoInfo(null);\n    if (videoElRef.current) { videoElRef.current.pause(); videoElRef.current.removeAttribute("src"); videoElRef.current.load(); }'
      )

      const mediaLoader = [
        '  /* ── 영상 / 음악 미디어 업로드 ── */',
        '  const onMediaFile = async (file) => {',
        '    if (!file) return;',
        '    if (!file.type || !file.type.startsWith("video/")) {',
        '      await onAudioFile(file);',
        '      return;',
        '    }',
        '    pause();',
        '    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }',
        '    if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current.removeAttribute("src"); audioElRef.current.load(); }',
        '    const url = URL.createObjectURL(file);',
        '    audioUrlRef.current = url;',
        '    const video = videoElRef.current;',
        '    if (!video) return;',
        '    try {',
        '      await new Promise((resolve, reject) => {',
        '        const done = () => { cleanup(); resolve(); };',
        '        const fail = () => { cleanup(); reject(new Error("video metadata")); };',
        '        const cleanup = () => { video.removeEventListener("loadedmetadata", done); video.removeEventListener("error", fail); };',
        '        video.addEventListener("loadedmetadata", done);',
        '        video.addEventListener("error", fail);',
        '        video.src = url;',
        '        video.load();',
        '      });',
        '      const d = Number(video.duration);',
        '      if (!Number.isFinite(d) || d <= 0) throw new Error("duration");',
        '      setAudioInfo(null);',
        '      setVideoInfo({ name: file.name, duration: d, type: file.type });',
        '      setManualDuration(d);',
        '      setCurrentTime(0);',
        '      video.currentTime = 0;',
        '      showToast("🎬 "+file.name+" 불러오기 완료 · 드래그/←/→로 프레임 이동");',
        '    } catch (err) {',
        '      video.removeAttribute("src");',
        '      video.load();',
        '      URL.revokeObjectURL(url);',
        '      audioUrlRef.current = null;',
        '      setVideoInfo(null);',
        '      showToast("⚠️ 영상을 읽을 수 없어요. MP4(H.264) 또는 WebM을 권장해요.");',
        '    }',
        '  };',
        '',
      ].join('\n')
      rep('  /* ── 음악 업로드 ── */\n', mediaLoader + '  /* ── 음악 업로드 ── */\n')

      rep(
        '    if (!audioInfo) {\n      g.fillStyle = "#3A4258";\n      g.font = "12px sans-serif";\n      g.fillText("🎵 음악을 업로드하면 여기에 소리 파형이 표시돼요", 12, H / 2 + 4);\n      return;\n    }',
        '    if (!audioInfo) {\n      g.fillStyle = "#3A4258";\n      g.font = "12px sans-serif";\n      g.fillText(videoInfo ? "🎬 영상 기준 타임라인 · 재생 헤드를 드래그해 프레임 단위 이동" : "🎵 음악 또는 🎬 영상을 불러오세요", 12, H / 2 + 4);\n      return;\n    }'
      )
      rep('  }, [audioInfo, timelineW]);', '  }, [audioInfo, videoInfo, timelineW]);')

      rep(
        '      if ((e.key === "Delete" || e.key === "Backspace") && selectedBlockId && !typing) {',
        '      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {\n        e.preventDefault();\n        stepFrame(e.key === "ArrowLeft" ? -1 : 1);\n        return;\n      }\n      if ((e.key === "Delete" || e.key === "Backspace") && selectedBlockId && !typing) {'
      )
      rep(
        '  }, [selectedBlockId, playing, blocks, currentTime, costumes]);',
        '  }, [selectedBlockId, playing, blocks, currentTime, costumes, fps, audioInfo, videoInfo]);'
      )

      rep(
        '<button className="tbtn compact tip" data-tip="MP3 / WAV 업로드" onClick={() => fileInputRef.current.click()}>🎵 음악</button>',
        '<button className="tbtn compact tip" data-tip="MP4 / WebM / MOV / MP3 / WAV 불러오기" onClick={() => fileInputRef.current.click()}>🎬 미디어</button>'
      )
      rep(
        '<input ref={fileInputRef} type="file" accept="audio/*" hidden onChange={(e) => onAudioFile(e.target.files[0])} />',
        '<input ref={fileInputRef} type="file" accept="video/mp4,video/webm,video/quicktime,audio/*" hidden onChange={(e) => onMediaFile(e.target.files[0])} />'
      )

      const monitor = [
        '        <main className="center" ref={timelineBodyRef}>',
        '          <section className="programPanel">',
        '            <div className="programHeader">',
        '              <span>프로그램</span>',
        '              <span className="programMediaName">{videoInfo?.name || audioInfo?.name || "미디어 없음"}</span>',
        '            </div>',
        '            <div className="programViewport">',
        '              <video ref={videoElRef} className={"programVideo" + (videoInfo ? " visible" : "")} preload="metadata" playsInline />',
        '              {!videoInfo && <div className="programPlaceholder"><span>🎬</span><div>{audioInfo ? "오디오 모드" : "영상을 불러오면 여기서 보면서 편집할 수 있어요"}</div></div>}',
        '            </div>',
        '            <div className="transportBar">',
        '              <div className="transportTime">{fmtTime(currentTime)} <span>· {String(frameNumber).padStart(6, "0")}f</span></div>',
        '              <div className="transportButtons">',
        '                <button type="button" onClick={() => seek(0)} title="처음으로">⏮</button>',
        '                <button type="button" onClick={() => stepFrame(-1)} title="이전 프레임 · ←">◀</button>',
        '                <button type="button" className="transportPlay" onClick={() => playing ? pause() : play()} title="재생/정지 · Space">{playing ? "❚❚" : "▶"}</button>',
        '                <button type="button" onClick={() => stepFrame(1)} title="다음 프레임 · →">▶</button>',
        '              </div>',
        '              <label className="fpsControl">FPS <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>',
        '                <option value={23.976}>23.976</option><option value={24}>24</option><option value={25}>25</option><option value={29.97}>29.97</option><option value={30}>30</option><option value={50}>50</option><option value={59.94}>59.94</option><option value={60}>60</option>',
        '              </select></label>',
        '            </div>',
        '          </section>',
        '',
        '          <div',
      ].join('\n')
      rep('        <main className="center" ref={timelineBodyRef}>\n          <div', monitor)

      rep(
        '<div className="ruler" onClick={(e) => seek(timeFromEvent(e))} title="클릭하면 그 위치로 이동해요">',
        '<div className="ruler scrubSurface" onMouseDown={startPlayheadScrub} title="클릭/드래그: 프레임 단위 재생 헤드 이동">'
      )
      rep(
        '<div className="waveRow" onClick={(e) => seek(timeFromEvent(e))}>',
        '<div className="waveRow scrubSurface" onMouseDown={startPlayheadScrub}>'
      )
      rep('            {!audioInfo ? (', '            {!audioInfo && !videoInfo ? (')
      rep('<span className="footerHint dim">{audioInfo.name}</span>', '<span className="footerHint dim">{videoInfo?.name || audioInfo?.name}</span>')

      const css = [
        '.programPanel { flex: 0 0 auto; background: #0B0D12; border-bottom: 1px solid var(--line); }',
        '.programHeader { height: 30px; display:flex; align-items:center; justify-content:space-between; padding:0 12px; background:#171A21; color:var(--text); font-size:12px; border-bottom:1px solid #252A34; }',
        '.programMediaName { color:var(--muted); max-width:60%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
        '.programViewport { position:relative; height:clamp(180px,34vh,420px); display:grid; place-items:center; overflow:hidden; background:#050607; }',
        '.programVideo { width:100%; height:100%; object-fit:contain; display:none; background:#000; }',
        '.programVideo.visible { display:block; }',
        '.programPlaceholder { position:absolute; inset:0; display:grid; place-content:center; gap:8px; text-align:center; color:var(--muted); font-size:13px; padding:20px; }',
        '.programPlaceholder > span { font-size:28px; }',
        '.transportBar { min-height:42px; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:10px; padding:5px 10px; background:#14171D; border-top:1px solid #232832; border-bottom:1px solid #232832; }',
        '.transportTime { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:#E9ECF4; font-size:12px; }',
        '.transportTime span { color:var(--muted); }',
        '.transportButtons { display:flex; align-items:center; gap:3px; }',
        '.transportButtons button { width:34px; height:30px; border:0; border-radius:3px; background:transparent; color:#DDE2ED; cursor:pointer; }',
        '.transportButtons button:hover { background:#2A303B; }',
        '.transportButtons .transportPlay { background:#262C36; }',
        '.fpsControl { justify-self:end; display:flex; align-items:center; gap:6px; color:var(--muted); font-size:11px; }',
        '.fpsControl select { background:#1C212A; color:var(--text); border:1px solid #343B49; border-radius:3px; padding:4px 5px; }',
        '.scrubSurface { cursor:ew-resize !important; user-select:none; }',
        '@media (max-width:900px) { .programViewport { height:220px; } .transportBar { grid-template-columns:1fr auto; } .fpsControl { display:none; } }',
      ].join('\n')
      rep('const CSS = `\n', 'const CSS = `\n' + css + '\n')

      return { code: out, map: null }
    },
  }
}
