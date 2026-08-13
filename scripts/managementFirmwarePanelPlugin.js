export function managementFirmwarePanelPlugin() {
  return {
    name: 'management-firmware-panel',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const importAnchor = "import { downloadCloudMedia } from './supabaseMedia.js'"
      const firmwareImport = "import { buildManagementFirmwareBundle } from './managementProjectFirmware.js'"
      if (!out.includes(firmwareImport)) {
        if (!out.includes(importAnchor)) throw new Error('management firmware panel: import anchor not found')
        out = out.replace(importAnchor, importAnchor + '\n' + firmwareImport)
      }

      const stateAnchor = "  const [toast, setToast] = useState(null)"
      if (!out.includes('const [showFirmware, setShowFirmware]')) {
        if (!out.includes(stateAnchor)) throw new Error('management firmware panel: state anchor not found')
        out = out.replace(
          stateAnchor,
          stateAnchor + "\n  const [showFirmware, setShowFirmware] = useState(false)\n  const [firmwareTarget, setFirmwareTarget] = useState('master')"
        )
      }

      const helperAnchor = "  const showToast = (message) => {"
      if (!out.includes('const firmwareBundle = useMemo')) {
        if (!out.includes(helperAnchor)) throw new Error('management firmware panel: helper anchor not found')
        const helpers = [
          "  const firmwareBundle = useMemo(() => {",
          "    try {",
          "      return buildManagementFirmwareBundle({ costumes, blocks })",
          "    } catch (error) {",
          "      console.error('A/B firmware generation failed', error)",
          "      const message = error?.message || 'firmware generation failed'",
          "      return {",
          "        master: { filename: 'EL_Master_Controller_AB_ERROR.txt', code: `// A/B firmware generation error\\n// ${message}` },",
          "        receivers: [],",
          "        receiverHashes: [],",
          "        showDurationMs: 0,",
          "        previewSafeLimitMs: 0,",
          "        receiverCount: 0,",
          "        error: message,",
          "      }",
          "    }",
          "  }, [costumes, blocks])",
          "  const firmwareItems = useMemo(() => ([",
          "    { key: 'master', label: 'MASTER', filename: firmwareBundle.master.filename, code: firmwareBundle.master.code },",
          "    ...firmwareBundle.receivers.map((rx) => ({ key: `rx${rx.receiverId}`, label: `RX${rx.receiverId}`, filename: rx.filename, code: rx.code })),",
          "  ]), [firmwareBundle])",
          "  const selectedFirmware = firmwareItems.find((item) => item.key === firmwareTarget) || firmwareItems[0]",
          "",
          "  const copyFirmware = async () => {",
          "    if (!selectedFirmware?.code) return",
          "    try {",
          "      await navigator.clipboard.writeText(selectedFirmware.code)",
          "      showToast(`${selectedFirmware.filename} 전체 코드를 복사했어요.`)",
          "    } catch {",
          "      showToast('코드 복사에 실패했어요. 코드 창에서 직접 복사해 주세요.')",
          "    }",
          "  }",
          "",
          "  const downloadFirmware = () => {",
          "    if (!selectedFirmware?.code) return",
          "    const blob = new Blob([selectedFirmware.code], { type: 'text/x-arduino' })",
          "    const url = URL.createObjectURL(blob)",
          "    const a = document.createElement('a')",
          "    a.href = url",
          "    a.download = selectedFirmware.filename",
          "    a.click()",
          "    URL.revokeObjectURL(url)",
          "  }",
          "",
        ].join('\n')
        out = out.replace(helperAnchor, helpers + helperAnchor)
      }

      const toolbarAnchor = "        <button className=\"tbtn compact syncBtn\" disabled={syncBusy || !online} onClick={() => syncFromEditor()}>"
      if (!out.includes('A/B 펌웨어')) {
        if (!out.includes(toolbarAnchor)) throw new Error('management firmware panel: toolbar anchor not found')
        out = out.replace(
          toolbarAnchor,
          "        <button className=\"tbtn compact\" onClick={() => setShowFirmware(true)}>⚙ A/B 펌웨어</button>\n" + toolbarAnchor
        )
      }

      const modalAnchor = "      {showAuth && ("
      if (!out.includes('A/B 공용 펌웨어</h2>')) {
        if (!out.includes(modalAnchor)) throw new Error('management firmware panel: modal anchor not found')
        const modal = [
          "      {showFirmware && (",
          "        <div className=\"modalBack\" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowFirmware(false) }}>",
          "          <div className=\"authModal\" style={{ width: 'min(960px, 94vw)', maxHeight: '88vh', gridTemplateRows: 'auto auto auto 1fr' }}>",
          "            <div className=\"modalHead\">",
          "              <div>",
          "                <span>STAGE FIRMWARE</span>",
          "                <h2>A/B 공용 펌웨어</h2>",
          "              </div>",
          "              <button onClick={() => setShowFirmware(false)}>✕</button>",
          "            </div>",
          "            <p>",
          "              {firmwareBundle.error ? <>펌웨어 생성 오류: <b>{firmwareBundle.error}</b></> : <>",
          "                A안은 PC 없이 D2로 0초부터 시작합니다. B안은 PC에서 PREVIEW/ARM_B를 사용하지만, LIVE가 시작된 뒤에는 각 RX의 저장된 타임라인이 로컬 millis()로 독립 진행합니다.",
          "                {' '}PREVIEW 안전 구간은 첫 실제 ON 직전인 <b>{(firmwareBundle.previewSafeLimitMs / 1000).toFixed(3)}초</b>까지입니다.",
          "              </>}",
          "            </p>",
          "            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>",
          "              {firmwareItems.map((item) => (",
          "                <button key={item.key} className={firmwareTarget === item.key ? 'authPrimary' : 'tbtn'} style={{ height: 32 }} onClick={() => setFirmwareTarget(item.key)}>{item.label}</button>",
          "              ))}",
          "              <span style={{ flex: 1 }} />",
          "              <button className=\"tbtn\" style={{ height: 32 }} onClick={copyFirmware}>📋 복사</button>",
          "              <button className=\"authPrimary\" style={{ height: 32, padding: '0 12px' }} onClick={downloadFirmware}>⬇ .ino 저장</button>",
          "            </div>",
          "            <div style={{ minHeight: 0, overflow: 'auto', border: '1px solid #303743', borderRadius: 5, background: '#080b0f' }}>",
          "              <div style={{ position: 'sticky', top: 0, padding: '7px 10px', background: '#12161c', borderBottom: '1px solid #303743', color: '#9aa5b5', fontSize: 10 }}>{selectedFirmware?.filename}</div>",
          "              <pre style={{ margin: 0, padding: 10, fontSize: 10, lineHeight: 1.45, whiteSpace: 'pre', color: '#d2d8e2' }}><code>{selectedFirmware?.code}</code></pre>",
          "            </div>",
          "          </div>",
          "        </div>",
          "      )}",
          "",
          modalAnchor,
        ].join('\n')
        out = out.replace(modalAnchor, modal)
      }

      return { code: out, map: null }
    },
  }
}
