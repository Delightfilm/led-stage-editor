export function managementTelemetryHeartbeatPlugin() {
  return {
    name: 'management-telemetry-heartbeat',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      if (out.includes('MANAGEMENT_DIRECT_HEARTBEAT')) return { code: out, map: null }

      const anchor = '  const sendSeekToMaster = (time, force = false) => {'
      if (!out.includes(anchor)) throw new Error('telemetry heartbeat: sendSeekToMaster anchor not found')

      const effect = [
        '  // MANAGEMENT_DIRECT_HEARTBEAT',
        '  // Keep MASTER telemetry alive independently of React state captured by sendSerialLine.',
        '  // Only one heartbeat write may be queued at a time; a stalled USB writer must not',
        '  // accumulate an unbounded PING backlog ahead of operator commands.',
        '  useEffect(() => {',
        '    if (!masterConnected) return undefined',
        '    let cancelled = false',
        '    let heartbeatQueued = false',
        '',
        '    const writeHeartbeat = (includeHello = false) => {',
        '      const port = serialPortRef.current',
        '      const writer = serialWriterRef.current',
        '      if (!port || !writer || heartbeatQueued) return',
        '      heartbeatQueued = true',
        "      const payload = new TextEncoder().encode(includeHello ? 'HELLO LSM-B1\\nPING\\n' : 'PING\\n')",
        '      serialWriteQueueRef.current = serialWriteQueueRef.current',
        '        .then(async () => {',
        '          if (cancelled || serialPortRef.current !== port || serialWriterRef.current !== writer) return',
        '          pingSentRef.current = performance.now()',
        '          await writer.write(payload)',
        '        })',
        '        .catch((error) => {',
        '          if (cancelled || serialPortRef.current !== port) return',
        "          try { addMasterLog(`! HEARTBEAT: ${error?.message || 'write error'}`) } catch {}",
        '        })',
        '        .finally(() => { heartbeatQueued = false })',
        '    }',
        '',
        '    // Web Serial opening can reset an UNO. HELLO/PING is retried after boot,',
        '    // then one PING per second is enough for RTT + RXMON health.',
        '    const helloTimer = window.setTimeout(() => writeHeartbeat(true), 350)',
        '    const retryTimer = window.setTimeout(() => writeHeartbeat(true), 1400)',
        '    const pingTimer = window.setInterval(() => writeHeartbeat(false), 1000)',
        '',
        '    return () => {',
        '      cancelled = true',
        '      window.clearTimeout(helloTimer)',
        '      window.clearTimeout(retryTimer)',
        '      window.clearInterval(pingTimer)',
        '    }',
        '  }, [masterConnected])',
        '',
      ].join('\n')

      out = out.replace(anchor, effect + anchor)
      return { code: out, map: null }
    },
  }
}
