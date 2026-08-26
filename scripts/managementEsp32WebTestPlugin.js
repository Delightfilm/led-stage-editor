const replaceOnce = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`ESP32 web test: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementEsp32WebTestPlugin() {
  return {
    name: 'management-esp32-web-test',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      if (code.includes('ESP32_WEB_TEST_ISOLATED_V3')) return { code, map: null }

      let out = code

      // Transport detection is explicit. An nRF24 MASTER never emits this line, so its
      // existing B-LIVE UI and safety gates remain byte-for-byte on the original branch.
      const stateAnchor = "  const [masterProtocolReady, setMasterProtocolReady] = useState(false)"
      out = replaceOnce(
        out,
        stateAnchor,
        `${stateAnchor}\n  const [esp32TransportReady, setEsp32TransportReady] = useState(false)`,
        'transport state',
      )

      const lineAnchor = "    addMasterLog(line)"
      out = replaceOnce(
        out,
        lineAnchor,
        [
          lineAnchor,
          "    if (/^TRANSPORT ESP_NOW CH6 FIELD_READY$/i.test(line)) {",
          "      setEsp32TransportReady(true)",
          "      setMasterStatus('ESP32 · ESP-NOW CH6 READY')",
          "    }",
        ].join('\n'),
        'transport handshake parser',
      )

      // Clear the ESP32-only branch when the serial device is disconnected. This prevents
      // a later nRF24 connection from inheriting ESP32 controls from the previous port.
      const disconnectAnchor = "    setMasterConnected(false)\n    setMasterProtocolReady(false)"
      out = replaceOnce(
        out,
        disconnectAnchor,
        `${disconnectAnchor}\n    setEsp32TransportReady(false)`,
        'disconnect reset',
      )

      // ESP32 follows the same PERFORMANCE model as the proven nRF24 path:
      // 1) ESP32 B LIVE starts the local web timeline and RX epoch together.
      // 2) LIVE_STARTED only confirms/follows the already-running epoch.
      // 3) The existing A 공연 LOCK then commits that same running epoch without a restart.
      const helperAnchor = "  const requestStageStop = async () => {"
      const helpers = [
        "  const startEsp32FieldTest = async () => {",
        "    if (!masterProtocolReady || !esp32TransportReady) {",
        "      showToast('ESP32 FIELD-READY MASTER 연결 후 사용할 수 있어요.')",
        "      return",
        "    }",
        "    if (stageLive || bStartSentRef.current) {",
        "      showToast('이미 LIVE가 진행 중이거나 START 전송 중입니다.')",
        "      return",
        "    }",
        "    const offsetMs = Math.max(0, Math.round(currentTime * 1000))",
        "    const showEndMs = Math.max(0, Number(firmwareBundle.showDurationMs) || 0)",
        "    if (showEndMs > 0 && offsetMs >= showEndMs) {",
        "      showToast('ESP32 TEST 시작 위치가 공연 종료 지점 이후입니다.')",
        "      return",
        "    }",
        "    pause(false)",
        "    bArmedOffsetRef.current = offsetMs",
        "    bLivePrimedRef.current = true",
        "    bStartSentRef.current = true",
        "    // LIVE_START_NOW has no START lead. Start the local media from the exact same",
        "    // current timeline position before sending the RF command. The shared",
        "    // LIVE_STARTED handler sees bLivePrimedRef and will not start it a second time.",
        "    await playLocalAt(clamp(offsetMs / 1000, 0, duration), false)",
        "    const sent = await sendSerialLine(`LIVE_START_NOW ${offsetMs}`)",
        "    if (!sent) {",
        "      bStartSentRef.current = false",
        "      bLivePrimedRef.current = false",
        "      pause(false)",
        "      showToast('ESP32 LIVE START 전송 실패 · MASTER USB 연결을 확인해 주세요.')",
        "      return",
        "    }",
        "    showToast(`ESP32 B LIVE START · ${fmtTime(offsetMs / 1000)} · 웹/RX 타임라인 동시 진행`)",
        "  }",
        "",
        "  const stopEsp32FieldTest = async () => {",
        "    if (!masterProtocolReady || !esp32TransportReady) return",
        "    if (stageMode === 'A_LIVE') {",
        "      showToast('A 공연 LOCK 상태에서는 ESP32 FORCE STOP이 잠겨 있습니다.')",
        "      return",
        "    }",
        "    if (stageMode !== 'B_LIVE') return",
        "    const sent = await sendSerialLine('LIVE_FORCE_STOP')",
        "    if (!sent) {",
        "      showToast('ESP32 FORCE STOP 전송 실패 · MASTER USB 연결을 확인해 주세요.')",
        "      return",
        "    }",
        "    pause(false)",
        "    bStartSentRef.current = false",
        "    bLivePrimedRef.current = false",
        "    bArmedOffsetRef.current = 0",
        "    spaceResumeRef.current = false",
        "    setStageMode('A')",
        "    showToast('ESP32 FORCE STOP 전송 완료')",
        "  }",
        "",
      ].join('\n')
      out = replaceOnce(out, helperAnchor, helpers + helperAnchor, 'ESP32 test helpers')

      // Locate the final B-LIVE control structurally because the nRF24 production plugins
      // intentionally relabel it across release gates. The exact original button is kept
      // intact in the non-ESP32 branch.
      const clickMarker = 'onClick={armModeB}'
      const clickIndex = out.indexOf(clickMarker)
      if (clickIndex < 0) throw new Error('ESP32 web test: B-LIVE click marker not found')
      const buttonStart = out.lastIndexOf('<button', clickIndex)
      const buttonEnd = out.indexOf('</button>', clickIndex)
      if (buttonStart < 0 || buttonEnd < 0) throw new Error('ESP32 web test: B-LIVE button bounds not found')
      const originalBButton = out.slice(buttonStart, buttonEnd + '</button>'.length)
      const isolatedButtons = [
        "{esp32TransportReady ? (",
        "  <>",
        "    <button className=\"tbtn compact\" disabled={!masterProtocolReady || stageLive} onClick={startEsp32FieldTest} style={{ color: '#62e7a2' }}>ESP32 B LIVE START @ {fmtTime(currentTime)}</button>",
        "    <button className=\"tbtn compact\" disabled={!masterProtocolReady || stageMode !== 'B_LIVE'} onClick={stopEsp32FieldTest} style={{ color: stageMode === 'B_LIVE' ? '#ff657a' : undefined }}>ESP32 FORCE STOP</button>",
        "    <span style={{ color: '#62e7a2', fontWeight: 800 }}>{stageMode === 'A_LIVE' ? 'ESP-NOW · A LOCKED' : stageMode === 'B_LIVE' ? 'ESP-NOW · B LIVE' : 'ESP-NOW TEST'}</span>",
        "  </>",
        ") : (",
        originalBButton,
        ")}",
      ].join('\n')
      out = out.slice(0, buttonStart) + isolatedButtons + out.slice(buttonEnd + '</button>'.length)

      out += '\n// ESP32_WEB_TEST_ISOLATED_V3\n'
      return { code: out, map: null }
    },
  }
}
