import { editorFrameAudioScrubPlugin as baseEditorFrameAudioScrubPlugin } from './editorFrameAudioScrubPlugin.js'

export function editorFrameAudioScrubPrePlugin() {
  const base = baseEditorFrameAudioScrubPlugin()
  return {
    ...base,
    name: 'editor-frame-audio-scrub-pre',
    enforce: 'pre',
    transform(code, id, ...rest) {
      if (!id.includes('src/App.jsx')) return null

      // Some existing pre-plugins rewrite play() before this plugin runs. Feed the base
      // transform a throwaway compatibility marker so its optional playback-cleanup
      // anchor cannot abort the build, then inject that cleanup into the real play()
      // function generically after the frame-scrub transform succeeds.
      const compat = [
        '/* __FRAME_SCRUB_PLAY_COMPAT__',
        '  const play = async () => {',
        '    const mediaEl = getMediaEl();',
        '*/',
        '',
      ].join('\n')

      const result = base.transform.call(this, compat + code, id, ...rest)
      if (!result) return result
      let out = typeof result === 'string' ? result : result.code

      out = out.replace(/\/\* __FRAME_SCRUB_PLAY_COMPAT__[\s\S]*?\*\/\n?/, '')

      const playAnchor = '  const play = async () => {'
      if (!out.includes(playAnchor)) throw new Error('frame audio scrub pre: real play() anchor not found')
      if (!out.includes('  const play = async () => {\n    stopScrubVoice(false);')) {
        out = out.replace(
          playAnchor,
          playAnchor + '\n    stopScrubVoice(false);\n    scrubLastFrameRef.current = null;'
        )
      }

      if (typeof result === 'string') return out
      return { ...result, code: out }
    },
  }
}
