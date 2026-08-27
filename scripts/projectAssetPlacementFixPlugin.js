export function projectAssetPlacementFixPlugin() {
  return {
    name: 'project-asset-placement-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const startAnchor = '  const loadProjectAsset = async (assetId) => {'
      const deleteHelperAnchor = '  const preserveDeletedFootageClip = (clip, asset) => {'
      const sequenceAnchor = '  const updateSequenceDuration = (id, value) => {'
      const start = out.indexOf(startAnchor)
      const deleteHelperStart = out.indexOf(deleteHelperAnchor, start)
      const sequenceStart = out.indexOf(sequenceAnchor, start)
      // projectFootageDeletePlugin runs before this plugin and inserts its delete helpers
      // between loadProjectAsset() and updateSequenceDuration(). Only replace
      // loadProjectAsset(); never slice away the delete helper block.
      const end = deleteHelperStart > start ? deleteHelperStart : sequenceStart
      const hadDeleteHelper = out.includes('const deleteProjectAsset =')
      if (start < 0 || end <= start) throw new Error('project asset placement fix: loadProjectAsset bounds not found')

      const replacement = `  const loadProjectAsset = async (assetId) => {
    const asset = projectAssets.find((item) => item.id === assetId);
    if (!asset) {
      showToast("⚠️ FOOTAGE 항목을 찾을 수 없어요.");
      return;
    }

    const placeOnActiveSequence = () => {
      attachAssetToSequence(
        asset.id,
        asset.kind || 'video',
        Math.max(0.01, Number(asset.duration) || 0.01),
        asset.name,
      );
      setLoadedProjectAssetId(asset.id);
      showToast('🎞 “' + (asset.name || 'Footage') + '”를 현재 시퀀스에 배치했어요.');
    };

    // The source can already be open in PROGRAM even when the transient File map was
    // lost/re-keyed. In that case placing the clip must not ask for the original file again.
    const sourceAlreadyLoaded = loadedProjectAssetId === asset.id && (
      (asset.kind === 'video' && !!videoInfo)
      || (asset.kind === 'audio' && !!audioInfo)
      || (!asset.kind && (!!videoInfo || !!audioInfo))
    );
    if (sourceAlreadyLoaded) {
      placeOnActiveSequence();
      return;
    }

    // Normal same-browser path: the File object is retained in memory by asset id.
    let runtimeFile = projectAssetRuntimeRef.current.get(asset.id) || null;

    // Recover from an id mismatch by matching the persisted asset signature against every
    // in-memory File. This covers project/collection state rewrites without forcing a re-pick.
    if (!runtimeFile && asset.signature) {
      for (const candidate of projectAssetRuntimeRef.current.values()) {
        if (!candidate) continue;
        const candidateKind = asset.kind || (String(candidate.type || '').startsWith('video/') ? 'video' : 'audio');
        const candidateSignature = \`${'${candidateKind}'}:${'${candidate.name || ""}'}:${'${Number(candidate.size) || 0}'}:${'${Number(candidate.lastModified) || 0}'}\`;
        if (candidateSignature !== asset.signature) continue;
        runtimeFile = candidate;
        projectAssetRuntimeRef.current.set(asset.id, candidate);
        break;
      }
    }

    const clip = {
      id: 'project-bin-' + asset.id,
      assetId: asset.id,
      kind: asset.kind || 'video',
      name: asset.name || 'Footage',
      start: 0,
      in: 0,
      duration: Math.max(0.01, Number(asset.duration) || 0.01),
      sourceDuration: Math.max(0.01, Number(asset.duration) || 0.01),
      cloudMeta: asset.cloudMeta || null,
    };

    // Prefer the exact per-asset cloud object. Legacy top-level cloud metadata is only safe
    // when its recorded file name matches this asset.
    const matchingVideoMeta = asset.kind === 'video'
      ? (asset.cloudMeta || (cloudMediaMeta?.path && cloudMediaMeta?.name === asset.name ? cloudMediaMeta : null))
      : null;
    const matchingAudioMeta = asset.kind === 'audio'
      ? (asset.cloudMeta || (cloudAudioMeta?.path && cloudAudioMeta?.name === asset.name ? cloudAudioMeta : null))
      : null;

    try {
      const restored = await hydrateProjectMediaSource({
        clip,
        asset,
        runtimeFile,
        videoMeta: matchingVideoMeta,
        audioMeta: matchingAudioMeta,
        session: cloudSession,
        quiet: true,
      });
      if (restored) {
        placeOnActiveSequence();
        return;
      }
    } catch (err) {
      console.warn('project footage placement source restore failed', err);
    }

    // A local-only File cannot survive a full browser reload by design. Ask for a re-pick
    // only after the already-loaded, in-memory, signature-recovery and cloud paths all fail.
    showToast("📁 이 로컬 푸티지의 원본 파일 연결이 끊겼어요. 파일을 한 번만 다시 선택해 주세요.");
  };

`

      out = out.slice(0, start) + replacement + out.slice(end)

      if (!out.includes('sourceAlreadyLoaded') || !out.includes('candidateSignature') || !out.includes('hydrateProjectMediaSource')) {
        throw new Error('project asset placement fix: build assertion failed')
      }
      if (hadDeleteHelper && !out.includes('const deleteProjectAsset =')) {
        throw new Error('project asset placement fix: footage delete helper was removed')
      }

      return { code: out, map: null }
    },
  }
}
