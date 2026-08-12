import { cloudVersionHistoryPlugin } from './cloudVersionHistoryPlugin.js'

export function cloudAudioStoragePlugin() {
  const base = cloudVersionHistoryPlugin()

  return {
    ...base,
    name: 'cloud-audio-storage-editor',
    transform(code, id) {
      const result = base.transform(code, id)
      if (!result) return result

      let out = typeof result === 'string' ? result : result.code

      const reactImport = 'import React, { useState, useRef, useEffect, useMemo } from "react";'
      const audioImport = 'import { uploadCloudAudio, downloadCloudAudio } from "./supabaseAudio.js";'
      if (!out.includes(audioImport)) {
        if (!out.includes(reactImport)) throw new Error('cloud audio plugin: React import anchor not found')
        out = out.replace(reactImport, reactImport + '\n' + audioImport)
      }

      const historyStateAnchor = '  const [showCloudHistory, setShowCloudHistory] = useState(false);'
      if (!out.includes('const [cloudAudioMeta, setCloudAudioMeta]')) {
        if (!out.includes(historyStateAnchor)) throw new Error('cloud audio plugin: history state anchor not found')
        out = out.replace(
          historyStateAnchor,
          historyStateAnchor + '\n' + [
            '  const [cloudAudioMeta, setCloudAudioMeta] = useState(null);',
            '  const [cloudAudioStatus, setCloudAudioStatus] = useState("음원 미저장");',
            '  const [cloudAudioProgress, setCloudAudioProgress] = useState(0);',
          ].join('\n')
        )
      }

      const snapshotRefAnchor = '  const lastCloudSnapshotAtRef = useRef(0);'
      if (!out.includes('cloudAudioRestoreRef')) {
        if (!out.includes(snapshotRefAnchor)) throw new Error('cloud audio plugin: snapshot ref anchor not found')
        out = out.replace(snapshotRefAnchor, snapshotRefAnchor + '\n  const cloudAudioRestoreRef = useRef(false);')
      }

      const audioDataAnchor = '    audioName: audioInfo?.name || null,'
      if (!out.includes('audioCloud: cloudAudioMeta')) {
        if (!out.includes(audioDataAnchor)) throw new Error('cloud audio plugin: project audio anchor not found')
        out = out.replace(audioDataAnchor, audioDataAnchor + '\n    audioCloud: cloudAudioMeta,')
      }

      const clearAudioAnchor = '    setAudioInfo(null);'
      if (!out.includes('data.audioCloud ? "클라우드 음원 연결됨"')) {
        if (!out.includes(clearAudioAnchor)) throw new Error('cloud audio plugin: clear audio anchor not found')
        out = out.replace(
          clearAudioAnchor,
          clearAudioAnchor + '\n    setCloudAudioMeta(data.audioCloud || null);\n    setCloudAudioStatus(data.audioCloud ? "클라우드 음원 연결됨" : "음원 미저장");\n    setCloudAudioProgress(data.audioCloud ? 100 : 0);'
        )
      }

      const selectedBlockAnchor = '  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;'
      if (!out.includes('const restoreCloudAudio = async')) {
        if (!out.includes(selectedBlockAnchor)) throw new Error('cloud audio plugin: selectedBlock anchor not found')
        const helpers = [
          '  // ───────────── Supabase private audio storage ─────────────',
          '  const restoreCloudAudio = async (meta, session = cloudSession, quiet = false) => {',
          '    if (!meta?.path || !session) return false;',
          '    setCloudAudioStatus("클라우드 음원 불러오는 중…");',
          '    setCloudAudioProgress(0);',
          '    try {',
          '      const blob = await downloadCloudAudio(session, meta);',
          '      const file = new File([blob], meta.name || "cloud-audio", { type: meta.type || blob.type || "application/octet-stream" });',
          '      cloudAudioRestoreRef.current = true;',
          '      await onAudioFile(file);',
          '      setCloudAudioMeta(meta);',
          '      setCloudAudioStatus("클라우드 음원 준비됨");',
          '      setCloudAudioProgress(100);',
          '      if (!quiet) showToast("🎵 클라우드 음원을 불러왔어요.");',
          '      return true;',
          '    } catch (err) {',
          '      setCloudAudioStatus("음원 불러오기 실패");',
          '      if (!quiet) showToast("⚠️ " + (err?.message || "클라우드 음원 불러오기 실패"));',
          '      return false;',
          '    } finally {',
          '      cloudAudioRestoreRef.current = false;',
          '    }',
          '  };',
          '',
        ].join('\n')
        out = out.replace(selectedBlockAnchor, helpers + selectedBlockAnchor)
      }

      const localAudioSuccessAnchor = '      setAudioInfo({ name: file.name, duration: decoded.duration, peaks });'
      if (!out.includes('setCloudAudioStatus("음원 업로드 준비 중…")')) {
        if (!out.includes(localAudioSuccessAnchor)) throw new Error('cloud audio plugin: local audio success anchor not found')
        const cloudUpload = [
          localAudioSuccessAnchor,
          '      if (cloudSession && !cloudAudioRestoreRef.current) {',
          '        try {',
          '          setCloudAudioStatus("음원 업로드 준비 중…");',
          '          setCloudAudioProgress(0);',
          '          const meta = await uploadCloudAudio(cloudSession, file, (pct) => {',
          '            setCloudAudioProgress(pct);',
          '            setCloudAudioStatus("음원 업로드 중 " + pct + "%");',
          '          });',
          '          setCloudAudioMeta(meta);',
          '          setCloudAudioStatus("클라우드 음원 저장됨");',
          '          setCloudAudioProgress(100);',
          '          await saveCloudProject(cloudSession, { ...buildCloudProjectData(), audioName: file.name, audioCloud: meta });',
          '          showToast("☁️ 음악 원본까지 클라우드에 저장했어요.");',
          '        } catch (cloudErr) {',
          '          setCloudAudioStatus("음원 업로드 실패");',
          '          showToast("⚠️ 타임라인은 유지되지만 음원 클라우드 저장에 실패했어요: " + (cloudErr?.message || "오류"));',
          '        }',
          '      }',
        ].join('\n')
        out = out.replace(localAudioSuccessAnchor, cloudUpload)
      }

      const cloudApplyAnchor = '        applyCloudProjectData(row.project_data);'
      if (!out.includes('await restoreCloudAudio(row.project_data.audioCloud')) {
        if (!out.includes(cloudApplyAnchor)) throw new Error('cloud audio plugin: cloud load anchor not found')
        out = out.replace(
          cloudApplyAnchor,
          cloudApplyAnchor + '\n        if (row.project_data.audioCloud?.path) await restoreCloudAudio(row.project_data.audioCloud, session, quiet);'
        )
      }

      out = out.replaceAll(
        '[costumes, blocks, customPresets, manualDuration, cloudSession, cloudReady]',
        '[costumes, blocks, customPresets, manualDuration, cloudAudioMeta, cloudSession, cloudReady]'
      )

      const oldAudioHelp = '로그인 중에는 타임라인 변경 후 약 1.5초 뒤 자동 저장됩니다. 음악 원본 파일은 저장하지 않으므로 다른 기기에서는 음악만 다시 선택해 주세요.'
      const newAudioHelp = '로그인 중에는 타임라인이 자동 저장되고, 선택한 MP3/WAV 원본도 비공개 Supabase Storage에 저장됩니다. 다른 기기에서 같은 계정으로 로그인하면 음원까지 자동으로 불러옵니다.'
      out = out.replace(oldAudioHelp, newAudioHelp)

      const cloudStatusAnchor = '                <div className="dim">{cloudStatus}</div>'
      if (!out.includes('cloudAudioProgress > 0 && cloudAudioProgress < 100')) {
        if (!out.includes(cloudStatusAnchor)) throw new Error('cloud audio plugin: cloud status UI anchor not found')
        const audioStatusUi = [
          cloudStatusAnchor,
          '                <div className="dim" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>',
          '                  <span>🎵 {cloudAudioStatus}</span>',
          '                  <span>{cloudAudioMeta?.size ? (cloudAudioMeta.size / 1024 / 1024).toFixed(1) + " MB" : ""}</span>',
          '                </div>',
          '                {cloudAudioProgress > 0 && cloudAudioProgress < 100 && (',
          '                  <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>',
          '                    <div style={{ width: cloudAudioProgress + "%", height: "100%", background: "currentColor" }} />',
          '                  </div>',
          '                )}',
        ].join('\n')
        out = out.replace(cloudStatusAnchor, audioStatusUi)
      }

      if (typeof result === 'string') return out
      return { ...result, code: out }
    },
  }
}
