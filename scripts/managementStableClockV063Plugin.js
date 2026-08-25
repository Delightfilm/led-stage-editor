export function managementStableClockV063Plugin() {
  return {
    name: 'management-stable-clock-v063',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/managementProjectFirmware.js')) return null
      let out = code

      const autonomousImport = 'import { applyAutonomousAFirmwareV062 } from "./managementAutonomousFirmwareV062.js";'
      const stableImport = 'import { applyStableAClockMasterV063, applyStableAClockReceiverV063 } from "./managementStableClockV063.js";'
      if (!out.includes(autonomousImport)) throw new Error('stable clock v0.6.3: v0.6.2 autonomous import anchor not found')
      if (!out.includes(stableImport)) out = out.replace(autonomousImport, `${autonomousImport}\n${stableImport}`)

      const masterAnchor = '  masterCode = applyAutonomousAFirmwareV062(masterCode);'
      if (!out.includes(masterAnchor)) throw new Error('stable clock v0.6.3: master v0.6.2 call anchor not found')
      out = out.replace(masterAnchor, `${masterAnchor}\n  masterCode = applyStableAClockMasterV063(masterCode);`)

      const receiverAnchor = '    code: hardenStageReceiverFirmware(buildNrf24ManagementReceiverSketch({ ...rx, showHash: receiverHashes[index] || 0 })), '
      if (!out.includes(receiverAnchor)) throw new Error('stable clock v0.6.3: hardened receiver anchor not found')
      out = out.replace(
        receiverAnchor,
        '    code: applyStableAClockReceiverV063(hardenStageReceiverFirmware(buildNrf24ManagementReceiverSketch({ ...rx, showHash: receiverHashes[index] || 0 }))), '
      )

      // RX firmware behavior changed in v0.6.3. Force a hash/version change so an old
      // v0.6.2 receiver is visibly reported as V instead of being mistaken for READY.
      const hashAnchor = '  feed("mgmt-rehearsal-force-stop-v1");'
      if (!out.includes(hashAnchor)) throw new Error('stable clock v0.6.3: receiver hash anchor not found')
      out = out.replace(hashAnchor, `${hashAnchor}\n  feed("mgmt-a-clocklock-v063");`)

      return { code: out, map: null }
    },
  }
}
