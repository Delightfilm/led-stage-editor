export function managementFirmwareDurationBridgePlugin() {
  return {
    name: 'management-firmware-duration-bridge',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      const plainCall = /buildManagementFirmwareBundle\(\{\s*costumes\s*,\s*blocks\s*\}\)/
      const durationCall = /buildManagementFirmwareBundle\(\{\s*costumes\s*,\s*blocks\s*,\s*showDurationMs:\s*Math\.round\(duration\s*\*\s*1000\)\s*\}\)/
      const durationCallText = 'buildManagementFirmwareBundle({ costumes, blocks, showDurationMs: Math.round(duration * 1000) })'

      if (plainCall.test(out)) out = out.replace(plainCall, durationCallText)
      else if (!durationCall.test(out)) throw new Error('firmware duration bridge: bundle call not found or has unexpected shape')

      const callIndex = out.indexOf(durationCallText)
      if (callIndex < 0) throw new Error('firmware duration bridge: normalized bundle call missing')

      const searchEnd = Math.min(out.length, callIndex + 5000)
      const tail = out.slice(callIndex, searchEnd)
      const oldDeps = '[costumes, blocks])'
      const newDeps = '[costumes, blocks, duration])'
      const oldDepIndex = tail.indexOf(oldDeps)
      const newDepIndex = tail.indexOf(newDeps)

      if (oldDepIndex >= 0 && (newDepIndex < 0 || oldDepIndex < newDepIndex)) {
        const absolute = callIndex + oldDepIndex
        out = out.slice(0, absolute) + newDeps + out.slice(absolute + oldDeps.length)
      } else if (newDepIndex < 0) {
        throw new Error('firmware duration bridge: nearest firmware useMemo dependency list not found')
      }

      const verifyCallIndex = out.indexOf(durationCallText)
      const verifyTail = out.slice(verifyCallIndex, Math.min(out.length, verifyCallIndex + 5000))
      if (verifyCallIndex < 0 || !verifyTail.includes(newDeps)) {
        throw new Error('firmware duration bridge: final verification failed')
      }

      return { code: out, map: null }
    },
  }
}
