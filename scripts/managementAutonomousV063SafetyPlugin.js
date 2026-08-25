const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`autonomous web v0.6.3 safety: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementAutonomousV063SafetyPlugin() {
  return {
    name: 'management-autonomous-v063-safety',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      const handshakeBlock = `    if (line.includes('LSM_READY LSM-B1 AB_DUAL V063')) {
      window.__LSM_MASTER_V063_PORT__ = serialPortRef.current
    }`
      const ackEvents = `${handshakeBlock}
    if (line.startsWith('A_SCHEDULED ')) {
      window.dispatchEvent(new CustomEvent('lsm-a-clock-scheduled', { detail: { line } }))
    }
    if (line.startsWith('A_SCHEDULE_DENIED') || line.startsWith('A_SCHEDULE_BUSY') || line.startsWith('ERR A_CLOCK')) {
      window.dispatchEvent(new CustomEvent('lsm-a-clock-schedule-failed', { detail: { line } }))
    }`
      out = replaceRequired(out, handshakeBlock, ackEvents, 'A schedule ACK events')

      const oldSendBlock = `    const sent = await sendSerialLine(\`A_LIVE_SCHEDULE \${goOffsetMs}\`)
    if (!sent) {
      if (!wasPlaying) pause(false)
      showToast('A 독립 START 전송 실패 · MASTER 연결을 확인해 주세요.')
      return
    }

    bArmedOffsetRef.current = goOffsetMs`

      const newSendBlock = `    if (window.__LSM_A_CLOCK_REQUEST_BUSY__) {
      showToast('A CLOCK LOCK 준비 중입니다. 중복 START를 차단했어요.')
      return
    }
    window.__LSM_A_CLOCK_REQUEST_BUSY__ = true

    const scheduleAck = new Promise((resolve) => {
      let done = false
      let timer = 0
      const finish = (result) => {
        if (done) return
        done = true
        window.clearTimeout(timer)
        window.removeEventListener('lsm-a-clock-scheduled', onOk)
        window.removeEventListener('lsm-a-clock-schedule-failed', onFail)
        resolve(result)
      }
      const onOk = (event) => finish({ ok: true, line: event?.detail?.line || 'A_SCHEDULED' })
      const onFail = (event) => finish({ ok: false, line: event?.detail?.line || 'A_SCHEDULE_DENIED' })
      window.addEventListener('lsm-a-clock-scheduled', onOk)
      window.addEventListener('lsm-a-clock-schedule-failed', onFail)
      timer = window.setTimeout(() => finish({ ok: false, line: 'MASTER ACK TIMEOUT' }), 2000)
    })

    const sent = await sendSerialLine(\`A_LIVE_SCHEDULE \${goOffsetMs}\`)
    if (!sent) {
      window.__LSM_A_CLOCK_REQUEST_BUSY__ = false
      if (!wasPlaying) pause(false)
      showToast('A CLOCK LOCK 전송 실패 · MASTER 연결을 확인해 주세요.')
      return
    }

    const scheduleResult = await scheduleAck
    window.__LSM_A_CLOCK_REQUEST_BUSY__ = false
    if (!scheduleResult.ok) {
      if (!wasPlaying) pause(false)
      const reason = scheduleResult.line.includes('RX_NOT_READY')
        ? 'RX 전체가 O 상태가 아닙니다. X/?/V를 해결한 뒤 다시 시작하세요.'
        : scheduleResult.line.includes('TIMEOUT')
          ? 'MASTER 확인 응답이 없어 안전상 시작하지 않았습니다.'
          : 'MASTER가 CLOCK LOCK을 거부했습니다.'
      showToast(\`A CLOCK LOCK 차단 · \${reason}\`)
      return
    }

    bArmedOffsetRef.current = goOffsetMs`
      out = replaceRequired(out, oldSendBlock, newSendBlock, 'A schedule ACK gate')

      return { code: out, map: null }
    },
  }
}
