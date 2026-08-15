export function workspaceUiPolishPlugin() {
  return {
    name: 'workspace-ui-polish-loader',
    enforce: 'pre',
    transform(code, id) {
      const isEditor = id.includes('src/App.jsx') && !id.includes('ManagementApp.jsx')
      const isManagement = id.includes('src/ManagementApp.jsx')
      if (!isEditor && !isManagement) return null
      if (code.includes("./workspacePolish.css")) return null

      const firstImport = code.match(/^import[^\n]+\n/)
      if (!firstImport) throw new Error('workspace ui polish: import anchor not found')
      const next = code.replace(firstImport[0], firstImport[0] + "import './workspacePolish.css'\n")
      return { code: next, map: null }
    },
  }
}
