export function defaultRelayPinPlugin() {
  return {
    name: 'default-relay-pin-d4',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null

      const from = '{ id: uid(), name: "EL 와이어", pin: 2 },'
      const to = '{ id: uid(), name: "EL 와이어", pin: 4 },'
      let out = code.replaceAll(from, to)

      // The default costume factory must always create its EL relay on D4.
      if (!out.includes(to)) {
        throw new Error('default relay pin: D4 costume default not found')
      }

      if (out === code) return null
      return { code: out, map: null }
    },
  }
}
