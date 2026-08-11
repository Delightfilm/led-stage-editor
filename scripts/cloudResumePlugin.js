import { nrf24CompressedLiveCodePlugin } from './nrf24CompressedLiveCodePlugin.js'

export function cloudResumePlugin() {
  const base = nrf24CompressedLiveCodePlugin()

  return {
    ...base,
    name: 'cloud-resume-editor',
    transform(code, id) {
      const result = base.transform(code, id)
      if (!result) return result

      let out = typeof result === 'string' ? result : result.code

      const reactImport = 'import React, { useState, useRef, useEffect, useMemo } from "react";'
      const cloudImport = 'import { getCloudSession, signUpCloud, signInCloud, signOutCloud, loadCloudProject, saveCloudProject } from "./supabaseCloud.js";'
      if (!out.includes(cloudImport)) {
        if (!out.includes(reactImport)) throw new Error('cloud resume plugin: React import anchor not found')
        out = out.replace(reactImport, reactImport + '\n' + cloudImport)
      }

      const stateAnchor = '  const [exportSelected, setExportSelected] = useState({});'
      if (!out.includes('const [cloudUser, setCloudUser]')) {
        const cloudStates = [
          '  const [cloudUser, setCloudUser] = useState(null);',
          '  const [cloudSession, setCloudSession] = useState(null);',
          '  const [cloudReady, setCloudReady] = useState(false);',
          '  const [cloudBusy, setCloudBusy] = useState(false);',
          '  const [cloudStatus, setCloudStatus] = useState("로그인 안 됨");',
          '  const [showCloudAuth, setShowCloudAuth] = useState(false);',
          '  const [cloudEmail, setCloudEmail] = useState("");',
          '  const [cloudPassword, setCloudPassword] = useState("");',
        ].join('\n')
        if (!out.includes(stateAnchor)) throw new Error('cloud resume plugin: state anchor not found')
        out = out.replace(stateAnchor, stateAnchor + '\n' + cloudStates)
      }

      const refAnchor = '  const lastCommitRef = useRef({ key: null, time: 0 });'
      if (!out.includes('cloudSaveTimerRef')) {
        if (!out.includes(refAnchor)) throw new Error('cloud resume plugin: ref anchor not found')
        out = out.replace(refAnchor, refAnchor + '\n  const cloudSaveTimerRef = useRef(null);')
      }

      const selectedBlockAnchor = '  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;'
      if (!out.includes('const buildCloudProjectData = () =>')) {
        if (!out.includes(selectedBlockAnchor)) throw new Error('cloud resume plugin: selectedBlock anchor not found')
        const helpers = [
          '  // ───────────── Supabase cloud resume ─────────────',
          '  const buildCloudProjectData = () => ({',
          '    version: 3,',
          '    savedAt: new Date().toISOString(),',
          '    duration,',
          '    manualDuration,',
          '    audioName: audioInfo?.name || null,',
          '    costumes,',
          '    blocks,',
          '    customPresets,',
          '  });',
          '',
          '  const applyCloudProjectData = (data) => {',
          '    if (!data || typeof data !== "object") return;',
          '    historyRef.current = [];',
          '    futureRef.current = [];',
          '    if (Array.isArray(data.costumes)) setCostumes(data.costumes);',
          '    if (Array.isArray(data.blocks)) setBlocks(data.blocks);',
          '    if (Array.isArray(data.customPresets)) {',
          '      const restored = data.customPresets.map((p) => normalizeCustomPreset(p));',
          '      updateCustomPresets(restored);',
          '    }',
          '    const restoredDuration = Number(data.duration || data.manualDuration);',
          '    if (isFinite(restoredDuration) && restoredDuration > 0) setManualDuration(restoredDuration);',
          '    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }',
          '    if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current.removeAttribute("src"); audioElRef.current.load(); }',
          '    setAudioInfo(null);',
          '    setPlaying(false);',
          '    setCurrentTime(0);',
          '    setSelectedBlockId(null);',
          '    setPreviewCostumeId(data.costumes?.[0]?.id ?? null);',
          '  };',
          '',
          '  const loadCloudForSession = async (session, quiet = false) => {',
          '    if (!session) return;',
          '    setCloudBusy(true);',
          '    setCloudReady(false);',
          '    try {',
          '      const row = await loadCloudProject(session);',
          '      if (row?.project_data) {',
          '        applyCloudProjectData(row.project_data);',
          '        const saved = row.updated_at ? new Date(row.updated_at).toLocaleString("ko-KR") : "";',
          '        setCloudStatus(saved ? "불러옴 · " + saved : "클라우드에서 불러옴");',
          '        if (!quiet) showToast("☁️ 클라우드 작업을 이어서 불러왔어요.");',
          '        if (row.project_data.audioName && !quiet) showToast("🎵 음악 파일은 이 기기에서 다시 선택해 주세요.");',
          '      } else {',
          '        setCloudStatus("새 클라우드 작업");',
          '        if (!quiet) showToast("☁️ 저장된 작업이 없어 현재 작업부터 저장할게요.");',
          '      }',
          '      setCloudReady(true);',
          '    } catch (err) {',
          '      setCloudStatus("불러오기 실패");',
          '      showToast("⚠️ " + (err?.message || "클라우드 불러오기 실패"));',
          '    } finally {',
          '      setCloudBusy(false);',
          '    }',
          '  };',
          '',
          '  const saveCloudNow = async (quiet = false) => {',
          '    if (!cloudSession || !cloudReady) return;',
          '    setCloudBusy(true);',
          '    if (!quiet) setCloudStatus("저장 중…");',
          '    try {',
          '      const row = await saveCloudProject(cloudSession, buildCloudProjectData());',
          '      const savedAt = row?.updated_at ? new Date(row.updated_at) : new Date();',
          '      setCloudStatus("저장됨 · " + savedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));',
          '      if (!quiet) showToast("☁️ 클라우드에 저장했어요.");',
          '    } catch (err) {',
          '      setCloudStatus("저장 실패");',
          '      if (!quiet) showToast("⚠️ " + (err?.message || "클라우드 저장 실패"));',
          '    } finally {',
          '      setCloudBusy(false);',
          '    }',
          '  };',
          '',
          '  const handleCloudLogin = async () => {',
          '    if (!cloudEmail.trim() || cloudPassword.length < 6) { showToast("⚠️ 이메일과 6자 이상 비밀번호를 입력해 주세요."); return; }',
          '    setCloudBusy(true);',
          '    try {',
          '      const session = await signInCloud(cloudEmail.trim(), cloudPassword);',
          '      setCloudSession(session);',
          '      setCloudUser(session?.user || null);',
          '      setCloudStatus("로그인됨");',
          '      setShowCloudAuth(false);',
          '      await loadCloudForSession(session);',
          '    } catch (err) {',
          '      showToast("⚠️ " + (err?.message || "로그인 실패"));',
          '    } finally { setCloudBusy(false); }',
          '  };',
          '',
          '  const handleCloudSignup = async () => {',
          '    if (!cloudEmail.trim() || cloudPassword.length < 6) { showToast("⚠️ 이메일과 6자 이상 비밀번호를 입력해 주세요."); return; }',
          '    setCloudBusy(true);',
          '    try {',
          '      const result = await signUpCloud(cloudEmail.trim(), cloudPassword);',
          '      if (result?.access_token) {',
          '        const session = result;',
          '        setCloudSession(session);',
          '        setCloudUser(session.user || null);',
          '        setShowCloudAuth(false);',
          '        setCloudStatus("가입 완료");',
          '        setCloudReady(true);',
          '        showToast("☁️ 가입 완료! 현재 작업을 자동 저장할게요.");',
          '      } else {',
          '        showToast("📧 가입 확인 메일을 보냈어요. 확인 후 로그인해 주세요.");',
          '      }',
          '    } catch (err) {',
          '      showToast("⚠️ " + (err?.message || "회원가입 실패"));',
          '    } finally { setCloudBusy(false); }',
          '  };',
          '',
          '  const handleCloudLogout = async () => {',
          '    setCloudBusy(true);',
          '    try { await signOutCloud(); } finally {',
          '      setCloudSession(null);',
          '      setCloudUser(null);',
          '      setCloudReady(false);',
          '      setCloudStatus("로그인 안 됨");',
          '      setShowCloudAuth(false);',
          '      setCloudBusy(false);',
          '      showToast("☁️ 로그아웃했어요.");',
          '    }',
          '  };',
          '',
          '  useEffect(() => {',
          '    let cancelled = false;',
          '    (async () => {',
          '      const session = await getCloudSession();',
          '      if (cancelled || !session) return;',
          '      setCloudSession(session);',
          '      setCloudUser(session.user || null);',
          '      setCloudStatus("로그인 복구됨");',
          '      await loadCloudForSession(session, true);',
          '    })();',
          '    return () => { cancelled = true; };',
          '  }, []);',
          '',
          '  useEffect(() => {',
          '    if (!cloudSession || !cloudReady) return;',
          '    if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current);',
          '    cloudSaveTimerRef.current = setTimeout(() => saveCloudNow(true), 1500);',
          '    return () => { if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current); };',
          '  }, [costumes, blocks, customPresets, manualDuration, cloudSession, cloudReady]);',
          '',
        ].join('\n')
        out = out.replace(selectedBlockAnchor, helpers + selectedBlockAnchor)
      }

      const toolbarAnchor = '          <button className="tbtn compact tip" data-tip="MP3 / WAV 업로드" onClick={() => fileInputRef.current.click()}>🎵 음악</button>'
      if (!out.includes('data-tip="다른 기기에서 이어하기')) {
        if (!out.includes(toolbarAnchor)) throw new Error('cloud resume plugin: toolbar anchor not found')
        const cloudButton = [
          '          <button',
          '            className="tbtn compact tip"',
          '            data-tip="다른 기기에서 이어하기 · 로그인하면 자동 클라우드 저장"',
          '            onClick={() => setShowCloudAuth(true)}',
          '          >',
          '            {cloudUser ? "☁ " + (cloudUser.email || "로그인") : "☁ 이어하기"}',
          '          </button>',
          toolbarAnchor,
        ].join('\n')
        out = out.replace(toolbarAnchor, cloudButton)
      }

      const headerAnchor = '      </header>\n\n      <div className="main">'
      if (!out.includes('클라우드 이어하기</h2>')) {
        if (!out.includes(headerAnchor)) throw new Error('cloud resume plugin: header anchor not found')
        const modal = [
          '      </header>',
          '',
          '      {showCloudAuth && (',
          '        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.62)", display: "grid", placeItems: "center", padding: 20 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCloudAuth(false); }}>',
          '          <div className="panel" style={{ width: "min(420px, 92vw)", padding: 18, boxShadow: "0 20px 70px rgba(0,0,0,.55)" }}>',
          '            <div className="panelHead" style={{ marginBottom: 12 }}>',
          '              <h2>☁ 클라우드 이어하기</h2>',
          '              <button className="iconBtn" onClick={() => setShowCloudAuth(false)}>✕</button>',
          '            </div>',
          '            {cloudUser ? (',
          '              <div style={{ display: "grid", gap: 10 }}>',
          '                <div><b>{cloudUser.email}</b></div>',
          '                <div className="dim">{cloudStatus}</div>',
          '                <button className="primaryBtn" disabled={cloudBusy} onClick={() => saveCloudNow(false)}>☁ 지금 저장</button>',
          '                <button className="ghostBtn" disabled={cloudBusy} onClick={() => loadCloudForSession(cloudSession)}>↻ 클라우드 작업 다시 불러오기</button>',
          '                <button className="ghostBtn" disabled={cloudBusy} onClick={handleCloudLogout}>로그아웃</button>',
          '                <p className="dim" style={{ margin: 0, lineHeight: 1.5 }}>로그인 중에는 타임라인 변경 후 약 1.5초 뒤 자동 저장됩니다. 음악 원본 파일은 저장하지 않으므로 다른 기기에서는 음악만 다시 선택해 주세요.</p>',
          '              </div>',
          '            ) : (',
          '              <div style={{ display: "grid", gap: 10 }}>',
          '                <input type="email" autoComplete="email" placeholder="이메일" value={cloudEmail} onChange={(e) => setCloudEmail(e.target.value)} style={{ width: "100%" }} />',
          '                <input type="password" autoComplete="current-password" placeholder="비밀번호 (6자 이상)" value={cloudPassword} onChange={(e) => setCloudPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleCloudLogin(); }} style={{ width: "100%" }} />',
          '                <div style={{ display: "flex", gap: 8 }}>',
          '                  <button className="primaryBtn" style={{ flex: 1 }} disabled={cloudBusy} onClick={handleCloudLogin}>{cloudBusy ? "처리 중…" : "로그인"}</button>',
          '                  <button className="ghostBtn" style={{ flex: 1 }} disabled={cloudBusy} onClick={handleCloudSignup}>회원가입</button>',
          '                </div>',
          '                <p className="dim" style={{ margin: 0, lineHeight: 1.5 }}>한 번 로그인하면 다음 접속에서도 세션을 복구하고, 저장된 타임라인을 자동으로 불러옵니다.</p>',
          '              </div>',
          '            )}',
          '          </div>',
          '        </div>',
          '      )}',
          '',
          '      <div className="main">',
        ].join('\n')
        out = out.replace(headerAnchor, modal)
      }

      if (typeof result === 'string') return out
      return { ...result, code: out }
    },
  }
}
