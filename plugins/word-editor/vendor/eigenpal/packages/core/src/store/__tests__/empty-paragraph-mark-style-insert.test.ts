// The first content inserted into a paragraph with no content takes the character style its
// mark names.
//
// Anonymous probes behind this file: text typed into an empty paragraph whose mark names a
// 24pt bold character style comes out 24pt bold, and the saved run carries the same
// `w:rStyle`. A range insert does the same. Empty runs in the paragraph do not count, neither
// their direct properties nor their own `w:rStyle`. Typing beside existing text joins that
// text's run, whatever the mark names.
//
// `w:rStyle` stays outside the accepted run vocabulary: the insertion copies the mark's own
// reference, and a property write naming `w:rStyle` is still refused.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  validateOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp, type TreeDocOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphIds(part: OoxmlPart): string[] {
  const body = (part.root as Extract<OoxmlNode, { children: unknown }>).children[0]!;
  if (body.kind === 'textValue') throw new Error('no body');
  return body.children.filter((child) => child.kind === 'paragraph').map((child) => child.id);
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  return result.part;
}

/** The body's paragraphs as saved, without attributes the tree adds on its own. */
function paragraphsXml(part: OoxmlPart): string[] {
  const body = serializeOoxmlPart(part).replace(/^[\s\S]*?<w:body>|<\/w:body>[\s\S]*$/g, '');
  return body.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? [];
}

const STYLE_MARK = '<w:pPr><w:rPr><w:rStyle w:val="Big"/></w:rPr></w:pPr>';
const typed = (part: OoxmlPart, index = 0, extra: Partial<TreeDocOp> = {}) =>
  apply(part, {
    op: 'insertText',
    paragraphId: paragraphIds(part)[index]!,
    offset: 0,
    text: 'typed',
    ...extra,
  } as TreeDocOp);

describe('an empty paragraph gives its first run the mark character style', () => {
  test('typed text carries the style the mark names', () => {
    expect(paragraphsXml(typed(load(`<w:p>${STYLE_MARK}</w:p>`)))).toEqual([
      `<w:p>${STYLE_MARK}<w:r><w:rPr><w:rStyle w:val="Big"/></w:rPr><w:t>typed</w:t></w:r></w:p>`,
    ]);
  });

  test('only the style is copied; direct mark properties are the caret format', () => {
    const mark = '<w:pPr><w:rPr><w:rStyle w:val="Big"/><w:sz w:val="32"/></w:rPr></w:pPr>';
    expect(paragraphsXml(typed(load(`<w:p>${mark}</w:p>`)))).toEqual([
      `<w:p>${mark}<w:r><w:rPr><w:rStyle w:val="Big"/></w:rPr><w:t>typed</w:t></w:r></w:p>`,
    ]);
  });

  test('a mark with no style, or no mark, leaves the run bare as before', () => {
    const direct = '<w:pPr><w:rPr><w:sz w:val="48"/></w:rPr></w:pPr>';
    expect(paragraphsXml(typed(load(`<w:p>${direct}</w:p>`)))).toEqual([
      `<w:p>${direct}<w:r><w:t>typed</w:t></w:r></w:p>`,
    ]);
    expect(paragraphsXml(typed(load('<w:p/>')))).toEqual([
      '<w:p><w:r><w:t>typed</w:t></w:r></w:p>',
    ]);
  });

  test('empty runs do not give the typed text their formatting', () => {
    const italic = '<w:r><w:rPr><w:i/></w:rPr></w:r>';
    const small = '<w:r><w:rPr><w:rStyle w:val="Small"/></w:rPr></w:r>';
    const styledRun = '<w:r><w:rPr><w:rStyle w:val="Big"/></w:rPr><w:t>typed</w:t></w:r>';
    expect(paragraphsXml(typed(load(`<w:p>${STYLE_MARK}${italic}</w:p>`)))).toEqual([
      `<w:p>${STYLE_MARK}${italic}${styledRun}</w:p>`,
    ]);
    expect(paragraphsXml(typed(load(`<w:p>${STYLE_MARK}${small}</w:p>`)))).toEqual([
      `<w:p>${STYLE_MARK}${small}${styledRun}</w:p>`,
    ]);
  });

  test('typing beside text joins that run, whatever the mark names', () => {
    const part = load(`<w:p>${STYLE_MARK}<w:r><w:t>Text</w:t></w:r></w:p>`);
    expect(paragraphsXml(typed(part, 0, { offset: 4 } as Partial<TreeDocOp>))).toEqual([
      `<w:p>${STYLE_MARK}<w:r><w:t>Texttyped</w:t></w:r></w:p>`,
    ]);
  });

  test('a tracked insertion carries the style inside its w:ins', () => {
    const inserted = typed(load(`<w:p>${STYLE_MARK}<w:r><w:rPr><w:i/></w:rPr></w:r></w:p>`), 0, {
      revision: { author: 'Ada', date: '2026-01-01T00:00:00Z' },
    } as Partial<TreeDocOp>);
    const [paragraph] = paragraphsXml(inserted);
    expect(paragraph).toMatch(
      /<w:ins [^>]*><w:r><w:rPr><w:rStyle w:val="Big"\/><\/w:rPr><w:t>typed<\/w:t><\/w:r><\/w:ins>/
    );
    const plain = typed(load(`<w:p>${STYLE_MARK}</w:p>`), 0, {
      revision: { author: 'Ada', date: '2026-01-01T00:00:00Z' },
    } as Partial<TreeDocOp>);
    expect(paragraphsXml(plain)[0]).toContain(
      '<w:r><w:rPr><w:rStyle w:val="Big"/></w:rPr><w:t>typed</w:t></w:r></w:ins>'
    );
  });

  test('a property write still cannot name w:rStyle', () => {
    const part = load(`<w:p><w:r><w:t>Text</w:t></w:r></w:p>`);
    const result = applyTreeOp(part, {
      op: 'setRunProperties',
      paragraphId: paragraphIds(part)[0]!,
      start: 0,
      end: 4,
      properties: [{ localName: 'rStyle', attributes: { val: 'Big' } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-property');
  });
});

for (const tracked of [false, true]) {
  for (const flag of ['rtl', 'cs']) {
    for (const value of ['0', '1']) {
      test(`first insertion preserves mark ${flag}=${value}, tracked=${tracked}`, () => {
        const mark = `<w:pPr><w:rPr><w:${flag} w:val="${value}"/></w:rPr></w:pPr>`;
        const part = load(`<w:p>${mark}<w:r><w:rPr><w:i/></w:rPr></w:r></w:p>`);
        const result = typed(
          part,
          0,
          tracked
            ? ({
                revision: { author: 'Author', date: '2026-01-01T00:00:00Z' },
              } as Partial<TreeDocOp>)
            : {}
        );
        expect(serializeOoxmlPart(result)).toContain(
          `<w:r><w:rPr><w:${flag} w:val="${value}"/></w:rPr><w:t>typed</w:t></w:r>`
        );
      });
    }
  }
}
