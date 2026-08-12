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

      // One costume/part is one physical relay track. There is no layered compositing.
      // Premiere-style overwrite means the incoming block owns its exact range while the
      // older block is trimmed/split at the incoming boundaries instead of being deleted whole.
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
        '    const EPS = 0.000001;',
        '    const incomingStart = incoming.start;',
        '    const incomingEnd = incoming.start + incoming.dur;',
        '    const next = [];',
        '',
        '    list.forEach((b) => {',
        '      if (b.id === incoming.id) return;',
        '      if (b.costumeId !== incoming.costumeId || b.partId !== incoming.partId) {',
        '        next.push(b);',
        '        return;',
        '      }',
        '',
        '      const blockStart = b.start;',
        '      const blockEnd = b.start + b.dur;',
        '      if (!blocksOverlap(b, incoming)) {',
        '        next.push(b);',
        '        return;',
        '      }',
        '',
        '      // Preserve everything before the incoming block. Its end is EXACTLY the',
        '      // incoming start, so there is no one-frame/one-tick hole.',
        '      const keepLeft = blockStart < incomingStart - EPS;',
        '      if (keepLeft) {',
        '        next.push({ ...b, dur: incomingStart - blockStart });',
        '      }',
        '',
        '      // Preserve everything after the incoming block. If the incoming block cuts',
        '      // through the middle of an older block, create a second right-hand segment.',
        '      const keepRight = blockEnd > incomingEnd + EPS;',
        '      if (keepRight) {',
        '        next.push({',
        '          ...b,',
        '          id: keepLeft ? uid() : b.id,',
        '          start: incomingEnd,',
        '          dur: blockEnd - incomingEnd,',
        '        });',
        '      }',
        '    });',
        '',
        '    next.push(incoming);',
        '    return next;',
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

      // Dragging a preset from the effect bin onto an occupied time range trims/splits the old block.
      replaceStrict(
        '    setBlocks((bs) => [...bs, nb]);',
        '    setBlocks((bs) => overwriteTrackWithBlock(bs, nb));',
        'preset drop overwrite'
      )

      // Ctrl+V uses the selected costume and playhead; the pasted block owns that exact time range.
      replaceStrict(
        '    setBlocks((bs) => [...bs, newBlock]);',
        '    setBlocks((bs) => overwriteTrackWithBlock(bs, newBlock));',
        'clipboard paste overwrite'
      )

      // Numeric start/duration edits in the properties panel obey the same one-track overwrite rule.
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

      // While dragging/resizing, allow the preview to cross another block. On mouse-up, trim/split
      // the older block at the finished selected block boundaries.
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

      if (!out.includes('overwriteTrackWithBlock') || !out.includes('incomingStart - blockStart') || !out.includes('start: incomingEnd')) {
        throw new Error('single track overwrite: build assertion failed')
      }

      return { code: out, map: null }
    },
  }
}
