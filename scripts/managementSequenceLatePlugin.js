export function managementSequenceLatePlugin() {
  return {
    name: 'management-sequence-late-workspace',
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
        if (!out.includes('sequenceDurationMs') || !out.includes('requestedDurationMs')) {
          throw new Error('management sequence late: firmware duration patch failed')
        }
        return { code: out, map: null }
      }

      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code
      const required = (ok, label) => {
        if (!ok) throw new Error(`management sequence late: ${label} anchor not found`)
      }

      out = out.replace(
        '      return buildManagementFirmwareBundle({ costumes, blocks })',
        '      return buildManagementFirmwareBundle({ costumes, blocks, showDurationMs: Math.round(duration * 1000) })'
      )
      out = out.replace('  }, [costumes, blocks])', '  }, [costumes, blocks, duration])')
      required(out.includes('showDurationMs: Math.round(duration * 1000)'), 'firmware bundle call')

      out = out.replace(
        '    const bw = width / wavePeaks.length',
        '    const mediaDrawWidth = Math.min(width, Math.max(1, Number(mediaDuration || duration)) * pps)\n    const bw = mediaDrawWidth / wavePeaks.length'
      )

      const marker = 'EL LIVE PREVIEW · TIMELINE LOCK'
      const markerPos = out.indexOf(marker)
      const timelineAnchor = '        <div className="timelineScroll" ref={timelineScrollRef} onDragStart={(e) => e.preventDefault()}>'
      const timelinePos = out.indexOf(timelineAnchor, markerPos)
      required(markerPos >= 0 && timelinePos > markerPos, 'EL preview panel')
      const panelStart = out.lastIndexOf('        <section', markerPos)
      required(panelStart >= 0 && panelStart < markerPos, 'EL preview start')

      const stagePanel = `        <section className="managementFormationPanel">
          <div className="managementFormationHead">
            <div><b>🎭 WHOLE STAGE FORMATION · TIMELINE LOCK</b><span>{activeManagementSequence?.name || 'Sequence'} · {formations.length ? formations.length + '개 대형 키프레임' : '기본 대형'}</span></div>
            <strong className={playing ? 'playing' : ''}>{playing ? '● PLAY' : '■ HOLD'} · {fmtTime(currentTime)}</strong>
          </div>
          <div className="managementFormationStage">
            <div className="managementUpstage">UP STAGE</div><div className="managementAudience">▼ CAMERA / 관객석</div>
            <div className="managementStageV" /><div className="managementStageH h1" /><div className="managementStageH h2" />
            {costumes.map((costume, index) => {
              const preview = managementPreviewState(costume, blocks, currentTime)
              const pos = managementStagePositions[costume.id] || { x: 50, y: 50 }
              return (
                <div key={costume.id || index} className={\`managementFormationActor \${preview.on ? 'on' : ''}\`} style={{ left: pos.x + '%', top: pos.y + '%', '--cc': costume.color || '#62e7a2' }}>
                  <span className="managementFormationAvatar"><ManagementElAvatarPreview zoneColors={preview.zones} glowId={'mgmt-stage-glow-' + index} /></span>
                  <span className="managementFormationName"><b>{index + 1}</b> {costume.name || ('RX ' + (index + 1))}</span>
                  <small>{preview.on ? 'EL ON' : 'EL OFF'}</small>
                </div>
              )
            })}
          </div>
        </section>

`
      out = out.slice(0, panelStart) + stagePanel + out.slice(timelinePos)

      const appRoot = '    <div className="app">'
      required(out.includes(appRoot), 'app root')
      if (!out.includes('.managementFormationPanel{')) {
        const style = `      <style>{\`
.managementFormationPanel{flex:0 0 auto;padding:8px 12px 10px;background:#0c1016;border-bottom:1px solid #252e39}.managementFormationHead{height:28px;display:flex;align-items:center;justify-content:space-between;gap:10px}.managementFormationHead>div{display:flex;align-items:baseline;gap:9px}.managementFormationHead b{font-size:10px;letter-spacing:.05em;color:#dce6f3}.managementFormationHead span{color:#6d798b;font-size:8.5px}.managementFormationHead strong{color:#7e8998;font-size:9px;font-variant-numeric:tabular-nums}.managementFormationHead strong.playing{color:#62e7a2}
.managementFormationStage{position:relative;height:230px;overflow:hidden;border:1px solid #26313f;border-radius:7px;background:linear-gradient(180deg,#121927,#090e16 72%,#121722)}.managementFormationStage:before{content:'';position:absolute;left:7%;right:7%;top:13%;bottom:13%;border:1px solid rgba(130,154,199,.15);border-radius:4px}.managementStageV,.managementStageH{position:absolute;background:rgba(130,154,199,.10);pointer-events:none}.managementStageV{top:13%;bottom:13%;left:50%;width:1px}.managementStageH{left:7%;right:7%;height:1px}.managementStageH.h1{top:39%}.managementStageH.h2{top:66%}.managementUpstage,.managementAudience{position:absolute;left:50%;transform:translateX(-50%);z-index:1;font-size:8px;font-weight:900;letter-spacing:1px;color:rgba(175,190,220,.45)}.managementUpstage{top:5px}.managementAudience{bottom:4px;color:rgba(220,190,120,.55)}
.managementFormationActor{position:absolute;z-index:4;width:72px;height:105px;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;pointer-events:none;filter:brightness(.82)}.managementFormationActor.on{filter:drop-shadow(0 0 8px color-mix(in srgb,var(--cc) 65%,transparent)) brightness(1.08)}.managementFormationAvatar{width:52px;height:78px;display:block;overflow:hidden;border:1px solid color-mix(in srgb,var(--cc) 42%,#30394a);border-radius:7px;background:#0b1018}.managementFormationAvatar svg{width:52px!important;height:78px!important}.managementFormationName{max-width:90px;margin-top:2px;padding:1px 4px;border-radius:4px;background:rgba(8,11,18,.90);color:#dce5f1;font-size:8px;line-height:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.managementFormationName b{color:var(--cc)}.managementFormationActor small{margin-top:1px;color:#667487;font-size:7px;font-weight:900}.managementFormationActor.on small{color:#62e7a2}
@media(max-width:900px){.managementFormationStage{height:190px}.managementFormationActor{transform:translate(-50%,-50%) scale(.86)}}
\`}</style>
`
        out = out.replace(appRoot, appRoot + '\n' + style)
      }

      if (!out.includes('WHOLE STAGE FORMATION · TIMELINE LOCK') || !out.includes('managementFormationActor')) {
        throw new Error('management sequence late: stage assertions failed')
      }
      return { code: out, map: null }
    },
  }
}
