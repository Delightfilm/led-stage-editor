export function managementTelemetryHeartbeatPlugin() {
  return {
    name: 'management-telemetry-heartbeat',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      const oldEffect = [
        "  useEffect(() => {",
        "    if (!masterConnected) { setPingAlive(false); setPingRtt(null); setRxTelemetrySeen(false); setRxPulseId(null); pongRef.current = 0; return undefined }",
        "    const ping = () => { pingSentRef.current = performance.now(); sendSerialLine('PING') }",
        "    ping()",
        "    const pingTimer = window.setInterval(ping, 1000)",
        "    const healthTimer = window.setInterval(() => setPingAlive(pongRef.current > 0 && performance.now() - pongRef.current < 2500), 400)",
        "    return () => { window.clearInterval(pingTimer); window.clearInterval(healthTimer) }",
        "  }, [masterConnected])",
      ].join('\n')

      const newEffect = [
        "  useEffect(() => {",
        "    if (!masterConnected) {",
        "      setPingAlive(false)",
        "      setPingRtt(null)",
        "      setRxTelemetrySeen(false)",
        "      setRxPulseId(null)",
        "      pongRef.current = 0",
        "      return undefined",
        "    }",
        "",
        "    let cancelled = false",
        "    const writeHeartbeat = (includeHello = false) => {",
        "      const port = serialPortRef.current",
        "      const writer = serialWriterRef.current",
        "      if (!port || !writer) return",
        "      const payload = new TextEncoder().encode(includeHello ? 'HELLO LSM-B1\\nPING\\n' : 'PING\\n')",
        "      serialWriteQueueRef.current = serialWriteQueueRef.current",
        "        .then(async () => {",
        "          if (cancelled || serialPortRef.current !== port || serialWriterRef.current !== writer) return",
        "          pingSentRef.current = performance.now()",
        "          await writer.write(payload)",
        "        })",
        "        .catch((error) => {",
        "          if (cancelled || serialPortRef.current !== port) return",
        "          try { addMasterLog(`! HEARTBEAT: ${error?.message || 'write error'}`) } catch {}",
        "        })",
        "    }",
        "",
        "    // UNO may auto-reset when Web Serial opens. Retry independently of React state",
        "    // so telemetry becomes active before any B LIVE command is sent.",
        "    const helloTimer = window.setTimeout(() => writeHeartbeat(true), 350)",
        "    const retryTimer = window.setTimeout(() => writeHeartbeat(true), 1350)",
        "    const pingTimer = window.setInterval(() => writeHeartbeat(false), 750)",
        "    const healthTimer = window.setInterval(() => {",
        "      setPingAlive(pongRef.current > 0 && performance.now() - pongRef.current < 2200)",
        "    }, 300)",
        "",
        "    return () => {",
        "      cancelled = true",
        "      window.clearTimeout(helloTimer)",
        "      window.clearTimeout(retryTimer)",
        "      window.clearInterval(pingTimer)",
        "      window.clearInterval(healthTimer)",
        "    }",
        "  }, [masterConnected])",
      ].join('\n')

      if (!out.includes(oldEffect)) {
        if (!out.includes('! HEARTBEAT:')) throw new Error('telemetry heartbeat: live monitor effect anchor not found')
      } else {
        out = out.replace(oldEffect, newEffect)
      }

      return { code: out, map: null }
    },
  }
}
