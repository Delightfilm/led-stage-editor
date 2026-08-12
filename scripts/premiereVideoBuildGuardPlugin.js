export function premiereVideoBuildGuardPlugin() {
  return {
    name: 'premiere-video-build-guard',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null

      const required = [
        ['🎬 미디어', 'media toolbar button'],
        ['const [videoInfo, setVideoInfo]', 'video state'],
        ['const onMediaFile = async', 'video loader'],
        ['className="programPanel"', 'program monitor'],
        ['startPlayheadScrub', 'frame scrub'],
      ]

      const missing = required.filter(([needle]) => !code.includes(needle))
      if (missing.length) {
        throw new Error(
          'Premiere video transform missing: ' + missing.map(([, label]) => label).join(', ')
        )
      }

      return null
    },
  }
}
