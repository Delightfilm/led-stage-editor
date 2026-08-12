export function disableTutorialPlugin() {
  return {
    name: 'disable-startup-tutorial',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/App.jsx')) return null

      const enabled = '  const [showTutorial, setShowTutorial] = useState(true);'
      const disabled = '  const [showTutorial, setShowTutorial] = useState(false);'

      if (!code.includes(enabled)) return null
      return { code: code.replace(enabled, disabled), map: null }
    },
  }
}
