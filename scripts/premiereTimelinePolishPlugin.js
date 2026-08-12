export function premiereTimelinePolishPlugin() {
  return {
    name: 'premiere-timeline-polish',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const replaceStrict = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`premiere polish: ${label} anchor not found`)
        out = out.replace(from, to)
      }

      // SHIFT + playhead drag: snap exactly to any block start/end within 10px.
      const oldScrub = [
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

      const newScrub = [
        '  const startPlayheadScrub = (e) => {',
        '    if (e.button !== 0) return;',
        '    e.preventDefault();',
        '    e.stopPropagation();',
        '    pause();',
        '    const apply = (ev) => {',
        '      const raw = timeFromEvent(ev);',
        '      let target = raw;',
        '      let snapped = false;',
        '      if (ev.shiftKey) {',
        '        const threshold = 10 / pps;',
        '        let bestDist = threshold;',
        '        blocks.forEach((b) => {',
        '          [b.start, b.start + b.dur].forEach((point) => {',
        '            const dist = Math.abs(point - raw);',
        '            if (dist < bestDist) {',
        '              bestDist = dist;',
        '              target = point;',
        '              snapped = true;',
        '            }',
        '          });',
        '        });',
        '      }',
        '      setSnapGuide(snapped ? target : null);',
        '      seek(target, !snapped);',
        '    };',
        '    apply(e);',
        '    const move = (ev) => apply(ev);',
        '    const up = () => {',
        '      setSnapGuide(null);',
        '      window.removeEventListener("mousemove", move);',
        '      window.removeEventListener("mouseup", up);',
        '    };',
        '    window.addEventListener("mousemove", move);',
        '    window.addEventListener("mouseup", up);',
        '  };',
      ].join('\n')
      replaceStrict(oldScrub, newScrub, 'playhead scrub')

      // Store the actual video dimensions so the monitor frame can match any aspect ratio.
      replaceStrict(
        '      setVideoInfo({ name: file.name, duration: d, type: file.type });',
        '      setVideoInfo({ name: file.name, duration: d, type: file.type, width: video.videoWidth || 16, height: video.videoHeight || 9 });',
        'video dimensions'
      )

      replaceStrict(
        '            <div className="programViewport">',
        '            <div className="programViewport" style={{ aspectRatio: videoInfo?.width && videoInfo?.height ? (videoInfo.width + " / " + videoInfo.height) : "16 / 9", maxWidth: videoInfo?.width && videoInfo?.height ? ((videoInfo.width / videoInfo.height) * 38) + "vh" : "67.56vh" }}>',
        'program viewport'
      )

      // Remove the manual FPS selector. Keep fps internal and auto-detect from presented video frames.
      const fpsControl = [
        '              <label className="fpsControl">FPS <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>',
        '                <option value={23.976}>23.976</option><option value={24}>24</option><option value={25}>25</option><option value={29.97}>29.97</option><option value={30}>30</option><option value={50}>50</option><option value={59.94}>59.94</option><option value={60}>60</option>',
        '              </select></label>',
      ].join('\n')
      replaceStrict(fpsControl, '              <span aria-hidden="true" />', 'fps selector')

      const frameAnchor = '  const frameNumber = Math.max(0, Math.round(currentTime * fps));'
      const fpsAuto = [
        frameAnchor,
        '',
        '  useEffect(() => {',
        '    const video = videoElRef.current;',
        '    if (!videoInfo || !video || typeof video.requestVideoFrameCallback !== "function") return;',
        '    let handle = 0;',
        '    let lastMediaTime = null;',
        '    const samples = [];',
        '    const commonFps = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];',
        '    const onFrame = (_now, meta) => {',
        '      if (lastMediaTime != null) {',
        '        const dt = meta.mediaTime - lastMediaTime;',
        '        if (dt > 0.008 && dt < 0.08) samples.push(1 / dt);',
        '      }',
        '      lastMediaTime = meta.mediaTime;',
        '      if (samples.length >= 10) {',
        '        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;',
        '        const detected = commonFps.reduce((best, v) => Math.abs(v - avg) < Math.abs(best - avg) ? v : best, commonFps[0]);',
        '        setFps((prev) => Math.abs(prev - detected) < 0.01 ? prev : detected);',
        '        return;',
        '      }',
        '      handle = video.requestVideoFrameCallback(onFrame);',
        '    };',
        '    handle = video.requestVideoFrameCallback(onFrame);',
        '    return () => { if (handle && typeof video.cancelVideoFrameCallback === "function") video.cancelVideoFrameCallback(handle); };',
        '  }, [videoInfo]);',
      ].join('\n')
      replaceStrict(frameAnchor, fpsAuto, 'auto fps')

      // Override the fixed monitor height inserted by the Premiere layer.
      replaceStrict(
        '.scrubSurface { cursor:ew-resize !important; user-select:none; }',
        '.scrubSurface { cursor:ew-resize !important; user-select:none; }\n.programViewport { width:100%; height:auto !important; max-height:38vh; margin:0 auto; }',
        'monitor css'
      )

      return { code: out, map: null }
    },
  }
}
