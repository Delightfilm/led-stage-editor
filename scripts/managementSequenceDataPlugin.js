export function managementSequenceDataPlugin() {
  return {
    name: 'management-sequence-data',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code
      const required = (ok, label) => {
        if (!ok) throw new Error(`management sequence data: ${label} anchor not found`)
      }

      const normalizeStart = out.indexOf('const normalizeProject = (data) =>')
      const componentStart = out.indexOf('export default function App() {', normalizeStart)
      required(normalizeStart >= 0 && componentStart > normalizeStart, 'normalize bounds')
      const beforeComponent = out.slice(normalizeStart, componentStart)
      const normalizeEnd = beforeComponent.lastIndexOf('\n\n')
      required(normalizeEnd > 0, 'normalize end')
      const normalized = `const normalizeProject = (data) => {
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
}

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
      out = out.slice(0, normalizeStart) + normalized + '\n\n' + out.slice(componentStart)

      const stateAnchor = '  const [blocks, setBlocks] = useState(localProject.blocks)'
      required(out.includes(stateAnchor), 'blocks state')
      out = out.replace(stateAnchor, stateAnchor + '\n' + [
        '  const [sequences, setSequences] = useState(localProject.sequences)',
        '  const [activeSequenceId, setActiveSequenceId] = useState(localProject.activeSequenceId)',
        '  const [formations, setFormations] = useState(localProject.formations || [])',
        '  const [mediaClips, setMediaClips] = useState(localProject.mediaClips || [])',
        '  const [projectAssets, setProjectAssets] = useState(localProject.projectAssets || [])',
      ].join('\n'))

      out = out.replace(
        '  const duration = Math.max(1, mediaDuration || projectDuration || DEFAULT_DURATION)',
        '  const duration = Math.max(1, projectDuration || DEFAULT_DURATION)'
      )
      required(out.includes('const duration = Math.max(1, projectDuration || DEFAULT_DURATION)'), 'duration')

      const snapAnchor = '  const snapPoints = useMemo(() => {'
      required(out.includes(snapAnchor), 'snap points')
      out = out.replace(snapAnchor, [
        '  const activeManagementSequence = useMemo(() => sequences.find((seq) => seq.id === activeSequenceId) || sequences[0] || null, [sequences, activeSequenceId])',
        '  const managementStagePositions = useMemo(() => managementFormationAt(formations, costumes, currentTime), [formations, costumes, currentTime])',
        '',
        snapAnchor,
      ].join('\n'))

      const applyStart = out.indexOf('  const applyProjectData = (raw, updatedAt = null) => {')
      const mediaStart = out.indexOf('  const applyMediaBlob = async (blob, meta = {}, cache = true) => {', applyStart)
      required(applyStart >= 0 && mediaStart > applyStart, 'apply project bounds')
      const applyBlock = `  const applyProjectData = (raw, updatedAt = null) => {
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
  }

  const switchManagementSequence = (id) => {
    if (!id || id === activeSequenceId) return
    if (typeof stageLive !== 'undefined' && stageLive) { showToast('LIVE 중에는 시퀀스를 바꿀 수 없어요. 먼저 LIVE를 종료해 주세요.'); return }
    const seq = sequences.find((item) => item.id === id)
    if (!seq) return
    pauseMediaOnly()
    setPlaying(false)
    setActiveSequenceId(seq.id)
    setBlocks(Array.isArray(seq.blocks) ? seq.blocks : [])
    setFormations(Array.isArray(seq.formations) ? seq.formations : [])
    setMediaClips(Array.isArray(seq.mediaClips) ? seq.mediaClips : [])
    setProjectDuration(Math.max(1, Number(seq.manualDuration) || DEFAULT_DURATION))
    setCurrentTime(0)
    const el = getMediaEl()
    if (el) el.currentTime = 0
    if (typeof setFirmwareTarget === 'function') setFirmwareTarget('master')
    showToast('▤ ' + (seq.name || 'Sequence') + ' 로 전환했어요.')
  }

`
      out = out.slice(0, applyStart) + applyBlock + out.slice(mediaStart)

      const programAnchor = '        <section className="programPanel">'
      required(out.includes(programAnchor), 'program panel')
      const bar = `        <section className="managementSequenceBar">
          <div className="managementSequenceTitle"><b>📁 PROJECT</b><span> / SEQUENCES</span></div>
          <div className="managementSequenceTabs">
            {sequences.map((seq, index) => (
              <button key={seq.id} type="button" className={seq.id === activeSequenceId ? 'on' : ''} disabled={typeof stageLive !== 'undefined' && stageLive} onClick={() => switchManagementSequence(seq.id)}>
                <span>{String(index + 1).padStart(2, '0')}</span><b>{seq.name || 'Sequence'}</b><small>{fmtTime(seq.manualDuration || DEFAULT_DURATION)}</small>
              </button>
            ))}
          </div>
          <div className="managementSequenceMeta"><b>{activeManagementSequence?.name || 'Sequence'}</b><span>{fmtTime(duration)} · {blocks.length} blocks · {formations.length} formations</span></div>
        </section>

`
      out = out.replace(programAnchor, bar + programAnchor)

      const appRoot = '    <div className="app">'
      required(out.includes(appRoot), 'app root')
      const style = `      <style>{\`
.managementSequenceBar{flex:0 0 auto;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;min-height:42px;padding:5px 10px;background:#0d1117;border-bottom:1px solid #28313c}.managementSequenceTitle{white-space:nowrap;color:#d8e1ed;font-size:10px}.managementSequenceTitle span{color:#687587}.managementSequenceTabs{display:flex;gap:4px;overflow:auto;min-width:0}.managementSequenceTabs button{min-width:125px;display:grid;grid-template-columns:24px minmax(0,1fr);grid-template-rows:auto auto;column-gap:5px;text-align:left;border:1px solid #303a47;border-radius:5px;background:#151b23;color:#a9b4c3;padding:4px 7px;cursor:pointer}.managementSequenceTabs button.on{border-color:#647dff;background:#202a45;color:#fff}.managementSequenceTabs button:disabled{opacity:.5;cursor:not-allowed}.managementSequenceTabs button span{grid-row:1/3;align-self:center;font:900 9px monospace;color:#6f7d90}.managementSequenceTabs button b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9.5px}.managementSequenceTabs button small{color:#718095;font-size:8px}.managementSequenceMeta{display:flex;flex-direction:column;align-items:flex-end;white-space:nowrap}.managementSequenceMeta b{color:#dce5f2;font-size:10px}.managementSequenceMeta span{color:#687587;font-size:8.5px}
@media(max-width:900px){.managementSequenceBar{grid-template-columns:1fr}.managementSequenceMeta{display:none}}
\`}</style>
`
      out = out.replace(appRoot, appRoot + '\n' + style)

      return { code: out, map: null }
    },
  }
}
