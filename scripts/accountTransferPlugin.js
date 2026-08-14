export function accountTransferPlugin() {
  return {
    name: 'account-transfer-json',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null

      const saveStart = code.indexOf('  const saveProject = () => {')
      const loadStart = code.indexOf('  const loadProject = async (file) => {', saveStart)
      const afterLoad = code.indexOf('  const arduinoExportTargets = useMemo(() => {', loadStart)
      if (saveStart < 0 || loadStart < 0 || afterLoad < 0) {
        throw new Error('account transfer plugin: project save/load anchors not found')
      }

      const replacement = `  // ───────────── Account-portable JSON transfer ─────────────
  const TRANSFER_FORMAT = "led-stage-project-transfer-v1";
  const MAX_TRANSFER_FILE_BYTES = 5 * 1024 * 1024;
  const PRIVATE_TRANSFER_KEYS = new Set([
    "access_token", "refresh_token", "provider_token", "provider_refresh_token",
    "authorization", "session", "user_id", "email", "phone"
  ]);

  const cloneForAccountTransfer = (projectData) => {
    const cloned = JSON.parse(JSON.stringify(projectData || {}, (key, value) => {
      const lower = String(key || "").toLowerCase();
      if (PRIVATE_TRANSFER_KEYS.has(lower)) return undefined;
      // Supabase Storage objects are private and scoped to the source account.
      // Never carry their paths into another account through JSON.
      if (key === "audioCloud" || key === "mediaCloud") return null;
      return value;
    }));
    return cloned && typeof cloned === "object" && !Array.isArray(cloned) ? cloned : {};
  };

  const normalizeImportedTransfer = (raw) => {
    let source = raw;
    if (raw?.projectData && typeof raw.projectData === "object") source = raw.projectData;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("프로젝트 JSON 형식이 올바르지 않아요.");
    }
    if (!Array.isArray(source.costumes) || !Array.isArray(source.blocks)) {
      throw new Error("의상/타임라인 데이터가 없는 프로젝트 JSON이에요.");
    }
    if (source.costumes.length > 64) throw new Error("의상 데이터가 너무 많아요.");
    if (source.blocks.length > 20000) throw new Error("타임라인 블록이 너무 많아요.");
    if (Array.isArray(source.customPresets) && source.customPresets.length > 500) {
      throw new Error("커스텀 효과 데이터가 너무 많아요.");
    }
    if (Array.isArray(source.formations) && source.formations.length > 2000) {
      throw new Error("대형 메모리 데이터가 너무 많아요.");
    }

    const clean = cloneForAccountTransfer(source);
    clean.version = Number.isFinite(Number(clean.version)) ? Number(clean.version) : 3;
    clean.savedAt = new Date().toISOString();
    clean.audioCloud = null;
    clean.mediaCloud = null;
    return clean;
  };

  const saveProject = () => {
    try {
      const project = cloneForAccountTransfer(buildCloudProjectData());
      const data = {
        ...project,
        format: TRANSFER_FORMAT,
        transferVersion: 1,
        exportedAt: new Date().toISOString(),
        audioCloud: null,
        mediaCloud: null,
        transferInfo: {
          accountPortable: true,
          includesMediaFiles: false,
          audioName: project.audioName || null,
          mediaName: project.mediaName || null,
          note: "음원/영상 원본은 JSON에 포함되지 않습니다. 다른 계정에서 필요하면 원본 파일을 다시 업로드하세요."
        },
      };
      download("led_stage_계정이동_프로젝트.json", JSON.stringify(data, null, 2));
      showToast("💾 계정 이동 가능한 JSON으로 저장했어요. 음원/영상 원본은 포함되지 않아요.");
    } catch (err) {
      showToast("⚠️ 프로젝트 JSON 저장 실패: " + (err?.message || "오류"));
    }
  };

  const loadProject = async (file) => {
    if (!file) return;
    if (file.size > MAX_TRANSFER_FILE_BYTES) {
      showToast("⚠️ 프로젝트 JSON은 5MB 이하만 가져올 수 있어요.");
      return;
    }

    setCloudBusy?.(true);
    try {
      const parsed = JSON.parse(await file.text());
      const imported = normalizeImportedTransfer(parsed);
      const isPortable = parsed?.format === TRANSFER_FORMAT || parsed?.transferVersion === 1;
      const hadMediaReference = !!(parsed?.audioCloud || parsed?.mediaCloud || parsed?.projectData?.audioCloud || parsed?.projectData?.mediaCloud);
      const mediaName = imported.mediaName || imported.audioName || parsed?.transferInfo?.mediaName || parsed?.transferInfo?.audioName || null;

      if (cloudSession) {
        const ok = window.confirm(
          "현재 로그인 계정의 클라우드 프로젝트를 이 JSON 내용으로 교체할까요?\\n\\n" +
          "기존 상태는 먼저 버전 기록으로 백업한 뒤 가져옵니다."
        );
        if (!ok) return;

        // Keep a rollback point before replacing the current account's project.
        try {
          await createCloudVersion(cloudSession, buildCloudProjectData(), "JSON 가져오기 전 백업");
        } catch (backupErr) {
          console.warn("pre-import cloud backup failed", backupErr);
        }
      }

      applyCloudProjectData(imported);

      if (cloudSession) {
        const row = await saveCloudProject(cloudSession, imported, "가져온 프로젝트");
        try {
          await createCloudVersion(cloudSession, imported, "JSON 가져오기");
          await pruneCloudVersions(cloudSession, 20);
        } catch (versionErr) {
          console.warn("import version snapshot failed", versionErr);
        }
        const savedAt = row?.updated_at ? new Date(row.updated_at) : new Date();
        setCloudReady(true);
        setCloudStatus("가져오기 완료 · " + savedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
        showToast(
          "📦 JSON 가져오기 완료 · 현재 로그인 계정에 클라우드 연동했어요." +
          ((hadMediaReference || mediaName) ? " 음원/영상 원본은 이 계정에서 다시 업로드해 주세요." : "")
        );
      } else {
        showToast(
          "📂 JSON 프로젝트를 불러왔어요. 계정 간 이동하려면 대상 계정에 로그인한 상태에서 다시 가져오세요." +
          ((hadMediaReference || mediaName) ? " 음원/영상 원본은 별도 재업로드가 필요해요." : "")
        );
      }

      if (!isPortable) {
        console.info("legacy project JSON imported and normalized for account portability");
      }
    } catch (err) {
      showToast("⚠️ 프로젝트 파일을 가져올 수 없어요: " + (err?.message || "JSON 형식을 확인해 주세요."));
    } finally {
      setCloudBusy?.(false);
    }
  };
`

      const out = code.slice(0, saveStart) + replacement + code.slice(afterLoad)
      return { code: out, map: null }
    },
  }
}
