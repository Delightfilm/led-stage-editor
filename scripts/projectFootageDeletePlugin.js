export function projectFootageDeletePlugin() {
  return {
    name: 'project-footage-delete',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const required = (ok, label) => {
        if (!ok) throw new Error(`project footage delete: ${label} anchor not found`)
      }

      // Delete only the PROJECT-bin entry. Sequence clips remain intact and receive enough
      // source metadata to reconnect later even after their projectAssets row is gone.
      const helperAnchor = '  const updateSequenceDuration = (id, value) => {'
      required(out.includes(helperAnchor), 'helper insertion')
      if (!out.includes('const deleteProjectAsset =')) {
        const helpers = String.raw`  const preserveDeletedFootageClip = (clip, asset) => {
    if (!clip || !asset || clip.assetId !== asset.id) return clip;
    return {
      ...clip,
      name: clip.name || asset.name || 'Footage',
      kind: clip.kind || asset.kind || 'video',
      sourceDuration: Math.max(0.01, Number(clip.sourceDuration || asset.duration) || 0.01),
      cloudMeta: clip.cloudMeta || asset.cloudMeta || null,
      footageDeleted: true,
    };
  };

  const deleteProjectAsset = (assetId) => {
    const asset = projectAssets.find((item) => item.id === assetId);
    if (!asset) return;

    const usedInActiveSequence = mediaClips.some((clip) => clip.assetId === assetId);
    const usedInSavedSequence = sequences.some((seq) => Array.isArray(seq?.mediaClips) && seq.mediaClips.some((clip) => clip.assetId === assetId));
    const usedBySequence = usedInActiveSequence || usedInSavedSequence;
    const usageNotice = usedBySequence
      ? '\n\n이 푸티지는 시퀀스에서 사용 중입니다. 시퀀스의 클립 위치 · 길이 · IN/OUT · 타이밍 데이터는 그대로 유지됩니다.'
      : '\n\n시퀀스 데이터에는 영향을 주지 않습니다.';

    if (!window.confirm('“' + (asset.name || 'Footage') + '”를 FOOTAGE 목록에서 삭제할까요?' + usageNotice)) return;

    // Preserve current active-sequence clips and every stored sequence snapshot.
    setMediaClips((clips) => clips.map((clip) => preserveDeletedFootageClip(clip, asset)));
    setSequences((list) => list.map((seq) => ({
      ...seq,
      mediaClips: Array.isArray(seq?.mediaClips)
        ? seq.mediaClips.map((clip) => preserveDeletedFootageClip(clip, asset))
        : [],
    })));

    // Remove only the footage-bin metadata row. Never remove a sequence clip here.
    setProjectAssets((items) => items.filter((item) => item.id !== assetId));
    if (loadedProjectAssetId === assetId) setLoadedProjectAssetId(null);

    // A runtime File is still useful while a surviving sequence references this asset.
    // If nothing references it, release the in-memory File and clear an orphan PROGRAM source.
    if (!usedBySequence) {
      projectAssetRuntimeRef.current.delete(assetId);
      if (loadedProjectAssetId === assetId && typeof clearProgramSource === 'function') clearProgramSource();
    }

    showToast(usedBySequence
      ? '🗑 FOOTAGE에서 삭제했어요. 시퀀스 데이터는 그대로 유지됩니다.'
      : '🗑 FOOTAGE를 삭제했어요.');
  };

`
        out = out.replace(helperAnchor, helpers + helperAnchor)
      }

      // If the bin row was removed but a sequence still owns the clip, prefer the metadata
      // copied onto the clip itself when reconnecting cloud media.
      const hydrateMetaAnchor = "      const meta = asset?.cloudMeta || (kind === 'video' ? videoMeta : audioMeta);"
      required(out.includes(hydrateMetaAnchor), 'hydrate cloud meta')
      out = out.replace(
        hydrateMetaAnchor,
        "      const meta = clip?.cloudMeta || asset?.cloudMeta || (kind === 'video' ? videoMeta : audioMeta);"
      )

      out = out.replaceAll(
        "videoMeta: asset?.kind === 'video' ? (asset.cloudMeta || data.mediaCloud) : data.mediaCloud,",
        "videoMeta: (clip?.kind || asset?.kind) === 'video' ? (clip?.cloudMeta || asset?.cloudMeta || data.mediaCloud) : data.mediaCloud,"
      )
      out = out.replaceAll(
        "audioMeta: asset?.kind === 'audio' ? (asset.cloudMeta || data.audioCloud) : data.audioCloud,",
        "audioMeta: (clip?.kind || asset?.kind) === 'audio' ? (clip?.cloudMeta || asset?.cloudMeta || data.audioCloud) : data.audioCloud,"
      )
      out = out.replaceAll(
        "videoMeta: asset?.kind === 'video' ? (asset.cloudMeta || cloudMediaMeta) : cloudMediaMeta,",
        "videoMeta: (clip?.kind || asset?.kind) === 'video' ? (clip?.cloudMeta || asset?.cloudMeta || cloudMediaMeta) : cloudMediaMeta,"
      )
      out = out.replaceAll(
        "audioMeta: asset?.kind === 'audio' ? (asset.cloudMeta || cloudAudioMeta) : cloudAudioMeta,",
        "audioMeta: (clip?.kind || asset?.kind) === 'audio' ? (clip?.cloudMeta || asset?.cloudMeta || cloudAudioMeta) : cloudAudioMeta,"
      )

      const buttonAnchor = '                      <button type="button" onClick={() => loadProjectAsset(asset.id)}>{asset.id === loadedProjectAssetId ? "재배치" : "시퀀스에 배치"}</button>'
      required(out.includes(buttonAnchor), 'footage row button')
      out = out.replace(buttonAnchor, [
        '                      <div className="projectAssetActions">',
        '                        <button type="button" onClick={() => loadProjectAsset(asset.id)}>{asset.id === loadedProjectAssetId ? "재배치" : "시퀀스에 배치"}</button>',
        '                        <button type="button" className="projectAssetDeleteBtn" onClick={() => deleteProjectAsset(asset.id)}>삭제</button>',
        '                      </div>',
      ].join('\n'))

      const cssAnchor = '.projectAssetRow button{border:1px solid #344151;border-radius:4px;background:#1a222d;color:#aebbd0;font-size:9px;padding:4px 6px;cursor:pointer}'
      required(out.includes(cssAnchor), 'footage row css')
      if (!out.includes('.projectAssetActions{')) {
        out = out.replace(cssAnchor, cssAnchor + [
          '.projectAssetActions{display:flex;align-items:center;gap:4px;white-space:nowrap}',
          '.projectAssetActions .projectAssetDeleteBtn{border-color:#623741;background:#27181c;color:#ff929d}',
          '.projectAssetActions .projectAssetDeleteBtn:hover{border-color:#a95060;background:#351b21;color:#ffc0c7}',
        ].join(''))
      }

      required(out.includes('preserveDeletedFootageClip'), 'non-destructive delete helper')
      required(out.includes('projectAssetDeleteBtn'), 'delete button')
      required(out.includes('clip?.cloudMeta || asset?.cloudMeta'), 'deleted clip cloud fallback')

      return { code: out, map: null }
    },
  }
}
