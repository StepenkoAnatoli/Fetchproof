// Canonical JSON, hashing, and the record shapes built on them.
//
// Extracted from release-validator.mjs on 2026-09-20. This is the primitive every other
// validator reuses - fi-validator, the three conformance libraries, path-authority - and
// the one place duplication has already cost this repository: three Python runners each
// carried their own copy of this algorithm, two drifted, and the same document hashed to
// two different SHA-256s. One implementation is the entire point.
//
// A record may be FLAT or NESTED ({ envelope, payload }). metaOf/payloadOf/nestedRecord
// are the only readers that know which, so nothing above them has to.
import crypto from 'node:crypto';
/**
 * Canonical JSON: recursively sorted object keys, authored array order.
 *
 * An unpaired UTF-16 surrogate, in a key or a value, is refused: the canonical-serialization
 * spec (2026-09-16, rule 3) rejects it, and the Python runners always did. JSON.stringify
 * escaped it as "\ud800" and this hashed it, so the same vector PASSED here and was refused
 * in Python (Arena break test 5, 2026-09-28).
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${canonicalString(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  if (typeof value === 'string') return canonicalString(value);
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('undefined is not canonical JSON');
  return encoded;
}

function canonicalString(text) {
  if (!text.isWellFormed()) throw new Error('unpaired surrogate is not canonical JSON');
  return JSON.stringify(text);
}

/**
 * Canonical equality: two values are the same if their canonical bytes are.
 *
 * Lived in the schema block until 2026-09-20 and is used well outside it - the
 * predecessor check in release-validator.mjs compares hash lists with it. Moving it here
 * is not tidying: leaving it in schema.mjs left that caller referencing a function that
 * no longer existed, which is how the split first went red.
 */
export function same(a, b) { return canonicalJson(a) === canonicalJson(b); }

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function payloadHash(payload) {
  return sha256(canonicalJson(payload));
}

export function metaOf(record) { return record?.envelope && typeof record.envelope === 'object' ? record.envelope : record; }
export function payloadOf(record) { return record?.payload; }
export function nestedRecord(record) { return Boolean(record?.envelope && typeof record.envelope === 'object'); }
export function recordHash(record) {
  if (nestedRecord(record)) {
    const envelope = { ...record.envelope };
    delete envelope.recordHash;
    return sha256(canonicalJson({ envelope, payload: record.payload }));
  }
  const flat = { ...record };
  delete flat.recordHash;
  return sha256(canonicalJson(flat));
}

// Qualification-ledger hashing deliberately excludes fields that are either
// derived from the hash (chainHash) or contain the signature over it. This is
// the byte-level rule used by the append protocol and keeps verification
// deterministic across runtimes.
export function qualificationRecordHash(record) {
  const unsigned = { ...record };
  delete unsigned.recordHash;
  delete unsigned.chainHash;
  delete unsigned.signature;
  return sha256(canonicalJson(unsigned));
}

export function qualificationChainHash(record) {
  return sha256(`benchmark-ledger-chain-v1\0${record.recordHash}\0${record.prevChainHash}\0${record.physicalSequence}`);
}
