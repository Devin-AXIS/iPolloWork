import { previousListParagraphs, isBlankListSeparator } from './list-separator-context.ts';
import {
  findNode,
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlProperty,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import {
  cascadeParagraphFormatting,
  type StyleCascadeTable,
  type SemanticLayout,
  type SemanticPosition,
} from '@docx-editor.dev/core/layout';
import { markerHolding } from '../layout/line-segments.ts';
import { readNumPr } from '../layout/list-resolve.ts';
import { propertyElement } from '../store/store/tree-op-properties.ts';
import type { RevisionAttributionInput } from '../store/store/tree-op-types.ts';
import { nextRevisionId } from '../store/store/tree-op-revision-ids.ts';

/** Continue Word's single blank-paragraph separator between items of an existing list. */
export function listSeparatorEnter(
  part: OoxmlPart,
  layout: SemanticLayout,
  position: SemanticPosition,
  markProperties: readonly OoxmlProperty[],
  separatorStyleId: string,
  styles?: StyleCascadeTable,
  revision?: RevisionAttributionInput,
  actorId?: string
): TreeDocOp | null {
  const paragraph = findNode(part, position.paragraphId);
  if (paragraph?.kind !== 'paragraph') return null;
  const [previous, gap] = previousListParagraphs(part, paragraph);
  if (gap?.kind !== 'paragraph' || previous?.kind !== 'paragraph') return null;
  if (!isBlankListSeparator(gap)) return null;
  const marker = markerHolding(layout, paragraph.id);
  const priorMarker = markerHolding(layout, previous.id);
  if (!marker || marker.numId !== priorMarker?.numId || marker.level !== priorMarker.level)
    return null;
  if (markerHolding(layout, gap.id)) return null;

  const element = (
    id: string,
    kind: OoxmlElement['kind'],
    localName: string,
    children: readonly OoxmlNode[]
  ): OoxmlElement =>
    ({
      id,
      kind,
      localName,
      namespaceUri: WML_NAMESPACE_URI,
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children,
    }) as OoxmlElement;
  const pPr = paragraph.children.find((node) => node.kind === 'paragraphProperties');
  // The original section mark stays on the tail, just as with an ordinary split.
  const headProperties = pPr && {
    ...pPr,
    children: pPr.children.filter((node) => node.localName !== 'sectPr'),
  };
  const style = propertyElement(
    { localName: 'pStyle', attributes: { val: separatorStyleId } },
    'separator-style'
  );
  const markChildren = markProperties.map((property, at) =>
    propertyElement(property, `separator-format-${at}`)
  );
  if (revision)
    markChildren.push(
      propertyElement(
        {
          localName: 'ins',
          attributes: {
            id: nextRevisionId(part, actorId)(),
            author: revision.author,
            ...(revision.date ? { date: revision.date } : {}),
          },
        },
        'separator-insertion'
      )
    );
  const mark = element('separator-mark', 'runProperties', 'rPr', markChildren);
  // Word gives the separator List Paragraph and the typing face, not the previous gap's
  // indents, numbering, spacing, bookmarks, or section properties.
  const separatorProperties = element('separator-properties', 'paragraphProperties', 'pPr', [
    ...(style ? [style] : []),
    ...(markChildren.length ? [mark] : []),
  ]);
  const separatorChildren = [...separatorProperties.children];
  // A newly materialized built-in will inherit the document's default paragraph style.
  // Resolve that inheritance now, before the style-creation package edit is committed.
  const numberingProperties = styles?.styles.has(separatorStyleId)
    ? separatorProperties
    : element('separator-defaults', 'paragraphProperties', 'pPr', []);
  if (
    styles &&
    readNumPr(cascadeParagraphFormatting(styles, numberingProperties).paragraphPropertyNodes)
  ) {
    separatorChildren.splice(
      style ? 1 : 0,
      0,
      element('separator-numbering', 'generic', 'numPr', [
        propertyElement({ localName: 'numId', attributes: { val: '0' } }, 'separator-number-id'),
      ])
    );
  }
  return {
    op: 'insertFragment',
    paragraphId: paragraph.id,
    offset: position.offset,
    blocks: [
      element('separator-head', 'paragraph', 'p', headProperties ? [headProperties] : []),
      element('separator-blank', 'paragraph', 'p', [
        element('separator-properties-final', 'paragraphProperties', 'pPr', separatorChildren),
      ]),
    ],
    lastMarkCovered: true,
  };
}
