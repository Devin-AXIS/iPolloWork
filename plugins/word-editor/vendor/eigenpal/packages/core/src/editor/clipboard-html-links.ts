import { sanitizeHref } from '../store/package/sinks.ts';

/**
 * A name Word can store in `w:bookmarkStart` and `w:anchor`. Web anchor names
 * ('section-2', 'user.content') MANGLE deterministically instead of dropping, so
 * an internal link and its target — mangled the same way in one paste — still pair.
 */
export function clipboardBookmarkName(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 256) return null;
  if (/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(trimmed)) return trimmed;
  const mangled = trimmed.replace(/[^A-Za-z0-9_]/g, '_');
  if (mangled.replace(/_/g, '').length === 0) return null;
  // A deterministic hash of the RAW name joins the mangled stem: a link and its
  // target — mangled from the same raw name — still pair, while distinct names
  // that mangle or truncate to the same stem stay distinct bookmarks.
  let hash = 5381;
  for (let index = 0; index < trimmed.length; index += 1) {
    hash = (Math.imul(hash, 33) ^ trimmed.charCodeAt(index)) >>> 0;
  }
  const suffix = `_${hash.toString(36)}`;
  let stem = mangled.slice(0, 40 - suffix.length);
  if (!/^[A-Za-z_]/.test(stem)) stem = `_${stem.slice(0, 39 - suffix.length)}`;
  return `${stem}${suffix}`;
}

/** Tell whether an HTML target can remain an active hyperlink. A fragment href
 *  counts only when its name survives bookmark mangling — otherwise the read lane
 *  would style the text as a link while emitting no `w:hyperlink` at all. */
export function isClipboardHyperlink(raw: string | null): boolean {
  if (raw === null) return false;
  if (raw.startsWith('#')) return clipboardBookmarkName(raw.slice(1)) !== null;
  const target = sanitizeHref(raw);
  return target?.ok === true && target.href.length > 0;
}

/** Resolve an external target, internal anchor, or their safe combination for HTML output. */
export function clipboardHyperlinkTarget(
  rawTarget: string | undefined,
  rawAnchor: string | undefined
): string | null {
  // A fragment-only target names a same-document bookmark, so it mangles through
  // `clipboardBookmarkName` exactly like the emitted `w:bookmarkStart` names —
  // otherwise a link/bookmark pair that round-trips through a paste stops pairing.
  if (rawTarget !== undefined && rawTarget.startsWith('#')) {
    const fragment = clipboardBookmarkName(rawTarget.slice(1));
    const anchorOnly = clipboardBookmarkName(rawAnchor) ?? fragment;
    return anchorOnly === null ? null : `#${anchorOnly}`;
  }
  const href = rawTarget === undefined ? null : sanitizeHref(rawTarget);
  const anchor = clipboardBookmarkName(rawAnchor);
  if (href?.ok === true && href.href.length > 0) {
    if (anchor === null) return href.href;
    // Per ECMA-376 §17.16.22 the anchor names the location WITHIN the target, so
    // it replaces any fragment the target itself carries.
    return `${href.href.split('#')[0]}#${anchor}`;
  }
  return anchor === null ? null : `#${anchor}`;
}
