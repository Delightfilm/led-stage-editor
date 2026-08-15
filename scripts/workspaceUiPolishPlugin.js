export function workspaceUiPolishPlugin() {
  return {
    name: 'workspace-ui-polish-loader',
    enforce: 'pre',
    transform(code, id) {
      const isEditor = id.includes('src/App.jsx') && !id.includes('ManagementApp.jsx')
      const isManagement = id.includes('src/ManagementApp.jsx')
      if (!isEditor && !isManagement) return null

      const firstImport = code.match(/^import[^\n]+\n/)
      if (!firstImport) throw new Error('workspace ui polish: import anchor not found')

      const imports = []
      if (!code.includes("./workspacePolish.css")) imports.push("import './workspacePolish.css'")
      if (!code.includes("./workspaceOverlapFix.css")) imports.push("import './workspaceOverlapFix.css'")
      if (!imports.length) return null

      const next = code.replace(firstImport[0], firstImport[0] + imports.join('\n') + '\n')
      return { code: next, map: null }
    },
  }
}
