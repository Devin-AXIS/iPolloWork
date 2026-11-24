// Header/footer Editor command helpers (createDocxEditor seam).
//
// Resolves section/variant slots, maps EditorCommands onto package lifecycle TreeDocOps,
// and handles active-scope rebind after unlink / exit after delete-or-link of the open story.

import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

export type FurnitureVariant = 'default' | 'first' | 'even';

export function variantFromFlags(flags: {
  readonly firstPage?: boolean;
  readonly evenPage?: boolean;
}): FurnitureVariant {
  if (flags.evenPage) return 'even';
  if (flags.firstPage) return 'first';
  return 'default';
}

/** Resolve furniture variant: explicit `variant` wins; else firstPage/evenPage flags. */
export function variantFromCommand(command: {
  readonly variant?: FurnitureVariant;
  readonly firstPage?: boolean;
  readonly evenPage?: boolean;
}): FurnitureVariant | { readonly ok: false; readonly reason: string } {
  if (command.variant !== undefined) {
    if (
      command.variant === 'default' ||
      command.variant === 'first' ||
      command.variant === 'even'
    ) {
      return command.variant;
    }
    return { ok: false, reason: "variant must be 'default', 'first', or 'even'" };
  }
  return variantFromFlags(command);
}

export function slotArgsFromCommand(
  mounted: PaginatedSurface,
  command: {
    readonly position?: 'header' | 'footer';
    readonly variant?: FurnitureVariant;
    readonly firstPage?: boolean;
    readonly evenPage?: boolean;
    readonly sectionIndex?: number;
  }
):
  | {
      readonly ok: true;
      readonly sectionIndex: number;
      readonly kind: 'header' | 'footer';
      readonly variant: FurnitureVariant;
    }
  | { readonly ok: false; readonly refusal: Exclude<ExecResult, { ok: true }> } {
  const state = mounted.headerFooterState();
  const kind = command.position ?? state?.editing ?? null;
  if (kind !== 'header' && kind !== 'footer') {
    return {
      ok: false,
      refusal: {
        ok: false,
        code: 'invalidArgs',
        reason: 'header/footer position is required when no furniture scope is open',
      },
    };
  }
  const hasExplicitVariant =
    command.variant !== undefined ||
    command.firstPage !== undefined ||
    command.evenPage !== undefined;
  const resolved = hasExplicitVariant ? variantFromCommand(command) : (state?.variant ?? 'default');
  if (typeof resolved === 'object' && resolved.ok === false) {
    return { ok: false, refusal: { ok: false, code: 'invalidArgs', reason: resolved.reason } };
  }
  const variant = resolved as FurnitureVariant;
  const sectionIndex = command.sectionIndex ?? state?.sectionIndex ?? 0;
  if (!Number.isInteger(sectionIndex) || sectionIndex < 0) {
    return {
      ok: false,
      refusal: {
        ok: false,
        code: 'invalidArgs',
        reason: 'sectionIndex must be a non-negative integer',
      },
    };
  }
  return { ok: true, sectionIndex, kind, variant };
}

function lifecycleRefusal(reason: string | undefined): Exclude<ExecResult, { ok: true }> {
  const detail = reason ?? 'rejected';
  if (detail === 'first-section' || detail.includes('first-section')) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: 'the first section cannot link to a previous header or footer',
    };
  }
  return {
    ok: false,
    code: 'invalidArgs',
    reason: `header/footer lifecycle refused: ${detail}`,
  };
}

/** Apply one package lifecycle op through the surface commit path; returns engine refusal. */
export function applyLifecycle(
  mounted: PaginatedSurface,
  op: Extract<
    TreeDocOp,
    | { op: 'createHeaderFooter' }
    | { op: 'deleteHeaderFooter' }
    | { op: 'linkToPrevious' }
    | { op: 'unlinkFromPrevious' }
    | { op: 'setSectionFurnitureOptions' }
    | { op: 'setDocumentProtection' }
  >
): ExecResult {
  if (typeof mounted.applyHeaderFooterLifecycle !== 'function') {
    return { ok: false, code: 'unsupported', reason: 'header/footer lifecycle is not available' };
  }
  const result = mounted.applyHeaderFooterLifecycle(op);
  if (!result.ok) return lifecycleRefusal(result.reason);
  return { ok: true, changed: true };
}

export function resolveSlot(
  mounted: PaginatedSurface,
  sectionIndex: number,
  kind: 'header' | 'footer',
  variant: FurnitureVariant
): {
  readonly rId: string;
  readonly partName: string;
  readonly inherited: boolean;
  readonly titlePage: boolean;
  readonly evenAndOddHeaders: boolean;
} | null {
  const bySection = mounted.session.headerFooterResolutionBySection();
  const section = bySection[sectionIndex];
  if (!section) return null;
  const slots = kind === 'header' ? section.headers : section.footers;
  const slot = slots.get(variant);
  if (!slot) return null;
  return {
    rId: slot.rId,
    partName: slot.partName,
    inherited: slot.inherited,
    titlePage: section.titlePage,
    evenAndOddHeaders: section.evenAndOddHeaders,
  };
}

/** Open (or create then open) the requested furniture story. */
export function execEditHeaderFooter(
  mounted: PaginatedSurface,
  command: Extract<EditorCommand, { type: 'editHeaderFooter' }>
): ExecResult {
  if (typeof mounted.enterHeaderFooter !== 'function') {
    return { ok: false, code: 'unsupported', reason: 'header/footer editing is not available' };
  }
  const sectionIndex = command.sectionIndex ?? 0;
  if (!Number.isInteger(sectionIndex) || sectionIndex < 0) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: 'sectionIndex must be a non-negative integer',
    };
  }
  const kind = command.position;
  const resolved = variantFromCommand(command);
  if (typeof resolved === 'object' && resolved.ok === false) {
    return { ok: false, code: 'invalidArgs', reason: resolved.reason };
  }
  const variant = resolved as FurnitureVariant;
  const existing = resolveSlot(mounted, sectionIndex, kind, variant);
  let rId = existing?.rId;
  let created = false;
  if (!rId) {
    // Create + matching titlePg / evenAndOddHeaders flag is ONE package history unit.
    const createdResult = applyLifecycle(mounted, {
      op: 'createHeaderFooter',
      sectionIndex,
      kind,
      variant,
      ...(variant === 'first' ? { titlePage: true } : {}),
      ...(variant === 'even' ? { evenAndOddHeaders: true } : {}),
    });
    if (!createdResult.ok) return createdResult;
    created = true;
    rId = resolveSlot(mounted, sectionIndex, kind, variant)?.rId;
  }
  if (!rId) {
    return {
      ok: false,
      code: 'notFound',
      reason: `no ${kind} story is available to edit`,
    };
  }
  const opened = mounted.enterHeaderFooter({ rId, kind, sectionIndex, variant });
  if (!opened) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: 'the header/footer relationship could not be opened',
    };
  }
  return { ok: true, changed: created };
}

export function execRemoveHeaderFooter(
  mounted: PaginatedSurface,
  command: Extract<EditorCommand, { type: 'removeHeaderFooter' }>
): ExecResult {
  const slot = slotArgsFromCommand(mounted, command);
  if (!slot.ok) return slot.refusal;
  const active = mounted.headerFooterState();
  const beforeRId = active?.rId;
  const result = applyLifecycle(mounted, {
    op: 'deleteHeaderFooter',
    sectionIndex: slot.sectionIndex,
    kind: slot.kind,
    variant: slot.variant,
  });
  if (!result.ok) return result;
  // Deleting the open declared story leaves nothing to edit — exit to body.
  if (
    beforeRId &&
    active?.editing === slot.kind &&
    active.sectionIndex === slot.sectionIndex &&
    active.variant === slot.variant
  ) {
    mounted.exitHeaderFooter();
  }
  return result;
}

export function execLinkHeaderFooter(
  mounted: PaginatedSurface,
  command: Extract<EditorCommand, { type: 'linkHeaderFooterToPrevious' }>
): ExecResult {
  const slot = slotArgsFromCommand(mounted, command);
  if (!slot.ok) return slot.refusal;
  if (slot.sectionIndex === 0) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: 'the first section cannot link to a previous header or footer',
    };
  }
  const active = mounted.headerFooterState();
  const touchingActive =
    active?.editing === slot.kind &&
    active.sectionIndex === slot.sectionIndex &&
    active.variant === slot.variant;
  const result = applyLifecycle(mounted, {
    op: 'linkToPrevious',
    sectionIndex: slot.sectionIndex,
    kind: slot.kind,
    variant: slot.variant,
  });
  if (!result.ok) return result;
  if (touchingActive) {
    // After link, the slot is inherited from the previous section (new rId) or blank.
    const next = resolveSlot(mounted, slot.sectionIndex, slot.kind, slot.variant);
    if (next) {
      mounted.enterHeaderFooter({
        rId: next.rId,
        kind: slot.kind,
        sectionIndex: slot.sectionIndex,
      });
    } else {
      mounted.exitHeaderFooter();
    }
  }
  return result;
}

export function execUnlinkHeaderFooter(
  mounted: PaginatedSurface,
  command: Extract<EditorCommand, { type: 'unlinkHeaderFooterFromPrevious' }>
): ExecResult {
  const slot = slotArgsFromCommand(mounted, command);
  if (!slot.ok) return slot.refusal;
  const active = mounted.headerFooterState();
  const touchingActive =
    !!active &&
    active.editing === slot.kind &&
    active.sectionIndex === slot.sectionIndex &&
    active.variant === slot.variant;
  const beforeRId = active?.rId;
  const result = applyLifecycle(mounted, {
    op: 'unlinkFromPrevious',
    sectionIndex: slot.sectionIndex,
    kind: slot.kind,
    variant: slot.variant,
  });
  if (!result.ok) return result;
  const next = resolveSlot(mounted, slot.sectionIndex, slot.kind, slot.variant);
  if (touchingActive && next && next.rId !== beforeRId) {
    mounted.enterHeaderFooter({
      rId: next.rId,
      kind: slot.kind,
      sectionIndex: slot.sectionIndex,
    });
  }
  return result;
}

export function execSetHeaderFooterOptions(
  mounted: PaginatedSurface,
  command: Extract<EditorCommand, { type: 'setHeaderFooterOptions' }>
): ExecResult {
  const state = mounted.headerFooterState();
  const sectionIndex = command.sectionIndex ?? state?.sectionIndex;
  return applyLifecycle(mounted, {
    op: 'setSectionFurnitureOptions',
    ...(sectionIndex !== undefined ? { sectionIndex } : {}),
    ...(command.titlePage !== undefined ? { titlePage: command.titlePage } : {}),
    ...(command.evenAndOddHeaders !== undefined
      ? { evenAndOddHeaders: command.evenAndOddHeaders }
      : {}),
    ...(command.headerDistanceTwips !== undefined
      ? { headerDistanceTwips: command.headerDistanceTwips }
      : {}),
    ...(command.footerDistanceTwips !== undefined
      ? { footerDistanceTwips: command.footerDistanceTwips }
      : {}),
  });
}

export function execInsertPageField(
  mounted: PaginatedSurface,
  command: Extract<EditorCommand, { type: 'insertPageField' }>
): ExecResult {
  const scope = mounted.activeScope();
  if (scope.kind !== 'headerFooter') {
    return {
      ok: false,
      code: 'unsupported',
      reason: 'insertPageField requires an open header or footer scope',
    };
  }
  if (typeof mounted.insertPageField !== 'function') {
    return { ok: false, code: 'unsupported', reason: 'page field insertion is not available' };
  }
  const ok = mounted.insertPageField(command.field);
  if (!ok) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: mounted.state().lastRejection ?? 'page field insertion was refused',
    };
  }
  return { ok: true, changed: true };
}
