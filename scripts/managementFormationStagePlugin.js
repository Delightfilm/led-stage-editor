export function managementFormationStagePlugin() {
  return {
    name: 'management-whole-stage-formation',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code
      if (out.includes('WHOLE STAGE FORMATION · TIMELINE LOCK')) return null

      const componentAnchor = 'export default function App() {'
      if (!out.includes(componentAnchor)) throw new Error('management formation stage: App anchor not found')
      const helper = `const managementStageCostumeOn = (costume, blocks, time) => {
  const active = (blocks || []).filter((block) => {
    if (block.costumeId !== costume.id) return false
    const start = Number(block.start) || 0
    const dur = Math.max(0, Number(block.dur) || 0)
    return time >= start && time < start + dur
  })
  if (!active.length) return false
  return active.some((block) => {
    const local = Math.max(0, time - (Number(block.start) || 0))
    if (block.type === 'strobe') return Math.floor(local * Math.max(0.01, Number(block.speed) || 5) * 2) % 2 === 0
    if (block.type === 'pulse') {
      const speed = Math.max(0.01, Number(block.speed) || 0.7)
      const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * speed * local - Math.PI / 2)
      return (local * 6) % 1 < Math.max(0.04, env)
    }
    if (block.type === 'fadein') {
      const p = Math.max(0, Math.min(1, local / Math.max(0.001, Number(block.dur) || 0.001)))
      return (local * 6) % 1 < Math.max(0.04, p)
    }
    if (block.type === 'fadeout') {
      const p = Math.max(0, Math.min(1, local / Math.max(0.001, Number(block.dur) || 0.001)))
      return (local * 6) % 1 < Math.max(0.04, 1 - p)
    }
    return true
  })
}

`
      out = out.replace(componentAnchor, helper + componentAnchor)

      const timelineAnchor = '        <div className="timelineScroll" ref={timelineScrollRef} onDragStart={(e) => e.preventDefault()}>'
      if (!out.includes(timelineAnchor)) throw new Error('management formation stage: timeline anchor not found')
      const panel = `        <section className="managementFormationPanel">
          <div className="managementFormationHead">
            <div><b>🎭 WHOLE STAGE FORMATION · TIMELINE LOCK</b><span>{activeManagementSequence?.name || 'Sequence'} · {formations.length ? formations.length + '개 대형 키프레임' : '기본 대형'}</span></div>
            <strong className={playing ? 'playing' : ''}>{playing ? '● PLAY' : '■ HOLD'} · {fmtTime(currentTime)}</strong>
          </div>
          <div className="managementFormationStage">
            <div className="managementUpstage">UP STAGE</div>
            <div className="managementAudience">▼ CAMERA / 관객석</div>
            <div className="managementStageV" /><div className="managementStageH h1" /><div className="managementStageH h2" />
            {costumes.map((costume, index) => {
              const pos = managementStagePositions[costume.id] || { x: 50, y: 50 }
              const elOn = managementStageCostumeOn(costume, blocks, currentTime)
              return (
                <div key={costume.id || index} className={\`managementFormationActor \${elOn ? 'on' : ''}\`} style={{ left: pos.x + '%', top: pos.y + '%', '--cc': costume.color || '#62e7a2' }}>
                  <span className="managementActorFigure"><i className="head" /><i className="torso" /><i className="leg leftLeg" /><i className="leg rightLeg" /></span>
                  <span className="managementFormationName"><b>{index + 1}</b> {costume.name || ('RX ' + (index + 1))}</span>
                  <small>{elOn ? 'EL ON' : 'EL OFF'}</small>
                </div>
              )
            })}
          </div>
        </section>

`
      out = out.replace(timelineAnchor, panel + timelineAnchor)

      const appRoot = '    <div className="app">'
      if (!out.includes(appRoot)) throw new Error('management formation stage: app root not found')
      const style = `      <style>{\`
.managementFormationPanel{flex:0 0 auto;padding:8px 12px 10px;background:#0c1016;border-bottom:1px solid #252e39}.managementFormationHead{height:28px;display:flex;align-items:center;justify-content:space-between;gap:10px}.managementFormationHead>div{display:flex;align-items:baseline;gap:9px}.managementFormationHead b{font-size:10px;letter-spacing:.05em;color:#dce6f3}.managementFormationHead span{color:#6d798b;font-size:8.5px}.managementFormationHead strong{color:#7e8998;font-size:9px;font-variant-numeric:tabular-nums}.managementFormationHead strong.playing{color:#62e7a2}
.managementFormationStage{position:relative;height:230px;overflow:hidden;border:1px solid #26313f;border-radius:7px;background:linear-gradient(180deg,#121927,#090e16 72%,#121722)}.managementFormationStage:before{content:'';position:absolute;left:7%;right:7%;top:13%;bottom:13%;border:1px solid rgba(130,154,199,.15);border-radius:4px}.managementStageV,.managementStageH{position:absolute;background:rgba(130,154,199,.10);pointer-events:none}.managementStageV{top:13%;bottom:13%;left:50%;width:1px}.managementStageH{left:7%;right:7%;height:1px}.managementStageH.h1{top:39%}.managementStageH.h2{top:66%}.managementUpstage,.managementAudience{position:absolute;left:50%;transform:translateX(-50%);z-index:1;font-size:8px;font-weight:900;letter-spacing:1px;color:rgba(175,190,220,.45)}.managementUpstage{top:5px}.managementAudience{bottom:4px;color:rgba(220,190,120,.55)}
.managementFormationActor{position:absolute;z-index:4;width:78px;height:104px;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;pointer-events:none}.managementActorFigure{position:relative;width:42px;height:68px;display:block;filter:brightness(.72)}.managementActorFigure .head{position:absolute;left:14px;top:1px;width:14px;height:14px;border-radius:50%;background:#414b5d}.managementActorFigure .torso{position:absolute;left:10px;top:17px;width:22px;height:29px;border-radius:8px 8px 5px 5px;background:#303a4c;border:1px solid #536174}.managementActorFigure .leg{position:absolute;top:43px;width:8px;height:24px;border-radius:3px;background:#303a4c}.managementActorFigure .leftLeg{left:11px;transform:rotate(4deg)}.managementActorFigure .rightLeg{right:11px;transform:rotate(-4deg)}.managementFormationActor.on .managementActorFigure{filter:drop-shadow(0 0 7px var(--cc)) brightness(1.55)}.managementFormationActor.on .managementActorFigure .torso{background:color-mix(in srgb,var(--cc) 60%,#303a4c);border-color:var(--cc)}.managementFormationName{max-width:94px;margin-top:1px;padding:1px 4px;border-radius:4px;background:rgba(8,11,18,.9);color:#dce5f1;font-size:8px;line-height:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.managementFormationName b{color:var(--cc)}.managementFormationActor small{margin-top:1px;color:#667487;font-size:7px;font-weight:900}.managementFormationActor.on small{color:#62e7a2}
@media(max-width:900px){.managementFormationStage{height:190px}.managementFormationActor{transform:translate(-50%,-50%) scale(.86)}}
\`}</style>
`
      out = out.replace(appRoot, appRoot + '\n' + style)
      return { code: out, map: null }
    },
  }
}
