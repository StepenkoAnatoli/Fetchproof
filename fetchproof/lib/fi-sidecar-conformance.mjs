// Offline cross-language FI sidecar/evidence-manifest schema conformance runner.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonNoDuplicates, validateJsonSchema } from './release-validator.mjs';

export const FI_SCHEMA_CONFORMANCE_PROFILE = 'researcher-fi-schema-conformance-v1';
export const FI_SCHEMA_CONFORMANCE_VERSION = '1.0.0';
const SCHEMA_DIR = fileURLToPath(new URL('../schemas/', import.meta.url));
const SCHEMA_FILE = { sidecar: 'fi-signoff-sidecar.schema.json', manifest: 'fi-evidence-manifest.schema.json' };
const CODE_PRIORITY = ['JSON-DUPLICATE-KEY', 'JSON-PARSE', 'SCHEMA-ADDITIONAL', 'SCHEMA-REQUIRED', 'SCHEMA-ONE-OF', 'SCHEMA-CONST', 'SCHEMA-ENUM', 'SCHEMA-PATTERN', 'SCHEMA-MIN-ITEMS', 'SCHEMA-TYPE'];

function packetError(message) { const error = new Error(`invalid FI schema vector packet: ${message}`); error.code = 'VECTOR-PACKET'; return error; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function segments(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || pointer === '/') throw packetError('patch path must be a non-root JSON pointer');
  return pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}
// A path segment names an OWN member, as in the Python twin: `part in parent` found every
// Object.prototype name, so "/__proto__/polluted" walked into Object.prototype and the set
// polluted it for the whole process, where Python refused the path as absent (review of
// #336, 2026-10-18). The last member is defined, not assigned, so a "__proto__" key is a
// member here as it is in Python, and a set reaches only a container Python would set.
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function isIndex(parent, part) { return /^(?:0|[1-9]\d*)$/.test(part) && Number(part) < parent.length; }
function patch(base, patches) {
  const value = clone(base);
  if (!Array.isArray(patches)) throw packetError('patches must be an array');
  for (const operation of patches) {
    if (!operation || !['set', 'remove'].includes(operation.op)) throw packetError('patch operation must be set or remove');
    const parts = segments(operation.path); let parent = value;
    const absent = () => packetError(`patch path does not exist: ${operation.path}`);
    for (const part of parts.slice(0, -1)) {
      if (Array.isArray(parent) ? !isIndex(parent, part) : !isRecord(parent) || !Object.hasOwn(parent, part)) throw absent();
      parent = parent[part];
    }
    const key = parts.at(-1);
    if (operation.op === 'set') {
      if (Array.isArray(parent)) {
        if (!isIndex(parent, key)) throw absent();
        parent[Number(key)] = clone(operation.value);
      } else if (isRecord(parent)) {
        Object.defineProperty(parent, key, { value: clone(operation.value), enumerable: true, writable: true, configurable: true });
      } else throw absent();
    } else {
      if (Array.isArray(parent) ? !isIndex(parent, key) : !isRecord(parent) || !Object.hasOwn(parent, key)) throw absent();
      Array.isArray(parent) ? parent.splice(Number(key), 1) : delete parent[key];
    }
  }
  return value;
}
function primaryCode(codes) { return CODE_PRIORITY.find((code) => codes.includes(code)) ?? codes[0] ?? 'PASS'; }
function schemaFor(target) { return JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, SCHEMA_FILE[target]), 'utf8')); }

function runVector(vector, documents) {
  if (!vector || !['sidecar', 'manifest'].includes(vector.target) || typeof vector.vectorId !== 'string' || !vector.vectorId || typeof vector.expectedCode !== 'string') throw packetError('every vector needs vectorId, target, and expectedCode');
  let codes;
  try {
    const value = typeof vector.rawDocument === 'string'
      ? parseJsonNoDuplicates(vector.rawDocument)
      : patch(documents[vector.base], vector.patches);
    codes = [...new Set(validateJsonSchema(value, schemaFor(vector.target), { errors: [] }).map((error) => error.code))];
  } catch (error) {
    codes = [String(error.message).includes('duplicate object key') ? 'JSON-DUPLICATE-KEY' : error.code === 'VECTOR-PACKET' ? 'VECTOR-PACKET' : 'JSON-PARSE'];
  }
  const observedCode = primaryCode(codes);
  return { vectorId: vector.vectorId, target: vector.target, expectedCode: vector.expectedCode, observedCode, result: observedCode === vector.expectedCode ? 'PASS' : 'FAIL' };
}

export function loadFiSchemaVectors(file) {
  let raw; let packet;
  try { raw = fs.readFileSync(file); packet = parseJsonNoDuplicates(raw.toString('utf8')); }
  catch (error) { throw packetError(error.message); }
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw packetError('packet must be an object');
  if (packet.packetVersion !== FI_SCHEMA_CONFORMANCE_VERSION || packet.profile !== FI_SCHEMA_CONFORMANCE_PROFILE) throw packetError('packet version or profile is invalid');
  if (packet.schemaIds?.sidecar !== 'fetchproof/fi-signoff-sidecar-v1' || packet.schemaIds?.manifest !== 'fetchproof/fi-evidence-manifest-v1') throw packetError('packet schema IDs are invalid');
  if (!packet.documents || typeof packet.documents !== 'object' || !Array.isArray(packet.vectors) || !packet.vectors.length) throw packetError('documents and a non-empty vector list are required');
  const ids = new Set();
  for (const vector of packet.vectors) {
    if (!vector || typeof vector.vectorId !== 'string' || !vector.vectorId || ids.has(vector.vectorId)) throw packetError('vector IDs must be present and unique');
    ids.add(vector.vectorId);
    if (!['sidecar', 'manifest'].includes(vector.target)) throw packetError('vector target is invalid');
    if (typeof vector.rawDocument !== 'string' && (!Object.hasOwn(packet.documents, vector.base) || !Array.isArray(vector.patches))) throw packetError('non-raw vector needs a declared base and patches');
  }
  Object.defineProperty(packet, '__vectorPacketSha256', { value: crypto.createHash('sha256').update(raw).digest('hex'), enumerable: false });
  return packet;
}

export function runFiSchemaConformance(packet) {
  if (!packet || packet.profile !== FI_SCHEMA_CONFORMANCE_PROFILE || !Array.isArray(packet.vectors)) throw packetError('packet profile or vectors are invalid');
  const vectors = packet.vectors.map((vector) => runVector(vector, packet.documents));
  return { validatorVersion: FI_SCHEMA_CONFORMANCE_VERSION, profile: FI_SCHEMA_CONFORMANCE_PROFILE, vectorPacketSha256: packet.__vectorPacketSha256 ?? null, implementation: { language: 'node', runtime: process.version }, vectorCount: vectors.length, status: vectors.every((row) => row.result === 'PASS') ? 'PASS' : 'FAIL', vectors };
}

export function canonicalReportJson(report) { return `${JSON.stringify(report, null, 2)}\n`; }
