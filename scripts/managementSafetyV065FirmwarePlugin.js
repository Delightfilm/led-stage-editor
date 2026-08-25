const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`v0.6.5 firmware: ${label} anchor not found`)
  return source.replace(from, to)
}

export function managementSafetyV065FirmwarePlugin() {
  return {
    name: 'management-safety-v065-firmware',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/managementProjectFirmware.js')) return null
      let out = code

      const v064Import = 'import { applyResilientJoinMasterV064, applyResilientJoinReceiverV064 } from "./managementResilientJoinV064.js";'
      const v065Import = 'import { applySafetyMasterV065, applySafetyReceiverV065 } from "./managementSafetyV065.js";'
      if (!out.includes(v064Import)) throw new Error('v0.6.5 firmware: v0.6.4 import missing')
      if (!out.includes(v065Import)) out = out.replace(v064Import, `${v064Import}\n${v065Import}`)

      if (!out.includes('const hashBundleV065 =')) {
        const anchor = 'export function buildManagementFirmwareBundle'
        if (!out.includes(anchor)) throw new Error('v0.6.5 firmware: bundle helper anchor missing')
        const helper = `const hashBundleV065 = (receiverHashes, showDurationMs, receiverCount) => {
  let hash = 0x811c9dc5
  const feed = (value) => {
    const s = String(value)
    for (let i = 0; i < s.length; i += 1) {
      hash ^= s.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    hash ^= 0xff
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  feed('LSM-V065')
  feed(showDurationMs)
  feed(receiverCount)
  receiverHashes.forEach(feed)
  return hash >>> 0
}

`
        out = out.replace(anchor, helper + anchor)
      }

      out = replaceRequired(
        out,
        `    const rawParts = Array.isArray(costume.parts) && costume.parts.length
      ? costume.parts
      : [{ id: \`fallback-\${index}\`, name: "EL 와이어", pin: 4 }];`,
        `    const rawParts = Array.isArray(costume.parts) && costume.parts.length
      ? costume.parts
      : [{ id: \`fallback-\${index}\`, name: "EL 와이어", pin: 4 }];
    const relayPins = rawParts.map((part) => Number(part.pin));
    if (relayPins.some((pin) => !Number.isInteger(pin) || pin < 2 || pin > 8)) throw new Error(\`RX\${index + 1}: relay pin must be UNO D2-D8 (D0/D1 Serial, D9-D13 nRF24 reserved).\`);
    if (new Set(relayPins).size !== relayPins.length) throw new Error(\`RX\${index + 1}: duplicate relay pin detected.\`);`,
        'relay pin validation'
      )

      out = replaceRequired(
        out,
        '      on = Math.floor(local * Math.max(0.01, Number(block.speed) || 5) * 2) % 2 === 0;',
        '      on = Math.floor(local * Math.min(RELAY_SAFE_HZ, Math.max(0.01, Number(block.speed) || 5)) * 2) % 2 === 0;',
        'relay strobe clamp'
      )

      const receiverCountAnchor = '  const receiverCount = Math.max(1, receivers.length || 1);'
      out = replaceRequired(out, receiverCountAnchor, `${receiverCountAnchor}\n  const bundleHash = hashBundleV065(receiverHashes, showDurationMs, receiverCount);`, 'bundle hash')

      const masterCall = '  masterCode = applyResilientJoinMasterV064(masterCode);'
      out = replaceRequired(out, masterCall, `${masterCall}\n  masterCode = applySafetyMasterV065(masterCode, bundleHash);`, 'master safety wrapper')

      const rxExpr = 'applyResilientJoinReceiverV064(applyV063FailClosedReceiver(applyStableAClockReceiverV063(hardenStageReceiverFirmware(buildNrf24ManagementReceiverSketch({ ...rx, showHash: receiverHashes[index] || 0 })))))'
      if (!out.includes(`    code: ${rxExpr}, `)) throw new Error('v0.6.5 firmware: v0.6.4 RX expression missing')
      out = out.replace(`    code: ${rxExpr}, `, `    code: applySafetyReceiverV065(${rxExpr}), `)

      const hashAnchor = '  feed("mgmt-resilient-join-v064");'
      out = replaceRequired(out, hashAnchor, `${hashAnchor}\n  feed("mgmt-safety-v065");`, 'receiver hash marker')

      out = replaceRequired(
        out,
        '    receiverHashes,\n    showDurationMs,',
        `    receiverHashes,
    bundleHash,
    bundleHashHex: bundleHash.toString(16).padStart(8, '0').toUpperCase(),
    showDurationMs,`,
        'bundle return'
      )

      return { code: out, map: null }
    },
  }
}
