export function formationMemorySidebarPlugin() {
  return {
    name: 'formation-memory-sidebar',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const replaceStrict = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`formation memory: ${label} anchor not found`)
        out = out.replace(from, to)
      }

      const stageClose = [
        '          </div>',
        '        </section>',
        '        <input ref={fileInputRef}',
      ].join('\n')

      const memorySidebar = [
        '          </div>',
        '          <aside className="formationMemory">',
        '            <div className="formationMemoryTitle">대형 메모리</div>',
        '            <div className="formationMemoryList">',
        '              {orderedFormations.length === 0 ? (',
        '                <div className="formationMemoryEmpty">재생헤드 위치에서<br/><b>현재 위치 저장</b>을 누르면<br/>대형 1부터 생성됩니다.</div>',
        '              ) : orderedFormations.map((f, i) => (',
        '                <button key={f.id} type="button" className="formationMemoryItem"',
        '                  onClick={() => { setFormationDraft(null); seek(Number(f.time)); }}',
        '                  onDoubleClick={() => { setFormationDraft(normalizeFormation(f.positions)); showToast(`🎭 대형 ${i + 1}을 편집 상태로 불러왔어요.`); }}',
        '                  title={`클릭: ${fmtTime(Number(f.time))}로 이동 · 더블클릭: 배치 편집`}>',
        '                  <b>대형 {i + 1}</b>',
        '                  <span>{fmtTime(Number(f.time))}</span>',
        '                </button>',
        '              ))}',
        '            </div>',
        '          </aside>',
        '        </section>',
        '        <input ref={fileInputRef}',
      ].join('\n')

      replaceStrict(stageClose, memorySidebar, 'sidebar insert')

      const cssAnchor = '.toast {'
      const css = [
        '/* formation memory sidebar */',
        '.formationStage{margin-right:142px}',
        '.formationMemory{position:absolute;right:0;top:37px;bottom:0;width:142px;z-index:10;display:flex;flex-direction:column;border-left:1px solid rgba(255,255,255,.08);background:#0d1320}',
        '.formationMemoryTitle{flex:0 0 27px;display:flex;align-items:center;padding:0 9px;border-bottom:1px solid rgba(255,255,255,.06);color:#aebad2;font-size:9px;font-weight:800;letter-spacing:.2px}',
        '.formationMemoryList{flex:1;overflow-y:auto;padding:6px;display:flex;flex-direction:column;gap:5px}',
        '.formationMemoryItem{display:flex;align-items:center;justify-content:space-between;gap:6px;min-height:28px;padding:5px 7px;border:1px solid #2d3850;border-radius:6px;background:#151c2b;color:#dfe7f8;cursor:pointer;text-align:left}',
        '.formationMemoryItem:hover{border-color:#5a7897;background:#1a2536}.formationMemoryItem b{font-size:9px;white-space:nowrap}.formationMemoryItem span{font-size:8px;color:#7f8da8;font-variant-numeric:tabular-nums;white-space:nowrap}',
        '.formationMemoryEmpty{padding:10px 4px;color:#65728c;font-size:8px;line-height:1.55;text-align:center}.formationMemoryEmpty b{color:#9daac1}',
        '@media(max-width:900px){.formationStage{margin-right:104px}.formationMemory{width:104px}.formationMemoryItem{padding:4px 5px}.formationMemoryItem span{display:none}}',
        '',
      ].join('\n')
      replaceStrict(cssAnchor, css + cssAnchor, 'css')

      if (!out.includes('className="formationMemory"') || !out.includes('대형 {i + 1}')) {
        throw new Error('formation memory: build assertions failed')
      }
      return { code: out, map: null }
    },
  }
}
