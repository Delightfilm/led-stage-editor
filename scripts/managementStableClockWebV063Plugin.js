const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`stable A clock web v0.6.3: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementStableClockWebV063Plugin() {
  return {
    name: 'management-stable-clock-web-v063',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      out = replaceRequired(
        out,
        '  const [masterProtocolReady, setMasterProtocolReady] = useState(false)',
        '  const [masterProtocolReady, setMasterProtocolReady] = useState(false)\n  const [masterV063Ready, setMasterV063Ready] = useState(false)',
        'v063 ready state'
      )

      out = replaceRequired(
        out,
        "    addMasterLog(line)\n    if (/LSM_READY|MASTER_READY|LSM-B1/i.test(line)) {",
        "    addMasterLog(line)\n    if (/LSM_READY.*V063/i.test(line)) setMasterV063Ready(true)\n    if (/LSM_READY|MASTER_READY|LSM-B1/i.test(line)) {",
        'v063 handshake detection'
      )

      // Clear the capability bit whenever the current USB session is torn down.
      out = out.replaceAll(
        'setMasterProtocolReady(false)',
        'setMasterProtocolReady(false); setMasterV063Ready(false)'
      )

      out = replaceRequired(
        out,
        "    if (!masterProtocolReady) { showToast('MASTER v0.6.2 펌웨어 연결 후 사용할 수 있어요.'); return }",
        "    if (!masterV063Ready) { showToast('A 독립 CLOCK LOCK은 MASTER/RX v0.6.3 업로드 후 사용할 수 있어요.'); return }",
        'A start v063 guard'
      )

      out = replaceRequired(
        out,
        '    const sent = await sendSerialLine(`A_LIVE_START_NOW ${goOffsetMs}`)',
        '    const sent = await sendSerialLine(`A_LIVE_SCHEDULE ${goOffsetMs}`)',
        'A scheduled command'
      )

      out = replaceRequired(
        out,
        "    showToast(`A 독립 LIVE · ${fmtTime(goOffsetMs / 1000)} · START LEAD 0ms`)",
        "    showToast(`A 독립 CLOCK LOCK · ${fmtTime(goOffsetMs / 1000)} · 공통시계 예약 100ms`)",
        'A start toast'
      )

      out = out.replaceAll("'A 독립 진행 중 · 0ms'", "'A 독립 진행 중 · CLOCK LOCK'")

      if (!out.includes('WEB v0.6.2')) throw new Error('stable A clock web v0.6.3: version marker v0.6.2 not found')
      out = out.replace('WEB v0.6.2', 'WEB v0.6.3')

      return { code: out, map: null }
    },
  }
}
