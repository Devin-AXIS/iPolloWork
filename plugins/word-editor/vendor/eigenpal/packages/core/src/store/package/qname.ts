// XML serialization name-safety (document-engine task 3.5 / lossless-package-model
// "XML serialization separates names from values"). Serializer-generated element
// and attribute NAMES must be validated QNames with controlled namespace prefixes;
// they are never escaped as values. Attribute/text VALUES are XML-escaped
// (escapeXml, sinks.ts) and URIs validated. This is the injection boundary on save.

// NCName: a name with no ':' — starts with a letter/_ then name chars.
const NCNAME = /^[A-Za-z_][A-Za-z0-9._-]*$/;

// XML 1.0 (Fifth Edition) NameStartChar and NameChar, without the colon. One character
// class followed by one starred class, anchored at both ends: the match is linear and
// cannot backtrack. The `u` flag makes the astral range count code points, not halves.
const XML_NAME_START =
  'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF' +
  '\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD' +
  '\\u{10000}-\\u{EFFFF}';
const XML_NAME_REST = `${XML_NAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040`;
const XML_NCNAME = new RegExp(`^[${XML_NAME_START}][${XML_NAME_REST}]*$`, 'u');

/**
 * Whether a string is a valid XML NCName in the strict ASCII profile — a name with no colon.
 *
 * This is the rule for names the engine itself writes or accepts from a caller. Names read
 * from a document use {@link isXmlNCName}, which admits every XML 1.0 name.
 */
export function isValidNCName(name: string): boolean {
  return NCNAME.test(name);
}

/**
 * Whether a string is an XML 1.0 (Fifth Edition) NCName: a `Name` with no colon.
 *
 * The rule for names READ from a document, and for writing those names back. It admits
 * non-ASCII letters such as `Dátum`. No character it admits can end a name in markup:
 * whitespace, quotes, `<`, `>`, `&`, `=` and `/` are all outside the ranges.
 */
export function isXmlNCName(name: string): boolean {
  // Almost every name is ASCII; the Unicode-mode class runs only when that test fails.
  return NCNAME.test(name) || XML_NCNAME.test(name);
}

/** A QName is an optional `prefix:` (both NCNames) — never attacker-derived. */
export function isValidQName(name: string): boolean {
  const parts = name.split(':');
  if (parts.length === 1) return isValidNCName(parts[0]);
  if (parts.length === 2) return isValidNCName(parts[0]) && isValidNCName(parts[1]);
  return false;
}

/**
 * Validate a qualified name, throwing when it is malformed.
 *
 * Guards the serializer: an invalid QName written into XML produces a file Word cannot open, so
 * it fails here rather than at save.
 */
export function assertValidQName(name: string): void {
  if (!isValidQName(name))
    throw new Error(`invalid QName for serialization: ${JSON.stringify(name)}`);
}

/**
 * Controlled namespace-prefix allocation: deterministic, collision-free prefixes
 * for namespace URIs. A known URI always yields the same registered prefix; new
 * URIs get a generated `ns{n}` prefix, never one derived from file content.
 */
export class PrefixAllocator {
  private readonly byUri = new Map<string, string>();
  private readonly usedPrefixes = new Set<string>();
  private counter = 0;

  constructor(known: Readonly<Record<string, string>> = {}) {
    for (const [uri, prefix] of Object.entries(known)) {
      this.byUri.set(uri, prefix);
      this.usedPrefixes.add(prefix);
    }
  }

  prefixFor(namespaceUri: string): string {
    const existing = this.byUri.get(namespaceUri);
    if (existing) return existing;
    let prefix: string;
    do {
      this.counter += 1;
      prefix = `ns${this.counter}`;
    } while (this.usedPrefixes.has(prefix));
    this.byUri.set(namespaceUri, prefix);
    this.usedPrefixes.add(prefix);
    return prefix;
  }

  /** The declared bindings, for emitting xmlns declarations. */
  bindings(): { prefix: string; uri: string }[] {
    return [...this.byUri.entries()].map(([uri, prefix]) => ({ prefix, uri }));
  }
}

// NOTE: there is deliberately no generic URI "validator" here. Raw external
// targets are preserved verbatim in the authored record (lossless-package-model);
// safety is applied at the RUNTIME sink via the allowlist in sinks.ts
// (sanitizeHref), not by a pass/fail URI check that would give false confidence.
