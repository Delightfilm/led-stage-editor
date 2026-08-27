import React, { useEffect, useMemo, useRef, useState } from 'react'
import './NrfDiagnosticApp.css'

const SERIAL_BAUD = 115200
const PROTOCOL = 'DF_NRF_DIAG_V1'
const BASELINE_KEY = 'df-nrf-diagnostic-baseline-v1'

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0))
const scoreTone = (score) => score >= 99 ? 'good' : score >= 90 ? 'warn' : 'bad'
const passTone = (value) => value === true || value === 1 || value === 'PASS' ? 'good' : value === 'UNVERIFIED' ? 'muted' : 'bad'
const fmtHex = (value) => Number.isFinite(Number(value)) ? `0x${Number(value).toString(16).toUpperCase().padStart(2, '0')}` : '—'
const fmtNumber = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '—'

const loadBaseline = () => {
  try {
    return JSON.parse(localStorage.getItem(BASELINE_KEY) || 'null')
  } catch {
    return null
  }
}

export default function NrfDiagnosticApp() {
  const [connected, setConnected] = useState(false)
  const [protocolReady, setProtocolReady] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState('USB 미연결')
  const [hello, setHello] = useState(null)
  const [health, setHealth] = useState(null)
  const [registers, setRegisters] = useState(null)
  const [stress, setStress] = useState(null)
  const [stressRunning, setStressRunning] = useState(false)
  const [sweep, setSweep] = useState([])
  const [sweepRunning, setSweepRunning] = useState(false)
  const [peerResult, setPeerResult] = useState(null)
  const [baseline, setBaseline] = useState(loadBaseline)
  const [logs, setLogs] = useState([])
  const [toast, setToast] = useState(null)

  const portRef = useRef(null)
  const readerRef = useRef(null)
  const writerRef = useRef(null)
  const readBufferRef = useRef('')
  const writeQueueRef = useRef(Promise.resolve())

  const serialSupported = typeof navigator !== 'undefined' && 'serial' in navigator

  const appendLog = (text, kind = 'rx') => {
    const stamp = new Date().toLocaleTimeString('ko-KR', { hour12: false })
    setLogs((prev) => [...prev.slice(-119), { stamp, text: String(text), kind }])
  }

  const showToast = (message) => {
    setToast(message)
    window.clearTimeout(showToast.timer)
    showToast.timer = window.setTimeout(() => setToast(null), 2600)
  }

  const handlePacket = (packet) => {
    if (!packet || typeof packet !== 'object') return
    if (packet.type === 'hello') {
      const ok = packet.protocol === PROTOCOL
      setHello(packet)
      setProtocolReady(ok)
      setConnectionStatus(ok ? 'DF NRF DIAG READY' : '다른 펌웨어 감지')
      if (!ok) showToast('진단 펌웨어가 아닙니다. 공연용 MASTER/RX는 이 탭에서 제어하지 않습니다.')
      return
    }
    if (packet.type === 'health') {
      setHealth(packet)
      if (packet.hash) setConnectionStatus(packet.chip ? '진단 정상 응답' : 'nRF 응답 이상')
      return
    }
    if (packet.type === 'regs') {
      setRegisters(packet)
      return
    }
    if (packet.type === 'ce') {
      setHealth((prev) => ({ ...(prev || {}), ce: packet.ce }))
      return
    }
    if (packet.type === 'stress') {
      setStress(packet)
      setStressRunning(Boolean(packet.running))
      return
    }
    if (packet.type === 'sweep') {
      setSweepRunning(true)
      setSweep((prev) => {
        const next = prev.filter((row) => Number(row.hz) !== Number(packet.hz))
        return [...next, packet].sort((a, b) => Number(a.hz) - Number(b.hz))
      })
      return
    }
    if (packet.type === 'sweep_done') {
      setSweepRunning(false)
      return
    }
    if (packet.type === 'rf_peer') {
      setPeerResult(packet)
      return
    }
    if (packet.type === 'error') showToast(packet.message || '진단 펌웨어 오류')
  }

  const handleLine = (raw) => {
    const line = String(raw || '').trim()
    if (!line) return
    appendLog(line, 'rx')
    try {
      handlePacket(JSON.parse(line))
    } catch {
      if (/DF_NRF_DIAG_V1/i.test(line)) setConnectionStatus('진단 펌웨어 텍스트 응답')
    }
  }

  const sendLine = async (line) => {
    const writer = writerRef.current
    if (!writer) return false
    appendLog(`> ${line}`, 'tx')
    const bytes = new TextEncoder().encode(`${line}\n`)
    writeQueueRef.current = writeQueueRef.current.then(() => writer.write(bytes)).catch((error) => {
      setConnectionStatus('USB 쓰기 오류')
      appendLog(`! ${error?.message || 'write error'}`, 'error')
    })
    await writeQueueRef.current
    return true
  }

  const startReader = async (port) => {
    if (!port.readable) return
    const reader = port.readable.getReader()
    readerRef.current = reader
    const decoder = new TextDecoder()
    try {
      while (portRef.current === port) {
        const { value, done } = await reader.read()
        if (done) break
        readBufferRef.current += decoder.decode(value, { stream: true })
        const lines = readBufferRef.current.split(/\r?\n/)
        readBufferRef.current = lines.pop() || ''
        lines.forEach(handleLine)
      }
    } catch (error) {
      if (portRef.current === port) {
        setConnectionStatus('USB 읽기 중단')
        appendLog(`! ${error?.message || 'read error'}`, 'error')
      }
    } finally {
      try { reader.releaseLock() } catch {}
      if (readerRef.current === reader) readerRef.current = null
    }
  }

  const disconnect = async (quiet = false) => {
    const port = portRef.current
    if (writerRef.current && stressRunning) {
      try { await sendLine('STRESS STOP') } catch {}
    }
    portRef.current = null
    try { await readerRef.current?.cancel() } catch {}
    readerRef.current = null
    try { writerRef.current?.releaseLock() } catch {}
    writerRef.current = null
    try { await port?.close() } catch {}
    setConnected(false)
    setProtocolReady(false)
    setStressRunning(false)
    setSweepRunning(false)
    setConnectionStatus('USB 미연결')
    if (!quiet) showToast('진단 USB 연결을 해제했습니다.')
  }

  const connect = async () => {
    if (!serialSupported) {
      showToast('Web Serial을 지원하는 데스크톱 Chrome/Edge에서 열어 주세요.')
      return
    }
    if (connected) {
      await disconnect()
      return
    }
    try {
      setConnectionStatus('포트 선택 대기…')
      const port = await navigator.serial.requestPort()
      await port.open({ baudRate: SERIAL_BAUD, bufferSize: 255 })
      portRef.current = port
      readBufferRef.current = ''
      setConnected(true)
      setProtocolReady(false)
      setConnectionStatus('USB OPEN · 진단 펌웨어 확인 중')
      setHello(null)
      setHealth(null)
      setRegisters(null)
      setStress(null)
      setSweep([])
      setPeerResult(null)
      setLogs([])
      try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }) } catch {}
      if (port.writable) writerRef.current = port.writable.getWriter()
      startReader(port)
      window.setTimeout(() => sendLine('HELLO'), 1300)
      window.setTimeout(() => sendLine('CHECK'), 1700)
      window.setTimeout(() => {
        if (portRef.current === port) setConnectionStatus((prev) => prev.startsWith('USB OPEN') ? 'USB OPEN · DF 진단 펌웨어 응답 대기' : prev)
      }, 3200)
    } catch (error) {
      setConnectionStatus('연결 실패')
      if (error?.name !== 'NotFoundError') showToast(error?.message || 'USB 연결에 실패했습니다.')
    }
  }

  useEffect(() => () => { disconnect(true) }, [])

  const runQuickCheck = async () => {
    if (!protocolReady) return showToast('먼저 DF NRF Diagnostic 펌웨어가 올라간 UNO를 연결하세요.')
    await sendLine('CHECK')
    window.setTimeout(() => sendLine('REGDUMP'), 120)
  }

  const toggleStress = async () => {
    if (!protocolReady) return showToast('진단 펌웨어 연결이 필요합니다.')
    await sendLine(stressRunning ? 'STRESS STOP' : 'STRESS START')
  }

  const runSweep = async () => {
    if (!protocolReady) return showToast('진단 펌웨어 연결이 필요합니다.')
    setSweep([])
    setSweepRunning(true)
    await sendLine('SWEEP')
  }

  const runPeerTest = async () => {
    if (!protocolReady) return showToast('진단 펌웨어 연결이 필요합니다.')
    setPeerResult(null)
    await sendLine('RF PEER TEST')
  }

  const runCeTest = async () => {
    if (!protocolReady) return showToast('진단 펌웨어 연결이 필요합니다.')
    await sendLine('CE TEST')
  }

  const saveBaseline = () => {
    const snapshot = registers || health
    if (!snapshot?.hash) return showToast('먼저 Quick Check 또는 Register Dump를 실행하세요.')
    const value = {
      hash: snapshot.hash,
      registers: registers || null,
      createdAt: new Date().toISOString(),
    }
    localStorage.setItem(BASELINE_KEY, JSON.stringify(value))
    setBaseline(value)
    showToast('현재 모듈을 정상 기준값으로 저장했습니다.')
  }

  const clearBaseline = () => {
    localStorage.removeItem(BASELINE_KEY)
    setBaseline(null)
    showToast('기준값을 삭제했습니다.')
  }

  const diagnosis = useMemo(() => {
    if (!connected) return { tone: 'muted', title: '검사 대기', text: '별도 UNO에 신규 nRF24를 연결하고 진단 펌웨어를 업로드한 뒤 USB를 연결하세요.' }
    if (!protocolReady) return { tone: 'warn', title: '진단 펌웨어 확인 중', text: '공연용 MASTER/RX 펌웨어는 이 화면에서 제어하지 않습니다. DF_NRF_DIAG_V1만 허용합니다.' }
    if (!health) return { tone: 'muted', title: 'Quick Check 필요', text: 'Quick Check를 실행하면 SPI read/write와 CE 전송 상태를 조합해 접점 의심 구간을 좁힙니다.' }
    if (!health.chip || clamp(health.miso) < 50 || clamp(health.bus) < 50) return { tone: 'bad', title: 'SPI 응답 없음/불안정', text: 'VCC·GND·MISO·SCK·CSN 계통을 우선 확인하세요. MOSI 단독 문제로 보기 어렵습니다.' }
    if (Number(health.write_fail) > 0 && Number(health.read_fail) === 0) return { tone: 'bad', title: 'MOSI 접점 강력 의심', text: '레지스터 읽기는 정상인데 write→readback이 실패했습니다. D11/MOSI, 점퍼선, 핀헤더 납땜을 우선 확인하세요.' }
    if (clamp(health.bus) < 99) return { tone: 'warn', title: 'SCK/CSN 또는 전원 품질 의심', text: 'SPI framing이 간헐적으로 무너집니다. SCK/CSN을 소프트웨어만으로 완전히 분리할 수는 없으므로 두 경로와 3.3V를 함께 확인하세요.' }
    if (stress && (Number(stress.read_fail) + Number(stress.write_fail) + Number(stress.bad_status)) > 0) return { tone: 'warn', title: '간헐 접촉불량 감지', text: 'Stress Test 중 오류가 기록됐습니다. 모듈/핀헤더를 가볍게 움직이며 오류 카운터가 증가하는 순간을 확인하세요.' }
    if (health.ce === 'FAIL') return { tone: 'bad', title: 'CE/TX 상태 전환 실패', text: 'SPI는 정상이나 CE pulse 뒤 TX_DS가 확인되지 않았습니다. D9/CE 경로 또는 nRF 내부 TX state machine을 확인하세요.' }
    if (peerResult && Number(peerResult.rate) < 950) return { tone: 'bad', title: 'RF 링크 불량 감지', text: 'SPI와 CE는 통과했지만 known-good peer ACK 성공률이 낮습니다. 후보 nRF의 RF 송신/ACK 수신 경로, PA/LNA, 안테나, 전원을 의심하세요.' }
    if (peerResult && Number(peerResult.rate) >= 990) return { tone: 'good', title: '전기 + RF 검증 PASS', text: 'SPI read/write, CE/TX state machine, known-good peer ACK 링크가 모두 정상입니다. 새 모듈 선별용으로 가장 강한 PASS 상태입니다.' }
    return { tone: 'good', title: '단일 모듈 전기적 검사 PASS', text: 'SPI read/write와 CE/TX state machine이 정상입니다. 두 번째 spare UNO의 known-good peer까지 연결하면 실제 RF 링크도 검증할 수 있습니다.' }
  }, [connected, protocolReady, health, stress, peerResult])

  const currentHash = registers?.hash || health?.hash || null
  const baselineMatch = baseline?.hash && currentHash ? baseline.hash === currentHash : null
  const stressErrors = Number(stress?.read_fail || 0) + Number(stress?.write_fail || 0) + Number(stress?.bad_status || 0)

  const pinRows = [
    { pin: 'D11 / MOSI', score: health?.mosi, verdict: health ? `${Math.round(clamp(health.mosi))}%` : '—', note: 'RF_CH write → readback 성공률로 추론' },
    { pin: 'D12 / MISO', score: health?.miso, verdict: health ? `${Math.round(clamp(health.miso))}%` : '—', note: 'STATUS/제약 레지스터 read 유효성으로 추론' },
    { pin: 'D13 / SCK + D10 / CSN', score: health?.bus, verdict: health ? `${Math.round(clamp(health.bus))}%` : '—', note: 'SPI framing 경로. 두 핀을 소프트웨어만으로 완전 분리 불가' },
    { pin: 'D9 / CE', tone: passTone(health?.ce), verdict: health?.ce || '—', note: 'Auto-ACK OFF 단일 TX 후 TX_DS로 CE/state machine 검사' },
    { pin: '3.3V / GND', tone: health?.chip ? 'good' : health ? 'bad' : 'muted', verdict: health ? (health.chip ? '응답 있음' : '확인 필요') : '—', note: 'SPI 응답 존재만 확인. 순간 전압강하는 ADC/오실로스코프 필요' },
  ]

  return (
    <main className="nrfdiag-page">
      <section className="nrfdiag-hero">
        <div>
          <p className="nrfdiag-kicker">DF STAGE · BENCH TOOL</p>
          <h1>NRF DIAGNOSTIC</h1>
          <p>신규 nRF24 모듈의 SPI 접점, 레지스터 무결성, CE/TX state machine을 USB COM으로 실시간 검사합니다.</p>
        </div>
        <div className={`nrfdiag-connection ${protocolReady ? 'is-ready' : ''}`}>
          <span className="nrfdiag-dot" />
          <div><strong>{connectionStatus}</strong><small>{connected ? '115200 baud' : 'Chrome / Edge Web Serial'}</small></div>
          <button type="button" className="nrfdiag-primary" onClick={connect}>{connected ? 'DISCONNECT' : 'CONNECT USB'}</button>
        </div>
      </section>

      <section className="nrfdiag-warning">
        <strong>공연용 MASTER/RX 코드와 완전 분리</strong>
        <span>이 탭은 별도 UNO + 검사할 nRF24 전용입니다. 기존 MASTER 또는 RX 보드에 Diagnostic 펌웨어를 업로드하지 마세요.</span>
        <div className="nrfdiag-downloads"><a href="/DF_NRF24_Diagnostic_UNO.ino" download>CANDIDATE .INO</a><a href="/DF_NRF24_Diagnostic_Peer_UNO.ino" download>PEER .INO</a></div>
      </section>

      <section className="nrfdiag-toolbar">
        <button type="button" onClick={runQuickCheck} disabled={!protocolReady}>QUICK CHECK</button>
        <button type="button" onClick={toggleStress} disabled={!protocolReady} className={stressRunning ? 'is-active' : ''}>{stressRunning ? 'STOP STRESS' : 'CONTACT STRESS'}</button>
        <button type="button" onClick={runSweep} disabled={!protocolReady || sweepRunning}>{sweepRunning ? 'SWEEP RUNNING…' : 'SPI SPEED SWEEP'}</button>
        <button type="button" onClick={runCeTest} disabled={!protocolReady}>CE / TX TEST</button>
        <button type="button" onClick={runPeerTest} disabled={!protocolReady}>RF PEER TEST</button>
        <button type="button" onClick={() => sendLine('REGDUMP')} disabled={!protocolReady}>REGISTER DUMP</button>
        <button type="button" onClick={() => sendLine('RESET STATS')} disabled={!protocolReady}>RESET STATS</button>
      </section>

      <section className={`nrfdiag-diagnosis tone-${diagnosis.tone}`}>
        <div><span>DIAGNOSIS</span><strong>{diagnosis.title}</strong></div>
        <p>{diagnosis.text}</p>
      </section>

      <section className="nrfdiag-grid nrfdiag-health-grid">
        <article className="nrfdiag-card"><span>nRF CHIP</span><strong className={`tone-${passTone(health?.chip)}`}>{health ? (health.chip ? 'OK' : 'FAIL') : '—'}</strong><small>register sanity</small></article>
        <article className="nrfdiag-card"><span>MOSI</span><strong className={`tone-${health ? scoreTone(clamp(health.mosi)) : 'muted'}`}>{health ? `${Math.round(clamp(health.mosi))}%` : '—'}</strong><small>write/readback</small></article>
        <article className="nrfdiag-card"><span>MISO</span><strong className={`tone-${health ? scoreTone(clamp(health.miso)) : 'muted'}`}>{health ? `${Math.round(clamp(health.miso))}%` : '—'}</strong><small>read validity</small></article>
        <article className="nrfdiag-card"><span>SCK / CSN</span><strong className={`tone-${health ? scoreTone(clamp(health.bus)) : 'muted'}`}>{health ? `${Math.round(clamp(health.bus))}%` : '—'}</strong><small>SPI framing</small></article>
        <article className="nrfdiag-card"><span>CE / TX</span><strong className={`tone-${passTone(health?.ce)}`}>{health?.ce || '—'}</strong><small>TX_DS state test</small></article>
        <article className="nrfdiag-card"><span>CONFIG HASH</span><strong className="nrfdiag-hash">{currentHash || '—'}</strong><small>{baselineMatch === true ? 'baseline match' : baselineMatch === false ? 'baseline mismatch' : 'baseline not set'}</small></article>
        <article className="nrfdiag-card"><span>RF PEER ACK</span><strong className={`tone-${peerResult ? scoreTone(clamp(Number(peerResult.rate) / 10)) : 'muted'}`}>{peerResult ? `${(Number(peerResult.rate) / 10).toFixed(1)}%` : '—'}</strong><small>{peerResult ? `${peerResult.ok}/${peerResult.total} ACK` : 'optional known-good peer'}</small></article>
      </section>

      <section className="nrfdiag-columns">
        <article className="nrfdiag-panel">
          <div className="nrfdiag-panel-head"><div><span>PIN / PATH DIAGNOSIS</span><h2>접점 추론</h2></div><small>UNO hardware SPI</small></div>
          <div className="nrfdiag-pin-table">
            {pinRows.map((row) => <div className="nrfdiag-pin-row" key={row.pin}>
              <strong>{row.pin}</strong>
              <span className={`tone-${row.tone || (row.score == null ? 'muted' : scoreTone(clamp(row.score)))}`}>{row.verdict}</span>
              <small>{row.note}</small>
            </div>)}
          </div>
        </article>

        <article className="nrfdiag-panel">
          <div className="nrfdiag-panel-head"><div><span>CONTACT STRESS</span><h2>실시간 오류 카운터</h2></div><small>{stressRunning ? 'RUNNING' : 'IDLE'}</small></div>
          <div className="nrfdiag-stat-grid">
            <div><span>CYCLES</span><strong>{fmtNumber(stress?.cycles)}</strong></div>
            <div><span>READ FAIL</span><strong className={Number(stress?.read_fail) ? 'tone-bad' : ''}>{fmtNumber(stress?.read_fail)}</strong></div>
            <div><span>WRITE FAIL</span><strong className={Number(stress?.write_fail) ? 'tone-bad' : ''}>{fmtNumber(stress?.write_fail)}</strong></div>
            <div><span>BAD STATUS</span><strong className={Number(stress?.bad_status) ? 'tone-bad' : ''}>{fmtNumber(stress?.bad_status)}</strong></div>
          </div>
          <div className={`nrfdiag-stress-banner ${stressErrors ? 'has-error' : ''}`}>{stressErrors ? `오류 ${stressErrors.toLocaleString()}회 감지 · 접점 움직임과 발생 시점을 비교하세요.` : 'Stress Test를 켠 뒤 모듈/핀헤더를 가볍게 움직여 보세요.'}</div>
        </article>
      </section>

      <section className="nrfdiag-columns">
        <article className="nrfdiag-panel">
          <div className="nrfdiag-panel-head"><div><span>SPI SPEED SWEEP</span><h2>주파수별 안정성</h2></div><small>250 kHz → 8 MHz</small></div>
          <div className="nrfdiag-sweep">
            {[250000, 500000, 1000000, 2000000, 4000000, 8000000].map((hz) => {
              const row = sweep.find((item) => Number(item.hz) === hz)
              const rate = row ? clamp(Number(row.rate) / 10) : 0
              return <div className="nrfdiag-sweep-row" key={hz}>
                <strong>{hz >= 1000000 ? `${hz / 1000000} MHz` : `${hz / 1000} kHz`}</strong>
                <div className="nrfdiag-meter"><span style={{ width: `${rate}%` }} /></div>
                <span className={row ? `tone-${scoreTone(rate)}` : 'tone-muted'}>{row ? `${rate.toFixed(1)}%` : '—'}</span>
              </div>
            })}
          </div>
        </article>

        <article className="nrfdiag-panel">
          <div className="nrfdiag-panel-head"><div><span>GOLDEN MODULE / RF PEER</span><h2>정상 기준 비교</h2></div><small>local browser + optional peer</small></div>
          <div className="nrfdiag-baseline">
            <div><span>CURRENT</span><strong>{currentHash || '—'}</strong></div>
            <div><span>BASELINE</span><strong>{baseline?.hash || '—'}</strong></div>
            <div><span>RESULT</span><strong className={`tone-${baselineMatch == null ? 'muted' : baselineMatch ? 'good' : 'bad'}`}>{baselineMatch == null ? 'NOT SET' : baselineMatch ? 'MATCH' : 'MISMATCH'}</strong></div>
          </div>
          <div className="nrfdiag-inline-actions"><button type="button" onClick={saveBaseline} disabled={!currentHash}>SET CURRENT AS BASELINE</button><button type="button" onClick={clearBaseline} disabled={!baseline}>CLEAR</button></div>
          <p className="nrfdiag-help">known-good 모듈 하나를 기준 hash로 저장할 수 있습니다. 실제 RF까지 보려면 두 번째 spare UNO에 PEER .INO와 정상 nRF를 올려 전원을 켜고, 후보 보드에서 RF PEER TEST를 실행하세요. 테스트 채널은 CH42입니다.</p>
        </article>
      </section>

      <section className="nrfdiag-columns">
        <article className="nrfdiag-panel">
          <div className="nrfdiag-panel-head"><div><span>REGISTER SNAPSHOT</span><h2>nRF24L01 register</h2></div><small>{hello ? `${hello.board || 'UNO'} · CE D${hello.ce} / CSN D${hello.csn}` : '—'}</small></div>
          <div className="nrfdiag-registers">
            {[
              ['STATUS', health?.status ?? registers?.status], ['CONFIG', registers?.config ?? health?.config], ['EN_AA', registers?.en_aa],
              ['EN_RXADDR', registers?.en_rxaddr], ['SETUP_AW', registers?.setup_aw ?? health?.setup_aw], ['SETUP_RETR', registers?.setup_retr],
              ['RF_CH', registers?.rf_ch ?? health?.rf_ch], ['RF_SETUP', registers?.rf_setup], ['FIFO_STATUS', registers?.fifo_status],
              ['DYNPD', registers?.dynpd], ['FEATURE', registers?.feature], ['SPI HZ', health?.speed],
            ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{label === 'SPI HZ' ? fmtNumber(value) : fmtHex(value)}</strong></div>)}
          </div>
        </article>

        <article className="nrfdiag-panel nrfdiag-log-panel">
          <div className="nrfdiag-panel-head"><div><span>COM SERIAL</span><h2>Raw log</h2></div><button type="button" onClick={() => setLogs([])}>CLEAR LOG</button></div>
          <div className="nrfdiag-log" role="log" aria-live="polite">
            {logs.length ? logs.map((row, index) => <div key={`${row.stamp}-${index}`} className={`log-${row.kind}`}><span>{row.stamp}</span><code>{row.text}</code></div>) : <p>USB 데이터를 기다리는 중…</p>}
          </div>
        </article>
      </section>

      <section className="nrfdiag-footnote">
        <strong>판정 범위</strong>
        <p>MOSI/MISO는 레지스터 동작으로 강하게 추론할 수 있지만 SCK와 CSN은 단일 nRF만으로 완전히 분리할 수 없습니다. SPI PASS 또한 PA/LNA 출력, 안테나 성능, 실제 수신거리까지 보증하지 않으므로 RF 최종 검증에는 known-good peer가 필요합니다.</p>
      </section>
      {toast ? <div className="nrfdiag-toast">{toast}</div> : null}
    </main>
  )
}
