export function liveMonitorPlugin() {
  return {
    name: 'live-monitor',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const state = "  const [masterLog, setMasterLog] = useState([])"
      if (!out.includes('const [rxMon, setRxMon]')) out = out.replace(state, state + "\n  const [pingAlive, setPingAlive] = useState(false)\n  const [pingRtt, setPingRtt] = useState(null)\n  const [rxMon, setRxMon] = useState(() => Array.from({ length: 7 }, (_, i) => ({ id: i + 1, state: 'X', us: 0, age: null })))")

      const refs = "  const lastSerialSeekAtRef = useRef(0)"
      if (!out.includes('const pingSentRef')) out = out.replace(refs, refs + "\n  const pingSentRef = useRef(0)\n  const pongRef = useRef(0)")

      const parser = "    if (!line) return\n    addMasterLog(line)"
      if (!out.includes("line.startsWith('RXMON ')")) out = out.replace(parser, [
        "    if (!line) return",
        "    if (line.startsWith('RXMON ')) {",
        "      const rows = line.slice(6).split(',').map((v) => { const [id, state, us, age] = v.split(':'); return { id: Number(id), state, us: Number(us) || 0, age: Number(age) } })",
        "      if (rows.length) setRxMon(rows)",
        "      return",
        "    }",
        "    if (line.startsWith('PONG')) { const now = performance.now(); pongRef.current = now; setPingAlive(true); if (pingSentRef.current) setPingRtt(now - pingSentRef.current) }",
        "    addMasterLog(line)",
      ].join('\n'))

      const seek = "  const sendSeekToMaster = (time, force = false) => {"
      if (!out.includes('const pingTimer = window.setInterval')) out = out.replace(seek, [
        "  useEffect(() => {",
        "    if (!masterConnected || !masterProtocolReady) { setPingAlive(false); setPingRtt(null); return undefined }",
        "    const ping = () => { pingSentRef.current = performance.now(); sendSerialLine('PING') }",
        "    ping()",
        "    const pingTimer = window.setInterval(ping, 1000)",
        "    const healthTimer = window.setInterval(() => setPingAlive(pongRef.current > 0 && performance.now() - pongRef.current < 2500), 400)",
        "    return () => { window.clearInterval(pingTimer); window.clearInterval(healthTimer) }",
        "  }, [masterConnected, masterProtocolReady])",
        "",
        seek,
      ].join('\n'))

      const timeline = "        <div className=\"timelineScroll\" ref={timelineScrollRef} onDragStart={(e) => e.preventDefault()}>"
      if (!out.includes('RF LIVE MONITOR')) out = out.replace(timeline, [
        "        <section style={{padding:'8px 12px',borderBottom:'1px solid #242a32',background:'#0d1117'}}>",
        "          <div style={{display:'flex',gap:10,alignItems:'center',fontSize:10,marginBottom:7}}><b>RF LIVE MONITOR</b><span style={{color:pingAlive?'#62e7a2':'#ff657a'}}>● PING {pingAlive?'LIVE':'TIMEOUT'}</span><span>{pingRtt==null?'USB RTT --':`USB RTT ${pingRtt.toFixed(1)} ms`}</span><span style={{marginLeft:'auto',color:'#687385'}}>RX 수치는 nRF24 PING→ACK 왕복시간</span></div>",
        "          <div style={{display:'grid',gridTemplateColumns:'repeat(7,minmax(88px,1fr))',gap:6}}>",
        "            {rxMon.slice(0,7).map((rx)=>{ const s=masterConnected?rx.state:'X'; const c=s==='O'?'#62e7a2':(s==='V'||s==='?')?'#ffd84a':'#ff657a'; return <div key={rx.id} style={{padding:'7px 8px',border:'1px solid #2a313c',borderRadius:5,background:'#11161d'}}><div style={{display:'flex',justifyContent:'space-between',fontSize:10}}><b>RX{rx.id}</b><span style={{color:c}}>{s==='O'?'ONLINE':s==='V'?'HASH V':s==='?'?'ACK ?':'OFFLINE'}</span></div><div style={{marginTop:4,fontFamily:'monospace'}}>{masterConnected&&rx.us?`${(rx.us/1000).toFixed(2)} ms`:'-- ms'}</div></div> })}",
        "          </div>",
        "        </section>",
        "",
        timeline,
      ].join('\n'))

      return { code: out, map: null }
    },
  }
}
