import { describe, expect, test } from 'bun:test';
import {
  detectBodyTocs,
  findNode,
  parseTocInstruction,
  planTocEntries,
  readOoxmlPart,
  serializeOoxmlPart,
  tocLeftIndentTwips,
  type OoxmlPart,
} from '../package/index.ts';
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

describe('TOC instruction parsing', () => {
  test('reads the allowlisted switches and rejects hostile ranges', () => {
    expect(parseTocInstruction(' TOC \\o "2-4" \\h \\n ')).toMatchObject({
      hyperlink: true,
      omitPageNumbers: true,
      outlineStart: 2,
      outlineEnd: 4,
    });
    expect(parseTocInstruction('TOC \\o "4-2"')).toBeNull();
    expect(parseTocInstruction(`TOC ${'x'.repeat(257)}`)).toBeNull();
    expect(parseTocInstruction('DDEAUTO "cmd"')).toBeNull();
  });
});

describe('cross-paragraph TOC detection', () => {
  test('detects bare and SDT-wrapped cached results', () => {
    const bare = detectBodyTocs(load(TOC));
    expect(bare).toHaveLength(1);
    expect(bare[0]!.resultParagraphIds).toHaveLength(1);
    expect(bare[0]!.contentControlId).toBeUndefined();

    const wrapped = detectBodyTocs(
      load(`<w:sdt><w:sdtPr><w:docPartObj/></w:sdtPr><w:sdtContent>${TOC}</w:sdtContent></w:sdt>`)
    );
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]!.contentControlId).toBe(wrapped[0]!.id);
    expect(wrapped[0]!.instruction.raw).toContain('TOC');
  });

  test('does not detect over-deep nested fields', () => {
    const begin = '<w:fldChar w:fldCharType="begin"/>';
    const end = '<w:fldChar w:fldCharType="end"/>';
    const part = load(
      `<w:p><w:r>${begin.repeat(5)}<w:instrText>TOC</w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>` +
        '<w:p><w:r><w:t>result</w:t></w:r></w:p>' +
        `<w:p><w:r>${end.repeat(5)}</w:r></w:p>`
    );
    expect(detectBodyTocs(part)).toEqual([]);
  });
});

describe('TOC tree operations', () => {
  test('flattens heading breaks and emits direct level indents', () => {
    const part = load(TOC);
    const instruction = parseTocInstruction('TOC \\o "1-2" \\h')!;
    const plan = planTocEntries(
      part,
      [
        {
          level: 1,
          text: 'Advanced Text\n  Formatting',
          blockId: 'heading-1',
        },
      ],
      instruction,
      new Map([['heading-1', '3']]),
      new Set()
    );
    expect(plan.entries[0]?.text).toBe('Advanced Text Formatting');

    const toc = detectBodyTocs(part)[0]!;
    const result = applyTreeOp(part, {
      op: 'replaceTocResult',
      tocId: toc.id,
      entries: plan.entries,
      bookmarksToCreate: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xml = serializeOoxmlPart(result.part);
    expect(xml).toContain('w:pStyle w:val="TOC2"');
    expect(xml).toContain('w:left="240"');
    expect(xml).not.toContain('<w:tabs');
  });

  test('replaces cached paragraphs while retaining field chrome', () => {
    const part = load(TOC);
    const toc = detectBodyTocs(part)[0]!;
    const beforeBegin = findNode(part, toc.beginNodeId);
    const result = applyTreeOp(part, {
      op: 'replaceTocResult',
      tocId: toc.id,
      entries: [
        {
          level: 0,
          text: 'Introduction',
          headingParagraphId: 'heading-1',
          bookmarkName: '_Toc1',
          pageNumberText: '3',
        },
      ],
      bookmarksToCreate: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findNode(result.part, toc.beginNodeId)).toBe(beforeBegin);
    expect(serializeOoxmlPart(result.part)).toContain('Introduction');
    expect(serializeOoxmlPart(result.part)).not.toContain('Old entry');
  });

  test('preserves authored TOC paragraph geometry for the matching level', () => {
    const styled = TOC.replace(
      '<w:p><w:r><w:t>Old entry</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:pStyle w:val="TOC2"/><w:tabs><w:tab w:val="right" w:pos="7777" w:leader="dot"/></w:tabs><w:ind w:left="420"/></w:pPr><w:r><w:t>Old entry</w:t></w:r></w:p>'
    );
    const part = load(styled);
    const toc = detectBodyTocs(part)[0]!;
    const result = applyTreeOp(part, {
      op: 'replaceTocResult',
      tocId: toc.id,
      entries: [
        {
          level: 1,
          text: 'Nested heading',
          headingParagraphId: 'heading-2',
          bookmarkName: '_Toc2',
          pageNumberText: '4',
        },
      ],
      bookmarksToCreate: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xml = serializeOoxmlPart(result.part);
    expect(xml).toContain('w:pos="7777"');
    expect(xml).toContain('w:left="420"');
  });

  test('refuses a content-locked TOC before changing the tree', () => {
    const part = load(
      `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>${TOC}</w:sdtContent></w:sdt>`
    );
    const toc = detectBodyTocs(part)[0]!;
    const result = applyTreeOp(part, {
      op: 'replaceTocResult',
      tocId: toc.id,
      entries: [],
      bookmarksToCreate: [],
    });
    expect(result).toEqual({ ok: false, reason: 'locked' });
  });

  test('bounds hostile TOC entry levels when emitting indents', () => {
    expect(tocLeftIndentTwips(-4)).toBe(0);
    expect(tocLeftIndentTwips(0)).toBe(0);
    expect(tocLeftIndentTwips(1)).toBe(240);
    expect(tocLeftIndentTwips(4)).toBe(960);
    expect(tocLeftIndentTwips(99)).toBe(1920);
  });
});
