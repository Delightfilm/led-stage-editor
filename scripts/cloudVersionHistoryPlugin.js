import { cloudResumePlugin } from './cloudResumePlugin.js'

export function cloudVersionHistoryPlugin() {
  const base = cloudResumePlugin()

  return {
    ...base,
    name: 'cloud-version-history-editor',
    transform(code, id) {
      const result = base.transform(code, id)
      if (!result) return result

      let out = typeof result === 'string' ? result : result.code

      const reactImport = 'import React, { useState, useRef, useEffect, useMemo } from "react";'
      const historyImport = 'import { createCloudVersion, listCloudVersions, pruneCloudVersions } from "./supabaseCloud.js";'
      if (!out.includes(historyImport)) {
        if (!out.includes(reactImport)) throw new Error('cloud history plugin: React import anchor not found')
        out = out.replace(reactImport, reactImport + '\n' + historyImport)
      }

      const stateAnchor = '  const [cloudPassword, setCloudPassword] = useState("");'
      if (!out.includes('const [cloudVersions, setCloudVersions]')) {
        if (!out.includes(stateAnchor)) throw new Error('cloud history plugin: state anchor not found')
        const states = [
          stateAnchor,
          '  const [cloudVersions, setCloudVersions] = useState([]);',
          '  const [cloudHistoryBusy, setCloudHistoryBusy] = useState(false);',
          '  const [showCloudHistory, setShowCloudHistory] = useState(false);',
        ].join('\n')
        out = out.replace(stateAnchor, states)
      }

      const refAnchor = '  const cloudSaveTimerRef = useRef(null);'
      if (!out.includes('cloudSnapshotTimerRef')) {
        if (!out.includes(refAnchor)) throw new Error('cloud history plugin: ref anchor not found')
        out = out.replace(
          refAnchor,
          refAnchor + '\n  const cloudSnapshotTimerRef = useRef(null);\n  const lastCloudSnapshotAtRef = useRef(0);'
        )
      }

      const selectedBlockAnchor = '  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;'
      if (!out.includes('const refreshCloudVersions = async')) {
        if (!out.includes(selectedBlockAnchor)) throw new Error('cloud history plugin: selectedBlock anchor not found')
        const helpers = [
          '  // ───────────── Supabase version history ─────────────',
          '  const refreshCloudVersions = async (session = cloudSession) => {',
          '    if (!session) return [];',
          '    setCloudHistoryBusy(true);',
          '    try {',
          '      const rows = await listCloudVersions(session, 20);',
          '      setCloudVersions(rows);',
          '      if (rows[0]?.created_at) lastCloudSnapshotAtRef.current = new Date(rows[0].created_at).getTime();',
          '      else if (!lastCloudSnapshotAtRef.current) lastCloudSnapshotAtRef.current = Date.now();',
          '      return rows;',
          '    } catch (err) {',
          '      showToast("⚠️ 버전 기록을 불러오지 못했어요: " + (err?.message || "오류"));',
          '      return [];',
          '    } finally {',
          '      setCloudHistoryBusy(false);',
          '    }',
          '  };',
          '',
          '  const saveCloudVersionSnapshot = async (quiet = true) => {',
          '    if (!cloudSession || !cloudReady) return;',
          '    try {',
          '      await createCloudVersion(cloudSession, buildCloudProjectData());',
          '      lastCloudSnapshotAtRef.current = Date.now();',
          '      await pruneCloudVersions(cloudSession, 20);',
          '      if (showCloudHistory) await refreshCloudVersions(cloudSession);',
          '      if (!quiet) showToast("🕘 현재 상태를 버전 기록에 남겼어요.");',
          '    } catch (err) {',
          '      if (!quiet) showToast("⚠️ 버전 기록 저장 실패: " + (err?.message || "오류"));',
          '    }',
          '  };',
          '',
          '  const saveCloudWithVersion = async () => {',
          '    await saveCloudNow(false);',
          '    await saveCloudVersionSnapshot(true);',
          '  };',
          '',
          '  const restoreCloudVersion = async (version) => {',
          '    if (!version?.project_data) return;',
          '    const when = version.created_at ? new Date(version.created_at).toLocaleString("ko-KR") : "선택한 시점";',
          '    if (!window.confirm(when + " 상태로 복원할까요? 현재 상태는 자동 저장되므로 필요하면 먼저 [지금 저장]을 눌러 주세요.")) return;',
          '    applyCloudProjectData(version.project_data);',
          '    setShowCloudHistory(false);',
          '    showToast("↩️ " + when + " 상태로 복원했어요. 곧 클라우드에 자동 저장됩니다.");',
          '  };',
          '',
          '  useEffect(() => {',
          '    if (!cloudSession || !cloudReady) return;',
          '    refreshCloudVersions(cloudSession);',
          '  }, [cloudSession, cloudReady]);',
          '',
          '  useEffect(() => {',
          '    if (!cloudSession || !cloudReady) return;',
          '    if (cloudSnapshotTimerRef.current) clearTimeout(cloudSnapshotTimerRef.current);',
          '    const FIVE_MIN = 5 * 60 * 1000;',
          '    const age = lastCloudSnapshotAtRef.current ? Date.now() - lastCloudSnapshotAtRef.current : 0;',
          '    const wait = Math.max(2000, FIVE_MIN - age);',
          '    cloudSnapshotTimerRef.current = setTimeout(() => saveCloudVersionSnapshot(true), wait);',
          '    return () => { if (cloudSnapshotTimerRef.current) clearTimeout(cloudSnapshotTimerRef.current); };',
          '  }, [costumes, blocks, customPresets, manualDuration, cloudSession, cloudReady]);',
          '',
        ].join('\n')
        out = out.replace(selectedBlockAnchor, helpers + selectedBlockAnchor)
      }

      out = out.replace(
        'onClick={() => saveCloudNow(false)}>☁ 지금 저장</button>',
        'onClick={saveCloudWithVersion}>☁ 지금 저장</button>'
      )

      const reloadButton = '<button className="ghostBtn" disabled={cloudBusy} onClick={() => loadCloudForSession(cloudSession)}>↻ 클라우드 작업 다시 불러오기</button>'
      if (!out.includes('🕘 버전 기록')) {
        const withHistory = [
          reloadButton,
          '                <button className="ghostBtn" disabled={cloudBusy || cloudHistoryBusy} onClick={async () => { await refreshCloudVersions(cloudSession); setShowCloudHistory(true); }}>🕘 버전 기록</button>',
        ].join('\n')
        if (!out.includes(reloadButton)) throw new Error('cloud history plugin: reload button anchor not found')
        out = out.replace(reloadButton, withHistory)
      }

      const mainAnchor = '      <div className="main">'
      if (!out.includes('클라우드 버전 기록</h2>')) {
        if (!out.includes(mainAnchor)) throw new Error('cloud history plugin: main anchor not found')
        const modal = [
          '      {showCloudHistory && (',
          '        <div style={{ position: "fixed", inset: 0, zIndex: 10020, background: "rgba(0,0,0,.68)", display: "grid", placeItems: "center", padding: 20 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCloudHistory(false); }}>',
          '          <div className="panel" style={{ width: "min(560px, 94vw)", maxHeight: "78vh", overflow: "auto", padding: 18, boxShadow: "0 20px 70px rgba(0,0,0,.6)" }}>',
          '            <div className="panelHead" style={{ marginBottom: 12 }}>',
          '              <h2>🕘 클라우드 버전 기록</h2>',
          '              <button className="iconBtn" onClick={() => setShowCloudHistory(false)}>✕</button>',
          '            </div>',
          '            <p className="dim" style={{ marginTop: 0, lineHeight: 1.5 }}>최근 20개를 보관합니다. 작업 중에는 약 5분 간격으로 스냅샷을 만들고, [지금 저장]을 누르면 즉시 버전도 남깁니다.</p>',
          '            <button className="ghostBtn" disabled={cloudHistoryBusy} onClick={() => saveCloudVersionSnapshot(false)} style={{ marginBottom: 10 }}>＋ 현재 상태 버전으로 남기기</button>',
          '            <div style={{ display: "grid", gap: 8 }}>',
          '              {cloudHistoryBusy && <div className="dim">불러오는 중…</div>}',
          '              {!cloudHistoryBusy && cloudVersions.length === 0 && <div className="dim">아직 저장된 버전이 없어요.</div>}',
          '              {cloudVersions.map((version, index) => (',
          '                <div key={version.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: "1px solid rgba(255,255,255,.09)", borderRadius: 8, padding: 10 }}>',
          '                  <div>',
          '                    <div style={{ fontWeight: 700 }}>{index === 0 ? "최신 스냅샷" : "이전 버전"}</div>',
          '                    <div className="dim" style={{ fontSize: 12 }}>{version.created_at ? new Date(version.created_at).toLocaleString("ko-KR") : ""}</div>',
          '                  </div>',
          '                  <button className="ghostBtn" onClick={() => restoreCloudVersion(version)}>이 상태로 복원</button>',
          '                </div>',
          '              ))}',
          '            </div>',
          '          </div>',
          '        </div>',
          '      )}',
          '',
          mainAnchor,
        ].join('\n')
        out = out.replace(mainAnchor, modal)
      }

      if (typeof result === 'string') return out
      return { ...result, code: out }
    },
  }
}
