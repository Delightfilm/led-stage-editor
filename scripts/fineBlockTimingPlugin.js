export function fineBlockTimingPlugin() {
  return {
    name: 'fine-block-timing-10ms',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('src/nrf24CompressedCodegen.js')) {
        if (!code.includes('const EVENT_TICK_MS = 20;')) {
          throw new Error('fine timing: nRF24 20ms tick anchor not found')
        }
        return {
          code: code.replace('const EVENT_TICK_MS = 20;', 'const EVENT_TICK_MS = 10;'),
          map: null,
        }
      }

      if (!id.includes('src/App.jsx')) return null
      let out = code

      const replaceStrict = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`fine timing: ${label} anchor not found`)
        out = out.replace(from, to)
      }

      const replaceAllStrict = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`fine timing: ${label} anchor not found`)
        out = out.replaceAll(from, to)
      }

      // 10ms is the editor/export resolution. Only SOLID cues get the 10ms minimum;
      // animated effects keep their previous 200ms minimum.
      replaceStrict(
        '  const dur = Math.max(0.2, Math.min(30, Number(raw?.dur) || 2));',
        '  const minDur = type === "solid" ? 0.01 : 0.2;\n  const dur = Math.max(minDur, Math.min(30, Number(raw?.dur) || 2));',
        'custom preset minimum duration'
      )
      replaceStrict(
        '    dur: Math.round(dur * 20) / 20,',
        '    dur: Math.round(dur * 100) / 100,',
        'custom preset duration precision'
      )
      replaceStrict(
        '    ...(isFinite(start) && start >= 0 ? { start: Math.round(start * 20) / 20 } : {}),',
        '    ...(isFinite(start) && start >= 0 ? { start: Math.round(start * 100) / 100 } : {}),',
        'custom preset start precision'
      )
      replaceStrict(
        '2. color는 #RRGGBB, dur는 초(0.2~30). brightness 필드는 절대 넣지 마세요.',
        '2. color는 #RRGGBB, dur는 초(solid는 0.01~30, 나머지 효과는 0.2~30). brightness 필드는 절대 넣지 마세요.',
        'Gemini duration guidance'
      )

      replaceStrict(
        'const bakeOnOffFrames = (partBlocks, stepMs = 20) => {',
        'const bakeOnOffFrames = (partBlocks, stepMs = 10) => {',
        'bake default tick'
      )
      replaceAllStrict('bakeOnOffFrames(withStart, 20)', 'bakeOnOffFrames(withStart, 10)', 'AI bake tick')
      replaceAllStrict('bakeOnOffFrames(sorted, 20)', 'bakeOnOffFrames(sorted, 10)', 'legacy export bake tick')
      replaceAllStrict('bakeOnOffFrames(partBlocks, 20)', 'bakeOnOffFrames(partBlocks, 10)', 'nRF24 live bake tick')
      replaceStrict(
        '    const maxTick = Math.round(maxTimeMs / 20);',
        '    const maxTick = Math.round(maxTimeMs / 10);',
        'nRF24 storage estimate tick'
      )

      replaceStrict(
        '    const dur = Math.max(0.2, Math.min(duration - t, Number(preset?.dur) || 2));',
        '    const minDur = resolvedType === "solid" ? 0.01 : 0.2;\n    const dur = Math.max(minDur, Math.min(duration - t, Number(preset?.dur) || 2));',
        'drop minimum duration'
      )
      replaceStrict(
        '      start: Math.round(t * 20) / 20,\n      dur: Math.round(dur * 20) / 20,',
        '      start: Math.round(t * 100) / 100,\n      dur: Math.round(dur * 100) / 100,',
        'drop 10ms precision'
      )

      replaceStrict(
        '        return bs.map((b) => {\n          if (b.id !== d.id) return b;\n\n          if (d.mode === "move") {',
        '        return bs.map((b) => {\n          if (b.id !== d.id) return b;\n          const minDur = b.type === "solid" ? 0.01 : 0.2;\n\n          if (d.mode === "move") {',
        'drag minimum helper'
      )
      replaceAllStrict('d.s0 + d.d0 - 0.2', 'd.s0 + d.d0 - minDur', 'left resize minimum')
      replaceAllStrict('Math.max(0.2, Math.min(duration - d.s0, d.d0 + dt))', 'Math.max(minDur, Math.min(duration - d.s0, d.d0 + dt))', 'right resize minimum')
      replaceAllStrict('Math.max(0.2, Math.min(duration - d.s0, snappedEnd - d.s0))', 'Math.max(minDur, Math.min(duration - d.s0, snappedEnd - d.s0))', 'snapped resize minimum')
      replaceAllStrict('start: Math.round(t * 20) / 20, dur: 2', 'start: Math.round(t * 100) / 100, dur: 2', 'all-on 10ms start precision')

      // Ctrl+V helper is inserted by premiereEditingWorkflowPlugin before this plugin runs.
      replaceStrict(
        '      dur: Math.max(0.02, Math.min(copied.block.dur, room)),',
        '      dur: Math.max(copied.block.type === "solid" ? 0.01 : 0.2, Math.min(copied.block.dur, room)),',
        'paste minimum duration'
      )

      // Razor cuts can create a 10ms solid segment, while non-solid effects keep the old guard.
      replaceStrict(
        '  const MIN_CUT_SEG = 0.1; // 이보다 짧은 조각은 만들지 않음(초)\n  const splitBlockAt = (block, t) => {\n    const segStart = block.start;\n    const segEnd = block.start + block.dur;\n    if (t <= segStart + MIN_CUT_SEG || t >= segEnd - MIN_CUT_SEG) return null;\n    const left = { ...block, dur: Math.round((t - segStart) * 20) / 20 };\n    const right = { ...block, id: uid(), start: Math.round(t * 20) / 20, dur: Math.round((segEnd - t) * 20) / 20 };',
        '  const splitBlockAt = (block, t) => {\n    const segStart = block.start;\n    const segEnd = block.start + block.dur;\n    const minCutSeg = block.type === "solid" ? 0.005 : 0.1;\n    if (t <= segStart + minCutSeg || t >= segEnd - minCutSeg) return null;\n    const left = { ...block, dur: Math.round((t - segStart) * 100) / 100 };\n    const right = { ...block, id: uid(), start: Math.round(t * 100) / 100, dur: Math.round((segEnd - t) * 100) / 100 };',
        'razor 10ms precision'
      )

      replaceStrict(
        '                          title={`${b.label || EFFECTS[b.type].name} · ${fmtTime(b.start)}부터 ${b.dur.toFixed(1)}초`}',
        '                          title={`${b.label || EFFECTS[b.type].name} · ${fmtTime(b.start)}부터 ${b.dur.toFixed(2)}초`}',
        'block title precision'
      )
      replaceStrict(
        '                    <input type="number" step={0.1} min={0} value={selectedBlock.start.toFixed(1)}',
        '                    <input type="number" step={0.01} min={0} value={selectedBlock.start.toFixed(2)}',
        'start numeric precision'
      )
      replaceStrict(
        '                    <input type="number" step={0.1} min={0.2} value={selectedBlock.dur.toFixed(1)}\n                      onChange={(e) => patchBlock({ dur: Math.max(0.2, +e.target.value) })} />',
        '                    <input type="number" step={0.01} min={selectedBlock.type === "solid" ? 0.01 : 0.2} value={selectedBlock.dur.toFixed(2)}\n                      onChange={(e) => patchBlock({ dur: Math.max(selectedBlock.type === "solid" ? 0.01 : 0.2, +e.target.value) })} />',
        'duration numeric precision'
      )

      const warningAnchor = '                <button className="dangerBtn" onClick={deleteBlock}>🗑 이 효과 블록 삭제 (Delete 키)</button>'
      replaceStrict(
        warningAnchor,
        '                {selectedBlock.type === "solid" && selectedBlock.dur < 0.15 && (\n                  <p className="relayTimingWarning">⚠ 0.15초보다 짧은 켜짐 블록은 기계식 릴레이에서 실제 접점 동작이 보장되지 않고, 반복 사용하면 릴레이 수명이 줄 수 있어요. 0.01초는 편집/출력 가능하지만 하드웨어 권장값은 아닙니다.</p>\n                )}\n\n' + warningAnchor,
        'relay timing warning UI'
      )

      replaceStrict(
        '.dangerBtn {',
        '.relayTimingWarning { margin: 0; padding: 8px 9px; border: 1px solid #765C2D; border-radius: 8px; background: #2A2113; color: #FFD98A; font-size: 11px; line-height: 1.45; }\n\n.dangerBtn {',
        'relay timing warning CSS'
      )

      if (!out.includes('min={selectedBlock.type === "solid" ? 0.01 : 0.2}') ||
          !out.includes('bakeOnOffFrames(partBlocks, 10)') ||
          !out.includes('relayTimingWarning')) {
        throw new Error('fine timing: build assertions failed')
      }

      return { code: out, map: null }
    },
  }
}
