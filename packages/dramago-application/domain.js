import { createHash } from 'node:crypto';

export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function ensure(condition, code, message, details) {
  if (!condition) throw new DomainError(code, message, details);
}

// RFC 8785 for JSON values: UTF-16 property order, ECMAScript number/string
// serialization, no normalization. Accept parsed data, never JSON source text.
// Duplicate source keys must be rejected by the transport's JSON parser.
export function canonicalize(value) {
  const ancestors = new Set();
  const invalid = (message) => { throw new DomainError('VALIDATION_ERROR', message); };
  const string = (s) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = s.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) invalid('Unpaired Unicode surrogate');
      } else if (c >= 0xdc00 && c <= 0xdfff) invalid('Unpaired Unicode surrogate');
    }
    return JSON.stringify(s);
  };
  function encode(v) {
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'string') return string(v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) invalid('JSON numbers must be finite');
      return JSON.stringify(v);
    }
    if (typeof v !== 'object') invalid('Only JSON values are accepted');
    if (ancestors.has(v)) invalid('Cyclic JSON value');
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      invalid('Only plain JSON objects are accepted');
    }
    const descriptors = Object.getOwnPropertyDescriptors(v);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') invalid('Symbol keys are not JSON');
      const d = descriptors[key];
      if (!Object.hasOwn(d, 'value')) invalid('JSON accessors are not accepted');
      if (!d.enumerable && !(Array.isArray(v) && key === 'length')) invalid('Hidden JSON properties');
    }
    ancestors.add(v);
    let result;
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length) invalid('Sparse or extended JSON array');
      const items = [];
      for (let i = 0; i < v.length; i++) {
        if (!Object.hasOwn(v, i)) invalid('Sparse JSON array');
        items.push(encode(v[i]));
      }
      result = `[${items.join(',')}]`;
    } else {
      result = `{${Object.keys(v).sort().map((key) => `${string(key)}:${encode(v[key])}`).join(',')}}`;
    }
    ancestors.delete(v);
    return result;
  }
  return encode(value);
}

export const canonicalHash = (value) => `sha256:${createHash('sha256').update(canonicalize(value), 'utf8').digest('hex')}`;
export const snapshot = (value) => JSON.parse(canonicalize(value));
export const equal = (a, b) => canonicalize(a) === canonicalize(b);
