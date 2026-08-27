export function projectAccordionUiPlugin() {
  return {
    name: 'project-accordion-ui',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const required = (ok, label) => {
        if (!ok) throw new Error(`project accordion ui: ${label} anchor not found`)
      }

      // Keep the PROJECT dock itself as-is, but make the two large collections independently collapsible.
      const stateAnchor = '  const [projectPanelOpen, setProjectPanelOpen] = useState(true);'
      required(out.includes(stateAnchor), 'project panel state')
      if (!out.includes('const [projectAccordion, setProjectAccordion]')) {
        out = out.replace(stateAnchor, stateAnchor + '\n' + [
          '  const [projectAccordion, setProjectAccordion] = useState({ projects: false, footage: true });',
          '  const [showUnusedFootageOnly, setShowUnusedFootageOnly] = useState(false);',
        ].join('\n'))
      }

      // Usage is derived from the live active sequence plus all saved sequence snapshots.
      // This is intentionally read-only: filtering the list never mutates a sequence.
      const helperAnchor = "  const activeProjectName = projects.find((project) => project.id === activeProjectId)?.name || 'PROJECT';"
      required(out.includes(helperAnchor), 'active project helper')
      if (!out.includes('const isProjectAssetUsed =')) {
        out = out.replace(helperAnchor, helperAnchor + `

  const isProjectAssetUsed = (assetId) =>
    mediaClips.some((clip) => clip.assetId === assetId)
    || sequences.some((seq) => Array.isArray(seq?.mediaClips) && seq.mediaClips.some((clip) => clip.assetId === assetId));

  const unusedProjectAssetCount = projectAssets.reduce(
    (count, asset) => count + (isProjectAssetUsed(asset.id) ? 0 : 1),
    0,
  );

  const visibleProjectAssets = showUnusedFootageOnly
    ? projectAssets.filter((asset) => !isProjectAssetUsed(asset.id))
    : projectAssets;
`)
      }

      const projectGroupAnchor = '              <div className="projectTreeGroup projectCollectionGroup">'
      required(out.includes(projectGroupAnchor), 'project collection group')
      out = out.replace(
        projectGroupAnchor,
        '              <div className={`projectTreeGroup projectCollectionGroup ${projectAccordion.projects ? "expanded" : "collapsed"}`}>',
      )

      const projectHeaderAnchor = '<div className="projectTreeTitle projectCollectionTitle"><b>▾ 📁 PROJECTS</b><span>{projects.length}</span><button type="button" onClick={createProject}>＋ 새 프로젝트</button></div>'
      required(out.includes(projectHeaderAnchor), 'project collection header')
      out = out.replace(projectHeaderAnchor, [
        '<div',
        '                  className="projectTreeTitle projectCollectionTitle projectAccordionTitle"',
        '                  role="button"',
        '                  tabIndex={0}',
        '                  aria-expanded={projectAccordion.projects}',
        '                  onClick={() => setProjectAccordion((value) => ({ ...value, projects: !value.projects }))}',
        '                  onKeyDown={(e) => {',
        '                    if (e.key !== "Enter" && e.key !== " ") return;',
        '                    e.preventDefault();',
        '                    setProjectAccordion((value) => ({ ...value, projects: !value.projects }));',
        '                  }}',
        '                >',
        '                  <b>{projectAccordion.projects ? "▾" : "▸"} 📁 PROJECTS</b>',
        '                  <span>{projects.length}</span>',
        '                  <button type="button" onClick={(e) => { e.stopPropagation(); createProject(); }}>＋ 새 프로젝트</button>',
        '                </div>',
      ].join('\n'))

      const footageGroupAnchor = [
        '              <div className="projectTreeGroup">',
        '                <div className="projectTreeTitle">▾ 🎞 FOOTAGE <span>{projectAssets.length}</span></div>',
      ].join('\n')
      required(out.includes(footageGroupAnchor), 'footage group')
      out = out.replace(footageGroupAnchor, [
        '              <div className={`projectTreeGroup projectFootageGroup ${projectAccordion.footage ? "expanded" : "collapsed"}`}>',
        '                <div',
        '                  className="projectTreeTitle projectFootageTitle projectAccordionTitle"',
        '                  role="button"',
        '                  tabIndex={0}',
        '                  aria-expanded={projectAccordion.footage}',
        '                  onClick={() => setProjectAccordion((value) => ({ ...value, footage: !value.footage }))}',
        '                  onKeyDown={(e) => {',
        '                    if (e.key !== "Enter" && e.key !== " ") return;',
        '                    e.preventDefault();',
        '                    setProjectAccordion((value) => ({ ...value, footage: !value.footage }));',
        '                  }}',
        '                >',
        '                  <b>{projectAccordion.footage ? "▾" : "▸"} 🎞 FOOTAGE</b>',
        '                  <span>{projectAssets.length}</span>',
        '                  <button',
        '                    type="button"',
        '                    className={`projectUnusedFilter ${showUnusedFootageOnly ? "on" : ""}`}',
        '                    onClick={(e) => {',
        '                      e.stopPropagation();',
        '                      setShowUnusedFootageOnly((value) => !value);',
        '                      setProjectAccordion((value) => ({ ...value, footage: true }));',
        '                    }}',
        '                    title="어떤 시퀀스에서도 사용하지 않는 푸티지만 표시"',
        '                  >',
        '                    미사용 {unusedProjectAssetCount}',
        '                  </button>',
        '                </div>',
      ].join('\n'))

      const assetMapAnchor = '                  {projectAssets.length ? projectAssets.map((asset) => ('
      required(out.includes(assetMapAnchor), 'footage map')
      out = out.replace(assetMapAnchor, '                  {visibleProjectAssets.length ? visibleProjectAssets.map((asset) => (')

      const assetMetaAnchor = '                      <div><b>{asset.name}</b><small>{asset.kind.toUpperCase()} · {fmtTime(asset.duration || 0)}</small></div>'
      required(out.includes(assetMetaAnchor), 'footage metadata')
      out = out.replace(assetMetaAnchor, [
        '                      <div className="projectAssetMeta">',
        '                        <div className="projectAssetNameLine">',
        '                          <b>{asset.name}</b>',
        '                          <span className={`projectAssetUsage ${isProjectAssetUsed(asset.id) ? "used" : "unused"}`}>',
        '                            {isProjectAssetUsed(asset.id) ? "사용중" : "미사용"}',
        '                          </span>',
        '                        </div>',
        '                        <small>{asset.kind.toUpperCase()} · {fmtTime(asset.duration || 0)}</small>',
        '                      </div>',
      ].join('\n'))

      const emptyAnchor = '                  )) : <div className="projectEmpty">미디어 버튼 또는 ＋ 푸티지로 영상/음원을 추가하세요.</div>}'
      required(out.includes(emptyAnchor), 'footage empty state')
      out = out.replace(
        emptyAnchor,
        '                  )) : <div className="projectEmpty">{showUnusedFootageOnly ? "미사용 푸티지가 없습니다." : "미디어 버튼 또는 ＋ 푸티지로 영상/음원을 추가하세요."}</div>}',
      )

      const cssAnchor = '@media(max-width:980px){.projectPanel{grid-template-columns:1fr}'
      required(out.includes(cssAnchor), 'project responsive css')
      if (!out.includes('.projectAccordionTitle{')) {
        const extraCss = [
          '.projectPanel{max-height:min(46vh,440px)!important;overflow:hidden!important;align-items:start}',
          '.projectAccordionTitle{cursor:pointer;user-select:none;transition:background .12s ease,border-color .12s ease}.projectAccordionTitle:hover{background:#1c2531}',
          '.projectCollectionGroup.collapsed .projectCollectionList,.projectFootageGroup.collapsed .projectAssetList{display:none}',
          '.projectCollectionList,.projectAssetList{overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}',
          '.projectCollectionGroup.expanded .projectCollectionList{max-height:154px}.projectFootageGroup.expanded .projectAssetList{max-height:272px}',
          '.sequenceTree{max-height:306px;overflow-y:auto;overscroll-behavior:contain}',
          '.projectCollectionTitle{grid-template-columns:minmax(0,1fr) auto auto}.projectCollectionTitle span{justify-self:end;margin:0}',
          '.projectFootageTitle{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center}.projectFootageTitle b{min-width:0;font-size:10px}.projectFootageTitle span{justify-self:end;margin:0;color:#687589}',
          '.projectUnusedFilter{height:22px;border:1px solid #3c4858;border-radius:4px;background:#151d27;color:#8e9db0;padding:0 7px;font-size:8.5px;font-weight:900;cursor:pointer;white-space:nowrap}.projectUnusedFilter:hover{border-color:#6b7d94;color:#dce7f5}.projectUnusedFilter.on{border-color:#b06b35;background:#2b2117;color:#ffc27d}',
          '.projectAssetMeta{min-width:0}.projectAssetNameLine{display:flex;align-items:center;gap:6px;min-width:0}.projectAssetNameLine b{min-width:0;flex:1}.projectAssetUsage{flex:none;border:1px solid;border-radius:999px;padding:1px 5px;font-size:7.5px;font-weight:900;letter-spacing:.01em}.projectAssetUsage.used{border-color:#315e51;background:#142a24;color:#91dfc5}.projectAssetUsage.unused{border-color:#714b2f;background:#2b1e15;color:#ffb777}',
          '.projectAssetList::-webkit-scrollbar,.projectCollectionList::-webkit-scrollbar,.sequenceTree::-webkit-scrollbar{width:8px}.projectAssetList::-webkit-scrollbar-thumb,.projectCollectionList::-webkit-scrollbar-thumb,.sequenceTree::-webkit-scrollbar-thumb{background:#303b49;border-radius:8px;border:2px solid #121821}',
          '@media(max-width:980px){.projectPanel{max-height:min(52vh,480px)!important}.projectCollectionGroup.expanded .projectCollectionList{max-height:130px}.projectFootageGroup.expanded .projectAssetList{max-height:230px}}',
        ].join('')
        out = out.replace(cssAnchor, extraCss + cssAnchor)
      }

      required(out.includes('visibleProjectAssets.length'), 'unused footage filter')
      required(out.includes('projectFootageGroup ${projectAccordion.footage'), 'footage accordion')
      required(out.includes('projectCollectionGroup ${projectAccordion.projects'), 'projects accordion')
      required(out.includes('projectAssetUsage'), 'usage badge')

      return { code: out, map: null }
    },
  }
}
