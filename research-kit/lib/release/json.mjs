// Duplicate-key-safe JSON parsing.
//
// Extracted from release-validator.mjs on 2026-09-20. JSON.parse keeps the LAST duplicate
// key silently; for a hashed record that is the difference between one payload and a
// different payload with the SAME digest, so every validator in this kit parses through
// here instead. It also refuses a UTF-8 BOM, which JSON.parse accepts and hashing does not.
/**
 * The deepest nesting any JSON this kit reads may have (ADR-0083). The reader recurses, so
 * without it a deep document surfaced as "Maximum call stack size exceeded"; and CPython's
 * canonicaliser gives out near 300 levels where Node went on for thousands, so the two
 * conformance runners disagreed on the same packet. 256 is below both; real documents
 * here are a handful of levels deep. `bin/conformance_common.py` enforces the same number.
 */
export const MAX_JSON_DEPTH = 256;

class JsonReader {
  constructor(text) { this.text = String(text); this.index = 0; this.depth = 0; }

  enter() {
    this.depth += 1;
    if (this.depth > MAX_JSON_DEPTH) this.error(`JSON nested deeper than ${MAX_JSON_DEPTH} levels`);
  }

  error(message) { throw new Error(`${message} at byte ${this.index}`); }

  whitespace() {
    while (/[\u0009\u000a\u000d\u0020]/.test(this.text[this.index] ?? '')) this.index += 1;
  }

  value() {
    this.whitespace();
    const char = this.text[this.index];
    if (char === '{') return this.object();
    if (char === '[') return this.array();
    if (char === '"') return this.string();
    if (this.text.startsWith('true', this.index)) { this.index += 4; return true; }
    if (this.text.startsWith('false', this.index)) { this.index += 5; return false; }
    if (this.text.startsWith('null', this.index)) { this.index += 4; return null; }
    const match = this.text.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (match) {
      this.index += match[0].length;
      const number = Number(match[0]);
      if (!Number.isFinite(number)) this.error('non-finite number');
      return number;
    }
    this.error('invalid JSON value');
  }

  string() {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      if (char === '\\') { this.index += 2; continue; }
      if (char === '"') {
        this.index += 1;
        try { return JSON.parse(this.text.slice(start, this.index)); } catch { this.error('invalid JSON string'); }
      }
      if (char < ' ') this.error('control character in JSON string');
      this.index += 1;
    }
    this.error('unterminated JSON string');
  }

  object() {
    this.enter();
    this.index += 1;
    const result = {};
    const keys = new Set();
    this.whitespace();
    if (this.text[this.index] === '}') { this.index += 1; this.depth -= 1; return result; }
    while (this.index < this.text.length) {
      this.whitespace();
      if (this.text[this.index] !== '"') this.error('object key must be a string');
      const key = this.string();
      if (keys.has(key)) this.error(`duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      this.whitespace();
      if (this.text[this.index] !== ':') this.error('missing colon after object key');
      this.index += 1;
      // A "__proto__" key assigned with `=` runs the prototype setter instead of creating a
      // member: the member vanished from the canonical form, its fields became inherited,
      // and Node hashed other bytes than JSON.parse and Python do (#336). Every other name,
      // `constructor` included, is a writable data property and assigns as an own member.
      if (key === '__proto__') Object.defineProperty(result, key, { value: this.value(), enumerable: true, writable: true, configurable: true });
      else result[key] = this.value();
      this.whitespace();
      if (this.text[this.index] === '}') { this.index += 1; this.depth -= 1; return result; }
      if (this.text[this.index] !== ',') this.error('missing comma between object members');
      this.index += 1;
    }
    this.error('unterminated JSON object');
  }

  array() {
    this.enter();
    this.index += 1;
    const result = [];
    this.whitespace();
    if (this.text[this.index] === ']') { this.index += 1; this.depth -= 1; return result; }
    while (this.index < this.text.length) {
      result.push(this.value());
      this.whitespace();
      if (this.text[this.index] === ']') { this.index += 1; this.depth -= 1; return result; }
      if (this.text[this.index] !== ',') this.error('missing comma between array members');
      this.index += 1;
    }
    this.error('unterminated JSON array');
  }

  parse() {
    const result = this.value();
    this.whitespace();
    if (this.index !== this.text.length) this.error('trailing JSON data');
    return result;
  }
}

export function parseJsonNoDuplicates(text) {
  const source = String(text);
  if (source.startsWith('\uFEFF')) throw new Error('UTF-8 BOM is not permitted at byte 0');
  return new JsonReader(source).parse();
}
