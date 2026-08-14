export function managementSequenceFormationPlugin() {
  return {
    name: 'management-sequence-formation-workspace',
    transform(code, id) {
      if (id.includes('src/managementProjectFirmware.js')) {
        let out = code
        out = out.replace(
          'export function buildManagementFirmwareBundle({ costumes = [], blocks = [] } = {}) {',
          'export function buildManagementFirmwareBundle({ costumes = [], blocks = [], showDurationMs: sequenceDurationMs = 0 } = {}) {'
        )
        out = out.replace(
          '  const showDurationMs = Math.max(0, ...receivers.flatMap((rx) => rx.parts.map((part) => part.endMs || 0)));',
          '  const bakedDurationMs = Math.max(0, ...receivers.flatMap((rx) => rx.parts.map((part) => part.endMs || 0)));\n  const requestedDurationMs = Math.max(0, Math.round(Number(sequenceDurationMs) || 0));\n  const showDurationMs = requestedDurationMs > 0 ? requestedDurationMs : bakedDurationMs;'
        )
        out = out.replace(
          '  const previewSafeLimitMs = firstOns.length ? Math.min(...firstOns) : Math.max(1, showDurationMs);',
          '  const previewSafeLimitMs = firstOns.length ? Math.min(Math.min(...firstOns), Math.max(1, showDurationMs)) : Math.max(1, showDurationMs);'
        )
        if (!out.includes('sequenceDurationMs') || !out.includes('bakedDurationMs')) {
          throw new Error('management sequence formation: firmware duration patch failed')
        }
        return { code: out, map: null }
      }

      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code
      const required = (ok, label) => {
        if (!ok) throw new Error(`management sequence formation: ${label} anchor not found`)
      }

      const normalizeFrom = `const normalizeProject = (data) => ({
  costumes: Array.isArray(data?.costumes) ? data.costumes : [],
  blocks: Array.isArray(data?.blocks) ? data.blocks : [],
  duration: Number(data?.duration || data?.manualDuration) || DEFAULT_DURATION,
  audioName: data?.audioName || null,
  mediaName: data?.mediaName || null,
  audioCloud: data?.audioCloud || null,
  mediaCloud: data?.mediaCloud || null,
  savedAt: data?.savedAt || null,
})`
      const normalizeTo = `const normalizeProject = (data) => {
  const legacyBlocks = Array.isArray(data?.blocks) ? data.blocks : []
  const legacyFormations = Array.isArray(data?.formations) ? data.formations : []
  const source = Array.isArray(data?.sequences) && data.sequences.length
    ? data.sequences
    : [{ id: 'seq-main', name: 'Sequence 01', blocks: legacyBlocks, formations: legacyFormations, mediaClips: [], manualDuration: Number(data?.duration || data?.manualDuration) || DEFAULT_DURATION, playhead: 0 }]
  const sequences = source.map((seq, index) => ({
    id: seq?.id || ('seq-' + (index + 1)),
    name: seq?.name || ('Sequence ' + String(index + 1).padStart(2, '0')),
    blocks: Array.isArray(seq?.blocks) ? seq.blocks : [],
    formations: Array.isArray(seq?.formations) ? seq.formations : (index === 0 ? legacyFormations : []),
    mediaClips: Array.isArray(seq?.mediaClips) ? seq.mediaClips : [],
    manualDuration: Math.max(1, Number(seq?.manualDuration || seq?.duration || data?.duration || data?.manualDuration) || DEFAULT_DURATION),
    playhead: Math.max(0, Number(seq?.playhead) || 0),
  }))
  const activeSequenceId = sequences.some((seq) => seq.id === data?.activeSequenceId) ? data.activeSequenceId : sequences[0].id
  const active = sequences.find((seq) => seq.id === activeSequenceId) || sequences[0]
  return {
    costumes: Array.isArray(data?.costumes) ? data.costumes : [],
    sequences,
    activeSequenceId,
    blocks: active.blocks,
    formations: active.formations,
    mediaClips: active.mediaClips,
    duration: active.manualDuration,
    projectAssets: Array.isArray(data?.projectAssets) ? data.projectAssets : [],
    audioName: data?.audioName || null,
    mediaName: data?.mediaName || null,
    audioCloud: data?.audioCloud || null,
    mediaCloud: data?.mediaCloud || null,
    savedAt: data?.savedAt || null,
  }
}`
      required(out.includes(normalizeFrom), 'normalizeProject')
      out = out.replace(normalizeFrom, normalizeTo)

      const stateAnchor = '  const [blocks, setBlocks] = useState(localProject.blocks)'
      if (!out.includes('const [sequences, setSequences]')) {
        required(out.includes(stateAnchor), 'blocks state')
        out = out.replace(stateAnchor, stateAnchor + '\n' + [
          '  const [sequences, setSequences] = useState(localProject.sequences)',
          '  const [activeSequenceId, setActiveSequenceId] = useState(localProject.activeSequenceId)',
          '  const [formations, setFormations] = useState(localProject.formations || [])',
          '  const [mediaClips, setMediaClips] = useState(localProject.mediaClips || [])',
          '  const [projectAssets, setProjectAssets] = useState(localProject.projectAssets || [])',
        ].join('\n'))
      }

      out = out.replace(
        '  const duration = Math.max(1, mediaDuration || projectDuration || DEFAULT_DURATION)',
        '  const duration = Math.max(1, projectDuration || DEFAULT_DURATION)'
      )
      required(out.includes('const duration = Math.max(1, projectDuration || DEFAULT_DURATION)'), 'sequence duration')

      const appComponent = 'export default function App() {'
      if (!out.includes('const managementFormationAt =')) {
        required(out.includes(appComponent), 'app component')
        const formationHelpers = `
const managementDefaultFormation = (costumes) => {
  const result = {}
  const count = Math.max(1, costumes.length)
  const front = count <= 4 ? count : Math.ceil(count / 2)
  const back = Math.max(0, count - front)
  costumes.forEach((costume, index) => {
    const first = index < front
    const j = first ? index : index - front
    const rowCount = first ? front : back
    result[costume.id] = { x: ((j + 1) * 100) / (rowCount + 1), y: first ? (count <= 4 ? 50 : 34) : 69 }
  })
  return result
}

const managementNormalizeFormation = (positions, costumes) => {
  const fallback = managementDefaultFormation(costumes)
  const result = {}
  costumes.forEach((costume) => {
    const p = positions?.[costume.id] || fallback[costume.id] || { x: 50, y: 50 }
    result[costume.id] = {
      x: Math.max(5, Math.min(95, Number(p.x) || 50)),
      y: Math.max(13, Math.min(88, Number(p.y) || 50)),
    }
  })
  return result
}

const managementFormationAt = (formations, costumes, time) => {
  const list = [...(Array.isArray(formations) ? formations : [])].sort((a, b) => Number(a.time) - Number(b.time))
  if (!list.length) return managementDefaultFormation(costumes)
  if (time <= Number(list[0].time)) return managementNormalizeFormation(list[0].positions, costumes)
  const last = list[list.length - 1]
  if (time >= Number(last.time)) return managementNormalizeFormation(last.positions, costumes)
  let a = list[0]
  let b = last
  for (let i = 1; i < list.length; i += 1) {
    if (Number(list[i].time) >= time) { a = list[i - 1]; b = list[i]; break }
  }
  const pa = managementNormalizeFormation(a.positions, costumes)
  const pb = managementNormalizeFormation(b.positions, costumes)
  const mix = Math.max(0, Math.min(1, (time - Number(a.time)) / Math.max(0.000001, Number(b.time) - Number(a.time))))
  const result = {}
  costumes.forEach((costume) => {
    result[costume.id] = {
      x: pa[costume.id].x + (pb[costume.id].x - pa[costume.id].x) * mix,
      y: pa[costume.id].y + (pb[costume.id].y - pa[costume.id].y) * mix,
    }
  })
  return result
}

`
        out = out.replace(appComponent, formationHelpers + appComponent)
      }

      const snapAnchor = '  const snapPoints = useMemo(() => {'
      if (!out.includes('const activeManagementSequence =')) {
        required(out.includes(snapAnchor), 'snap points')
        out = out.replace(snapAnchor, [
          '  const activeManagementSequence = useMemo(() => sequences.find((seq) => seq.id === activeSequenceId) || sequences[0] || null, [sequences, activeSequenceId])',
          '  const managementStagePositions = useMemo(() => managementFormationAt(formations, costumes, currentTime), [formations, costumes, currentTime])',
          '',
          snapAnchor,
        ].join('\n'))
      }

      const applyFrom = `  const applyProjectData = (raw, updatedAt = null) => {
    const project = normalizeProject(raw)
    setCostumes(project.costumes)
    setBlocks(project.blocks)
    setProjectDuration(project.duration)
    setMediaName(project.mediaName || project.audioName || null)
    setCurrentTime(0)
    setPlaying(false)
    localStorage.setItem(LOCAL_PROJECT_KEY, JSON.stringify({ ...project, savedAt: updatedAt || new Date().toISOString() }))
  }`
      const applyTo = `  const applyProjectData = (raw, updatedAt = null) => {
    const project = normalizeProject(raw)
    setCostumes(project.costumes)
    setSequences(project.sequences)
    setActiveSequenceId(project.activeSequenceId)
    setBlocks(project.blocks)
    setFormations(project.formations || [])
    setMediaClips(project.mediaClips || [])
    setProjectAssets(project.projectAssets || [])
    setProjectDuration(project.duration)
    setMediaName(project.mediaName || project.audioName || null)
    setCurrentTime(0)
    setPlaying(false)
    localStorage.setItem(LOCAL_PROJECT_KEY, JSON.stringify({ ...project, savedAt: updatedAt || new Date().toISOString() }))
  }`
      required(out.includes(applyFrom), 'applyProjectData')
      out = out.replace(applyFrom, applyTo)

      const applyMediaAnchor = '  const applyMediaBlob = async (blob, meta = {}, cache = true) => {'
      if (!out.includes('const switchManagementSequence =')) {
        required(out.includes(applyMediaAnchor), 'media helper')
        const switcher = [
          '  const switchManagementSequence = (id) => {',
          '    if (!id || id === activeSequenceId) return',
          "    if (stageLive) { showToast('LIVE 중에는 시퀀스를 바꿀 수 없어요. 먼저 LIVE를 종료해 주세요.'); return }",
          '    const seq = sequences.find((item) => item.id === id)',
          '    if (!seq) return',
          '    pauseMediaOnly()',
          '    setPlaying(false)',
          '    setActiveSequenceId(seq.id)',
          '    setBlocks(Array.isArray(seq.blocks) ? seq.blocks : [])',
          '    setFormations(Array.isArray(seq.formations) ? seq.formations : [])',
          '    setMediaClips(Array.isArray(seq.mediaClips) ? seq.mediaClips : [])',
          '    setProjectDuration(Math.max(1, Number(seq.manualDuration) || DEFAULT_DURATION))',
          '    setCurrentTime(0)',
          '    const el = getMediaEl()',
          '    if (el) el.currentTime = 0',
          '    setFirmwareTarget("master")',
          '    showToast(`▤ ${seq.name || "Sequence"} 로 전환했어요.`)',
          '  }',
          '',
          applyMediaAnchor,
        ].join('\n')
        out = out.replace(applyMediaAnchor, switcher)
      }

      out = out.replace(
        '      return buildManagementFirmwareBundle({ costumes, blocks })',
        '      return buildManagementFirmwareBundle({ costumes, blocks, showDurationMs: Math.round(duration * 1000) })'
      )
      out = out.replace('  }, [costumes, blocks])', '  }, [costumes, blocks, duration])')

      out = out.replace(
        '    const bw = width / wavePeaks.length',
        '    const mediaDrawWidth = Math.min(width, Math.max(1, Number(mediaDuration || duration)) * pps)\n    const bw = mediaDrawWidth / wavePeaks.length'
      )

      const programAnchor = '        <section className="programPanel">'
      if (!out.includes('className="managementSequenceBar"')) {
        required(out.includes(programAnchor), 'program panel')
        const sequenceBar = [
          '        <section className="managementSequenceBar">',
          '          <div className="managementSequenceTitle"><b>📁 PROJECT</b><span> / SEQUENCES</span></div>',
          '          <div className="managementSequenceTabs">',
          '            {sequences.map((seq, index) => (',
          '              <button key={seq.id} type="button" className={seq.id === activeSequenceId ? "on" : ""} disabled={stageLive} onClick={() => switchManagementSequence(seq.id)}>',
          '                <span>{String(index + 1).padStart(2, "0")}</span><b>{seq.name || "Sequence"}</b><small>{fmtTime(seq.manualDuration || DEFAULT_DURATION)}</small>',
          '              </button>',
          '            ))}',
          '          </div>',
          '          <div className="managementSequenceMeta"><b>{activeManagementSequence?.name || "Sequence"}</b><span>{fmtTime(duration)} · {blocks.length} blocks · {formations.length} formations</span></div>',
          '        </section>',
          '',
          programAnchor,
        ].join('\n')
        out = out.replace(programAnchor, sequenceBar)
      }

      const marker = 'EL LIVE PREVIEW · TIMELINE LOCK'
      const markerPos = out.indexOf(marker)
      const timelineAnchor = '        <div className="timelineScroll" ref={timelineScrollRef} onDragStart={(e) => e.preventDefault()}>'
      const timelinePos = out.indexOf(timelineAnchor, markerPos)
      required(markerPos >= 0 && timelinePos > markerPos, 'old EL preview')
      const panelStart = out.lastIndexOf('        <section', markerPos)
      required(panelStart >= 0 && panelStart < markerPos, 'old EL preview start')
      if (!out.includes('WHOLE STAGE FORMATION · TIMELINE LOCK')) {
        const stagePanel = [
          '        <section className="managementFormationPanel">',
          '          <div className="managementFormationHead">',
          '            <div><b>🎭 WHOLE STAGE FORMATION · TIMELINE LOCK</b><span>{activeManagementSequence?.name || "Sequence"} · {formations.length ? `${formations.length}개 대형 키프레임` : "기본 대형"}</span></div>',
          '            <strong className={playing ? "playing" : ""}>{playing ? "● PLAY" : "■ HOLD"} · {fmtTime(currentTime)}</strong>',
          '          </div>',
          '          <div className="managementFormationStage">',
          '            <div className="managementUpstage">UP STAGE</div><div className="managementAudience">▼ CAMERA / 관객석</div>',
          '            <div className="managementStageV" /><div className="managementStageH h1" /><div className="managementStageH h2" />',
          '            {costumes.map((costume, index) => {',
          '              const preview = managementPreviewState(costume, blocks, currentTime)',
          '              const pos = managementStagePositions[costume.id] || { x: 50, y: 50 }',
          '              return (',
          '                <div key={costume.id || index} className={`managementFormationActor ${preview.on ? "on" : ""}`} style={{ left: pos.x + "%", top: pos.y + "%", "--cc": costume.color || "#62e7a2" }}>',
          '                  <span className="managementFormationAvatar"><ManagementElAvatarPreview zoneColors={preview.zones} glowId={"mgmt-stage-glow-" + index} /></span>',
          '                  <span className="managementFormationName"><b>{index + 1}</b> {costume.name || ("RX " + (index + 1))}</span>',
          '                  <small>{preview.on ? "EL ON" : "EL OFF"}</small>',
          '                </div>',
          '              )',
          '            })}',
          '          </div>',
          '        </section>',
          '',
        ].join('\n')
        out = out.slice(0, panelStart) + stagePanel + out.slice(timelinePos)
      }

      const appRoot = '    <div className="app">'
      if (!out.includes('.managementSequenceBar{')) {
        required(out.includes(appRoot), 'app root')
        const styles = [
          appRoot,
          '      <style>{`',
          '.managementSequenceBar{flex:0 0 auto;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;min-height:42px;padding:5px 10px;background:#0d1117;border-bottom:1px solid #28313c}.managementSequenceTitle{white-space:nowrap;color:#d8e1ed;font-size:10px}.managementSequenceTitle span{color:#687587}.managementSequenceTabs{display:flex;gap:4px;overflow:auto;min-width:0}.managementSequenceTabs button{min-width:125px;display:grid;grid-template-columns:24px minmax(0,1fr);grid-template-rows:auto auto;column-gap:5px;text-align:left;border:1px solid #303a47;border-radius:5px;background:#151b23;color:#a9b4c3;padding:4px 7px;cursor:pointer}.managementSequenceTabs button.on{border-color:#647dff;background:#202a45;color:#fff}.managementSequenceTabs button:disabled{opacity:.5;cursor:not-allowed}.managementSequenceTabs button span{grid-row:1/3;align-self:center;font:900 9px monospace;color:#6f7d90}.managementSequenceTabs button b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9.5px}.managementSequenceTabs button small{color:#718095;font-size:8px}.managementSequenceMeta{display:flex;flex-direction:column;align-items:flex-end;white-space:nowrap}.managementSequenceMeta b{color:#dce5f2;font-size:10px}.managementSequenceMeta span{color:#687587;font-size:8.5px}',
          '.managementFormationPanel{flex:0 0 auto;padding:8px 12px 10px;background:#0c1016;border-bottom:1px solid #252e39}.managementFormationHead{height:28px;display:flex;align-items:center;justify-content:space-between;gap:10px}.managementFormationHead>div{display:flex;align-items:baseline;gap:9px}.managementFormationHead b{font-size:10px;letter-spacing:.05em;color:#dce6f3}.managementFormationHead span{color:#6d798b;font-size:8.5px}.managementFormationHead strong{color:#7e8998;font-size:9px;font-variant-numeric:tabular-nums}.managementFormationHead strong.playing{color:#62e7a2}',
          '.managementFormationStage{position:relative;height:230px;overflow:hidden;border:1px solid #26313f;border-radius:7px;background:linear-gradient(180deg,#121927,#090e16 72%,#121722)}.managementFormationStage:before{content:"";position:absolute;left:7%;right:7%;top:13%;bottom:13%;border:1px solid rgba(130,154,199,.15);border-radius:4px}.managementStageV,.managementStageH{position:absolute;background:rgba(130,154,199,.10);pointer-events:none}.managementStageV{top:13%;bottom:13%;left:50%;width:1px}.managementStageH{left:7%;right:7%;height:1px}.managementStageH.h1{top:39%}.managementStageH.h2{top:66%}.managementUpstage,.managementAudience{position:absolute;left:50%;transform:translateX(-50%);z-index:1;font-size:8px;font-weight:900;letter-spacing:1px;color:rgba(175,190,220,.45)}.managementUpstage{top:5px}.managementAudience{bottom:4px;color:rgba(220,190,120,.55)}',
          '.managementFormationActor{position:absolute;z-index:4;width:72px;height:105px;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;pointer-events:none;filter:brightness(.82)}.managementFormationActor.on{filter:drop-shadow(0 0 8px color-mix(in srgb,var(--cc) 65%,transparent)) brightness(1.08)}.managementFormationAvatar{width:52px;height:78px;display:block;overflow:hidden;border:1px solid color-mix(in srgb,var(--cc) 42%,#30394a);border-radius:7px;background:#0b1018}.managementFormationAvatar svg{width:52px!important;height:78px!important}.managementFormationName{max-width:90px;margin-top:2px;padding:1px 4px;border-radius:4px;background:rgba(8,11,18,.90);color:#dce5f1;font-size:8px;line-height:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.managementFormationName b{color:var(--cc)}.managementFormationActor small{margin-top:1px;color:#667487;font-size:7px;font-weight:900}.managementFormationActor.on small{color:#62e7a2}',
          '@media(max-width:900px){.managementSequenceBar{grid-template-columns:1fr}.managementSequenceMeta{display:none}.managementFormationStage{height:190px}.managementFormationActor{transform:translate(-50%,-50%) scale(.86)}}',
          '`}</style>',
        ].join('\n')
        out = out.replace(appRoot, styles)
      }

      if (!out.includes('managementFormationStage') || !out.includes('switchManagementSequence') || !out.includes('showDurationMs: Math.round(duration * 1000)')) {
        throw new Error('management sequence formation: build assertions failed')
      }
      return { code: out, map: null }
    },
  }
}
