export function managementMenuPlugin() {
  return {
    name: 'management-menu-entry',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      if (id.includes('ManagementApp.jsx')) return null

      const anchor = '            <div className="utilityActions">'
      if (!code.includes(anchor)) throw new Error('management menu: utility actions anchor not found')
      if (code.includes('LED STAGE MANAGEMENT')) return null

      const entry = [
        anchor,
        '              <button type="button" className="tbtn compact" title="B안 · MASTER/RX 실시간 관리" onClick={() => { window.location.href = \'/?workspace=management\' }}>',
        '                🎛 LED STAGE MANAGEMENT',
        '              </button>',
      ].join('\n')

      return { code: code.replace(anchor, entry), map: null }
    },
  }
}
