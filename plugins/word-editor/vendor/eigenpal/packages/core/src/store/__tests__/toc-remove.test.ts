import { describe, expect, test } from 'bun:test';
import {
  detectBodyTocs,
  findNode,
  readOoxmlPart,
  serializeOoxmlPart,
  validateOoxmlPart,
  type OoxmlPart,
} from '../package/index.ts';
import { applyTreeOp, validateTreeOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (inner: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${inner}</w:p>`;
const BEGIN =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const ENTRIES =
  para(BEGIN + run('Alpha 1'), 'TOC1') + para(run('Beta 1'), 'TOC1') + para(END, 'TOC1');
const control = (inner: string, lock = '') =>
  `<w:sdt><w:sdtPr><w:id w:val="7"/>${lock}<w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
const SECTION = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';

/** Remove the only table of contents and return the saved body, between body tags. */
function remove(body: string) {
  const part = load(body);
  const tocs = detectBodyTocs(part);
  expect(tocs).toHaveLength(1);
  const op = { op: 'removeToc', tocId: tocs[0]!.id } as const;
  expect(validateTreeOp(part, op)).toBeNull();
  const result = applyTreeOp(part, op);
  if (!result.ok || !result.part) throw new Error(String(result.reason));
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  expect(detectBodyTocs(result.part)).toHaveLength(0);
  const xml = serializeOoxmlPart(result.part);
  const saved = /<w:body>(.*)<\/w:body>/s.exec(xml)![1]!.replace(/ w14:\w+="[^"]*"/g, '');
  const reopened = load(saved);
  expect(serializeOoxmlPart(reopened)).toBe(serializeOoxmlPart(load(saved)));
  return { saved, result, part };
}

const textOf = (xml: string) =>
  [...xml.matchAll(/<w:p\b[^>]*?(?:\/>|>(.*?)<\/w:p>)/gs)].map((match) =>
    [...(match[1] ?? '').matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('')
  );

describe('removeToc', () => {
  test('removes a table of contents control with its heading', () => {
    const { saved, result, part } = remove(
      para(run('Before')) +
        control(para(run('Contents'), 'TOCHeading') + ENTRIES) +
        para(run('After'), 'Heading1')
    );
    expect(saved).not.toContain('<w:sdt>');
    expect(saved).not.toContain('fldChar');
    expect(textOf(saved)).toEqual(['Before', 'After']);
    expect(saved).toContain('<w:pStyle w:val="Heading1"/>');
    // The caret goes to the start of the paragraph after the table of contents.
    const body = part.root.kind === 'textValue' ? [] : part.root.children[0]!;
    const afterId = 'children' in body ? body.children[2]!.id : '';
    expect(result.effect?.caret).toEqual({ paragraphId: afterId, offset: 0 });
    expect(result.effect?.deleted).toHaveLength(4);
  });

  test('removes the paragraphs of a field that fills them', () => {
    const { saved } = remove(para(run('Before')) + ENTRIES + para(run('After'), 'Heading1'));
    expect(textOf(saved)).toEqual(['Before', 'After']);
    expect(saved).not.toContain('TOC1');
    expect(saved).toContain('<w:pStyle w:val="Heading1"/>');
  });

  test('joins the text before and after a field inside ordinary paragraphs', () => {
    const { saved } = remove(
      para(run('Before')) +
        para(run('Lead ') + BEGIN + run('Alpha 1'), 'Lead') +
        para(run('Beta 1') + END + run(' trail'), 'Trail') +
        para(run('After'))
    );
    expect(textOf(saved)).toEqual(['Before', 'Lead  trail', 'After']);
    expect(saved).toContain('<w:pStyle w:val="Lead"/>');
    expect(saved).not.toContain('Trail');
  });

  test('keeps the paragraph that holds text after the end marker', () => {
    const { saved } = remove(
      para(BEGIN + run('Alpha 1'), 'TOC1') + para(END + run('Heading'), 'Heading1')
    );
    expect(textOf(saved)).toEqual(['Heading']);
    expect(saved).toContain('<w:pStyle w:val="Heading1"/>');
  });

  test('cuts a field that begins and ends in one paragraph', () => {
    const { saved } = remove(para(run('Lead ') + BEGIN + run('Alpha 1') + END + run(' trail')));
    expect(textOf(saved)).toEqual(['Lead  trail']);
  });

  test('keeps one empty paragraph when the table of contents is the whole body', () => {
    const { saved, result } = remove(ENTRIES + SECTION);
    expect(textOf(saved)).toEqual(['']);
    expect(saved).toContain('<w:sectPr>');
    expect(result.effect?.caret?.paragraphId).toBe(result.effect?.dirty[0]);
  });

  test('keeps the section mark of the last paragraph', () => {
    const marked = ENTRIES.replace(
      `${para(END, 'TOC1')}`,
      `<w:p><w:pPr><w:pStyle w:val="TOC1"/><w:sectPr/></w:pPr>${END}</w:p>`
    );
    const { saved } = remove(para(run('Before')) + marked + para(run('After')));
    expect(textOf(saved)).toEqual(['Before', '', 'After']);
    expect(saved).toContain('<w:sectPr/>');
  });

  test('refuses a section mark inside the field', () => {
    const body =
      para(BEGIN + run('Alpha 1')) +
      `<w:p><w:pPr><w:sectPr/></w:pPr>${run('Beta 1')}</w:p>` +
      para(END) +
      para(run('After'));
    const part = load(body);
    const tocId = detectBodyTocs(part)[0]!.id;
    expect(validateTreeOp(part, { op: 'removeToc', tocId })).toBe('carries-section-mark');
  });

  test('refuses a locked control and an unknown table of contents', () => {
    const part = load(
      para(run('Before')) + control(ENTRIES, '<w:lock w:val="sdtContentLocked"/>') + para('')
    );
    const tocId = detectBodyTocs(part)[0]!.id;
    expect(validateTreeOp(part, { op: 'removeToc', tocId })).toBe('locked');
    expect(validateTreeOp(part, { op: 'removeToc', tocId: 'missing' })).toBe('unknown-block');
    expect(validateTreeOp(part, { op: 'removeToc', tocId: '' })).toBe('invalidArgs');
  });

  test('keeps the control when other text shares its field paragraphs', () => {
    const { saved } = remove(
      para(run('Before')) +
        control(para(run('Intro ') + BEGIN + run('Alpha 1')) + para(END)) +
        para(run('After'))
    );
    expect(saved).toContain('<w:sdt>');
    expect(textOf(saved)).toEqual(['Before', 'Intro ', 'After']);
  });

  test('removes only the field from a control that is not a table of contents control', () => {
    const plain = `<w:sdt><w:sdtPr><w:id w:val="9"/><w:richText/></w:sdtPr><w:sdtContent>${
      para(run('Title')) + ENTRIES + para(run('Chapter')) + para(run('Long body text'))
    }</w:sdtContent></w:sdt>`;
    const { saved } = remove(plain + para(run('Outside')));
    expect(saved).toContain('<w:sdt>');
    expect(textOf(saved)).toEqual(['Title', 'Chapter', 'Long body text', 'Outside']);
  });

  test('removes one of two tables of contents in a control and keeps the other', () => {
    const part = load(control(ENTRIES + para(run('Mid')) + ENTRIES) + para(run('After')));
    const tocs = detectBodyTocs(part);
    expect(tocs).toHaveLength(2);
    const result = applyTreeOp(part, { op: 'removeToc', tocId: tocs[1]!.id });
    if (!result.ok || !result.part) throw new Error(String(result.reason));
    expect(detectBodyTocs(result.part)).toHaveLength(1);
    const saved = serializeOoxmlPart(result.part);
    expect(textOf(saved.replace(/ w14:\w+="[^"]*"/g, ''))).toEqual([
      'Alpha 1',
      'Beta 1',
      '',
      'Mid',
      'After',
    ]);
  });

  test('keeps a control locked against deletion, with its heading', () => {
    const { saved } = remove(
      control(para(run('Contents')) + ENTRIES, '<w:lock w:val="sdtLocked"/>') + para(run('After'))
    );
    expect(saved).toContain('<w:sdt>');
    expect(textOf(saved)).toEqual(['Contents', 'After']);
  });

  test('keeps the control when it holds more than a heading and the field', () => {
    const after = remove(control(para(run('Contents')) + ENTRIES + para(run('Note'))));
    expect(after.saved).toContain('<w:sdt>');
    expect(textOf(after.saved)).toEqual(['Contents', 'Note']);
    const dated = remove(
      control(
        para(
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> DATE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
            run('Today') +
            END
        ) + ENTRIES
      ) + para(run('After'))
    );
    expect(textOf(dated.saved)).toEqual(['Today', 'After']);
  });

  test('moves a range marker whose partner stays to the cut, and drops a pair inside', () => {
    const { saved, result } = remove(
      para('<w:bookmarkStart w:id="5" w:name="span"/>' + run('Before')) +
        para(run('Lead ') + BEGIN + run('Alpha') + '<w:bookmarkEnd w:id="5"/>', 'Lead') +
        para(
          '<w:commentRangeStart w:id="3"/>' + run('Beta') + '<w:commentRangeEnd w:id="3"/>' + END
        ) +
        para(run('After'))
    );
    expect(saved.match(/<w:bookmarkStart /g)).toHaveLength(1);
    expect(saved.match(/<w:bookmarkEnd /g)).toHaveLength(1);
    expect(saved).not.toContain('commentRange');
    expect(textOf(saved)).toEqual(['Before', 'Lead ', 'After']);
    // The caret stays where the field was.
    expect(result.effect?.caret?.offset).toBe(5);
  });

  test('keeps an empty paragraph for a marker whose partner stays outside', () => {
    const { saved } = remove(
      para('<w:bookmarkStart w:id="5" w:name="span"/>' + run('Before')) +
        para(BEGIN + run('Alpha') + '<w:bookmarkEnd w:id="5"/>') +
        para(END) +
        para(run('After'))
    );
    expect(saved.match(/<w:bookmarkEnd /g)).toHaveLength(1);
    expect(textOf(saved)).toEqual(['Before', '', 'After']);
  });

  test('a proofing mark before the field leaves no empty paragraph', () => {
    const { saved } = remove(
      para(run('Before')) +
        para('<w:proofErr w:type="spellStart"/>' + BEGIN + run('Alpha')) +
        para(END) +
        para(run('After'))
    );
    expect(textOf(saved)).toEqual(['Before', 'After']);
  });

  test('keeps one empty paragraph when a control is the whole body', () => {
    const { saved, result } = remove(control(para(run('Contents')) + ENTRIES) + SECTION);
    expect(saved).not.toContain('<w:sdt>');
    expect(textOf(saved)).toEqual(['']);
    expect(result.effect?.caret?.paragraphId).toBe(result.effect?.dirty[0]);
  });

  test('refuses a locked control inside the field', () => {
    const lockedInline =
      '<w:sdt><w:sdtPr><w:lock w:val="sdtLocked"/></w:sdtPr><w:sdtContent>' +
      run('Pinned') +
      '</w:sdtContent></w:sdt>';
    const part = load(
      para(run('Before')) + para(BEGIN + lockedInline) + para(END) + para(run('After'))
    );
    const tocId = detectBodyTocs(part)[0]!.id;
    expect(validateTreeOp(part, { op: 'removeToc', tocId })).toBe('locked');
  });

  test('a section mark at the end of a control stays, in an empty paragraph', () => {
    const marked = control(
      para(run('Contents')) +
        para(BEGIN + run('Alpha 1')) +
        `<w:p><w:pPr><w:sectPr/></w:pPr>${END}</w:p>`
    );
    const { saved } = remove(para(run('Before')) + marked + para(run('After')));
    expect(saved).not.toContain('<w:sdt>');
    expect(saved).toContain('<w:sectPr/>');
    expect(textOf(saved)).toEqual(['Before', '', 'After']);
  });

  test('the joined paragraph takes the section mark of the end paragraph', () => {
    const { saved } = remove(
      para(run('Lead ') + BEGIN + run('Alpha 1'), 'Lead') +
        `<w:p><w:pPr><w:sectPr/></w:pPr>${run('Beta 1')}${END}</w:p>` +
        para(run('After'))
    );
    expect(textOf(saved)).toEqual(['Lead ', 'After']);
    expect(saved).toMatch(/<w:pStyle w:val="Lead"\/><w:sectPr\/>/);
  });

  test('the moved section mark gets a clean paragraph properties element', () => {
    const { saved } = remove(
      para(run('Lead ') + BEGIN + run('Alpha 1')) +
        `<w:p><w:pPr><w:sectPr w:rsidR="00AB" w:rsidSect="00CD"/></w:pPr>${END}</w:p>` +
        para(run('After'))
    );
    expect(saved).toContain('<w:pPr><w:sectPr w:rsidR="00AB" w:rsidSect="00CD"/></w:pPr>');
    const tracked = remove(
      '<w:p><w:pPr><w:pStyle w:val="Lead"/><w:pPrChange w:id="1" w:author="Ann"><w:pPr/></w:pPrChange></w:pPr>' +
        run('Lead ') +
        BEGIN +
        run('Alpha 1') +
        '</w:p>' +
        `<w:p><w:pPr><w:sectPr/></w:pPr>${END}</w:p>` +
        para(run('After'))
    );
    expect(tracked.saved).toMatch(/<w:pStyle w:val="Lead"\/><w:sectPr\/><w:pPrChange /);
  });

  test('the moved section mark is typed paragraph properties, so layout reads it', () => {
    const { result } = remove(
      para(run('Lead ') + BEGIN + run('Alpha 1')) +
        `<w:p><w:pPr><w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/></w:sectPr></w:pPr>${END}</w:p>` +
        para(run('After'))
    );
    const survivor = findNode(result.part!, result.effect!.dirty[0]!);
    const properties = survivor && survivor.kind !== 'textValue' ? survivor.children[0] : undefined;
    expect(properties?.kind).toBe('paragraphProperties');
    expect(
      properties && properties.kind !== 'textValue'
        ? properties.children.map((child) => child.kind !== 'textValue' && child.localName)
        : []
    ).toEqual(['sectPr']);
  });

  test('a field inside one paragraph leaves the caret and carried markers at the cut', () => {
    const { saved, result } = remove(
      para(
        run('Lead ') +
          BEGIN +
          '<w:bookmarkStart w:id="5" w:name="span"/>' +
          run('Alpha') +
          END +
          run(' trail') +
          '<w:bookmarkEnd w:id="5"/>'
      )
    );
    expect(textOf(saved)).toEqual(['Lead  trail']);
    const start = saved.indexOf('<w:bookmarkStart ');
    expect(start).toBeGreaterThan(saved.indexOf('Lead '));
    expect(start).toBeLessThan(saved.indexOf(' trail'));
    expect(saved.indexOf('<w:bookmarkEnd ')).toBeGreaterThan(saved.indexOf(' trail'));
    expect(result.effect?.caret?.offset).toBe(5);
  });

  test('a wrapper around a field inside one paragraph is cut in two', () => {
    const { saved, result } = remove(
      para(
        '<w:hyperlink w:anchor="x">' +
          run('Lead ') +
          BEGIN +
          run('Alpha') +
          END +
          run(' trail') +
          '</w:hyperlink>'
      )
    );
    expect(textOf(saved)).toEqual(['Lead  trail']);
    expect(saved.match(/<w:hyperlink /g)).toHaveLength(2);
    const ids: string[] = [];
    const walk = (node: { id: string; kind: string; children?: readonly unknown[] }): void => {
      ids.push(node.id);
      for (const child of (node.children ?? []) as (typeof node)[]) walk(child);
    };
    walk(result.part!.root as never);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('a field at a page top keeps the heading after it', () => {
    const pageBegin =
      '<w:r><w:lastRenderedPageBreak/><w:fldChar w:fldCharType="begin"/></w:r>' +
      BEGIN.slice(BEGIN.indexOf('</w:r>') + 6);
    const { saved } = remove(
      para(run('Before')) +
        para(pageBegin + run('Alpha 1'), 'TOC1') +
        para(run('Beta 1'), 'TOC1') +
        para(END + run('Introduction'), 'Heading1')
    );
    expect(textOf(saved)).toEqual(['Before', 'Introduction']);
    expect(saved).toContain('<w:pStyle w:val="Heading1"/>');
    expect(saved).not.toContain('TOC1');
  });

  test('a control whose field starts at a page top is removed whole', () => {
    const pageBegin =
      '<w:r><w:lastRenderedPageBreak/><w:fldChar w:fldCharType="begin"/></w:r>' +
      BEGIN.slice(BEGIN.indexOf('</w:r>') + 6);
    const { saved } = remove(
      control(
        para(run('Contents')) +
          para(pageBegin + run('Alpha 1'), 'TOC1') +
          para(run('Beta 1'), 'TOC1') +
          para(END, 'TOC1')
      ) + para(run('After'))
    );
    expect(saved).not.toContain('<w:sdt>');
    expect(textOf(saved)).toEqual(['After']);
  });

  test('markers in the text after a field in one wrapped paragraph are not duplicated', () => {
    const { saved } = remove(
      para('<w:bookmarkStart w:id="5" w:name="span"/>' + run('x')) +
        para(
          '<w:hyperlink w:anchor="x">' +
            run('Lead ') +
            BEGIN +
            run('Alpha') +
            END +
            '<w:bookmarkEnd w:id="5"/><w:commentRangeEnd w:id="9"/>' +
            run(' trail') +
            '</w:hyperlink>'
        )
    );
    expect(textOf(saved)).toEqual(['x', 'Lead  trail']);
    expect(saved.match(/<w:bookmarkEnd /g)).toHaveLength(1);
    expect(saved.match(/<w:commentRangeEnd /g)).toHaveLength(1);
  });

  test('a block marker in the control does not keep the control', () => {
    const { saved } = remove(
      para('<w:bookmarkStart w:id="6" w:name="toc"/>' + run('Before')) +
        control(para(run('Contents')) + ENTRIES + '<w:bookmarkEnd w:id="6"/>') +
        para(run('After'))
    );
    expect(saved).not.toContain('<w:sdt>');
    expect(saved.match(/<w:bookmarkEnd /g)).toHaveLength(1);
  });

  test('a carried comment reference leaves the rest of its run behind', () => {
    const { saved } = remove(
      para('<w:commentRangeStart w:id="3"/>' + run('Before')) +
        para(run('Lead ') + BEGIN + run('Alpha 1')) +
        para(
          '<w:commentRangeEnd w:id="3"/><w:r><w:t>Row</w:t><w:commentReference w:id="3"/></w:r>' +
            END
        ) +
        para(run('After'))
    );
    expect(saved.match(/<w:commentReference /g)).toHaveLength(1);
    expect(saved).not.toContain('Row');
  });

  test('a comment that starts before the table of contents keeps its reference', () => {
    const { saved } = remove(
      para('<w:commentRangeStart w:id="3"/>' + run('Before')) +
        para(run('Lead ') + BEGIN + run('Alpha 1')) +
        para(
          run('Beta 1') +
            '<w:commentRangeEnd w:id="3"/><w:r><w:commentReference w:id="3"/></w:r>' +
            END
        ) +
        para(run('After'))
    );
    expect(saved.match(/<w:commentRangeEnd /g)).toHaveLength(1);
    expect(saved.match(/<w:commentReference /g)).toHaveLength(1);
    expect(textOf(saved)).toEqual(['Before', 'Lead ', 'After']);
  });

  test('a section mark before the end of the field refuses in both paths', () => {
    const field = load(
      `<w:p><w:pPr><w:sectPr/></w:pPr>${run('Lead ') + BEGIN + run('Alpha 1')}</w:p>` +
        para(END) +
        para(run('After'))
    );
    const fieldToc = detectBodyTocs(field)[0]!.id;
    expect(validateTreeOp(field, { op: 'removeToc', tocId: fieldToc })).toBe(
      'carries-section-mark'
    );
    const wrapped = load(
      control(
        para(run('Contents')) +
          `<w:p><w:pPr><w:sectPr/></w:pPr>${BEGIN + run('Alpha 1')}</w:p>` +
          para(END)
      ) + para(run('After'))
    );
    const wrappedToc = detectBodyTocs(wrapped)[0]!.id;
    expect(validateTreeOp(wrapped, { op: 'removeToc', tocId: wrappedToc })).toBe(
      'carries-section-mark'
    );
  });

  test('a locked control in the text that stays does not refuse', () => {
    const lockedInline =
      '<w:sdt><w:sdtPr><w:lock w:val="sdtLocked"/></w:sdtPr><w:sdtContent>' +
      run('Pinned') +
      '</w:sdtContent></w:sdt>';
    const { saved } = remove(
      para(lockedInline + BEGIN + run('Alpha 1')) + para(END) + para(run('After'))
    );
    expect(saved).toContain('sdtLocked');
    expect(textOf(saved)).toEqual(['Pinned', 'After']);
  });

  test('a range marker between the rows moves to the cut with its partner outside', () => {
    const { saved } = remove(
      para('<w:bookmarkStart w:id="4" w:name="span"/>' + run('Before')) +
        para(BEGIN + run('Alpha 1')) +
        '<w:bookmarkEnd w:id="4"/>' +
        para(END) +
        para(run('After'))
    );
    expect(saved.match(/<w:bookmarkEnd /g)).toHaveLength(1);
    expect(textOf(saved)).toEqual(['Before', '', 'After']);
  });

  test('an outer control keeps a paragraph when the table of contents was all it held', () => {
    const { saved } = remove(
      para(run('Before')) +
        `<w:sdt><w:sdtPr><w:id w:val="2"/></w:sdtPr><w:sdtContent>${control(
          para(run('Contents')) + ENTRIES
        )}</w:sdtContent></w:sdt>` +
        para(run('After'))
    );
    expect(saved.match(/<w:sdt>/g)).toHaveLength(1);
    expect(textOf(saved)).toEqual(['Before', '', 'After']);
  });

  test('the caret goes to the end of the paragraph before a table of contents at the end', () => {
    const { result, part } = remove(para(run('Before')) + ENTRIES + SECTION);
    const body = part.root.kind === 'textValue' ? [] : part.root.children[0]!;
    const beforeId = 'children' in body ? body.children[0]!.id : '';
    expect(result.effect?.caret).toEqual({ paragraphId: beforeId, offset: 6 });
  });
});
