export function managementMenuPlugin() {
  return {
    name: 'management-workspace-switcher',
    enforce: 'pre',
    transform(code, id) {
      const isEditor = id.includes('src/App.jsx') && !id.includes('ManagementApp.jsx')
      const isManagement = id.includes('src/ManagementApp.jsx')
      if (!isEditor && !isManagement) return null
      if (code.includes('workspaceQuickNav')) return null

      const headerAnchor = '<header className="toolbar">'
      const headerStart = code.indexOf(headerAnchor)
      if (headerStart < 0) throw new Error('management workspace switcher: toolbar anchor not found')
      const headerEnd = code.indexOf('</header>', headerStart)
      if (headerEnd < 0) throw new Error('management workspace switcher: toolbar close anchor not found')

      const nav = isManagement
        ? [
            '        <nav className="workspaceQuickNav" aria-label="워크스페이스 전환">',
            '          <button type="button" onClick={() => { window.location.href = \'/\' }}>EDITOR</button>',
            '          <button type="button" className="active" aria-current="page">MANAGEMENT</button>',
            '        </nav>',
          ].join('\n')
        : [
            '        <nav className="workspaceQuickNav" aria-label="워크스페이스 전환">',
            '          <button type="button" className="active" aria-current="page">EDITOR</button>',
            '          <button type="button" onClick={() => { window.location.href = \'/?workspace=management\' }}>MANAGEMENT</button>',
            '        </nav>',
          ].join('\n')

      const next = code.slice(0, headerEnd) + nav + '\n      ' + code.slice(headerEnd)
      return { code: next, map: null }
    },
  }
}
