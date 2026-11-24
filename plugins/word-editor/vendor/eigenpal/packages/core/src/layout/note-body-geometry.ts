import type { SemanticLayout } from './semantic-records.ts';

// Note reserves belong to the body box that admitted them. Header projections can
// change that box while the body part and note stories keep their identities.
const geometryBySession = new WeakMap<
  object,
  { readonly part: object; readonly pages: readonly string[] }
>();

export function noteBodyGeometryChanged(
  session: object | undefined,
  layout: SemanticLayout,
  part: object
): boolean {
  if (!session) return false;
  const previous = geometryBySession.get(session);
  const current = layout.pages.map(({ box, contentBox }) =>
    [
      box.width,
      box.height,
      contentBox.x - box.x,
      contentBox.y - box.y,
      contentBox.width,
      contentBox.height,
    ].join(',')
  );
  geometryBySession.set(session, { part, pages: current });
  // Tree edits already invalidate settlement by part identity. Preserve their
  // reserve seed: it carries the established bounded search across edits.
  if (previous?.part !== part) return false;
  // A changed page count alone is a result of note pagination, not a changed
  // constraint. Compare only sheets that already had a reserve context.
  return current.some((value, i) => previous.pages[i] !== undefined && previous.pages[i] !== value);
}
