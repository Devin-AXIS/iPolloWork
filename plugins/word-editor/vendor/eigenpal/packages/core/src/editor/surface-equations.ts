// Atomic Office Math reads and writes for the paginated surface.

import { isUnsupportedComponentTarget } from '../output/unsupported-elements.ts';
import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { SemanticPosition, SemanticSelection } from '@docx-editor.dev/core/layout';
import {
  OFFICE_MATH_NAMESPACE_URI,
  equationExpressionToLinearMath,
  equationsOfAtom,
  findNode,
  parentNodeOf as parentOf,
  projectOmmlEquation,
  segmentsOf,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
  type StoryScope,
  type EquationExpression,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { isElementNode } from './host-realm.ts';

const SUGGESTING_EQUATION_REFUSAL = 'equation replacement is not supported in suggesting mode';
const SUGGESTING_DISPLAY_REFUSAL =
  'in suggesting mode, remove the whole equation block rather than one equation';
const paragraphEquationCache = new WeakMap<OoxmlParagraphNode, readonly SurfaceEquation[]>();
const sourcePreservingEquations = new WeakSet<SurfaceEquation>();
/**
 * Compact text spells fractions, radicals, scripts, and sums only. An equation in the editable
 * subset with no such spelling (an integral, for example) would open as an empty field, and
 * text applied there would replace it, so replacement is refused with this reason.
 */
const NO_LINEAR_FORM_EQUATION_REFUSAL = 'compact linear text cannot spell this equation';

/** One addressable inline equation and its compact editable projection. */
export interface SurfaceEquation {
  readonly id: string;
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
  readonly linear: string;
  readonly fallbackText: string;
  /** True when every source construct belongs to the editable subset. */
  readonly supported: boolean;
}

/** A user click on one painted equation. */
export interface EquationActivation {
  readonly equation: SurfaceEquation;
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
}

function equationsInParagraph(part: OoxmlPart, paragraphId: string): readonly SurfaceEquation[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  const cached = paragraphEquationCache.get(paragraph);
  if (cached) return cached;
  const equations: SurfaceEquation[] = [];
  for (const segment of segmentsOf(paragraph)) {
    // A display atom shares its one offset between its equations.
    for (const node of equationsOfAtom(segment.node)) {
      const projection = projectOmmlEquation(node);
      if (!projection) continue;
      const equation = Object.freeze({
        id: node.id,
        paragraphId,
        start: segment.start,
        end: segment.end,
        linear: equationExpressionToLinearMath(projection.expression),
        fallbackText: projection.fallbackText,
        supported: expressionIsSupported(projection.expression),
      });
      if (expressionNeedsSourcePreservation(projection.expression)) {
        sourcePreservingEquations.add(equation);
      }
      equations.push(equation);
    }
  }
  const result = Object.freeze(equations);
  paragraphEquationCache.set(paragraph, result);
  return result;
}

/**
 * The plain-text spelling of the equation atom at a paragraph offset: its linear form,
 * with the equations of one display separated by spaces. Null when no equation sits there.
 */
export function equationPlainText(
  part: OoxmlPart,
  paragraphId: string,
  offset: number
): string | null {
  const here = equationsInParagraph(part, paragraphId).filter(
    (equation) => equation.start === offset
  );
  if (here.length === 0) return null;
  return here.map((equation) => equation.linear || equation.fallbackText).join(' ');
}

function hasControlProperties(expression: EquationExpression): boolean {
  return 'controlProperties' in expression && expression.controlProperties === true;
}

function expressionNeedsSourcePreservation(expression: EquationExpression): boolean {
  if (hasControlProperties(expression)) return true;
  switch (expression.kind) {
    case 'bar':
    case 'borderBox':
    case 'delimiter':
      return true;
    case 'text':
      return expression.format !== undefined;
    case 'fallback':
      return false;
    case 'row':
      return expression.items.some(expressionNeedsSourcePreservation);
    case 'fraction':
      return (
        expressionNeedsSourcePreservation(expression.numerator) ||
        expressionNeedsSourcePreservation(expression.denominator)
      );
    case 'radical':
      return (
        expressionNeedsSourcePreservation(expression.radicand) ||
        (expression.degree !== undefined && expressionNeedsSourcePreservation(expression.degree))
      );
    case 'script':
      return (
        expressionNeedsSourcePreservation(expression.base) ||
        (expression.subscript !== undefined &&
          expressionNeedsSourcePreservation(expression.subscript)) ||
        (expression.superscript !== undefined &&
          expressionNeedsSourcePreservation(expression.superscript))
      );
    case 'nary':
      return (
        expression.limitLocation === 'subSup' ||
        expressionNeedsSourcePreservation(expression.body) ||
        (expression.lowerLimit !== undefined &&
          expressionNeedsSourcePreservation(expression.lowerLimit)) ||
        (expression.upperLimit !== undefined &&
          expressionNeedsSourcePreservation(expression.upperLimit))
      );
  }
}

function expressionIsSupported(expression: EquationExpression): boolean {
  if (hasControlProperties(expression)) return false;
  switch (expression.kind) {
    case 'fallback':
    case 'bar':
    case 'borderBox':
    case 'delimiter':
      return false;
    case 'text':
      return expression.format === undefined;
    case 'row':
      return expression.items.every(expressionIsSupported);
    case 'fraction':
      return (
        expressionIsSupported(expression.numerator) && expressionIsSupported(expression.denominator)
      );
    case 'radical':
      return (
        expressionIsSupported(expression.radicand) &&
        (expression.degree === undefined || expressionIsSupported(expression.degree))
      );
    case 'script':
      return (
        expressionIsSupported(expression.base) &&
        (expression.subscript === undefined || expressionIsSupported(expression.subscript)) &&
        (expression.superscript === undefined || expressionIsSupported(expression.superscript))
      );
    case 'nary':
      return (
        expressionIsSupported(expression.body) &&
        (expression.lowerLimit === undefined || expressionIsSupported(expression.lowerLimit)) &&
        (expression.upperLimit === undefined || expressionIsSupported(expression.upperLimit))
      );
  }
}

/** Boundary-inclusive lookup, matching the hyperlink and field atom popovers. */
export function equationAtPosition(
  equations: readonly SurfaceEquation[],
  position: SemanticPosition
): SurfaceEquation | null {
  return (
    equations.find(
      (equation) =>
        equation.paragraphId === position.paragraphId &&
        position.offset >= equation.start &&
        position.offset <= equation.end
    ) ?? null
  );
}

export interface EquationOpsDeps {
  readonly session: TreeDocxSessionView;
  storyScope(): StoryScope;
  editingMode(): 'edit' | 'suggest' | 'view';
  writeRefusal(op: EquationTreeOp): string | null;
  /** The ops as suggesting mode writes them: attributed when an author is set. */
  trackedOps(ops: readonly EquationTreeOp[]): EquationTreeOp[];
  selection(): SemanticSelection;
  selectionMark(): { paragraphId: string; start: number; end: number } | null;
  commit(
    run: () => TreeApplyResult | boolean,
    selectionAfter?: () => SemanticSelection | null
  ): void;
}

export type EquationAction = 'replace' | 'remove';

/** Engine-owned capability result for equation editing chrome. */
export type EquationCanResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'locked' | 'notFound' | 'unsupported';
      readonly reason: string;
    };

type EquationTreeOp = TreeDocOp;

/** Surface equation reads and atomic replace/remove writes. */
export interface EquationOps {
  equationsInCaretParagraph(): SurfaceEquation[];
  equationAtCaret(): SurfaceEquation | null;
  equationById(equationId: string): SurfaceEquation | null;
  /** Whether equation chrome can run an action, with the engine-owned refusal reason. */
  can(equationId: string, action: EquationAction): EquationCanResult;
  applyEquation(equationId: string, linear: string): boolean;
  removeEquation(equationId: string): boolean;
}

export interface EquationInteraction {
  destroy(): void;
}

/** Connect painted equation metadata to atomic selection and host chrome. */
export function createEquationInteraction(deps: {
  readonly pagesLayer: HTMLElement;
  readonly equationById: (equationId: string) => SurfaceEquation | null;
  readonly setSelection: (selection: SemanticSelection) => void;
  readonly onPopover?: (activation: EquationActivation) => void;
}): EquationInteraction {
  let pressed: { readonly equationId: string; readonly rect: EquationActivation['rect'] } | null =
    null;
  const targetFrom = (value: EventTarget | null): HTMLElement | null => {
    if (isUnsupportedComponentTarget(value)) return null;
    const view = deps.pagesLayer.ownerDocument.defaultView;
    if (!view || !isElementNode(value)) return null;
    const target = value.closest<HTMLElement>('[data-docx-equation]');
    return target && deps.pagesLayer.contains(target) ? target : null;
  };
  const activate = (equationId: string, rect: EquationActivation['rect']): void => {
    const equation = deps.equationById(equationId);
    if (!equation) return;
    // Pages that are not editable (viewing) still show the popover, with its actions disabled,
    // but the press does not select the equation whole, because nothing there can edit it.
    if (deps.pagesLayer.contentEditable !== 'false') {
      deps.setSelection({
        anchor: { paragraphId: equation.paragraphId, offset: equation.start },
        head: { paragraphId: equation.paragraphId, offset: equation.end },
      });
    }
    deps.onPopover?.({ equation, rect });
  };
  const onPointerDown = (event: PointerEvent): void => {
    pressed = null;
    const target = targetFrom(event.target);
    const equationId = target?.dataset.docxEquation;
    if (!target || !equationId) return;
    const rect = target.getBoundingClientRect();
    pressed = {
      equationId,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    };
  };
  const onClick = (event: MouseEvent): void => {
    const target = targetFrom(event.target);
    const equationId = target?.dataset.docxEquation;
    const remembered = pressed;
    pressed = null;
    if (!target || !equationId) {
      if (!remembered) return;
      event.preventDefault();
      activate(remembered.equationId, remembered.rect);
      return;
    }
    const rect = target.getBoundingClientRect();
    event.preventDefault();
    activate(equationId, {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    });
  };
  deps.pagesLayer.addEventListener('pointerdown', onPointerDown, true);
  deps.pagesLayer.addEventListener('click', onClick);
  return {
    destroy: () => {
      deps.pagesLayer.removeEventListener('pointerdown', onPointerDown, true);
      deps.pagesLayer.removeEventListener('click', onClick);
    },
  };
}

export function createEquationOps(deps: EquationOpsDeps): EquationOps {
  const activePart = (): OoxmlPart | null => deps.session.partFor(deps.storyScope());
  const equationsIn = (paragraphId: string): readonly SurfaceEquation[] => {
    const part = activePart();
    return part ? equationsInParagraph(part, paragraphId) : [];
  };
  const atCaret = (): SurfaceEquation | null => {
    const head = deps.selection().head;
    return equationAtPosition(equationsIn(head.paragraphId), head);
  };
  const byId = (equationId: string): SurfaceEquation | null => {
    const near = equationsIn(deps.selection().head.paragraphId).find(
      (equation) => equation.id === equationId
    );
    if (near) return near;
    for (const part of deps.session.storyParts()) {
      const node = findNode(part, equationId);
      if (
        !node ||
        node.kind !== 'generic' ||
        node.namespaceUri !== OFFICE_MATH_NAMESPACE_URI ||
        node.localName !== 'oMath'
      ) {
        continue;
      }
      let ancestor: OoxmlNode | null = node;
      while (ancestor && ancestor.kind !== 'paragraph') {
        ancestor = parentOf(part, ancestor.id);
      }
      if (!ancestor || ancestor.kind !== 'paragraph') return null;
      return (
        equationsInParagraph(part, ancestor.id).find((equation) => equation.id === equationId) ??
        null
      );
    }
    return null;
  };
  /** In suggesting mode a removal is a tracked deletion of the equation's one offset. */
  const removalOps = (equation: SurfaceEquation): EquationTreeOp[] =>
    deps.editingMode() === 'suggest'
      ? deps.trackedOps([
          {
            op: 'deleteText',
            paragraphId: equation.paragraphId,
            start: equation.start,
            end: equation.end,
          },
        ])
      : [{ op: 'removeMathEquation', equationId: equation.id }];
  const transact = (equation: SurfaceEquation, ops: readonly EquationTreeOp[]): boolean => {
    let committed = false;
    const after = { paragraphId: equation.paragraphId, offset: equation.start };
    deps.commit(
      () => {
        const result = deps.session.applyTreeOps(
          [...ops],
          deps.selectionMark(),
          { paragraphId: after.paragraphId, start: after.offset, end: after.offset },
          deps.storyScope()
        );
        committed = result.committed;
        return result;
      },
      () => ({ anchor: after, head: after })
    );
    return committed;
  };
  const capability = (equationId: string, action: EquationAction): EquationCanResult => {
    const equation = byId(equationId);
    if (!equation) return { ok: false, code: 'notFound', reason: 'no equation with that id' };
    // A tracked deletion strikes an equation whole; a REPLACEMENT has no tracked form yet, so
    // it is refused before `applyTreeOps` rather than made permanent and unreviewable. One
    // display holds every equation in it at ONE offset, so striking one would strike them all.
    if (deps.editingMode() === 'suggest') {
      if (action === 'replace') {
        return { ok: false, code: 'unsupported', reason: SUGGESTING_EQUATION_REFUSAL };
      }
      const shared = equationsIn(equation.paragraphId).filter((e) => e.start === equation.start);
      if (shared.length > 1) {
        return { ok: false, code: 'unsupported', reason: SUGGESTING_DISPLAY_REFUSAL };
      }
    }
    if (action === 'replace' && sourcePreservingEquations.has(equation)) {
      return {
        ok: false,
        code: 'unsupported',
        reason: 'compact linear editing cannot preserve this equation source formatting',
      };
    }
    if (
      action === 'replace' &&
      equation.supported &&
      equation.linear === '' &&
      equation.fallbackText !== ''
    ) {
      return { ok: false, code: 'unsupported', reason: NO_LINEAR_FORM_EQUATION_REFUSAL };
    }
    const [op] =
      action === 'replace'
        ? [{ op: 'setMathEquation', equationId, linear: equation.linear } as const]
        : removalOps(equation);
    const reason = op ? deps.writeRefusal(op) : null;
    return reason === null ? { ok: true } : { ok: false, code: 'locked', reason };
  };
  const refuse = (result: Exclude<EquationCanResult, { readonly ok: true }>): false => {
    deps.commit(() => ({
      committed: false,
      rejected: true,
      opCount: 0,
      reason: result.reason,
    }));
    return false;
  };

  return {
    equationsInCaretParagraph: () => [...equationsIn(deps.selection().head.paragraphId)],
    equationAtCaret: atCaret,
    equationById: byId,
    can: capability,
    applyEquation(equationId, linear) {
      const equation = byId(equationId);
      if (!equation) return false;
      const allowed = capability(equationId, 'replace');
      if (!allowed.ok) return refuse(allowed);
      if (equation.supported && equation.linear === linear) return true;
      return transact(equation, [{ op: 'setMathEquation', equationId, linear }]);
    },
    removeEquation(equationId) {
      const equation = byId(equationId);
      if (!equation) return false;
      const allowed = capability(equationId, 'remove');
      if (!allowed.ok) return refuse(allowed);
      return transact(equation, removalOps(equation));
    },
  };
}
