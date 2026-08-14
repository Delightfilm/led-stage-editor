export function accountTransferPlugin() {
  return {
    name: 'account-transfer-json',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null

      const saveMatch = /\bconst\s+saveProject\s*=\s*\(\s*\)\s*=>\s*\{/.exec(code)
      const loadMatch = /\bconst\s+loadProject\s*=\s*async\s*\(\s*file\s*\)\s*=>\s*\{/.exec(code)
      const arduinoMatch = /\bconst\s+arduinoExportTargets\s*=\s*useMemo\s*\(\s*\(\s*\)\s*=>\s*\{/.exec(code)
      const saveStart = saveMatch?.index ?? -1
      const loadStart = loadMatch?.index ?? -1
      const afterLoad = arduinoMatch?.index ?? -1
      if (saveStart < 0 || loadStart <= saveStart || afterLoad <= loadStart) {
        throw new Error(`account transfer plugin: project anchors not found save=${saveStart} load=${loadStart} arduino=${afterLoad}`)
      }

      const indentStart = code.lastIndexOf('\n', saveStart) + 1
      const indent = code.slice(indentStart, saveStart)
      const replacement = `${indent}// ───────────── Account-portable JSON transfer ─────────────
${indent}const TRANSFER_FORMAT = "led-stage-project-transfer-v1";
${indent}const MAX_TRANSFER_FILE_BYTES = 5 * 1024 * 1024;
${indent}const PRIVATE_TRANSFER_KEYS = new Set([
${indent}  "access_token", "refresh_token", "provider_token", "provider_refresh_token",
${indent}  "authorization", "session", "user_id", "email", "phone"
${indent}]);

${indent}const cloneForAccountTransfer = (projectData) => {
${indent}  const cloned = JSON.parse(JSON.stringify(projectData || {}, (key, value) => {
${indent}    const lower = String(key || "").toLowerCase();
${indent}    if (PRIVATE_TRANSFER_KEYS.has(lower)) return undefined;
${indent}    // Supabase Storage objects are private and scoped to the source account.
${indent}    // Never carry their paths into another account through JSON.
${indent}    if (key === "audioCloud" || key === "mediaCloud") return null;
${indent}    return value;
${indent}  }));
${indent}  return cloned && typeof cloned === "object" && !Array.isArray(cloned) ? cloned : {};
${indent}};

${indent}const normalizeImportedTransfer = (raw) => {
${indent}  let source = raw;
${indent}  if (raw?.projectData && typeof raw.projectData === "object") source = raw.projectData;
${indent}  if (!source || typeof source !== "object" || Array.isArray(source)) {
${indent}    throw new Error("프로젝트 JSON 형식이 올바르지 않아요.");
${indent}  }
${indent}  if (!Array.isArray(source.costumes) || !Array.isArray(source.blocks)) {
${indent}    throw new Error("의상/타임라인 데이터가 없는 프로젝트 JSON이에요.");
${indent}  }
${indent}  if (source.costumes.length > 64) throw new Error("의상 데이터가 너무 많아요.");
${indent}  if (source.blocks.length > 20000) throw new Error("타임라인 블록이 너무 많아요.");
${indent}  if (Array.isArray(source.customPresets) && source.customPresets.length > 500) {
${indent}    throw new Error("커스텀 효과 데이터가 너무 많아요.");
${indent}  }
${indent}  if (Array.isArray(source.formations) && source.formations.length > 2000) {
${indent}    throw new Error("대형 메모리 데이터가 너무 많아요.");
${indent}  }

${indent}  const clean = cloneForAccountTransfer(source);
${indent}  clean.version = Number.isFinite(Number(clean.version)) ? Number(clean.version) : 3;
${indent}  clean.savedAt = new Date().toISOString();
${indent}  clean.audioCloud = null;
${indent}  clean.mediaCloud = null;
${indent}  return clean;
${indent}};

${indent}const saveProject = () => {
${indent}  try {
${indent}    const project = cloneForAccountTransfer(buildCloudProjectData());
${indent}    const data = {
${indent}      ...project,
${indent}      format: TRANSFER_FORMAT,
${indent}      transferVersion: 1,
${indent}      exportedAt: new Date().toISOString(),
${indent}      audioCloud: null,
${indent}      mediaCloud: null,
${indent}      transferInfo: {
${indent}        accountPortable: true,
${indent}        includesMediaFiles: false,
${indent}        audioName: project.audioName || null,
${indent}        mediaName: project.mediaName || null,
${indent}        note: "음원/영상 원본은 JSON에 포함되지 않습니다. 다른 계정에서 필요하면 원본 파일을 다시 업로드하세요."
${indent}      },
${indent}    };
${indent}    download("led_stage_계정이동_프로젝트.json", JSON.stringify(data, null, 2));
${indent}    showToast("💾 계정 이동 가능한 JSON으로 저장했어요. 음원/영상 원본은 포함되지 않아요.");
${indent}  } catch (err) {
${indent}    showToast("⚠️ 프로젝트 JSON 저장 실패: " + (err?.message || "오류"));
${indent}  }
${indent}};

${indent}const loadProject = async (file) => {
${indent}  if (!file) return;
${indent}  if (file.size > MAX_TRANSFER_FILE_BYTES) {
${indent}    showToast("⚠️ 프로젝트 JSON은 5MB 이하만 가져올 수 있어요.");
${indent}    return;
${indent}  }

${indent}  setCloudBusy(true);
${indent}  try {
${indent}    const parsed = JSON.parse(await file.text());
${indent}    const imported = normalizeImportedTransfer(parsed);
${indent}    const isPortable = parsed?.format === TRANSFER_FORMAT || parsed?.transferVersion === 1;
${indent}    const hadMediaReference = !!(parsed?.audioCloud || parsed?.mediaCloud || parsed?.projectData?.audioCloud || parsed?.projectData?.mediaCloud);
${indent}    const mediaName = imported.mediaName || imported.audioName || parsed?.transferInfo?.mediaName || parsed?.transferInfo?.audioName || null;

${indent}    if (cloudSession) {
${indent}      const ok = window.confirm(
${indent}        "현재 로그인 계정의 클라우드 프로젝트를 이 JSON 내용으로 교체할까요?\\n\\n" +
${indent}        "기존 상태는 먼저 버전 기록으로 백업한 뒤 가져옵니다."
${indent}      );
${indent}      if (!ok) return;

${indent}      try {
${indent}        await createCloudVersion(cloudSession, buildCloudProjectData(), "JSON 가져오기 전 백업");
${indent}      } catch (backupErr) {
${indent}        console.warn("pre-import cloud backup failed", backupErr);
${indent}      }
${indent}    }

${indent}    applyCloudProjectData(imported);

${indent}    if (cloudSession) {
${indent}      const row = await saveCloudProject(cloudSession, imported, "가져온 프로젝트");
${indent}      try {
${indent}        await createCloudVersion(cloudSession, imported, "JSON 가져오기");
${indent}        await pruneCloudVersions(cloudSession, 20);
${indent}      } catch (versionErr) {
${indent}        console.warn("import version snapshot failed", versionErr);
${indent}      }
${indent}      const savedAt = row?.updated_at ? new Date(row.updated_at) : new Date();
${indent}      setCloudReady(true);
${indent}      setCloudStatus("가져오기 완료 · " + savedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
${indent}      showToast(
${indent}        "📦 JSON 가져오기 완료 · 현재 로그인 계정에 클라우드 연동했어요." +
${indent}        ((hadMediaReference || mediaName) ? " 음원/영상 원본은 이 계정에서 다시 업로드해 주세요." : "")
${indent}      );
${indent}    } else {
${indent}      showToast(
${indent}        "📂 JSON 프로젝트를 불러왔어요. 계정 간 이동하려면 대상 계정에 로그인한 상태에서 다시 가져오세요." +
${indent}        ((hadMediaReference || mediaName) ? " 음원/영상 원본은 별도 재업로드가 필요해요." : "")
${indent}      );
${indent}    }

${indent}    if (!isPortable) console.info("legacy project JSON imported and normalized for account portability");
${indent}  } catch (err) {
${indent}    showToast("⚠️ 프로젝트 파일을 가져올 수 없어요: " + (err?.message || "JSON 형식을 확인해 주세요."));
${indent}  } finally {
${indent}    setCloudBusy(false);
${indent}  }
${indent}};
`

      const out = code.slice(0, saveStart) + replacement + code.slice(afterLoad)
      return { code: out, map: null }
    },
  }
}
