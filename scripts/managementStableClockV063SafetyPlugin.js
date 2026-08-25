export function managementStableClockV063SafetyPlugin() {
  return {
    name: 'management-stable-clock-v063-safety',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/managementProjectFirmware.js')) return null
      let out = code

      const stableImport = 'import { applyStableAClockMasterV063, applyStableAClockReceiverV063 } from "./managementStableClockV063.js";'
      const safetyImport = 'import { applyStableAClockMasterSafetyV063, applyStableAClockReceiverSafetyV063 } from "./managementStableClockV063Safety.js";'
      if (!out.includes(stableImport)) throw new Error('v0.6.3 safety: stable clock import anchor not found')
      if (!out.includes(safetyImport)) out = out.replace(stableImport, `${stableImport}\n${safetyImport}`)

      const masterAnchor = '  masterCode = applyStableAClockMasterV063(masterCode);'
      if (!out.includes(masterAnchor)) throw new Error('v0.6.3 safety: stable master call anchor not found')
      out = out.replace(masterAnchor, `${masterAnchor}\n  masterCode = applyStableAClockMasterSafetyV063(masterCode);`)

      const receiverAnchor = '    code: applyStableAClockReceiverV063(hardenStageReceiverFirmware(buildNrf24ManagementReceiverSketch({ ...rx, showHash: receiverHashes[index] || 0 }))), '
      if (!out.includes(receiverAnchor)) throw new Error('v0.6.3 safety: stable receiver call anchor not found')
      out = out.replace(
        receiverAnchor,
        '    code: applyStableAClockReceiverSafetyV063(applyStableAClockReceiverV063(hardenStageReceiverFirmware(buildNrf24ManagementReceiverSketch({ ...rx, showHash: receiverHashes[index] || 0 })))), '
      )

      // Distinguish the final fail-closed v0.6.3 RX image from any early v0.6.3 build.
      const hashAnchor = '  feed("mgmt-a-clocklock-v063");'
      if (!out.includes(hashAnchor)) throw new Error('v0.6.3 safety: clock-lock hash anchor not found')
      out = out.replace(hashAnchor, `${hashAnchor}\n  feed("mgmt-a-clocklock-v063-safety1");`)

      return { code: out, map: null }
    },
  }
}
