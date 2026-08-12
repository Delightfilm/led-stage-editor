export function defaultRelayPinPlugin() {
  return {
    name: 'default-relay-pin-d4',
    transform(code, id) {
      if (!id.endsWith('/src/App.jsx') && !id.endsWith('\\src\\App.jsx')) return null

      const from = '{ id: uid(), name: "EL 와이어", pin: 2 },'
      const to = '{ id: uid(), name: "EL 와이어", pin: 4 },'

      if (!code.includes(from)) {
        throw new Error('default relay pin plugin: default EL part anchor not found')
      }

      return code.replace(from, to)
    },
  }
}
