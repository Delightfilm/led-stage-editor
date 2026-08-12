export function defaultRelayPinPlugin() {
  return {
    name: 'default-relay-pin-d4',
    transform(code, id) {
      if (!/[\\/]src[\\/]App\.jsx(?:\?|$)/.test(id)) return null

      const from = '{ id: uid(), name: "EL 와이어", pin: 2 },'
      const to = '{ id: uid(), name: "EL 와이어", pin: 4 },'

      if (!code.includes(from)) return null
      return code.replace(from, to)
    },
  }
}
