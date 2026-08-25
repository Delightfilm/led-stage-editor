const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`resilient join v0.6.4: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementResilientJoinV064Plugin() {
  return {
    name: 'management-resilient-join-v064',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('src/managementProjectFirmware.js')) {
        let out = code
        const guardImport = 'import { applyV063FailClosedMaster, applyV063FailClosedReceiver } from "./managementV063FailClosedFirmware.js";'
        const v064Import = 'import { applyResilientJoinMasterV064, applyResilientJoinReceiverV064 } from "./managementResilientJoinV064.js";'
        if (!out.includes(guardImport)) throw new Error('v0.6.4: v0.6.3 guard import anchor not found')
        if (!out.includes(v064Import)) out = out.replace(guardImport, `${guardImport}\n${v064Import}`)

        const masterCall = '  masterCode = applyV063FailClosedMaster(masterCode);'
        if (!out.includes(masterCall)) throw new Error('v0.6.4: master guard call anchor not found')
        out = out.replace(masterCall, `${masterCall}\n  masterCode = applyResilientJoinMasterV064(masterCode);`)

        const rxCall = '    code: applyV063FailClosedReceiver(applyStableAClockReceiverV063(hardenStageReceiverFirmware(buildNrf24ManagementReceiverSketch({ ...rx, showHash: receiverHashes[index] || 0 })))), '
        if (!out.includes(rxCall)) throw new Error('v0.6.4: receiver guard call anchor not found')
        out = out.replace(
          rxCall,
          '    code: applyResilientJoinReceiverV064(applyV063FailClosedReceiver(applyStableAClockReceiverV063(hardenStageReceiverFirmware(buildNrf24ManagementReceiverSketch({ ...rx, showHash: receiverHashes[index] || 0 }))))), '
        )

        const hashAnchor = '  feed("mgmt-a-clocklock-v063-final-safety");'
        if (!out.includes(hashAnchor)) throw new Error('v0.6.4: hash marker anchor not found')
        out = out.replace(hashAnchor, `${hashAnchor}\n  feed("mgmt-resilient-join-v064");`)
        return { code: out, map: null }
      }

      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      out = replaceRequired(
        out,
        `    if (line.includes('LSM_READY LSM-B1 AB_DUAL V063')) {\n      window.__LSM_MASTER_V063_PORT__ = serialPortRef.current\n    }`,
        `    if (line.includes('LSM_READY LSM-B1 AB_DUAL V064')) {\n      window.__LSM_MASTER_V064_PORT__ = serialPortRef.current\n    }`,
        'web v0.6.4 handshake marker'
      )

      out = replaceRequired(
        out,
        `    if (!masterProtocolReady) { showToast('MASTER v0.6.3 펌웨어 연결 후 사용할 수 있어요.'); return }\n    if (window.__LSM_MASTER_V063_PORT__ !== serialPortRef.current) {\n      showToast('안전 잠금 · MASTER v0.6.3 펌웨어를 업로드한 뒤 다시 연결해 주세요.')\n      return\n    }`,
        `    if (!masterProtocolReady) { showToast('MASTER v0.6.4 펌웨어 연결 후 사용할 수 있어요.'); return }\n    if (window.__LSM_MASTER_V064_PORT__ !== serialPortRef.current) {\n      showToast('안전 잠금 · MASTER v0.6.4 펌웨어를 업로드한 뒤 다시 연결해 주세요.')\n      return\n    }`,
        'web v0.6.4 master guard'
      )

      out = replaceRequired(
        out,
        `    showToast(\`A CLOCK LOCK 준비 · 모든 RX 재검증 중 · \${fmtTime(goOffsetMs / 1000)}\`)`,
        `    showToast(\`A CLOCK LOCK 준비 · O 즉시참여 / X·? JOIN WAIT / V 격리 · \${fmtTime(goOffsetMs / 1000)}\`)`,
        'A resilient prepare toast'
      )

      out = replaceRequired(
        out,
        `      const reason = outcome.line.includes('RX_NOT_READY')\n        ? 'RX 중 X/?/V 상태가 있어 시작을 차단했습니다.'\n        : outcome.line.includes('TIMEOUT')\n          ? 'MASTER 확인 응답이 없어 시작을 차단했습니다.'\n          : outcome.line`,
        `      const reason = outcome.line.includes('TIMEOUT')\n        ? 'MASTER 확인 응답이 없어 시작을 차단했습니다.'\n        : outcome.line`,
        'remove RX global start denial copy'
      )

      out = replaceRequired(
        out,
        `    setCurrentTime(clamp(confirmedTime, 0, duration))\n    setStageMode('A_LIVE')\n    showToast(\`A 독립 CLOCK LOCK 완료 · START LEAD 0ms · 공통 예약 100ms\`)`,
        `    setCurrentTime(clamp(confirmedTime, 0, duration))\n    setStageMode('A_LIVE')\n    const startFields = String(outcome.line || '').trim().split(/\\s+/)\n    const onlineNow = Math.max(0, Number(startFields[3]) || 0)\n    const joinWait = Math.max(0, Number(startFields[4]) || 0)\n    const quarantined = Math.max(0, Number(startFields[5]) || 0)\n    showToast(\`A CLOCK LOCK 완료 · 즉시참여 \${onlineNow}/\${firmwareBundle.receiverCount} · JOIN WAIT \${joinWait} · 격리 \${quarantined}\`)`,
        'A participation result toast'
      )

      const rxStatusAnchor = `{s==='O'?'ONLINE':s==='V'?'HASH V':s==='?'?'ACK ?':s==='W'?'WAIT':'OFFLINE'}`
      if (out.includes(rxStatusAnchor)) {
        out = out.replace(
          rxStatusAnchor,
          `{s==='O'?(stageLive?'LIVE / ONLINE':'ONLINE'):s==='V'?'QUARANTINE V':s==='?'?(stageLive?'JOIN WAIT ?':'ACK ?'):s==='W'?'WAIT':(stageLive?'HOLD / JOIN WAIT':'OFFLINE')}`
        )
      } else {
        throw new Error('v0.6.4: RX live status label anchor not found')
      }

      if (!out.includes('WEB v0.6.3')) throw new Error('v0.6.4: WEB v0.6.3 marker not found')
      out = out.replace('WEB v0.6.3', 'WEB v0.6.4')

      return { code: out, map: null }
    },
  }
}
