export function managementV066FirmwareGeneratorFixPlugin() {
  return {
    name: 'management-v066-firmware-generator-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      if (!code.includes('WEB v0.6.5')) {
        throw new Error('v0.6.6 web: v0.6.5 version marker not found')
      }
      return { code: code.replace('WEB v0.6.5', 'WEB v0.6.6'), map: null }
    },
  }
}
