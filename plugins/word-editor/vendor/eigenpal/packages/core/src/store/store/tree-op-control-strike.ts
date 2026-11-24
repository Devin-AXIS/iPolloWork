import {
  contentControlPropertiesOf,
  lockForbidsEdit,
  lockForbidsRemoval,
  type ContentControlLock,
} from '../package/content-control-nodes.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';
import type { OffsetSpan } from './tree-op-segments.ts';

/**
 * Whether a tracked deletion over `range` strikes this control WHOLE: the range covers all of
 * it, its lock allows removing it, and either the lock forbids editing what it holds
 * (`contentLocked`) or it shows its prompt (`w:showingPlcHdr`). A prompt is what an empty
 * control shows, so striking it from inside proposed nothing a reviewer could accept. The
 * tracked-delete applier writes such a control inside one `w:del`; every other control is
 * struck from inside, as before.
 */
export function strikesWholeControl(
  span: OffsetSpan | null,
  range: { readonly start: number; readonly end: number },
  lock: ContentControlLock,
  control?: OoxmlNode
): boolean {
  return (
    span !== null &&
    span.start < span.end &&
    range.start <= span.start &&
    span.end <= range.end &&
    (lockForbidsEdit(lock) ||
      (control !== undefined && contentControlPropertiesOf(control).showingPlaceholder)) &&
    !lockForbidsRemoval(lock)
  );
}
