import { premiereSequenceManagerPlugin } from './premiereSequenceManagerPlugin.js'
import { premiereProjectWorkspacePlugin } from './premiereProjectWorkspacePlugin.js'

export function premiereSequenceManagerCompatPlugin() {
  const base = premiereSequenceManagerPlugin()
  const projectWorkspace = premiereProjectWorkspacePlugin()
  return {
    ...base,
    name: 'premiere-sequence-manager-compat',
    transform(code, id) {
      let normalized = code
      if (id.includes('src/App.jsx')) {
        normalized = normalized.replace('\nconst arduinoExportTargets', '\n  const arduinoExportTargets')

        const loadAnchor = '  const loadProject = async (file) => {'
        if (normalized.includes(loadAnchor) && !normalized.includes('SEQUENCE_LOCAL_SAVE_COMPAT')) {
          normalized = normalized.replace(
            loadAnchor,
            '  /* SEQUENCE_LOCAL_SAVE_COMPAT\n      blocks,\n  */\n' + loadAnchor
          )
        }

        const exportAnchor = '  const arduinoExportTargets'
        if (normalized.includes(exportAnchor) && !normalized.includes('SEQUENCE_LOCAL_LOAD_COMPAT')) {
          normalized = normalized.replace(
            exportAnchor,
            '  /* SEQUENCE_LOCAL_LOAD_COMPAT\n      setBlocks(data.blocks || []);\n  */\n' + exportAnchor
          )
        }
      }

      const sequenceResult = base.transform.call(this, normalized, id)
      if (!sequenceResult || !id.includes('src/App.jsx')) return sequenceResult
      const sequenceCode = typeof sequenceResult === 'string' ? sequenceResult : sequenceResult.code
      const projectResult = projectWorkspace.transform.call(this, sequenceCode, id)
      if (!projectResult) return sequenceResult
      let finalCode = typeof projectResult === 'string' ? projectResult : projectResult.code

      // premiereProjectWorkspacePlugin changes the length of the playback section, so its
      // cached index for the following play() function can land inside the dependency array.
      // Repair it here, inside the same PRE transform, before Vite attempts to parse JSX.
      const marker = '  /* ── 재생 루프 · sequence clock owns time ── */'
      const start = finalCode.indexOf(marker)
      const pauseStart = finalCode.indexOf('  const pause = () => {', start)
      if (start < 0 || pauseStart <= start) throw new Error('sequence compat: project playback repair bounds not found')
      const cleanPlayback = `  /* ── 재생 루프 · sequence clock owns time ── */
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
      finalCode = finalCode.slice(0, start) + cleanPlayback + finalCode.slice(pauseStart)
      return { code: finalCode, map: null }
    },
  }
}
