import React, { useEffect, useMemo, useRef, useState } from 'react'
import './SyncLiveApp.css'
import WorkspaceNav from './WorkspaceNav.jsx'
import { buildReferenceFingerprint, extractFeature, formatTime, SyncMatcher, SYNC_LIVE_CONSTANTS } from './syncLiveEngine.js'

const DB_NAME = 'led-stage-management-cache-v1'
const DB_STORE = 'cache'
const SERIAL_BAUD = 115200
const FFT_SIZE = SYNC_LIVE_CONSTANTS.FFT_SIZE
const FRAME_SEC = SYNC_LIVE_CONSTANTS.FRAME_SEC
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function readProject() {
  try { return JSON.parse(localStorage.getItem('led-stage-management-project-v2') || '{}') || {} } catch { return {} }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function asBlob(value) {
  if (value instanceof Blob) return value
  if (!value || typeof value !== 'object') return null
  for (const key of ['blob', 'data', 'file', 'media', 'audio']) if (value[key] instanceof Blob) return value[key]
  return null
}

async function findCachedMedia() {
  const db = await openDb()
  try {
    const values = await new Promise((resolve, reject) => {
      const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
    return values
      .map((value) => ({ value, blob: asBlob(value) }))
      .filter((x) => x.blob?.size > 100000)
      .sort((a, b) => (Number(String(b.blob.type).startsWith('audio/')) - Number(String(a.blob.type).startsWith('audio/'))) || b.blob.size - a.blob.size)[0] || null
  } finally { db.close() }
}

const Dot = ({ ok, warn }) => <span className={`sl-dot ${ok ? 'good' : warn ? 'warn' : ''}`} />
const ReadyRow = ({ ok, label, detail }) => <div className="sl-ready-row"><Dot ok={ok} /><span>{label}</span><small>{detail}</small></div>

export default function SyncLiveAppV2() {
  const project = useMemo(readProject, [])
  const [reference, setReference] = useState(null)
  const [referenceName, setReferenceName] = useState(project.mediaName || project.audioName || '기준 음원 없음')
  const [referenceSource, setReferenceSource] = useState('MANAGEMENT CACHE 탐색 중')
  const [referenceProgress, setReferenceProgress] = useState(0)
  const [referenceBusy, setReferenceBusy] = useState(false)
  const [micActive, setMicActive] = useState(false)
  const [micStatus, setMicStatus] = useState('MIC OFF')
  const [inputDb, setInputDb] = useState(-90)
  const [match, setMatch] = useState({ state: 'SEARCHING', confidence: 0, positionSec: null, score: 0, margin: 0 })
  const [masterConnected, setMasterConnected] = useState(false)
  const [masterReady, setMasterReady] = useState(false)
  const [masterStatus, setMasterStatus] = useState('USB 미연결')
  const [armed, setArmed] = useState(false)
  const [autoStart, setAutoStart] = useState(true)
  const [autoResync, setAutoResync] = useState(false)
  const [latencyMs, setLatencyMs] = useState(90)
  const [showRunning, setShowRunning] = useState(false)
  const [logs, setLogs] = useState([])
  const [toast, setToast] = useState('')

  const rt = useRef({ armed: false, autoStart: true, autoResync: false, latencyMs: 90, masterReady: false, showRunning: false, stable: 0, lastTrigger: 0, anchor: null, lastConfidence: 0 })
  const matcherRef = useRef(null)
  const micRef = useRef(null)
  const portRef = useRef(null)
  const readerRef = useRef(null)
  const writerRef = useRef(null)
  const serialBufferRef = useRef('')
  const writeQueueRef = useRef(Promise.resolve())

  const log = (message) => setLogs((p) => [{ at: new Date(), message }, ...p].slice(0, 40))
  const notify = (message) => { setToast(message); window.clearTimeout(notify.t); notify.t = window.setTimeout(() => setToast(''), 2800) }

  useEffect(() => { rt.current.armed = armed }, [armed])
  useEffect(() => { rt.current.autoStart = autoStart }, [autoStart])
  useEffect(() => { rt.current.autoResync = autoResync }, [autoResync])
  useEffect(() => { rt.current.latencyMs = latencyMs }, [latencyMs])
  useEffect(() => { rt.current.masterReady = masterReady }, [masterReady])
  useEffect(() => { rt.current.showRunning = showRunning }, [showRunning])

  const loadReference = async (blob, name, source) => {
    if (!blob) return
    setReferenceBusy(true); setReferenceProgress(0); setReferenceSource(source); setReferenceName(name || 'Reference audio')
    try {
      const fp = await buildReferenceFingerprint(blob, setReferenceProgress)
      fp.name = name || fp.name
      matcherRef.current = new SyncMatcher(fp)
      setReference(fp)
      setMatch({ state: 'SEARCHING', confidence: 0, positionSec: null, score: 0, margin: 0 })
      log(`REFERENCE READY · ${fp.name} · ${formatTime(fp.duration)}`)
    } catch (e) {
      matcherRef.current = null; setReference(null); log(`REFERENCE ERROR · ${e?.message || 'decode failed'}`); notify(e?.message || '기준 음원 분석 실패')
    } finally { setReferenceBusy(false) }
  }

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const cached = await findCachedMedia()
        if (dead) return
        if (!cached) { setReferenceSource('CACHE 없음 · 파일 선택 필요'); return }
        const name = cached.value?.name || cached.value?.filename || project.mediaName || project.audioName || 'Management cached media'
        await loadReference(cached.blob, name, 'MANAGEMENT CACHE')
      } catch (e) { if (!dead) { setReferenceSource('CACHE 접근 실패 · 파일 선택 필요'); log(`CACHE ERROR · ${e?.message || 'unknown'}`) } }
    })()
    return () => { dead = true }
  }, [])

  const send = async (line) => {
    const writer = writerRef.current
    if (!writer) return false
    let ok = true
    writeQueueRef.current = writeQueueRef.current.then(() => writer.write(new TextEncoder().encode(`${line}\n`))).catch((e) => { ok = false; log(`SERIAL WRITE ERROR · ${e?.message || 'unknown'}`) })
    await writeQueueRef.current
    return ok
  }

  const disarm = (reason, tellMaster = true) => {
    if (rt.current.armed) log(`DISARM · ${reason}`)
    rt.current.armed = false; rt.current.stable = 0; setArmed(false)
    if (tellMaster && writerRef.current) send('DISARM_B')
  }

  const handleLine = (raw) => {
    const line = String(raw || '').trim()
    if (!line) return
    if (/LSM_READY|MASTER_READY|LSM-B1/i.test(line)) { rt.current.masterReady = true; setMasterReady(true); setMasterStatus('nRF24 MASTER READY'); log('MASTER PROTOCOL READY') }
    else if (/LIVE_STARTED\s+(\d+)/i.test(line)) {
      const ms = Number(line.match(/LIVE_STARTED\s+(\d+)/i)?.[1] || 0)
      rt.current.showRunning = true; rt.current.anchor = { at: performance.now(), sec: ms / 1000 }; setShowRunning(true); log(`MASTER LIVE_STARTED · ${formatTime(ms / 1000)}`)
    } else if (/LIVE_FINISHED/i.test(line)) { rt.current.showRunning = false; rt.current.anchor = null; setShowRunning(false); disarm('SHOW FINISHED', false) }
    else if (/PONG|STATUS|ARM_OK|MODE_A_READY|RXMON/i.test(line)) setMasterStatus('nRF24 통신 정상')
  }

  const readSerial = async (port) => {
    const reader = port.readable?.getReader()
    if (!reader) return
    readerRef.current = reader
    const decoder = new TextDecoder()
    try {
      while (portRef.current === port) {
        const { value, done } = await reader.read(); if (done) break
        serialBufferRef.current += decoder.decode(value, { stream: true })
        const lines = serialBufferRef.current.split(/\r?\n/); serialBufferRef.current = lines.pop() || ''; lines.forEach(handleLine)
      }
    } catch (e) { if (portRef.current === port) log(`SERIAL READ STOP · ${e?.message || 'unknown'}`) }
    finally { try { reader.releaseLock() } catch {}; if (readerRef.current === reader) readerRef.current = null }
  }

  const disconnectMaster = async () => {
    disarm('MASTER DISCONNECT')
    const port = portRef.current; portRef.current = null; rt.current.masterReady = false; setMasterConnected(false); setMasterReady(false); setMasterStatus('USB 미연결')
    try { await readerRef.current?.cancel() } catch {}; readerRef.current = null
    try { writerRef.current?.releaseLock() } catch {}; writerRef.current = null
    try { await port?.close() } catch {}
  }

  const connectMaster = async () => {
    if (!('serial' in navigator)) return notify('MASTER 연결은 Web Serial을 지원하는 Chrome/Edge가 필요합니다.')
    if (portRef.current) return disconnectMaster()
    try {
      const port = await navigator.serial.requestPort(); await port.open({ baudRate: SERIAL_BAUD, bufferSize: 255 })
      portRef.current = port; serialBufferRef.current = ''; setMasterConnected(true); setMasterStatus('USB OPEN · MASTER 확인 중')
      if (port.writable) writerRef.current = port.writable.getWriter(); readSerial(port)
      window.setTimeout(() => { if (portRef.current === port) { send('HELLO LSM-B1'); send('PING'); send('STATUS') } }, 1200)
      log('MASTER USB OPEN')
    } catch (e) { if (e?.name !== 'NotFoundError') notify(e?.message || 'MASTER 연결 실패') }
  }

  const liveStart = async (positionSec, reason, confidence) => {
    const s = rt.current
    if (!s.armed || !s.masterReady || s.showRunning || !writerRef.current) return false
    const now = performance.now(); if (now - s.lastTrigger < 3000) return false; s.lastTrigger = now
    const correctedMs = Math.max(0, Math.round(positionSec * 1000 + s.latencyMs))
    if (!await send(`LIVE_START ${correctedMs}`)) return false
    s.showRunning = true; s.anchor = { at: performance.now(), sec: correctedMs / 1000 }; setShowRunning(true)
    log(`${reason} LIVE_START → ${formatTime(correctedMs / 1000)} · confidence ${confidence}%`)
    return true
  }

  const onFeature = (feature) => {
    const matcher = matcherRef.current; if (!matcher) return
    const result = matcher.push(feature); rt.current.lastConfidence = result.confidence; setMatch(result)
    rt.current.stable = result.state === 'LOCKED' && result.confidence >= 90 ? rt.current.stable + 1 : 0
    if (rt.current.armed && rt.current.autoStart && !rt.current.showRunning && rt.current.stable >= 5 && result.positionSec != null) liveStart(result.positionSec, 'AUTO LOCK', result.confidence)
    if (rt.current.armed && rt.current.autoResync && rt.current.showRunning && result.state === 'LOCKED' && result.confidence >= 93 && rt.current.anchor && result.positionSec != null) {
      const expected = rt.current.anchor.sec + (performance.now() - rt.current.anchor.at) / 1000
      const driftMs = Math.round((result.positionSec - expected) * 1000)
      if (Math.abs(driftMs) > 450 && performance.now() - rt.current.lastTrigger > 5000) log(`DRIFT ${driftMs}ms · LIVE 중 자동 재시작은 안전상 차단`)
    }
  }

  const stopMic = async (reason = 'MIC STOP') => {
    const m = micRef.current; micRef.current = null
    if (m) { try { m.processor.disconnect(); m.source.disconnect(); m.silent.disconnect() } catch {}; m.stream.getTracks().forEach((t) => t.stop()); await m.ctx.close().catch(() => {}) }
    setMicActive(false); setMicStatus('MIC OFF'); setInputDb(-90); disarm(reason)
  }

  const startMic = async () => {
    if (micRef.current) return stopMic()
    if (!reference) return notify('기준 음원을 먼저 준비해 주세요.')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })
      const Ctx = window.AudioContext || window.webkitAudioContext; const ctx = new Ctx({ latencyHint: 'interactive' }); await ctx.resume()
      const source = ctx.createMediaStreamSource(stream); const processor = ctx.createScriptProcessor(4096, 1, 1); const silent = ctx.createGain(); silent.gain.value = 0
      source.connect(processor); processor.connect(silent); silent.connect(ctx.destination)
      let queue = new Float32Array(0); let history = new Float32Array(FFT_SIZE); const hop = Math.max(1, Math.round(ctx.sampleRate * FRAME_SEC))
      processor.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0); let sq = 0; for (let i = 0; i < input.length; i += 1) sq += input[i] * input[i]
        setInputDb(clamp(20 * Math.log10(Math.sqrt(sq / Math.max(1, input.length)) || 0.00001), -90, 0))
        const next = new Float32Array(queue.length + input.length); next.set(queue); next.set(input, queue.length); queue = next
        while (queue.length >= hop) {
          const chunk = queue.slice(0, hop); queue = queue.slice(hop)
          const merged = new Float32Array(history.length + chunk.length); merged.set(history); merged.set(chunk, history.length); history = merged.slice(-FFT_SIZE)
          if (history.length === FFT_SIZE) onFeature(extractFeature(history, ctx.sampleRate))
        }
      }
      micRef.current = { stream, ctx, source, processor, silent }; matcherRef.current?.reset(); setMicActive(true); setMicStatus('MacBook Microphone ACTIVE · RAW 요청'); log(`MIC ACTIVE · ${ctx.sampleRate}Hz`)
    } catch (e) { setMicStatus('MIC 권한/입력 오류'); notify(e?.message || '마이크 시작 실패'); log(`MIC ERROR · ${e?.message || 'unknown'}`) }
  }

  const toggleArm = async () => {
    if (rt.current.armed) return disarm('OPERATOR')
    if (!reference || !micRef.current || !rt.current.masterReady || !writerRef.current) return notify('REFERENCE · MIC · MASTER가 모두 READY여야 ARM할 수 있습니다.')
    matcherRef.current?.reset(); rt.current.stable = 0; rt.current.showRunning = false; rt.current.anchor = null; await send('DISARM_B'); rt.current.armed = true; setArmed(true); setShowRunning(false); log('ARMED · 자동 START 권한 활성화')
  }

  useEffect(() => {
    const hidden = () => { if (document.hidden && rt.current.armed) disarm('TAB HIDDEN') }
    const device = () => { if (rt.current.armed) disarm('AUDIO DEVICE CHANGED'); log('AUDIO DEVICE CHANGE 감지') }
    document.addEventListener('visibilitychange', hidden); navigator.mediaDevices?.addEventListener?.('devicechange', device)
    return () => { document.removeEventListener('visibilitychange', hidden); navigator.mediaDevices?.removeEventListener?.('devicechange', device) }
  }, [])

  useEffect(() => () => {
    if (micRef.current) { micRef.current.stream.getTracks().forEach((t) => t.stop()); micRef.current.ctx.close().catch(() => {}) }
    try { readerRef.current?.cancel() } catch {}
  }, [])

  const readiness = { reference: !!reference, mic: micActive && inputDb > -55, master: masterConnected && masterReady, lock: match.state === 'LOCKED' && match.confidence >= 90 }
  const readyCount = Object.values(readiness).filter(Boolean).length
  const showReady = readiness.reference && readiness.mic && readiness.master
  const meter = clamp((inputDb + 60) / 60, 0, 1)

  return <div className="sync-live-shell">
    <WorkspaceNav current="sync-live" />
    <header className="sl-header"><div><div className="sl-kicker">LED STAGE · nRF24 PERFORMANCE CONTROL</div><h1>MUSIC SYNC LIVE</h1><p>MacBook 마이크로 현장 PA의 음악 위치를 추적하고, 기존 nRF24 A/B MASTER의 LIVE_START offset으로 공연 타임라인을 시작합니다.</p></div><div className={`sl-arm-badge ${armed ? 'armed' : ''}`}>{armed ? 'ARMED' : 'DISARMED'}</div></header>
    <main className="sl-grid">
      <section className="sl-card sl-reference"><div className="sl-card-head"><h2>REFERENCE</h2><span>{referenceSource}</span></div><div className="sl-reference-name">{referenceName}</div><div className="sl-meta">{reference ? `${formatTime(reference.duration)} · ${reference.frames.length} fingerprint frames · 100ms hop` : '기준 음원 준비 필요'}</div><div className="sl-progress"><i style={{ width: `${Math.round(referenceProgress * 100)}%` }} /></div><label className="sl-file-btn">{referenceBusy ? '분석 중…' : 'REFERENCE 파일 선택'}<input type="file" accept="audio/*,video/*" disabled={referenceBusy} onChange={(e) => { const f = e.target.files?.[0]; if (f) loadReference(f, f.name, 'MANUAL FILE') }} /></label></section>
      <section className="sl-card sl-input"><div className="sl-card-head"><h2>LIVE INPUT</h2><span>{micStatus}</span></div><div className="sl-big-value">{inputDb.toFixed(1)} <small>dBFS</small></div><div className="sl-meter"><i style={{ width: `${meter * 100}%` }} /></div><div className="sl-meta">echo cancellation / noise suppression / AGC 비활성 요청. macOS/브라우저가 일부 제약을 무시하면 현장 보정으로 흡수합니다.</div><button className={`sl-btn ${micActive ? 'danger' : 'primary'}`} onClick={startMic}>{micActive ? 'MIC STOP' : 'MacBook MIC START'}</button></section>
      <section className={`sl-card sl-match ${match.state.toLowerCase()}`}><div className="sl-card-head"><h2>MATCH ENGINE</h2><span>{match.state}</span></div><div className="sl-match-main"><div><b>{formatTime(match.positionSec)}</b><small>DETECTED POSITION</small></div><div><b>{match.confidence}%</b><small>CONFIDENCE</small></div></div><div className="sl-confidence"><i style={{ width: `${match.confidence}%` }} /></div><div className="sl-diagnostics"><span>score {Number(match.score || 0).toFixed(3)}</span><span>margin {Number(match.margin || 0).toFixed(3)}</span><span>continuity {match.continuityOk === false ? 'REJECT' : 'OK'}</span><span>lock {match.lockFrames || 0}</span></div></section>
      <section className="sl-card sl-master"><div className="sl-card-head"><h2>nRF24 MASTER</h2><span>{masterStatus}</span></div><div className="sl-master-line"><Dot ok={masterReady} warn={masterConnected} /><b>{masterReady ? 'PROTOCOL READY' : masterConnected ? 'USB OPEN' : 'OFFLINE'}</b></div><p>기존 MASTER 명령 <code>LIVE_START &lt;offsetMs&gt;</code> 사용. Sync Live 때문에 RX 펌웨어를 별도로 바꾸지 않습니다.</p><button className={`sl-btn ${masterConnected ? 'danger' : ''}`} onClick={connectMaster}>{masterConnected ? 'MASTER DISCONNECT' : 'MASTER USB CONNECT'}</button></section>
      <section className="sl-card sl-control"><div className="sl-card-head"><h2>SHOW CONTROL</h2><span>{showRunning ? 'LIVE RUNNING' : showReady ? 'READY TO ARM' : 'NOT READY'}</span></div><button className={`sl-arm-button ${armed ? 'armed' : ''}`} onClick={toggleArm}>{armed ? 'EMERGENCY DISARM' : 'ARM AUDIO SYNC'}</button><div className="sl-toggle-row"><label><input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} /> AUTO START</label><label><input type="checkbox" checked={autoResync} onChange={(e) => setAutoResync(e.target.checked)} /> AUTO RESYNC (진단)</label></div><div className="sl-control-row"><label>MIC → SHOW 보정 <input type="number" min="-1000" max="3000" step="10" value={latencyMs} onChange={(e) => setLatencyMs(clamp(Number(e.target.value) || 0, -1000, 3000))} /> ms</label><button className="sl-btn" disabled={!armed || showRunning || match.state !== 'LOCKED'} onClick={() => match.positionSec != null && liveStart(match.positionSec, 'MANUAL LOCK', match.confidence)}>LOCK POSITION START</button></div><div className="sl-safety-note">AUTO START: ARMED + MASTER READY + confidence ≥ 90%인 연속 LOCK 5회. 탭 숨김/입력장치 변경/MASTER 해제 시 DISARM. 현재 MASTER는 LIVE 중 강제 재시작을 막으므로 AUTO RESYNC는 진단만 수행합니다.</div></section>
      <section className="sl-card sl-ready"><div className="sl-card-head"><h2>SHOW READINESS</h2><span>{readyCount}/4</span></div><ReadyRow ok={readiness.reference} label="REFERENCE INDEX" detail={reference ? 'READY' : '필요'} /><ReadyRow ok={readiness.mic} label="MIC SIGNAL" detail={micActive ? `${inputDb.toFixed(1)} dBFS` : 'OFF'} /><ReadyRow ok={readiness.master} label="MASTER USB / PROTOCOL" detail={masterStatus} /><ReadyRow ok={readiness.lock} label="LIVE MATCH LOCK" detail={`${match.state} ${match.confidence}%`} /><div className={`sl-ready-banner ${showReady ? 'good' : ''}`}>{showReady ? 'READY FOR LOCK TEST' : 'NOT READY'}</div></section>
      <section className="sl-card sl-log"><div className="sl-card-head"><h2>EVENT LOG</h2><span>최근 {logs.length}</span></div><div className="sl-log-list">{logs.length ? logs.map((x, i) => <div key={`${x.at.getTime()}-${i}`}><time>{x.at.toLocaleTimeString('ko-KR', { hour12: false })}</time><span>{x.message}</span></div>) : <p>아직 이벤트가 없습니다.</p>}</div></section>
    </main>{toast ? <div className="sl-toast">{toast}</div> : null}
  </div>
}
