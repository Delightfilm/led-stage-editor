const STATIC_PRINT_RE = /\b(Serial|lcd)\.(print|println)\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
const LEFTOVER_STATIC_PRINT_RE = /\b(?:Serial|lcd)\.(?:print|println)\(\s*"/;

const decodedLength = (literalBody) => {
  try {
    // Decode the C/JS-style escapes used by the generated ASCII status strings.
    return JSON.parse(`"${literalBody}"`).length;
  } catch {
    return literalBody.length;
  }
};

export function optimizeManagementMasterSramV069(source) {
  let converted = 0;
  let estimatedBytes = 0;

  const code = String(source || '').replace(
    STATIC_PRINT_RE,
    (_match, target, method, literalBody) => {
      converted += 1;
      // A normal AVR string literal needs its bytes plus the NUL terminator in SRAM.
      // F() leaves the literal in flash and Print reads it through __FlashStringHelper.
      estimatedBytes += decodedLength(literalBody) + 1;
      return `${target}.${method}(F("${literalBody}"))`;
    }
  );

  if (converted < 10) {
    throw new Error(`v0.6.9 SRAM: only ${converted} static MASTER print strings were converted; generator shape is unexpected`);
  }
  if (LEFTOVER_STATIC_PRINT_RE.test(code)) {
    throw new Error('v0.6.9 SRAM: unoptimized static Serial/LCD print string remains in generated MASTER');
  }

  return [
    `// MASTER SRAM v0.6.9: ${converted} static Serial/LCD literals moved to flash with F().`,
    `// Estimated static SRAM reclaimed: about ${estimatedBytes} bytes (compiler-dependent).`,
    code,
  ].join('\n');
}
