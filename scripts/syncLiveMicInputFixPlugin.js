const replaceBetween = (code, start, end, replacement, label) => {
  const from = code.indexOf(start)
  if (from < 0) throw new Error(`sync live mic fix: ${label} start anchor not found`)
  const to = code.indexOf(end, from)
  if (to < 0) throw new Error(`sync live mic fix: ${label} end anchor not found`)
  return code.slice(0, from) + replacement + code.slice(to)
}

export function syncLiveMicInputFixPlugin() {
  return {
    name: 'sync-live-mic-input-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/SyncLiveAppV3.jsx')) return null
      let next = code

      const stateAnchor = "  const [micStatus, setMicStatus] = useState('MIC OFF')\n  const [inputDb, setInputDb] = useState(-90)"
      if (!next.includes(stateAnchor)) throw new Error('sync live mic fix: state anchor not found')
      next = next.replace(
        stateAnchor,
        [
          "  const [micStatus, setMicStatus] = useState('MIC OFF')",
          "  const [inputDb, setInputDb] = useState(-90)",
          "  const [micDeviceName, setMicDeviceName] = useState('기본 입력 장치')",
          "  const [micEngineStatus, setMicEngineStatus] = useState('IDLE')",
          "  const [micDevices, setMicDevices] = useState([])",
          "  const [micDeviceId, setMicDeviceId] = useState('')",
        ].join('\n')
      )

      const micBlock = [
        "  const refreshMicDevices = async (preferredId = '') => {",
        "    try {",
        "      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')",
        "      setMicDevices(devices)",
        "      if (preferredId) setMicDeviceId(preferredId)",
        "      return devices",
        "    } catch { return [] }",
        "  }",
        "",
        "  const stopMic = async (reason = 'MIC STOP') => {",
        "    const m = micRef.current; micRef.current = null",
        "    if (m) {",
        "      if (m.timer) window.clearInterval(m.timer)",
        "      if (m.silenceTimer) window.clearTimeout(m.silenceTimer)",
        "      try { m.analyser?.disconnect(); m.source?.disconnect(); m.pullGain?.disconnect() } catch {}",
        "      m.stream?.getTracks().forEach((t) => { t.onended = null; t.onmute = null; t.onunmute = null; t.stop() })",
        "      await m.ctx?.close().catch(() => {})",
        "    }",
        "    setMicActive(false); setMicStatus('MIC OFF'); setMicEngineStatus('IDLE'); setInputDb(-90); holdFootage('HOLD · MIC OFF'); disarm(reason)",
        "  }",
        "",
        "  const startMic = async () => {",
        "    if (micRef.current) return stopMic()",
        "    if (!navigator.mediaDevices?.getUserMedia) return notify('이 브라우저에서는 마이크 입력을 사용할 수 없습니다.')",
        "    setMicStatus('MIC STARTING…'); setMicEngineStatus('REQUESTING'); setInputDb(-90)",
        "    try {",
        "      const audioConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }",
        "      if (micDeviceId) audioConstraints.deviceId = { exact: micDeviceId }",
        "      let stream",
        "      try { stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraints }) }",
        "      catch (firstError) {",
        "        if (!micDeviceId) throw firstError",
        "        log(`MIC DEVICE FALLBACK · ${firstError?.name || 'Error'}`)",
        "        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })",
        "      }",
        "      const track = stream.getAudioTracks()[0]",
        "      if (!track) throw new Error('사용 가능한 오디오 입력 트랙이 없습니다.')",
        "      const Ctx = window.AudioContext || window.webkitAudioContext",
        "      if (!Ctx) throw new Error('Web Audio API를 사용할 수 없습니다.')",
        "      const ctx = new Ctx({ latencyHint: 'interactive' })",
        "      await ctx.resume()",
        "      const source = ctx.createMediaStreamSource(stream)",
        "      const analyser = ctx.createAnalyser(); analyser.fftSize = FFT_SIZE; analyser.smoothingTimeConstant = 0",
        "      // Chrome can stop pulling an all-zero output graph. Keep an effectively inaudible real destination path alive.",
        "      const pullGain = ctx.createGain(); pullGain.gain.value = 0.0000001",
        "      source.connect(analyser); analyser.connect(pullGain); pullGain.connect(ctx.destination)",
        "",
        "      const settings = track.getSettings?.() || {}",
        "      const deviceName = track.label || (settings.deviceId ? '선택된 입력 장치' : '기본 입력 장치')",
        "      await refreshMicDevices(settings.deviceId || '')",
        "      const samples = new Float32Array(FFT_SIZE)",
        "      let lastFeatureAt = 0",
        "      let processedFrames = 0",
        "      let sawSignal = false",
        "      let zeroFrames = 0",
        "",
        "      const tick = async () => {",
        "        if (micRef.current?.track !== track) return",
        "        if (ctx.state !== 'running') await ctx.resume().catch(() => {})",
        "        analyser.getFloatTimeDomainData(samples)",
        "        let sq = 0, peak = 0",
        "        for (let i = 0; i < samples.length; i += 1) { const v = samples[i]; sq += v * v; if (Math.abs(v) > peak) peak = Math.abs(v) }",
        "        const rms = Math.sqrt(sq / Math.max(1, samples.length))",
        "        const db = clamp(20 * Math.log10(Math.max(rms, 0.00001)), -90, 0)",
        "        setInputDb(db)",
        "        processedFrames += 1",
        "        if (peak <= 0.000001) zeroFrames += 1; else zeroFrames = 0",
        "        if (db > -85 || peak > 0.00008) sawSignal = true",
        "        if (processedFrames % 10 === 0) setMicEngineStatus(`RUNNING · ${processedFrames} frames · peak ${peak.toExponential(1)}`)",
        "        if (zeroFrames === 30) { setMicStatus(`${deviceName} · PCM ZERO · 입력 장치 확인`); log(`MIC PCM ZERO · device=${deviceName} · context=${ctx.state} · track=${track.readyState}`) }",
        "        const now = performance.now()",
        "        if (now - lastFeatureAt >= FRAME_SEC * 1000) {",
        "          lastFeatureAt = now",
        "          if (matcherRef.current && peak > 0.000001) onFeature(extractFeature(samples, ctx.sampleRate))",
        "        }",
        "      }",
        "",
        "      const timer = window.setInterval(() => { tick().catch((e) => log(`MIC PROCESS ERROR · ${e?.message || 'unknown'}`)) }, 50)",
        "      const silenceTimer = window.setTimeout(() => {",
        "        if (micRef.current?.track !== track) return",
        "        if (!sawSignal) { setMicStatus(`${deviceName} ACTIVE · 입력 신호 없음`); log('MIC WARNING · 엔진은 동작하지만 유효 PCM 신호가 없습니다. 입력 장치를 직접 선택하세요.') }",
        "      }, 2200)",
        "",
        "      track.onended = () => { setMicStatus('MIC TRACK ENDED'); setMicEngineStatus('TRACK ENDED'); setMicActive(false); setInputDb(-90); micRef.current = null; disarm('MIC TRACK ENDED') }",
        "      track.onmute = () => setMicStatus(`${deviceName} · MUTED BY OS/BROWSER`)",
        "      track.onunmute = () => setMicStatus(`${deviceName} ACTIVE`)",
        "      micRef.current = { stream, track, ctx, source, analyser, pullGain, timer, silenceTimer }",
        "      matcherRef.current?.reset(); rt.current.lastLockedPosition = null",
        "      setMicActive(true); setMicDeviceName(deviceName); setMicEngineStatus(`RUNNING · ${ctx.sampleRate} Hz`); setMicStatus(`${deviceName} ACTIVE`)",
        "      setFootageStatus(footageUrlRef.current ? 'SEARCHING · LOCK 대기' : 'WAITING FOR FOOTAGE')",
        "      log(`MIC ACTIVE · ${deviceName} · ${ctx.sampleRate}Hz · ctx=${ctx.state} · track=${track.readyState} · enabled=${track.enabled ? 1 : 0}`)",
        "      if (!reference) log('MIC TEST MODE · REFERENCE 없이 입력 레벨만 측정 중')",
        "    } catch (e) {",
        "      const name = e?.name || 'Error'",
        "      const message = e?.message || '마이크 시작 실패'",
        "      setMicActive(false); setMicEngineStatus(name); setMicStatus(`MIC ERROR · ${name}`); setInputDb(-90)",
        "      notify(message); log(`MIC ERROR · ${name} · ${message}`)",
        "    }",
        "  }",
        "",
      ].join('\n')
      next = replaceBetween(next, '  const stopMic = async', '  const toggleArm = async', micBlock, 'mic implementation')

      const inputCard = [
        "      <section className=\"sl-card sl-input\"><div className=\"sl-card-head\"><h2>LIVE INPUT</h2><span>{micStatus}</span></div><div className=\"sl-big-value\">{inputDb.toFixed(1)} <small>dBFS</small></div><div className=\"sl-meter\"><i style={{ width: `${meter * 100}%` }} /></div><div className=\"sl-diagnostics\"><span>device {micDeviceName}</span><span>engine {micEngineStatus}</span></div><label className=\"sl-meta\">INPUT DEVICE <select value={micDeviceId} disabled={micActive} onChange={(e) => setMicDeviceId(e.target.value)}><option value=\"\">시스템 기본 입력</option>{micDevices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `입력 장치 ${i + 1}`}</option>)}</select></label><div className=\"sl-meta\">처음 MIC START 후 장치 목록이 표시됩니다. -90 dBFS가 계속되면 MIC STOP → MacBook Microphone 직접 선택 → 다시 START 하세요.</div><button className={`sl-btn ${micActive ? 'danger' : 'primary'}`} onClick={startMic}>{micActive ? 'MIC STOP' : 'MacBook MIC START'}</button></section>",
        "",
      ].join('\n')
      next = replaceBetween(next, '      <section className=\"sl-card sl-input\">', '      <section className={`sl-card sl-match', inputCard, 'live input card')

      return { code: next, map: null }
    },
  }
}
