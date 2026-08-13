export function managementMenuPlugin() {
  return {
    name: 'management-menu-entry',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      if (id.includes('ManagementApp.jsx')) return null
      if (code.includes('LED STAGE MANAGEMENT')) return null

      const anchor = '        <div className="toolGroup right">'
      if (!code.includes(anchor)) throw new Error('management menu: utility group anchor not found')

      const entry = [
        anchor,
        '          <button type="button" className="tbtn compact" title="B안 · MASTER/RX 실시간 관리" onClick={() => { window.location.href = \'/?workspace=management\' }}>',
        '            🎛 LED STAGE MANAGEMENT',
        '          </button>',
      ].join('\n')

      return { code: code.replace(anchor, entry), map: null }
    },
  }
}
