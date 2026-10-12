'use strict';
// Heuristic binary detection: NUL byte, or >30% non-text bytes in the sample.
function looksBinary(buf) {
  if (!buf || buf.length === 0) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  let nonText = 0;
  for (const b of sample) {
    if (b === 0) return true;
    // allow printable ASCII + common whitespace + UTF-8 continuation bytes
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) nonText++;
  }
  return nonText / sample.length > 0.30;
}
module.exports = { looksBinary };
