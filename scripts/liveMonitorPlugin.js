export function liveMonitorPlugin() {
  return {
    name: 'live-monitor',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const state = "  const [masterLog, setMasterLog] = useState([])"
      if (!out.includes('const [rxMon, setRxMon]')) out = out.replace(state, state + "\n  const [pingAlive, setPingAlive] = useState(false)\n  const [pingRtt, setPingRtt] = useState(null)\n  const [rxTelemetrySeen, setRxTelemetrySeen] = useState(false)\n  const [rxPulseId, setRxPulseId] = useState(null)\n  const [rxMon, setRxMon] = useState(() => Array.from({ length: 7 }, (_, i) => ({ id: i + 1, state: 'X', us: 0, age: null, retry: 0 })))")

      const refs = "  const lastSerialSeekAtRef = useRef(0)"
      if (!out.includes('const pingSentRef')) out = out.replace(refs, refs + "\n  const pingSentRef = useRef(0)\n  const pongRef = useRef(0)")

      const parser = "    if (!line) return\n    addMasterLog(line)"
      if (!out.includes("line.startsWith('RXMON ')")) out = out.replace(parser, [
        "    if (!line) return",
        "    if (line.startsWith('RXPULSE ')) { setRxPulseId(Number(line.slice(8)) || null); return }",
        "    if (line.startsWith('RXMON ')) {",
        "      const rows = line.slice(6).split(',').map((v) => { const [id, state, us, age, retry] = v.split(':'); return { id: Number(id), state, us: Number(us) || 0, age: Number(age), retry: Number(retry) || 0 } })",
        "      if (rows.length) { setRxMon(rows); setRxTelemetrySeen(true) }",
        "      return",
        "    }",
        "    if (line.startsWith('LIVE_STARTED ')) {",
        "      const offsetMs = Math.max(0, Number(line.slice(13).trim()) || 0)",
        "      window.dispatchEvent(new CustomEvent('lsm-live-started', { detail: { offsetMs } }))",
        "    }",
        "    if (line === 'LIVE_FINISHED') window.dispatchEvent(new CustomEvent('lsm-live-finished'))",
        "    if (line.startsWith('PONG')) { const now = performance.now(); pongRef.current = now; setPingAlive(true); if (pingSentRef.current) setPingRtt(now - pingSentRef.current) }",
        "    addMasterLog(line)",
      ].join('\n'))

      const seek = "  const sendSeekToMaster = (time, force = false) => {"
      if (!out.includes('const pingTimer = window.setInterval')) out = out.replace(seek, [
        "  useEffect(() => {",
        "    if (!masterConnected || !masterProtocolReady) { setPingAlive(false); setPingRtt(null); setRxTelemetrySeen(false); setRxPulseId(null); return undefined }",
        "    const ping = () => { pingSentRef.current = performance.now(); sendSerialLine('PING') }",
        "    ping()",
        "    const pingTimer = window.setInterval(ping, 1000)",
        "    const healthTimer = window.setInterval(() => setPingAlive(pongRef.current > 0 && performance.now() - pongRef.current < 2500), 400)",
        "    return () => { window.clearInterval(pingTimer); window.clearInterval(healthTimer) }",
        "  }, [masterConnected, masterProtocolReady])",
        "",
        seek,
      ].join('\n'))

      const controlStart = "        <section className=\"latencyBar\">"
      const timeline = "        <div className=\"timelineScroll\" ref={timelineScrollRef} onDragStart={(e) => e.preventDefault()}>"
      if (!out.includes('rxLiveRail') && out.includes(controlStart) && out.includes(timeline)) {
        out = out.replace(controlStart, [
          "        <section className=\"stageControlDock\">",
          "          <aside className=\"rxLiveRail\" title=\"RX 수치는 nRF24 PING→ACK 왕복시간\">",
          "            <div className=\"rxLiveRailHead\">",
          "              <b>RF LIVE</b>",
          "              <span className=\"rxPingState\" style={{color:pingAlive?'#62e7a2':'#ff657a'}}>● {pingAlive?'LIVE':'TIMEOUT'}</span>",
          "              <span className=\"rxUsbRtt\">{pingRtt==null?'RTT --':`${pingRtt.toFixed(1)} ms`}</span>",
          "            </div>",
          "            <div className=\"rxLiveRows\">",
          "              {rxMon.slice(0,7).map((rx)=>{ const telemetryReady=masterConnected&&rxTelemetrySeen; const s=telemetryReady?rx.state:'W'; const c=s==='O'?'#62e7a2':(s==='V'||s==='?')?'#ffd84a':s==='W'?'#8c98aa':'#ff657a'; return <div key={rx.id} className={`rxLiveRow${rxPulseId===rx.id?' rxPulse':''}`}><b>RX{rx.id}</b><span className=\"rxLiveState\" style={{color:c}}>{s==='O'?'ONLINE':s==='V'?'HASH V':s==='?'?'ACK ?':s==='W'?'WAIT':'OFFLINE'}</span><span className=\"rxLiveMs\">{telemetryReady&&rx.us?`${(rx.us/1000).toFixed(2)} ms`:'-- ms'}</span><span className=\"rxLiveRetry\">{telemetryReady?`R${rx.retry}`:'R-'}</span></div> })}",
          "            </div>",
          "          </aside>",
          "          <div className=\"stageControlStack\">",
          controlStart,
        ].join('\n'))

        out = out.replace(timeline, [
          "          </div>",
          "        </section>",
          "",
          timeline,
        ].join('\n'))
      }

      return { code: out, map: null }
    },
  }
}
