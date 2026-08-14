export function managementLiveCueFixPlugin() {
  return {
    name: 'management-live-cue-fix',
    enforce: 'pre',
    transform(code, id) {
      let out = code

      if (id.includes('src/ManagementApp.jsx')) {
        const refAnchor = "  const bStartSentRef = useRef(false)"
        if (!out.includes('const bLivePrimedRef')) {
          if (!out.includes(refAnchor)) throw new Error('live cue fix: B start ref anchor not found')
          out = out.replace(refAnchor, [
            refAnchor,
            "  const bLivePrimedRef = useRef(false)",
          ].join('\n'))
        }

        const stageAnchor = "  const stageLive = stageMode === 'A_LIVE' || stageMode === 'B_LIVE'"
        if (!out.includes('const canAbortLive')) {
          if (!out.includes(stageAnchor)) throw new Error('live cue fix: stage live anchor not found')
          out = out.replace(stageAnchor, [
            stageAnchor,
            "  const liveAbortLimitMs = Math.max(0, Number(firmwareBundle.previewSafeLimitMs) || 0)",
            "  const canAbortLive = stageMode === 'B_LIVE' && liveAbortLimitMs > 0 && Math.round(currentTime * 1000) + 60 < liveAbortLimitMs",
          ].join('\n'))
        }

        const oldKeyboardStart = [
          "    bStartSentRef.current = true",
          "    spaceResumeRef.current = false",
          "    pause(false)",
          "    const offsetMs = Math.max(0, Math.round(Number(bArmedOffsetRef.current) || 0))",
          "    const sent = await sendSerialLine(`LIVE_START ${offsetMs}`)",
          "    if (!sent) {",
          "      bStartSentRef.current = false",
          "      showToast('B LIVE START 전송 실패 · MASTER 연결을 확인해 주세요.')",
          "      return",
          "    }",
          "    showToast(`B LIVE START 큐 전송 · ${fmtTime(offsetMs / 1000)} · MASTER 응답 대기`)",
        ].join('\n')
        const newKeyboardStart = [
          "    bStartSentRef.current = true",
          "    spaceResumeRef.current = false",
          "    pause(false)",
          "    const offsetMs = Math.max(0, Math.round(Number(bArmedOffsetRef.current) || 0))",
          "    // Prime local media immediately from the same timeline position the RX has at command time.",
          "    // MASTER starts RX at (offset - START_LEAD) and reaches the armed offset after START_LEAD.",
          "    const primeAt = clamp(offsetMs / 1000 - effectiveDelay / 1000, 0, duration)",
          "    bLivePrimedRef.current = true",
          "    playLocalAt(primeAt, false)",
          "    const sent = await sendSerialLine(`LIVE_START ${offsetMs}`)",
          "    if (!sent) {",
          "      bStartSentRef.current = false",
          "      bLivePrimedRef.current = false",
          "      pause(false)",
          "      showToast('B LIVE START 전송 실패 · MASTER 연결을 확인해 주세요.')",
          "      return",
          "    }",
          "    showToast(`B LIVE START 큐 전송 · ${fmtTime(offsetMs / 1000)} · 로컬 미디어 선행 동기화`)",
        ].join('\n')
        if (out.includes(oldKeyboardStart)) out = out.replace(oldKeyboardStart, newKeyboardStart)
        else if (!out.includes('로컬 미디어 선행 동기화')) throw new Error('live cue fix: keyboard start block not found')

        const selectAnchor = "  const selectModeA = async () => {"
        if (!out.includes('const requestStageStop = async')) {
          if (!out.includes(selectAnchor)) throw new Error('live cue fix: select A anchor not found')
          const stopHelper = [
            "  const requestStageStop = async () => {",
            "    if (stageMode === 'B_LIVE') {",
            "      if (!canAbortLive) {",
            "        showToast('첫 실제 EL 블록이 시작된 뒤에는 LIVE STOP을 막습니다.')",
            "        return",
            "      }",
            "      const sent = await sendSerialLine('LIVE_STOP')",
            "      if (!sent) showToast('LIVE STOP 전송 실패 · MASTER 연결을 확인해 주세요.')",
            "      else showToast('LIVE STOP 요청 · MASTER/RX 정지 확인 중')",
            "      return",
            "    }",
            "    if (stageMode === 'A_LIVE') {",
            "      showToast('A LIVE는 공연 중 RF STOP을 사용하지 않습니다.')",
            "      return",
            "    }",
            "    pause(false)",
            "    seek(0, true, false)",
            "    bLivePrimedRef.current = false",
            "    bStartSentRef.current = false",
            "    bArmedOffsetRef.current = 0",
            "    spaceResumeRef.current = false",
            "    if (masterConnected) await sendSerialLine('PREVIEW_STOP')",
            "    if (stageMode === 'B_ARMED') setStageMode('A')",
            "  }",
            "",
          ].join('\n')
          out = out.replace(selectAnchor, stopHelper + selectAnchor)
        }

        const oldLiveStarted = [
          "      const offsetMs = Math.max(0, Number(event?.detail?.offsetMs) || 0)",
          "      const actualStart = clamp(offsetMs / 1000 + effectiveDelay / 1000, 0, duration)",
          "      const wasBArmed = stageMode === 'B_ARMED'",
          "      bStartSentRef.current = false",
          "      spaceResumeRef.current = false",
          "      setStageMode(wasBArmed ? 'B_LIVE' : 'A_LIVE')",
          "      playLocalAt(actualStart, false)",
          "      showToast(`${wasBArmed ? 'B' : 'A'} LIVE · 웹 타임라인 ${fmtTime(actualStart)}부터 추종`)",
        ].join('\n')
        const newLiveStarted = [
          "      const offsetMs = Math.max(0, Number(event?.detail?.offsetMs) || 0)",
          "      const positionRaw = Number(event?.detail?.positionMs)",
          "      const positionMs = Number.isFinite(positionRaw) ? Math.max(0, positionRaw) : offsetMs",
          "      const followStart = clamp(positionMs / 1000, 0, duration)",
          "      const wasBArmed = stageMode === 'B_ARMED' || bLivePrimedRef.current",
          "      bStartSentRef.current = false",
          "      spaceResumeRef.current = false",
          "      setStageMode(wasBArmed ? 'B_LIVE' : 'A_LIVE')",
          "      if (!bLivePrimedRef.current) playLocalAt(followStart, false)",
          "      bLivePrimedRef.current = false",
          "      showToast(`${wasBArmed ? 'B' : 'A'} LIVE · MASTER 위치 ${fmtTime(followStart)} 추종`)",
        ].join('\n')
        if (out.includes(oldLiveStarted)) out = out.replace(oldLiveStarted, newLiveStarted)
        else if (!out.includes('MASTER 위치')) throw new Error('live cue fix: LIVE_STARTED handler not found')

        const finishAnchor = "    const onLiveFinished = () => {"
        if (!out.includes('const onLiveAborted = () =>')) {
          if (!out.includes(finishAnchor)) throw new Error('live cue fix: live finished anchor not found')
          const aborted = [
            "    const onLiveAborted = () => {",
            "      pause(false)",
            "      bLivePrimedRef.current = false",
            "      bStartSentRef.current = false",
            "      spaceResumeRef.current = false",
            "      setStageMode('A')",
            "      showToast('LIVE STOP 완료 · 첫 큐 전 정지 · 다시 B ARM 해주세요.')",
            "    }",
            "    const onLiveStopDenied = () => {",
            "      showToast('STOP 거부 · 첫 EL 블록이 이미 시작됐습니다.')",
            "    }",
            "",
            finishAnchor,
          ].join('\n')
          out = out.replace(finishAnchor, aborted)
          out = out.replace(
            "    window.addEventListener('lsm-live-started', onLiveStarted)\n    window.addEventListener('lsm-live-finished', onLiveFinished)",
            "    window.addEventListener('lsm-live-started', onLiveStarted)\n    window.addEventListener('lsm-live-aborted', onLiveAborted)\n    window.addEventListener('lsm-live-stop-denied', onLiveStopDenied)\n    window.addEventListener('lsm-live-finished', onLiveFinished)"
          )
          out = out.replace(
            "      window.removeEventListener('lsm-live-started', onLiveStarted)\n      window.removeEventListener('lsm-live-finished', onLiveFinished)",
            "      window.removeEventListener('lsm-live-started', onLiveStarted)\n      window.removeEventListener('lsm-live-aborted', onLiveAborted)\n      window.removeEventListener('lsm-live-stop-denied', onLiveStopDenied)\n      window.removeEventListener('lsm-live-finished', onLiveFinished)"
          )
        }

        const parserOld = [
          "    if (line.startsWith('LIVE_STARTED ')) {",
          "      const offsetMs = Math.max(0, Number(line.slice(13).trim()) || 0)",
          "      window.dispatchEvent(new CustomEvent('lsm-live-started', { detail: { offsetMs } }))",
          "    }",
          "    if (line === 'LIVE_FINISHED') window.dispatchEvent(new CustomEvent('lsm-live-finished'))",
        ].join('\n')
        const parserNew = [
          "    if (line.startsWith('LIVE_STARTED ')) {",
          "      const [offsetRaw, positionRaw] = line.slice(13).trim().split(/\\s+/)",
          "      const offsetMs = Math.max(0, Number(offsetRaw) || 0)",
          "      const parsedPosition = Number(positionRaw)",
          "      const positionMs = Number.isFinite(parsedPosition) ? Math.max(0, parsedPosition) : null",
          "      window.dispatchEvent(new CustomEvent('lsm-live-started', { detail: { offsetMs, positionMs } }))",
          "    }",
          "    if (line === 'LIVE_ABORTED') window.dispatchEvent(new CustomEvent('lsm-live-aborted'))",
          "    if (line.startsWith('LIVE_STOP_DENIED')) window.dispatchEvent(new CustomEvent('lsm-live-stop-denied'))",
          "    if (line === 'LIVE_FINISHED') window.dispatchEvent(new CustomEvent('lsm-live-finished'))",
        ].join('\n')
        if (out.includes(parserOld)) out = out.replace(parserOld, parserNew)
        else if (!out.includes("lsm-live-aborted")) throw new Error('live cue fix: live monitor parser not found')

        const topStop = "          <button className=\"tbtn\" onClick={() => { pause(); seek(0, true, true); if (masterConnected) sendSerialLine('PREVIEW_STOP') }}>⏹</button>"
        if (out.includes(topStop)) out = out.replace(topStop, "          <button className=\"tbtn\" onClick={requestStageStop} title={stageMode === 'B_LIVE' ? '첫 EL 블록 전 LIVE STOP' : 'Preview Stop'}>⏹</button>")

        const armButton = "          <button className=\"tbtn compact\" disabled={!masterProtocolReady || !previewSafe || stageLive} onClick={armModeB}>B ARM · SPACE/D2 START @ {fmtTime(currentTime)}</button>"
        if (!out.includes('■ STOP BEFORE CUE')) {
          if (!out.includes(armButton)) throw new Error('live cue fix: arm button anchor not found')
          out = out.replace(armButton, armButton + "\n          <button className=\"tbtn compact\" disabled={stageMode !== 'B_LIVE' || !canAbortLive} onClick={requestStageStop} style={{ color: canAbortLive ? '#ff657a' : undefined }}>■ STOP BEFORE CUE</button>")
        }

        out = out.replace(
          "        if (stageMode === 'B_ARMED') {\n          startArmedBFromKeyboard()\n        } else if (playing) {",
          "        if (stageMode === 'B_ARMED') {\n          startArmedBFromKeyboard()\n        } else if (stageLive) {\n          showToast(canAbortLive ? 'LIVE 중 SPACE는 잠금 · STOP BEFORE CUE 버튼을 사용하세요.' : 'LIVE 진행 중 · 첫 큐 이후 STOP 잠금')\n        } else if (playing) {"
        )

        out = out.replace(
          "{stageMode === 'B_ARMED' ? 'SPACE = LIVE GO · D2 = 백업 GO' : 'SPACE = ACTUAL IN Preview · D2 LIVE = 웹 자동 추종'}",
          "{stageMode === 'B_ARMED' ? 'SPACE = LIVE GO · D2 = 백업 GO' : canAbortLive ? 'LIVE · 첫 큐 전 STOP 가능' : stageLive ? 'LIVE · STOP 잠금' : 'SPACE = ACTUAL IN Preview · D2 LIVE = 웹 자동 추종'}"
        )
      }

      if (id.includes('src/nrf24ManagementCodegen.js')) {
        const stateLine = '      "uint32_t armedOffsetMs = 0;",'
        if (!out.includes('"uint32_t liveOffsetMs = 0;"')) {
          if (!out.includes(stateLine)) throw new Error('live cue firmware: master state anchor not found')
          out = out.replace(stateLine, [
            stateLine,
            '      "uint32_t liveOffsetMs = 0;",',
            '      "uint32_t liveGoMasterMs = 0;",',
          ].join('\n'))
        }

        const serialDefine = '      "#define SERIAL_BAUD 115200",'
        if (!out.includes('LIVE_ABORT_GUARD_MS')) {
          if (!out.includes(serialDefine)) throw new Error('live cue firmware: define anchor not found')
          out = out.replace(serialDefine, '      "#define LIVE_ABORT_GUARD_MS 40UL",\n' + serialDefine)
        }

        const oldStartAnchor = '    "  showStartMasterMs = millis() + runtimeStartLeadMs - offsetMs;",'
        if (out.includes(oldStartAnchor)) {
          out = out.replace(oldStartAnchor, [
            '    "  liveOffsetMs = offsetMs;",',
            '    "  liveGoMasterMs = millis() + runtimeStartLeadMs;",',
            '    "  showStartMasterMs = liveGoMasterMs - offsetMs;",',
          ].join('\n'))
        }

        const requestAnchor = '  const newRequestStart = [\n    "void requestStart() {",'
        if (!out.includes('canAbortBeforeFirstCue')) {
          if (!out.includes(requestAnchor)) throw new Error('live cue firmware: requestStart anchor not found')
          const requestReplacement = [
            '  const newRequestStart = [',
            '    "uint32_t livePositionNow() {",',
            '    "  if (!showPlaying) return liveOffsetMs;",',
            '    "  const uint32_t now = millis();",',
            '    "  if ((int32_t)(now - showStartMasterMs) < 0) return 0;",',
            '    "  return now - showStartMasterMs;",',
            '    "}",',
            '    "",',
            '    "bool canAbortBeforeFirstCue() {",',
            '    "  if (!showPlaying || PREVIEW_SAFE_LIMIT_MS == 0) return false;",',
            '    "  const uint32_t now = millis();",',
            '    "  if ((int32_t)(now - showStartMasterMs) < 0) return true;",',
            '    "  const uint32_t elapsed = now - showStartMasterMs;",',
            '    "  return elapsed + LIVE_ABORT_GUARD_MS < PREVIEW_SAFE_LIMIT_MS;",',
            '    "}",',
            '    "",',
            '    "void abortBeforeFirstCue() {",',
            '    "  cueSeq++;",',
            '    "  showPlaying = false;",',
            '    "  showStartMasterMs = 0;",',
            '    "  bArmed = false;",',
            '    "  sendAllReceivers(CMD_STOP, true, 3);",',
            '    "  lastShowStateMs = 0;",',
            '    "}",',
            '    "",',
            '    "void requestStart() {",',
          ].join('\n')
          out = out.replace(requestAnchor, requestReplacement)
        }

        out = out.replace(
          '    "    Serial.println(offsetMs);",',
          '    "    Serial.print(offsetMs); Serial.print(\' \' ); Serial.println(livePositionNow());",'
        )
        out = out.replace(
          '    "    Serial.print(\\"LIVE_STARTED \\" ); Serial.println(value);",',
          '    "    Serial.print(\\"LIVE_STARTED \\" ); Serial.print(value); Serial.print(\' \' ); Serial.println(livePositionNow());",'
        )

        const liveStartSerialAnchor = '    "  if (strncmp(line, \\"LIVE_START \\" , 11) == 0) {",'
        if (!out.includes('LIVE_STOP_DENIED')) {
          if (!out.includes(liveStartSerialAnchor)) throw new Error('live cue firmware: LIVE_START serial anchor not found')
          const stopSerial = [
            '    "  if (strcmp(line, \\"LIVE_STOP\\") == 0) {",',
            '    "    if (!showPlaying) { Serial.println(\\"LIVE_STOP_OK IDLE\\"); return; }",',
            '    "    if (!canAbortBeforeFirstCue()) { Serial.println(\\"LIVE_STOP_DENIED CUE_STARTED\\"); return; }",',
            '    "    abortBeforeFirstCue();",',
            '    "    Serial.println(\\"LIVE_ABORTED\\");",',
            '    "    return;",',
            '    "  }",',
            '    "",',
            liveStartSerialAnchor,
          ].join('\n')
          out = out.replace(liveStartSerialAnchor, stopSerial)
        }

        const lastReturn = out.lastIndexOf('  return code;\n}')
        if (lastReturn < 0) throw new Error('live cue firmware: receiver return anchor not found')
        if (!out.includes('Management B: early LIVE_STOP')) {
          const receiverPatch = [
            '  // Management B: early LIVE_STOP is accepted only around the pre-first-cue window.',
            '  code = code.replace(',
            '    "      // Once a show is running, RF is not allowed to stop it. END_MS owns the finish.",',
            '    "      // Management B: early LIVE_STOP is accepted only before the first real cue."',
            '  );',
            '  code = code.replace(',
            '    "      if (!playing && previewState == PREVIEW_OFF) { activeCueSeq = p.seq; allOff(); }",',
            '    "      if (!playing && previewState == PREVIEW_OFF) { activeCueSeq = p.seq; allOff(); }\\n      else if (playing && PREVIEW_SAFE_LIMIT_MS > 0 && lastElapsedMs <= PREVIEW_SAFE_LIMIT_MS + 100UL) { activeCueSeq = p.seq; stopPlayback(); }"',
            '  );',
            '',
          ].join('\n')
          out = out.slice(0, lastReturn) + receiverPatch + out.slice(lastReturn)
        }
      }

      return out === code ? null : { code: out, map: null }
    },
  }
}
