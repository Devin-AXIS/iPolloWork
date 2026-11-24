// OPC / ZIP / relationship-target normalization profile (document-engine task
// 2.2 / lossless-package-model "OPC and relationship references use explicit
// profiles"). Every ZIP entry name, OPC part name, and internal relationship
// target passes through one algorithm that rejects the traversal/encoding/drive
// attack surface BEFORE inflation or model commit. External-mode targets take a
// separate absolute-URI profile: retained verbatim, never owner-resolved, never
// fetched. This is the package trust boundary (design D14) — pure, DOM-free, and
// dependency-free; it operates on names, not archive bytes.

/**
 * Why a part or relationship name was refused.
 *
 * Path traversal is the reason this exists: a name with `..` or a leading `/` is refused rather
 * than normalized, because normalizing is how a crafted package reaches outside itself.
 */
export type NameRejection =
  | 'empty'
  | 'control-char'
  | 'backslash'
  | 'drive-or-unc'
  | 'encoded-separator'
  | 'encoded-dot'
  | 'bad-encoding'
  | 'empty-segment'
  | 'dot-segment'
  | 'unsafe-key'
  | 'segment-trailing-dot'
  | 'traversal-escape'
  | 'not-absolute-uri'
  | 'unsafe-scheme';

/** A validated OPC name, or the typed reason it was refused. */
export type NameResult =
  | { readonly ok: true; readonly partName: string }
  | { readonly ok: false; readonly reason: NameRejection };

/** ASCII/DEL control characters. `test` rejects; {@link stripControlChars} drops. */
export const CONTROL_RE = /[\x00-\x1f\x7f]/;
const CONTROL_RE_GLOBAL = new RegExp(CONTROL_RE.source, 'g');

/**
 * Drop every control character from a value. The external-target path REJECTS these
 * ({@link validateExternalTarget}); a `\l` anchor fragment and a `\o` tooltip are inert sinks,
 * so they scrub for consistency rather than fail closed — the char is removed, never smuggled on.
 */
export function stripControlChars(value: string): string {
  return value.replace(CONTROL_RE_GLOBAL, '');
}

const ENCODED_SEP_RE = /%(2f|5c)/i; // %2f "/", %5c "\"
const ENCODED_DOT_RE = /%2e/i; // %2e "."
const DRIVE_RE = /^[a-zA-Z]:/;

/** Shared pre-decode rejections applied to any archive/part/relationship name. */
function preScreen(raw: string): NameRejection | null {
  if (raw.length === 0) return 'empty';
  if (CONTROL_RE.test(raw)) return 'control-char';
  if (raw.includes('\\')) return 'backslash';
  if (DRIVE_RE.test(raw)) return 'drive-or-unc';
  if (raw.startsWith('//')) return 'drive-or-unc'; // UNC form
  if (ENCODED_SEP_RE.test(raw)) return 'encoded-separator';
  if (ENCODED_DOT_RE.test(raw)) return 'encoded-dot';
  return null;
}

/** Decode the allowed (non-separator, non-dot) percent-encodings canonically. */
function decode(raw: string): { ok: true; value: string } | { ok: false; reason: NameRejection } {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { ok: false, reason: 'bad-encoding' };
  }
  // A decoded value must not smuggle a control char or backslash back in.
  if (CONTROL_RE.test(decoded)) return { ok: false, reason: 'control-char' };
  if (decoded.includes('\\')) return { ok: false, reason: 'backslash' };
  return { ok: true, value: decoded };
}

/** Validate one OPC part-name segment (no ".", "..", empty, or trailing dot). */
function screenSegment(seg: string): NameRejection | null {
  if (seg.length === 0) return 'empty-segment';
  if (seg === '.' || seg === '..') return 'dot-segment';
  if (seg.endsWith('.')) return 'segment-trailing-dot';
  // A segment that is a dangerous object key (__proto__/constructor/prototype) would, when
  // a part map is materialized as a plain object, invoke a prototype setter — polluting or
  // silently dropping the entry. Reject such names (fail closed) rather than mishandle them.
  if (seg === '__proto__' || seg === 'constructor' || seg === 'prototype') return 'unsafe-key';
  return null;
}

/**
 * Normalize a ZIP entry name or OPC part name into a canonical part name
 * (`/word/document.xml`). Accepts leading-slash and no-leading-slash inputs;
 * rejects traversal, dot segments, and the attack surface. Duplicate detection
 * folds ASCII case (OPC part-name equivalence).
 */
export function normalizePartName(raw: string): NameResult {
  const pre = preScreen(raw);
  if (pre) return { ok: false, reason: pre };
  const dec = decode(raw);
  if (!dec.ok) return dec;

  const body = dec.value.startsWith('/') ? dec.value.slice(1) : dec.value;
  const segments = body.split('/');
  for (const seg of segments) {
    const bad = screenSegment(seg);
    if (bad) return { ok: false, reason: bad };
  }
  return { ok: true, partName: '/' + segments.join('/') };
}

const MAIN_DOCUMENT_PART_RESULT = normalizePartName('word/document.xml');

/** Canonical OPC part name for the main document story (`/word/document.xml`). */
export const WML_MAIN_DOCUMENT_PART = MAIN_DOCUMENT_PART_RESULT.ok
  ? MAIN_DOCUMENT_PART_RESULT.partName
  : '/word/document.xml';

/**
 * ASCII-only lowercase fold. OPC part-name/extension equivalence is US-ASCII
 * case-insensitive; a locale `toLowerCase()` mis-folds e.g. Turkish `I`/`İ` and
 * could let two "equivalent" part names evade duplicate detection.
 */
export function asciiFold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 0x41 && c <= 0x5a ? String.fromCharCode(c + 0x20) : s[i];
  }
  return out;
}

/** Case-folded key for OPC part-name equivalence / duplicate detection. */
export function partNameKey(partName: string): string {
  return asciiFold(partName);
}

/**
 * Detect archive entries that collide after normalization (before inflation).
 * Returns the case-folded keys that more than one raw name maps to.
 */
export function detectDuplicateNames(rawNames: readonly string[]): {
  readonly duplicates: readonly string[];
  readonly rejected: readonly { raw: string; reason: NameRejection }[];
} {
  const seen = new Map<string, number>();
  const rejected: { raw: string; reason: NameRejection }[] = [];
  for (const raw of rawNames) {
    const r = normalizePartName(raw);
    if (!r.ok) {
      rejected.push({ raw, reason: r.reason });
      continue;
    }
    const key = partNameKey(r.partName);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  return { duplicates, rejected };
}

/**
 * Resolve an internal relationship target against its owner part, without
 * escaping the package root. `ownerPartName` is a canonical part name; the base
 * is its containing folder. A leading "/" target is package-absolute. `.`/`..`
 * segments resolve on a stack; popping above root is `traversal-escape`.
 */
export function resolveInternalTarget(ownerPartName: string, rawTarget: string): NameResult {
  const pre = preScreen(rawTarget);
  if (pre) return { ok: false, reason: pre };
  const dec = decode(rawTarget);
  if (!dec.ok) return dec;
  const target = dec.value;

  // Base = owner's folder segments (drop the owner's own filename).
  const ownerSegs = ownerPartName.replace(/^\//, '').split('/');
  ownerSegs.pop();
  const stack: string[] = target.startsWith('/') ? [] : [...ownerSegs];

  for (const seg of (target.startsWith('/') ? target.slice(1) : target).split('/')) {
    if (seg === '' || seg === '.') continue; // collapse empty and current-dir
    if (seg === '..') {
      if (stack.length === 0) return { ok: false, reason: 'traversal-escape' };
      stack.pop();
      continue;
    }
    if (seg.endsWith('.')) return { ok: false, reason: 'segment-trailing-dot' };
    stack.push(seg);
  }
  if (stack.length === 0) return { ok: false, reason: 'empty-segment' };
  return { ok: true, partName: '/' + stack.join('/') };
}

const UNSAFE_SCHEMES = /^(javascript|vbscript|data|file):/i;
const ABSOLUTE_URI = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Validate an external-mode relationship target. It MUST be an absolute URI, is
 * retained verbatim by the caller, and is NEVER owner-resolved or fetched here.
 * Unsafe schemes (javascript/vbscript/data/file) are rejected for runtime sinks;
 * the raw lexical form is still preserved separately by the authored record.
 */
export function validateExternalTarget(raw: string): NameResult {
  if (raw.length === 0) return { ok: false, reason: 'empty' };
  if (CONTROL_RE.test(raw)) return { ok: false, reason: 'control-char' };
  if (!ABSOLUTE_URI.test(raw)) return { ok: false, reason: 'not-absolute-uri' };
  if (UNSAFE_SCHEMES.test(raw)) return { ok: false, reason: 'unsafe-scheme' };
  return { ok: true, partName: raw };
}
