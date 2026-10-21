// Path containment.
//
// Extracted from release-validator.mjs on 2026-09-20. Security-sensitive: a registry names
// its own record paths and can arrive from another machine with a corpus, so without this
// a manifest could point anywhere. Containment is checked BEFORE the read and again
// against realpath - sanitising a name afterwards does nothing about a file that has
// already been read from outside the project.
import fs from 'node:fs';
import path from 'node:path';
export function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function safePath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) || /^[A-Za-z]:[\\/]/.test(relativePath)) throw new Error(`absolute or empty path is not allowed: ${relativePath}`);
  const resolved = path.resolve(root, relativePath);
  if (!inside(root, resolved)) throw new Error(`path escapes root: ${relativePath}`);
  const rootReal = fs.realpathSync(root);
  let probe = resolved;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (!inside(rootReal, fs.realpathSync(probe))) throw new Error(`path traverses a symlink outside root: ${relativePath}`);
  return resolved;
}
