import { editorFrameAudioScrubPlugin as baseEditorFrameAudioScrubPlugin } from './editorFrameAudioScrubPlugin.js'

export function editorFrameAudioScrubPrePlugin() {
  const base = baseEditorFrameAudioScrubPlugin()
  return {
    ...base,
    name: 'editor-frame-audio-scrub-pre',
    enforce: 'pre',
  }
}
