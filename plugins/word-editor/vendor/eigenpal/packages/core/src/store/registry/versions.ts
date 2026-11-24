// Minimal, deterministic semantic-version support for the capability registry
// (document-engine task 0.1). Only the range forms the registry's
// version/collision/replacement rules need are supported; anything else is
// rejected rather than silently accepted, so a malformed range never
// masquerades as "compatible".

/** A parsed semantic version. Only the three numeric components — no pre-release or build. */
export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Parse a semantic version, rejecting anything the registry's rules do not need.
 *
 * Deliberately narrow: an unsupported range form is refused rather than accepted, so a malformed
 * range can never masquerade as "compatible".
 */
export function parseSemVer(input: string): SemVer {
  const m = SEMVER_RE.exec(input);
  if (!m) throw new Error(`invalid semantic version: ${JSON.stringify(input)}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Order two versions: negative, zero or positive, by major then minor then patch. */
export function compareSemVer(a: SemVer, b: SemVer): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * Whether `version` satisfies `range`. Supported range grammar:
 *   - `*`            any version
 *   - `1.2.3`        exact
 *   - `^1.2.3`       caret: same major, and >= the floor (major 0 pins the minor)
 *   - `>=1.2.3 <2.0.0`  a single lower (inclusive) + upper (exclusive) bound pair
 * Any other shape throws — an unparseable range is a registration error, not a pass.
 */
export function satisfies(version: string, range: string): boolean {
  const v = parseSemVer(version);
  const trimmed = range.trim();

  if (trimmed === '*') return true;

  if (trimmed.startsWith('^')) {
    const floor = parseSemVer(trimmed.slice(1));
    if (compareSemVer(v, floor) < 0) return false;
    if (floor.major > 0) return v.major === floor.major;
    if (floor.minor > 0) return v.major === 0 && v.minor === floor.minor;
    return v.major === 0 && v.minor === 0; // ^0.0.z pins to 0.0.x
  }

  if (trimmed.includes(' ')) {
    const parts = trimmed.split(/\s+/);
    if (parts.length !== 2) throw new Error(`unsupported version range: ${JSON.stringify(range)}`);
    let ok = true;
    for (const part of parts) {
      const op = part.startsWith('>=') ? '>=' : part.startsWith('<') ? '<' : null;
      if (!op) throw new Error(`unsupported version range: ${JSON.stringify(range)}`);
      const bound = parseSemVer(part.slice(op.length));
      const cmp = compareSemVer(v, bound);
      if (op === '>=') ok = ok && cmp >= 0;
      else ok = ok && cmp < 0;
    }
    return ok;
  }

  return compareSemVer(v, parseSemVer(trimmed)) === 0;
}
