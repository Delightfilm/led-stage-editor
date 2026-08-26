export function editorFrameAudioScrubPlugin() {
  return {
    name: 'editor-frame-audio-scrub',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const replaceStrict = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`frame audio scrub: ${label} anchor not found`)
        out = out.replace(from, to)
      }

      // Keep the decoded audio in memory. The normal media element remains responsible
      // for regular playback; this buffer is only used for frame-accurate scrub grains.
      replaceStrict(
        '  const videoElRef = useRef(null);',
        [
          '  const videoElRef = useRef(null);',
          '  const scrubAudioBufferRef = useRef(null);',
          '  const scrubAudioContextRef = useRef(null);',
          '  const scrubVoiceRef = useRef(null);',
          '  const scrubLastFrameRef = useRef(null);',
        ].join('\n'),
        'scrub refs'
      )

      replaceStrict(
        '      const decoded = await ctx.decodeAudioData(buf.slice(0));',
        '      const decoded = await ctx.decodeAudioData(buf.slice(0));\n      scrubAudioBufferRef.current = decoded;',
        'audio decoded buffer'
      )

      replaceStrict(
        '  const onAudioFile = async (file) => {\n    if (!file) return;\n    setVideoInfo(null);',
        '  const onAudioFile = async (file) => {\n    if (!file) return;\n    scrubAudioBufferRef.current = null;\n    scrubLastFrameRef.current = null;\n    setVideoInfo(null);',
        'audio load reset'
      )

      replaceStrict(
        '  const onMediaFile = async (file) => {\n    if (!file) return;\n    if (!file.type || !file.type.startsWith("video/")) {',
        '  const onMediaFile = async (file) => {\n    if (!file) return;\n    scrubAudioBufferRef.current = null;\n    scrubLastFrameRef.current = null;\n    if (!file.type || !file.type.startsWith("video/")) {',
        'video load reset'
      )

      // premiereEditingWorkflowPlugin already decodes the audio track from compatible
      // video files to draw the waveform. Reuse that exact decoded buffer for scrubbing.
      replaceStrict(
        '        const decodedAudio = await waveformCtx.decodeAudioData(mediaBuffer);',
        '        const decodedAudio = await waveformCtx.decodeAudioData(mediaBuffer);\n        scrubAudioBufferRef.current = decodedAudio;',
        'video decoded buffer'
      )

      const seekAnchor = '  const seek = (t, snapToFrame = true) => {'
      const scrubHelpers = [
        '  const stopScrubVoice = (fade = true) => {',
        '    const voice = scrubVoiceRef.current;',
        '    if (!voice) return;',
        '    scrubVoiceRef.current = null;',
        '    const ctx = scrubAudioContextRef.current;',
        '    try {',
        '      if (fade && ctx && voice.gain) {',
        '        const now = ctx.currentTime;',
        '        const current = Math.max(0.0001, Number(voice.gain.gain.value) || 0.0001);',
        '        voice.gain.gain.cancelScheduledValues(now);',
        '        voice.gain.gain.setValueAtTime(current, now);',
        '        voice.gain.gain.linearRampToValueAtTime(0.0001, now + 0.003);',
        '        voice.source.stop(now + 0.004);',
        '      } else {',
        '        voice.source.stop();',
        '      }',
        '    } catch {}',
        '  };',
        '',
        '  const playScrubFrame = (timeSec, dedupe = true) => {',
        '    const buffer = scrubAudioBufferRef.current;',
        '    if (!buffer || !Number.isFinite(fps) || fps <= 0 || buffer.duration <= 0) return;',
        '    const maxFrame = Math.max(0, Math.ceil(buffer.duration * fps) - 1);',
        '    const frame = Math.max(0, Math.min(maxFrame, Math.round(Number(timeSec || 0) * fps)));',
        '    if (dedupe && scrubLastFrameRef.current === frame) return;',
        '    scrubLastFrameRef.current = frame;',
        '',
        '    const AudioCtx = window.AudioContext || window.webkitAudioContext;',
        '    if (!AudioCtx) return;',
        '    let ctx = scrubAudioContextRef.current;',
        '    if (!ctx || ctx.state === "closed") {',
        '      try {',
        '        ctx = new AudioCtx({ latencyHint: "interactive" });',
        '      } catch {',
        '        ctx = new AudioCtx();',
        '      }',
        '      scrubAudioContextRef.current = ctx;',
        '    }',
        '    if (ctx.state === "suspended") ctx.resume().catch(() => {});',
        '',
        '    stopScrubVoice(true);',
        '    const frameDuration = 1 / fps;',
        '    const offset = Math.max(0, Math.min(buffer.duration - 0.001, frame / fps));',
        '    const grainDuration = Math.max(0.001, Math.min(frameDuration, buffer.duration - offset));',
        '    if (!Number.isFinite(grainDuration) || grainDuration <= 0) return;',
        '',
        '    try {',
        '      const source = ctx.createBufferSource();',
        '      const gain = ctx.createGain();',
        '      source.buffer = buffer;',
        '      source.connect(gain);',
        '      gain.connect(ctx.destination);',
        '',
        '      const now = ctx.currentTime;',
        '      const edgeFade = Math.min(0.0025, grainDuration * 0.22);',
        '      const releaseAt = Math.max(now + edgeFade, now + grainDuration - edgeFade);',
        '      gain.gain.setValueAtTime(0.0001, now);',
        '      gain.gain.linearRampToValueAtTime(0.82, now + edgeFade);',
        '      gain.gain.setValueAtTime(0.82, releaseAt);',
        '      gain.gain.linearRampToValueAtTime(0.0001, now + grainDuration);',
        '',
        '      scrubVoiceRef.current = { source, gain };',
        '      source.onended = () => {',
        '        if (scrubVoiceRef.current?.source === source) scrubVoiceRef.current = null;',
        '        try { source.disconnect(); } catch {}',
        '        try { gain.disconnect(); } catch {}',
        '      };',
        '      source.start(now, offset, grainDuration);',
        '      source.stop(now + grainDuration + 0.005);',
        '    } catch {}',
        '  };',
        '',
        '  useEffect(() => () => {',
        '    try { scrubVoiceRef.current?.source?.stop(); } catch {}',
        '    scrubVoiceRef.current = null;',
        '    const ctx = scrubAudioContextRef.current;',
        '    scrubAudioContextRef.current = null;',
        '    if (ctx && ctx.state !== "closed") { try { ctx.close(); } catch {} }',
        '  }, []);',
        '',
      ].join('\n')
      replaceStrict(seekAnchor, scrubHelpers + seekAnchor, 'scrub helpers')

      replaceStrict(
        [
          '  const stepFrame = (direction) => {',
          '    pause();',
          '    seek(currentTime + direction / fps, true);',
          '  };',
        ].join('\n'),
        [
          '  const stepFrame = (direction) => {',
          '    pause();',
          '    const target = currentTime + direction / fps;',
          '    scrubLastFrameRef.current = null;',
          '    seek(target, true);',
          '    playScrubFrame(target, false);',
          '  };',
        ].join('\n'),
        'frame step audio'
      )

      // Emit exactly one grain whenever the snapped playhead crosses into another frame.
      // Duplicate mousemove events inside the same frame are intentionally ignored.
      replaceStrict(
        '    pause();\n    const apply = (ev) => {',
        '    pause();\n    scrubLastFrameRef.current = null;\n    const apply = (ev) => {',
        'scrub session reset'
      )
      replaceStrict(
        '      setSnapGuide(snapped ? target : null);\n      seek(target, !snapped);',
        '      setSnapGuide(snapped ? target : null);\n      seek(target, !snapped);\n      playScrubFrame(target, true);',
        'drag grain trigger'
      )
      replaceStrict(
        '      setSnapGuide(null);\n      window.removeEventListener("mousemove", move);',
        '      setSnapGuide(null);\n      scrubLastFrameRef.current = null;\n      window.removeEventListener("mousemove", move);',
        'scrub session cleanup'
      )

      // Normal playback must never overlap a leftover scrub grain.
      replaceStrict(
        '  const play = async () => {\n    const mediaEl = getMediaEl();',
        '  const play = async () => {\n    stopScrubVoice(false);\n    scrubLastFrameRef.current = null;\n    const mediaEl = getMediaEl();',
        'playback scrub cleanup'
      )

      // Small discoverability hints only; no layout or waveform rendering changes.
      out = out.replace(
        'title="클릭/드래그: 프레임 단위 재생 헤드 이동"',
        'title="클릭/드래그: 프레임 단위 이동 · 프레임마다 오디오 스크럽"'
      )
      out = out.replace(
        'title="이전 프레임 · ←"',
        'title="이전 프레임 + 오디오 스크럽 · ←"'
      )
      out = out.replace(
        'title="다음 프레임 · →"',
        'title="다음 프레임 + 오디오 스크럽 · →"'
      )

      if (!out.includes('playScrubFrame(target, true)') || !out.includes('scrubAudioBufferRef.current = decoded') || !out.includes('grainDuration = Math.max(0.001, Math.min(frameDuration')) {
        throw new Error('frame audio scrub: build assertions failed')
      }

      return { code: out, map: null }
    },
  }
}
