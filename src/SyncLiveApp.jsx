import React, { useEffect, useMemo, useRef, useState } from 'react'
import './SyncLiveApp.css'
import WorkspaceNav from './WorkspaceNav.jsx'
import { buildReferenceFingerprint, extractFeature, formatTime, SyncMatcher, SYNC_LIVE_CONSTANTS } from './syncLiveEngine.js'

const DB_NAME = 'led-stage-management-cache-v1'
const DB_STORE = 'cache'
const SERIAL_BAUD = 115200
const FRAME_SEC = SYNC_LIVE_CONSTANTS.FRAME_SEC
const FFT_SIZE = SYNC_LIVE_CONSTANTS.FFT_SIZE

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
const readProject = () => {
  try { return JSON.parse(localStorage.getItem('led-stage-management-project-v2') || '{}') || {} } catch { return {} }
}

const openDb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1)
  req.onupgradeneeded = () => {
    const db = req.result
    if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE)
  }
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

const extractBlob = (value) => {
  if (value instanceof Blob) return value
  if (!value || typeof value !== 'object') return null
  for (const key of ['blob', 'data', 'file', 'media', 'audio']) {
    if (value[key] instanceof Blob) return value[key]
  }
  return null
}

async function findCachedReference() {
  const db = await openDb()
  try {
    const values = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly')
      const req = tx.objectStore(DB_STORE).getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
    const candidates = values.map((value) => ({ value, blob: extractBlob(value) })).filter((x) => x.blob && x.blob.size > 100000)
    candidates.sort((a, b) => {
      const aAudio = String(a.blob.type).startsWith('audio/') ? 1 : 0
      const bAudio = String(b.blob.type).startsWith('audio/') ? 1 : 0
      return (bAudio - aAudio) || (b.blob.size - a.blob.size)
    })
    return candidates[0] || null
  } finally {
    db.close()
  }
}

function StatusDot({ good, warn }) {
  return <span className={`sl-dot ${good ? 'good' : warn ? 'warn' : ''}`} />
}

function ReadinessRow({ ok, label, detail }) {
  return <div className="sl-ready-row"><StatusDot good={ok} /><span>{label}</span><small>{detail}</small></div>
}

export default function SyncLiveApp() {
  const project = useMemo(readProject, [])
  const [reference, setReference] = useState(null)
  const [referenceName, setReferenceName] = useState(project.mediaName || project.audioName || '기준 음원 없음')
  const [referenceProgress, setReferenceProgress] = useState(0)
  const [referenceBusy, setReferenceBusy] = useState(false)
  const [referenceSource, setReferenceSource] = useState('MANAGEMENT CACHE 탐색 중')
  const [micActive, setMicActive] = useState(false)
  const [micStatus, setMicStatus] = useState('MIC OFF')
  const [inputDb, setInputDb] = useState(-90)
  const [match, setMatch] = useState({ state: 'SEARCHING', confidence: 0, positionSec: null, score: 0, margin: 0 })
  const [armed, setArmed] = useState(false)
  const [autoStart, setAutoStart] = useState(true)
  const [autoResync, setAutoResync] = useState(false)
  const [latencyMs, setLatencyMs] = useState(90)
  const [masterConnected, setMasterConnected] = useState(false)
  const [masterReady, setMasterReady] = useState(false)
  const [masterStatus, setMasterStatus] = useState('USB 미연결')
  const [showStarted, setShowStarted] = useState(false)
  const [showAnchor, setShowAnchor] = useState(null)
  const [logs, setLogs] = useState([])
  const [toast, setToast] = useState('')

  const matcherRef = useRef(null)
  const micRef = useRef(null)
  const serialPortRef = useRef(null)
  const serialReaderRef = useRef(null)
  const serialWriterRef = useRef(null)
  const serialQueueRef = useRef(Promise.resolve())
  const serialBufferRef = useRef('')
  const armedRef = useRef(false)
  const autoStartRef = useRef(true)
  const autoResyncRef = useRef(false)
  const showStartedRef = useRef(false)
  const lastTriggerRef = useRef(0)
  const stableLockRef = useRef(0)
  const latencyRef = useRef(90)
  const livePositionRef = useRef(null)

  const addLog = (message) => setLogs((prev) => [{ at: new Date(), message }, ...prev].slice(0, 30))
  const notify = (message) => {
    setToast(message)
    window.clearTimeout(notify.timer)
    notify.timer = window.setTimeout(() => setToast(''), 2600)
  }

  useEffect(() => { armedRef.current = armed }, [armed])
  useEffect(() => { autoStartRef.current = autoStart }, [autoStart])
  useEffect(() => { autoResyncRef.current = autoResync }, [autoResync])
  useEffect(() => { latencyRef.current = latencyMs }, [latencyMs])
  useEffect(() => { showStartedRef.current = showStarted }, [showStarted])

  const loadReference = async (blob, name, source) => {
    if (!blob) return
    setReferenceBusy(true)
    setReferenceProgress(0)
    setReferenceSource(source)
    setReferenceName(name || project.mediaName || project.audioName || 'Reference audio')
    try {
      const fp = await buildReferenceFingerprint(blob, setReferenceProgress)
      fp.name = name || fp.name
      setReference(fp)
      matcherRef.current = new SyncMatcher(fp)
      setMatch({ state: 'SEARCHING', confidence: 0, positionSec: null, score: 0, margin: 0 })
      addLog(`REFERENCE READY · ${fp.name} · ${formatTime(fp.duration)}`)
    } catch (error) {
      setReference(null)
      matcherRef.current = null
      addLog(`REFERENCE ERROR · ${error?.message || 'decode failed'}`)
      notify(error?.message || '기준 음원 분석에 실패했습니다.')
    } finally {
      setReferenceBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cached = await findCachedReference()
        if (cancelled) return
        if (cached?.blob) {
          const name = cached.value?.name || cached.value?.filename || project.mediaName || project.audioName || 'Management cached media'
          await loadReference(cached.blob, name, 'MANAGEMENT CACHE')
        } else {
          setReferenceSource('CACHE 없음 · 파일 선택 필요')
          addLog('Management 캐시에서 기준 미디어를 찾지 못했습니다.')
        }
      } catch (error) {
        if (!cancelled) {
          setReferenceSource('CACHE 접근 실패 · 파일 선택 필요')
          addLog(`CACHE ERROR · ${error?.message || 'unknown'}`)
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const sendSerialLine = async (line) => {
    const writer = serialWriterRef.current
    if (!writer || !masterConnected) return false
    serialQueueRef.current = serialQueueRef.current.then(() => writer.write(new TextEncoder().encode(`${line}\n`)))
      .catch((error) => {
        setMasterStatus('USB 쓰기 오류')
        addLog(`SERIAL WRITE ERROR · ${error?.message || 'unknown'}`)
      })
    await serialQueueRef.current
    return true
  }

  const emergencyDisarm = (reason, send = true) => {
    if (armedRef.current) addLog(`DISARM · ${reason}`)
    setArmed(false)
    armedRef.current = false
    stableLockRef.current = 0
    if (send) sendSerialLine('DISARM_B')
  }

  const handleMasterLine = (raw) => {
    const line = String(raw || '').trim()
    if (!line) return
    if (/LSM_READY|MASTER_READY|LSM-B1/i.test(line)) {
      setMasterReady(true)
      setMasterStatus('nRF24 MASTER READY')
    } else if (/LIVE_STARTED\s+(\d+)/i.test(line)) {
      const ms = Number(line.match(/LIVE_STARTED\s+(\d+)/i)?.[1] || 0)
      setShowStarted(true)
      showStartedRef.current = true
      setShowAnchor({ performanceAt: performance.now(), positionSec: ms / 1000 })
      addLog(`MASTER LIVE_STARTED · ${formatTime(ms / 1000)}`)
    } else if (/LIVE_FINISHED/i.test(line)) {
      setShowStarted(false)
      showStartedRef.current = false
      setShowAnchor(null)
      emergencyDisarm('SHOW FINISHED', false)
    } else if (/PONG|STATUS|ARM_OK|MODE_A_READY|RXMON/i.test(line)) {
      setMasterStatus('nRF24 통신 정상')
    }
  }

  const startSerialReader = async (port) => {
    if (!port.readable) return
    const reader = port.readable.getReader()
    serialReaderRef.current = reader
    const decoder = new TextDecoder()
    try {
      while (serialPortRef.current === port) {
        const { value, done } = await reader.read()
        if (done) break
        serialBufferRef.current += decoder.decode(value, { stream: true })
        const lines = serialBufferRef.current.split(/\r?\n/)
        serialBufferRef.current = lines.pop() || ''
        lines.forEach(handleMasterLine)
      }
    } catch (error) {
      if (serialPortRef.current === port) addLog(`SERIAL READ STOP · ${error?.message || 'unknown'}`)
    } finally {
      try { reader.releaseLock() } catch {}
      if (serialReaderRef.current === reader) serialReaderRef.current = null
    }
  }

  const disconnectMaster = async () => {
    emergencyDisarm('MASTER DISCONNECT')
    const port = serialPortRef.current
    serialPortRef.current = null
    setMasterConnected(false)
    setMasterReady(false)
    setMasterStatus('USB 미연결')
    try { await serialReaderRef.current?.cancel() } catch {}
    serialReaderRef.current = null
    try { serialWriterRef.current?.releaseLock() } catch {}
    serialWriterRef.current = null
    try { await port?.close() } catch {}
  }

  const connectMaster = async () => {
    if (!('serial' in navigator)) return notify('Web Serial은 Chrome/Edge 계열 데스크톱 브라우저가 필요합니다.')
    if (masterConnected) return disconnectMaster()
    try {
      const port = await navigator.serial.requestPort()
      await port.open({ baudRate: SERIAL_BAUD, bufferSize: 255 })
      serialPortRef.current = port
      setMasterConnected(true)
      setMasterReady(false)
      setMasterStatus('USB OPEN · MASTER 확인 중')
      serialBufferRef.current = ''
      if (port.writable) serialWriterRef.current = port.writable.getWriter()
      startSerialReader(port)
      window.setTimeout(() => {
        if (serialPortRef.current === port) {
          sendSerialLine('HELLO LSM-B1')
          sendSerialLine('PING')
          sendSerialLine('STATUS')
        }
      }, 1200)
      addLog('MASTER USB OPEN')
    } catch (error) {
      if (error?.name !== 'NotFoundError') notify(error?.message || 'MASTER 연결 실패')
    }
  }

  const triggerLiveStart = async (positionSec, reason = 'AUTO') => {
    if (!armedRef.current || !masterReady || showStartedRef.current) return false
    const now = performance.now()
    if (now - lastTriggerRef.current < 3000) return false
    lastTriggerRef.current = now
    const correctedMs = Math.max(0, Math.round(positionSec * 1000 + latencyRef.current))
    const sent = await sendSerialLine(`LIVE_START ${correctedMs}`)
    if (sent) {
      addLog(`${reason} LIVE_START → ${formatTime(correctedMs / 1000)} · confidence ${match.confidence}%`)
      setShowStarted(true)
      showStartedRef.current = true
      setShowAnchor({ performanceAt: performance.now(), positionSec: correctedMs / 1000 })
    }
    return sent
  }

  const processFeature = (feature) => {
    const matcher = matcherRef.current
    if (!matcher) return
    const result = matcher.push(feature)
    setMatch(result)
    livePositionRef.current = result.positionSec

    if (result.state === 'LOCKED' && result.confidence >= 90) stableLockRef.current += 1
    else stableLockRef.current = 0

    if (armedRef.current && autoStartRef.current && !showStartedRef.current && stableLockRef.current >= 5 && result.positionSec != null) {
      triggerLiveStart(result.positionSec, 'AUTO LOCK')
    }

    if (armedRef.current && autoResyncRef.current && showStartedRef.current && result.state === 'LOCKED' && result.confidence >= 93 && result.positionSec != null && showAnchor) {
      const expected = showAnchor.positionSec + (performance.now() - showAnchor.performanceAt) / 1000
      const drift = result.positionSec - expected
      if (Math.abs(drift) > 0.45 && performance.now() - lastTriggerRef.current > 5000) {
        addLog(`DRIFT ${Math.round(drift * 1000)}ms · AUTO RESYNC 차단: 현재 MASTER는 LIVE 중 재시작 불가`)
      }
    }
  }

  const stopMic = async (reason = 'MIC STOP') => {
    const state = micRef.current
    micRef.current = null
    if (state) {
      try { state.processor.disconnect() } catch {}
      try { state.source.disconnect() } catch {}
      try { state.silent.disconnect() } catch {}
      state.stream.getTracks().forEach((t) => t.stop())
      await state.ctx.close().catch(() => {})
    }
    setMicActive(false)
    setMicStatus('MIC OFF')
    setInputDb(-90)
    emergencyDisarm(reason)
  }

  const startMic = async () => {
    if (micActive) return stopMic()
    if (!reference) return notify('기준 음원을 먼저 준비해 주세요.')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      })
      const Ctx = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctx({ latencyHint: 'interactive' })
      await ctx.resume()
      const source = ctx.createMediaStreamSource(stream)
      const processor = ctx.createScriptProcessor(4096, 1, 1)
      const silent = ctx.createGain()
      silent.gain.value = 0
      source.connect(processor)
      processor.connect(silent)
      silent.connect(ctx.destination)

      let pending = []
      let pendingLength = 0
      let history = new Float32Array(FFT_SIZE)
      const hop = Math.max(1, Math.round(ctx.sampleRate * FRAME_SEC))
      let sinceFrame = 0

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0)
        let sq = 0
        for (let i = 0; i < input.length; i += 1) sq += input[i] * input[i]
        const rms = Math.sqrt(sq / Math.max(1, input.length))
        setInputDb(clamp(20 * Math.log10(rms || 0.00001), -90, 0))

        pending.push(new Float32Array(input))
        pendingLength += input.length
        while (pendingLength >= hop) {
          const chunk = new Float32Array(hop)
          let filled = 0
          while (filled < hop && pending.length) {
            const head = pending[0]
            const take = Math.min(head.length, hop - filled)
            chunk.set(head.subarray(0, take), filled)
            filled += take
            if (take === head.length) pending.shift()
            else pending[0] = head.subarray(take)
            pendingLength -= take
          }
          const combined = new Float32Array(history.length + chunk.length)
          combined.set(history)
          combined.set(chunk, history.length)
          history = combined.slice(Math.max(0, combined.length - FFT_SIZE))
          sinceFrame += hop
          if (history.length === FFT_SIZE && sinceFrame >= hop) {
            sinceFrame = 0
            processFeature(extractFeature(history, ctx.sampleRate))
          }
        }
      }

      micRef.current = { stream, ctx, source, processor, silent }
      matcherRef.current?.reset()
      setMicActive(true)
      setMicStatus('MacBook Microphone ACTIVE · RAW 요청')
      addLog(`MIC ACTIVE · ${ctx.sampleRate}Hz · echo/noise/AGC OFF requested`)
    } catch (error) {
      setMicStatus('MIC 권한/입력 오류')
      notify(error?.message || '마이크를 시작할 수 없습니다.')
      addLog(`MIC ERROR · ${error?.message || 'unknown'}`)
    }
  }

  const arm = async () => {
    if (armed) return emergencyDisarm('OPERATOR')
    if (!reference || !micActive || !masterReady) return notify('REFERENCE · MIC · MASTER가 모두 READY여야 ARM할 수 있습니다.')
    matcherRef.current?.reset()
    stableLockRef.current = 0
    showStartedRef.current = false
    setShowStarted(false)
    setShowAnchor(null)
    await sendSerialLine('DISARM_B')
    setArmed(true)
    armedRef.current = true
    addLog('ARMED · Music Sync Live가 MASTER 제어 권한을 가졌습니다.')
  }

  const manualStart = async () => {
    if (match.state !== 'LOCKED' || match.positionSec == null) return notify('LOCKED 상태에서만 수동 START가 가능합니다.')
    await triggerLiveStart(match.positionSec, 'MANUAL')
  }

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && armedRef.current) emergencyDisarm('TAB HIDDEN')
    }
    const onDevice = () => {
      if (armedRef.current) emergencyDisarm('AUDIO DEVICE CHANGED')
      addLog('AUDIO DEVICE CHANGE 감지')
    }
    document.addEventListener('visibilitychange', onVisibility)
    navigator.mediaDevices?.addEventListener?.('devicechange', onDevice)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDevice)
    }
  }, [])

  useEffect(() => () => {
    if (micRef.current) {
      micRef.current.stream.getTracks().forEach((t) => t.stop())
      micRef.current.ctx.close().catch(() => {})
    }
    try { serialReaderRef.current?.cancel() } catch {}
  }, [])

  const readiness = {
    reference: !!reference,
    mic: micActive && inputDb > -55,
    master: masterConnected && masterReady,
    lock: match.state === 'LOCKED' && match.confidence >= 90,
  }
  const readyCount = Object.values(readiness).filter(Boolean).length
  const showReady = readiness.reference && readiness.mic && readiness.master
  const stateClass = match.state.toLowerCase()
  const meter = clamp((inputDb + 60) / 60, 0, 1)

  return (
    <div className="sync-live-shell">
      <WorkspaceNav current="sync-live" />
      <header className="sl-header">
        <div><div className="sl-kicker">LED STAGE · nRF24 PERFORMANCE CONTROL</div><h1>MUSIC SYNC LIVE</h1><p>현장 PA를 MacBook 마이크로 추적해 업로드 음원의 현재 위치를 찾고, 검증된 LIVE_START offset으로 공연 타임라인을 시작합니다.</p></div>
        <div className={`sl-arm-badge ${armed ? 'armed' : ''}`}>{armed ? 'ARMED' : 'DISARMED'}</div>
      </header>

      <main className="sl-grid">
        <section className="sl-card sl-reference">
          <div className="sl-card-head"><h2>REFERENCE</h2><span>{referenceSource}</span></div>
          <div className="sl-reference-name">{referenceName}</div>
          <div className="sl-meta">{reference ? `${formatTime(reference.duration)} · ${reference.frames.length} fingerprint frames · 100ms hop` : '기준 음원 준비 필요'}</div>
          <div className="sl-progress"><i style={{ width: `${Math.round(referenceProgress * 100)}%` }} /></div>
          <label className="sl-file-btn">{referenceBusy ? '분석 중…' : 'REFERENCE 파일 선택'}<input type="file" accept="audio/*,video/*" disabled={referenceBusy} onChange={(e) => { const f = e.target.files?.[0]; if (f) loadReference(f, f.name, 'MANUAL FILE') }} /></label>
        </section>

        <section className="sl-card sl-input">
          <div className="sl-card-head"><h2>LIVE INPUT</h2><span>{micStatus}</span></div>
          <div className="sl-big-value">{inputDb.toFixed(1)} <small>dBFS</small></div>
          <div className="sl-meter"><i style={{ width: `${meter * 100}%` }} /></div>
          <div className="sl-meta">echo cancellation / noise suppression / AGC 비활성 요청 · 브라우저/OS가 일부 제약을 무시할 수 있음</div>
          <button className={`sl-btn ${micActive ? 'danger' : 'primary'}`} onClick={startMic}>{micActive ? 'MIC STOP' : 'MacBook MIC START'}</button>
        </section>

        <section className={`sl-card sl-match ${stateClass}`}>
          <div className="sl-card-head"><h2>MATCH ENGINE</h2><span>{match.state}</span></div>
          <div className="sl-match-main"><div><b>{formatTime(match.positionSec)}</b><small>DETECTED POSITION</small></div><div><b>{match.confidence}%</b><small>CONFIDENCE</small></div></div>
          <div className="sl-confidence"><i style={{ width: `${match.confidence}%` }} /></div>
          <div className="sl-diagnostics"><span>score {Number(match.score || 0).toFixed(3)}</span><span>margin {Number(match.margin || 0).toFixed(3)}</span><span>continuity {match.continuityOk === false ? 'REJECT' : 'OK'}</span><span>lock frames {match.lockFrames || 0}</span></div>
        </section>

        <section className="sl-card sl-master">
          <div className="sl-card-head"><h2>nRF24 MASTER</h2><span>{masterStatus}</span></div>
          <div className="sl-master-line"><StatusDot good={masterReady} warn={masterConnected} /><b>{masterReady ? 'PROTOCOL READY' : masterConnected ? 'USB OPEN' : 'OFFLINE'}</b></div>
          <p>기존 A/B MASTER의 <code>LIVE_START &lt;offsetMs&gt;</code>를 사용합니다. RX 펌웨어는 Sync Live 전용 변경 없이 기존 타임라인을 실행합니다.</p>
          <button className={`sl-btn ${masterConnected ? 'danger' : ''}`} onClick={connectMaster}>{masterConnected ? 'MASTER DISCONNECT' : 'MASTER USB CONNECT'}</button>
        </section>

        <section className="sl-card sl-control">
          <div className="sl-card-head"><h2>SHOW CONTROL</h2><span>{showStarted ? 'LIVE RUNNING' : showReady ? 'READY TO ARM' : 'NOT READY'}</span></div>
          <button className={`sl-arm-button ${armed ? 'armed' : ''}`} onClick={arm}>{armed ? 'EMERGENCY DISARM' : 'ARM AUDIO SYNC'}</button>
          <div className="sl-toggle-row"><label><input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} /> AUTO START</label><label title="현재 MASTER는 LIVE 중 강제 재시작을 차단하므로 기본 OFF"><input type="checkbox" checked={autoResync} onChange={(e) => setAutoResync(e.target.checked)} /> AUTO RESYNC</label></div>
          <div className="sl-control-row"><label>MIC → 공연 위치 보정 <input type="number" min="-1000" max="3000" step="10" value={latencyMs} onChange={(e) => setLatencyMs(clamp(Number(e.target.value) || 0, -1000, 3000))} /> ms</label><button className="sl-btn" disabled={!armed || showStarted || match.state !== 'LOCKED'} onClick={manualStart}>LOCK POSITION START</button></div>
          <div className="sl-safety-note">AUTO START 조건: ARMED + MASTER READY + 연속 LOCK ≥ 5 frames + confidence ≥ 90%. 탭 숨김, 입력장치 변경, MASTER 해제 시 자동 DISARM.</div>
        </section>

        <section className="sl-card sl-ready">
          <div className="sl-card-head"><h2>SHOW READINESS</h2><span>{readyCount}/4</span></div>
          <ReadinessRow ok={readiness.reference} label="REFERENCE INDEX" detail={reference ? 'READY' : '필요'} />
          <ReadinessRow ok={readiness.mic} label="MIC SIGNAL" detail={micActive ? `${inputDb.toFixed(1)} dBFS` : 'OFF'} />
          <ReadinessRow ok={readiness.master} label="MASTER USB / PROTOCOL" detail={masterStatus} />
          <ReadinessRow ok={readiness.lock} label="LIVE MATCH LOCK" detail={`${match.state} ${match.confidence}%`} />
          <div className={`sl-ready-banner ${showReady ? 'good' : ''}`}>{showReady ? 'READY FOR LOCK TEST' : 'NOT READY'}</div>
        </section>

        <section className="sl-card sl-log">
          <div className="sl-card-head"><h2>EVENT LOG</h2><span>최근 {logs.length}</span></div>
          <div className="sl-log-list">{logs.length ? logs.map((item, i) => <div key={`${item.at.getTime()}-${i}`}><time>{item.at.toLocaleTimeString('ko-KR', { hour12: false })}</time><span>{item.message}</span></div>) : <p>아직 이벤트가 없습니다.</p>}</div>
        </section>
      </main>
      {toast ? <div className="sl-toast">{toast}</div> : null}
    </div>
  )
}
