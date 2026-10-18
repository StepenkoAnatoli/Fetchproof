// The JSON Schema subset the shipped schemas actually use.
//
// Extracted from release-validator.mjs on 2026-09-20. The release contract deliberately
// has no runtime dependency on Ajv or a package manager, so this implements the small,
// deterministic vocabulary the checked-in schemas need - and nothing more, because a
// keyword that is silently unimplemented accepts everything, which is the failure mode
// that matters in a validator.
import { canonicalJson, same } from './canonical.mjs';
export function schemaError(errors, code, message, schemaPath = '') {
  errors.push({ code, message, path: schemaPath || '$' });
}


/** Validate the JSON Schema keywords used by the shipped release schemas. */
export function validateJsonSchema(value, schema, { path: valuePath = '$', errors = [], rootSchema = schema } = {}) {
  if (!schema || typeof schema !== 'object') {
    schemaError(errors, 'SCHEMA-INPUT', 'schema must be an object', valuePath);
    return errors;
  }
  if (schema.$ref) {
    const match = /^#\/\$defs\/([^/]+)$/.exec(schema.$ref);
    if (!match || !rootSchema?.$defs?.[match[1]]) {
      schemaError(errors, 'SCHEMA-REF', `unresolved schema reference ${schema.$ref}`, valuePath);
      return errors;
    }
    return validateJsonSchema(value, rootSchema.$defs[match[1]], { path: valuePath, errors, rootSchema });
  }
  if (schema.allOf) {
    for (const alternative of schema.allOf) validateJsonSchema(value, alternative, { path: valuePath, errors, rootSchema });
  }
  if (schema.if) {
    const conditionErrors = [];
    validateJsonSchema(value, schema.if, { path: valuePath, errors: conditionErrors, rootSchema });
    if (conditionErrors.length === 0 && schema.then) validateJsonSchema(value, schema.then, { path: valuePath, errors, rootSchema });
    if (conditionErrors.length > 0 && schema.else) validateJsonSchema(value, schema.else, { path: valuePath, errors, rootSchema });
  }
  if (schema.oneOf || schema.anyOf) {
    const alternatives = schema.oneOf ?? schema.anyOf;
    const alternativeErrors = alternatives.map((alternative) => {
      const local = [];
      validateJsonSchema(value, alternative, { path: valuePath, errors: local, rootSchema });
      return local;
    });
    const matches = alternativeErrors.filter((local) => local.length === 0);
    const valid = schema.oneOf ? matches.length === 1 : matches.length >= 1;
    if (!valid) {
      if (matches.length === 0) for (const error of alternativeErrors[alternativeErrors.length - 1] ?? []) errors.push(error);
      schemaError(errors, schema.oneOf ? 'SCHEMA-ONE-OF' : 'SCHEMA-ANY-OF', `must match ${schema.oneOf ? 'exactly one' : 'at least one'} schema alternative (matched ${matches.length})`, valuePath);
    }
  }
  if (schema.const !== undefined && !same(value, schema.const)) schemaError(errors, 'SCHEMA-CONST', `must equal ${JSON.stringify(schema.const)}`, valuePath);
  if (schema.enum && !schema.enum.some((candidate) => same(value, candidate))) schemaError(errors, 'SCHEMA-ENUM', `must be one of ${schema.enum.join(', ')}`, valuePath);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = types.some((type) => (
      type === 'null' ? value === null
        : type === 'array' ? Array.isArray(value)
          : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
            : type === 'integer' ? Number.isInteger(value)
              : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
                : type === 'string' ? typeof value === 'string'
                  : type === 'boolean' ? typeof value === 'boolean' : true
    ));
    if (!ok) {
      schemaError(errors, 'SCHEMA-TYPE', `must be ${types.join(' or ')}`, valuePath);
      return errors;
    }
  }
  // Membership is Object.hasOwn, never `in`: `in` answers true for every Object.prototype
  // name, so a `constructor` member passed additionalProperties:false and a record holding
  // only "__proto__" had every required key (#336).
  if (schema.required && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required) if (!Object.hasOwn(value, key)) schemaError(errors, 'SCHEMA-REQUIRED', `missing required property ${key}`, `${valuePath}.${key}`);
  }
  // additionalProperties judges every member `properties` does not list: `false` refuses it,
  // a schema must match it, `true` allows it. Only `false` beside `properties` was applied,
  // so the externalRoots maps two shipped schemas declare as hashes accepted any value (#335).
  const additional = schema.additionalProperties;
  if ((additional === false || (additional && typeof additional === 'object')) && value && typeof value === 'object' && !Array.isArray(value)) {
    const listed = schema.properties ?? {};
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(listed, key)) continue;
      if (additional === false) schemaError(errors, 'SCHEMA-ADDITIONAL', `unknown property ${key}`, `${valuePath}.${key}`);
      else validateJsonSchema(value[key], additional, { path: `${valuePath}.${key}`, errors, rootSchema });
    }
  }
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(schema.properties)) if (Object.hasOwn(value, key)) validateJsonSchema(value[key], child, { path: `${valuePath}.${key}`, errors, rootSchema });
  }
  if (schema.items && Array.isArray(value)) value.forEach((item, index) => validateJsonSchema(item, schema.items, { path: `${valuePath}[${index}]`, errors, rootSchema }));
  if (schema.minItems !== undefined && Array.isArray(value) && value.length < schema.minItems) schemaError(errors, 'SCHEMA-MIN-ITEMS', `must contain at least ${schema.minItems} item(s)`, valuePath);
  if (schema.maxItems !== undefined && Array.isArray(value) && value.length > schema.maxItems) schemaError(errors, 'SCHEMA-MAX-ITEMS', `must contain at most ${schema.maxItems} item(s)`, valuePath);
  if (schema.contains && Array.isArray(value)) {
    let matches = 0;
    value.forEach((item, index) => {
      const local = [];
      validateJsonSchema(item, schema.contains, { path: `${valuePath}[${index}]`, errors: local, rootSchema });
      if (local.length === 0) matches += 1;
    });
    const minimum = schema.minContains ?? 1;
    const maximum = schema.maxContains ?? Number.POSITIVE_INFINITY;
    if (matches < minimum || matches > maximum) schemaError(errors, 'SCHEMA-CONTAINS', `must contain between ${minimum} and ${Number.isFinite(maximum) ? maximum : 'unbounded'} matching item(s) (found ${matches})`, valuePath);
  }
  if (schema.uniqueItems && Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) for (let j = i + 1; j < value.length; j += 1) if (same(value[i], value[j])) schemaError(errors, 'SCHEMA-UNIQUE', 'items must be unique', valuePath);
  }
  if (schema.minLength !== undefined && typeof value === 'string' && value.length < schema.minLength) schemaError(errors, 'SCHEMA-MIN-LENGTH', `must contain at least ${schema.minLength} character(s)`, valuePath);
  if (schema.maxLength !== undefined && typeof value === 'string' && value.length > schema.maxLength) schemaError(errors, 'SCHEMA-MAX-LENGTH', `must contain at most ${schema.maxLength} character(s)`, valuePath);
  if (schema.minProperties !== undefined && value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length < schema.minProperties) schemaError(errors, 'SCHEMA-MIN-PROPERTIES', `must contain at least ${schema.minProperties} propert(ies)`, valuePath);
  if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum) schemaError(errors, 'SCHEMA-MINIMUM', `must be greater than or equal to ${schema.minimum}`, valuePath);
  if (schema.maximum !== undefined && typeof value === 'number' && value > schema.maximum) schemaError(errors, 'SCHEMA-MAXIMUM', `must be less than or equal to ${schema.maximum}`, valuePath);
  if (schema.pattern && typeof value === 'string') {
    let matches = false;
    try { matches = new RegExp(schema.pattern).test(value); } catch { schemaError(errors, 'SCHEMA-PATTERN', 'schema pattern is invalid', valuePath); }
    if (!matches) schemaError(errors, 'SCHEMA-PATTERN', `does not match ${schema.pattern}`, valuePath);
  }
  return errors;
}
