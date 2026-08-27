import React, { useEffect, useMemo, useRef, useState } from 'react'
import './SyncLiveApp.css'
import './SyncLiveFootage.css'
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
  for (const key of ['blob', 'data', 'file', 'media', 'audio', 'video']) if (value[key] instanceof Blob) return value[key]
  return null
}

function assetName(entry, fallback) {
  return entry?.value?.name || entry?.value?.filename || entry?.blob?.name || fallback
}

async function findCachedAssets(project) {
  const db = await openDb()
  try {
    const values = await new Promise((resolve, reject) => {
      const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
    const entries = values
      .map((value) => ({ value, blob: asBlob(value) }))
      .filter((x) => x.blob?.size > 100000)

    const wanted = String(project.mediaName || project.audioName || '').toLowerCase()
    const rank = (entry, kind) => {
      const type = String(entry.blob.type || '')
      const name = String(assetName(entry, '') || '').toLowerCase()
      let score = entry.blob.size / 1000000
      if (kind === 'audio' && type.startsWith('audio/')) score += 1000
      if (kind === 'video' && type.startsWith('video/')) score += 1000
      if (wanted && name && (name === wanted || name.includes(wanted) || wanted.includes(name))) score += 300
      return score
    }

    const reference = [...entries].sort((a, b) => rank(b, 'audio') - rank(a, 'audio'))[0] || null
    const footage = [...entries].filter((x) => String(x.blob.type || '').startsWith('video/')).sort((a, b) => rank(b, 'video') - rank(a, 'video'))[0] || null
    return { reference, footage }
  } finally { db.close() }
}

const Dot = ({ ok, warn }) => <span className={`sl-dot ${ok ? 'good' : warn ? 'warn' : ''}`} />
const ReadyRow = ({ ok, label, detail }) => <div className="sl-ready-row"><Dot ok={ok} /><span>{label}</span><small>{detail}</small></div>

export default function SyncLiveAppV3() {
  const project = useMemo(readProject, [])
  const [reference, setReference] = useState(null)
  const [referenceName, setReferenceName] = useState(project.mediaName || project.audioName || '기준 음원 없음')
  const [referenceSource, setReferenceSource] = useState('MANAGEMENT CACHE 탐색 중')
  const [referenceProgress, setReferenceProgress] = useState(0)
  const [referenceBusy, setReferenceBusy] = useState(false)
  const [footageUrl, setFootageUrl] = useState('')
  const [footageName, setFootageName] = useState('푸티지 없음')
  const [footageSource, setFootageSource] = useState('MANAGEMENT CACHE 탐색 중')
  const [footageStatus, setFootageStatus] = useState('WAITING FOR FOOTAGE')
  const [footagePosition, setFootagePosition] = useState(0)
  const [footageDuration, setFootageDuration] = useState(0)
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

  const rt = useRef({ armed: false, autoStart: true, autoResync: false, latencyMs: 90, masterReady: false, showRunning: false, stable: 0, lastTrigger: 0, anchor: null, lastConfidence: 0, lastPreviewSyncAt: 0, lastLockedPosition: null })
  const matcherRef = useRef(null)
  const micRef = useRef(null)
  const portRef = useRef(null)
  const readerRef = useRef(null)
  const writerRef = useRef(null)
  const serialBufferRef = useRef('')
  const writeQueueRef = useRef(Promise.resolve())
  const videoRef = useRef(null)
  const footageUrlRef = useRef('')
  const pendingPreviewTargetRef = useRef(null)

  const log = (message) => setLogs((p) => [{ at: new Date(), message }, ...p].slice(0, 40))
  const notify = (message) => { setToast(message); window.clearTimeout(notify.t); notify.t = window.setTimeout(() => setToast(''), 2800) }

  useEffect(() => { rt.current.armed = armed }, [armed])
  useEffect(() => { rt.current.autoStart = autoStart }, [autoStart])
  useEffect(() => { rt.current.autoResync = autoResync }, [autoResync])
  useEffect(() => { rt.current.latencyMs = latencyMs }, [latencyMs])
  useEffect(() => { rt.current.masterReady = masterReady }, [masterReady])
  useEffect(() => { rt.current.showRunning = showRunning }, [showRunning])

  const setFootage = (blob, name, source) => {
    if (!blob) return
    if (footageUrlRef.current) URL.revokeObjectURL(footageUrlRef.current)
    const url = URL.createObjectURL(blob)
    footageUrlRef.current = url
    setFootageUrl(url)
    setFootageName(name || blob.name || 'Timeline footage')
    setFootageSource(source)
    setFootageStatus('READY · LOCK 대기')
    setFootagePosition(0)
    setFootageDuration(0)
    rt.current.lastLockedPosition = null
    pendingPreviewTargetRef.current = null
    log(`FOOTAGE READY · ${name || blob.name || 'timeline footage'}`)
  }

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
      if (String(blob.type || '').startsWith('video/') && !footageUrlRef.current) setFootage(blob, name, source)
    } catch (e) {
      matcherRef.current = null; setReference(null); log(`REFERENCE ERROR · ${e?.message || 'decode failed'}`); notify(e?.message || '기준 음원 분석 실패')
    } finally { setReferenceBusy(false) }
  }

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const cached = await findCachedAssets(project)
        if (dead) return
        if (cached.footage) setFootage(cached.footage.blob, assetName(cached.footage, project.mediaName || 'Management footage'), 'MANAGEMENT CACHE')
        else setFootageSource('CACHE에 영상 없음 · 파일 선택 가능')
        if (!cached.reference) { setReferenceSource('CACHE 없음 · 파일 선택 필요'); return }
        const name = assetName(cached.reference, project.mediaName || project.audioName || 'Management cached media')
        await loadReference(cached.reference.blob, name, 'MANAGEMENT CACHE')
      } catch (e) { if (!dead) { setReferenceSource('CACHE 접근 실패 · 파일 선택 필요'); setFootageSource('CACHE 접근 실패 · 파일 선택 가능'); log(`CACHE ERROR · ${e?.message || 'unknown'}`) } }
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

  const holdFootage = (status) => {
    const video = videoRef.current
    if (video && !video.paused) video.pause()
    if (video) video.playbackRate = 1
    if (footageUrlRef.current) setFootageStatus(status)
  }

  const followFootage = (positionSec, confidence) => {
    const video = videoRef.current
    if (!video || !footageUrlRef.current || !Number.isFinite(positionSec)) return
    const duration = Number.isFinite(video.duration) ? video.duration : footageDuration
    const maxTime = duration > 0 ? Math.max(0, duration - 0.04) : Math.max(0, positionSec)
    const target = clamp(positionSec, 0, maxTime)
    rt.current.lastLockedPosition = target
    pendingPreviewTargetRef.current = target

    if (video.readyState < 1) {
      setFootageStatus(`LOCKED ${confidence}% · 영상 메타데이터 대기`)
      return
    }

    const drift = target - video.currentTime
    const now = performance.now()
    if (Math.abs(drift) > 0.22 || video.paused || now - rt.current.lastPreviewSyncAt > 1800) {
      try { video.currentTime = target } catch {}
      rt.current.lastPreviewSyncAt = now
    }
    if (Math.abs(drift) > 0.05 && Math.abs(drift) <= 0.22) video.playbackRate = clamp(1 + drift * 0.35, 0.96, 1.04)
    else video.playbackRate = 1
    if (video.paused) video.play().catch(() => {})
    setFootageStatus(`FOLLOWING · LOCK ${confidence}%`)
  }

  const onFeature = (feature) => {
    const matcher = matcherRef.current; if (!matcher) return
    const result = matcher.push(feature); rt.current.lastConfidence = result.confidence; setMatch(result)
    rt.current.stable = result.state === 'LOCKED' && result.confidence >= 90 ? rt.current.stable + 1 : 0

    if (result.state === 'LOCKED' && result.confidence >= 88 && result.positionSec != null) followFootage(result.positionSec, result.confidence)
    else if (result.state === 'LOST') holdFootage('HOLD · MATCH LOST · 마지막 LOCK 프레임')
    else if (result.state === 'SEARCHING') holdFootage(rt.current.lastLockedPosition == null ? 'SEARCHING · LOCK 대기' : 'HOLD · SEARCHING · 마지막 LOCK 프레임')
    else if (result.state === 'CANDIDATE') holdFootage('CANDIDATE · 확정 전 HOLD')

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
    setMicActive(false); setMicStatus('MIC OFF'); setInputDb(-90); holdFootage('HOLD · MIC OFF'); disarm(reason)
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
      micRef.current = { stream, ctx, source, processor, silent }; matcherRef.current?.reset(); rt.current.lastLockedPosition = null; setMicActive(true); setMicStatus('MacBook Microphone ACTIVE · RAW 요청'); setFootageStatus(footageUrlRef.current ? 'SEARCHING · LOCK 대기' : 'WAITING FOR FOOTAGE'); log(`MIC ACTIVE · ${ctx.sampleRate}Hz`)
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
    if (footageUrlRef.current) URL.revokeObjectURL(footageUrlRef.current)
    try { readerRef.current?.cancel() } catch {}
  }, [])

  const readiness = { reference: !!reference, mic: micActive && inputDb > -55, master: masterConnected && masterReady, lock: match.state === 'LOCKED' && match.confidence >= 90 }
  const readyCount = Object.values(readiness).filter(Boolean).length
  const showReady = readiness.reference && readiness.mic && readiness.master
  const meter = clamp((inputDb + 60) / 60, 0, 1)
  const footageTimelineDuration = reference?.duration || footageDuration || 0
  const footageTarget = match.positionSec ?? rt.current.lastLockedPosition ?? 0
  const footageRatio = footageTimelineDuration > 0 ? clamp(footageTarget / footageTimelineDuration, 0, 1) : 0
  const footageDriftMs = match.positionSec != null ? Math.round((footagePosition - match.positionSec) * 1000) : null

  return <div className="sync-live-shell">
    <WorkspaceNav current="sync-live" />
    <header className="sl-header"><div><div className="sl-kicker">LED STAGE · nRF24 PERFORMANCE CONTROL</div><h1>MUSIC SYNC LIVE</h1><p>MacBook 마이크로 현장 PA의 음악 위치를 추적하고, 인식된 타임코드의 업로드 푸티지를 동시에 모니터링하며 기존 nRF24 A/B MASTER의 LIVE_START offset으로 공연 타임라인을 시작합니다.</p></div><div className={`sl-arm-badge ${armed ? 'armed' : ''}`}>{armed ? 'ARMED' : 'DISARMED'}</div></header>
    <main className="sl-grid">
      <section className="sl-card sl-reference"><div className="sl-card-head"><h2>REFERENCE</h2><span>{referenceSource}</span></div><div className="sl-reference-name">{referenceName}</div><div className="sl-meta">{reference ? `${formatTime(reference.duration)} · ${reference.frames.length} fingerprint frames · 100ms hop` : '기준 음원 준비 필요'}</div><div className="sl-progress"><i style={{ width: `${Math.round(referenceProgress * 100)}%` }} /></div><label className="sl-file-btn">{referenceBusy ? '분석 중…' : 'REFERENCE 파일 선택'}<input type="file" accept="audio/*,video/*" disabled={referenceBusy} onChange={(e) => { const f = e.target.files?.[0]; if (f) { loadReference(f, f.name, 'MANUAL FILE'); if (String(f.type).startsWith('video/')) setFootage(f, f.name, 'MANUAL FILE') } }} /></label></section>
      <section className="sl-card sl-input"><div className="sl-card-head"><h2>LIVE INPUT</h2><span>{micStatus}</span></div><div className="sl-big-value">{inputDb.toFixed(1)} <small>dBFS</small></div><div className="sl-meter"><i style={{ width: `${meter * 100}%` }} /></div><div className="sl-meta">echo cancellation / noise suppression / AGC 비활성 요청. macOS/브라우저가 일부 제약을 무시하면 현장 보정으로 흡수합니다.</div><button className={`sl-btn ${micActive ? 'danger' : 'primary'}`} onClick={startMic}>{micActive ? 'MIC STOP' : 'MacBook MIC START'}</button></section>
      <section className={`sl-card sl-match ${match.state.toLowerCase()}`}><div className="sl-card-head"><h2>MATCH ENGINE</h2><span>{match.state}</span></div><div className="sl-match-main"><div><b>{formatTime(match.positionSec)}</b><small>DETECTED POSITION</small></div><div><b>{match.confidence}%</b><small>CONFIDENCE</small></div></div><div className="sl-confidence"><i style={{ width: `${match.confidence}%` }} /></div><div className="sl-diagnostics"><span>score {Number(match.score || 0).toFixed(3)}</span><span>margin {Number(match.margin || 0).toFixed(3)}</span><span>continuity {match.continuityOk === false ? 'REJECT' : 'OK'}</span><span>lock {match.lockFrames || 0}</span></div></section>

      <section className="sl-card sl-footage"><div className="sl-card-head"><h2>LIVE FOOTAGE MONITOR</h2><span>{footageStatus}</span></div><div className="sl-footage-stage">{footageUrl ? <video ref={videoRef} src={footageUrl} muted playsInline preload="auto" onLoadedMetadata={(e) => { const video = e.currentTarget; setFootageDuration(Number.isFinite(video.duration) ? video.duration : 0); const target = pendingPreviewTargetRef.current; if (target != null) { try { video.currentTime = clamp(target, 0, Math.max(0, video.duration - 0.04)) } catch {} } }} onTimeUpdate={(e) => setFootagePosition(e.currentTarget.currentTime)} onSeeked={(e) => setFootagePosition(e.currentTarget.currentTime)} /> : <div className="sl-footage-empty"><b>NO TIMELINE FOOTAGE</b><span>Management에 업로드된 영상이 캐시에 있으면 자동 연결됩니다.</span></div>}<div className="sl-footage-overlay"><span className={`sl-footage-state ${match.state === 'LOCKED' ? 'locked' : ''}`}>{match.state === 'LOCKED' ? 'SYNCED FOOTAGE' : 'HOLD / SEARCH'}</span><strong>{formatTime(match.state === 'LOCKED' ? match.positionSec : rt.current.lastLockedPosition)}</strong></div></div><div className="sl-footage-track"><i style={{ width: `${footageRatio * 100}%` }} /></div><div className="sl-footage-meta"><div><span>FOOTAGE</span><b>{footageName}</b><small>{footageSource}</small></div><div><span>VIDEO</span><b>{formatTime(footagePosition)}</b><small>{footageDuration ? `duration ${formatTime(footageDuration)}` : 'metadata waiting'}</small></div><div><span>DETECTED</span><b>{formatTime(match.positionSec)}</b><small>{footageDriftMs == null ? 'LOCK 대기' : `preview delta ${footageDriftMs > 0 ? '+' : ''}${footageDriftMs} ms`}</small></div></div><label className="sl-file-btn sl-footage-file">푸티지 직접 선택<input type="file" accept="video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFootage(f, f.name, 'MANUAL FOOTAGE') }} /></label></section>

      <section className="sl-card sl-master"><div className="sl-card-head"><h2>nRF24 MASTER</h2><span>{masterStatus}</span></div><div className="sl-master-line"><Dot ok={masterReady} warn={masterConnected} /><b>{masterReady ? 'PROTOCOL READY' : masterConnected ? 'USB OPEN' : 'OFFLINE'}</b></div><p>기존 MASTER 명령 <code>LIVE_START &lt;offsetMs&gt;</code> 사용. Sync Live 때문에 RX 펌웨어를 별도로 바꾸지 않습니다.</p><button className={`sl-btn ${masterConnected ? 'danger' : ''}`} onClick={connectMaster}>{masterConnected ? 'MASTER DISCONNECT' : 'MASTER USB CONNECT'}</button></section>
      <section className="sl-card sl-control"><div className="sl-card-head"><h2>SHOW CONTROL</h2><span>{showRunning ? 'LIVE RUNNING' : showReady ? 'READY TO ARM' : 'NOT READY'}</span></div><button className={`sl-arm-button ${armed ? 'armed' : ''}`} onClick={toggleArm}>{armed ? 'EMERGENCY DISARM' : 'ARM AUDIO SYNC'}</button><div className="sl-toggle-row"><label><input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} /> AUTO START</label><label><input type="checkbox" checked={autoResync} onChange={(e) => setAutoResync(e.target.checked)} /> AUTO RESYNC (진단)</label></div><div className="sl-control-row"><label>MIC → SHOW 보정 <input type="number" min="-1000" max="3000" step="10" value={latencyMs} onChange={(e) => setLatencyMs(clamp(Number(e.target.value) || 0, -1000, 3000))} /> ms</label><button className="sl-btn" disabled={!armed || showRunning || match.state !== 'LOCKED'} onClick={() => match.positionSec != null && liveStart(match.positionSec, 'MANUAL LOCK', match.confidence)}>LOCK POSITION START</button></div><div className="sl-safety-note">영상 모니터는 LED 제어와 독립입니다. LOCKED일 때만 인식 위치를 따라가고 SEARCHING/CANDIDATE/LOST에서는 마지막 확정 프레임을 HOLD합니다. AUTO START: ARMED + MASTER READY + confidence ≥ 90%인 연속 LOCK 5회.</div></section>
      <section className="sl-card sl-ready"><div className="sl-card-head"><h2>SHOW READINESS</h2><span>{readyCount}/4</span></div><ReadyRow ok={readiness.reference} label="REFERENCE INDEX" detail={reference ? 'READY' : '필요'} /><ReadyRow ok={readiness.mic} label="MIC SIGNAL" detail={micActive ? `${inputDb.toFixed(1)} dBFS` : 'OFF'} /><ReadyRow ok={readiness.master} label="MASTER USB / PROTOCOL" detail={masterStatus} /><ReadyRow ok={readiness.lock} label="LIVE MATCH LOCK" detail={`${match.state} ${match.confidence}%`} /><div className={`sl-ready-banner ${showReady ? 'good' : ''}`}>{showReady ? 'READY FOR LOCK TEST' : 'NOT READY'}</div></section>
      <section className="sl-card sl-log"><div className="sl-card-head"><h2>EVENT LOG</h2><span>최근 {logs.length}</span></div><div className="sl-log-list">{logs.length ? logs.map((x, i) => <div key={`${x.at.getTime()}-${i}`}><time>{x.at.toLocaleTimeString('ko-KR', { hour12: false })}</time><span>{x.message}</span></div>) : <p>아직 이벤트가 없습니다.</p>}</div></section>
    </main>{toast ? <div className="sl-toast">{toast}</div> : null}
  </div>
}
