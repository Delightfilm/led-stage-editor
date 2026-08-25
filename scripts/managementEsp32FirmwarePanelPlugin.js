export function managementEsp32FirmwarePanelPlugin() {
  return {
    name: 'management-esp32-firmware-panel',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const importAnchor = "import { buildManagementFirmwareBundle } from './managementProjectFirmware.js'"
      const espImport = "import { buildManagementEsp32FirmwareBundle } from './managementEsp32Firmware.js'"
      if (!out.includes(espImport)) {
        if (!out.includes(importAnchor)) throw new Error('ESP32 firmware panel: firmware import anchor not found')
        out = out.replace(importAnchor, importAnchor + '\n' + espImport)
      }

      const stateAnchor = "  const [showFirmware, setShowFirmware] = useState(false)"
      if (!out.includes('const [showEsp32Firmware, setShowEsp32Firmware]')) {
        if (!out.includes(stateAnchor)) throw new Error('ESP32 firmware panel: state anchor not found')
        out = out.replace(
          stateAnchor,
          stateAnchor + "\n  const [showEsp32Firmware, setShowEsp32Firmware] = useState(false)\n  const [esp32FirmwareTarget, setEsp32FirmwareTarget] = useState('master')"
        )
      }

      const helperAnchor = "  const firmwareBundle = useMemo(() => {"
      if (!out.includes('const esp32FirmwareBundle = useMemo')) {
        if (!out.includes(helperAnchor)) throw new Error('ESP32 firmware panel: helper anchor not found')
        const helpers = [
          "  const esp32FirmwareBundle = useMemo(() => {",
          "    try {",
          "      return buildManagementEsp32FirmwareBundle({ costumes, blocks })",
          "    } catch (error) {",
          "      console.error('ESP32 firmware generation failed', error)",
          "      const message = error?.message || 'ESP32 firmware generation failed'",
          "      return {",
          "        master: { filename: 'ESP32_Master_ESP_NOW_ERROR.txt', code: `// ESP32 firmware generation error\\n// ${message}` },",
          "        receivers: [],",
          "        receiverCount: 0,",
          "        showDurationMs: 0,",
          "        previewSafeLimitMs: 0,",
          "        error: message,",
          "      }",
          "    }",
          "  }, [costumes, blocks])",
          "  const esp32FirmwareItems = useMemo(() => ([",
          "    { key: 'master', label: 'ESP32 MASTER', filename: esp32FirmwareBundle.master.filename, code: esp32FirmwareBundle.master.code },",
          "    ...esp32FirmwareBundle.receivers.map((rx) => ({ key: `rx${rx.receiverId}`, label: `ESP32 RX${rx.receiverId}`, filename: rx.filename, code: rx.code })),",
          "  ]), [esp32FirmwareBundle])",
          "  const selectedEsp32Firmware = esp32FirmwareItems.find((item) => item.key === esp32FirmwareTarget) || esp32FirmwareItems[0]",
          "",
          "  const copyEsp32Firmware = async () => {",
          "    if (!selectedEsp32Firmware?.code) return",
          "    try {",
          "      await navigator.clipboard.writeText(selectedEsp32Firmware.code)",
          "      showToast(`${selectedEsp32Firmware.filename} 전체 코드를 복사했어요.`)",
          "    } catch {",
          "      showToast('ESP32 코드 복사에 실패했어요. 코드 창에서 직접 복사해 주세요.')",
          "    }",
          "  }",
          "",
          "  const downloadEsp32Firmware = () => {",
          "    if (!selectedEsp32Firmware?.code) return",
          "    const blob = new Blob([selectedEsp32Firmware.code], { type: 'text/x-arduino' })",
          "    const url = URL.createObjectURL(blob)",
          "    const a = document.createElement('a')",
          "    a.href = url",
          "    a.download = selectedEsp32Firmware.filename",
          "    a.click()",
          "    URL.revokeObjectURL(url)",
          "  }",
          "",
        ].join('\n')
        out = out.replace(helperAnchor, helpers + helperAnchor)
      }

      const toolbarAnchor = "        <button className=\"tbtn compact\" onClick={() => setShowFirmware(true)}>⚙ A/B 펌웨어</button>"
      if (!out.includes('⚡ ESP32 코드')) {
        if (!out.includes(toolbarAnchor)) throw new Error('ESP32 firmware panel: A/B toolbar anchor not found')
        out = out.replace(
          toolbarAnchor,
          toolbarAnchor + "\n        <button className=\"tbtn compact\" onClick={() => setShowEsp32Firmware(true)}>⚡ ESP32 코드</button>"
        )
      }

      const modalAnchor = "      {showFirmware && ("
      if (!out.includes('ESP-NOW 시험용 펌웨어</h2>')) {
        if (!out.includes(modalAnchor)) throw new Error('ESP32 firmware panel: modal anchor not found')
        const modal = [
          "      {showEsp32Firmware && (",
          "        <div className=\"modalBack\" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowEsp32Firmware(false) }}>",
          "          <div className=\"authModal\" style={{ width: 'min(960px, 94vw)', maxHeight: '88vh', gridTemplateRows: 'auto auto auto 1fr' }}>",
          "            <div className=\"modalHead\">",
          "              <div>",
          "                <span>ESP32 / ESP-NOW</span>",
          "                <h2>ESP-NOW 시험용 펌웨어</h2>",
          "              </div>",
          "              <button onClick={() => setShowEsp32Firmware(false)}>✕</button>",
          "            </div>",
          "            <p>",
          "              {esp32FirmwareBundle.error ? <>ESP32 펌웨어 생성 오류: <b>{esp32FirmwareBundle.error}</b></> : <>",
          "                기존 UNO+nRF24 A/B 펌웨어는 그대로 유지됩니다. 이 메뉴는 ESP32 배송 후 병행 시험을 위한 별도 코드입니다. ",
          "                MASTER는 USB Web Serial + 1602 I2C LCD + GPIO27 START + ESP-NOW를 사용하고, RX는 프로젝트 타임라인을 로컬로 실행합니다. ",
          "                현장 검증 전에는 기존 nRF24 코드를 지우지 마세요.",
          "              </>}",
          "            </p>",
          "            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>",
          "              {esp32FirmwareItems.map((item) => (",
          "                <button key={item.key} className={esp32FirmwareTarget === item.key ? 'authPrimary' : 'tbtn'} style={{ height: 32 }} onClick={() => setEsp32FirmwareTarget(item.key)}>{item.label}</button>",
          "              ))}",
          "              <span style={{ flex: 1 }} />",
          "              <button className=\"tbtn\" style={{ height: 32 }} onClick={copyEsp32Firmware}>📋 복사</button>",
          "              <button className=\"authPrimary\" style={{ height: 32, padding: '0 12px' }} onClick={downloadEsp32Firmware}>⬇ .ino 저장</button>",
          "            </div>",
          "            <div style={{ minHeight: 0, overflow: 'auto', border: '1px solid #303743', borderRadius: 5, background: '#080b0f' }}>",
          "              <div style={{ position: 'sticky', top: 0, padding: '7px 10px', background: '#12161c', borderBottom: '1px solid #303743', color: '#9aa5b5', fontSize: 10 }}>{selectedEsp32Firmware?.filename}</div>",
          "              <pre style={{ margin: 0, padding: 10, fontSize: 10, lineHeight: 1.45, whiteSpace: 'pre', color: '#d2d8e2' }}><code>{selectedEsp32Firmware?.code}</code></pre>",
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
