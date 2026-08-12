export function premiereSingleTrackOverwritePlugin() {
  return {
    name: 'premiere-single-track-overwrite',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      const replaceStrict = (from, to, label) => {
        if (!out.includes(from)) throw new Error(`single track overwrite: ${label} anchor not found`)
        out = out.replace(from, to)
      }

      // One costume/part is one physical relay track. There is no layered compositing,
      // so a newly placed block owns its time range and removes older blocks that overlap it.
      const helperAnchor = '  const onDropPreset = (e, costumeId, partId) => {'
      const helpers = [
        '  const blocksOverlap = (a, b) => {',
        '    const EPS = 0.000001;',
        '    const aEnd = a.start + a.dur;',
        '    const bEnd = b.start + b.dur;',
        '    return a.start < bEnd - EPS && b.start < aEnd - EPS;',
        '  };',
        '',
        '  const overwriteTrackWithBlock = (list, incoming) => {',
        '    const kept = list.filter((b) => {',
        '      if (b.id === incoming.id) return false;',
        '      if (b.costumeId !== incoming.costumeId || b.partId !== incoming.partId) return true;',
        '      return !blocksOverlap(b, incoming);',
        '    });',
        '    return [...kept, incoming];',
        '  };',
        '',
        '  const resolveOverwriteForBlockId = (list, blockId) => {',
        '    const incoming = list.find((b) => b.id === blockId);',
        '    if (!incoming) return list;',
        '    return overwriteTrackWithBlock(list, incoming);',
        '  };',
        '',
      ].join('\n')
      replaceStrict(helperAnchor, helpers + helperAnchor, 'overwrite helpers')

      // Dragging a preset from the effect bin onto an occupied time range overwrites the old block.
      replaceStrict(
        '    setBlocks((bs) => [...bs, nb]);',
        '    setBlocks((bs) => overwriteTrackWithBlock(bs, nb));',
        'preset drop overwrite'
      )

      // Ctrl+V uses the selected costume and playhead; the pasted block wins on that physical track.
      replaceStrict(
        '    setBlocks((bs) => [...bs, newBlock]);',
        '    setBlocks((bs) => overwriteTrackWithBlock(bs, newBlock));',
        'clipboard paste overwrite'
      )

      // Numeric start/duration edits in the properties panel must obey the same no-layer rule.
      replaceStrict(
        '    setBlocks((bs) => bs.map((b) => (b.id === selectedBlockId ? { ...b, ...patch } : b)));',
        '    setBlocks((bs) => {\n      const next = bs.map((b) => (b.id === selectedBlockId ? { ...b, ...patch } : b));\n      return resolveOverwriteForBlockId(next, selectedBlockId);\n    });',
        'property edit overwrite'
      )

      // Whole-stage insertion may create one new block per track. Apply overwrite track-by-track.
      replaceStrict(
        '    setBlocks((bs) => [...bs, ...nbs]);',
        '    setBlocks((bs) => nbs.reduce((next, incoming) => overwriteTrackWithBlock(next, incoming), bs));',
        'master all-on overwrite'
      )

      // While dragging/resizing, allow the preview to cross another block. On mouse-up, commit
      // the Premiere-style overwrite so the selected block remains and older overlapping blocks vanish.
      const oldUp = [
        '    const up = () => {',
        '      dragRef.current = null;',
        '      setSnapGuide(null);',
        '      window.removeEventListener("mousemove", move);',
        '      window.removeEventListener("mouseup", up);',
        '      window.removeEventListener("keydown", shiftDown);',
        '      window.removeEventListener("keyup", shiftUp);',
        '    };',
      ].join('\n')
      const newUp = [
        '    const up = () => {',
        '      const finishedId = dragRef.current?.id;',
        '      if (finishedId) {',
        '        setBlocks((bs) => resolveOverwriteForBlockId(bs, finishedId));',
        '      }',
        '      dragRef.current = null;',
        '      setSnapGuide(null);',
        '      window.removeEventListener("mousemove", move);',
        '      window.removeEventListener("mouseup", up);',
        '      window.removeEventListener("keydown", shiftDown);',
        '      window.removeEventListener("keyup", shiftUp);',
        '    };',
      ].join('\n')
      replaceStrict(oldUp, newUp, 'drag mouseup overwrite')

      if (!out.includes('overwriteTrackWithBlock') || !out.includes('resolveOverwriteForBlockId')) {
        throw new Error('single track overwrite: build assertion failed')
      }

      return { code: out, map: null }
    },
  }
}
