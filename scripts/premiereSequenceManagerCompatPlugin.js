import { premiereSequenceManagerPlugin } from './premiereSequenceManagerPlugin.js'
import { premiereProjectWorkspacePlugin } from './premiereProjectWorkspacePlugin.js'

export function premiereSequenceManagerCompatPlugin() {
  const base = premiereSequenceManagerPlugin()
  const projectWorkspace = premiereProjectWorkspacePlugin()
  return {
    ...base,
    name: 'premiere-sequence-manager-compat',
    transform(code, id) {
      let normalized = code
      if (id.includes('src/App.jsx')) {
        // accountTransferPlugin replaces the legacy local JSON save/load implementation
        // with buildCloudProjectData()/applyCloudProjectData(). The sequence manager still
        // validates the old anchors, so provide those anchors only inside comments. Its
        // local migration replacements remain commented out, while the real sequence
        // persistence is applied once to the shared cloud project build/apply functions.
        normalized = normalized.replace('\nconst arduinoExportTargets', '\n  const arduinoExportTargets')

        const loadAnchor = '  const loadProject = async (file) => {'
        if (normalized.includes(loadAnchor) && !normalized.includes('SEQUENCE_LOCAL_SAVE_COMPAT')) {
          normalized = normalized.replace(
            loadAnchor,
            '  /* SEQUENCE_LOCAL_SAVE_COMPAT\n      blocks,\n  */\n' + loadAnchor
          )
        }

        const exportAnchor = '  const arduinoExportTargets'
        if (normalized.includes(exportAnchor) && !normalized.includes('SEQUENCE_LOCAL_LOAD_COMPAT')) {
          normalized = normalized.replace(
            exportAnchor,
            '  /* SEQUENCE_LOCAL_LOAD_COMPAT\n      setBlocks(data.blocks || []);\n  */\n' + exportAnchor
          )
        }
      }
      const sequenceResult = base.transform.call(this, normalized, id)
      if (!sequenceResult || !id.includes('src/App.jsx')) return sequenceResult
      const sequenceCode = typeof sequenceResult === 'string' ? sequenceResult : sequenceResult.code
      return projectWorkspace.transform.call(this, sequenceCode, id)
    },
  }
}
