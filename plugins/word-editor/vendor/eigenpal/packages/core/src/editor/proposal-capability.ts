import type { CanResult, EditorCommand } from '../contracts/editor.ts';
import { resolveDocTargetSelection } from './doc-target-resolution.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/**
 * Why `can` refuses a tracked proposal (`proposeInsertion`, `proposeDeletion`,
 * `proposeReplacement`) that the command gate admitted, or null. Other commands answer null.
 */
export function proposalCapabilityRefusal(
  command: EditorCommand,
  surface: PaginatedSurface,
  author: string | null | undefined
): CanResult | null {
  if (
    command.type !== 'proposeInsertion' &&
    command.type !== 'proposeDeletion' &&
    command.type !== 'proposeReplacement'
  )
    return null;
  const writer = (command.author ?? author ?? '').trim();
  if (!writer) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: `${command.type} requires a non-empty author`,
    };
  }
  const resolved =
    command.target === undefined
      ? { ok: true as const, selection: surface.state().selection }
      : resolveDocTargetSelection(surface, command.target);
  if (!resolved.ok) return resolved;
  const { anchor, head } = resolved.selection;
  const collapsed = anchor.paragraphId === head.paragraphId && anchor.offset === head.offset;
  // A rectangle over one empty cell mirrors a collapsed range but still covers a cell
  // the surface replaces over, so `can` agrees — replacement only (a deletion over
  // empty cells commits nothing), and only when no explicit target overrides it.
  const rectangleReplacement =
    command.type === 'proposeReplacement' &&
    command.target === undefined &&
    surface.state().cellSelection !== null;
  if (command.type !== 'proposeInsertion' && collapsed && !rectangleReplacement) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: `${command.type} needs a non-collapsed selection`,
    };
  }
  return null;
}
