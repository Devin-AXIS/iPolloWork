import type { HeadlessDocumentView } from '@docx-editor.dev/core/store';
import { partOfNodeId } from './surface-scope.ts';
import { findNode, parentNodeOf, type OoxmlPart } from '@docx-editor.dev/core/store';

/** Include both compatibility branches when a drawing needs a custom preview. */
export function unsupportedSourceInPart(part: OoxmlPart, nodeId: string) {
  const node = findNode(part, nodeId);
  if (!node || node.kind === 'textValue') return null;
  const parent = parentNodeOf(part, nodeId);
  const mc = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
  if (
    parent?.namespaceUri === mc &&
    (parent.localName === 'Choice' || parent.localName === 'Fallback')
  ) {
    const wrapper = parentNodeOf(part, parent.id);
    if (wrapper?.namespaceUri === mc && wrapper.localName === 'AlternateContent') return wrapper;
  }
  return node;
}

import type {
  UnsupportedElement,
  UnsupportedElementRule,
} from '../layout/unsupported-content-types.ts';
import { createUnsupportedContentProjector } from '../layout/unsupported-content.ts';

/** Validate host geometry once, before a document layout pass. */
export function validateUnsupportedElementRules(
  rules: readonly UnsupportedElementRule[]
): readonly UnsupportedElementRule[] {
  return rules.map((rule) => {
    if (rule.match !== undefined && typeof rule.match !== 'function') {
      throw new TypeError('UnsupportedElement match must be a function.');
    }
    if (rule.includePartial !== undefined && typeof rule.includePartial !== 'boolean') {
      throw new TypeError('UnsupportedElement includePartial must be a boolean.');
    }
    const layout = rule.layout;
    if (
      layout &&
      (!Number.isFinite(layout.width) ||
        !Number.isFinite(layout.height) ||
        layout.width <= 0 ||
        layout.height <= 0 ||
        layout.width > 100_000 ||
        layout.height > 100_000)
    )
      throw new RangeError(
        'UnsupportedElement layout requires positive dimensions up to 100000 points.'
      );
    return Object.freeze({ ...rule, ...(layout ? { layout: Object.freeze({ ...layout }) } : {}) });
  });
}

export function createUnsupportedElementProjection(rules: readonly UnsupportedElementRule[]) {
  const geometry = new Map<string, string>();
  const projector = createUnsupportedContentProjector((element: UnsupportedElement) => {
    const rule = rules.find((candidate) => candidate.match?.(element) ?? true);
    const size = rule
      ? (rule.layout ??
        (element.placement === 'block' ? { width: 240, height: 96 } : { width: 120, height: 24 }))
      : null;
    geometry.set(
      `${element.ownerPartName}\u0000${element.nodeId}`,
      size ? `${size.width},${size.height}` : 'hidden'
    );
    return size;
  });
  return {
    ...projector,
    includePartial: rules.some((rule) => rule.includePartial === true),
    geometryKey: () => JSON.stringify([...geometry].sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** Keep live registrations across surface detach, reload, and reattachment. */
export function createUnsupportedElementState(
  initial: readonly UnsupportedElementRule[] | undefined,
  surface: () => {
    setUnsupportedElementRules(rules: readonly UnsupportedElementRule[]): void;
  } | null
) {
  let rules = validateUnsupportedElementRules(initial ?? []);
  return {
    current: () => rules,
    set(next: readonly UnsupportedElementRule[]) {
      const validated = validateUnsupportedElementRules(next);
      surface()?.setUnsupportedElementRules(validated);
      rules = validated;
    },
  };
}

/** Resolve source metadata at paint time, including revisions without geometry changes. */
export function unsupportedElementPaintOptions(
  projection: ReturnType<typeof createUnsupportedElementProjection>,
  session: HeadlessDocumentView
) {
  return {
    includePartial: projection.includePartial,
    unsupportedOwnerPartName: (nodeId: string) =>
      partOfNodeId(session, nodeId)?.name ?? session.part().name,
    unsupportedSource: (nodeId: string, ownerPartName?: string) => {
      const part = ownerPartName
        ? session.currentPackage().parts.get(ownerPartName)
        : partOfNodeId(session, nodeId);
      return part ? unsupportedSourceInPart(part, nodeId) : null;
    },
  };
}
