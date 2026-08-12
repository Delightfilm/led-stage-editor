export function cloudMediaStoragePlugin() {
  return {
    name: 'cloud-media-storage-editor',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const replaceStrict = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`cloud media: ${label} anchor not found`)
        out = out.replace(from, to)
      }

      const reactImport = 'import React, { useState, useRef, useEffect, useMemo } from "react";'
      const mediaImport = 'import { uploadCloudMedia, downloadCloudMedia } from "./supabaseMedia.js";'
      if (!out.includes(mediaImport)) {
        replaceStrict(reactImport, reactImport + '\n' + mediaImport, 'media import')
      }

      const stateAnchor = '  const [cloudAudioProgress, setCloudAudioProgress] = useState(0);'
      if (!out.includes('const [cloudMediaMeta, setCloudMediaMeta]')) {
        replaceStrict(
          stateAnchor,
          stateAnchor + '\n' + [
            '  const [cloudMediaMeta, setCloudMediaMeta] = useState(null);',
            '  const [cloudMediaStatus, setCloudMediaStatus] = useState("영상 미저장");',
            '  const [cloudMediaProgress, setCloudMediaProgress] = useState(0);',
          ].join('\n'),
          'media state'
        )
      }

      const refAnchor = '  const cloudAudioRestoreRef = useRef(false);'
      if (!out.includes('cloudMediaRestoreRef')) {
        replaceStrict(refAnchor, refAnchor + '\n  const cloudMediaRestoreRef = useRef(false);', 'media restore ref')
      }

      const projectAnchor = '    audioCloud: cloudAudioMeta,'
      if (!out.includes('mediaCloud: cloudMediaMeta')) {
        replaceStrict(
          projectAnchor,
          projectAnchor + '\n    mediaName: videoInfo?.name || audioInfo?.name || null,\n    mediaCloud: cloudMediaMeta,',
          'project media metadata'
        )
      }

      const applyAnchor = '    setCloudAudioProgress(data.audioCloud ? 100 : 0);'
      if (!out.includes('setCloudMediaMeta(data.mediaCloud || null)')) {
        replaceStrict(
          applyAnchor,
          applyAnchor + '\n' + [
            '    if (videoElRef.current) { videoElRef.current.pause(); videoElRef.current.removeAttribute("src"); videoElRef.current.load(); }',
            '    setVideoInfo(null);',
            '    setCloudMediaMeta(data.mediaCloud || null);',
            '    setCloudMediaStatus(data.mediaCloud ? "클라우드 영상 연결됨" : "영상 미저장");',
            '    setCloudMediaProgress(data.mediaCloud ? 100 : 0);',
          ].join('\n'),
          'apply cloud media metadata'
        )
      }

      const selectedBlockAnchor = '  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;'
      if (!out.includes('const restoreCloudMedia = async')) {
        const helpers = [
          '  // ───────────── Supabase private video/media storage ─────────────',
          '  const restoreCloudMedia = async (meta, session = cloudSession, quiet = false) => {',
          '    if (!meta?.path || !session) return false;',
          '    setCloudMediaStatus("클라우드 영상 불러오는 중…");',
          '    setCloudMediaProgress(0);',
          '    try {',
          '      const blob = await downloadCloudMedia(session, meta);',
          '      const file = new File([blob], meta.name || "cloud-media", { type: meta.type || blob.type || "application/octet-stream" });',
          '      cloudMediaRestoreRef.current = true;',
          '      await onMediaFile(file);',
          '      setCloudMediaMeta(meta);',
          '      setCloudMediaStatus("클라우드 영상 준비됨");',
          '      setCloudMediaProgress(100);',
          '      if (!quiet) showToast("🎬 클라우드 영상을 불러왔어요.");',
          '      return true;',
          '    } catch (err) {',
          '      setCloudMediaStatus("영상 불러오기 실패");',
          '      if (!quiet) showToast("⚠️ " + (err?.message || "클라우드 영상 불러오기 실패"));',
          '      return false;',
          '    } finally {',
          '      cloudMediaRestoreRef.current = false;',
          '    }',
          '  };',
          '',
        ].join('\n')
        replaceStrict(selectedBlockAnchor, helpers + selectedBlockAnchor, 'media restore helper')
      }

      // Selecting audio supersedes the previously selected video reference.
      const audioSuccess = '      setAudioInfo({ name: file.name, duration: decoded.duration, peaks });'
      if (!out.includes('setCloudMediaStatus("영상 미저장")')) {
        replaceStrict(
          audioSuccess,
          audioSuccess + '\n      setCloudMediaMeta(null);\n      setCloudMediaStatus("영상 미저장");\n      setCloudMediaProgress(0);',
          'audio clears video metadata'
        )
      }

      const videoSuccess = '      setVideoInfo({ name: file.name, duration: d, type: file.type, width: video.videoWidth || 16, height: video.videoHeight || 9 });'
      if (!out.includes('setCloudMediaStatus("영상 업로드 준비 중…")')) {
        const uploadBlock = [
          videoSuccess,
          '      setCloudAudioMeta(null);',
          '      setCloudMediaMeta(null);',
          '      setCloudMediaStatus(cloudSession ? "영상 업로드 준비 중…" : "로그인 시 영상도 클라우드 저장");',
          '      setCloudMediaProgress(0);',
          '      if (cloudSession && !cloudMediaRestoreRef.current) {',
          '        if (file.size > 300 * 1024 * 1024) {',
          '          setCloudMediaStatus("영상 업로드 실패");',
          '          showToast("⚠️ 클라우드 영상은 300MB 이하만 업로드할 수 있어요.");',
          '        } else {',
          '          try {',
          '            const meta = await uploadCloudMedia(cloudSession, file, (pct) => {',
          '              setCloudMediaProgress(pct);',
          '              setCloudMediaStatus("영상 업로드 중 " + pct + "%");',
          '            });',
          '            setCloudMediaMeta(meta);',
          '            setCloudMediaStatus("클라우드 영상 저장됨");',
          '            setCloudMediaProgress(100);',
          '            await saveCloudProject(cloudSession, {',
          '              ...buildCloudProjectData(),',
          '              duration: d,',
          '              manualDuration: d,',
          '              audioName: null,',
          '              audioCloud: null,',
          '              mediaName: file.name,',
          '              mediaCloud: meta,',
          '            });',
          '            showToast("☁️ 영상 원본까지 클라우드에 저장했어요.");',
          '          } catch (cloudErr) {',
          '            setCloudMediaStatus("영상 업로드 실패");',
          '            showToast("⚠️ 타임라인은 유지되지만 영상 클라우드 저장에 실패했어요: " + (cloudErr?.message || "오류"));',
          '          }',
          '        }',
          '      }',
        ].join('\n')
        replaceStrict(videoSuccess, uploadBlock, 'video cloud upload')
      }

      const cloudLoad = '        applyCloudProjectData(row.project_data);\n        if (row.project_data.audioCloud?.path) await restoreCloudAudio(row.project_data.audioCloud, session, quiet);'
      const cloudLoadNew = '        applyCloudProjectData(row.project_data);\n        if (row.project_data.mediaCloud?.path) await restoreCloudMedia(row.project_data.mediaCloud, session, quiet);\n        else if (row.project_data.audioCloud?.path) await restoreCloudAudio(row.project_data.audioCloud, session, quiet);'
      replaceStrict(cloudLoad, cloudLoadNew, 'cloud media restore precedence')

      out = out.replaceAll(
        '[costumes, blocks, customPresets, manualDuration, cloudAudioMeta, cloudSession, cloudReady]',
        '[costumes, blocks, customPresets, manualDuration, cloudAudioMeta, cloudMediaMeta, cloudSession, cloudReady]'
      )

      const helpOld = '로그인 중에는 타임라인이 자동 저장되고, 선택한 MP3/WAV 원본도 비공개 Supabase Storage에 저장됩니다. 다른 기기에서 같은 계정으로 로그인하면 음원까지 자동으로 불러옵니다.'
      const helpNew = '로그인 중에는 타임라인이 자동 저장되고, 선택한 음악/영상 원본도 비공개 Supabase Storage에 저장됩니다. 영상은 300MB 이하를 지원하며, 다른 기기에서 같은 계정으로 로그인하면 미디어까지 자동으로 불러옵니다.'
      out = out.replace(helpOld, helpNew)

      const statusAnchor = '                <div className="dim">{cloudStatus}</div>'
      if (!out.includes('🎬 {cloudMediaStatus}')) {
        replaceStrict(
          statusAnchor,
          statusAnchor + '\n' + [
            '                <div className="dim" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>',
            '                  <span>🎬 {cloudMediaStatus}</span>',
            '                  <span>{cloudMediaMeta?.size ? (cloudMediaMeta.size / 1024 / 1024).toFixed(1) + " MB" : ""}</span>',
            '                </div>',
            '                {cloudMediaProgress > 0 && cloudMediaProgress < 100 && (',
            '                  <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>',
            '                    <div style={{ width: cloudMediaProgress + "%", height: "100%", background: "currentColor" }} />',
            '                  </div>',
            '                )}',
          ].join('\n'),
          'cloud media status UI'
        )
      }

      return { code: out, map: null }
    },
  }
}
