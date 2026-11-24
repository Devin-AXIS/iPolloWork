// Null-prototype parser intermediates + dangerous-key rejection (document-engine
// task 2.5 / design D14). Every value derived from an attacker-controlled DOCX
// is converted into null-prototype records BEFORE capability dispatch, and any
// object key that could pollute a prototype chain (`__proto__`, `prototype`,
// `constructor`) is rejected recursively — a file can never assign into a shared
// prototype via an XML-attribute-name -> object-key path.

/**
 * Keys that must never be assigned from file data.
 *
 * XML attribute names become object keys, and a document controls those names — assigning
 * `__proto__` into an ordinary object is the prototype-pollution hazard this engine audits for.
 */
export const DANGEROUS_KEYS: readonly string[] = ['__proto__', 'prototype', 'constructor'];
const DANGEROUS = new Set(DANGEROUS_KEYS);

/** A file-derived key that would pollute a prototype. Refused, never sanitized-and-accepted. */
export class DangerousKeyError extends Error {
  constructor(
    readonly key: string,
    readonly path: string
  ) {
    super(`dangerous key ${JSON.stringify(key)} at ${path || '<root>'}`);
    this.name = 'DangerousKeyError';
  }
}

/** Whether a key is one of {@link DANGEROUS_KEYS}. */
export function isDangerousKey(key: string): boolean {
  return DANGEROUS.has(key);
}

/** A fresh null-prototype record — the only object shape parser intermediates use. */
export function nullRecord<T = unknown>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/**
 * Recursively convert `value` into null-prototype records, rejecting any
 * dangerous object key. Arrays and primitives pass through (arrays rebuilt so no
 * inherited prototype pollution survives). Throws DangerousKeyError on the first
 * unsafe key, naming its path. Cyclic inputs are rejected.
 */
export function toSafeRecord(value: unknown, path = ''): unknown {
  return convert(value, path, new WeakSet());
}

function convert(value: unknown, path: string, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) throw new Error(`cyclic structure at ${path || '<root>'}`);
  seen.add(value as object);

  if (Array.isArray(value)) {
    const out = value.map((v, i) => convert(v, `${path}[${i}]`, seen));
    seen.delete(value as object);
    return out;
  }

  const record = nullRecord();
  // Own enumerable string keys only; never walk the prototype chain.
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (isDangerousKey(key)) throw new DangerousKeyError(key, path);
    record[key] = convert(
      (value as Record<string, unknown>)[key],
      path ? `${path}.${key}` : key,
      seen
    );
  }
  seen.delete(value as object);
  return record;
}
