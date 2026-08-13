export function managementSerialSafetyPlugin() {
  return {
    name: 'management-serial-safety',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      // Do not explicitly toggle DTR/RTS after opening the CH340 port.
      // Opening an UNO-class serial port can already cause one auto-reset; an
      // additional control-line transition is unnecessary and may trigger more.
      out = out.replace(
        `      try {\n        await port.setSignals({ dataTerminalReady: false, requestToSend: false })\n      } catch {}\n\n`,
        ''
      )

      // Until the B protocol firmware answers, only handshake traffic is allowed.
      // This prevents SEEK / PREVIEW / SET_DELAY traffic from being poured into an
      // older production MASTER sketch that does not read Serial at all.
      const sendAnchor = `  const sendSerialLine = async (line) => {\n    const writer = serialWriterRef.current\n    if (!writer || !masterConnected) return false`
      const sendSafe = `  const sendSerialLine = async (line) => {\n    const writer = serialWriterRef.current\n    if (!writer || !masterConnected) return false\n    const handshakeOnly = /^\\s*(HELLO|PING)\\b/i.test(String(line || ''))\n    if (!masterReadyRef.current && !handshakeOnly) return false`
      if (out.includes(sendAnchor)) out = out.replace(sendAnchor, sendSafe)

      // Do not send PREVIEW_PAUSE on every pointermove while scrubbing. One pause
      // at scrub start is enough; SEEK is already rate-limited separately.
      out = out.replace(
        `  const scrub = (event) => {\n    pause()`,
        `  const scrub = (event) => {\n    pause(false)`
      )
      out = out.replace(
        `    event.preventDefault()\n    event.stopPropagation()\n    scrub(event)`,
        `    event.preventDefault()\n    event.stopPropagation()\n    pause()\n    scrub(event)`
      )

      // Only send delay after the B protocol handshake has completed.
      out = out.replace(
        `    if (!masterConnected) return undefined\n    const timer = window.setTimeout(() => {\n      sendSerialLine(\`SET_DELAY \${delayEnabled ? delayMs : 0}\`)`,
        `    if (!masterConnected || !masterProtocolReady) return undefined\n    const timer = window.setTimeout(() => {\n      sendSerialLine(\`SET_DELAY \${delayEnabled ? delayMs : 0}\`)`
      )

      // A successfully opened USB port is a useful result even when the current
      // production MASTER firmware has no B protocol yet. Do not label that as a
      // connection failure; make the distinction explicit in the toolbar.
      out = out.replace(
        `          setMasterStatus('USB OPEN · B 펌웨어 응답 대기')`,
        `          setMasterStatus('USB 연결됨 · B 펌웨어 필요')`
      )

      // Add VID/PID to the tiny rolling log after the port is opened. This helps
      // distinguish CH340 / other serial devices without exposing any secret data.
      const openAnchor = `      setMasterStatus('USB OPEN · 부팅 대기')\n      setMasterLog([])`
      const openWithInfo = `      setMasterStatus('USB OPEN · 부팅 대기')\n      setMasterLog([])\n      try {\n        const info = port.getInfo?.() || {}\n        const vid = info.usbVendorId != null ? info.usbVendorId.toString(16).padStart(4, '0') : '----'\n        const pid = info.usbProductId != null ? info.usbProductId.toString(16).padStart(4, '0') : '----'\n        addMasterLog(\`USB OPEN · VID:\${vid} PID:\${pid}\`)\n      } catch {}`
      if (out.includes(openAnchor)) out = out.replace(openAnchor, openWithInfo)

      // If opening/initializing the port fails, release anything that may have
      // opened and expose a useful reason instead of the generic "연결 실패".
      const oldCatch = `    } catch (error) {\n      setMasterStatus('연결 실패')\n      if (error?.name !== 'NotFoundError') showToast(error?.message || 'MASTER 연결에 실패했어요.')\n    }`
      const newCatch = `    } catch (error) {\n      const opened = serialPortRef.current\n      serialPortRef.current = null\n      masterReadyRef.current = false\n      setMasterConnected(false)\n      setMasterProtocolReady(false)\n      try { await serialReaderRef.current?.cancel() } catch {}\n      serialReaderRef.current = null\n      try { serialWriterRef.current?.releaseLock() } catch {}\n      serialWriterRef.current = null\n      try { await opened?.close() } catch {}\n\n      const name = error?.name || 'Error'\n      const raw = String(error?.message || '')\n      if (name === 'NotFoundError') {\n        setMasterStatus('USB 미연결')\n        return\n      }\n      if (name === 'NetworkError' || /open serial port|device is busy|access denied/i.test(raw)) {\n        setMasterStatus('COM 포트를 열 수 없음')\n        showToast('COM 포트를 다른 프로그램이 사용 중일 수 있어요. Arduino 시리얼 모니터/플로터를 닫고 다시 연결해 주세요.')\n      } else if (name === 'InvalidStateError') {\n        setMasterStatus('COM 포트 사용 중')\n        showToast('선택한 COM 포트가 이미 열려 있어요. 다른 시리얼 프로그램이나 이전 연결을 닫고 다시 시도해 주세요.')\n      } else {\n        setMasterStatus('연결 실패 · ' + name)\n        showToast(raw || 'MASTER 연결에 실패했어요.')\n      }\n      addMasterLog(\`! \${name}: \${raw || 'serial open failed'}\`)\n    }`
      if (out.includes(oldCatch)) {
        out = out.replace(oldCatch, newCatch)
      } else {
        // The previous safety transform may already be present in source/build.
        const previousCatch = `    } catch (error) {\n      const opened = serialPortRef.current\n      serialPortRef.current = null\n      masterReadyRef.current = false\n      setMasterConnected(false)\n      setMasterProtocolReady(false)\n      try { await serialReaderRef.current?.cancel() } catch {}\n      serialReaderRef.current = null\n      try { serialWriterRef.current?.releaseLock() } catch {}\n      serialWriterRef.current = null\n      try { await opened?.close() } catch {}\n      setMasterStatus('연결 실패')\n      if (error?.name !== 'NotFoundError') showToast(error?.message || 'MASTER 연결에 실패했어요. Arduino Serial Monitor가 열려 있으면 닫아 주세요.')\n    }`
        if (out.includes(previousCatch)) out = out.replace(previousCatch, newCatch)
      }

      return { code: out, map: null }
    },
  }
}
