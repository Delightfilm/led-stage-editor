const replaceOnce = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`ESP32 relay pins: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementEsp32RelayPinPlugin() {
  return {
    name: 'management-esp32-relay-pins',
    enforce: 'pre',
    transform(code, id) {
      // ESP32-only. Never touch the proven UNO/nRF24 firmware generator.
      if (!id.includes('src/managementEsp32Firmware.js')) return null
      if (code.includes('ESP32_RELAY_GPIO_MAP_V1')) return { code, map: null }

      let out = code
      const oldRelayPins = "  const relayPins = rx.parts.map((part) => Number.isFinite(Number(part.pin)) ? Number(part.pin) : 4)"
      const newRelayPins = [
        '  // ESP32 RX hardware has its own GPIO map. Do not reuse UNO D2-D8 values.',
        '  // Part 1 starts on GPIO16, matching the field-test wiring.',
        '  const ESP32_RELAY_GPIO = [16, 17, 18, 19, 23, 25, 26, 27]',
        '  if (rx.parts.length > ESP32_RELAY_GPIO.length) {',
        "    throw new Error(`ESP32 RX${rx.receiverId}: max ${ESP32_RELAY_GPIO.length} relay outputs supported`)",
        '  }',
        '  const relayPins = rx.parts.map((_, index) => ESP32_RELAY_GPIO[index])',
      ].join('\n')
      out = replaceOnce(out, oldRelayPins, newRelayPins, 'receiver relay mapping')

      out += '\n// ESP32_RELAY_GPIO_MAP_V1\n'
      return { code: out, map: null }
    },
  }
}
