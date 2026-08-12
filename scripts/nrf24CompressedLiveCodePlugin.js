import { nrf24LiveCodePlugin } from './nrf24LiveCodePlugin.js'

export function nrf24CompressedLiveCodePlugin() {
  const base = nrf24LiveCodePlugin()

  return {
    ...base,
    name: 'nrf24-compressed-live-code-panel',
    transform(code, id) {
      const result = base.transform(code, id)
      if (!result) return result

      const transformed = typeof result === 'string' ? result : result.code
      const patched = transformed.replace(
        './nrf24Codegen.js',
        './nrf24Pipe1Codegen.js'
      )

      if (typeof result === 'string') return patched
      return { ...result, code: patched }
    },
  }
}
