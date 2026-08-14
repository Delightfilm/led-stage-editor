import { premiereSequenceManagerPlugin } from './premiereSequenceManagerPlugin.js'

export function premiereSequenceManagerCompatPlugin() {
  const base = premiereSequenceManagerPlugin()
  return {
    ...base,
    name: 'premiere-sequence-manager-compat',
    transform(code, id) {
      let normalized = code
      if (id.includes('src/App.jsx')) {
        // accountTransferPlugin slices from the regex match itself, so the indentation
        // immediately before arduinoExportTargets can disappear. Restore the editor's
        // normal component indentation before the sequence manager locates that region.
        normalized = normalized.replace('\nconst arduinoExportTargets', '\n  const arduinoExportTargets')
      }
      return base.transform.call(this, normalized, id)
    },
  }
}
