export function defaultTimelineOpenPlugin() {
  return {
    name: 'default-timeline-open',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null

      const anchor = '  const [expanded, setExpanded] = useState({});'
      if (!code.includes(anchor)) {
        throw new Error('default timeline open: expanded state anchor not found')
      }

      const replacement = `${anchor}\n\n  // Newly loaded costumes start expanded so the timeline is immediately visible.\n  // A costume the user manually collapses stays collapsed because its id already exists in the map.\n  useEffect(() => {\n    setExpanded((current) => {\n      let changed = false;\n      const next = { ...current };\n      costumes.forEach((costume) => {\n        if (!(costume.id in next)) {\n          next[costume.id] = true;\n          changed = true;\n        }\n      });\n      return changed ? next : current;\n    });\n  }, [costumes]);`

      const out = code.replace(anchor, replacement)
      if (!out.includes('if (!(costume.id in next))')) {
        throw new Error('default timeline open: build assertion failed')
      }

      return { code: out, map: null }
    },
  }
}
