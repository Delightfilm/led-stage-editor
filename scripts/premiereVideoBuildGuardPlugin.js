export function premiereVideoBuildGuardPlugin() {
  return {
    name: 'premiere-video-build-guard',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      if (!code.includes('🎬 미디어')) {
        throw new Error('Premiere video transform missing: media toolbar button')
      }
      return null
    },
  }
}
