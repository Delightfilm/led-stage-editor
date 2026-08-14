export function projectLinkedMediaUxPlugin() {
  return {
    name: 'project-linked-media-ux',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const required = (ok, label) => {
        if (!ok) throw new Error(`linked media ux: ${label} anchor not found`)
      }

      // The cloud-media plugin expands setVideoInfo() with width/height before the PROJECT
      // workspace runs. Make sure video footage still becomes one shared AV clip object.
      if (!out.includes('rememberProjectAsset(file, "video", d)')) {
        const videoInfoAnchors = [
          '      setVideoInfo({ name: file.name, duration: d, type: file.type, width: video.videoWidth || 16, height: video.videoHeight || 9 });',
          '      setVideoInfo({ name: file.name, duration: d, type: file.type });',
        ]
        const videoInfoAnchor = videoInfoAnchors.find((anchor) => out.includes(anchor))
        required(videoInfoAnchor, 'video project registration')
        out = out.replace(videoInfoAnchor, videoInfoAnchor + '\n' + [
          '      const projectAssetId = rememberProjectAsset(file, "video", d);',
          '      attachAssetToSequence(projectAssetId, "video", d, file.name);',
          '      if (!mediaClips.length && !blocks.length && Math.abs(Number(manualDuration) - 60) < 0.001) setManualDuration(d);',
        ].join('\n'))
      }

      // A1 owns the waveform now. Remove the old standalone waveform lane.
      const standaloneWave = /\n\s*<div className="waveRow scrubSurface" style=\{\{ height: waveHeight \}\} onMouseDown=\{startPlayheadScrub\}>\s*\n\s*<canvas ref=\{waveCanvasRef\} \/>\s*\n\s*<\/div>\s*\n/
      if (standaloneWave.test(out)) out = out.replace(standaloneWave, '\n')
      else {
        const legacyWave = /\n\s*<div className="waveRow scrubSurface" onMouseDown=\{startPlayheadScrub\}>\s*\n\s*<canvas ref=\{waveCanvasRef\} \/>\s*\n\s*<\/div>\s*\n/
        if (legacyWave.test(out)) out = out.replace(legacyWave, '\n')
      }

      const a1Anchor = [
        '              <div className="projectMediaTrack audioMediaTrack">',
        '                <div className="projectMediaTrackLabel">A1</div>',
      ].join('\n')
      if (!out.includes('className="projectAudioWaveCanvas"')) {
        required(out.includes(a1Anchor), 'A1 track')
        out = out.replace(a1Anchor, [
          '              <div className="projectMediaTrack audioMediaTrack" style={{ height: waveHeight }}>',
          '                <canvas className="projectAudioWaveCanvas" ref={waveCanvasRef} />',
          '                <div className="projectMediaTrackLabel">A1</div>',
        ].join('\n'))
      }

      // Draw the waveform at the same sequence position as its linked V1 clip.
      const waveWidthAnchor = [
        '    const mediaDrawWidth = Math.min(W, Math.max(1, Number(audioInfo?.duration || videoInfo?.duration || duration)) * pps);',
        '    const bw = mediaDrawWidth / peaks.length;',
      ].join('\n')
      if (out.includes(waveWidthAnchor)) {
        out = out.replace(waveWidthAnchor, [
          '    const waveClip = mediaClips.find((clip) => clip.kind === "video" || clip.kind === "audio");',
          '    const mediaDrawLeft = Math.max(0, Number(waveClip?.start || 0) * pps);',
          '    const sourceSpan = Math.max(0.01, Number(waveClip?.duration || audioInfo?.duration || videoInfo?.duration || duration));',
          '    const mediaDrawWidth = Math.min(Math.max(0, W - mediaDrawLeft), sourceSpan * pps);',
          '    const bw = Math.max(0.0001, mediaDrawWidth / peaks.length);',
        ].join('\n'))
      } else {
        const oldWaveWidthAnchor = '    const bw = W / peaks.length;'
        required(out.includes(oldWaveWidthAnchor), 'waveform width')
        out = out.replace(oldWaveWidthAnchor, [
          '    const waveClip = mediaClips.find((clip) => clip.kind === "video" || clip.kind === "audio");',
          '    const mediaDrawLeft = Math.max(0, Number(waveClip?.start || 0) * pps);',
          '    const sourceSpan = Math.max(0.01, Number(waveClip?.duration || audioInfo?.duration || videoInfo?.duration || duration));',
          '    const mediaDrawWidth = Math.min(Math.max(0, W - mediaDrawLeft), sourceSpan * pps);',
          '    const bw = Math.max(0.0001, mediaDrawWidth / peaks.length);',
        ].join('\n'))
      }
      out = out.replace('      g.fillRect(i * bw, (H - h) / 2, Math.max(1, bw - 0.5), h);', '      g.fillRect(mediaDrawLeft + i * bw, (H - h) / 2, Math.max(1, bw - 0.5), h);')
      out = out.replace(
        '  }, [audioInfo, videoInfo, timelineW, waveHeight]);',
        '  }, [audioInfo, videoInfo, timelineW, waveHeight, mediaClips, pps]);'
      )

      // Local footage is no longer silently uploaded. Logged-in users explicitly choose
      // whether each newly selected footage file should be stored in Supabase.
      const videoCloudAnchor = [
        '      setCloudMediaStatus(cloudSession ? "영상 업로드 준비 중…" : "로그인 시 영상도 클라우드 저장");',
        '      setCloudMediaProgress(0);',
        '      if (cloudSession && !cloudMediaRestoreRef.current) {',
      ].join('\n')
      if (out.includes(videoCloudAnchor)) {
        out = out.replace(videoCloudAnchor, [
          '      const uploadVideoToCloud = !!(cloudSession && !cloudMediaRestoreRef.current && window.confirm(`“${file.name}” 푸티지를 Supabase에 업로드할까요?\\n\\n확인: 다른 PC에서도 불러오기\\n취소: 이 브라우저에서만 사용`));',
          '      setCloudMediaStatus(uploadVideoToCloud ? "영상 업로드 준비 중…" : (cloudSession && !cloudMediaRestoreRef.current ? "로컬만 사용" : "로그인 시 업로드 선택 가능"));',
          '      setCloudMediaProgress(0);',
          '      if (uploadVideoToCloud) {',
        ].join('\n'))
      }

      const audioCloudCondition = '      if (cloudSession && !cloudAudioRestoreRef.current) {'
      if (out.includes(audioCloudCondition) && !out.includes('const uploadAudioToCloud =')) {
        out = out.replace(audioCloudCondition, [
          '      const uploadAudioToCloud = !!(cloudSession && !cloudAudioRestoreRef.current && window.confirm(`“${file.name}” 푸티지를 Supabase에 업로드할까요?\\n\\n확인: 다른 PC에서도 불러오기\\n취소: 이 브라우저에서만 사용`));',
          '      if (cloudSession && !cloudAudioRestoreRef.current && !uploadAudioToCloud) {',
          '        setCloudAudioMeta(null);',
          '        setCloudAudioStatus("로컬만 사용");',
          '        setCloudAudioProgress(0);',
          '      }',
          '      if (uploadAudioToCloud) {',
        ].join('\n'))
      }

      // Make A1 visually read as an audio waveform lane while keeping the same mediaClip
      // object under V1/A1, so drag/start/duration remain linked.
      const cssAnchor = '.audioClip{border:1px solid #3d806d;background:#17352d;color:#acf1dc}'
      if (out.includes(cssAnchor) && !out.includes('.projectAudioWaveCanvas{')) {
        out = out.replace(cssAnchor, cssAnchor + [
          '.projectAudioWaveCanvas{position:absolute;left:0;top:0;width:100%;height:100%;z-index:1;pointer-events:none}',
          '.audioMediaTrack{min-height:32px;background:#0b1219;overflow:hidden}',
          '.audioMediaTrack .projectMediaTrackLabel{position:sticky;z-index:9}',
          '.audioMediaTrack .mediaClip{z-index:5;background:rgba(19,53,45,.34);border-color:rgba(87,184,154,.78)}',
          '.videoMediaTrack .mediaClip:before,.audioMediaTrack .mediaClip:before{content:"🔗";font-size:8px;margin-right:4px;opacity:.7}',
        ].join(''))
      }

      required(out.includes('rememberProjectAsset(file, "video", d)'), 'video clip registration result')
      required(out.includes('projectAudioWaveCanvas'), 'waveform moved into A1')
      required(out.includes('uploadVideoToCloud') && out.includes('uploadAudioToCloud'), 'Supabase upload prompts')

      return { code: out, map: null }
    },
  }
}
