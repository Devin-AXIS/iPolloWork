// The `w:sym` faces a document cannot do without.
//
// A symbol glyph with a Unicode equivalent paints in any face, so a missing symbol face
// loses nothing. A private-use glyph (`U+F0xx` with no table entry, or a face with no table
// at all) means something only in its own face; without it the reader sees a missing-glyph
// box. Those faces belong in the font-substitution notice even though they render no text.

import { collectUnmappedSymbolFaces } from '../binding/document-catalog.ts';
import type { TreeDocxSessionView } from '../binding/tree-session-contract.ts';

const sessionMemo = new WeakMap<
  TreeDocxSessionView,
  { readonly revision: number; readonly faces: readonly string[] }
>();

/**
 * Faces named by a `w:sym` whose glyph has no Unicode equivalent, in reading order and
 * deduplicated case-insensitively. Memoized per package revision; the walk shares the
 * per-subtree memo of {@link TreeDocxSessionView.symbolFontFamilies}.
 */
export function unmappedSymbolFaces(session: TreeDocxSessionView): readonly string[] {
  const revision = session.packageRevision();
  const cached = sessionMemo.get(session);
  if (cached?.revision === revision) return cached.faces;
  // Most documents name no symbol face, and then there is nothing to walk.
  const faces =
    session.symbolFontFamilies().length > 0
      ? collectUnmappedSymbolFaces(session.storyParts().map((part) => part.root))
      : [];
  sessionMemo.set(session, { revision, faces });
  return faces;
}

/**
 * The families the font-substitution notice checks: faces text renders in, then the faces
 * an unmapped symbol glyph needs. A face already in the first list is not repeated.
 */
export function renderedAndUnmappedSymbolFaces(session: TreeDocxSessionView): readonly string[] {
  const rendered = session.renderedFontFamilies();
  const symbols = unmappedSymbolFaces(session);
  if (symbols.length === 0) return rendered;
  const seen = new Set(rendered.map((family) => family.toLowerCase()));
  const extra = symbols.filter((family) => !seen.has(family.toLowerCase()));
  return extra.length === 0 ? rendered : [...rendered, ...extra];
}
