'use strict';
const fs = require('fs');
const path = require('path');
// Write to a sibling temp file then rename — rename(2) is atomic on POSIX
// within the same directory, so readers never see a half-written file.
//
// Mode preservation: plain writeFileSync keeps an existing file's mode on
// overwrite; tmp+rename replaces the inode, so without this a 0o755 script
// would silently become 0o666 & ~umask (Luna self-edits executable files
// in its own kernel). Copy the target's mode onto the tmp before rename.
// Note: this also replaces symlinks with regular files (writeFileSync wrote
// through them) — no Luna workflow depends on write-through symlinks.
function atomicWriteFileSync(filePath, content) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.luna-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  let oldMode = null;
  try {
    oldMode = fs.statSync(filePath).mode;
  } catch {
    // Target does not exist yet — fresh file gets default mode.
  }
  try {
    fs.writeFileSync(tmp, content);
    if (oldMode !== null) fs.chmodSync(tmp, oldMode);
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}
module.exports = { atomicWriteFileSync };
