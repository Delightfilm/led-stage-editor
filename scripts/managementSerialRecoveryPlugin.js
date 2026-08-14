export function managementSerialRecoveryPlugin() {
  return {
    name: 'management-serial-recovery',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      // Serial writes must follow the actual open port, not a React state value
      // captured by an older render. This also makes the first HELLO after open reliable.
      out = out.replace(
        "    if (!writer || !masterConnected) return false\n    const handshakeOnly",
        "    if (!writer || !serialPortRef.current) return false\n    const handshakeOnly"
      )

      const start = out.indexOf('  const connectMaster = async () => {')
      const end = out.indexOf('\n\n  const sendSeekToMaster =', start)
      if (start < 0 || end < 0) throw new Error('serial recovery: connectMaster anchors not found')

      const replacement = `  const connectMaster = async () => {
    if (!serialSupported) {
      showToast('이 브라우저는 Web Serial을 지원하지 않아요. 데스크톱 Chrome/Edge에서 열어 주세요.')
      return
    }
    if (masterConnected) {
      await disconnectMaster()
      return
    }

    let port = null
    try {
      setMasterStatus('포트 선택 대기…')
      port = await navigator.serial.requestPort()
    } catch (error) {
      if (error?.name === 'NotFoundError') {
        setMasterStatus('USB 미연결')
        return
      }
      const name = error?.name || 'Error'
      const raw = String(error?.message || '')
      setMasterStatus('포트 선택 실패 · ' + name)
      showToast(raw || ('포트 선택 실패 · ' + name))
      try { addMasterLog('! SELECT ' + name + ': ' + raw) } catch {}
      return
    }

    try {
      // baudRate is the only required open option. Keeping the open request minimal
      // avoids browser/driver-specific option failures after an Arduino flash/reset.
      await port.open({ baudRate: SERIAL_BAUD })
    } catch (error) {
      const name = error?.name || 'Error'
      const raw = String(error?.message || '')
      if (name === 'NetworkError' || /open serial port|device is busy|access denied/i.test(raw)) {
        setMasterStatus('COM 포트를 열 수 없음')
        showToast('COM 포트를 다른 프로그램이 사용 중일 수 있어요. Arduino 시리얼 모니터/다른 웹사이트를 닫고 다시 연결해 주세요.')
      } else if (name === 'InvalidStateError') {
        setMasterStatus('COM 포트 사용 중')
        showToast('선택한 COM 포트가 이미 열려 있어요. 이전 연결을 닫고 다시 시도해 주세요.')
      } else {
        setMasterStatus('연결 실패 · ' + name)
        showToast(raw ? (name + ': ' + raw) : ('연결 실패 · ' + name))
      }
      try { addMasterLog('! OPEN ' + name + ': ' + (raw || 'serial open failed')) } catch {}
      try { await port.close() } catch {}
      return
    }

    // From here the COM port is already open. Non-critical UI/telemetry failures must
    // not be allowed to tear the port back down as a generic ReferenceError.
    serialPortRef.current = port
    masterReadyRef.current = false
    serialBufferRef.current = ''
    setMasterConnected(true)
    setMasterProtocolReady(false)
    setMasterStatus('USB OPEN · 부팅 대기')
    setMasterLog([])

    try {
      const info = typeof port.getInfo === 'function' ? port.getInfo() : {}
      const vid = info?.usbVendorId != null ? info.usbVendorId.toString(16).padStart(4, '0') : '----'
      const pid = info?.usbProductId != null ? info.usbProductId.toString(16).padStart(4, '0') : '----'
      addMasterLog('USB OPEN · VID:' + vid + ' PID:' + pid)
    } catch {}

    try {
      if (!port.writable) throw new Error('Serial writable stream unavailable')
      serialWriterRef.current = port.writable.getWriter()
    } catch (error) {
      const raw = String(error?.message || '')
      setMasterStatus('USB WRITE 준비 실패')
      showToast(raw || 'MASTER의 시리얼 쓰기 스트림을 열 수 없어요.')
      serialPortRef.current = null
      setMasterConnected(false)
      try { await port.close() } catch {}
      return
    }

    // Reader failures are handled by startSerialReader itself. Do not await it here;
    // it intentionally lives for the full connection lifetime.
    try {
      const readerTask = startSerialReader(port)
      if (readerTask?.catch) readerTask.catch((error) => {
        if (serialPortRef.current !== port) return
        const raw = String(error?.message || '')
        setMasterStatus('USB 읽기 중단')
        try { addMasterLog('! READ: ' + raw) } catch {}
      })
    } catch (error) {
      const raw = String(error?.message || '')
      setMasterStatus('USB READER 준비 실패')
      try { addMasterLog('! READER: ' + raw) } catch {}
    }

    // Write the first handshake directly through the newly acquired writer. Using
    // sendSerialLine here can otherwise capture masterConnected=false from this render.
    window.setTimeout(async () => {
      if (serialPortRef.current !== port) return
      const writer = serialWriterRef.current
      if (!writer) return
      try {
        const encoder = new TextEncoder()
        await writer.write(encoder.encode('HELLO LSM-B1\\n'))
        await writer.write(encoder.encode('PING\\n'))
      } catch (error) {
        const raw = String(error?.message || '')
        if (serialPortRef.current === port) {
          setMasterStatus('USB handshake 오류')
          try { addMasterLog('! HANDSHAKE: ' + raw) } catch {}
        }
      }
    }, 900)

    window.setTimeout(() => {
      if (serialPortRef.current === port && !masterReadyRef.current) {
        setMasterStatus('USB 연결됨 · B 펌웨어 응답 대기')
      }
    }, 3000)

    showToast('MASTER USB 연결됨 · 펌웨어 handshake 확인 중')
  }`

      out = out.slice(0, start) + replacement + out.slice(end)
      return { code: out, map: null }
    },
  }
}
