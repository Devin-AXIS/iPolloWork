import { describe, expect, test } from 'bun:test';
import { detectBodyTocs } from '../package/toc-detect.ts';
import { readOoxmlPart, type OoxmlPart } from '../package/index.ts';
import { applyTreeOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const TOC =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\o "1-2" \\h </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
  '<w:p><w:r><w:t>Old entry</w:t></w:r></w:p>' +
  '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';

describe('detectBodyTocs memoization', () => {
  test('reuses the cached result for the same part identity', () => {
    const part = load(TOC);
    const first = detectBodyTocs(part);
    const second = detectBodyTocs(part);
    expect(second).toBe(first);
  });

  test('recomputes for a structurally shared but new part identity', () => {
    const left = detectBodyTocs(load(TOC));
    const right = detectBodyTocs(load(TOC));
    expect(right).toEqual(left);
    expect(right).not.toBe(left);
  });

  test('matches uncached answers for real TOC and no-TOC fixtures', () => {
    const tocPart = load(TOC);
    const noTocPart = load('<w:p><w:r><w:t>Plain body</w:t></w:r></w:p>');

    const tocFirst = detectBodyTocs(tocPart);
    const tocSecond = detectBodyTocs(tocPart);
    expect(tocSecond).toEqual(tocFirst);
    expect(tocSecond).toBe(tocFirst);
    expect(tocFirst).toHaveLength(1);
    expect(tocFirst[0]!.instruction.raw).toContain('TOC');

    const noTocFirst = detectBodyTocs(noTocPart);
    const noTocSecond = detectBodyTocs(noTocPart);
    expect(noTocSecond).toEqual(noTocFirst);
    expect(noTocSecond).toBe(noTocFirst);
    expect(noTocFirst).toEqual([]);
  });

  test('reuses an unchanged content-control TOC across an outside edit', () => {
    const part = load(
      '<w:p><w:r><w:t>Before</w:t></w:r></w:p>' +
        `<w:sdt><w:sdtPr/><w:sdtContent>${TOC}</w:sdtContent></w:sdt>`
    );
    const before = detectBodyTocs(part);
    const body = part.root.children.find((child) => child.kind === 'body');
    if (!body || body.kind === 'textValue') throw new Error('missing body');
    const paragraph = body.children.find((child) => child.kind === 'paragraph');
    if (!paragraph) throw new Error('missing paragraph');

    const edited = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 6,
      text: '!',
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    // Plain text outside any field cannot change the answer, so the whole answer stands.
    const after = detectBodyTocs(edited.part);
    expect(after).toBe(before);
    expect(after[0]).toBe(before[0]);
  });

  test('recomputes after an edit replaces the part identity', () => {
    const part = load(TOC);
    const before = detectBodyTocs(part);
    const toc = before[0]!;
    const edited = applyTreeOp(part, {
      op: 'replaceTocResult',
      tocId: toc.id,
      entries: [
        {
          level: 0,
          text: 'Updated entry',
          headingParagraphId: 'heading-1',
          bookmarkName: '_Toc1',
          pageNumberText: '1',
        },
      ],
      bookmarksToCreate: [],
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    const after = detectBodyTocs(edited.part);
    expect(after).not.toBe(before);
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(before[0]);
    expect(detectBodyTocs(edited.part)).toBe(after);
  });
});

test('deep field overflow retains outer cached rows and recovers for following TOCs', () => {
  const depth = 2048;
  const nested =
    '<w:fldChar w:fldCharType="begin"/>'.repeat(depth) +
    '<w:instrText>TOC</w:instrText><w:fldChar w:fldCharType="separate"/>' +
    '<w:t>Nested cache</w:t>'.repeat(depth) +
    '<w:fldChar w:fldCharType="end"/>'.repeat(depth);
  const part = load(
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TOC</w:instrText><w:fldChar w:fldCharType="separate"/>' +
      nested +
      '<w:fldChar w:fldCharType="end"/></w:r></w:p>' +
      TOC
  );
  const found = detectBodyTocs(part);
  expect(found).toHaveLength(2);
  expect(found[0]!.resultParagraphIds).toEqual([found[0]!.beginParagraphId]);
  expect(found[1]!.instruction.outlineEnd).toBe(2);
});
