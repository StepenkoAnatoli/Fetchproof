# Researcher benchmark canonicalization conformance vectors

**Status:** normative, fixture-free test specification  
**Profile:** `researcher-benchmark-c14n-v1`  
**Companion contract:** [release canonical serialization and hashing](2026-09-16-researcher-benchmark-release-canonical-serialization.md)

This packet defines small, deterministic vectors that every implementation in every
language must pass before it may produce or verify a benchmark release artifact. The
values are synthetic conformance data; they are not benchmark fixtures, source values,
credentials, or paid requests. A runner must compare bytes and lowercase SHA-256 digests,
not rendered text or language-runtime objects.

## 1. Runner contract

Each vector is identified by an immutable ID. A runner reports one row per vector:

| Field | Required value |
|---|---|
| `vectorId` | ID from this packet (for example `J-01`) |
| `profile` | `researcher-benchmark-c14n-v1` |
| `result` | `PASS` or `FAIL` |
| `canonicalBytesHex` | exact UTF-8 bytes emitted by the implementation, lowercase hex |
| `expectedSha256` | digest from this packet, when the vector is positive |
| `reason` | stable rejection code for a negative vector, otherwise empty |
| `implementation` | language, runtime, and version |

The harness must run in a locale-independent process, use byte length (not character
count), and fail closed on an unknown vector, profile, or rejection code. A positive
vector passes only when both canonical bytes and SHA-256 match. A negative vector passes
only when the input is rejected before hashing. No repair, normalization, sorting of
arrays, or alternate digest encoding is permitted.

Unless a row supplies a byte-hex column, the code-span representation is the exact Unicode
scalar sequence to encode as UTF-8. In the chaining domain, `\0` denotes one literal NUL
byte (not the two characters backslash and zero); LF denotes byte `0a`.

## 2. JSON vectors

Canonical JSON has recursively UTF-16-code-unit-sorted object keys, authored array order,
no insignificant whitespace, UTF-8 without BOM, and the number/string rules in the
companion contract. Hashes in this section cover the canonical JSON bytes **without** a
final LF.

| ID | Source representation (accepted input) | Source bytes (hex) | Required canonical JSON | Canonical bytes (hex) | SHA-256 |
|---|---|---|---|---|---|
| `J-01` | `{"z":1,"é":"é","arr":[3,1],"a":{"b":2,"A":3}}` | `7b227a223a312c22c3a9223a22c3a9222c22617272223a5b332c315d2c2261223a7b2262223a322c2241223a337d7d` | `{"a":{"A":3,"b":2},"arr":[3,1],"z":1,"é":"é"}` | `7b2261223a7b2241223a332c2262223a327d2c22617272223a5b332c315d2c227a223a312c22c3a9223a22c3a9227d` | `b03001ebaa040bc785eea0b3e20241c0ea81a7b2461a9b6d59ee1fd16c1386ab` |
| `J-02` | `{ "zero": 0.000, "text": "a\né", "n": 1.2300 }` | `7b20227a65726f223a20302e3030302c202274657874223a2022615c6ec3a9222c20226e223a20312e32333030207d` | `{"n":1.23,"text":"a\né","zero":0}` | `7b226e223a312e32332c2274657874223a22615c6ec3a9222c227a65726f223a307d` | `ff761fbd69c8e49ccc0879f10e1d2a6f63ced5881b1bbcb458dfb9892be862e9` |
| `J-03` | `["b","a",0,1.2]` | `5b2262222c2261222c302c312e325d` | `["b","a",0,1.2]` | `5b2262222c2261222c302c312e325d` | `66f4ac8caeb2351886f9413c7020e6ca69bbd8c0f5aa64c4ca2d99d1ad578173` |

`J-01` proves recursive key sorting and preservation of non-ASCII UTF-8. `J-02`
proves decimal-zero trimming, escaped LF (`5c6e`), and key sorting. `J-03` proves that
arrays are not reordered.

## 3. Markdown vectors

Markdown is an opaque text body: every byte, including spaces and Unicode composition, is
content. Canonical Markdown uses UTF-8, LF line endings, and exactly one final LF. The
digest covers that final LF. For a Markdown sidecar, the same digest is used as both the
body `contentSha256` and the logical-body `payloadSha256` when those fields are present.

| ID | Required body (visible form) | Bytes (hex) | SHA-256 |
|---|---|---|---|
| `M-01` | `# V` followed by LF, then `x` plus **two trailing spaces**, then LF | `2320560a7820200a` | `f5cdb819023a5704bbb91c7f94edc4fa2ded402da0d0cefee2a1275fb2baad87` |
| `M-02` | NFC scalar sequence `é` followed by LF | `c3a90a` | `edd3a863872a04239eb29ad4bc12fc892b3d4ae57cc7e786a3697816f8e141c2` |
| `M-03` | decomposed scalar sequence `e` + U+0301 followed by LF | `65cc810a` | `f979a211b00b61497349a7c753652a3d173550a368711a9f9f9845e6383db7cb` |

`M-02` and `M-03` must produce different digests; applying NFC/NFD normalization is a
failure even when the rendered Markdown looks identical.

## 4. Manifest vector

Manifest entries are unique POSIX relative paths. Entries are sorted by UTF-16 path
order, independent of discovery order. Entry keys are recursively canonicalized. `mode`
is a four-digit octal string; `byteLength` counts bytes. The two member bodies in this
vector are the synthetic bytes `A LF` and `B LF`.

| ID | Source entry order | Required canonical manifest JSON (no final LF) | manifest SHA-256 |
|---|---|---|---|
| `MF-01` | `b.txt` (`B LF`, mode `0644`), then `A.txt` (`A LF`, mode `0755`) | `{"entries":[{"byteLength":2,"contentSha256":"06f961b802bc46ee168555f066d28f4f0e9afdf3f88174c1ee6f9de004fc30a0","mode":"0755","path":"A.txt","type":"file"},{"byteLength":2,"contentSha256":"c0cde77fa8fef97d476c10aad3d2d54fcc2f336140d073651c2dcccf1e379fd6","mode":"0644","path":"b.txt","type":"file"}],"manifestVersion":"1.0.0","profile":"researcher-benchmark-c14n-v1","root":"qualification/pointers"}` | `9949c19a5ff87ad9b8a4fe1b8bb0900fde6585f7e82cf4e6bbcb3d5966765960` |

The member checks are `sha256(A LF) = 06f961b802bc46ee168555f066d28f4f0e9afdf3f88174c1ee6f9de004fc30a0` and
`sha256(B LF) = c0cde77fa8fef97d476c10aad3d2d54fcc2f336140d073651c2dcccf1e379fd6`.
The stored `.json` manifest representation is the canonical bytes above plus one LF;
that LF is not part of `manifestSha256`. Reordering the source entries must not change
the digest; changing a path, mode, byte length, or member hash must change it.

## 5. JSONL vectors

JSONL is a physical stream. Each line is one canonical JSON value followed by exactly one
LF; physical line order and the final LF are hashed. There are no blank lines, CR bytes,
indentation, or multiline values.

| ID | Required stream | Bytes (hex) | `contentSha256` |
|---|---|---|---|
| `JL-01` | `{"event":"A","sequence":1}` LF `{"event":"B","sequence":2}` LF | `7b226576656e74223a2241222c2273657175656e6365223a317d0a7b226576656e74223a2242222c2273657175656e6365223a327d0a` | `59bfcb61fb13dfebcde2c72fe71d83c7625869bfabee5a8d12f7ce6177052811` |

For ledger chaining, `JL-02` uses the exact domain string
`benchmark-ledger-chain-v1\0<recordHash>\0<prevChainHash>\0<sequence>` with lowercase
hex fields and an ASCII decimal sequence. With `recordHash =` 64 zeroes,
`prevChainHash =` 64 ones, and `sequence = 7`, the UTF-8 bytes hash to
`7b5ade2c13c60943ed526afb5d0b64457151dcb65cf48d5ae08dbb08ff43fc76`.

## 6. Self-excluding hash vectors

For each self-excluding field, parse the complete object, remove only the named field(s),
canonicalize the remaining object, and hash those bytes. Do not remove any other field.
The value is then inserted into the complete object; changing the inserted value without
recomputing is invalid. These vectors use synthetic hashes and a non-verifying signature
marker solely to make omission rules observable.

| ID | Hash domain (canonical bytes, omitted fields shown) | Expected digest |
|---|---|---|
| `S-01` (`payloadSha256`) | payload `{"answer":"yes","count":2}` | `2cf1a5b4302657040464cd1c7eb43ee74652dbecaedc6ab03130bbc45f2a5286` |
| `S-02` (`recordHash`) | record with `recordHash` omitted: `{"envelope":{"payloadSha256":"2cf1a5b4302657040464cd1c7eb43ee74652dbecaedc6ab03130bbc45f2a5286","schema":1},"payload":{"answer":"yes","count":2}}` | `c319a2ea66a5b9e524b83afc48497b3baac5a3a3a9a318bcd0a864c2d41b0166` |
| `S-03` (`pointerHash`) | pointer with `pointerHash` and `signature` omitted: `{"artifactId":"R29-06","state":"ready","targetHash":"abababababababababababababababababababababababababababababababab"}` | `fc66e9345170f612280d71f9c3b2301e29a4ffb1ecf394f77e2f8101f536899c` |
| `S-04` (`genesisHash`) | genesis with `genesisHash` and `signature` omitted: `{"ledger":"qualification","profile":"researcher-benchmark-c14n-v1","version":"1"}` | `51a368ee4c14e051c1abfc5bb6bda1c93819c581943788cf4168d69e129a13d1` |

For `S-02`, the complete record contains the `recordHash` value from the expected digest;
for `S-03` and `S-04`, the complete objects may contain any syntactically valid signature,
but the signature is never in the digest domain. Ed25519 signing, when required by the
release contract, signs the raw 32 digest bytes rather than the hexadecimal text.

## 7. Required rejection vectors

The following inputs must be rejected with the stable reason code shown. A rejected input
must not yield a digest or be silently rewritten.

| ID | Input condition | Reason code |
|---|---|---|
| `N-01` | JSON object contains duplicate key `a` | `json.duplicate-key` |
| `N-02` | JSON number `-0` (including `-0.0`) | `json.negative-zero` |
| `N-03` | JSON exponent (`1e3`) or plus sign (`+1`) | `json.noncanonical-number` |
| `N-04` | UTF-8 BOM, invalid UTF-8, unpaired surrogate, or NUL text byte | `text.invalid-utf8-or-control` |
| `N-05` | Markdown or JSONL contains CR/CRLF, or required final LF is absent/doubled | `text.line-ending` |
| `N-06` | JSONL blank line, indented line, or multiline JSON value | `jsonl.framing` |
| `N-07` | Manifest path is absolute, has drive/UNC prefix, `.`/`..` segment, or duplicates another path | `manifest.path` |
| `N-08` | Manifest entry has filesystem metadata (mtime, inode, owner) or non-four-digit mode | `manifest.unsupported-field` |
| `N-09` | Self-excluding field is included in its own hash, or a required excluded field is omitted from the final object | `hash.self-exclusion` |

## 8. Qualification gate and evidence

The cross-language gate is `C14N-GATE-01`. It is PASS only when every positive vector has
matching bytes and digest, every negative vector has the specified reason, and at least two
independent implementations (for example Node.js and Python) produce identical reports.
The report records implementation versions, profile ID, vector packet hash, and runner
output hash. Any mismatch, unknown rejection reason, locale-dependent output, or missing
vector is a hard failure and blocks R28-R33 promotion. The report is then chained as the
canonical evidence artifact under the qualification-ledger rules.

### Executable qualification-ledger subset

The checked-in synthetic packet is
`fetchproof/conformance/qualification-ledger-vectors.json`. It covers the ledger
payload, record, chain, pointer, genesis, and checkpoint hash domains, plus Ed25519
verification over raw 32-byte digests. It carries public verification keys only; neither
a private key nor a seed is a release artifact.

Run the independent offline implementations against exactly the same packet:

```text
node fetchproof/bin/ledger-conformance.mjs --json
python fetchproof/bin/ledger_conformance.py --json
```

Both reports must be `PASS`, use the same `vectorPacketSha256`, and have byte-for-byte
equal per-vector result rows. Signature input is unpadded base64url and the signed message
is the raw digest bytes, never its hexadecimal rendering. `reportSha256` is SHA-256 over
the canonical report object with that field omitted, so it can be retained as a
self-authenticating qualification-ledger evidence artifact.
