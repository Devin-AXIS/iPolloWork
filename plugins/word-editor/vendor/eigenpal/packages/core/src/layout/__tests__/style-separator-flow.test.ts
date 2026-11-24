import { mergedFlowBlocks, storyBlocks } from '../story-roots.ts';
import { caretAt } from '../semantic-interaction.ts';
import {
  DEFAULT_FOOTNOTE_PROPERTIES,
  DEFAULT_ENDNOTE_PROPERTIES,
} from '../../store/package/note-properties.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { expect, test } from 'bun:test';
import { readOoxmlPart, applyTreeOp, paragraphTextOf } from '@docx-editor.dev/core/store';
import { loadBody } from './float-over-table-harness.ts';
import { layoutSemanticDocument, createLayoutSession } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';
import { lineSegments } from '../line-segments.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer: TextMeasurer = {
  measure: (text, style) => text.length * (style.bold ? 6 : 5),
  lineMetrics: () => ({ height: 12, baseline: 9 }),
};
const both = '<w:vanish/><w:specVanish/>';
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (text: string, mark = '', style = '') =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}<w:rPr>${mark}</w:rPr></w:pPr>${run(text)}</w:p>`;
const geometry = { width: 300, height: 500, margin: { left: 0, right: 0, top: 0, bottom: 0 } };
function styles(inherited = false) {
  const parsed = readOoxmlPart(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:pPrDefault/></w:docDefaults><w:style w:type="paragraph" w:styleId="Lead"><w:name w:val="Lead"/><w:rPr><w:b/>${inherited ? both : ''}</w:rPr></w:style><w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body"/><w:rPr><w:i/></w:rPr></w:style></w:styles>`,
    { name: '/word/styles.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  return buildStyleCascadeTable(parsed.part.root);
}
function layout(xml: string, styleCascade = styles()) {
  const part = loadBody(xml);
  return { part, result: layoutSemanticDocument(part, 1, { measurer, geometry, styleCascade }) };
}
test('joined display retains both paragraph owners and inherited run styles', () => {
  const { part, result } = layout(
    paragraph('Lead', both, 'Lead') + paragraph('. Body', '', 'Body')
  );
  const lines = linesOf(result);
  expect(lines).toHaveLength(1);
  expect(lines[0]!.spans.map((s) => s.text).join('')).toBe('Lead. Body');
  const segments = lineSegments(lines[0]!);
  expect(segments).toHaveLength(2);
  expect(segments[0]!.spans[0]!.style.bold).toBe(true);
  expect(segments[1]!.spans[0]!.style.bold).toBe(false);
  expect(segments[1]!.spans[0]!.style.italic).toBe(true);
  expect(paragraphTextOf(part, segments[0]!.paragraphId)).toBe('Lead');
  expect(paragraphTextOf(part, segments[1]!.paragraphId)).toBe('. Body');
  expect(segments.map((s) => [s.start, s.end])).toEqual([
    [0, 4],
    [0, 6],
  ]);
});
for (const mark of ['', '<w:specVanish/>', '<w:vanish w:val="0"/>'])
  test(`unsupported or disabled mark keeps its break ${mark}`, () => {
    expect(linesOf(layout(paragraph('Lead', mark) + paragraph('Body')).result)).toHaveLength(2);
  });
test('inherited marks accept a direct false override', () => {
  expect(
    linesOf(layout(paragraph('Lead', '', 'Lead') + paragraph('Body'), styles(true)).result)
  ).toHaveLength(1);
  expect(
    linesOf(
      layout(
        paragraph('Lead', '<w:specVanish w:val="0"/>', 'Lead') + paragraph('Body'),
        styles(true)
      ).result
    )
  ).toHaveLength(2);
});
test('warm edits retain source ranges and unchanged page identity', () => {
  let part = loadBody(paragraph('Lead', both, 'Lead') + paragraph('. Body', '', 'Body'));
  const session = createLayoutSession();
  const options = { measurer, geometry, styleCascade: styles() };
  let warm = layoutSemanticDocument(part, 1, { ...options, session });
  const segment = lineSegments(linesOf(warm)[0]!)[1]!;
  const changed = applyTreeOp(part, {
    op: 'setRunProperties',
    paragraphId: segment.paragraphId,
    start: 0,
    end: 6,
    properties: [{ localName: 'b' }],
  });
  expect(changed.ok).toBe(true);
  if (!changed.ok) return;
  part = changed.part;
  warm = layoutSemanticDocument(part, 2, { ...options, session });
  expect(warm.pages).toEqual(layoutSemanticDocument(part, 2, options).pages);
  expect(layoutSemanticDocument(part, 2, { ...options, session }).pages[0]).toBe(warm.pages[0]);
  expect(lineSegments(linesOf(warm)[0]!)[1]!.spans[0]!.style.bold).toBe(true);
});
test('a content-control boundary is not a style separator join', () => {
  const xml = `<w:sdt><w:sdtContent>${paragraph('Lead', both)}</w:sdtContent></w:sdt>${paragraph('Body')}`;
  expect(linesOf(layout(xml).result)).toHaveLength(2);
});
for (const mark of [both, '<w:vanish/>'])
  test(`balanced fields retain atomic source ownership across a display seam ${mark}`, () => {
    const field = '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>2</w:t></w:r></w:fldSimple></w:p>';
    const { result } = layout(paragraph('Lead', mark) + field);
    const line = linesOf(result)[0]!;
    expect(lineSegments(line)).toHaveLength(2);
    expect(line.spans.at(-1)!.range).toMatchObject({ start: 0, end: 1 });
  });
test('matching continuation geometry keeps first before and last after spacing', () => {
  const p = (text: string, mark: string, space: string) =>
    `<w:p><w:pPr><w:spacing ${space}/><w:rPr>${mark}</w:rPr></w:pPr>${run(text)}</w:p>`;
  const lines = linesOf(
    layout(
      p('Lead', both, 'w:before="120" w:after="480"') +
        p(' Body', '', 'w:before="480" w:after="120"') +
        paragraph('After')
    ).result
  );
  expect(lines).toHaveLength(2);
  expect(lines[1]!.box.y - lines[0]!.box.y).toBe(18);
});
test('a mixed continuation group stays separate without a partial chain join', () => {
  const different = `<w:p><w:pPr><w:jc w:val="right"/></w:pPr>${run('Last')}</w:p>`;
  expect(
    linesOf(layout(paragraph('First', both) + paragraph('Middle', both) + different).result)
  ).toHaveLength(3);
});
test('a chain beyond the member bound stays separate through its final member', () => {
  const xml =
    Array.from({ length: 65 }, () => paragraph('Lead', both)).join('') + paragraph('Body');
  expect(linesOf(layout(xml).result)).toHaveLength(66);
});
test('default-equivalent direct geometry admits the same display group', () => {
  const tail = `<w:p><w:pPr><w:jc w:val="left"/><w:ind w:left="0"/><w:spacing w:line="240" w:lineRule="auto"/></w:pPr>${run('Body')}</w:p>`;
  expect(linesOf(layout(paragraph('Lead', both) + tail).result)).toHaveLength(1);
});

test('an accepted separator preserves its number and the following counter', () => {
  const parsed = readOoxmlPart(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    { name: '/word/numbering.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const numbered = (text: string, mark: string) =>
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:rPr>${mark}</w:rPr></w:pPr>${run(text)}</w:p>`;
  const part = loadBody(
    numbered('Heading', both) +
      '<w:p><w:pPr><w:spacing w:after="240"/></w:pPr>' +
      run(' Body') +
      '</w:p>' +
      numbered('Next', '').replace('<w:rPr>', '<w:spacing w:beforeAutospacing="1"/><w:rPr>')
  );
  const result = layoutSemanticDocument(part, 1, {
    measurer,
    geometry,
    styleCascade: styles(),
    numberingIndex: buildNumberingIndex(parsed.part.root),
  });
  const markers = result.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' && fragment.marker ? [fragment.marker.text] : []
    )
  );
  expect(markers).toEqual(['1.', '2.']);
  expect(linesOf(result)).toHaveLength(2);
  expect(linesOf(result)[1]!.box.y - linesOf(result)[0]!.box.y).toBe(26);
});
test('paragraph geometry edits dissolve and restore the display group', () => {
  const initial = loadBody(paragraph('Lead', both) + paragraph(' Body'));
  const options = { measurer, geometry, styleCascade: styles() };
  const session = createLayoutSession();
  const first = layoutSemanticDocument(initial, 1, { ...options, session });
  const id = lineSegments(linesOf(first)[0]!)[1]!.paragraphId;
  const edit = applyTreeOp(initial, {
    op: 'setParagraphProperties',
    paragraphId: id,
    properties: [{ localName: 'jc', attributes: { val: 'right' } }],
  });
  expect(edit.ok).toBe(true);
  if (!edit.ok) return;
  const warm = layoutSemanticDocument(edit.part, 2, { ...options, session });
  expect(linesOf(warm)).toHaveLength(2);
  expect(warm.pages).toEqual(layoutSemanticDocument(edit.part, 2, options).pages);
  const restore = applyTreeOp(edit.part, {
    op: 'setParagraphProperties',
    paragraphId: id,
    properties: [{ localName: 'jc', attributes: { val: 'left' } }],
  });
  expect(restore.ok).toBe(true);
  if (!restore.ok) return;
  expect(linesOf(layoutSemanticDocument(restore.part, 3, { ...options, session }))).toHaveLength(1);
});
test('tracked content and section boundaries keep authored paragraph ownership', () => {
  const tracked = `<w:p><w:ins w:id="1" w:author="A">${run('Inserted')}</w:ins></w:p>`;
  for (const displayMode of ['all-markup', 'proposed', 'original'] as const) {
    const result = layoutSemanticDocument(loadBody(paragraph('Lead', both) + tracked), 1, {
      measurer,
      geometry,
      styleCascade: styles(),
      displayMode,
    });
    expect(
      linesOf(result)[0]!
        .spans.map((span) => span.text)
        .join('')
    ).toBe('Lead');
  }
  const section = `<w:p><w:pPr><w:sectPr/></w:pPr>${run('Body')}</w:p>`;
  expect(linesOf(layout(paragraph('Lead', both) + section).result)).toHaveLength(2);
});

for (const mark of [both, '<w:vanish/>'])
  test(`both seam caret positions remain addressable ${mark}`, () => {
    const { result } = layout(paragraph('Lead', mark) + paragraph(' Body'));
    const segments = lineSegments(linesOf(result)[0]!);
    const before = caretAt(result, { paragraphId: segments[0]!.paragraphId, offset: 4 }, measurer);
    const after = caretAt(result, { paragraphId: segments[1]!.paragraphId, offset: 0 }, measurer);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(before?.x).toBe(after?.x);
  });
for (const mark of [both, '<w:vanish/>'])
  test(`a note in a later member retains its source reference and warm geometry ${mark}`, () => {
    const part = loadBody(
      paragraph('Lead', mark) +
        `<w:p>${run(' Body')}<w:r><w:footnoteReference w:id="1"/></w:r></w:p>`
    );
    const parsed = readOoxmlPart(
      `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1">${paragraph('Note text')}</w:footnote></w:footnotes>`,
      { name: '/word/footnotes.xml', contentType: 'application/xml' }
    );
    if (!parsed.ok) throw Error(parsed.reason);
    const notes = {
      footnotesPart: parsed.part,
      endnotesPart: null,
      documentFootnoteProps: DEFAULT_FOOTNOTE_PROPERTIES,
      footnotePropsBySection: [DEFAULT_FOOTNOTE_PROPERTIES],
      documentEndnoteProps: DEFAULT_ENDNOTE_PROPERTIES,
      endnotePropsBySection: [DEFAULT_ENDNOTE_PROPERTIES],
      measurer,
      producer: 'separator-note',
    };
    const session = createLayoutSession();
    const options = { measurer, geometry, notes, styleCascade: styles() };
    const first = layoutSemanticDocument(part, 1, { ...options, session });
    expect(first.pages[0]!.footnotes?.notes).toHaveLength(1);
    expect(lineSegments(linesOf(first)[0]!)).toHaveLength(2);
    expect(layoutSemanticDocument(part, 1, { ...options, session }).pages[0]).toBe(first.pages[0]);
    expect(first.pages).toEqual(layoutSemanticDocument(part, 1, options).pages);
  });
test('later member REF refreshes after unrelated bookmark target edit', () => {
  let part = loadBody(
    '<w:p><w:bookmarkStart w:id="1" w:name="term"/><w:r><w:t>Alpha</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p><w:p><w:pPr><w:rPr><w:vanish/><w:specVanish/></w:rPr></w:pPr><w:r><w:t>Lead</w:t></w:r></w:p><w:p><w:fldSimple w:instr=" REF term "><w:r><w:t>Alpha</w:t></w:r></w:fldSimple></w:p>'
  );
  const session = createLayoutSession();
  const first = layoutSemanticDocument(part, 1, { measurer, geometry, session });
  expect(linesOf(first).map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'Alpha',
    'LeadAlpha',
  ]);
  const target = linesOf(first)[0]!.spans[0]!.range.paragraphId;
  const change = applyTreeOp(part, { op: 'insertText', paragraphId: target, offset: 2, text: 'Z' });
  expect(change.ok).toBe(true);
  if (!change.ok) return;
  part = change.part;
  const warm = layoutSemanticDocument(part, 2, { measurer, geometry, session });
  const cold = layoutSemanticDocument(part, 2, { measurer, geometry });
  expect(linesOf(warm).map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'AlZpha',
    'LeadAlZpha',
  ]);
  expect(warm.pages).toEqual(cold.pages);
});
test('expanded REF source blocks retain section restart numbering', () => {
  const part = loadBody(
    '<w:p><w:pPr><w:rPr><w:vanish/><w:specVanish/></w:rPr></w:pPr><w:r><w:t>Lead</w:t></w:r></w:p><w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p><w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>End</w:t></w:r></w:p><w:p><w:bookmarkStart w:id="1" w:name="note"/><w:r><w:t>Second</w:t><w:footnoteReference w:id="2"/></w:r><w:bookmarkEnd w:id="1"/></w:p><w:p><w:r><w:t>See</w:t></w:r><w:fldSimple w:instr=" NOTEREF note "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>'
  );
  const parsed = readOoxmlPart(
    `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1"><w:p><w:r><w:t>One</w:t></w:r></w:p></w:footnote><w:footnote w:id="2"><w:p><w:r><w:t>Two</w:t></w:r></w:p></w:footnote></w:footnotes>`,
    { name: '/word/footnotes.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const props = { ...DEFAULT_FOOTNOTE_PROPERTIES, numRestart: 'eachSect' as const };
  const notes = {
    footnotesPart: parsed.part,
    endnotesPart: null,
    documentFootnoteProps: props,
    footnotePropsBySection: [props, props],
    documentEndnoteProps: DEFAULT_ENDNOTE_PROPERTIES,
    endnotePropsBySection: [DEFAULT_ENDNOTE_PROPERTIES, DEFAULT_ENDNOTE_PROPERTIES],
    measurer,
    producer: 'separator-multisection',
  };
  const session = createLayoutSession();
  const options = { measurer, geometry, notes };
  const result = layoutSemanticDocument(part, 1, { ...options, session });
  expect(linesOf(result).map((line) => line.spans.map((span) => span.text).join(''))).toContain(
    'See1'
  );
  expect(linesOf(result).map((line) => line.spans.map((span) => span.text).join(''))).toContain(
    'Second1'
  );
  expect(result.pages.flatMap((p) => p.footnotes?.notes ?? [])).toHaveLength(2);
  expect(result.pages).toEqual(layoutSemanticDocument(part, 1, options).pages);
  expect(layoutSemanticDocument(part, 1, { ...options, session }).pages).toEqual(result.pages);
});
test('inherited page break remains outside the separator subset', () => {
  const parsed = readOoxmlPart(
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Break"><w:pPr><w:pageBreakBefore/></w:pPr></w:style></w:styles>`,
    { name: '/word/styles.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const styleCascade = buildStyleCascadeTable(parsed.part.root);
  const part = loadBody(
    '<w:p><w:pPr><w:rPr><w:vanish/><w:specVanish/></w:rPr></w:pPr><w:r><w:t>Lead</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Break"/></w:pPr><w:r><w:t>Body</w:t></w:r></w:p>'
  );
  const result = layoutSemanticDocument(part, 1, { measurer, geometry, styleCascade });
  expect(result.pages).toHaveLength(2);
});
test('refused interior member keeps the complete hidden-mark chain separate', () => {
  const p = (text: string, hidden = true, extra = '') =>
    `<w:p><w:pPr>${extra}<w:rPr>${hidden ? '<w:vanish/><w:specVanish/>' : ''}</w:rPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const body =
    p('First') +
    p('Refused', true, '<w:pageBreakBefore w:val="0"/>') +
    p('Third') +
    p('Last', false);
  const result = layoutSemanticDocument(loadBody(body), 1, {
    measurer: { measure: (t) => t.length * 5, lineMetrics: () => ({ height: 12, baseline: 9 }) },
  });
  expect(linesOf(result)).toHaveLength(4);
});

test('contextual-spacing groups stay separate and neighbors read the final member style', () => {
  const contextual = `<w:p><w:pPr><w:pStyle w:val="Body"/><w:contextualSpacing/><w:spacing w:before="480"/></w:pPr>${run('After')}</w:p>`;
  const result = layout(
    paragraph('Lead', both, 'Lead') + paragraph(' Body', '', 'Body') + contextual
  ).result;
  expect(linesOf(result)).toHaveLength(2);
  expect(linesOf(result)[1]!.box.y - linesOf(result)[0]!.box.y).toBe(12);
  const rejected = `<w:p><w:pPr><w:contextualSpacing/><w:rPr>${both}</w:rPr></w:pPr>${run('Lead')}</w:p><w:p><w:pPr><w:contextualSpacing/></w:pPr>${run('Body')}</w:p>`;
  expect(linesOf(layout(rejected).result)).toHaveLength(2);
});

test('different paragraph direction and typography stay outside the subset', () => {
  for (const property of ['<w:bidi/>', '<w:wordWrap w:val="0"/>', '<w:snapToGrid w:val="0"/>']) {
    const follower = `<w:p><w:pPr>${property}</w:pPr>${run('Body')}</w:p>`;
    expect(linesOf(layout(paragraph('Lead', both) + follower).result)).toHaveLength(2);
  }
});

for (const ending of ['', '<w:r><w:br/></w:r>'])
  test(`the final member owns terminal mark metrics ${ending}`, () => {
    const sizedMeasurer: TextMeasurer = {
      measure: (text) => text.length * 5,
      lineMetrics: (style) => ({ height: style.fontSizePt, baseline: style.fontSizePt * 0.8 }),
    };
    const member = `<w:p><w:pPr><w:rPr><w:sz w:val="96"/></w:rPr></w:pPr>${run('Body')}${ending}</w:p>`;
    const joined = `<w:p><w:pPr><w:rPr><w:sz w:val="96"/></w:rPr></w:pPr>${run('LeadBody')}${ending}</w:p>`;
    const actual = layoutSemanticDocument(loadBody(paragraph('Lead', both) + member), 1, {
      measurer: sizedMeasurer,
      geometry,
    });
    const expected = layoutSemanticDocument(loadBody(joined), 1, {
      measurer: sizedMeasurer,
      geometry,
    });
    expect(linesOf(actual).map((line) => line.box.height)).toEqual(
      linesOf(expected).map((line) => line.box.height)
    );
  });

for (const mark of ['<w:vanish/>', '<w:vanish/><w:specVanish w:val="0"/>'])
  test(`visible hidden-mark joins retain source ranges ${mark}`, () => {
    const { part, result } = layout(paragraph('Lead', mark) + paragraph('. Body'));
    expect(linesOf(result)).toHaveLength(1);
    const segments = lineSegments(linesOf(result)[0]!);
    expect(segments.map((s) => paragraphTextOf(part, s.paragraphId))).toEqual(['Lead', '. Body']);
    expect(segments.map((s) => [s.start, s.end])).toEqual([
      [0, 4],
      [0, 6],
    ]);
  });
test('an unsupported extension preserves the accepted special prefix', () => {
  const follower = '<w:p><w:pPr><w:ind w:left="720"/></w:pPr>' + run('Follower') + '</w:p>';
  const result = layout(paragraph('Lead', both) + paragraph('.', '<w:vanish/>') + follower).result;
  expect(linesOf(result).map((l) => l.spans.map((s) => s.text).join(''))).toEqual([
    'Lead.',
    'Follower',
  ]);
  expect(lineSegments(linesOf(result)[0]!)).toHaveLength(2);
});
test('a compatible extended chain retains all source owners', () => {
  const result = layout(
    paragraph('Lead', both) + paragraph('.', '<w:vanish/>') + paragraph(' Body')
  ).result;
  expect(linesOf(result)).toHaveLength(1);
  expect(lineSegments(linesOf(result)[0]!)).toHaveLength(3);
});
test('a final visible hidden mark retains its line', () => {
  expect(linesOf(layout(paragraph('Lead') + paragraph('End', '<w:vanish/>')).result)).toHaveLength(
    2
  );
});
test('visible direct overrides admit an inherited hidden mark', () => {
  const xml =
    '<w:p><w:pPr><w:pStyle w:val="Lead"/><w:rPr><w:specVanish w:val="0"/></w:rPr></w:pPr><w:r><w:rPr><w:vanish w:val="0"/></w:rPr><w:t>Lead</w:t></w:r></w:p>' +
    paragraph(' Body');
  expect(linesOf(layout(xml, styles(true)).result)).toHaveLength(1);
});
test('hidden-mark edits preserve cold geometry and source offsets', () => {
  let part = loadBody(paragraph('Lead', '<w:vanish/>') + paragraph(' Body'));
  const session = createLayoutSession();
  const options = { measurer, geometry, styleCascade: styles() };
  let warm = layoutSemanticDocument(part, 1, { ...options, session });
  const segment = lineSegments(linesOf(warm)[0]!)[0]!;
  for (const hidden of [true, false]) {
    const changed = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: segment.paragraphId,
      offset: 0,
      text: hidden ? 'A' : 'B',
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    part = changed.part;
    warm = layoutSemanticDocument(part, hidden ? 2 : 3, { ...options, session });
    expect(warm.pages).toEqual(layoutSemanticDocument(part, hidden ? 2 : 3, options).pages);
    expect(layoutSemanticDocument(part, hidden ? 2 : 3, { ...options, session }).pages[0]).toBe(
      warm.pages[0]
    );
  }
});

test('mark visibility changes retain warm and cold geometry', () => {
  const session = createLayoutSession();
  const options = { measurer, geometry, styleCascade: styles() };
  for (const mark of ['<w:vanish/>', '<w:vanish w:val="0"/>', '<w:vanish/>']) {
    const part = loadBody(paragraph('Lead', mark) + paragraph(' Body'));
    const warm = layoutSemanticDocument(part, 1, { ...options, session });
    expect(warm.pages).toEqual(layoutSemanticDocument(part, 1, options).pages);
    expect(linesOf(warm)).toHaveLength(mark.includes('val=') ? 2 : 1);
  }
});
test('hidden-only and empty marks preserve the empty paragraph path', () => {
  for (const content of ['', '<w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden</w:t></w:r>']) {
    const part = loadBody(
      '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr>' + content + '</w:p>' + paragraph('Body')
    );
    const result = layoutSemanticDocument(part, 1, { measurer, geometry });
    expect(linesOf(result)).toHaveLength(1);
    expect(lineSegments(linesOf(result)[0]!)).toHaveLength(1);
    expect(
      linesOf(result)[0]!
        .spans.map((s) => s.text)
        .join('')
    ).toBe('Body');
  }
});

test('a numbered hidden heading joins a compatible empty successor and keeps its final spacing', () => {
  const parsed = readOoxmlPart(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    { name: '/word/numbering.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const part = loadBody(
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="480"/><w:rPr><w:vanish/></w:rPr></w:pPr>${run('Heading')}</w:p>` +
      '<w:p><w:pPr><w:spacing w:after="200"/><w:ind w:left="360"/></w:pPr></w:p>' +
      paragraph('Following body')
  );
  const session = createLayoutSession();
  const options = {
    measurer,
    geometry,
    styleCascade: styles(),
    numberingIndex: buildNumberingIndex(parsed.part.root),
  };
  const result = layoutSemanticDocument(part, 1, { ...options, session });
  const lines = linesOf(result);
  expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'Heading',
    'Following body',
  ]);
  expect(lines[1]!.box.y - lines[0]!.box.y).toBe(22);
  const markers = result.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' && fragment.marker ? [fragment.marker.text] : []
    )
  );
  expect(markers).toEqual(['1.']);
  expect(result.pages).toEqual(layoutSemanticDocument(part, 1, options).pages);
  expect(layoutSemanticDocument(part, 1, { ...options, session }).pages[0]).toBe(result.pages[0]);
});

test('separator exclusions stay lazy when every mark is visible', () => {
  const part = loadBody(paragraph('First') + paragraph('Second', '<w:specVanish/>'));
  const body = part.root.children.find((node) => node.kind === 'body');
  if (!body) throw new Error('Missing body');
  let calls = 0;
  const result = mergedFlowBlocks(
    body.children,
    'proposed',
    undefined,
    styles(),
    true,
    undefined,
    () => {
      calls++;
      return new Set();
    }
  );
  expect(calls).toBe(0);
  expect(result).toHaveLength(2);
});

for (const mark of [both, '<w:vanish/>']) {
  test(`hidden marks resolve exclusions once and preserve the boundary: ${mark}`, () => {
    const part = loadBody(paragraph('First', mark) + paragraph('Second'));
    const body = part.root.children.find((node) => node.kind === 'body');
    if (!body) throw new Error('Missing body');
    const first = body.children.find((node) => node.kind === 'paragraph')!;
    let calls = 0;
    const result = mergedFlowBlocks(
      body.children,
      'proposed',
      undefined,
      styles(),
      true,
      undefined,
      () => {
        calls++;
        return new Set([first.id]);
      }
    );
    expect(calls).toBe(1);
    expect(result).toHaveLength(2);
    expect(
      mergedFlowBlocks(
        body.children,
        'proposed',
        undefined,
        styles(),
        true,
        undefined,
        () => new Set()
      )
    ).toHaveLength(1);
  });

  test(`TOC boundaries remain separate with lazy exclusions: ${mark}`, () => {
    const part = loadBody(
      `<w:p><w:pPr><w:rPr>${mark}</w:rPr></w:pPr>` +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> TOC </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        run('Contents') +
        '</w:p>' +
        paragraph('Entry') +
        '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        run('Trailer') +
        '</w:p>'
    );
    expect(storyBlocks(part, 'proposed', undefined, styles())).toHaveLength(3);
  });
}

test('inherited hidden marks resolve separator exclusions', () => {
  const part = loadBody(paragraph('First', '', 'Lead') + paragraph('Second'));
  const body = part.root.children.find((node) => node.kind === 'body');
  if (!body) throw new Error('Missing body');
  let calls = 0;
  const result = mergedFlowBlocks(
    body.children,
    'proposed',
    undefined,
    styles(true),
    true,
    undefined,
    () => {
      calls++;
      return new Set();
    }
  );
  expect(calls).toBe(1);
  expect(result).toHaveLength(1);
});
