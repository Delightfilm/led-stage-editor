export function managementOneClickLivePlugin() {
  return {
    name: 'management-one-click-live',
    enforce: 'pre',
    transform(code, id) {
      let out = code

      if (id.includes('src/ManagementApp.jsx')) {
        const primeRef = "  const bLivePrimedRef = useRef(false)"
        if (!out.includes('const liveCompleteSentRef')) {
          if (!out.includes(primeRef)) throw new Error('one-click live: prime ref anchor not found')
          out = out.replace(primeRef, `${primeRef}\n  const liveCompleteSentRef = useRef(false)`)
        }

        const armStart = out.indexOf("  const armModeB = async () => {")
        if (armStart < 0) throw new Error('one-click live: armModeB start not found')
        const nextHelper = out.indexOf("\n\n  const ", armStart + 10)
        if (nextHelper < 0) throw new Error('one-click live: armModeB end not found')
        const armBlock = out.slice(armStart, nextHelper)
        if (!armBlock.includes('B LIVE START 즉시 전송')) {
          const oneClickArm = [
            "  const armModeB = async () => {",
            "    if (!masterProtocolReady) { showToast('MASTER A/B 펌웨어 연결 후 사용할 수 있어요.'); return }",
            "    if (stageLive || bStartSentRef.current) { showToast('이미 LIVE가 진행 중이거나 START 전송 중입니다.'); return }",
            "    const offsetMs = Math.round(currentTime * 1000)",
            "    if (!firmwareBundle.previewSafeLimitMs || offsetMs >= firmwareBundle.previewSafeLimitMs) {",
            "      showToast('B LIVE START는 첫 실제 EL ON 이전 구간에서만 가능합니다.')",
            "      return",
            "    }",
            "    pause(false)",
            "    await sendSerialLine(`SET_DELAY ${delayEnabled ? delayMs : 0}`)",
            "    bArmedOffsetRef.current = offsetMs",
            "    bStartSentRef.current = true",
            "    spaceResumeRef.current = false",
            "    const primeAt = clamp(offsetMs / 1000 - effectiveDelay / 1000, 0, duration)",
            "    bLivePrimedRef.current = true",
            "    await playLocalAt(primeAt, false)",
            "    const sent = await sendSerialLine(`LIVE_START ${offsetMs}`)",
            "    if (!sent) {",
            "      bStartSentRef.current = false",
            "      bLivePrimedRef.current = false",
            "      pause(false)",
            "      showToast('B LIVE START 전송 실패 · MASTER 연결을 확인해 주세요.')",
            "      return",
            "    }",
            "    showToast(`B LIVE START 즉시 전송 · ${fmtTime(offsetMs / 1000)} · MASTER 응답 대기`)",
            "  }",
          ].join('\n')
          out = out.slice(0, armStart) + oneClickArm + out.slice(nextHelper)
        }

        out = out.replace(
          'B ARM · SPACE/D2 START @ {fmtTime(currentTime)}',
          'B LIVE START @ {fmtTime(currentTime)}'
        )
        out = out.replace(
          "stageMode === 'B_ARMED' ? 'SPACE = LIVE GO · D2 = 백업 GO' : canAbortLive ? 'LIVE · 첫 큐 전 STOP 가능' : stageLive ? 'LIVE · STOP 잠금' : 'SPACE = ACTUAL IN Preview · D2 LIVE = 웹 자동 추종'",
          "canAbortLive ? 'LIVE · 첫 큐 전 STOP 가능' : stageLive ? 'LIVE · STOP 잠금' : 'B 버튼 = 즉시 LIVE GO · SPACE = Preview · D2 = A 독립 GO'"
        )

        const keyEffectAnchor = "  useEffect(() => {\n    const onKey = (event) => {"
        if (!out.includes('LIVE_COMPLETE watchdog')) {
          if (!out.includes(keyEffectAnchor)) throw new Error('one-click live: keyboard effect anchor not found')
          const watchdog = [
            "  // LIVE_COMPLETE watchdog: MASTER also has its own SHOW_DURATION_MS auto-finish.",
            "  // This browser-side guard clears a stale PLAY state at the exact final EL cue when USB is connected.",
            "  useEffect(() => {",
            "    if (!stageLive) {",
            "      liveCompleteSentRef.current = false",
            "      return",
            "    }",
            "    if (!masterConnected || !masterProtocolReady) return",
            "    const showEndMs = Math.max(0, Number(firmwareBundle.showDurationMs) || 0)",
            "    if (!showEndMs || Math.round(currentTime * 1000) + 20 < showEndMs) return",
            "    if (liveCompleteSentRef.current) return",
            "    liveCompleteSentRef.current = true",
            "    sendSerialLine('LIVE_COMPLETE').then((sent) => {",
            "      if (!sent) liveCompleteSentRef.current = false",
            "    })",
            "  }, [stageLive, currentTime, masterConnected, masterProtocolReady, firmwareBundle.showDurationMs])",
            "",
            keyEffectAnchor,
          ].join('\n')
          out = out.replace(keyEffectAnchor, watchdog)
        }
      }

      if (id.includes('src/nrf24ManagementCodegen.js')) {
        const liveStartSerialAnchor = '    "  if (strncmp(line, \\"LIVE_START \\" , 11) == 0) {",'
        if (!out.includes('LIVE_COMPLETE')) {
          if (!out.includes(liveStartSerialAnchor)) throw new Error('one-click live firmware: LIVE_START serial anchor not found')
          const completeSerial = [
            '    "  if (strcmp(line, \\"LIVE_COMPLETE\\") == 0) {",',
            '    "    if (showPlaying) finishShow();",',
            '    "    else if (pcHandshake) Serial.println(\\"LIVE_FINISHED\\");",',
            '    "    return;",',
            '    "  }",',
            '    "",',
          ].join('\n')
          out = out.replace(liveStartSerialAnchor, `${completeSerial}\n${liveStartSerialAnchor}`)
        }
      }

      return { code: out, map: null }
    },
  }
}
