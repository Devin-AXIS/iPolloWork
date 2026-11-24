// Repairing the built-in List Paragraph style for a list gesture.
//
// Word puts `w:contextualSpacing` on List Paragraph. Some converters keep the built-in
// name and id but omit that property. Applying such a style preserves each paragraph's
// direct before/after spacing between consecutive items, which makes the new list look
// unlike the list Word creates.

import { createNodeIdAllocator, insertChildren, replaceNode } from './ooxml-edit.ts';
import { stylesPartOf } from './ooxml-indexes.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { readOoxmlPart } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STYLES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | null {
  for (const child of node.children) {
    if (child.kind !== 'textValue' && child.namespaceUri === W && child.localName === localName) {
      return child;
    }
  }
  return null;
}

function attribute(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((entry) => entry.namespaceUri === W && entry.localName === localName)
    ?.value;
}

function enabled(node: OoxmlElement): boolean {
  const value = attribute(node, 'val');
  return value === undefined || value === '1' || value === 'true' || value === 'on';
}

function withFreshIds(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return Object.freeze({ ...node, id: nextId() });
  return Object.freeze({
    ...node,
    id: nextId(),
    children: node.children.map((child) => withFreshIds(child, nextId)),
  }) as OoxmlElement;
}

function authoredParagraphProperties(part: OoxmlPart): OoxmlElement | null {
  const read = readOoxmlPart(
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="ListParagraph">` +
      '<w:pPr><w:contextualSpacing/></w:pPr></w:style></w:styles>',
    { name: part.name, contentType: STYLES_CONTENT_TYPE }
  );
  if (!read.ok) return null;
  const style = childNamed(read.part.root, 'style');
  const pPr = style ? childNamed(style, 'pPr') : null;
  return pPr ? (withFreshIds(pPr, createNodeIdAllocator(part)) as OoxmlElement) : null;
}

// CT_PPrBase order through the slot used here. Later children remain after the insertion.
const PPR_SEQUENCE = [
  'pStyle',
  'keepNext',
  'keepLines',
  'pageBreakBefore',
  'framePr',
  'widowControl',
  'numPr',
  'suppressLineNumbers',
  'pBdr',
  'shd',
  'tabs',
  'suppressAutoHyphens',
  'kinsoku',
  'wordWrap',
  'overflowPunct',
  'topLinePunct',
  'autoSpaceDE',
  'autoSpaceDN',
  'bidi',
  'adjustRightInd',
  'snapToGrid',
  'spacing',
  'ind',
  'contextualSpacing',
  'mirrorIndents',
  'suppressOverlap',
  'jc',
  'textDirection',
  'textAlignment',
  'textboxTightWrap',
  'outlineLvl',
  'divId',
  'cnfStyle',
  'rPr',
  'sectPr',
  'pPrChange',
] as const;

function sequenceInsertIndex(children: readonly OoxmlNode[], localName: string): number {
  const rank = PPR_SEQUENCE.indexOf(localName as (typeof PPR_SEQUENCE)[number]);
  let at = 0;
  children.forEach((child, index) => {
    if (child.kind === 'textValue') return;
    const childRank = PPR_SEQUENCE.indexOf(child.localName as (typeof PPR_SEQUENCE)[number]);
    if (childRank !== -1 && childRank <= rank) at = index + 1;
  });
  return at;
}

/**
 * Ensure one paragraph style carries Word's contextual-spacing rule.
 *
 * Returns the unchanged package when the rule is already on. Returns null when the named
 * paragraph style or a valid authored replacement cannot be found.
 */
export function ensureListParagraphContextualSpacing(
  pkg: OoxmlPackage,
  styleId: string
): OoxmlPackage | null {
  const part = stylesPartOf(pkg);
  if (!part) return null;
  let style: OoxmlElement | null = null;
  for (const node of part.root.children) {
    if (node.kind === 'textValue') continue;
    if (
      node.namespaceUri === W &&
      node.localName === 'style' &&
      attribute(node, 'type') === 'paragraph' &&
      attribute(node, 'styleId') === styleId
    ) {
      style = node;
      break;
    }
  }
  if (!style) return null;
  const name = childNamed(style, 'name');
  if (
    name &&
    attribute(name, 'val')?.trim().toLowerCase() !== 'list paragraph' &&
    styleId !== 'ListParagraph'
  ) {
    return null;
  }

  const authored = authoredParagraphProperties(part);
  if (!authored) return null;
  const authoredContextual = childNamed(authored, 'contextualSpacing');
  if (!authoredContextual) return null;

  const pPr = childNamed(style, 'pPr');
  let edited;
  if (!pPr) {
    const firstLater = style.children.findIndex(
      (child) =>
        child.kind !== 'textValue' &&
        ['rPr', 'tblPr', 'tcPr', 'tblStylePr'].includes(child.localName)
    );
    edited = insertChildren(
      part,
      style.id,
      firstLater === -1 ? style.children.length : firstLater,
      [authored]
    );
  } else {
    const existing = childNamed(pPr, 'contextualSpacing');
    if (existing && enabled(existing)) return pkg;
    edited = existing
      ? replaceNode(part, existing.id, authoredContextual)
      : insertChildren(part, pPr.id, sequenceInsertIndex(pPr.children, 'contextualSpacing'), [
          authoredContextual,
        ]);
  }
  if (!edited.ok) return null;
  return Object.freeze({
    ...pkg,
    parts: new Map([...pkg.parts, [part.name, edited.part]]),
  });
}
