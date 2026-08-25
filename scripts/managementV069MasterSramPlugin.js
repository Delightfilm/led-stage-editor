const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`v0.6.9 SRAM plugin: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementV069MasterSramPlugin() {
  return {
    name: 'management-v069-master-sram',
    enforce: 'pre',
    transform(code, id) {
      let out = code

      if (id.includes('src/managementProjectFirmware.js')) {
        const safetyImport = 'import { applySafetyMasterV065, applySafetyReceiverV065 } from "./managementSafetyV065.js";'
        const sramImport = 'import { optimizeManagementMasterSramV069 } from "./managementMasterSramV069.js";'
        if (!out.includes(safetyImport)) throw new Error('v0.6.9 SRAM plugin: v0.6.5 safety import missing')
        if (!out.includes(sramImport)) out = out.replace(safetyImport, `${safetyImport}\n${sramImport}`)

        const safetyCall = '  masterCode = applySafetyMasterV065(masterCode, bundleHash);'
        const optimizedCall = '  masterCode = optimizeManagementMasterSramV069(masterCode);'
        if (!out.includes(safetyCall)) throw new Error('v0.6.9 SRAM plugin: final MASTER safety call missing')
        if (!out.includes(optimizedCall)) out = out.replace(safetyCall, `${safetyCall}\n${optimizedCall}`)
      }

      if (id.includes('src/ManagementApp.jsx')) {
        if (!out.includes('WEB v0.6.8')) throw new Error('v0.6.9 web: v0.6.8 version marker not found')
        out = out.replace('WEB v0.6.8', 'WEB v0.6.9')
      }

      return out === code ? null : { code: out, map: null }
    },
  }
}
