export function multiProjectManagerPlugin() {
  return {
    name: 'multi-project-workspace-manager',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const required = (ok, label) => {
        if (!ok) throw new Error(`multi project: ${label} anchor not found`)
      }

      // PROJECT collection state lives above the existing footage/sequence state.
      const stateAnchor = '  const [projectPanelOpen, setProjectPanelOpen] = useState(true);'
      required(out.includes(stateAnchor), 'project panel state')
      if (!out.includes('const [projects, setProjects]')) {
        out = out.replace(stateAnchor, stateAnchor + '\n' + [
          '  const [projects, setProjects] = useState([{ id: "project-main", name: "PROJECT 01", data: null }]);',
          '  const [activeProjectId, setActiveProjectId] = useState("project-main");',
        ].join('\n'))
      }

      // Keep the existing single-project serializer/apply logic as the active-project codec.
      const buildAnchor = '  const buildCloudProjectData = () => ({'
      required(out.includes(buildAnchor), 'cloud project builder')
      out = out.replace(buildAnchor, '  const buildActiveProjectData = () => ({')

      const applyAnchor = '  const applyCloudProjectData = (data) => {'
      required(out.includes(applyAnchor), 'cloud project apply')
      out = out.replace(applyAnchor, '  const applyActiveProjectData = (data) => {')

      const loadCloudAnchor = '  const loadCloudForSession = async (session, quiet = false) => {'
      required(out.includes(loadCloudAnchor), 'cloud loader')
      const projectHelpers = `  // ───────────── Multi-project collection ─────────────
  const cloneProjectData = (value) => JSON.parse(JSON.stringify(value ?? null));

  const projectName = (base, list = projects) => {
    const root = String(base || 'PROJECT').trim() || 'PROJECT';
    const names = new Set((list || []).map((project) => project?.name).filter(Boolean));
    if (!names.has(root)) return root;
    let n = 2;
    while (names.has(root + ' ' + n)) n += 1;
    return root + ' ' + n;
  };

  const createBlankProjectData = () => {
    const seqId = uid();
    return {
      version: 4,
      savedAt: new Date().toISOString(),
      duration: 60,
      manualDuration: 60,
      audioName: null,
      audioCloud: null,
      mediaName: null,
      mediaCloud: null,
      costumes: makeDefaultCostumes(1),
      blocks: [],
      sequences: [{ id: seqId, name: 'Sequence 01', blocks: [], formations: [], mediaClips: [], manualDuration: 60, playhead: 0 }],
      activeSequenceId: seqId,
      projectAssets: [],
      customPresets: cloneProjectData(customPresets) || [],
      formations: [],
    };
  };

  const materializeProjects = () => {
    const activeData = buildActiveProjectData();
    const base = Array.isArray(projects) && projects.length
      ? projects
      : [{ id: activeProjectId || 'project-main', name: 'PROJECT 01', data: null }];
    let found = false;
    const next = base.map((project) => {
      if (project.id !== activeProjectId) return cloneProjectData(project);
      found = true;
      return { ...cloneProjectData(project), data: activeData };
    });
    if (!found) {
      next.push({ id: activeProjectId || 'project-main', name: 'PROJECT 01', data: activeData });
    }
    return next;
  };

  // Supabase still stores one row per user. The row now contains a project collection,
  // while the active project is mirrored at the top level for MANAGEMENT/backward compatibility.
  const buildCloudProjectData = () => {
    const nextProjects = materializeProjects();
    const resolvedId = nextProjects.some((project) => project.id === activeProjectId)
      ? activeProjectId
      : nextProjects[0]?.id || 'project-main';
    const active = nextProjects.find((project) => project.id === resolvedId) || nextProjects[0];
    const activeData = active?.data || buildActiveProjectData();
    return {
      ...activeData,
      version: Math.max(4, Number(activeData?.version) || 0),
      projectCollectionVersion: 1,
      activeProjectId: resolvedId,
      projects: nextProjects,
    };
  };

  const normalizeProjectCollection = (data) => {
    if (Array.isArray(data?.projects) && data.projects.length) {
      const list = data.projects.map((project, index) => ({
        id: project?.id || ('project-' + (index + 1)),
        name: String(project?.name || ('PROJECT ' + String(index + 1).padStart(2, '0'))).slice(0, 64),
        data: project?.data && typeof project.data === 'object' ? project.data : null,
      }));
      const id = list.some((project) => project.id === data.activeProjectId) ? data.activeProjectId : list[0].id;
      const active = list.find((project) => project.id === id) || list[0];
      return { list, id, activeData: active?.data || data };
    }
    return {
      list: [{ id: 'project-main', name: 'PROJECT 01', data }],
      id: 'project-main',
      activeData: data,
    };
  };

  const applyCloudProjectData = (data) => {
    if (!data || typeof data !== 'object') return;
    const collection = normalizeProjectCollection(data);
    setProjects(collection.list);
    setActiveProjectId(collection.id);
    setLoadedProjectAssetId(null);
    applyActiveProjectData(collection.activeData);
  };

  const restoreProjectMedia = async (data) => {
    if (!cloudSession || !data) return;
    try {
      if (data.mediaCloud?.path) await restoreCloudMedia(data.mediaCloud, cloudSession, true);
      else if (data.audioCloud?.path) await restoreCloudAudio(data.audioCloud, cloudSession, true);
    } catch (err) {
      console.warn('project media restore failed', err);
    }
  };

  const activateProjectRecord = (record, list, restoreMedia = true) => {
    if (!record?.id || !record?.data) return;
    pause();
    setProjects(list);
    setActiveProjectId(record.id);
    setLoadedProjectAssetId(null);
    applyActiveProjectData(record.data);
    if (restoreMedia) window.setTimeout(() => restoreProjectMedia(record.data), 0);
  };

  const switchProject = (id) => {
    if (!id || id === activeProjectId) return;
    const list = materializeProjects();
    const target = list.find((project) => project.id === id);
    if (!target?.data) return;
    activateProjectRecord(target, list, true);
    showToast('📁 ' + (target.name || 'PROJECT') + ' 로 전환했어요.');
  };

  const createProject = () => {
    const list = materializeProjects();
    const data = createBlankProjectData();
    const next = {
      id: uid(),
      name: projectName('PROJECT ' + String(list.length + 1).padStart(2, '0'), list),
      data,
    };
    activateProjectRecord(next, [...list, next], false);
    showToast('＋ ' + next.name + ' 만들었어요.');
  };

  const renameProject = (id, value) => {
    const name = String(value ?? '').slice(0, 64);
    setProjects((list) => list.map((project) => project.id === id ? { ...project, name } : project));
  };

  const duplicateProject = (id = activeProjectId) => {
    const list = materializeProjects();
    const source = list.find((project) => project.id === id);
    if (!source?.data) return;
    const duplicated = {
      id: uid(),
      name: projectName((source.name || 'PROJECT') + ' Copy', list),
      data: cloneProjectData(source.data),
    };
    activateProjectRecord(duplicated, [...list, duplicated], true);
    showToast('⧉ ' + duplicated.name + ' 복제했어요.');
  };

  const deleteProject = (id) => {
    const list = materializeProjects();
    if (list.length <= 1) { showToast('⚠️ 프로젝트는 최소 1개가 있어야 해요.'); return; }
    const source = list.find((project) => project.id === id);
    if (!source || !window.confirm('“' + (source.name || 'PROJECT') + '” 프로젝트를 삭제할까요?')) return;
    const index = list.findIndex((project) => project.id === id);
    const remaining = list.filter((project) => project.id !== id);
    if (id === activeProjectId) {
      const target = remaining[Math.min(index, remaining.length - 1)] || remaining[0];
      activateProjectRecord(target, remaining, true);
    } else {
      setProjects(remaining);
    }
    showToast('🗑 프로젝트를 삭제했어요.');
  };

  const activeProjectName = projects.find((project) => project.id === activeProjectId)?.name || 'PROJECT';

`
      out = out.replace(loadCloudAnchor, projectHelpers + loadCloudAnchor)

      // Restoring cloud media must not recreate a V1/A1 clip at 0s; the saved sequence
      // already owns clip placement. Runtime file registration is still allowed.
      out = out.replaceAll(
        '      attachAssetToSequence(projectAssetId, "video", d, file.name);',
        '      if (!cloudMediaRestoreRef.current) attachAssetToSequence(projectAssetId, "video", d, file.name);'
      )
      out = out.replaceAll(
        '      attachAssetToSequence(projectAssetId, "audio", decoded.duration, file.name);',
        '      if (!cloudAudioRestoreRef.current) attachAssetToSequence(projectAssetId, "audio", decoded.duration, file.name);'
      )

      // Project-only edits (rename/delete/duplicate) must also trigger cloud autosave.
      const loginAnchor = '  const handleCloudLogin = async () => {'
      required(out.includes(loginAnchor), 'cloud login')
      const projectAutosave = `  useEffect(() => {
    if (!cloudSession || !cloudReady) return;
    if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current);
    cloudSaveTimerRef.current = setTimeout(() => saveCloudNow(true), 1500);
    return () => { if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current); };
  }, [projects, activeProjectId, cloudSession, cloudReady]);

`
      out = out.replace(loginAnchor, projectAutosave + loginAnchor)

      // Surface project identity in the dock and add a full project manager above footage/sequences.
      const pathAnchor = '<span className="projectPath">FOOTAGE {projectAssets.length} · SEQUENCES {sequences.length}</span>'
      required(out.includes(pathAnchor), 'project path')
      out = out.replace(pathAnchor, '<span className="projectPath">{activeProjectName} · FOOTAGE {projectAssets.length} · SEQUENCES {sequences.length}</span>')

      const panelAnchor = `            <section className="projectPanel">
              <div className="projectTreeGroup">
                <div className="projectTreeTitle">▾ 🎞 FOOTAGE <span>{projectAssets.length}</span></div>`
      required(out.includes(panelAnchor), 'project panel')
      const projectManager = `            <section className="projectPanel">
              <div className="projectTreeGroup projectCollectionGroup">
                <div className="projectTreeTitle projectCollectionTitle"><b>▾ 📁 PROJECTS</b><span>{projects.length}</span><button type="button" onClick={createProject}>＋ 새 프로젝트</button></div>
                <div className="projectCollectionList">
                  {projects.map((project, index) => (
                    <div key={project.id} className={\`projectCollectionRow \${project.id === activeProjectId ? 'on' : ''}\`}>
                      <button type="button" className="projectSwitchBtn" onClick={() => switchProject(project.id)} title="프로젝트 전환">{String(index + 1).padStart(2, '0')}</button>
                      <input value={project.name || ''} onChange={(e) => renameProject(project.id, e.target.value)} aria-label="프로젝트 이름" />
                      <button type="button" onClick={() => duplicateProject(project.id)}>복제</button>
                      <button type="button" className="danger" disabled={projects.length <= 1} onClick={() => deleteProject(project.id)}>삭제</button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="projectTreeGroup">
                <div className="projectTreeTitle">▾ 🎞 FOOTAGE <span>{projectAssets.length}</span></div>`
      out = out.replace(panelAnchor, projectManager)

      const styleNeedle = '.projectTreeGroup{border:1px solid #252e3a;border-radius:6px;background:#121821;overflow:hidden}'
      required(out.includes(styleNeedle), 'project css')
      if (!out.includes('.projectCollectionGroup{')) {
        const extraCss = [
          '.projectCollectionGroup{grid-column:1/-1}.projectCollectionTitle{display:grid;grid-template-columns:auto 1fr auto;align-items:center}.projectCollectionTitle b{font-size:10px}.projectCollectionTitle span{justify-self:end;margin-right:4px}.projectCollectionTitle button{height:22px;border:1px solid #40506a;border-radius:4px;background:#1d2735;color:#b9dfff;padding:0 7px;font-size:9px;font-weight:800;cursor:pointer}',
          '.projectCollectionList{display:grid;gap:4px;padding:5px}.projectCollectionRow{display:grid;grid-template-columns:34px minmax(140px,1fr) auto auto;gap:5px;align-items:center;min-height:34px;padding:3px;border:1px solid transparent;border-radius:5px;background:#10151c}.projectCollectionRow.on{border-color:#637cff;background:#19223a}.projectCollectionRow input{min-width:0;height:26px;border:1px solid #303b4a;border-radius:4px;background:#0d1219;color:#e6edf8;padding:0 7px;font-size:10px;font-weight:800}.projectCollectionRow button{height:26px;border:1px solid #344151;border-radius:4px;background:#1a222d;color:#aebbd0;font-size:9px;padding:0 7px;cursor:pointer}.projectCollectionRow .projectSwitchBtn{font-family:ui-monospace,monospace;font-weight:900;color:#8da1bd}.projectCollectionRow.on .projectSwitchBtn{color:#fff;border-color:#627dff}.projectCollectionRow button.danger{color:#ff929d;border-color:#623741}.projectCollectionRow button:disabled{opacity:.35;cursor:not-allowed}',
        ].join('')
        out = out.replace(styleNeedle, styleNeedle + extraCss)
      }

      required(out.includes('projectCollectionVersion: 1'), 'collection serializer')
      required(out.includes('createProject') && out.includes('duplicateProject') && out.includes('deleteProject'), 'project actions')
      required(out.includes('projectCollectionGroup'), 'project UI')

      return { code: out, map: null }
    },
  }
}
