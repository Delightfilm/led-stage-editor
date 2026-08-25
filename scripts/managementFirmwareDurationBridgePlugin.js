export function managementFirmwareDurationBridgePlugin() {
  return {
    name: 'management-firmware-duration-bridge',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      // Always normalize the firmware bundle call. Do not return early merely because
      // another transform already inserted showDurationMs somewhere else in the file.
      const plainCall = /buildManagementFirmwareBundle\(\{\s*costumes\s*,\s*blocks\s*\}\)/
      const durationCall = /buildManagementFirmwareBundle\(\{\s*costumes\s*,\s*blocks\s*,\s*showDurationMs:\s*Math\.round\(duration\s*\*\s*1000\)\s*\}\)/

      if (plainCall.test(out)) {
        out = out.replace(
          plainCall,
          'buildManagementFirmwareBundle({ costumes, blocks, showDurationMs: Math.round(duration * 1000) })'
        )
      } else if (!durationCall.test(out)) {
        throw new Error('firmware duration bridge: bundle call not found or has unexpected shape')
      }

      // Update the dependency list belonging to firmwareBundle. Restrict the search to
      // the region before firmwareItems so unrelated useMemo hooks are never changed.
      const firmwareStart = out.indexOf('  const firmwareBundle = useMemo(() => {')
      const firmwareItemsStart = out.indexOf('  const firmwareItems = useMemo', firmwareStart)
      if (firmwareStart < 0 || firmwareItemsStart < 0) {
        throw new Error('firmware duration bridge: firmwareBundle region not found')
      }

      const before = out.slice(0, firmwareStart)
      let region = out.slice(firmwareStart, firmwareItemsStart)
      const after = out.slice(firmwareItemsStart)

      if (region.includes('  }, [costumes, blocks])')) {
        region = region.replace('  }, [costumes, blocks])', '  }, [costumes, blocks, duration])')
      } else if (!region.includes('  }, [costumes, blocks, duration])')) {
        throw new Error('firmware duration bridge: firmwareBundle dependency list not found')
      }

      out = before + region + after

      if (!durationCall.test(out) || !region.includes('[costumes, blocks, duration]')) {
        throw new Error('firmware duration bridge: final verification failed')
      }

      return { code: out, map: null }
    },
  }
}
