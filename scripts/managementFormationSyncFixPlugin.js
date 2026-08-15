export function managementFormationSyncFixPlugin() {
  return {
    name: 'management-formation-sync-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/ManagementApp.jsx')) return null
      let out = code

      const required = (ok, label) => {
        if (!ok) throw new Error(`management formation sync: ${label} anchor not found`)
      }

      // MANAGEMENT may receive the new multi-project envelope. Resolve the EDITOR's
      // currently active project before the sequence/formation normalizer runs.
      const normalizeAnchor = `const normalizeProject = (data) => {
  const legacyBlocks = Array.isArray(data?.blocks) ? data.blocks : []`
      required(out.includes(normalizeAnchor), 'normalize start')
      out = out.replace(normalizeAnchor, `const normalizeProject = (rawData) => {
  const selectedProject = Array.isArray(rawData?.projects) && rawData.projects.length
    ? (rawData.projects.find((project) => project?.id === rawData.activeProjectId) || rawData.projects[0])
    : null
  const data = selectedProject?.data && typeof selectedProject.data === 'object' ? selectedProject.data : rawData
  const legacyBlocks = Array.isArray(data?.blocks) ? data.blocks : []`)

      // Older/partially migrated EDITOR saves can contain seq.formations = [] while the
      // authoritative active formation list is present at top-level `formations`.
      // An empty array must not mask that active-project formation data.
      const formationAnchor = `    formations: Array.isArray(seq?.formations) ? seq.formations : (index === 0 ? legacyFormations : []),`
      required(out.includes(formationAnchor), 'sequence formation mapping')
      out = out.replace(formationAnchor, `    formations: Array.isArray(seq?.formations) && seq.formations.length
      ? seq.formations
      : (((seq?.id === data?.activeSequenceId) || (!data?.activeSequenceId && index === 0)) && legacyFormations.length
        ? legacyFormations
        : (index === 0 ? legacyFormations : [])),`)

      required(out.includes('selectedProject?.data'), 'active project resolver')
      required(out.includes('seq.formations.length'), 'formation fallback')
      return { code: out, map: null }
    },
  }
}
