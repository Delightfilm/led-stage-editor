export function managementFirmwareDurationBridgePlugin() {
  return {
    name: 'management-firmware-duration-bridge',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      if (code.includes('showDurationMs: Math.round(duration * 1000)')) return null
      const pattern = /buildManagementFirmwareBundle\(\{\s*costumes\s*,\s*blocks\s*\}\)/
      if (!pattern.test(code)) throw new Error('firmware duration bridge: bundle call not found')
      const out = code.replace(pattern, 'buildManagementFirmwareBundle({ costumes, blocks, showDurationMs: Math.round(duration * 1000) })')
        .replace('  }, [costumes, blocks])', '  }, [costumes, blocks, duration])')
      return { code: out, map: null }
    },
  }
}
