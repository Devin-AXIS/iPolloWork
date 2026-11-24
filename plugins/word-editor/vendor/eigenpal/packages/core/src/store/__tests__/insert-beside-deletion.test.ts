// An insert aimed inside a deletion lands BESIDE it, never in it.
//
// The caret may rest anywhere in struck text, so `insertText` can arrive with an offset in
// the middle of a `w:delText`. Splitting the value in place put the new `w:t` inside the
// `w:del` — §17.3.3.7 requires `w:delText` there, and accepting that unrelated deletion
// would take the typed words with it. The tracked lane already states the rule
// (`tree-op-tracked.ts`); this pins the plain lane to the same one.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstParagraphId(part: OoxmlPart): string {
  let found: string | null = null;
  const walk = (node: OoxmlNode): void => {
    if (found || node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      found = node.id;
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  if (!found) throw new Error('no paragraph');
  return found;
}

describe('insertText into deleted content', () => {
  test('the new text lands after the w:del, and the deletion stays whole', () => {
    // `AB` + deleted `CDE` + `FG`; offset 3 is between the deleted C and D.
    const part = load(
      '<w:p><w:r><w:t>AB</w:t></w:r>' +
        '<w:del w:id="1" w:author="Dev" w:date="2026-03-26T11:00:00Z">' +
        '<w:r><w:delText>CDE</w:delText></w:r></w:del>' +
        '<w:r><w:t>FG</w:t></w:r></w:p>'
    );
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: firstParagraphId(part),
      offset: 3,
      text: 'X',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xml = serializeOoxmlPart(result.part);
    expect(xml).toContain('<w:delText>CDE</w:delText>');
    expect(xml).toMatch(/<\/w:del><w:r><w:t>X<\/w:t><\/w:r>/);
  });

  test('under ins-wrapping-del, the text lands outside BOTH wrappers', () => {
    // Placed between the two would put the words inside someone else's insertion, where
    // rejecting their proposal deletes yours.
    const part = load(
      '<w:p><w:r><w:t>AB</w:t></w:r>' +
        '<w:ins w:id="1" w:author="QA" w:date="2026-03-26T11:00:00Z">' +
        '<w:del w:id="2" w:author="Dev" w:date="2026-03-26T11:00:00Z">' +
        '<w:r><w:delText>CDE</w:delText></w:r></w:del></w:ins>' +
        '<w:r><w:t>FG</w:t></w:r></w:p>'
    );
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: firstParagraphId(part),
      offset: 3,
      text: 'X',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xml = serializeOoxmlPart(result.part);
    expect(xml).toMatch(/<\/w:del><\/w:ins><w:r><w:t>X<\/w:t><\/w:r>/);
  });

  test('the run properties of the struck run carry over to the new run', () => {
    const part = load(
      '<w:p><w:del w:id="1" w:author="Dev" w:date="2026-03-26T11:00:00Z">' +
        '<w:r><w:rPr><w:b/></w:rPr><w:delText>CDE</w:delText></w:r></w:del></w:p>'
    );
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: firstParagraphId(part),
      offset: 1,
      text: 'X',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xml = serializeOoxmlPart(result.part);
    expect(xml).toMatch(/<\/w:del><w:r><w:rPr><w:b\/><\/w:rPr><w:t>X<\/w:t><\/w:r>/);
  });
});
