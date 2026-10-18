// archive.mjs - ONE container format (ADR-0019).
//
// ZIP with deflate (store when deflating would only grow the payload), written by hand
// because the kit has no dependencies and cannot shell out to a `zip` binary that may
// not exist on one of the two machines ADR-0010 exists for.
//
// It knows the container and nothing else. What goes inside a bundle is lib/audit.mjs's.

import zlib from 'node:zlib';
import { writeText, writeBytes, ensureDir } from './core.mjs';
import path from 'node:path';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * An archive must not be able to unpack outside the folder it is opened into, and the
 * writer changes no name it is handed: a name it cannot store as given is refused.
 * A backslash used to be translated into a separator, which stored `a\\b.md` as `a/b.md`
 * - a directory invented out of a name - while the package manifest still declared the
 * original (Arena break test 10, 2026-09-28). Every caller passes `/`-separated names.
 */
export function entryName(name) {
  const value = String(name);
  if (!value) throw new Error('archive entry has no name');
  if (value.includes('\\')) throw new Error(`archive entry "${value}" contains a backslash - use / to separate folders`);
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) throw new Error(`archive entry "${value}" is not a relative path`);
  if (value.split('/').includes('..')) throw new Error(`archive entry "${value}" climbs out of the archive`);
  return value;
}

/**
 * What one ZIP (without ZIP64) can carry. The bounds exclude 0xFFFF and 0xFFFFFFFF: a reader,
 * this kit's among them (artifact-zip.mjs), takes those values as the ZIP64 sentinels, so an
 * archive written with them is one the kit could not read back (#348).
 */
const MAX_ENTRIES = 0xfffe;
const MAX_NAME_BYTES = 0xffff;
const MAX_U32 = 0xfffffffe;

/** An entry's payload as bytes: a string as UTF-8, a Buffer or Uint8Array as it is, nothing else. */
function entryData(entry) {
  if (typeof entry.data === 'string') return Buffer.from(entry.data, 'utf8');
  if (entry.data instanceof Uint8Array) return Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
  throw new Error(`archive entry "${entry.name}" data must be a string or bytes, not ${entry.data === null ? 'null' : typeof entry.data}`);
}

function dosTime(date) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

/**
 * `buildZip(entries)` -> bytes. Pure: the same entries produce byte-identical archives,
 * so re-zipping is free and idempotent.
 */
export function buildZip(entries, { date = new Date(1980, 0, 1, 0, 0, 0) } = {}) {
  if (!Array.isArray(entries) || !entries.length) {
    throw new Error('refusing to write an archive with no entries - a valid ZIP holding nothing is a successful-looking way to lose work');
  }
  // What the format cannot carry is refused by name, not as a raw ERR_OUT_OF_RANGE from a
  // header write after minutes of work (#348): the count before any entry is hashed or
  // deflated, a name or payload size before its own entry is, and the offset and directory
  // as soon as they reach the bound.
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`refusing to write an archive of ${entries.length} entries - a ZIP without ZIP64 holds at most ${MAX_ENTRIES}`);
  }
  const { time, day } = dosTime(date);
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entryName(entry.name), 'utf8');
    if (name.length > MAX_NAME_BYTES) throw new Error(`archive entry name is ${name.length} bytes - a ZIP entry name holds at most ${MAX_NAME_BYTES}`);
    const raw = entryData(entry);
    if (raw.length > MAX_U32) throw new Error(`archive entry "${entry.name}" is ${raw.length} bytes - a ZIP without ZIP64 holds at most ${MAX_U32} per entry`);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const store = deflated.length >= raw.length;
    const data = store ? raw : deflated;
    const method = store ? 0 : 8;
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // Names are UTF-8 (APPNOTE 4.4.4, bit 11).
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(day, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += local.length + name.length + data.length;
    if (offset > MAX_U32) throw new Error(`refusing to write an archive past ${MAX_U32} bytes - a ZIP without ZIP64 cannot address it`);
  }

  const directory = Buffer.concat(central);
  if (directory.length > MAX_U32) throw new Error(`refusing to write a central directory of ${directory.length} bytes - a ZIP without ZIP64 holds at most ${MAX_U32}`);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, directory, end]);
}

export function writeZip(file, entries, options = {}) {
  const bytes = buildZip(entries, options);
  ensureDir(path.dirname(file));
  // Whole or not at all (ADR-0079). The audit bundle is a file a person keeps, and it is
  // several hundred KB: a killed process or a full disk must not leave a truncated one
  // where a good one was (found 2026-09-28, break-test).
  writeBytes(file, bytes);
  return { file, bytes: bytes.length, entries: entries.length };
}

export { writeText };
