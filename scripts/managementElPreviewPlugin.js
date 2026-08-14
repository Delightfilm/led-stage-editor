export function managementElPreviewPlugin() {
  return {
    name: 'management-el-preview',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const componentAnchor = 'export default function App() {'
      if (!out.includes('function ManagementElAvatarPreview')) {
        if (!out.includes(componentAnchor)) throw new Error('management EL preview: App component anchor not found')
        const helpers = `
const MANAGEMENT_RELAY_SAFE_HZ = 6

const managementHexToRgb = (hex, fallback = '#62e7a2') => {
  const value = /^#[0-9A-Fa-f]{6}$/.test(String(hex || '')) ? String(hex) : fallback
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  }
}

const managementZoneForPart = (name) => {
  const value = String(name || '')
  if (/안경|글라스|고글/.test(value)) return 'glasses'
  if (/장갑|손/.test(value)) return 'gloves'
  if (/상의|자켓|재킷|조끼|티|셔츠|드레스|원피스/.test(value)) return 'top'
  if (/하의|바지|치마|팬츠/.test(value)) return 'bottom'
  if (/신발|슈즈|부츠/.test(value)) return 'shoes'
  if (/모자|캡|헬멧/.test(value)) return 'hat'
  if (/액세서리|장식|벨트|acc/i.test(value)) return 'acc'
  return 'all'
}

const managementEffectAt = (block, time, fallbackColor) => {
  if (!block) return { r: 0, g: 0, b: 0, a: 0 }
  const start = Number(block.start) || 0
  const dur = Math.max(0, Number(block.dur) || 0)
  const local = Math.max(0, time - start)
  const p = Math.max(0, Math.min(1, dur > 0 ? local / dur : 1))
  let on = true
  switch (block.type) {
    case 'strobe':
      on = Math.floor(local * (Number(block.speed) || 5) * 2) % 2 === 0
      break
    case 'pulse': {
      const speed = Number(block.speed) || 0.7
      const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * speed * local - Math.PI / 2)
      const phase = (local * MANAGEMENT_RELAY_SAFE_HZ) % 1
      on = phase < Math.max(0.04, envelope)
      break
    }
    case 'fadein': {
      const phase = (local * MANAGEMENT_RELAY_SAFE_HZ) % 1
      on = phase < Math.max(0.04, p)
      break
    }
    case 'fadeout': {
      const phase = (local * MANAGEMENT_RELAY_SAFE_HZ) % 1
      on = phase < Math.max(0.04, 1 - p)
      break
    }
    default:
      on = true
  }
  const { r, g, b } = managementHexToRgb(block.color, fallbackColor)
  return { r, g, b, a: on ? 1 : 0 }
}

const managementPreviewState = (costume, allBlocks, time) => {
  const zones = {}
  const activeBlocks = []
  const parts = Array.isArray(costume?.parts) && costume.parts.length
    ? costume.parts
    : [{ id: 'all', name: 'EL 와이어' }]
  parts.forEach((part) => {
    const block = allBlocks.find((candidate) => {
      if (candidate.costumeId !== costume.id || candidate.partId !== part.id) return false
      const start = Number(candidate.start) || 0
      const dur = Math.max(0, Number(candidate.dur) || 0)
      return time >= start && time < start + dur
    })
    if (!block) return
    const state = managementEffectAt(block, time, costume.color || '#62e7a2')
    const zone = managementZoneForPart(part.name)
    if (!zones[zone] || state.a > zones[zone].a) zones[zone] = state
    activeBlocks.push({ block, part, on: state.a > 0.5 })
  })
  return {
    zones,
    activeBlocks,
    on: activeBlocks.some((item) => item.on),
  }
}

const managementZoneFill = (zoneColors, zone, glowId) => {
  const value = zoneColors[zone] || zoneColors.all
  if (!value || value.a <= 0.02) return { fill: '#252b3a', opacity: 1 }
  return {
    fill: `rgb(${value.r},${value.g},${value.b})`,
    filter: `url(#${glowId})`,
    opacity: 1,
  }
}

function ManagementElAvatarPreview({ zoneColors, glowId }) {
  const zf = (zone) => managementZoneFill(zoneColors, zone, glowId)
  return (
    <svg viewBox="0 0 200 300" aria-hidden="true" style={{ width: 78, height: 117, display: 'block' }}>
      <defs>
        <filter id={glowId} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle cx="100" cy="50" r="20" fill="#2b3245" />
      <path d="M80 44 Q100 24 120 44 L120 40 Q100 20 80 40 Z" {...zf('hat')} />
      <g {...zf('glasses')}><rect x="84" y="48" width="13" height="8" rx="3" /><rect x="103" y="48" width="13" height="8" rx="3" /><rect x="97" y="51" width="6" height="2" /></g>
      <g {...zf('top')}><path d="M78 80 Q100 72 122 80 L126 150 L74 150 Z" /><path d="M78 82 L52 120 L60 128 L82 96 Z" /><path d="M122 82 L148 120 L140 128 L118 96 Z" /></g>
      <g {...zf('gloves')}><circle cx="54" cy="126" r="8" /><circle cx="146" cy="126" r="8" /></g>
      <rect x="76" y="148" width="48" height="8" rx="3" {...zf('acc')} />
      <g {...zf('bottom')}><path d="M76 156 L124 156 L120 230 L106 230 L100 180 L94 230 L80 230 Z" /></g>
      <g {...zf('shoes')}><path d="M78 232 L106 232 L106 244 L70 244 Q70 234 78 232 Z" transform="translate(-14 8) scale(0.9)" /><path d="M104 232 L132 232 L132 244 L96 244 Q96 234 104 232 Z" transform="translate(14 8) scale(0.9)" /></g>
    </svg>
  )
}

`
        out = out.replace(componentAnchor, helpers + componentAnchor)
      }

      const timelineAnchor = '        <div className="timelineScroll" ref={timelineScrollRef} onDragStart={(e) => e.preventDefault()}>'
      if (!out.includes('EL LIVE PREVIEW · TIMELINE LOCK')) {
        if (!out.includes(timelineAnchor)) throw new Error('management EL preview: timeline anchor not found')
        const panel = `        <section style={{ flex: '0 0 auto', padding: '9px 12px 10px', borderBottom: '1px solid #242a32', background: '#0d1015' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <b style={{ color: '#dce6f3', fontSize: 10, letterSpacing: '.08em' }}>EL LIVE PREVIEW · TIMELINE LOCK</b>
            <span style={{ color: '#687385', fontSize: 9 }}>웹 PLAY / SPACE / A·B LIVE 모두 같은 재생헤드 기준</span>
            <span style={{ marginLeft: 'auto', color: playing ? '#62e7a2' : '#8d98a8', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>{playing ? '● PLAY' : '■ HOLD'} · {fmtTime(currentTime)}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 7 }}>
            {costumes.map((costume, index) => {
              const preview = managementPreviewState(costume, blocks, currentTime)
              const activeLabel = preview.activeBlocks.length
                ? preview.activeBlocks.map(({ part, block }) => `${part.name || 'EL'}:${block.type || 'solid'}`).join(' · ')
                : '대기'
              return (
                <div key={costume.id || index} style={{ minHeight: 145, display: 'flex', alignItems: 'center', gap: 7, padding: '7px 8px', borderRadius: 7, border: `1px solid ${preview.on ? '#3a8f69' : '#252b35'}`, background: preview.on ? '#10251d' : '#11151b', boxShadow: preview.on ? 'inset 0 0 18px rgba(98,231,162,.09)' : 'none' }}>
                  <ManagementElAvatarPreview zoneColors={preview.zones} glowId={`mgmt-el-glow-${index}`} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: '#dce6f3', fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{costume.name || `RX ${index + 1}`}</div>
                    <div style={{ marginTop: 5, color: preview.on ? '#62e7a2' : '#687385', fontSize: 11, fontWeight: 800 }}>{preview.on ? 'EL ON' : 'EL OFF'}</div>
                    <div style={{ marginTop: 4, color: '#788496', fontSize: 8, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{activeLabel}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

`
        out = out.replace(timelineAnchor, panel + timelineAnchor)
      }

      return { code: out, map: null }
    },
  }
}
