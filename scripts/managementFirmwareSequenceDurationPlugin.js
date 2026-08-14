export function managementFirmwareSequenceDurationPlugin() {
  return {
    name: 'management-firmware-sequence-duration',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/managementProjectFirmware.js')) return null
      let out = code
      out = out.replace(
        'export function buildManagementFirmwareBundle({ costumes = [], blocks = [] } = {}) {',
        'export function buildManagementFirmwareBundle({ costumes = [], blocks = [], showDurationMs: sequenceDurationMs = 0 } = {}) {'
      )
      out = out.replace(
        '  const showDurationMs = Math.max(0, ...receivers.flatMap((rx) => rx.parts.map((part) => part.endMs || 0)));',
        '  const bakedDurationMs = Math.max(0, ...receivers.flatMap((rx) => rx.parts.map((part) => part.endMs || 0)));\n  const requestedDurationMs = Math.max(0, Math.round(Number(sequenceDurationMs) || 0));\n  const showDurationMs = requestedDurationMs > 0 ? requestedDurationMs : bakedDurationMs;'
      )
      out = out.replace(
        '  const previewSafeLimitMs = firstOns.length ? Math.min(...firstOns) : Math.max(1, showDurationMs);',
        '  const previewSafeLimitMs = firstOns.length ? Math.min(Math.min(...firstOns), Math.max(1, showDurationMs)) : Math.max(1, showDurationMs);'
      )
      if (!out.includes('sequenceDurationMs') || !out.includes('requestedDurationMs')) {
        throw new Error('firmware sequence duration: patch failed')
      }
      return { code: out, map: null }
    },
  }
}
