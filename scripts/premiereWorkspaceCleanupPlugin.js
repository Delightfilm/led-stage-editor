export function premiereWorkspaceCleanupPlugin() {
  return {
    name: 'premiere-workspace-cleanup',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const replaceStrict = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`workspace cleanup: ${label} anchor not found`)
        out = out.replace(from, to)
      }

      // 1) Cloud autosave: debounce from the LAST edit for 10 seconds.
      replaceStrict(
        '    cloudSaveTimerRef.current = setTimeout(() => saveCloudNow(true), 1500);',
        '    cloudSaveTimerRef.current = setTimeout(() => saveCloudNow(true), 10000);',
        '10 second autosave'
      )
      out = out.replaceAll('약 1.5초 뒤 자동 저장', '약 10초 뒤 자동 저장')

      // 2) Move the full-costume preview strip from the bottom into the exact top-center workspace.
      const footerMarker = '      {/* ── 하단: 전체 의상 무대 미리보기 ── */}'
      const footerStart = out.indexOf(footerMarker)
      if (footerStart < 0) throw new Error('workspace cleanup: costume preview footer marker not found')
      const footerClose = '      </footer>'
      const footerEndStart = out.indexOf(footerClose, footerStart)
      if (footerEndStart < 0) throw new Error('workspace cleanup: costume preview footer close not found')
      const footerEnd = footerEndStart + footerClose.length
      let strip = out.slice(footerStart, footerEnd)
      out = out.slice(0, footerStart) + out.slice(footerEnd)

      const oldStripHead = [
        '        <div className="bottomStripHead">',
        '          <h2>🎭 전체 의상 무대 보기</h2>',
        '          <span className="dim">재생 시 모든 의상이 동시에 빛나요 · 클릭하면 우측 미리보기로 전환</span>',
        '        </div>',
      ].join('\n')
      strip = strip.replace(footerMarker + '\n', '')
      strip = strip.replace(oldStripHead + '\n', '')
      strip = strip
        .replace('      <footer className="bottomStrip">', '        <div className="topCostumeStrip" title="전체 의상 미리보기">')
        .replace('      </footer>', '        </div>')
        .replaceAll('bottomStripScroll', 'topCostumeStripScroll')
        .replaceAll('bottomCostumeCard', 'topCostumeCard')
        .replaceAll('bottomCostumeLabel', 'topCostumeLabel')
        .replaceAll('bottomAddCard', 'topAddCard')

      // 3) Hide account/media/save/open/export/help inside one top-left accordion menu.
      const utilityStartMarker = '        <div className="toolGroup right">'
      const utilityStart = out.indexOf(utilityStartMarker)
      if (utilityStart < 0) throw new Error('workspace cleanup: utility group not found')
      const inputAnchor = '        <input ref={fileInputRef}'
      const inputPosBeforeRemoval = out.indexOf(inputAnchor, utilityStart)
      if (inputPosBeforeRemoval < 0) throw new Error('workspace cleanup: media input anchor not found')
      const utilityCloseBeforeInput = out.lastIndexOf('        </div>', inputPosBeforeRemoval)
      if (utilityCloseBeforeInput < utilityStart) throw new Error('workspace cleanup: utility group close not found')
      const utilityEnd = utilityCloseBeforeInput + '        </div>'.length
      const utilityBlock = out.slice(utilityStart, utilityEnd)
      const utilityInner = utilityBlock
        .replace(utilityStartMarker, '')
        .replace(/\n        <\/div>\s*$/, '')
        .trim()
      out = out.slice(0, utilityStart) + out.slice(utilityEnd)

      const oldLogo = [
        '        <div className="logo">',
        '          <span className="logoIcon">💡</span>',
        '          <div className="logoTitle">LED 타임라인</div>',
        '        </div>',
      ].join('\n')
      const menu = [
        '        <details className="utilityMenu" onClick={(e) => { if (e.target.closest("button")) e.currentTarget.open = false; }}>',
        '          <summary title="메뉴">☰</summary>',
        '          <div className="utilityDropdown">',
        '            <div className="utilityMenuTitle">💡 LED 타임라인</div>',
        '            <div className="utilityActions">',
        utilityInner.split('\n').map((line) => '              ' + line.trimStart()).join('\n'),
        '            </div>',
        '          </div>',
        '        </details>',
      ].join('\n')
      replaceStrict(oldLogo, menu, 'accordion menu')

      // Place the costume strip immediately before hidden file inputs, still inside the toolbar.
      const inputPos = out.indexOf(inputAnchor)
      if (inputPos < 0) throw new Error('workspace cleanup: final media input anchor not found')
      out = out.slice(0, inputPos) + strip + '\n\n' + out.slice(inputPos)

      // 4) Styling: compact top-left menu + centered costume cards in the user-marked top area.
      const cssAnchor = '.toast {'
      const css = [
        '/* ── compact top workspace / centered costume preview ── */',
        '.toolbar {',
        '  position: relative; min-height: 142px; padding: 8px 10px; gap: 7px;',
        '  align-items: center; overflow: visible;',
        '}',
        '.utilityMenu { position: relative; z-index: 80; flex: none; }',
        '.utilityMenu > summary {',
        '  list-style: none; width: 34px; height: 34px; display: grid; place-items: center;',
        '  border: 1px solid var(--line); border-radius: 8px; background: #171D2C;',
        '  color: #F2F4FA; cursor: pointer; font-size: 18px; font-weight: 800;',
        '}',
        '.utilityMenu > summary::-webkit-details-marker { display: none; }',
        '.utilityMenu[open] > summary { border-color: var(--accent); background: #202842; }',
        '.utilityDropdown {',
        '  position: absolute; left: 0; top: calc(100% + 7px); width: 220px; z-index: 90;',
        '  padding: 10px; border: 1px solid #303A54; border-radius: 10px;',
        '  background: rgba(18,22,33,.98); box-shadow: 0 16px 44px rgba(0,0,0,.58);',
        '}',
        '.utilityMenuTitle { font-size: 12px; font-weight: 800; margin: 1px 2px 9px; color: #FFFFFF; }',
        '.utilityActions { display: grid; gap: 6px; }',
        '.utilityActions .tbtn { width: 100%; text-align: left; justify-content: flex-start; padding: 7px 9px; }',
        '.utilityActions .tip { position: relative; }',
        '.topCostumeStrip {',
        '  position: absolute; left: 50%; top: 7px; transform: translateX(-50%);',
        '  width: min(760px, 48vw); height: 128px; z-index: 2;',
        '  display: flex; align-items: center; padding: 5px 7px;',
        '  border: 1px solid rgba(255,255,255,.055); border-radius: 10px;',
        '  background: rgba(10,13,20,.42); backdrop-filter: blur(3px);',
        '}',
        '.topCostumeStripScroll {',
        '  width: 100%; display: flex; align-items: stretch; justify-content: flex-start;',
        '  gap: 7px; overflow-x: auto; overflow-y: hidden; padding: 1px 2px 3px;',
        '  scrollbar-width: thin;',
        '}',
        '.topCostumeCard {',
        '  flex: 0 0 78px; height: 114px; display: flex; flex-direction: column;',
        '  align-items: center; gap: 2px; padding: 4px 4px 5px;',
        '  border: 1px solid var(--line); border-radius: 8px; color: var(--text);',
        '  background: #121722; transition: .12s; overflow: hidden;',
        '}',
        '.topCostumeCard:hover { border-color: var(--cc); transform: translateY(-1px); }',
        '.topCostumeCard.active { border-color: var(--cc); box-shadow: 0 0 10px color-mix(in srgb, var(--cc) 42%, transparent); }',
        '.topCostumeCard .avatarCompact { width: 100%; height: 84px; min-height: 0; display: block; }',
        '.topCostumeLabel {',
        '  width: 100%; display: flex; align-items: center; justify-content: center;',
        '  gap: 4px; font-size: 10px; font-weight: 700; line-height: 16px; white-space: nowrap;',
        '  overflow: hidden; text-overflow: ellipsis;',
        '}',
        '.topCostumeLabel .swatch { width: 8px; height: 8px; }',
        '.topAddCard {',
        '  flex: 0 0 68px; height: 114px; display: flex; flex-direction: column;',
        '  align-items: center; justify-content: center; gap: 4px;',
        '  border: 1px dashed #39435D; border-radius: 8px; background: #10141F;',
        '  color: var(--dim); font-size: 10.5px;',
        '}',
        '.topAddCard:hover { border-color: var(--accent); color: var(--text); }',
        '.toolbar .transport, .toolbar > .toolGroup { position: relative; z-index: 4; }',
        '@media (max-width: 1180px) {',
        '  .topCostumeStrip { width: 44vw; }',
        '  .topCostumeCard { flex-basis: 72px; }',
        '}',
        '',
      ].join('\n')
      replaceStrict(cssAnchor, css + cssAnchor, 'workspace css')

      if (!out.includes('10000);') || !out.includes('className="utilityMenu"') || !out.includes('className="topCostumeStrip"')) {
        throw new Error('workspace cleanup: build assertions failed')
      }

      return { code: out, map: null }
    },
  }
}
