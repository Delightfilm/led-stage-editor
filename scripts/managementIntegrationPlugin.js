export function managementIntegrationPlugin() {
  return {
    name: 'management-integration',
    enforce: 'pre',
    transform(code, id) {
      let out = code

      if (id.includes('src/ManagementApp.jsx')) {
        out = out.replace(
          "import './App.css'",
          "import './index.css'\nimport './ManagementApp.css'",
        )

        const rootAnchor = '  return (\n    <div className="app">'
        if (!out.includes(rootAnchor)) throw new Error('management integration: app root anchor not found')
        out = out.replace(
          rootAnchor,
          rootAnchor + `\n      <button type="button" onClick={() => { window.location.href = '/' }} style={{ position: 'fixed', left: 10, top: 10, zIndex: 250, height: 30, padding: '0 10px', border: '1px solid #3a4556', borderRadius: 6, background: '#151b24', color: '#dbe5f2', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>← EDITOR</button>`
        )
      }

      if (id.includes('src/nrf24ManagementCodegen.js')) {
        out = out.replace(
          'import { buildNrf24ReceiverSketch as buildProductionReceiverSketch } from "./nrf24Pipe1Codegen.js";',
          'import { buildNrf24ReceiverSketch as buildProductionReceiverSketch } from "./nrf24ManagementPipe1BaseCodegen.js";'
        )
      }

      if (id.includes('src/nrf24ManagementPipe1BaseCodegen.js')) {
        out = out.replace(
          'import { buildNrf24ReceiverSketch as buildCompressedReceiverSketch } from "./nrf24CompressedCodegen.js";',
          'import { buildNrf24ReceiverSketch as buildCompressedReceiverSketch } from "./nrf24ManagementCompressedCodegen.js";'
        )
      }

      return out === code ? null : { code: out, map: null }
    },
  }
}
