// Layout-only projection of opaque content. Canonical package nodes stay untouched.
import type {
  HeadlessDocumentView,
  OoxmlElement,
  OoxmlNode,
  OoxmlPart,
} from '@docx-editor.dev/core/store';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import { isRunDrawingAtom } from './field-drawing-atom.ts';
import type { UnsupportedElement, UnsupportedElementLayout } from './unsupported-content-types.ts';
import { projectOmmlEquation } from '../store/package/omml-equation.ts';

/** Reserved geometry for one opaque content component. @internal */
export interface UnsupportedContentRecord {
  readonly element: UnsupportedElement;
  readonly display: 'inline' | 'block';
  readonly width: number;
  readonly height: number;
}
/** Host dimensions in points; absent keeps the engine's hidden fallback. @internal */
export type UnsupportedContentResolver = (
  element: UnsupportedElement
) => UnsupportedElementLayout | null | undefined;

const records = new WeakMap<OoxmlNode, UnsupportedContentRecord>();
const blockParagraphs = new WeakMap<OoxmlNode, OoxmlElement>();
const BLOCK_CONTAINERS = new Set([
  'body',
  'hdr',
  'ftr',
  'footnote',
  'endnote',
  'tc',
  'txbxContent',
]);
const INLINE_CONTAINERS = new Set(['p', 'r', 'hyperlink', 'ins', 'del', 'moveFrom', 'moveTo']);
const INVISIBLE_WML = new Set([
  'sectPr',
  'pPr',
  'rPr',
  'tblPr',
  'tblGrid',
  'trPr',
  'tcPr',
  'bookmarkStart',
  'bookmarkEnd',
  'proofErr',
  'permStart',
  'permEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
  'customXmlInsRangeStart',
  'customXmlInsRangeEnd',
  'customXmlDelRangeStart',
  'customXmlDelRangeEnd',
  'fldChar',
  'instrText',
  'delInstrText',
  'lastRenderedPageBreak',
  'sym',
  'ptab',
  'sdtPr',
  'sdtEndPr',
]);

function contentPlacement(parent: OoxmlElement, inherited?: 'inline' | 'block') {
  if (parent.namespaceUri === WML_NAMESPACE_URI) {
    if (BLOCK_CONTAINERS.has(parent.localName)) return 'block';
    if (INLINE_CONTAINERS.has(parent.localName)) return 'inline';
    if (parent.localName === 'sdtContent' || parent.localName === 'sdt') return inherited;
  }
  return undefined;
}

/** Metadata is never a component candidate, including demoted property nodes. @internal */
export function isUnsupportedContentCandidate(node: OoxmlNode): node is OoxmlElement {
  if (node.kind !== 'generic' || isRunDrawingAtom(node) || projectOmmlEquation(node)) return false;
  if (node.namespaceUri !== WML_NAMESPACE_URI) return true;
  return !INVISIBLE_WML.has(node.localName) && !node.localName.endsWith('Pr');
}

/** Geometry exists only on a host's projected clone. @internal */
export function unsupportedContentOf(node: OoxmlNode): UnsupportedContentRecord | undefined {
  return records.get(node);
}

/** A block's read-only layout paragraph, never inserted into the document store. @internal */
export function unsupportedBlockParagraph(node: OoxmlNode): OoxmlElement | undefined {
  const record = records.get(node);
  if (!record || record.element.placement !== 'block' || node.kind === 'textValue')
    return undefined;
  const existing = blockParagraphs.get(node);
  if (existing) return existing;
  const paragraph = {
    ...node,
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    attributes: [],
    children: [node],
  } as OoxmlElement;
  blockParagraphs.set(node, paragraph);
  return paragraph;
}

/** Whether a paragraph reserves an opaque block instead of editable model content. @internal */
export function isUnsupportedLayoutParagraph(node: OoxmlNode): boolean {
  return (
    node.kind === 'paragraph' &&
    node.children.some(
      (child) => records.get(child)?.element.placement === 'block' && child.id === node.id
    )
  );
}

/**
 * Create one projection per renderer registration set. Reused source parts retain identity.
 * The result is layout input only. Never serialize it or use it as an editing store.
 * @internal
 */
export function createUnsupportedContentProjector(resolve: UnsupportedContentResolver): {
  part(part: OoxmlPart): OoxmlPart;
  view(view: HeadlessDocumentView): HeadlessDocumentView;
} {
  const parts = new WeakMap<OoxmlPart, OoxmlPart>();
  const nodes = new WeakMap<OoxmlNode, OoxmlNode>();
  const visit = (
    node: OoxmlNode,
    partName: string,
    placement?: 'inline' | 'block',
    depth = 0
  ): OoxmlNode => {
    if (node.kind === 'textValue' || depth > 128) return node;
    const existing = nodes.get(node);
    if (existing) return existing;
    if (placement && isUnsupportedContentCandidate(node)) {
      const element: UnsupportedElement = Object.freeze({
        nodeId: node.id,
        ownerPartName: partName,
        namespaceUri: node.namespaceUri || null,
        localName: node.localName,
        source: node,
        placement,
        label: node.localName,
      });
      const size = resolve(element);
      if (
        !size ||
        !Number.isFinite(size.width) ||
        !Number.isFinite(size.height) ||
        size.width <= 0 ||
        size.height <= 0
      )
        return node;
      const clone = { ...node };
      records.set(
        clone,
        Object.freeze({
          element,
          display: placement,
          width: Math.min(size.width, 100_000),
          height: Math.min(size.height, 100_000),
        })
      );
      nodes.set(node, clone);
      return clone;
    }
    // Properties and drawing payloads are not document content slots.
    if (
      node.kind === 'generic' &&
      !['sdtContent', 'hdr', 'ftr', 'footnotes', 'endnotes', 'txbxContent'].includes(node.localName)
    )
      return node;
    if (node.kind === 'drawing' || node.localName.endsWith('Pr')) return node;
    const nextPlacement = contentPlacement(node, placement);
    let changed = false;
    const children = node.children.map((child) => {
      const next = visit(child, partName, nextPlacement, depth + 1);
      changed ||= next !== child;
      return next;
    });
    const result = changed ? ({ ...node, children } as OoxmlElement) : node;
    nodes.set(node, result);
    return result;
  };
  const projectPart = (part: OoxmlPart): OoxmlPart => {
    const cached = parts.get(part);
    if (cached) return cached;
    const root = visit(part.root, part.name) as OoxmlElement;
    const result = root === part.root ? part : { ...part, root };
    parts.set(part, result);
    return result;
  };
  return {
    part: projectPart,
    view(view) {
      const overrides: Partial<HeadlessDocumentView> = {
        part: () => projectPart(view.part()),
        currentPackage: () => {
          const source = view.currentPackage();
          return {
            ...source,
            parts: new Map(Array.from(source.parts, ([name, part]) => [name, projectPart(part)])),
          };
        },
        packageRevision: () => view.packageRevision(),
        stylesRoot: () => view.stylesRoot(),
        numberingRoot: () => view.numberingRoot(),
        settingsRoot: () => view.settingsRoot(),
        documentThemeFonts: () => view.documentThemeFonts(),
        documentProperties: () => view.documentProperties(),
        relationshipTarget: (id) => view.relationshipTarget(id),
        headerFooterPartsBySection: () =>
          view.headerFooterPartsBySection().map((section) => ({
            ...section,
            headers: new Map(
              Array.from(section.headers, ([variant, part]) => [variant, projectPart(part)])
            ),
            footers: new Map(
              Array.from(section.footers, ([variant, part]) => [variant, projectPart(part)])
            ),
          })),
        ...(view.headerFooterResolutionBySection
          ? {
              headerFooterResolutionBySection: () =>
                view.headerFooterResolutionBySection!().map((section) => ({
                  ...section,
                  headers: new Map(
                    Array.from(section.headers, ([variant, slot]) => [
                      variant,
                      { ...slot, part: projectPart(slot.part) },
                    ])
                  ),
                  footers: new Map(
                    Array.from(section.footers, ([variant, slot]) => [
                      variant,
                      { ...slot, part: projectPart(slot.part) },
                    ])
                  ),
                })),
            }
          : {}),
      };
      // Forward new view capabilities without losing their original receiver.
      return new Proxy(overrides as HeadlessDocumentView, {
        get(_target, key) {
          if (Object.prototype.hasOwnProperty.call(overrides, key))
            return Reflect.get(overrides, key);
          const value = Reflect.get(view, key, view);
          return typeof value === 'function' ? value.bind(view) : value;
        },
      });
    },
  };
}
