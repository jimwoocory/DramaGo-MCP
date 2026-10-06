import path from 'node:path';

// Offline, current-contract vocabulary, NOT a full Draft 2020-12 implementation.
// No fetch, dependencies, or code generation. Preflight every
// schema location (even unused definitions/branches) before validating instances.
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (v, key) => Object.hasOwn(v, key);
const schemaNode = (v) => typeof v === 'boolean' || object(v);
const escapePointer = (key) => key.replace(/~/g, '~0').replace(/\//g, '~1');
const schemaLocation = (file, pointer) => JSON.stringify([file, pointer]);
const types = {
  object, array: Array.isArray, string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => Number.isInteger(v), boolean: (v) => typeof v === 'boolean', null: (v) => v === null,
};
const annotations = new Set(['$schema', '$id', 'title', 'description', '$comment', 'x-immutable', 'readOnly']);
const keywords = new Set(['$ref', '$defs', 'type', 'properties', 'required', 'additionalProperties',
  'const', 'enum', 'pattern', 'format', 'minLength', 'maxLength', 'minItems', 'uniqueItems',
  'items', 'allOf', 'not', 'minimum', 'if', 'then', 'else', 'dependentRequired']);

// JSON equality: object member order is irrelevant, arrays are ordered, 0 == -0.
function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  return object(a) && object(b) && Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every((k) => own(b, k) && equal(a[k], b[k]));
}
const unique = (values) => values.every((v, i) => !values.slice(0, i).some((other) => equal(v, other)));
const strings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string') && unique(v);

function resolve(ref, file, schemas) {
  const hash = ref.indexOf('#');
  const resource = hash < 0 ? ref : ref.slice(0, hash);
  const fragment = hash < 0 ? '' : ref.slice(hash + 1);
  const targetFile = !resource ? file : [...schemas].find(([, s]) => s?.$id === resource)?.[0]
    ?? path.posix.normalize(path.posix.join(path.posix.dirname(file), resource));
  let node = schemas.get(targetFile);
  let location = '#';
  if (fragment) {
    const pointer = decodeURIComponent(fragment);
    if (!pointer.startsWith('/')) throw new Error('only JSON Pointer fragments are supported');
    for (const token of pointer.slice(1).split('/')) {
      if (/~(?![01])/u.test(token)) throw new Error('invalid JSON Pointer escape');
      const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
      if ((!object(node) && !Array.isArray(node)) || !own(node, key)) throw new Error('unresolved JSON Pointer');
      node = node[key];
      location += `/${escapePointer(key)}`;
    }
  }
  if (!schemaNode(node)) throw new Error(`unresolved $ref ${ref}`);
  return { node, file: targetFile, location };
}

// RFC 3339 date-time assertion, not Date.parse's permissive rollover parser.
// Leap-second syntax is allowed only at UTC June/December end, including offsets;
// this is format validation, not a prediction of future leap-second announcements.
function dateTime(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[tT](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([zZ]|([+-])(\d{2}):(\d{2}))(?![\s\S])/u.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const offsetHour = Number(m[9] ?? 0), offsetMinute = Number(m[10] ?? 0);
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 60 || offsetHour > 23 || offsetMinute > 59) return false;
  if (second < 60) return true;
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  utc.setUTCHours(hour, minute, 59, 0);
  utc.setUTCMinutes(utc.getUTCMinutes() - (m[8] === '-' ? -1 : 1) * (offsetHour * 60 + offsetMinute));
  return utc.getUTCHours() === 23 && utc.getUTCMinutes() === 59
    && ((utc.getUTCMonth() === 5 && utc.getUTCDate() === 30)
      || (utc.getUTCMonth() === 11 && utc.getUTCDate() === 31));
}

export function createInstanceValidator(schemas) {
  const errors = [];
  const locations = new Set();
  const refs = [];
  function inspect(node, file, location = '#') {
    const fail = (message) => errors.push(`${file}${location}: ${message}`);
    if (!schemaNode(node)) { fail('expected object or boolean schema'); return; }
    locations.add(schemaLocation(file, location));
    if (typeof node === 'boolean') return;
    for (const key of Object.keys(node)) {
      if (!keywords.has(key) && !annotations.has(key)) fail(`unsupported validation keyword ${key}`);
    }
    // A nested resource ID changes reference scope; never silently treat it as root.
    if (own(node, '$id') && location !== '#') fail('unsupported nested $id resource');
    if (own(node, '$schema') && node.$schema !== 'https://json-schema.org/draft/2020-12/schema') fail('unsupported $schema dialect');
    if (own(node, '$ref')) {
      if (typeof node.$ref !== 'string') fail('$ref must be a string');
      else {
        try { refs.push({ ...resolve(node.$ref, file, schemas), from: `${file}${location}` }); }
        catch (error) { fail(`unresolved $ref ${JSON.stringify(node.$ref)}: ${error.message}`); }
      }
    }
    if (own(node, 'type')) {
      const names = Array.isArray(node.type) ? node.type : [node.type];
      if (!names.length || !unique(names) || names.some((name) => typeof name !== 'string' || !own(types, name))) fail('invalid type');
    }
    for (const key of ['properties', '$defs']) {
      if (!own(node, key)) continue;
      if (!object(node[key])) fail(`${key} must be an object`);
      else for (const [name, child] of Object.entries(node[key])) inspect(child, file, `${location}/${key}/${escapePointer(name)}`);
    }
    if (own(node, 'required') && !strings(node.required)) fail('required must be an array of strings without duplicates');
    if (own(node, 'dependentRequired')) {
      if (!object(node.dependentRequired) || Object.values(node.dependentRequired).some((v) => !strings(v))) fail('invalid dependentRequired');
    }
    if (own(node, 'enum') && (!Array.isArray(node.enum) || !node.enum.length || !unique(node.enum))) fail('invalid enum');
    if (own(node, 'pattern')) {
      try {
        if (typeof node.pattern !== 'string') throw new Error('expected string');
        new RegExp(node.pattern, 'u');
      } catch { fail('invalid pattern'); }
    }
    if (own(node, 'format') && node.format !== 'date-time') fail(`unsupported format ${node.format}`);
    for (const key of ['minLength', 'maxLength', 'minItems']) {
      if (own(node, key) && (!Number.isInteger(node[key]) || node[key] < 0)) fail(`invalid ${key}`);
    }
    if (own(node, 'minimum') && !types.number(node.minimum)) fail('invalid minimum');
    if (own(node, 'uniqueItems') && typeof node.uniqueItems !== 'boolean') fail('invalid uniqueItems');
    for (const key of ['additionalProperties', 'items', 'not', 'if', 'then', 'else']) {
      if (own(node, key)) inspect(node[key], file, `${location}/${key}`);
    }
    if (own(node, 'allOf')) {
      if (!Array.isArray(node.allOf) || !node.allOf.length) fail('allOf must be a nonempty schema array');
      else node.allOf.forEach((child, i) => inspect(child, file, `${location}/allOf/${i}`));
    }
  }
  for (const [file, schema] of schemas) inspect(schema, file);
  for (const ref of refs) {
    if (!locations.has(schemaLocation(ref.file, ref.location))) errors.push(`${ref.from}: $ref target is not a schema location`);
  }

  function check(value, node, file, location, active = []) {
    // A schema/instance cycle is a configuration error, not a failed predicate
    // which could be inverted into success by `not` or used to choose `else`.
    if (active.some(([s, p]) => s === node && p === location)) throw new Error('cyclic $ref at the same instance location');
    if (typeof node === 'boolean') return node ? [] : [`${location}: false schema`];
    const next = [...active, [node, location]];
    const out = [];
    const fail = (keyword) => out.push(`${location}: ${keyword}`);
    const visit = (v, child, at = location, source = file) => check(v, child, source, at, next);
    if (own(node, '$ref')) {
      const target = resolve(node.$ref, file, schemas);
      out.push(...visit(value, target.node, location, target.file));
    }
    if (own(node, 'type') && !(Array.isArray(node.type) ? node.type : [node.type]).some((t) => types[t](value))) fail('type');
    if (own(node, 'const') && !equal(value, node.const)) fail('const');
    if (own(node, 'enum') && !node.enum.some((v) => equal(value, v))) fail('enum');
    if (typeof value === 'string') {
      const length = [...value].length;
      if (own(node, 'minLength') && length < node.minLength) fail('minLength');
      if (own(node, 'maxLength') && length > node.maxLength) fail('maxLength');
      if (own(node, 'pattern') && !new RegExp(node.pattern, 'u').test(value)) fail('pattern');
      if (node.format === 'date-time' && !dateTime(value)) fail('format(date-time)');
    }
    if (types.number(value) && own(node, 'minimum') && value < node.minimum) fail('minimum');
    if (Array.isArray(value)) {
      if (own(node, 'minItems') && value.length < node.minItems) fail('minItems');
      if (node.uniqueItems === true && !unique(value)) fail('uniqueItems');
      if (own(node, 'items')) value.forEach((v, i) => out.push(...visit(v, node.items, `${location}/${i}`)));
    }
    if (object(value)) {
      for (const key of node.required ?? []) if (!own(value, key)) fail(`required ${key}`);
      for (const [key, dependencies] of Object.entries(node.dependentRequired ?? {})) {
        if (own(value, key)) for (const dep of dependencies) if (!own(value, dep)) fail(`dependentRequired ${key} requires ${dep}`);
      }
      for (const [key, v] of Object.entries(value)) {
        const at = `${location}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
        if (own(node.properties ?? {}, key)) out.push(...visit(v, node.properties[key], at));
        else if (node.additionalProperties === false) fail(`additionalProperties ${key}`);
        else if (own(node, 'additionalProperties')) out.push(...visit(v, node.additionalProperties, at));
      }
    }
    for (const part of node.allOf ?? []) out.push(...visit(value, part));
    if (own(node, 'not') && !visit(value, node.not).length) fail('not');
    if (own(node, 'if')) {
      const branch = visit(value, node.if).length ? 'else' : 'then';
      if (own(node, branch)) out.push(...visit(value, node[branch]));
    }
    return out;
  }
  return {
    errors,
    validate(value, file, label = 'instance') {
      if (errors.length) return [...errors];
      if (!schemas.has(file)) return [`${label}: unknown schema ${file}`];
      try { return check(value, schemas.get(file), file, '#').map((e) => `${label}: ${e} (${file})`); }
      catch (error) { return [`${label}: schema evaluation failed: ${error.message}`]; }
    },
  };
}

export function validateExamples(schemas, examples) {
  const validator = createInstanceValidator(schemas);
  const errors = [...validator.errors];
  const byVersion = new Map();
  for (const [file, schema] of schemas) {
    const version = schema?.properties?.schema_version?.const;
    if (typeof version !== 'string') continue; // e.g. common definition library
    if (byVersion.has(version)) errors.push(`${file}: ambiguous schema_version ${version}`);
    byVersion.set(version, file);
  }
  let instances = 0;
  for (const [file, example] of examples) {
    const records = Array.isArray(example) ? example : [example];
    if (!records.length) errors.push(`${file}: empty example collection`);
    records.forEach((record, i) => {
      instances++;
      const label = Array.isArray(example) ? `${file}[${i}]` : file;
      const schema = object(record) && byVersion.get(record.schema_version);
      if (!schema) errors.push(`${label}: missing or unknown schema_version`);
      else if (!validator.errors.length) errors.push(...validator.validate(record, schema, label));
    });
  }
  return { errors, instances };
}
