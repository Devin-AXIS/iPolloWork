import { drawingRenderers } from './drawing-renderers.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI as A, type OoxmlElement } from './ooxml-tree.ts';

/**
 * A drawing feature that the editor does not show as authored. Each code means:
 *
 * - `unsupported-effect`: the editor ignores an explicit effect, such as `a:blur`, `a:duotone`,
 *   or `a14:imgProps`. The drawing renders without it.
 * - `renderer-required`: an optional effect, such as `a:glow`, needs the drawing module:
 *   `drawingModule()` or `installDrawing()` from `@docx-editor.dev/pro/drawing`. It appears
 *   only while that module is not installed in the current process, for occurrences and
 *   reports alike.
 * - `unverified-3d`: the drawing has 3-D properties (`a:scene3d`, `a:sp3d`), which render flat.
 * - `saved-fallback`: the editor shows the saved `mc:Fallback` content, not the main content.
 * - `unplaced-drawing`: the drawing has no layout position, so the editor does not show it.
 * - `inspection-limit`: a scan budget stopped the check, so the result is incomplete.
 * - `projection-diagnostic`: the source is malformed or partly unusable. `detail` holds the
 *   diagnostic code, such as `invalid-geometry` or `resource-refused`.
 *
 * The check reads the drawing's own XML. It does not read chart or diagram parts, inherited
 * theme effects, or image bytes, so an empty list does not prove full fidelity.
 *
 * @public
 */
export interface DrawingSupportIssue {
  /** The kind of limitation. The list in this type's description explains each code. */
  readonly code:
    | 'unsupported-effect'
    | 'renderer-required'
    | 'unverified-3d'
    | 'saved-fallback'
    | 'unplaced-drawing'
    | 'inspection-limit'
    | 'projection-diagnostic';
  /**
   * The source node with the feature: in the inspected package for a report, or in the
   * editor's current document for an occurrence's `drawingIssues`.
   */
  readonly nodeId: string;
  /** The namespace of the node with the feature. */
  readonly namespaceUri: string;
  /** The local name of the node with the feature, such as `blur`. */
  readonly localName: string;
  /** The feature, such as `a:blur` or `mc:Fallback`, or the projection diagnostic code. */
  readonly detail: string;
}

/**
 * How completely the editor shows a drawing:
 *
 * - `native`: the editor renders the drawing and found no unsupported feature in its source.
 * - `partial`: the editor renders the drawing, but without some features, or it shows a saved
 *   fallback. The issue list names the features.
 * - `unrendered`: the editor shows a placeholder, or the drawing has no layout position.
 *
 * A drawing that the document itself hides is `native` or `partial`: the editor shows it as
 * authored, which is not at all.
 *
 * Charts and SmartArt diagrams that the editor draws report `native`, because the check does
 * not read their chart or diagram parts. Inherited theme effects and image bytes are not
 * checked either.
 *
 * @public
 */
export type DrawingSupport = 'native' | 'partial' | 'unrendered';

const PARTIAL_CODES: ReadonlySet<DrawingSupportIssue['code']> = new Set([
  'unsupported-effect',
  'renderer-required',
  'unverified-3d',
  'saved-fallback',
  'inspection-limit',
  'projection-diagnostic',
]);

/** One verdict for the editor and the source report, from what each knows about a drawing. */
export function drawingSupport(
  shown: 'placeholder' | 'fallback' | 'rendered',
  issues: readonly DrawingSupportIssue[]
): DrawingSupport {
  if (shown === 'placeholder') return 'unrendered';
  if (shown === 'fallback') return 'partial';
  // A malformed wrap polygon changes text flow around the drawing, not the drawing itself.
  return issues.some(
    (issue) => PARTIAL_CODES.has(issue.code) && !issue.detail.startsWith('wrap-polygon')
  )
    ? 'partial'
    : 'native';
}

const BLIP_EFFECTS = new Set(['alphaModFix', 'biLevel', 'grayscl', 'lum', 'extLst']);
const OPTIONAL_EFFECTS = new Set(['glow', 'innerShdw', 'reflection', 'softEdge']);
const UNSUPPORTED_EFFECTS = new Set(['blur', 'fillOverlay', 'prstShdw']);
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export function supportIssue(
  node: OoxmlElement,
  code: DrawingSupportIssue['code'],
  detail: string
): DrawingSupportIssue {
  return Object.freeze({
    code,
    nodeId: node.id,
    namespaceUri: node.namespaceUri,
    localName: node.localName,
    detail,
  });
}

/** Find the displayed drawing and its compatibility branch without scanning unrelated parts. */
export function drawingSourceSelection(
  source: OoxmlElement,
  drawingNodeId: string
): {
  readonly node: OoxmlElement;
  readonly fallback: boolean;
  readonly complete: boolean;
} {
  const stack = [{ node: source, fallback: false }];
  let visited = 0;
  while (stack.length && ++visited <= 4096) {
    const item = stack.pop()!;
    if (item.node.id === drawingNodeId) return { ...item, complete: true };
    for (const child of item.node.children) {
      if (child.kind === 'textValue') continue;
      stack.push({
        node: child,
        fallback: item.fallback || (child.namespaceUri === MC && child.localName === 'Fallback'),
      });
    }
  }
  return { node: source, fallback: false, complete: stack.length === 0 };
}

/** Inspect explicit effects in the selected source. Theme and related-part contents are not assessed. */
export function drawingSourceIssues(
  source: OoxmlElement,
  drawingNodeId: string
): readonly DrawingSupportIssue[] {
  const selected = drawingSourceSelection(source, drawingNodeId);
  const issues: DrawingSupportIssue[] = [];
  if (!selected.complete)
    issues.push(supportIssue(source, 'inspection-limit', 'drawing-selection-budget'));
  if (selected.fallback) issues.push(supportIssue(source, 'saved-fallback', 'mc:Fallback'));
  const stack = [{ node: selected.node, parent: '', depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const { node, parent, depth } = stack.pop()!;
    if (++visited > 4096 || depth > 64) {
      issues.push(supportIssue(node, 'inspection-limit', 'drawing-source-budget'));
      break;
    }
    // Nested stories have their own drawing occurrences. Do not diagnose an inactive MC branch.
    if (node.namespaceUri === W && node.localName === 'txbxContent') continue;
    if (node.namespaceUri === MC && node.localName === 'AlternateContent') continue;
    if (node.namespaceUri === A) {
      if (
        node.localName === 'effectDag' ||
        (parent === 'blip' && !BLIP_EFFECTS.has(node.localName)) ||
        (parent === 'effectLst' && UNSUPPORTED_EFFECTS.has(node.localName))
      ) {
        issues.push(supportIssue(node, 'unsupported-effect', `a:${node.localName}`));
      } else if (
        parent === 'effectLst' &&
        OPTIONAL_EFFECTS.has(node.localName) &&
        !drawingRenderers().effects
      ) {
        issues.push(supportIssue(node, 'renderer-required', `a:${node.localName}`));
      } else if (node.localName === 'scene3d' || node.localName === 'sp3d') {
        issues.push(supportIssue(node, 'unverified-3d', `a:${node.localName}`));
      }
    } else if (
      node.namespaceUri === 'http://schemas.microsoft.com/office/drawing/2010/main' &&
      node.localName === 'imgProps'
    ) {
      issues.push(supportIssue(node, 'unsupported-effect', 'a14:imgProps'));
    }
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index]!;
      if (child.kind !== 'textValue')
        stack.push({
          node: child,
          parent: node.namespaceUri === A ? node.localName : '',
          depth: depth + 1,
        });
    }
  }
  return Object.freeze(issues);
}
