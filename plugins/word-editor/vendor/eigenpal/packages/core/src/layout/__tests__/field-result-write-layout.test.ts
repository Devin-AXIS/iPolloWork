// A REF result written through the editing API paints, even after the field went live.
//
// Calibration is sticky per field, so a field whose cache once matched its computed value
// paints live. A result write is a new authored cache: the verdict is keyed by the cache too,
// so the written text calibrates afresh and paints when the computed value does not match it.
import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { applyTreeOp } from '../../store/store/tree-op-apply.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { paragraphFragmentsOf } from '../index.ts';
import type { SemanticLayout } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function load(body: string): OoxmlPart {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

const textsOf = (layout: SemanticLayout): string[] =>
  layout.pages.flatMap((page) =>
    paragraphFragmentsOf(page).map((fragment) =>
      fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('')
    )
  );

function nodeOf(node: OoxmlNode, kind: string, index = 0): OoxmlNode | undefined {
  const found: OoxmlNode[] = [];
  const walk = (current: OoxmlNode) => {
    if (current.kind === kind) found.push(current);
    if (current.kind !== 'textValue') current.children.forEach(walk);
  };
  walk(node);
  return found[index];
}

describe('written REF results paint', () => {
  test('a live REF repaints the written cache in a warm session', () => {
    const before = load(
      '<w:p><w:bookmarkStart w:id="1" w:name="term"/><w:r><w:t>Closing Date</w:t></w:r>' +
        '<w:bookmarkEnd w:id="1"/></w:p>' +
        '<w:p><w:r><w:t xml:space="preserve">see </w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> REF term </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Closing Date</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    );
    const options = {
      measurer,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    expect(textsOf(layoutSemanticDocument(before, 1, options))).toContain('see Closing Date');
    const written = applyTreeOp(before, {
      op: 'setFieldResult',
      paragraphId: nodeOf(before.root, 'paragraph', 1)!.id,
      fieldNodeId: nodeOf(before.root, 'fldChar')!.id,
      text: 'the closing date',
    });
    if (!written.ok) throw new Error(written.reason);
    expect(textsOf(layoutSemanticDocument(written.part, 2, options))).toContain(
      'see the closing date'
    );
  });
});
