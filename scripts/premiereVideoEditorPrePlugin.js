import { premiereVideoEditorPluginV2 } from './premiereVideoEditorPluginV2.js'

export function premiereVideoEditorPrePlugin() {
  const base = premiereVideoEditorPluginV2()
  return {
    ...base,
    name: 'premiere-video-editor-pre',
    enforce: 'pre',
  }
}
