export function projectWorkspacePlaybackFixPlugin() {
  return {
    name: 'project-workspace-playback-fix',
    transform(code, id) {
      if (!id.includes('src/App.jsx') || !code.includes('sequenceClockRef') || !code.includes('mediaClips')) return null
      let out = code
      const marker = '  /* ── 재생 루프 · sequence clock owns time ── */'
      const start = out.indexOf(marker)
      const pauseStart = out.indexOf('  const pause = () => {', start)
      if (start < 0 || pauseStart <= start) throw new Error('project playback fix: playback bounds not found')

      const clean = `  /* ── 재생 루프 · sequence clock owns time ── */
  useEffect(() => {
    if (!playing) return;
    sequenceClockRef.current = { at: performance.now(), time: currentTime };
    let raf;
    const tick = (now) => {
      const next = sequenceClockRef.current.time + (now - sequenceClockRef.current.at) / 1000;
      if (next >= duration) {
        setCurrentTime(duration);
        syncMediaForSequenceTime(duration, false);
        setPlaying(false);
        return;
      }
      setCurrentTime(next);
      syncMediaForSequenceTime(next, true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, mediaClips, videoInfo, audioInfo]);

  const play = async () => {
    sequenceClockRef.current = { at: performance.now(), time: currentTime };
    syncMediaForSequenceTime(currentTime, true);
    setPlaying(true);
  };

`
      out = out.slice(0, start) + clean + out.slice(pauseStart)
      return { code: out, map: null }
    },
  }
}
