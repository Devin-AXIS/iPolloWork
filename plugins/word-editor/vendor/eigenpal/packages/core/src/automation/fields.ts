import { escapeXmlAttribute } from '../store/package/sinks.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { fieldOnOffAttribute } from '../store/package/field-nodes.ts';
import {
  readOoxmlPart,
  type OoxmlPart,
  type OoxmlParagraphNode,
} from '../store/package/ooxml-tree.ts';
import { storyParagraphs } from '../store/package/story-blocks.ts';
import { locateFieldResults } from '../store/store/tree-op-field-results.ts';
import { segmentsOf } from '../store/store/tree-op-segments.ts';
import { supportedPageFieldCode } from '../store/store/tree-op-field-code.ts';
export { supportedPageFieldCode };

/** Actual semantic pagination at this field, supplied by the document host. */
export interface AutomationFieldPageContext {
  readonly pageNumberText?: string;
  readonly pageNumber: number;
  readonly pageCount: number;
}
export interface AutomationFieldRead {
  readonly paragraphId: string;
  readonly fieldNodeId: string;
  readonly code: string;
  readonly start: number;
  readonly end: number;
  readonly rewritable: boolean;
  readonly locked: boolean;
}
/**
 * The fields of each paragraph node, by node identity. A tree edit replaces the nodes it
 * touches, so a cached answer never outlives the paragraph it describes; a batch that reads the
 * fields of many ranges in one paragraph walks the paragraph once.
 */
const fieldReadsByParagraph = new WeakMap<object, readonly AutomationFieldRead[]>();

export function fieldsInParagraph(
  part: OoxmlPart,
  paragraphId: string
): readonly AutomationFieldRead[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  const cached = fieldReadsByParagraph.get(paragraph);
  if (cached) return cached;
  const reads = computeFieldsInParagraph(part, paragraph, paragraphId);
  fieldReadsByParagraph.set(paragraph, reads);
  return reads;
}

function computeFieldsInParagraph(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  paragraphId: string
): readonly AutomationFieldRead[] {
  const segments = segmentsOf(paragraph);
  // A field inside a pending insertion is listed too: a proposed field reads back as a field.
  return locateFieldResults(paragraph, false, true).flatMap((field) => {
    const segment = segments.find((segment) => segment.node.id === field.fieldNodeId);
    const anchor = findNode(part, field.fieldNodeId);
    return segment
      ? [
          {
            paragraphId,
            fieldNodeId: field.fieldNodeId,
            code: field.instruction,
            start: segment.start,
            end: segment.end,
            rewritable: field.rewritable,
            locked: !!anchor && fieldOnOffAttribute(anchor, 'fldLock') === true,
          },
        ]
      : [];
  });
}
/** Field's model offset, for the host's exact semantic line-to-page lookup. */
export function fieldOffset(
  part: OoxmlPart,
  paragraphId: string,
  fieldNodeId: string
): number | null {
  return (
    fieldsInParagraph(part, paragraphId).find((field) => field.fieldNodeId === fieldNodeId)
      ?.start ?? null
  );
}

/** A schema-valid simple field with an editable empty result run, ready for inline splicing. */
export function fieldInsertionParagraph(code: string): OoxmlParagraphNode {
  const instruction = escapeXmlAttribute(code);
  const read = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:fldSimple w:instr="${instruction}"><w:r><w:t/></w:r></w:fldSimple></w:p></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!read.ok) throw new Error('could not build a field');
  const body = read.part.root.children.find((node) => node.kind === 'body');
  const paragraph = body && storyParagraphs(body)[0];
  if (!paragraph || paragraph.kind !== 'paragraph')
    throw new Error('could not build a field paragraph');
  return paragraph;
}
