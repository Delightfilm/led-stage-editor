export function premiereVideoEditorPlugin() {
  return {
    name: 'premiere-video-editor',
    transform(code, id) {
      if (!id.endsWith('/src/App.jsx') && !id.endsWith('\\src\\App.jsx')) return null

      let out = code
      const mustReplace = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`premiere video plugin: ${label} anchor not found`)
        out = out.replace(from, to)
      }

      mustReplace(
        '  const [audioInfo, setAudioInfo] = useState(null);',
        '  const [audioInfo, setAudioInfo] = useState(null);\n  const [videoInfo, setVideoInfo] = useState(null);\n  const [fps, setFps] = useState(30);',
        'media state'
      )

      mustReplace(
        '  const audioElRef = useRef(null);',
        '  const audioElRef = useRef(null);\n  const videoElRef = useRef(null);',
        'media ref'
      )

      mustReplace(
        '  const duration = audioInfo ? audioInfo.duration : manualDuration;\n  const timelineW = Math.max(600, duration * pps);',
        '  const duration = videoInfo ? videoInfo.duration : (audioInfo ? audioInfo.duration : manualDuration);\n  const timelineW = Math.max(600, duration * pps);\n  const getMediaEl = () => videoInfo ? videoElRef.current : audioElRef.current;\n  const frameNumber = Math.max(0, Math.round(currentTime * fps));',
        'duration'
      )

      mustReplace(
        '    const el = audioElRef.current;\n    if (!el) return;\n    const onEnded = () => setPlaying(false);\n    el.addEventListener("ended", onEnded);\n    return () => el.removeEventListener("ended", onEnded);\n  }, [audioInfo]);',
        '    const el = getMediaEl();\n    if (!el) return;\n    const onEnded = () => setPlaying(false);\n    el.addEventListener("ended", onEnded);\n    return () => el.removeEventListener("ended", onEnded);\n  }, [audioInfo, videoInfo]);',
        'ended effect'
      )

      mustReplace(
        '      const el = audioElRef.current;\n      if (audioInfo && el) {',
        '      const el = getMediaEl();\n      if ((audioInfo || videoInfo) && el) {',
        'playback tick'
      )

      out = out.replace(
        '  }, [playing, audioInfo, duration]);',
        '  }, [playing, audioInfo, videoInfo, duration]);'
      )

      mustReplace(
        '  const play = async () => {\n    if (audioInfo && audioElRef.current) {\n      try {\n        await audioElRef.current.play();',
        '  const play = async () => {\n    const mediaEl = getMediaEl();\n    if ((audioInfo || videoInfo) && mediaEl) {\n      try {\n        await mediaEl.play();',
        'play function'
      )

      mustReplace(
        '  const pause = () => {\n    if (audioElRef.current) audioElRef.current.pause();\n    setPlaying(false);\n  };',
        '  const pause = () => {\n    const mediaEl = getMediaEl();\n    if (mediaEl) mediaEl.pause();\n    setPlaying(false);\n  };',
        'pause function'
      )

      mustReplace(
        '  const seek = (t) => {\n    const nt = Math.max(0, Math.min(duration, t));\n    setCurrentTime(nt);\n    if (audioElRef.current) audioElRef.current.currentTime = nt;\n  };',
        '  const seek = (t, snapToFrame = true) => {\n    let nt = Math.max(0, Math.min(duration, t));\n    if (snapToFrame && fps > 0) nt = Math.round(nt * fps) / fps;\n    nt = Math.max(0, Math.min(duration, nt));\n    setCurrentTime(nt);\n    const mediaEl = getMediaEl();\n    if (mediaEl && Number.isFinite(nt)) mediaEl.currentTime = nt;\n  };\n\n  const stepFrame = (direction) => {\n    pause();\n    seek(currentTime + direction / fps, true);\n  };\n\n  const startPlayheadScrub = (e) => {\n    if (e.button !== 0) return;\n    e.preventDefault();\n    e.stopPropagation();\n    pause();\n    const apply = (ev) => seek(timeFromEvent(ev), true);\n    apply(e);\n    const move = (ev) => apply(ev);\n    const up = () => {\n      window.removeEventListener("mousemove", move);\n      window.removeEventListener("mouseup", up);\n    };\n    window.addEventListener("mousemove", move);\n    window.addEventListener("mouseup", up);\n  };',
        'seek function'
      )

      // Audio loading remains unchanged for cloud storage, but clears any active video.
      mustReplace(
        '  const onAudioFile = async (file) => {\n    if (!file) return;',
        '  const onAudioFile = async (file) => {\n    if (!file) return;\n    setVideoInfo(null);\n    if (videoElRef.current) {\n      videoElRef.current.pause();\n      videoElRef.current.removeAttribute("src");\n      videoElRef.current.load();\n    }',
        'audio loader'
      )

      const mediaLoader = `  /* ── 영상 / 음악 미디어 업로드 ── */\n  const onMediaFile = async (file) => {\n    if (!file) return;\n    if (!file.type?.startsWith("video/")) {\n      await onAudioFile(file);\n      return;\n    }\n\n    pause();\n    if (audioUrlRef.current) {\n      URL.revokeObjectURL(audioUrlRef.current);\n      audioUrlRef.current = null;\n    }\n    if (audioElRef.current) {\n      audioElRef.current.pause();\n      audioElRef.current.removeAttribute("src");\n      audioElRef.current.load();\n    }\n\n    const url = URL.createObjectURL(file);\n    audioUrlRef.current = url;\n    const video = videoElRef.current;\n    if (!video) {\n      URL.revokeObjectURL(url);\n      audioUrlRef.current = null;\n      showToast("⚠️ 영상 모니터를 준비할 수 없어요.");\n      return;\n    }\n\n    try {\n      await new Promise((resolve, reject) => {\n        const done = () => { cleanup(); resolve(); };\n        const fail = () => { cleanup(); reject(new Error("video metadata")); };\n        const cleanup = () => {\n          video.removeEventListener("loadedmetadata", done);\n          video.removeEventListener("error", fail);\n        };\n        video.addEventListener("loadedmetadata", done);\n        video.addEventListener("error", fail);\n        video.src = url;\n        video.load();\n      });\n      const d = Number(video.duration);\n      if (!Number.isFinite(d) || d <= 0) throw new Error("duration");\n      setAudioInfo(null);\n      setVideoInfo({ name: file.name, duration: d, type: file.type || "video" });\n      setManualDuration(d);\n      setCurrentTime(0);\n      video.currentTime = 0;\n      showToast(\`🎬 "\${file.name}" 불러오기 완료 · 타임라인을 드래그해 프레임 단위로 이동하세요\`);\n    } catch {\n      video.removeAttribute("src");\n      video.load();\n      URL.revokeObjectURL(url);\n      audioUrlRef.current = null;\n      setVideoInfo(null);\n      showToast("⚠️ 영상을 읽을 수 없어요. MP4(H.264) 또는 WebM을 권장해요.");\n    }\n  };\n\n`

      mustReplace(
        '  /* ── 음악 업로드 ── */\n  const onAudioFile = async (file) => {',
        mediaLoader + '  /* ── 음악 업로드 ── */\n  const onAudioFile = async (file) => {',
        'media loader insertion'
      )

      // Video has no decoded waveform here; keep a clear media strip instead.
      mustReplace(
        '    if (!audioInfo) {\n      g.fillStyle = "#3A4258";\n      g.font = "12px sans-serif";\n      g.fillText("🎵 음악을 업로드하면 여기에 소리 파형이 표시돼요", 12, H / 2 + 4);\n      return;\n    }',
        '    if (!audioInfo) {\n      g.fillStyle = "#3A4258";\n      g.font = "12px sans-serif";\n      g.fillText(videoInfo ? "🎬 영상 기준 타임라인 · 재생 헤드를 드래그해 프레임 단위 이동" : "🎵 음악 또는 🎬 영상을 업로드하세요", 12, H / 2 + 4);\n      return;\n    }',
        'wave placeholder'
      )
      out = out.replace('  }, [audioInfo, timelineW]);', '  }, [audioInfo, videoInfo, timelineW]);')

      // Premiere-like keyboard frame stepping.
      mustReplace(
        '      if ((e.key === "Delete" || e.key === "Backspace") && selectedBlockId && !typing) {',
        '      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {\n        e.preventDefault();\n        stepFrame(e.key === "ArrowLeft" ? -1 : 1);\n        return;\n      }\n      if ((e.key === "Delete" || e.key === "Backspace") && selectedBlockId && !typing) {',
        'keyboard frame step'
      )
      out = out.replace(
        '  }, [selectedBlockId, playing, blocks, currentTime, costumes]);',
        '  }, [selectedBlockId, playing, blocks, currentTime, costumes, fps, audioInfo, videoInfo]);'
      )

      // Media toolbar and picker.
      mustReplace(
        '<button className="tbtn compact tip" data-tip="MP3 / WAV 업로드" onClick={() => fileInputRef.current.click()}>🎵 음악</button>',
        '<button className="tbtn compact tip" data-tip="MP4 / WebM / MOV / MP3 / WAV 불러오기" onClick={() => fileInputRef.current.click()}>🎬 미디어</button>',
        'media toolbar'
      )
      mustReplace(
        '<input ref={fileInputRef} type="file" accept="audio/*" hidden onChange={(e) => onAudioFile(e.target.files[0])} />',
        '<input ref={fileInputRef} type="file" accept="video/mp4,video/webm,video/quicktime,audio/*" hidden onChange={(e) => onMediaFile(e.target.files[0])} />',
        'media input'
      )

      // Program monitor above the timeline, similar to an NLE workspace.
      const monitor = `        <main className="center" ref={timelineBodyRef}>\n          <section className="programPanel">\n            <div className="programHeader">\n              <span>프로그램</span>\n              <span className="programMediaName">{videoInfo?.name || audioInfo?.name || "미디어 없음"}</span>\n            </div>\n            <div className="programViewport">\n              <video ref={videoElRef} className={\`programVideo \${videoInfo ? "visible" : ""}\`} preload="metadata" playsInline />\n              {!videoInfo && (\n                <div className="programPlaceholder">\n                  <div className="programPlaceholderIcon">🎬</div>\n                  <div>{audioInfo ? "오디오 모드" : "영상을 불러오면 이곳에서 안무를 보면서 편집할 수 있어요"}</div>\n                </div>\n              )}\n            </div>\n            <div className="transportBar">\n              <div className="transportTime">{fmtTime(currentTime)} <span>· {String(frameNumber).padStart(6, "0")}f</span></div>\n              <div className="transportButtons">\n                <button type="button" onClick={() => seek(0)} title="처음으로">⏮</button>\n                <button type="button" onClick={() => stepFrame(-1)} title="이전 프레임 · ←">◀</button>\n                <button type="button" className="transportPlay" onClick={() => playing ? pause() : play()} title="재생/정지 · Space">{playing ? "❚❚" : "▶"}</button>\n                <button type="button" onClick={() => stepFrame(1)} title="다음 프레임 · →">▶</button>\n              </div>\n              <label className="fpsControl">FPS\n                <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>\n                  <option value={23.976}>23.976</option>\n                  <option value={24}>24</option>\n                  <option value={25}>25</option>\n                  <option value={29.97}>29.97</option>\n                  <option value={30}>30</option>\n                  <option value={50}>50</option>\n                  <option value={59.94}>59.94</option>\n                  <option value={60}>60</option>\n                </select>\n              </label>\n            </div>\n          </section>\n\n          <div`

      mustReplace(
        '        <main className="center" ref={timelineBodyRef}>\n          <div',
        monitor,
        'program monitor'
      )

      // Click-drag scrubbing on ruler and waveform strip.
      mustReplace(
        '<div className="ruler" onClick={(e) => seek(timeFromEvent(e))} title="클릭하면 그 위치로 이동해요">',
        '<div className="ruler scrubSurface" onMouseDown={startPlayheadScrub} title="클릭/드래그: 프레임 단위 재생 헤드 이동">',
        'ruler scrub'
      )
      mustReplace(
        '<div className="waveRow" onClick={(e) => seek(timeFromEvent(e))}>',
        '<div className="waveRow scrubSurface" onMouseDown={startPlayheadScrub}>',
        'wave scrub'
      )

      // Add styling before the existing stylesheet so later generic rules can still participate.
      mustReplace(
        'const CSS = `\n',
        `const CSS = \`\n.programPanel { flex: 0 0 auto; background: #0B0D12; border-bottom: 1px solid var(--line); }\n.programHeader { height: 30px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; background: #171A21; color: var(--text); font-size: 12px; border-bottom: 1px solid #252A34; }\n.programMediaName { color: var(--muted); max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.programViewport { position: relative; height: clamp(180px, 34vh, 430px); display: grid; place-items: center; overflow: hidden; background: #050607; }\n.programVideo { width: 100%; height: 100%; object-fit: contain; display: none; background: #000; }\n.programVideo.visible { display: block; }\n.programPlaceholder { position: absolute; inset: 0; display: grid; place-content: center; gap: 8px; text-align: center; color: var(--muted); font-size: 13px; padding: 20px; }\n.programPlaceholderIcon { font-size: 28px; }\n.transportBar { min-height: 42px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; padding: 5px 10px; background: #14171D; border-top: 1px solid #232832; border-bottom: 1px solid #232832; }\n.transportTime { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #E9ECF4; font-size: 12px; }\n.transportTime span { color: var(--muted); }\n.transportButtons { display: flex; align-items: center; gap: 3px; }\n.transportButtons button { width: 34px; height: 30px; border: 0; border-radius: 3px; background: transparent; color: #DDE2ED; cursor: pointer; }\n.transportButtons button:hover { background: #2A303B; }\n.transportButtons .transportPlay { background: #262C36; }\n.fpsControl { justify-self: end; display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 11px; }\n.fpsControl select { background: #1C212A; color: var(--text); border: 1px solid #343B49; border-radius: 3px; padding: 4px 5px; }\n.scrubSurface { cursor: ew-resize; user-select: none; }\n@media (max-width: 900px) { .programViewport { height: 220px; } .transportBar { grid-template-columns: 1fr auto; } .fpsControl { display: none; } }\n`,
        'css start'
      )

      return { code: out, map: null }
    },
  }
}
