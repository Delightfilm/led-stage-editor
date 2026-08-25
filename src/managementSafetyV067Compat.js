// v0.6.7 generator compatibility shim.
// This does not change MASTER behavior. It only normalizes harmless formatting drift
// before the v0.6.5 safety transform consumes the generated C++ source.

export const STATUS_BUNDLE_V067_STRUCTURAL = 'STATUS_BUNDLE_V067_STRUCTURAL'

export function normalizeSafetyMasterInputV067(source) {
  let code = source
  const canonical = `  Serial.print(" ready=" ); Serial.print(readyCount());
  Serial.print('/'); Serial.println(RECEIVER_COUNT);`

  if (code.includes(canonical)) return code

  // Match the semantic STATUS tail rather than one exact whitespace/quote spelling.
  // The v0.6.5 layer will then append FIRMWARE_BUNDLE_HASH to this canonical form.
  const statusTail = /[ \t]*Serial\.print\(" ready="\s*\);\s*Serial\.print\(readyCount\(\)\);\s*\r?\n[ \t]*Serial\.print\((?:'\/'|"\/")\);\s*Serial\.(?:print|println)\(RECEIVER_COUNT\);(?:\s*Serial\.println\(\);)?/

  if (!statusTail.test(code)) {
    throw new Error('v0.6.7 firmware: structural master STATUS ready/count tail not found')
  }

  return code.replace(statusTail, canonical)
}
