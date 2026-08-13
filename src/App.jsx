import React, { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { getCloudSession, loadCloudProject, signInCloud, signOutCloud } from './supabaseCloud.js'
import { downloadCloudAudio } from './supabaseAudio.js'
import { downloadCloudMedia } from './supabaseMedia.js'

const LOCAL_PROJECT_KEY = 'led-stage-management-project-v2'
const LOCAL_SETTINGS_KEY = 'led-stage-management-settings-v2'
const DB_NAME = 'led-stage-management-cache-v1'
const DB_STORE = 'cache'
const DEFAULT_DURATION = 131.932
const DELAY_SLIDER_MAX = 3000
const DELAY_HARD_MAX = 10000

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const fmtTime = (value) => {
  const t = Math.max(0, Number(value) || 0)
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  const ms = Math.floor((t - Math.floor(t)) * 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

const openCacheDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1)
  request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE)
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

const cachePut = async (key, value) => {
  const db = await openCacheDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).put(value, key)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

const cacheGet = async (key) => {
  const db = await openCacheDb()
  const value = await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly')
    const request = tx.objectStore(DB_STORE).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return value
}

const cacheDelete = async (key) => {
  const db = await openCacheDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).delete(key)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

const readLocalJson = (key, fallback) => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null')
    return value ?? fallback
  } catch {
    return fallback
  }
}

const buildPeaks = async (blob) => {
  try {
    const buffer = await blob.arrayBuffer()
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const decoded = await ctx.decodeAudioData(buffer.slice(0))
    const data = decoded.getChannelData(0)
    const count = 1800
    const step = Math.max(1, Math.floor(data.length / count))
    const peaks = new Array(count)
    for (let i = 0; i < count; i += 1) {
      let max = 0
      const start = i * step
      const end = Math.min(data.length, start + step)
      for (let j = start; j < end; j += 8) max = Math.max(max, Math.abs(data[j] || 0))
      peaks[i] = max
    }
    const duration = decoded.duration
    await ctx.close()
    return { peaks, duration }
  } catch {
    return { peaks: null, duration: null }
  }
}

const normalizeProject = (data) => ({
  costumes: Array.isArray(data?.costumes) ? data.costumes : [],
  blocks: Array.isArray(data?.blocks) ? data.blocks : [],
  duration: Number(data?.duration || data?.manualDuration) || DEFAULT_DURATION,
  audioName: data?.audioName || null,
  mediaName: data?.mediaName || null,
  audioCloud: data?.audioCloud || null,
  mediaCloud: data?.mediaCloud || null,
  savedAt: data?.savedAt || null,
})

export default function App() {
  const localProject = useMemo(() => normalizeProject(readLocalJson(LOCAL_PROJECT_KEY, {})), [])
  const localSettings = useMemo(() => readLocalJson(LOCAL_SETTINGS_KEY, {}), [])

  const [costumes, setCostumes] = useState(localProject.costumes)
  const [blocks, setBlocks] = useState(localProject.blocks)
  const [projectDuration, setProjectDuration] = useState(localProject.duration || DEFAULT_DURATION)
  const [currentTime, setCurrentTime] = useState(Number.isFinite(localSettings.currentTime) ? localSettings.currentTime : 0)
  const [playing, setPlaying] = useState(false)
  const [fps, setFps] = useState(Number(localSettings.fps) || 30)
  const [pps, setPps] = useState(Number(localSettings.pps) || 40)
  const [delayEnabled, setDelayEnabled] = useState(localSettings.delayEnabled ?? true)
  const [delayMs, setDelayMs] = useState(Number.isFinite(localSettings.delayMs) ? localSettings.delayMs : 80)
  const [masterConnected, setMasterConnected] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [cloudSession, setCloudSession] = useState(null)
  const [cloudUser, setCloudUser] = useState(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncStatus, setSyncStatus] = useState(localProject.savedAt ? 'LOCAL CACHE' : '동기화 안 됨')
  const [syncTime, setSyncTime] = useState(localProject.savedAt ? new Date(localProject.savedAt) : null)
  const [showAuth, setShowAuth] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [mediaKind, setMediaKind] = useState(null)
  const [mediaName, setMediaName] = useState(localProject.mediaName || localProject.audioName || null)
  const [mediaDuration, setMediaDuration] = useState(null)
  const [wavePeaks, setWavePeaks] = useState(null)
  const [draggingHead, setDraggingHead] = useState(false)

  const audioRef = useRef(null)
  const videoRef = useRef(null)
  const mediaUrlRef = useRef(null)
  const waveCanvasRef = useRef(null)
  const timelineScrollRef = useRef(null)
  const timelineContentRef = useRef(null)
  const syntheticPlayRef = useRef({ at: 0, time: 0 })

  const duration = Math.max(1, mediaDuration || projectDuration || DEFAULT_DURATION)
  const timelineW = Math.max(900, duration * pps)
  const effectiveDelay = delayEnabled ? delayMs : 0
  const actualInTime = clamp(currentTime + effectiveDelay / 1000, 0, duration)
  const frameNumber = Math.max(0, Math.round(currentTime * fps))

  const tracks = useMemo(() => {
    const rows = []
    costumes.forEach((costume, costumeIndex) => {
      const parts = Array.isArray(costume.parts) && costume.parts.length
        ? costume.parts
        : [{ id: `all-${costume.id || costumeIndex}`, name: 'EL 와이어' }]
      parts.forEach((part, partIndex) => rows.push({
        key: `${costume.id || costumeIndex}:${part.id || partIndex}`,
        costume,
        part,
        costumeIndex,
      }))
    })
    return rows
  }, [costumes])

  const showToast = (message) => {
    setToast(message)
    window.clearTimeout(showToast.timer)
    showToast.timer = window.setTimeout(() => setToast(null), 2600)
  }

  const getMediaEl = () => mediaKind === 'video' ? videoRef.current : mediaKind === 'audio' ? audioRef.current : null

  const clearMediaUrl = () => {
    if (mediaUrlRef.current) {
      URL.revokeObjectURL(mediaUrlRef.current)
      mediaUrlRef.current = null
    }
  }

  const applyProjectData = (raw, updatedAt = null) => {
    const project = normalizeProject(raw)
    setCostumes(project.costumes)
    setBlocks(project.blocks)
    setProjectDuration(project.duration)
    setMediaName(project.mediaName || project.audioName || null)
    setCurrentTime(0)
    setPlaying(false)
    localStorage.setItem(LOCAL_PROJECT_KEY, JSON.stringify({ ...project, savedAt: updatedAt || new Date().toISOString() }))
  }

  const applyMediaBlob = async (blob, meta = {}, cache = true) => {
    if (!blob) return
    pauseMediaOnly()
    clearMediaUrl()
    const url = URL.createObjectURL(blob)
    mediaUrlRef.current = url
    const kind = meta.kind === 'video' || String(meta.type || blob.type).startsWith('video/') ? 'video' : 'audio'
    setMediaKind(kind)
    setMediaName(meta.name || '동기화 미디어')

    if (kind === 'video') {
      const video = videoRef.current
      if (video) {
        video.src = url
        video.load()
        await new Promise((resolve) => {
          const done = () => { cleanup(); resolve() }
          const cleanup = () => {
            video.removeEventListener('loadedmetadata', done)
            video.removeEventListener('error', done)
          }
          video.addEventListener('loadedmetadata', done)
          video.addEventListener('error', done)
          window.setTimeout(done, 2500)
        })
        if (Number.isFinite(video.duration) && video.duration > 0) setMediaDuration(video.duration)
      }
    } else {
      const audio = audioRef.current
      if (audio) {
        audio.src = url
        audio.load()
      }
    }

    const decoded = await buildPeaks(blob)
    setWavePeaks(decoded.peaks)
    if (decoded.duration && kind === 'audio') setMediaDuration(decoded.duration)
    if (cache) await cachePut('media', { blob, meta }).catch(() => null)
  }

  const clearMedia = async () => {
    pauseMediaOnly()
    clearMediaUrl()
    setMediaKind(null)
    setMediaDuration(null)
    setWavePeaks(null)
    if (audioRef.current) { audioRef.current.removeAttribute('src'); audioRef.current.load() }
    if (videoRef.current) { videoRef.current.removeAttribute('src'); videoRef.current.load() }
    await cacheDelete('media').catch(() => null)
  }

  const pauseMediaOnly = () => {
    audioRef.current?.pause()
    videoRef.current?.pause()
  }

  const pause = () => {
    pauseMediaOnly()
    setPlaying(false)
  }

  const play = async () => {
    const el = getMediaEl()
    if (el) {
      try {
        await el.play()
        setPlaying(true)
      } catch {
        showToast('브라우저에서 재생이 차단됐어요. 다시 ▶를 눌러 주세요.')
      }
      return
    }
    syntheticPlayRef.current = { at: performance.now(), time: currentTime }
    setPlaying(true)
  }

  const seek = (time, snapToFrame = true) => {
    let next = clamp(Number(time) || 0, 0, duration)
    if (snapToFrame && fps > 0) next = clamp(Math.round(next * fps) / fps, 0, duration)
    setCurrentTime(next)
    const el = getMediaEl()
    if (el && Number.isFinite(next)) el.currentTime = next
  }

  const stepFrame = (direction) => {
    pause()
    seek(currentTime + direction / fps, true)
  }

  const updateDelay = (value) => setDelayMs(clamp(Math.round(Number(value) || 0), 0, DELAY_HARD_MAX))

  const timeFromPointer = (event) => {
    const rect = timelineContentRef.current?.getBoundingClientRect()
    if (!rect) return currentTime
    return clamp((event.clientX - rect.left) / pps, 0, duration)
  }

  const scrub = (event) => {
    pause()
    seek(timeFromPointer(event), true)
  }

  const syncFromEditor = async (providedSession = cloudSession) => {
    if (!navigator.onLine) {
      showToast('오프라인입니다. 마지막 동기화본으로 계속 사용할 수 있어요.')
      return
    }
    let session = providedSession
    if (!session) session = await getCloudSession()
    if (!session) {
      setShowAuth(true)
      return
    }

    setSyncBusy(true)
    setSyncStatus('EDITOR 읽는 중…')
    try {
      const row = await loadCloudProject(session)
      if (!row?.project_data) throw new Error('A안에 저장된 프로젝트가 없어요.')
      applyProjectData(row.project_data, row.updated_at)

      const mediaMeta = row.project_data.mediaCloud?.path
        ? row.project_data.mediaCloud
        : row.project_data.audioCloud?.path
          ? row.project_data.audioCloud
          : null

      if (mediaMeta) {
        setSyncStatus('미디어 동기화 중…')
        const blob = row.project_data.mediaCloud?.path
          ? await downloadCloudMedia(session, mediaMeta)
          : await downloadCloudAudio(session, mediaMeta)
        await applyMediaBlob(blob, mediaMeta, true)
      } else {
        await clearMedia()
      }

      const when = row.updated_at ? new Date(row.updated_at) : new Date()
      setSyncTime(when)
      setSyncStatus('EDITOR 동기화 완료')
      showToast('A안의 타임라인과 미디어를 읽기 전용으로 동기화했어요.')
    } catch (error) {
      setSyncStatus('동기화 실패')
      showToast(error?.message || 'EDITOR 동기화에 실패했어요.')
    } finally {
      setSyncBusy(false)
    }
  }

  const handleLogin = async () => {
    if (!email.trim() || password.length < 6) {
      showToast('이메일과 6자 이상 비밀번호를 입력해 주세요.')
      return
    }
    setAuthBusy(true)
    try {
      const session = await signInCloud(email.trim(), password)
      setCloudSession(session)
      setCloudUser(session?.user || null)
      setShowAuth(false)
      await syncFromEditor(session)
    } catch (error) {
      showToast(error?.message || '로그인에 실패했어요.')
    } finally {
      setAuthBusy(false)
    }
  }

  const handleLogout = async () => {
    await signOutCloud().catch(() => null)
    setCloudSession(null)
    setCloudUser(null)
    showToast('B안 동기화 계정에서 로그아웃했어요.')
  }

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
    let cancelled = false
    ;(async () => {
      const session = await getCloudSession().catch(() => null)
      if (!cancelled && session) {
        setCloudSession(session)
        setCloudUser(session.user || null)
      }
      const cached = await cacheGet('media').catch(() => null)
      if (!cancelled && cached?.blob) await applyMediaBlob(cached.blob, cached.meta || {}, false)
    })()
    return () => {
      cancelled = true
      pauseMediaOnly()
      clearMediaUrl()
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify({
      currentTime,
      fps,
      pps,
      delayEnabled,
      delayMs,
    }))
  }, [currentTime, fps, pps, delayEnabled, delayMs])

  useEffect(() => {
    const el = getMediaEl()
    if (!playing) return
    let raf = 0
    const tick = (now) => {
      if (el) {
        setCurrentTime(el.currentTime || 0)
        if (el.ended) {
          setPlaying(false)
          return
        }
      } else {
        const next = syntheticPlayRef.current.time + (now - syntheticPlayRef.current.at) / 1000
        if (next >= duration) {
          setCurrentTime(duration)
          setPlaying(false)
          return
        }
        setCurrentTime(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, mediaKind, duration])

  useEffect(() => {
    const canvas = waveCanvasRef.current
    if (!canvas) return
    const width = Math.max(1, Math.floor(timelineW))
    const height = 54
    canvas.width = width
    canvas.height = height
    const g = canvas.getContext('2d')
    g.clearRect(0, 0, width, height)
    g.fillStyle = '#0f1319'
    g.fillRect(0, 0, width, height)

    if (!wavePeaks?.length) {
      g.strokeStyle = '#2a313d'
      g.beginPath()
      g.moveTo(0, height / 2)
      g.lineTo(width, height / 2)
      g.stroke()
      g.fillStyle = '#697487'
      g.font = '11px sans-serif'
      g.fillText(mediaKind === 'video' ? '🎬 A안 영상 동기화됨 · 영상 오디오는 브라우저 디코딩 가능 시 파형 표시' : '🎵 A안 음원을 동기화하면 파형이 따라옵니다', 12, 33)
      return
    }

    const gradient = g.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, '#5EE0FF')
    gradient.addColorStop(1, '#7C5CFF')
    g.fillStyle = gradient
    const bw = width / wavePeaks.length
    wavePeaks.forEach((peak, index) => {
      const h = Math.max(1, peak * (height - 7))
      g.fillRect(index * bw, (height - h) / 2, Math.max(1, bw - 0.5), h)
    })
  }, [wavePeaks, timelineW, mediaKind])

  useEffect(() => {
    const onKey = (event) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      if (typing) return
      if (event.code === 'Space') {
        event.preventDefault()
        playing ? pause() : play()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        stepFrame(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        stepFrame(1)
      } else if (event.key === '+' || event.key === '=') {
        setPps((value) => Math.min(240, Math.round(value * 1.25)))
      } else if (event.key === '-' || event.key === '_') {
        setPps((value) => Math.max(8, Math.round(value / 1.25)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing, currentTime, fps, mediaKind])

  const rulerMarks = useMemo(() => {
    const step = pps >= 80 ? 1 : pps >= 35 ? 2 : 5
    const marks = []
    for (let t = 0; t <= duration; t += step) marks.push(t)
    return marks
  }, [duration, pps])

  const trackHeight = 34
  const rowsHeight = Math.max(190, tracks.length * trackHeight)
  const playheadLeft = currentTime * pps
  const actualLeft = actualInTime * pps
  const delayLeft = Math.min(playheadLeft, actualLeft)
  const delayWidth = Math.abs(actualLeft - playheadLeft)

  return (
    <div className="app">
      <audio ref={audioRef} preload="auto" />

      <header className="toolbar">
        <div className="logo">
          <span className="logoIcon">💡</span>
          <div>
            <div className="logoTitle">LED STAGE MANAGEMENT</div>
            <div className="logoSub">B · LIVE IN CALIBRATION</div>
          </div>
        </div>

        <div className="transport topTransport">
          <button className="tbtn" onClick={() => { pause(); seek(0) }}>⏹</button>
          <button className={`tbtn play ${playing ? 'playing' : ''}`} onClick={() => playing ? pause() : play()}>{playing ? '⏸' : '▶'}</button>
          <div className="timecode">{fmtTime(currentTime)} <span>/ {fmtTime(duration)}</span></div>
        </div>

        <div className="toolbarSpacer" />

        <div className="statusGroup">
          <span className={`statusDot ${masterConnected ? 'ok' : ''}`} />
          <button className="tbtn compact" onClick={() => setMasterConnected((value) => !value)}>{masterConnected ? 'MASTER UI 연결됨' : 'MASTER 연결 준비'}</button>
        </div>

        <div className="statusGroup onlineState">
          <span className={`statusDot ${online ? 'ok' : 'warn'}`} />
          <span>{online ? 'ONLINE' : 'OFFLINE'}</span>
        </div>

        <button className="tbtn compact syncBtn" disabled={syncBusy || !online} onClick={() => syncFromEditor()}>
          {syncBusy ? '↻ 동기화 중…' : '↻ EDITOR 동기화'}
        </button>
        {cloudUser ? (
          <button className="tbtn compact" onClick={handleLogout}>☁ {cloudUser.email?.split('@')[0]}</button>
        ) : (
          <button className="tbtn compact" onClick={() => setShowAuth(true)}>☁ 로그인</button>
        )}
      </header>

      <main className="center fullWorkspace">
        <section className="programPanel">
          <div className="programHeader">
            <span>프로그램</span>
            <span className="programMediaName">{mediaName || 'A안에서 동기화할 미디어 없음'}</span>
          </div>
          <div className="programViewport">
            <video ref={videoRef} className={`programVideo ${mediaKind === 'video' ? 'visible' : ''}`} preload="metadata" playsInline />
            {mediaKind !== 'video' && (
              <div className="programPlaceholder">
                <span>{mediaKind === 'audio' ? '🎵' : '🎬'}</span>
                <div>{mediaKind === 'audio' ? `${mediaName || '오디오'} · 음악 기준 타임라인` : 'EDITOR 동기화를 누르면 A안의 영상/음원이 따라옵니다'}</div>
              </div>
            )}
          </div>
          <div className="transportBar">
            <div className="transportTime">{fmtTime(currentTime)} <span>· {String(frameNumber).padStart(6, '0')}f</span></div>
            <div className="transportButtons">
              <button onClick={() => seek(0)} title="처음으로">⏮</button>
              <button onClick={() => stepFrame(-1)} title="이전 프레임">◀</button>
              <button className="transportPlay" onClick={() => playing ? pause() : play()}>{playing ? '❚❚' : '▶'}</button>
              <button onClick={() => stepFrame(1)} title="다음 프레임">▶</button>
            </div>
            <div className="transportRight">
              <label>FPS
                <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                  <option value={23.976}>23.976</option>
                  <option value={24}>24</option>
                  <option value={25}>25</option>
                  <option value={29.97}>29.97</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                  <option value={59.94}>59.94</option>
                  <option value={60}>60</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="latencyBar">
          <div className="latencyIdentity">
            <span className="latencyLabel">DELAY / START LEAD</span>
            <strong>{delayEnabled ? `${delayMs} ms` : 'OFF'}</strong>
          </div>
          <label className="switch">
            <input type="checkbox" checked={delayEnabled} onChange={(e) => setDelayEnabled(e.target.checked)} />
            <span />
          </label>
          <input
            className="delayRange"
            type="range"
            min="0"
            max={DELAY_SLIDER_MAX}
            step="1"
            value={Math.min(delayMs, DELAY_SLIDER_MAX)}
            disabled={!delayEnabled}
            onChange={(e) => updateDelay(e.target.value)}
          />
          <div className="delayNudges">
            <button onClick={() => updateDelay(delayMs - 100)}>-100</button>
            <button onClick={() => updateDelay(delayMs - 10)}>-10</button>
            <button onClick={() => updateDelay(delayMs - 1)}>-1</button>
            <input type="number" min="0" max={DELAY_HARD_MAX} value={delayMs} onChange={(e) => updateDelay(e.target.value)} />
            <button onClick={() => updateDelay(delayMs + 1)}>+1</button>
            <button onClick={() => updateDelay(delayMs + 10)}>+10</button>
            <button onClick={() => updateDelay(delayMs + 100)}>+100</button>
          </div>
          <div className="inReadouts">
            <div><span>PLAYHEAD</span><b className="redText">{fmtTime(currentTime)}</b></div>
            <div><span>ACTUAL IN</span><b className="yellowText">{fmtTime(actualInTime)}</b></div>
          </div>
        </section>

        <section className="syncStrip">
          <div>
            <span className={`statusDot ${syncStatus.includes('완료') || syncStatus.includes('CACHE') ? 'ok' : ''}`} />
            <b>{syncStatus}</b>
            <span className="syncSub">{syncTime ? ` · ${syncTime.toLocaleString('ko-KR')}` : ''}</span>
          </div>
          <span className="readOnlyBadge">A안 → B안 READ ONLY</span>
          <span className="offlineBadge">{online ? '클라우드 사용 가능' : '로컬 캐시로 동작 중'}</span>
        </section>

        <div className="timelineScroll" ref={timelineScrollRef}>
          <div className="timelineContent" ref={timelineContentRef} style={{ width: timelineW }}>
            <div
              className="ruler scrubSurface"
              onPointerDown={(event) => {
                setDraggingHead(true)
                event.currentTarget.setPointerCapture?.(event.pointerId)
                scrub(event)
              }}
              onPointerMove={(event) => { if (draggingHead) scrub(event) }}
              onPointerUp={(event) => {
                scrub(event)
                setDraggingHead(false)
                event.currentTarget.releasePointerCapture?.(event.pointerId)
              }}
              onPointerCancel={() => setDraggingHead(false)}
            >
              {rulerMarks.map((t) => (
                <div key={t} className="mark" style={{ left: t * pps }}><span>{fmtTime(t).slice(0, 5)}</span></div>
              ))}
            </div>

            <div
              className="waveRow scrubSurface"
              onPointerDown={(event) => {
                setDraggingHead(true)
                event.currentTarget.setPointerCapture?.(event.pointerId)
                scrub(event)
              }}
              onPointerMove={(event) => { if (draggingHead) scrub(event) }}
              onPointerUp={(event) => {
                scrub(event)
                setDraggingHead(false)
                event.currentTarget.releasePointerCapture?.(event.pointerId)
              }}
              onPointerCancel={() => setDraggingHead(false)}
            >
              <canvas ref={waveCanvasRef} />
            </div>

            <div className="trackArea" style={{ minHeight: rowsHeight }}>
              {tracks.length ? tracks.map((track) => (
                <div className="trackRow" key={track.key} style={{ height: trackHeight }}>
                  <div className="trackLabel" style={{ borderColor: track.costume.color || '#536070' }}>
                    <span>{track.costume.name || `의상 ${track.costumeIndex + 1}`}</span>
                    <small>{track.part.name || 'EL 와이어'}</small>
                  </div>
                  <div className="trackLane">
                    {blocks
                      .filter((block) => block.costumeId === track.costume.id && block.partId === track.part.id)
                      .map((block) => (
                        <div
                          key={block.id}
                          className="block readonlyBlock"
                          style={{
                            left: block.start * pps,
                            width: Math.max(4, block.dur * pps),
                            '--bc': block.color || track.costume.color || '#5EE0FF',
                          }}
                          title={`${block.label || block.type || 'ON'} · ${fmtTime(block.start)} · ${Number(block.dur || 0).toFixed(2)}s`}
                        >
                          <span>{block.icon || '●'} {block.label || ''}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )) : (
                <div className="emptyTimeline">EDITOR 동기화를 누르면 A안의 의상 타임라인이 여기에 표시됩니다.</div>
              )}
            </div>

            <div className="delayWindow" style={{ left: delayLeft, width: Math.max(0, delayWidth) }} />
            <div className="playhead redHead" style={{ left: playheadLeft }}><div className="phTop" /><span>PLAYHEAD</span></div>
            <div className="playhead yellowHead" style={{ left: actualLeft }}><div className="phTop" /><span>ACTUAL IN +{effectiveDelay}ms</span></div>
          </div>
        </div>

        <div className="timelineFooter">
          <div className="footerHint">빨간 선 = 영상/음원 재생헤드 · 노란 선 = 설정한 딜레이를 반영한 실제 IN</div>
          <div className="zoomControl">
            <button onClick={() => setPps((value) => Math.max(8, Math.round(value / 1.25)))}>−</button>
            <input type="range" min="8" max="200" value={Math.min(200, pps)} onChange={(e) => setPps(Number(e.target.value))} />
            <button onClick={() => setPps((value) => Math.min(240, Math.round(value * 1.25)))}>+</button>
            <span>{Math.round((pps / 40) * 100)}%</span>
          </div>
        </div>
      </main>

      {showAuth && (
        <div className="modalBack" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAuth(false) }}>
          <div className="authModal">
            <div className="modalHead">
              <div>
                <span>EDITOR CLOUD</span>
                <h2>A안 프로젝트 동기화</h2>
              </div>
              <button onClick={() => setShowAuth(false)}>✕</button>
            </div>
            <p>A안과 같은 Supabase 계정으로 로그인하면 저장된 타임라인과 영상/음원을 읽어옵니다. B안에서는 A안 데이터를 쓰거나 덮어쓰지 않습니다.</p>
            <input type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input type="password" placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleLogin() }} />
            <button className="authPrimary" disabled={authBusy} onClick={handleLogin}>{authBusy ? '로그인 중…' : '로그인 후 동기화'}</button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
