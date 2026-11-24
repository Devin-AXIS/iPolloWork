// Hyphen elements in paragraph text (issue #1071).
//
// `w:noBreakHyphen` is one character, U+001E, and `w:softHyphen` is U+001F, at their own
// model offsets. Search matches a typed hyphen against a non-breaking hyphen and ignores an
// optional hyphen.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp, paragraphTextOf } from '../store/tree-ops.ts';
import { serializeOoxmlPart } from '../package/ooxml-tree.ts';
import { collectDocumentOutline } from '../../binding/document-outline.ts';
import { buildTocEntryParagraph } from '../package/toc-build.ts';
import { parseTocInstruction } from '../package/index.ts';
import { areInsertableTexts, MAX_INSERTED_HYPHENS } from '../store/tree-op-inline-elements.ts';
import { validateTreeOp } from '../store/tree-ops.ts';
import { projectVisibleParagraphText } from '../store/text-projection.ts';
import { projectParagraphText } from '../../automation/text-projection.ts';
import { withHeadingSymbols } from '../store/toc-heading-symbols.ts';

const W = WML_NAMESPACE_URI;
const NBH = '\u001e';
const SHY = '\u001f';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstParagraph(part: OoxmlPart): OoxmlParagraphNode {
  const find = (node: OoxmlNode): OoxmlParagraphNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'paragraph') return node as OoxmlParagraphNode;
    for (const child of node.children) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  };
  return find(part.root)!;
}

function project(body: string) {
  const part = load(body);
  const paragraph = firstParagraph(part);
  const raw = paragraphTextOf(part, paragraph.id) ?? '';
  return { part, paragraph, raw, projected: projectVisibleParagraphText(paragraph, raw) };
}

const ISSUE =
  '<w:p><w:r><w:t xml:space="preserve">the then</w:t><w:noBreakHyphen/>' +
  '<w:t>applicable rate</w:t><w:softHyphen/><w:t>s</w:t></w:r></w:p>';

describe('hyphen elements in paragraph text', () => {
  test('each hyphen is one character of model text', () => {
    const { raw, projected } = project(ISSUE);
    expect(raw).toBe(`the then${NBH}applicable rate${SHY}s`);
    expect(projected.text).toBe(raw);
  });

  test('search matches a typed hyphen and ignores an optional hyphen', () => {
    const { projected } = project(ISSUE);
    const found = (query: string) => projected.findOccurrences(query, 10).matches;
    expect(found('then-applicable')).toMatchObject([
      { start: 4, length: 15, rawStart: 4, rawEnd: 19 },
    ]);
    expect(found(`then${NBH}applicable`)).toHaveLength(1);
    expect(found('thenapplicable')).toHaveLength(0);
    expect(found('-')).toMatchObject([{ start: 8, length: 1, rawStart: 8, rawEnd: 9 }]);
    expect(found('rates')).toMatchObject([{ start: 20, length: 6, rawStart: 20, rawEnd: 26 }]);
    expect(found(`rate${SHY}s`)).toHaveLength(1);
    expect(found(SHY)).toHaveLength(0);
  });

  test('a literal U+00AD in run text matches only itself', () => {
    const { projected } = project('<w:p><w:r><w:t>xx aaaa\u00adbbbb</w:t></w:r></w:p>');
    const found = (query: string) => projected.findOccurrences(query, 10).matches;
    expect(found('aaaa-bbbb')).toHaveLength(0);
    expect(found('aaaabbbb')).toHaveLength(0);
    expect(found('aaaa')).toHaveLength(1);
    // A U+00AD in the search text matches the literal one, and only that.
    expect(found('aaaa\u00adbbbb')).toMatchObject([{ start: 3, length: 9 }]);
    expect(found('\u00ad')).toHaveLength(1);
    // It separates words.
    expect(projected.findOccurrences('aaaa', 10, { wholeWord: true }).matches).toHaveLength(1);
    const element = project(ISSUE).projected;
    expect(element.findOccurrences('rate\u00ads', 10).matches).toHaveLength(0);
  });

  test('whole-word search joins a word across an optional hyphen', () => {
    const { projected } = project(ISSUE);
    const whole = (query: string) =>
      projected.findOccurrences(query, 10, { wholeWord: true }).matches;
    expect(whole('then')).toHaveLength(1);
    expect(whole('rate')).toHaveLength(0);
    expect(whole('rates')).toHaveLength(1);
  });

  test('a hyphen in a pending insertion is absent from the original view', () => {
    const body =
      '<w:p><w:r><w:t>co</w:t></w:r><w:ins w:id="1" w:author="A"><w:r><w:noBreakHyphen/>' +
      '<w:t>signer</w:t></w:r></w:ins></w:p>';
    const part = load(body);
    const paragraph = firstParagraph(part);
    const raw = paragraphTextOf(part, paragraph.id) ?? '';
    expect(raw).toBe(`co${NBH}signer`);
    expect(projectParagraphText(paragraph, raw, 'allMarkup').text).toBe(`co${NBH}signer`);
    expect(projectParagraphText(paragraph, raw, 'original').text).toBe('co');
  });

  test('a hyphen in a field result reads inside the result', () => {
    const body =
      '<w:p><w:fldSimple w:instr=" REF ref "><w:r><w:t>1</w:t><w:noBreakHyphen/>' +
      '<w:t>A</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve"> end</w:t></w:r></w:p>';
    const { projected } = project(body);
    expect(projected.text).toBe(`1${NBH}A end`);
    expect(projected.resultRunAddressAt(2)?.offset).toBe(2);
  });

  test('a hyphen in a text box is not the anchoring paragraph text', () => {
    const body =
      '<w:p><w:r><w:t>Cover</w:t></w:r><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"/></w:drawing></w:r></w:p>';
    const { raw } = project(body);
    expect(raw.startsWith('Cover')).toBe(true);
    expect(raw).not.toContain(NBH);
  });

  test('inserted U+001E and U+001F become hyphen elements, tracked or not', () => {
    for (const tracked of [false, true]) {
      const part = load('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
      const paragraph = firstParagraph(part);
      const result = applyTreeOp(part, {
        op: 'insertText',
        paragraphId: paragraph.id,
        offset: 1,
        text: `x${NBH}y${SHY}`,
        ...(tracked ? { revision: { author: 'Writer', date: '2026-10-03T00:00:00Z' } } : {}),
      });
      if (!result.ok) throw new Error(result.reason);
      const xml = serializeOoxmlPart(result.part);
      expect(xml).toContain('<w:noBreakHyphen/>');
      expect(xml).toContain('<w:softHyphen/>');
      expect(xml).not.toMatch(/[\u001e\u001f]/);
      expect(paragraphTextOf(result.part, paragraph.id)).toBe(`ax${NBH}y${SHY}b`);
    }
  });

  test('heading outline text shows a non-breaking hyphen and drops an optional one', () => {
    const part = load(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Pre</w:t><w:noBreakHyphen/>' +
        '<w:t>Trial rate</w:t><w:softHyphen/><w:t>s</w:t></w:r></w:p>'
    );
    const styles = readOoxmlPart(
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Heading1">` +
        '<w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>',
      { name: '/word/styles.xml', contentType: 'application/xml' }
    );
    if (!styles.ok) throw new Error(styles.reason);
    const outline = collectDocumentOutline(part, styles.part.root);
    expect(outline.map((entry) => entry.text)).toEqual(['Pre\u2011Trial rates']);
  });

  test('heading outline text leaves a symbol out instead of writing a parenthesis', () => {
    // A symbol reads as "(" in model text; the TOC row built from the entry must not show it.
    const part = load(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r>' +
        '<w:sym w:font="Wingdings" w:char="F0FC"/><w:t xml:space="preserve"> Approved (final)</w:t>' +
        '</w:r></w:p>'
    );
    const styles = readOoxmlPart(
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Heading1">` +
        '<w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>',
      { name: '/word/styles.xml', contentType: 'application/xml' }
    );
    if (!styles.ok) throw new Error(styles.reason);
    const outline = collectDocumentOutline(part, styles.part.root);
    expect(outline.map((entry) => entry.text)).toEqual(['Approved (final)']);
  });

  test('a table of contents row writes a non-breaking hyphen as the element', () => {
    let next = 0;
    const row = buildTocEntryParagraph(
      () => `toc${next++}`,
      {
        level: 0,
        text: 'Pre\u2011Trial',
        headingParagraphId: 'h',
        bookmarkName: '_Toc1',
        pageNumberText: '1',
      },
      parseTocInstruction('TOC \\o "1-3"')!
    );
    const texts: string[] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') {
        texts.push(node.value);
        return;
      }
      if (node.localName === 'noBreakHyphen') texts.push('<nbh>');
      node.children.forEach(walk);
    };
    walk(row);
    expect(texts.join('')).toContain('Pre<nbh>Trial');
  });

  test('a table of contents row copies its heading symbols as symbols', () => {
    // The outline entry leaves the symbol out; the row built from it writes the symbol back.
    const part = load(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r>' +
        '<w:sym w:font="Wingdings" w:char="F0FC"/><w:t xml:space="preserve"> Approved</w:t>' +
        '</w:r></w:p>'
    );
    const heading = part.root.children[0]!.children.find((node) => node.kind === 'paragraph')!;
    const plain = {
      level: 0,
      text: 'Approved',
      headingParagraphId: heading.id,
      bookmarkName: '_Toc1',
      pageNumberText: '1',
    };
    const entry = withHeadingSymbols(part, plain);
    let next = 0;
    const row = buildTocEntryParagraph(
      () => `toc${next++}`,
      entry,
      parseTocInstruction('TOC \\o "1-3"')!
    );
    const xml = serializeOoxmlPart({
      ...part,
      root: { ...part.root, children: [row] },
    } as OoxmlPart);
    expect(xml).toContain(
      '<w:sym w:char="F0FC" w:font="Wingdings"/><w:t xml:space="preserve"> Approved</w:t>'
    );
    expect(xml).not.toContain('\ufdd0');
    // A row whose text is not the heading's keeps the text it was given.
    expect(withHeadingSymbols(part, { ...plain, text: 'Other' }).symbols).toBeUndefined();
  });

  test('a long heading keeps its symbols in the bounded table of contents row', () => {
    const long = 'x'.repeat(205);
    const part = load(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r>' +
        `<w:sym w:font="Wingdings" w:char="F0FC"/><w:t xml:space="preserve"> ${long}</w:t>` +
        '</w:r></w:p>'
    );
    const heading = part.root.children[0]!.children.find((node) => node.kind === 'paragraph')!;
    const entry = withHeadingSymbols(part, {
      level: 0,
      text: 'x'.repeat(200),
      headingParagraphId: heading.id,
      bookmarkName: '_Toc1',
      pageNumberText: '1',
    });
    expect(entry.symbols).toHaveLength(1);
    expect(entry.text).toBe(`\ufdd0 ${'x'.repeat(200)}`);
  });

  test('a content control value written back keeps its hyphens', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:id w:val="5"/><w:text/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>co</w:t>' +
        '<w:noBreakHyphen/><w:t>signer</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const control = (function find(node: OoxmlNode): OoxmlNode | null {
      if (node.kind === 'textValue') return null;
      if (node.kind === 'contentControl') return node;
      for (const child of node.children) {
        const hit = find(child);
        if (hit) return hit;
      }
      return null;
    })(part.root)!;
    const result = applyTreeOp(part, {
      op: 'setContentControlValue',
      controlId: control.id,
      value: { kind: 'text', text: `co${NBH}signer!` },
    } as never);
    if (!result.ok) throw new Error(result.reason);
    expect(serializeOoxmlPart(result.part)).toContain('<w:noBreakHyphen/>');
  });

  test('refuses text that would create more hyphens than the cap', () => {
    const part = load('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const paragraph = firstParagraph(part);
    const op = (count: number) =>
      ({
        op: 'insertText',
        paragraphId: paragraph.id,
        offset: 1,
        text: NBH.repeat(count),
      }) as const;
    expect(validateTreeOp(part, op(MAX_INSERTED_HYPHENS))).toBeNull();
    expect(validateTreeOp(part, op(MAX_INSERTED_HYPHENS + 1))).toBe('invalid-text');
  });

  test('a hyphen may not split a surrogate pair, and the cap covers a whole write', () => {
    expect(areInsertableTexts([`a${NBH}b`])).toBe(true);
    expect(areInsertableTexts([`\ud83d${NBH}\ude00`])).toBe(false);
    const half = NBH.repeat(MAX_INSERTED_HYPHENS / 2);
    expect(areInsertableTexts([half, half])).toBe(true);
    expect(areInsertableTexts([half, half, NBH])).toBe(false);
  });

  test('combo box and string values keep hyphens and write valid XML', () => {
    for (const [type, value] of [
      [
        '<w:comboBox><w:listItem w:displayText="A" w:value="A"/></w:comboBox>',
        { kind: 'text', text: `co${NBH}op` },
      ],
      ['<w:text/>', `co${NBH}op`],
    ] as const) {
      const part = load(
        `<w:p><w:sdt><w:sdtPr><w:id w:val="9"/>${type}</w:sdtPr><w:sdtContent><w:r><w:t>x</w:t>` +
          '</w:r></w:sdtContent></w:sdt></w:p>'
      );
      const control = (function find(node: OoxmlNode): OoxmlNode | null {
        if (node.kind === 'textValue') return null;
        if (node.kind === 'contentControl') return node;
        for (const child of node.children) {
          const hit = find(child);
          if (hit) return hit;
        }
        return null;
      })(part.root)!;
      const result = applyTreeOp(part, {
        op: 'setContentControlValue',
        controlId: control.id,
        value,
      } as never);
      if (!result.ok) throw new Error(`${type}: ${result.reason}`);
      const xml = serializeOoxmlPart(result.part);
      expect(xml).toContain('<w:noBreakHyphen/>');
      expect(xml).not.toMatch(/[\u001e\u001f]/);
    }
  });
});
