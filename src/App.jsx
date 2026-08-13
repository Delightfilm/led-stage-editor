import React, { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const SHOW_DURATION = 131.932
const STORAGE_KEY = 'led-stage-management-prototype-v1'

const RX_CUES = [
  [{ start: 5, dur: 8 }, { start: 27, dur: 12 }, { start: 58, dur: 16 }, { start: 102, dur: 11 }],
  [{ start: 12, dur: 11 }, { start: 41, dur: 8 }, { start: 72, dur: 19 }, { start: 116, dur: 9 }],
  [{ start: 2, dur: 6 }, { start: 31, dur: 15 }, { start: 65, dur: 12 }, { start: 96, dur: 18 }],
  [{ start: 18, dur: 13 }, { start: 48, dur: 12 }, { start: 80, dur: 15 }, { start: 111, dur: 12 }],
  [{ start: 8, dur: 16 }, { start: 39, dur: 17 }, { start: 76, dur: 10 }, { start: 100, dur: 22 }],
  [{ start: 22, dur: 12 }, { start: 54, dur: 14 }, { start: 88, dur: 13 }, { start: 119, dur: 8 }],
  [{ start: 15, dur: 8 }, { start: 35, dur: 18 }, { start: 70, dur: 14 }, { start: 105, dur: 19 }],
]

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const formatTime = (sec) => {
  const safe = Math.max(0, Number(sec) || 0)
  const min = Math.floor(safe / 60)
  const whole = Math.floor(safe % 60)
  const ms = Math.floor((safe - Math.floor(safe)) * 1000)
  return `${String(min).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

const Dot = ({ tone = 'green' }) => <span className={`status-dot ${tone}`} />

export default function App() {
  const saved = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
  }, [])

  const [delayEnabled, setDelayEnabled] = useState(saved.delayEnabled ?? true)
  const [delayMs, setDelayMs] = useState(Number.isFinite(saved.delayMs) ? saved.delayMs : 80)
  const [currentTime, setCurrentTime] = useState(Number.isFinite(saved.currentTime) ? saved.currentTime : 42.35)
  const [playing, setPlaying] = useState(false)
  const [masterConnected, setMasterConnected] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [savedAt, setSavedAt] = useState(new Date())
  const [dragging, setDragging] = useState(false)
  const timelineRef = useRef(null)
  const playRef = useRef({ at: 0, time: 0 })

  const effectiveDelay = delayEnabled ? delayMs : 0
  const actualTime = clamp(currentTime + effectiveDelay / 1000, 0, SHOW_DURATION)
  const redPct = (currentTime / SHOW_DURATION) * 100
  const yellowPct = (actualTime / SHOW_DURATION) * 100

  useEffect(() => {
    const id = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ delayEnabled, delayMs, currentTime }))
      setSavedAt(new Date())
    }, 100)
    return () => clearTimeout(id)
  }, [delayEnabled, delayMs, currentTime])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  useEffect(() => {
    if (!playing) return
    playRef.current = { at: performance.now(), time: currentTime }
    let raf = 0
    const tick = (now) => {
      const next = playRef.current.time + (now - playRef.current.at) / 1000
      if (next >= SHOW_DURATION) {
        setCurrentTime(SHOW_DURATION)
        setPlaying(false)
        return
      }
      setCurrentTime(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const updateDelay = (value) => setDelayMs(clamp(Math.round(value), 0, 500))

  const seekFromPointer = (event) => {
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    setCurrentTime(ratio * SHOW_DURATION)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">LSM</div>
          <div>
            <h1>LED STAGE MANAGEMENT</h1>
            <p>Prototype B · Live timing & master control</p>
          </div>
        </div>
        <div className="top-statuses">
          <div className="status-pill"><Dot /> LOCAL SAVED</div>
          <div className="status-pill"><Dot tone={online ? 'green' : 'yellow'} /> {online ? 'NETWORK ONLINE' : 'NETWORK OFFLINE'}</div>
          <div className="status-pill muted"><Dot tone="gray" /> CLOUD SAFE MODE</div>
        </div>
      </header>

      <main className="workspace">
        <section className="master-panel panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">USB CONTROL</span>
              <h2>MASTER</h2>
            </div>
            <span className={`connection-chip ${masterConnected ? 'connected' : ''}`}>
              <Dot tone={masterConnected ? 'green' : 'gray'} />
              {masterConnected ? 'CONNECTED · UI DEMO' : 'DISCONNECTED'}
            </span>
          </div>

          <div className="master-grid">
            <div className="master-visual">
              <div className="usb-icon">USB</div>
              <div>
                <strong>Arduino UNO + nRF24 MASTER</strong>
                <span>{masterConnected ? '프로토타입 연결 상태 · 실제 Web Serial은 B 펌웨어 단계에서 활성화' : '노트북 USB 연결을 전제로 한 화면 구조'}</span>
              </div>
            </div>
            <button className={`primary-btn ${masterConnected ? 'danger' : ''}`} onClick={() => setMasterConnected((v) => !v)}>
              {masterConnected ? 'MASTER 연결 해제' : 'MASTER 연결 UI 테스트'}
            </button>
          </div>

          <div className="rx-strip">
            {[1, 2, 3, 4, 5, 6, 7].map((id) => (
              <div className="rx-chip" key={id}><span>RX{id}</span><b>O</b></div>
            ))}
          </div>
        </section>

        <section className="transport-panel panel">
          <div className="transport-row">
            <div className="time-readout">
              <span>PLAYHEAD</span>
              <strong>{formatTime(currentTime)}</strong>
            </div>
            <div className="transport-buttons">
              <button onClick={() => { setPlaying(false); setCurrentTime(0) }}>|◀</button>
              <button className="play-btn" onClick={() => setPlaying((v) => !v)}>{playing ? 'Ⅱ' : '▶'}</button>
              <button onClick={() => setCurrentTime((t) => clamp(t - 0.01, 0, SHOW_DURATION))}>-10ms</button>
              <button onClick={() => setCurrentTime((t) => clamp(t + 0.01, 0, SHOW_DURATION))}>+10ms</button>
            </div>
            <div className="actual-readout">
              <span>ACTUAL IN</span>
              <strong>{formatTime(actualTime)}</strong>
              <em>+{effectiveDelay} ms</em>
            </div>
          </div>
        </section>

        <section className="timeline-panel panel">
          <div className="timeline-toolbar">
            <div>
              <span className="eyebrow">LIVE TIMELINE</span>
              <h2>IN Point Calibration</h2>
            </div>
            <div className="legend">
              <span><i className="legend-line red" />재생헤드</span>
              <span><i className="legend-line yellow" />딜레이 반영 실제 IN</span>
            </div>
          </div>

          <div className="timeline-ruler-labels">
            {[0, 20, 40, 60, 80, 100, 120].map((sec) => <span key={sec} style={{ left: `${(sec / SHOW_DURATION) * 100}%` }}>{formatTime(sec).slice(0, 5)}</span>)}
          </div>

          <div
            className={`timeline ${dragging ? 'dragging' : ''}`}
            ref={timelineRef}
            onPointerDown={(event) => {
              setDragging(true)
              event.currentTarget.setPointerCapture?.(event.pointerId)
              seekFromPointer(event)
            }}
            onPointerMove={(event) => { if (dragging) seekFromPointer(event) }}
            onPointerUp={(event) => {
              seekFromPointer(event)
              setDragging(false)
              event.currentTarget.releasePointerCapture?.(event.pointerId)
            }}
            onPointerCancel={() => setDragging(false)}
          >
            <div className="grid-lines">
              {[0, 20, 40, 60, 80, 100, 120].map((sec) => <i key={sec} style={{ left: `${(sec / SHOW_DURATION) * 100}%` }} />)}
            </div>
            {RX_CUES.map((cues, rowIndex) => (
              <div className="track" key={rowIndex}>
                <div className="track-label">RX{rowIndex + 1}</div>
                <div className="track-lane">
                  {cues.map((cue, cueIndex) => (
                    <div key={cueIndex} className="cue-block" style={{ left: `${(cue.start / SHOW_DURATION) * 100}%`, width: `${(cue.dur / SHOW_DURATION) * 100}%` }} />
                  ))}
                </div>
              </div>
            ))}
            <div className="delay-span" style={{ left: `${Math.min(redPct, yellowPct)}%`, width: `${Math.abs(yellowPct - redPct)}%` }} />
            <div className="playhead red-head" style={{ left: `${redPct}%` }}><span>PLAYHEAD</span></div>
            <div className="playhead actual-head" style={{ left: `${yellowPct}%` }}><span>ACTUAL IN +{effectiveDelay}ms</span></div>
          </div>
          <p className="timeline-hint">타임라인을 클릭하거나 드래그해서 IN 지점을 잡는 UI입니다. 빨간 선과 노란 선이 동시에 움직입니다.</p>
        </section>

        <section className="lower-grid">
          <div className="delay-panel panel">
            <div className="panel-heading compact">
              <div><span className="eyebrow">LATENCY COMPENSATION</span><h2>Delay</h2></div>
              <label className="toggle"><input type="checkbox" checked={delayEnabled} onChange={(e) => setDelayEnabled(e.target.checked)} /><span /></label>
            </div>
            <div className="delay-number"><strong>{delayMs}</strong><span>ms</span></div>
            <input className="delay-slider" type="range" min="0" max="500" step="1" value={delayMs} onChange={(e) => updateDelay(Number(e.target.value))} />
            <div className="nudge-row">
              <button onClick={() => updateDelay(delayMs - 10)}>-10</button>
              <button onClick={() => updateDelay(delayMs - 1)}>-1</button>
              <button onClick={() => updateDelay(delayMs + 1)}>+1</button>
              <button onClick={() => updateDelay(delayMs + 10)}>+10</button>
            </div>
            <div className="delay-summary">
              <div><span>Base delay</span><b>{delayMs} ms</b></div>
              <div><span>Compensation</span><b>{delayEnabled ? 'ON' : 'OFF'}</b></div>
              <div className="total"><span>Effective</span><b>{effectiveDelay} ms</b></div>
            </div>
          </div>

          <div className="offline-panel panel">
            <div className="panel-heading compact">
              <div><span className="eyebrow">OFFLINE-FIRST</span><h2>Project Safety</h2></div>
              <div className="offline-icon">◉</div>
            </div>
            <div className="save-cards">
              <div className="save-card ready"><span>LOCAL</span><strong>READY</strong><small>브라우저 저장 · {savedAt.toLocaleTimeString('ko-KR')}</small></div>
              <div className={`save-card ${online ? 'pending' : 'offline'}`}><span>SUPABASE</span><strong>{online ? 'PROTOTYPE' : 'OFFLINE'}</strong><small>{online ? '기존 데이터에는 쓰지 않음' : '로컬 동작 유지'}</small></div>
            </div>
            <p>프로토타입은 기존 LED Stage Editor의 Supabase 데이터를 수정하지 않습니다. B안 확정 후 전용 저장 구조를 분리합니다.</p>
          </div>

          <div className="protocol-panel panel">
            <div className="panel-heading compact"><div><span className="eyebrow">NEXT STEP</span><h2>MASTER Protocol</h2></div></div>
            <div className="protocol-list">
              <code>HELLO LSM-B1</code>
              <code>SET_DELAY {delayMs}</code>
              <code>SEEK {Math.round(currentTime * 1000)}</code>
              <code>PREVIEW_PLAY {Math.round(currentTime * 1000)}</code>
            </div>
            <button className="secondary-btn" disabled>실물 연동은 B 펌웨어 검증 후 활성화</button>
          </div>
        </section>
      </main>

      <footer><span>LED STAGE MANAGEMENT · PROTOTYPE B</span><span>기존 LED Stage Editor production 코드와 분리된 브랜치</span></footer>
    </div>
  )
}
