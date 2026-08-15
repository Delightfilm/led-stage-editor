export function managementMenuPlugin() {
  return {
    name: 'management-workspace-switcher',
    enforce: 'pre',
    transform(code, id) {
      const isEditor = id.includes('src/App.jsx') && !id.includes('ManagementApp.jsx')
      const isManagement = id.includes('src/ManagementApp.jsx')
      if (!isEditor && !isManagement) return null
      if (code.includes('workspaceQuickNav')) return null

      const anchor = '    <div className="app">'
      if (!code.includes(anchor)) throw new Error('management workspace switcher: app root anchor not found')

      const nav = isManagement
        ? [
            anchor,
            '      <nav className="workspaceQuickNav" aria-label="워크스페이스 전환">',
            '        <button type="button" onClick={() => { window.location.href = \'/\' }}>EDITOR</button>',
            '        <button type="button" className="active" aria-current="page">MANAGEMENT</button>',
            '      </nav>',
          ].join('\n')
        : [
            anchor,
            '      <nav className="workspaceQuickNav" aria-label="워크스페이스 전환">',
            '        <button type="button" className="active" aria-current="page">EDITOR</button>',
            '        <button type="button" onClick={() => { window.location.href = \'/?workspace=management\' }}>MANAGEMENT</button>',
            '      </nav>',
          ].join('\n')

      return { code: code.replace(anchor, nav), map: null }
    },
  }
}
