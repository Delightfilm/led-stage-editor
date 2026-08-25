export function managementAutonomousFirmwareV062Plugin() {
  return {
    name: 'management-autonomous-firmware-v062',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/managementProjectFirmware.js')) return null
      let out = code

      const hardenImport = 'import { hardenStageMasterFirmware, hardenStageReceiverFirmware } from "./managementFirmwareHarden.js";'
      const autonomousImport = 'import { applyAutonomousAFirmwareV062 } from "./managementAutonomousFirmwareV062.js";'
      if (!out.includes(hardenImport)) throw new Error('autonomous firmware v0.6.2: harden import anchor not found')
      if (!out.includes(autonomousImport)) out = out.replace(hardenImport, `${hardenImport}\n${autonomousImport}`)

      const hardenCall = '  masterCode = hardenStageMasterFirmware(masterCode);'
      if (!out.includes(hardenCall)) throw new Error('autonomous firmware v0.6.2: harden call anchor not found')
      out = out.replace(hardenCall, `${hardenCall}\n  masterCode = applyAutonomousAFirmwareV062(masterCode);`)

      return { code: out, map: null }
    },
  }
}
