export function projectFootageVisibilityFixPlugin() {
  return {
    name: 'project-footage-visibility-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const required = (ok, label) => {
        if (!ok) throw new Error(`project footage visibility: ${label} anchor not found`)
      }

      // Distinguish a background project/sequence media re-hydration from a user import.
      // Re-hydration must restore the PROGRAM source without recreating/resetting V1/A1 clips
      // or prompting for another cloud upload.
      const runtimeRefAnchor = '  const projectAssetRuntimeRef = useRef(new Map());'
      required(out.includes(runtimeRefAnchor), 'project runtime ref')
      if (!out.includes('projectMediaHydrateRef')) {
        out = out.replace(
          runtimeRefAnchor,
          runtimeRefAnchor + '\n' + [
            '  const projectMediaHydrateRef = useRef(false);',
            '  const projectMediaHydrateAssetIdRef = useRef(null);',
          ].join('\n')
        )
      }

      // If a cloud file is reconstructed as a new File object its lastModified changes.
      // During re-hydration, force it back onto the asset id already referenced by the sequence.
      const assetIdentityAnchor = [
        '    const existing = projectAssets.find((asset) => asset.signature === signature);',
        '    const assetId = existing?.id || uid();',
      ].join('\n')
      required(out.includes(assetIdentityAnchor), 'asset identity')
      out = out.replace(assetIdentityAnchor, [
        '    const forcedAssetId = projectMediaHydrateAssetIdRef.current;',
        '    const existing = projectAssets.find((asset) => asset.id === forcedAssetId || asset.signature === signature);',
        '    const assetId = forcedAssetId || existing?.id || uid();',
      ].join('\n'))

      // Background source restore must never overwrite the saved clip placement.
      out = out.replaceAll(
        'if (!cloudMediaRestoreRef.current) attachAssetToSequence(projectAssetId, "video", d, file.name);',
        'if (!cloudMediaRestoreRef.current && !projectMediaHydrateRef.current) attachAssetToSequence(projectAssetId, "video", d, file.name);'
      )
      out = out.replaceAll(
        'if (!cloudAudioRestoreRef.current) attachAssetToSequence(projectAssetId, "audio", decoded.duration, file.name);',
        'if (!cloudAudioRestoreRef.current && !projectMediaHydrateRef.current) attachAssetToSequence(projectAssetId, "audio", decoded.duration, file.name);'
      )

      // Also suppress upload prompts while we are merely reconnecting an existing project source.
      out = out.replaceAll(
        'cloudSession && !cloudMediaRestoreRef.current && window.confirm(',
        'cloudSession && !cloudMediaRestoreRef.current && !projectMediaHydrateRef.current && window.confirm('
      )
      out = out.replaceAll(
        'cloudSession && !cloudAudioRestoreRef.current && window.confirm(',
        'cloudSession && !cloudAudioRestoreRef.current && !projectMediaHydrateRef.current && window.confirm('
      )

      // Remember the cloud object on the individual PROJECT asset as well. This lets different
      // sequences/projects restore their own footage instead of relying only on one top-level mediaCloud.
      const videoUploadStart = out.indexOf('const meta = await uploadCloudMedia(cloudSession, file')
      if (videoUploadStart >= 0) {
        const videoUploadEnd = out.indexOf('        } catch (cloudErr) {', videoUploadStart)
        if (videoUploadEnd > videoUploadStart) {
          let region = out.slice(videoUploadStart, videoUploadEnd)
          const marker = '            setCloudMediaMeta(meta);'
          if (region.includes(marker) && !region.includes('cloudMeta: meta')) {
            region = region.replace(marker, marker + '\n            setProjectAssets((items) => items.map((item) => item.id === projectAssetId ? { ...item, cloudMeta: meta } : item));')
            out = out.slice(0, videoUploadStart) + region + out.slice(videoUploadEnd)
          }
        }
      }

      const audioUploadStart = out.indexOf('const meta = await uploadCloudAudio(cloudSession, file')
      if (audioUploadStart >= 0) {
        const audioUploadEnd = out.indexOf('        } catch (cloudErr) {', audioUploadStart)
        if (audioUploadEnd > audioUploadStart) {
          let region = out.slice(audioUploadStart, audioUploadEnd)
          const marker = '          setCloudAudioMeta(meta);'
          if (region.includes(marker) && !region.includes('cloudMeta: meta')) {
            region = region.replace(marker, marker + '\n          setProjectAssets((items) => items.map((item) => item.id === projectAssetId ? { ...item, cloudMeta: meta } : item));')
            out = out.slice(0, audioUploadStart) + region + out.slice(audioUploadEnd)
          }
        }
      }

      // Replace the cloud-only project restore with a source-aware restore:
      // 1) current-browser File from runtime bin, 2) per-asset cloud object,
      // 3) legacy top-level cloud metadata.
      const restoreStart = out.indexOf('  const restoreProjectMedia = async (data) => {')
      const activateStart = out.indexOf('  const activateProjectRecord =', restoreStart)
      required(restoreStart >= 0 && activateStart > restoreStart, 'project media restore bounds')

      const restoreHelpers = `  const projectSequenceForData = (data) => {
    const list = Array.isArray(data?.sequences) ? data.sequences : [];
    if (!list.length) return null;
    return list.find((seq) => seq.id === data.activeSequenceId) || list[0] || null;
  };

  const primaryMediaClip = (seq) => {
    const clips = Array.isArray(seq?.mediaClips) ? seq.mediaClips : [];
    const t = Math.max(0, Number(seq?.playhead) || 0);
    return clips.find((clip) => t >= Number(clip.start || 0) && t < Number(clip.start || 0) + Number(clip.duration || 0))
      || clips.find((clip) => clip.kind === 'video')
      || clips.find((clip) => clip.kind === 'audio')
      || clips[0]
      || null;
  };

  const clearProgramSource = () => {
    pause();
    if (videoElRef.current) {
      videoElRef.current.pause();
      videoElRef.current.removeAttribute('src');
      videoElRef.current.load();
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.removeAttribute('src');
      audioElRef.current.load();
    }
    setVideoInfo(null);
    setAudioInfo(null);
    setLoadedProjectAssetId(null);
  };

  const hydrateProjectMediaSource = async ({ clip, asset, runtimeFile, videoMeta, audioMeta, session, quiet = true }) => {
    if (!clip) return false;
    const assetId = clip.assetId || asset?.id || null;
    const kind = clip.kind || asset?.kind || (videoMeta?.path ? 'video' : 'audio');
    projectMediaHydrateRef.current = true;
    projectMediaHydrateAssetIdRef.current = assetId;
    try {
      if (runtimeFile) {
        await onMediaFile(runtimeFile);
        if (kind === 'video' && videoMeta?.path) {
          setCloudMediaMeta(videoMeta);
          setCloudMediaStatus('클라우드 영상 연결됨');
          setCloudMediaProgress(100);
        } else if (kind === 'audio' && audioMeta?.path) {
          setCloudAudioMeta(audioMeta);
          setCloudAudioStatus('클라우드 음원 연결됨');
          setCloudAudioProgress(100);
        }
        if (assetId) setLoadedProjectAssetId(assetId);
        return true;
      }

      if (!session) return false;
      const meta = asset?.cloudMeta || (kind === 'video' ? videoMeta : audioMeta);
      if (!meta?.path) return false;
      const ok = kind === 'video'
        ? await restoreCloudMedia(meta, session, quiet)
        : await restoreCloudAudio(meta, session, quiet);
      if (ok && assetId) setLoadedProjectAssetId(assetId);
      return !!ok;
    } finally {
      projectMediaHydrateAssetIdRef.current = null;
      projectMediaHydrateRef.current = false;
    }
  };

  const restoreProjectMedia = async (data) => {
    if (!data) return false;
    try {
      const seq = projectSequenceForData(data);
      const clip = primaryMediaClip(seq);
      const assets = Array.isArray(data.projectAssets) ? data.projectAssets : [];
      const asset = clip?.assetId ? assets.find((item) => item.id === clip.assetId) : null;
      const runtimeFile = clip?.assetId ? projectAssetRuntimeRef.current.get(clip.assetId) : null;

      if (clip) {
        const restored = await hydrateProjectMediaSource({
          clip,
          asset,
          runtimeFile,
          videoMeta: asset?.kind === 'video' ? (asset.cloudMeta || data.mediaCloud) : data.mediaCloud,
          audioMeta: asset?.kind === 'audio' ? (asset.cloudMeta || data.audioCloud) : data.audioCloud,
          session: cloudSession,
          quiet: true,
        });
        if (restored) return true;
      }

      // Legacy projects may have no mediaClips yet but still have one cloud source.
      if (cloudSession && data.mediaCloud?.path) return await restoreCloudMedia(data.mediaCloud, cloudSession, true);
      if (cloudSession && data.audioCloud?.path) return await restoreCloudAudio(data.audioCloud, cloudSession, true);
      return false;
    } catch (err) {
      console.warn('project media restore failed', err);
      return false;
    }
  };

  const restoreSequenceFootage = async (seq) => {
    if (!seq) return false;
    const clip = primaryMediaClip(seq);
    if (!clip) {
      clearProgramSource();
      return false;
    }
    const asset = projectAssets.find((item) => item.id === clip.assetId) || null;
    const runtimeFile = clip.assetId ? projectAssetRuntimeRef.current.get(clip.assetId) : null;
    const restored = await hydrateProjectMediaSource({
      clip,
      asset,
      runtimeFile,
      videoMeta: asset?.kind === 'video' ? (asset.cloudMeta || cloudMediaMeta) : cloudMediaMeta,
      audioMeta: asset?.kind === 'audio' ? (asset.cloudMeta || cloudAudioMeta) : cloudAudioMeta,
      session: cloudSession,
      quiet: true,
    });
    if (!restored) {
      clearProgramSource();
      setLoadedProjectAssetId(clip.assetId || null);
    } else {
      window.setTimeout(() => syncMediaForSequenceTime(Number(seq.playhead) || 0, false), 0);
    }
    return restored;
  };

`
      out = out.slice(0, restoreStart) + restoreHelpers + out.slice(activateStart)

      // Switching sequences also has to swap the PROGRAM monitor source. Previously only
      // blocks/formations/mediaClips changed, leaving videoInfo/src stale or empty.
      const seqStart = out.indexOf('  const activateSequenceSnapshot = (seq, list) => {')
      const seqEnd = out.indexOf('  const switchSequence = (id) => {', seqStart)
      required(seqStart >= 0 && seqEnd > seqStart, 'sequence activation bounds')
      let seqRegion = out.slice(seqStart, seqEnd)
      const seqTail = '    setSnapGuide(null);\n  };'
      required(seqRegion.includes(seqTail), 'sequence activation tail')
      if (!seqRegion.includes('restoreSequenceFootage(seq)')) {
        seqRegion = seqRegion.replace(seqTail, '    setSnapGuide(null);\n    window.setTimeout(() => restoreSequenceFootage(seq), 0);\n  };')
        out = out.slice(0, seqStart) + seqRegion + out.slice(seqEnd)
      }

      required(out.includes('hydrateProjectMediaSource'), 'hydrate helper')
      required(out.includes('restoreSequenceFootage(seq)'), 'sequence footage restore')
      required(out.includes('projectMediaHydrateRef.current'), 'hydrate guard')

      return { code: out, map: null }
    },
  }
}
