// artifact-zip.mjs - reading a ZIP that somebody else wrote.
//
// `lib/archive.mjs` WRITES archives this kit produced and trusts every byte, because it
// chose them. This module is the opposite job: an artifact arrives from a runner, a
// download, a colleague, or an attacker, and nothing in it may be believed before it is
// checked. The two are deliberately separate files - a writer that also parses hostile
// input grows a trust boundary in the middle of itself.
//
// THE ORDER OF OPERATIONS IS THE SECURITY PROPERTY.
//
// Every structural refusal is decided from the CENTRAL DIRECTORY, before one byte is
// inflated: names, duplicates, case collisions, entry count, declared uncompressed total,
// and per-entry compression ratio. A zip bomb is refused by reading its table of
// contents, which costs nothing. Each entry's LOCAL HEADER is read before inflation too, and
// must agree with the directory on what an extractor takes from it (audit F05): the name,
// the method, encryption, the name's encoding, and - unless a data descriptor defers them
// - the CRC-32 and sizes. A streaming extractor reads only local headers, so a package
// whose two headers disagree is two packages, depending on the tool that opens it.
//
// The CRC-32 of each body is checked when it is read. It proves nothing against whoever
// wrote the archive - the manifest's SHA-256 does that - but an ordinary extractor checks
// it and refuses the entry, so a package that passed here with a wrong one would strand
// its recipient at extraction.
//
// The central directory is also attacker-controlled, so it is never the only defence:
// `inflateRawSync` is called with `maxOutputLength`, which makes the ceiling the runtime's
// to enforce rather than a number this file compared against a field the attacker wrote.
// A declared size that lies produces a refusal from zlib rather than a full expansion.
//
// NOTHING HERE TOUCHES THE FILESYSTEM. Entries are returned as buffers. Materialising a
// package onto disk is the validator's decision, into a private temp directory it made,
// after this module has already said the container is safe.

import zlib from 'node:zlib';

/**
 * Conservative ceilings, exported so tests can drive the refusal paths with small
 * fixtures instead of building a real 2 GB bomb.
 */
export const ZIP_LIMITS = Object.freeze({
  /** Entries in one package. A research corpus is dozens of files, not thousands. */
  maxEntries: 5_000,
  /** Total declared uncompressed bytes across the package. */
  maxTotalBytes: 512 * 1024 * 1024,
  /** One entry's uncompressed bytes. */
  maxEntryBytes: 128 * 1024 * 1024,
  /**
   * Compression ratio that makes an entry suspicious, applied only above a floor.
   *
   * Without the floor this rejects honest files: 4 KB of repeated markdown table
   * padding compresses past 200:1 and is not an attack. The floor is what makes the
   * ratio mean "this expands to something large" rather than "this compressed well".
   */
  maxRatio: 200,
  ratioFloorBytes: 1024 * 1024,
  /** A ZIP entry name longer than this is refused before it reaches path logic. */
  maxNameLength: 1024,
});

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** ZIP64 sentinels. This reader does not implement ZIP64 and says so rather than guessing. */
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

export class ZipError extends Error {
  constructor(code, message, entry = null) {
    super(message);
    this.code = code;
    this.entry = entry;
  }
}

function fail(code, message, entry = null) {
  throw new ZipError(code, message, entry);
}

// ---------------------------------------------------------------- entry names

/**
 * The name rules, applied to the RAW bytes of the entry name as stored.
 *
 * Deliberately not `path.normalize` or `path.resolve`. Those answer "what does this mean
 * on the host I am running on", and the host is the wrong authority: a name is either
 * inside the archive by its own text or it is refused. Normalising first would let
 * `a/../../b` become `../b` and then be judged, when the honest answer is that an entry
 * containing `..` at all has no business in a research artifact.
 */
export function checkEntryName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, code: 'ZIP-PATH', detail: 'an entry has an empty name' };
  }
  if (name.length > ZIP_LIMITS.maxNameLength) {
    return { ok: false, code: 'ZIP-PATH', detail: `entry name is ${name.length} characters, over the ${ZIP_LIMITS.maxNameLength} limit` };
  }
  // The escape is deliberate. A literal NUL in source is invisible in every editor,
  // every diff and every review, so the one check whose job is to notice an invisible
  // byte must not itself depend on one having been typed correctly.
  if (name.indexOf('\u0000') !== -1) {
    return { ok: false, code: 'ZIP-PATH', detail: 'entry name contains a NUL byte' };
  }
  if (name.includes('\\')) {
    // A backslash is a path separator on the machine this is most likely to be opened on,
    // so an entry carrying one means two different things on two platforms. Refused
    // rather than translated: a name that means different things is not a name.
    return { ok: false, code: 'ZIP-PATH', detail: `entry "${name}" contains a backslash` };
  }
  if (/[\r\n]/.test(name)) {
    return { ok: false, code: 'ZIP-PATH', detail: 'entry name contains a line break' };
  }
  if (name.startsWith('/')) {
    return { ok: false, code: 'ZIP-PATH', detail: `entry "${name}" is an absolute path` };
  }
  if (/^[A-Za-z]:/.test(name)) {
    return { ok: false, code: 'ZIP-PATH', detail: `entry "${name}" carries a drive letter` };
  }
  if (name.split('/').includes('..')) {
    return { ok: false, code: 'ZIP-PATH', detail: `entry "${name}" climbs out of the archive` };
  }
  if (name.split('/').includes('.')) {
    return { ok: false, code: 'ZIP-PATH', detail: `entry "${name}" contains a "." segment` };
  }
  // Names another platform reads as a different name (independent audit 2026-11-04, F03).
  // Each was judged here by its spelling and written elsewhere by its meaning:
  // `research//BRIEF.md` is `research/BRIEF.md` to `path.join` and to Python's zipfile, so a
  // second brief validated as another file and extracted onto the reviewed one. Refused, not
  // translated, for the backslash's reason above (ADR-0032).
  const segments = name.split('/');
  if (segments.includes('')) {
    return { ok: false, code: 'ZIP-PATH', detail: `entry "${name}" has an empty segment, which extractors drop, so it lands on another entry's path` };
  }
  const banned = /[<>:"|?*\u0001-\u001f]/.exec(name);
  if (banned) {
    return {
      ok: false,
      code: 'ZIP-PATH',
      detail: `entry "${name}" contains ${JSON.stringify(banned[0])}, which Windows does not allow in a name: an extractor there writes another (Python's zipfile writes "_", so GATE?OFF lands as GATE_OFF), and ":" opens a stream of another file`,
    };
  }
  for (const segment of segments) {
    if (/[. ]$/.test(segment)) {
      return { ok: false, code: 'ZIP-PATH', detail: `entry "${name}" has a segment ending in a dot or a space, which Windows drops: "${segment}" is "${segment.replace(/[. ]+$/, '')}" there` };
    }
    if (DEVICE_NAME.test(segment)) {
      return { ok: false, code: 'ZIP-PATH', detail: `entry "${name}" is named for a Windows device ("${segment}"), which a write there reaches instead of a file` };
    }
    if (SHORT_NAME.test(segment)) {
      return { ok: false, code: 'ZIP-PATH', detail: `entry "${name}" is shaped like a Windows short name ("${segment}"), which on a volume that makes them opens the file already holding that short name` };
    }
  }
  return { ok: true };
}

/** CON, PRN, AUX, NUL, COM0-9 and LPT0-9 (and COM/LPT with a superscript 1-3), with any extension. */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(?: *\..*)?$/i;
/** An 8.3 alias as Windows generates one: `DISCOV~1.MD`, `PROGRA~1`, `DI8A3F~1`. */
const SHORT_NAME = /^[^.~]{1,6}~[0-9]+(?:\.[^.]{1,3})?$/;

/**
 * The one identity of an entry name: the key under which a filesystem may take two
 * spellings for one file (independent audit 2026-11-04, F03). NFC, then upper- and
 * lower-cased - wider than any one filesystem on purpose: NTFS folds case but not Unicode
 * form, APFS folds both, and the long s upper-cases to S. A key that folds too much refuses
 * an exotic pair of names; one that folds too little lets one entry land on another. Every
 * duplicate, collision and forbidden-path comparison asks it, never the raw spelling.
 */
export function pathKey(name) {
  return String(name).normalize('NFC').toUpperCase().toLowerCase();
}

// ---------------------------------------------------------------- central directory

function findEocd(buf) {
  // The EOCD may be followed by a comment of up to 65,535 bytes, so the signature is
  // searched backwards from the end over that window plus the record itself.
  const minimum = 22;
  if (buf.length < minimum) fail('ZIP-READ', 'file is too small to be a ZIP archive');
  const window = Math.min(buf.length, 65_535 + minimum);
  for (let i = buf.length - minimum; i >= buf.length - window; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  fail('ZIP-READ', 'no end-of-central-directory record: this is not a ZIP archive, or it is truncated');
  return -1;
}

/**
 * Parse the central directory into entry descriptors. Reads metadata only.
 */
export function readCentralDirectory(buf, { limits = ZIP_LIMITS } = {}) {
  const eocd = findEocd(buf);
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  if (totalEntries === U16_MAX || cdSize === U32_MAX || cdOffset === U32_MAX) {
    fail('ZIP-READ', 'this archive uses ZIP64, which this reader does not implement - refusing rather than reading it wrongly');
  }
  if (totalEntries > limits.maxEntries) {
    fail('ZIP-SIZE-LIMIT', `archive declares ${totalEntries} entries, over the ${limits.maxEntries} limit`);
  }
  if (cdOffset + cdSize > buf.length) {
    fail('ZIP-READ', 'the central directory extends past the end of the file');
  }

  const entries = [];
  let at = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== SIG_CENTRAL) {
      fail('ZIP-READ', `central directory entry ${i + 1} is malformed`);
    }
    const versionMadeBy = buf.readUInt16LE(at + 4);
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc32 = buf.readUInt32LE(at + 16);
    const compressedSize = buf.readUInt32LE(at + 20);
    const uncompressedSize = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const externalAttributes = buf.readUInt32LE(at + 38);
    const localOffset = buf.readUInt32LE(at + 42);
    const nameEnd = at + 46 + nameLength;
    if (nameEnd > buf.length) fail('ZIP-READ', `central directory entry ${i + 1} names past the end of the file`);
    const name = buf.toString('utf8', at + 46, nameEnd);

    if (compressedSize === U32_MAX || uncompressedSize === U32_MAX) {
      fail('ZIP-READ', `entry "${name}" uses ZIP64 size fields, which this reader does not implement`);
    }

    entries.push({
      name,
      // The stored bytes, not the decoded name: two different invalid sequences decode to
      // the same replacement character, and an extractor writes the bytes.
      nameBytes: buf.subarray(at + 46, nameEnd),
      flags,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      localOffset,
      versionMadeBy,
      externalAttributes,
      // A trailing slash is the only portable marker of a directory entry.
      isDirectory: name.endsWith('/'),
      // The high byte of versionMadeBy is the source filesystem; 3 is Unix, and only a
      // Unix-made entry carries a mode worth reading. A symlink stores its target as the
      // entry body, so an extractor that treats it as a regular file writes the target
      // string to a file - and one that honours it writes a link pointing anywhere.
      unixMode: (versionMadeBy >> 8) === 3 ? (externalAttributes >>> 16) & 0xffff : null,
    });
    at = nameEnd + extraLength + commentLength;
  }
  return { entries, totalEntries };
}

// ---------------------------------------------------------------- structural refusal

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

/**
 * Judge the container from its table of contents alone. Returns `{ problems }`, and a
 * caller that finds any problem must not inflate anything.
 */
export function inspectEntries(entries, { limits = ZIP_LIMITS } = {}) {
  const problems = [];
  const seen = new Map();          // exact name -> count
  const folded = new Map();        // pathKey of a name -> first exact name that produced it
  const files = new Set();
  const directories = new Set();
  let totalBytes = 0;

  for (const entry of entries) {
    const named = checkEntryName(entry.name.replace(/\/$/, '') || entry.name);
    if (!named.ok) {
      problems.push({ code: named.code, detail: named.detail, path: entry.name });
      continue;
    }

    if (entry.flags & 0x1) {
      problems.push({ code: 'ZIP-SPECIAL-ENTRY', detail: `entry "${entry.name}" is encrypted`, path: entry.name });
      continue;
    }
    if (entry.unixMode !== null) {
      const type = entry.unixMode & S_IFMT;
      // 0 means the mode field was never filled in, which is ordinary for many writers.
      if (type !== 0 && type !== S_IFREG && type !== S_IFDIR) {
        problems.push({
          code: 'ZIP-SPECIAL-ENTRY',
          detail: `entry "${entry.name}" is not a regular file (unix mode 0o${type.toString(8)}) - symlinks and device nodes have no place in a research artifact`,
          path: entry.name,
        });
        continue;
      }
    }
    if (entry.method !== 0 && entry.method !== 8) {
      problems.push({ code: 'ZIP-READ', detail: `entry "${entry.name}" uses compression method ${entry.method}; only store and deflate are supported`, path: entry.name });
      continue;
    }

    if (entry.isDirectory) {
      directories.add(entry.name.replace(/\/$/, ''));
      continue;   // carries no payload and declares no size worth counting
    }

    files.add(entry.name);

    const count = (seen.get(entry.name) ?? 0) + 1;
    seen.set(entry.name, count);
    if (count === 2) {
      problems.push({ code: 'ZIP-DUPLICATE', detail: `"${entry.name}" appears more than once; which one a reader gets is the extractor's choice, not the author's`, path: entry.name });
    }

    // Case collision. Two entries differing only in case are one file on Windows and
    // macOS and two on Linux, so the package means different things on different
    // machines - and the one that wins is whichever was extracted last. The same holds
    // for two Unicode forms of one name (an accent composed or decomposed), which macOS
    // folds and Linux and Windows do not, so the key is pathKey, not the spelling.
    const key = pathKey(entry.name);
    const first = folded.get(key);
    if (first === undefined) folded.set(key, entry.name);
    else if (first !== entry.name) {
      problems.push({
        code: 'ZIP-CASE-COLLISION',
        detail: `"${entry.name}" and "${first}" differ only in case or Unicode form; on a filesystem that folds them one silently overwrites the other`,
        path: entry.name,
      });
    }

    if (entry.uncompressedSize > limits.maxEntryBytes) {
      problems.push({ code: 'ZIP-SIZE-LIMIT', detail: `"${entry.name}" declares ${entry.uncompressedSize} bytes, over the ${limits.maxEntryBytes} per-entry limit`, path: entry.name });
    }
    totalBytes += entry.uncompressedSize;

    if (entry.uncompressedSize >= limits.ratioFloorBytes && entry.compressedSize > 0) {
      const ratio = entry.uncompressedSize / entry.compressedSize;
      if (ratio > limits.maxRatio) {
        problems.push({
          code: 'ZIP-RATIO-LIMIT',
          detail: `"${entry.name}" expands ${Math.round(ratio)}:1 (${entry.compressedSize} to ${entry.uncompressedSize} bytes), over the ${limits.maxRatio}:1 limit`,
          path: entry.name,
        });
      }
    }
  }

  // An archive may not use one path as both a regular file and the directory
  // containing another entry. Otherwise materialization order decides whether mkdir
  // or writeFileSync throws, turning a readable contradictory package into BLOCKED.
  // One path by pathKey, for the reason above: `docs/a` and `docs/A/child.md` are two
  // paths on Linux and a file-folder contradiction on Windows (audit F03).
  const directoryKeys = new Map();   // pathKey -> first exact directory name
  for (const directory of directories) {
    if (!directoryKeys.has(pathKey(directory))) directoryKeys.set(pathKey(directory), directory);
  }
  const fileKeys = new Map();        // pathKey -> first exact file name
  for (const file of files) {
    if (!fileKeys.has(pathKey(file))) fileKeys.set(pathKey(file), file);
  }
  for (const file of files) {
    const directory = directoryKeys.get(pathKey(file));
    if (directory !== undefined) {
      problems.push({
        code: 'ZIP-PATH-COLLISION',
        detail: `file "${file}" is also declared as a directory${directory === file ? '' : `, spelled "${directory}/"`}`,
        path: file,
      });
    }
    let slash = file.indexOf('/');
    while (slash !== -1) {
      const prefix = file.slice(0, slash);
      const parent = fileKeys.get(pathKey(prefix));
      if (parent !== undefined) {
        problems.push({
          code: 'ZIP-PATH-COLLISION',
          detail: `file "${parent}" is also a directory prefix of "${file}"${parent === prefix ? '' : `, spelled "${prefix}"`}`,
          path: file,
        });
      }
      slash = file.indexOf('/', slash + 1);
    }
  }

  if (totalBytes > limits.maxTotalBytes) {
    problems.push({ code: 'ZIP-SIZE-LIMIT', detail: `the package declares ${totalBytes} uncompressed bytes, over the ${limits.maxTotalBytes} limit` });
  }

  return { problems, totalBytes };
}

// ---------------------------------------------------------------- local headers

/** General-purpose flags a local header must share with the directory, and what each means. */
const AGREED_FLAGS = Object.freeze([[0x1, 'encryption'], [0x800, 'the UTF-8 name flag']]);
/** Bit 3: the CRC-32 and sizes follow the body in a data descriptor, and the local fields are zero. */
const DATA_DESCRIPTOR = 0x8;
const hex = (n) => `0x${n.toString(16).padStart(8, '0')}`;

/**
 * Judge each entry's local header against its directory record, still before one byte is
 * inflated. Returns problems in `inspectEntries`'s shape. Only what an extractor reads from
 * a local header must agree: a version, a timestamp or an extra field that differ change
 * nothing an extractor writes, so comparing every field would refuse archives ordinary
 * tools read. With bit 3 set the writer did not know the CRC-32 and sizes when it wrote the
 * local header, so those fields are not compared; the data descriptor holding them is not
 * read (ADR-0200). A body that, at the directory's compressed size, would run past the end
 * of the file is named as that before anything is compared: the directory's own size is then
 * the fault, and the local header's disagreeing with it only follows from it (#318). A local
 * header that gives its sizes as ZIP64 (0xFFFFFFFF, the values in an extra field) with bit 3
 * clear is refused as ZIP64, as the directory's are, and not compared: this reader does not
 * implement ZIP64, and the two headers may well agree.
 */
export function inspectLocalHeaders(buf, entries) {
  const problems = [];
  for (const entry of entries) {
    const at = entry.localOffset;
    if (at + 30 > buf.length || buf.readUInt32LE(at) !== SIG_LOCAL) {
      problems.push({ code: 'ZIP-READ', detail: `entry "${entry.name}" has no local header where the directory says it does`, path: entry.name });
      continue;
    }
    const nameEnd = at + 30 + buf.readUInt16LE(at + 26);
    const start = nameEnd + buf.readUInt16LE(at + 28);
    if (start > buf.length) {
      problems.push({ code: 'ZIP-READ', detail: `entry "${entry.name}" has a local header that runs past the end of the file`, path: entry.name });
      continue;
    }
    if (start + entry.compressedSize > buf.length) {
      problems.push({ code: 'ZIP-READ', detail: `entry "${entry.name}" runs past the end of the file`, path: entry.name });
      continue;
    }
    const flags = buf.readUInt16LE(at + 6);
    if (!(flags & DATA_DESCRIPTOR) && (buf.readUInt32LE(at + 18) === U32_MAX || buf.readUInt32LE(at + 22) === U32_MAX)) {
      problems.push({ code: 'ZIP-READ', detail: `entry "${entry.name}" uses ZIP64 size fields in its local header, which this reader does not implement`, path: entry.name });
      continue;
    }
    const differs = [];
    const localName = buf.subarray(at + 30, nameEnd);
    if (!localName.equals(entry.nameBytes)) differs.push(`the name (${JSON.stringify(localName.toString('utf8'))} there)`);
    const method = buf.readUInt16LE(at + 8);
    if (method !== entry.method) differs.push(`the compression method (${method} there, ${entry.method} in the directory)`);
    for (const [bit, what] of AGREED_FLAGS) {
      if ((flags & bit) !== (entry.flags & bit)) differs.push(what);
    }
    if (!(flags & DATA_DESCRIPTOR)) {
      const crc = buf.readUInt32LE(at + 14);
      const compressed = buf.readUInt32LE(at + 18);
      const uncompressed = buf.readUInt32LE(at + 22);
      if (crc !== entry.crc32) differs.push(`the CRC-32 (${hex(crc)} there, ${hex(entry.crc32)} in the directory)`);
      if (compressed !== entry.compressedSize) differs.push(`the compressed size (${compressed} there, ${entry.compressedSize} in the directory)`);
      if (uncompressed !== entry.uncompressedSize) differs.push(`the uncompressed size (${uncompressed} there, ${entry.uncompressedSize} in the directory)`);
    }
    if (differs.length) {
      problems.push({
        code: 'ZIP-READ',
        detail: `entry "${entry.name}": its local header disagrees with the central directory on ${differs.join(', ')} - an extractor that reads the local header gets another entry than the one listed`,
        path: entry.name,
      });
    }
  }
  return problems;
}

// ---------------------------------------------------------------- reading a body

// `zlib.crc32` is native, but Node added it in 22.2.0, and the kit's runtime checks admit any
// Node 22 (`checkNode`, the doctor's `nodeLine`): on 22.0 and 22.1 every read would throw. So
// the reader carries the table form too, used only where zlib has none (ADR-0200). It is not
// the writer's (`archive.mjs`): the module header keeps the two files apart.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of `body`: zlib's where this Node has it, looked up per call, else the same sum from the table. */
function crc32Of(body) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(body);
  let c = 0xffffffff;
  for (let i = 0; i < body.length; i += 1) c = CRC_TABLE[(c ^ body[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Inflate (or copy) one entry. Never called before `inspectEntries` and `inspectLocalHeaders` have passed. */
export function readEntry(buf, entry, { limits = ZIP_LIMITS } = {}) {
  const at = entry.localOffset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== SIG_LOCAL) {
    fail('ZIP-READ', `entry "${entry.name}" has no local header where the directory says it does`, entry.name);
  }
  const nameLength = buf.readUInt16LE(at + 26);
  const extraLength = buf.readUInt16LE(at + 28);
  const start = at + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buf.length) fail('ZIP-READ', `entry "${entry.name}" runs past the end of the file`, entry.name);

  const raw = buf.subarray(start, end);
  // The ceiling is zlib's to enforce. A central-directory size is written by whoever
  // wrote the archive, so comparing against it after the fact proves nothing about a
  // hostile package; `maxOutputLength` stops the expansion mid-flight instead.
  const ceiling = Math.min(limits.maxEntryBytes, Math.max(entry.uncompressedSize, 1)) + 1;
  let body;
  if (entry.method === 0) {
    body = Buffer.from(raw);
  } else {
    try {
      body = zlib.inflateRawSync(raw, { maxOutputLength: ceiling });
    } catch (err) {
      fail('ZIP-READ', `entry "${entry.name}" could not be decompressed: ${err.message}`, entry.name);
    }
  }
  if (body.length !== entry.uncompressedSize) {
    fail('ZIP-READ', `entry "${entry.name}" inflated to ${body.length} bytes, but the directory declares ${entry.uncompressedSize}`, entry.name);
  }
  const crc = crc32Of(body);
  if (crc !== entry.crc32) {
    fail('ZIP-READ', `entry "${entry.name}" does not match its CRC-32: the directory declares ${hex(entry.crc32)}, its bytes give ${hex(crc)}`, entry.name);
  }
  return body;
}

/**
 * `openZip(buffer)` -> `{ entries, problems, read(name) }`.
 *
 * `problems` being non-empty means the container is unsafe and `read` must not be called.
 * The two are returned together rather than thrown so a validator can report every
 * structural fault in one pass instead of one per run.
 */
export function openZip(buf, { limits = ZIP_LIMITS } = {}) {
  const { entries } = readCentralDirectory(buf, { limits });
  const inspected = inspectEntries(entries, { limits });
  const problems = [...inspected.problems, ...inspectLocalHeaders(buf, entries)];
  const { totalBytes } = inspected;
  const files = entries.filter((e) => !e.isDirectory);
  const byName = new Map(files.map((e) => [e.name, e]));
  return {
    entries: files,
    names: files.map((e) => e.name),
    // Directory entries carry no payload, but a name can still mean something by being a
    // folder: the gate asks `exists(research/GATE_OFF)`, which a folder answers (audit F03).
    directories: entries.filter((e) => e.isDirectory).map((e) => e.name),
    problems,
    totalBytes,
    has: (name) => byName.has(name),
    read(name) {
      const entry = byName.get(name);
      if (!entry) fail('ZIP-READ', `entry "${name}" is not in this archive`, name);
      return readEntry(buf, entry, { limits });
    },
  };
}
