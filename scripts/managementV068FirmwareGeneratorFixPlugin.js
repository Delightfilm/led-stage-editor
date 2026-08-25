export function managementV068FirmwareGeneratorFixPlugin() {
  return {
    name: 'management-v068-firmware-generator-fix',
    enforce: 'pre',
    transform(code, id) {
      let out = code

      if (id.includes('src/managementProjectFirmware.js')) {
        const safetyImport = 'import { applySafetyMasterV065, applySafetyReceiverV065 } from "./managementSafetyV065.js";'
        const compatImport = 'import { applySafetyReceiverV068Compat } from "./managementSafetyV068Compat.js";'
        if (!out.includes(safetyImport)) throw new Error('v0.6.8 firmware: v0.6.5 safety import missing')
        if (!out.includes(compatImport)) out = out.replace(safetyImport, `${safetyImport}\n${compatImport}`)

        const oldChain = 'applyScheduleTelemetryReceiverV065(applyAckFreshnessReceiverV065(applySafetyReceiverV065('
        const newChain = 'applyScheduleTelemetryReceiverV065(applyAckFreshnessReceiverV065(applySafetyReceiverV068Compat('
        if (!out.includes(newChain)) {
          if (!out.includes(oldChain)) throw new Error('v0.6.8 firmware: receiver safety wrapper anchor missing')
          out = out.replace(oldChain, newChain)
        }
      }

      if (id.includes('src/ManagementApp.jsx')) {
        if (!out.includes('WEB v0.6.7')) throw new Error('v0.6.8 web: v0.6.7 version marker not found')
        out = out.replace('WEB v0.6.7', 'WEB v0.6.8')
      }

      return out === code ? null : { code: out, map: null }
    },
  }
}
