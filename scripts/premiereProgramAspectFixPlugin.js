export function premiereProgramAspectFixPlugin() {
  return {
    name: 'premiere-program-aspect-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const oldViewport = '<div className="programViewport workspaceSized" style={{ "--programH": programHeight + "px", aspectRatio: videoInfo?.width && videoInfo?.height ? (videoInfo.width + " / " + videoInfo.height) : "16 / 9", maxWidth: "100%" }}>'
      const newViewport = '<div className="programViewport workspaceSized" style={{ "--programH": programHeight + "px", "--programAR": videoInfo?.width && videoInfo?.height ? (videoInfo.width / videoInfo.height) : (16 / 9), aspectRatio: videoInfo?.width && videoInfo?.height ? (videoInfo.width + " / " + videoInfo.height) : "16 / 9" }}>'

      if (!out.includes(oldViewport)) {
        throw new Error('program aspect fix: viewport anchor not found')
      }
      out = out.replace(oldViewport, newViewport)

      const oldCss = '.programViewport.workspaceSized { height:var(--programH) !important; max-height:none !important; width:100%; }'
      const newCss = '.programViewport.workspaceSized { width:min(100%, calc(var(--programH) * var(--programAR))); height:auto !important; max-height:var(--programH) !important; aspect-ratio:var(--programAR); margin-left:auto; margin-right:auto; flex:none; }'

      if (!out.includes(oldCss)) {
        throw new Error('program aspect fix: workspace sizing css anchor not found')
      }
      out = out.replace(oldCss, newCss)

      if (!out.includes('"--programAR"') || !out.includes('aspect-ratio:var(--programAR)')) {
        throw new Error('program aspect fix: aspect ratio guard failed')
      }

      return { code: out, map: null }
    },
  }
}
