const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`autonomous web v0.6.2: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementAutonomousV062Plugin() {
  return {
    name: 'management-autonomous-v062',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      const oldSelectModeA = `  const selectModeA = async () => {
    if (stageMode === 'B_LIVE') {
      // Seamless B -> A autonomous ownership handoff. MASTER/RX keep the exact
      // showStartMasterMs/cueSeq they already have; sending MODE_A here would add
      // unnecessary serial/RF work at the most timing-sensitive moment.
      bStartSentRef.current = false
      spaceResumeRef.current = false
      setStageMode('A_LIVE')
      showToast(\`A 독립 인계 완료 · \${fmtTime(currentTime)} · MASTER/RX 자체 진행\`)
      return
    }
    if (stageMode === 'A_LIVE') { showToast('이미 A 독립 LIVE로 자체 진행 중입니다.'); return }
    if (!masterProtocolReady) { showToast('MASTER A/B 펌웨어 연결 후 사용할 수 있어요.'); return }
    await sendSerialLine('MODE_A')
    setStageMode('A')
    bArmedOffsetRef.current = 0
    bStartSentRef.current = false
    spaceResumeRef.current = false
    showToast('A 독립 모드: 다음 D2 START는 타임라인 0초부터 시작합니다.')
  }`

      const newSelectModeA = `  const selectModeA = async () => {
    if (stageMode === 'A_LIVE') { showToast('이미 A 독립 LIVE로 자체 진행 중입니다.'); return }
    if (!masterProtocolReady) { showToast('MASTER v0.6.2 펌웨어 연결 후 사용할 수 있어요.'); return }

    const mediaEl = getMediaEl()
    const initialTime = mediaEl && Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : currentTime
    const initialOffsetMs = Math.max(0, Math.round(initialTime * 1000))
    const showEndMs = Math.max(0, Number(firmwareBundle.showDurationMs) || 0)
    if (showEndMs && initialOffsetMs >= showEndMs - 5) { showToast('타임라인 끝에서는 A 독립 START를 할 수 없어요.'); return }

    const wasPlaying = mediaEl ? !mediaEl.paused : playing

    // A is always 0 ms START LEAD. If local media is paused, first let it enter the
    // real playing state, then sample the actual media clock and re-anchor RX there.
    // This removes browser media-start latency without adding an arbitrary fixed delay.
    if (!wasPlaying) {
      playLocalAt(initialOffsetMs / 1000, false)
      const startingEl = getMediaEl()
      if (startingEl) {
        await new Promise((resolve) => {
          let done = false
          const finish = () => {
            if (done) return
            done = true
            startingEl.removeEventListener('playing', finish)
            startingEl.removeEventListener('timeupdate', finish)
            resolve()
          }
          startingEl.addEventListener('playing', finish, { once: true })
          startingEl.addEventListener('timeupdate', finish, { once: true })
          if (!startingEl.paused && startingEl.readyState >= 2) requestAnimationFrame(finish)
          window.setTimeout(finish, 700)
        })
        await new Promise((resolve) => requestAnimationFrame(resolve))
      } else {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
    }

    const goMediaEl = getMediaEl()
    const goTime = goMediaEl && Number.isFinite(goMediaEl.currentTime) ? goMediaEl.currentTime : initialTime
    const goOffsetMs = Math.max(0, Math.round(goTime * 1000))
    const sent = await sendSerialLine(\`A_LIVE_START_NOW \${goOffsetMs}\`)
    if (!sent) {
      if (!wasPlaying) pause(false)
      showToast('A 독립 START 전송 실패 · MASTER 연결을 확인해 주세요.')
      return
    }

    bArmedOffsetRef.current = goOffsetMs
    bStartSentRef.current = false
    bLivePrimedRef.current = true
    spaceResumeRef.current = false
    setCurrentTime(clamp(goTime, 0, duration))
    setStageMode('A_LIVE')
    showToast(\`A 독립 LIVE · \${fmtTime(goOffsetMs / 1000)} · START LEAD 0ms\`)
  }`
      out = replaceRequired(out, oldSelectModeA, newSelectModeA, 'selectModeA re-anchor')

      const oldAButton = '          <button className="tbtn compact" disabled={stageMode === \'A_LIVE\' || (stageMode !== \'B_LIVE\' && !masterProtocolReady)} onClick={selectModeA}>{stageMode === \'B_LIVE\' ? \'A 독립 인계 · 계속 진행\' : stageMode === \'A_LIVE\' ? \'A 독립 진행 중\' : \'A 독립 · 0초\'}</button>'
      const newAButton = '          <button className="tbtn compact" disabled={stageMode === \'A_LIVE\' || !masterProtocolReady} onClick={selectModeA}>{stageMode === \'B_LIVE\' ? `A 독립 재앵커 @ ${fmtTime(currentTime)}` : stageMode === \'A_LIVE\' ? \'A 독립 진행 중 · 0ms\' : `A 독립 START @ ${fmtTime(currentTime)}`}</button>'
      out = replaceRequired(out, oldAButton, newAButton, 'A button')

      if (!out.includes('WEB v0.6.1')) throw new Error('autonomous web v0.6.2: version marker v0.6.1 not found')
      out = out.replace('WEB v0.6.1', 'WEB v0.6.2')

      return { code: out, map: null }
    },
  }
}
