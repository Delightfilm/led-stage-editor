export function managementFirmwareHardenPlugin() {
  return {
    name: 'management-firmware-harden',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/managementProjectFirmware.js')) return null
      let out = code

      const importAnchor = 'import { buildNrf24ReceiverSketch as buildProductionReceiverSketch } from "./nrf24Pipe1Codegen.js";'
      const hardenImport = 'import { hardenStageMasterFirmware, hardenStageReceiverFirmware } from "./managementFirmwareHarden.js";'
      if (!out.includes(hardenImport)) {
        if (!out.includes(importAnchor)) throw new Error('firmware harden: import anchor not found')
        out = out.replace(importAnchor, importAnchor + '\n' + hardenImport)
      }

      out = out.replace(
        '  masterCode = addLiveTelemetryToMasterSketch(masterCode);',
        '  masterCode = addLiveTelemetryToMasterSketch(masterCode);\n  masterCode = hardenStageMasterFirmware(masterCode);'
      )

      out = out.replace(
        '    code: buildNrf24ManagementReceiverSketch({ ...rx, showHash: receiverHashes[index] || 0 }),',
        '    code: hardenStageReceiverFirmware(buildNrf24ManagementReceiverSketch({ ...rx, showHash: receiverHashes[index] || 0 })), '
      )

      out = out.replace(
        '  feed(target?.receiverId || 0);',
        '  feed("mgmt-rehearsal-force-stop-v1");\n  feed(target?.receiverId || 0);'
      )

      return { code: out, map: null }
    },
  }
}
