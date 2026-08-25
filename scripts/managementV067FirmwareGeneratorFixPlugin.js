export function managementV067FirmwareGeneratorFixPlugin() {
  return {
    name: 'management-v067-firmware-generator-fix',
    enforce: 'pre',
    transform(code, id) {
      let out = code

      if (id.includes('src/managementProjectFirmware.js')) {
        const safetyImport = 'import { applySafetyMasterV065, applySafetyReceiverV065 } from "./managementSafetyV065.js";'
        const compatImport = 'import { normalizeSafetyMasterInputV067 } from "./managementSafetyV067Compat.js";'
        if (!out.includes(safetyImport)) throw new Error('v0.6.7 firmware: v0.6.5 safety import missing')
        if (!out.includes(compatImport)) out = out.replace(safetyImport, `${safetyImport}\n${compatImport}`)

        const safetyCall = '  masterCode = applySafetyMasterV065(masterCode, bundleHash);'
        const normalizedCall = '  masterCode = applySafetyMasterV065(normalizeSafetyMasterInputV067(masterCode), bundleHash);'
        if (!out.includes(normalizedCall)) {
          if (!out.includes(safetyCall)) throw new Error('v0.6.7 firmware: master safety call anchor missing')
          out = out.replace(safetyCall, normalizedCall)
        }
      }

      if (id.includes('src/ManagementApp.jsx')) {
        if (!out.includes('WEB v0.6.6')) throw new Error('v0.6.7 web: v0.6.6 version marker not found')
        out = out.replace('WEB v0.6.6', 'WEB v0.6.7')
      }

      return out === code ? null : { code: out, map: null }
    },
  }
}
