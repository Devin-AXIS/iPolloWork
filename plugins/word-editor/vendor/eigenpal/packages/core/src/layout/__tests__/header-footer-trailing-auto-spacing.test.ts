// A header or footer keeps its last paragraph's automatic space after: the story reserves
// it, so the body starts below it (header) or ends above it (footer). A table cell drops the
// automatic space after its own last paragraph, and so does a frame in the story.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutHeaderFooterStory } from '../index.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const AUTO =
  '<w:spacing w:before="100" w:beforeAutospacing="1" w:after="100" w:afterAutospacing="1"/>';
const EXPLICIT = '<w:spacing w:before="0" w:after="280"/>';
const NONE = '<w:spacing w:before="0" w:after="0"/>';
/** Automatic space before, but no space after. */
const AUTO_BEFORE = '<w:spacing w:before="100" w:beforeAutospacing="1" w:after="0"/>';

const paragraph = (text: string, spacing: string) =>
  `<w:p><w:pPr>${spacing}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

function read(xml: string, name: string) {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** The style table of a document with `w:doNotUseHTMLParagraphAutoSpacing` on. */
const fixedSpacing = () =>
  buildStyleCascadeTable(
    read(`<w:styles xmlns:w="${W}"/>`, '/word/styles.xml').root,
    undefined,
    read(
      `<w:settings xmlns:w="${W}"><w:compat><w:doNotUseHTMLParagraphAutoSpacing/></w:compat></w:settings>`,
      '/word/settings.xml'
    ).root
  );

function story(kind: 'hdr' | 'ftr', content: string, cascade?: ReturnType<typeof fixedSpacing>) {
  const name = kind === 'hdr' ? '/word/header1.xml' : '/word/footer1.xml';
  const part = read(`<w:${kind} xmlns:w="${W}">${content}</w:${kind}>`, name);
  return layoutHeaderFooterStory(part, 468, measurer, name, undefined, cascade);
}

const flowHeight = (kind: 'hdr' | 'ftr', content: string) => story(kind, content).flowHeight;

const lines = (spacing: string) =>
  paragraph('First', spacing) + paragraph('Second', spacing) + paragraph('Third', spacing);

for (const kind of ['hdr', 'ftr'] as const) {
  test(`a ${kind} story reserves its last paragraph's automatic space after`, () => {
    const auto = flowHeight(kind, lines(AUTO));
    // The same 14pt as an authored space after.
    expect(auto).toBeCloseTo(flowHeight(kind, lines(EXPLICIT)), 3);
    // Only the last paragraph differs: it adds its automatic 14pt below the last line.
    const tail =
      paragraph('First', AUTO) + paragraph('Second', AUTO) + paragraph('Third', AUTO_BEFORE);
    expect(auto).toBeCloseTo(flowHeight(kind, tail) + 14, 3);
  });

  test(`a ${kind} story keeps the automatic space after a content control at its end`, () => {
    const wrapped = `<w:sdt><w:sdtPr><w:id w:val="1"/></w:sdtPr><w:sdtContent>${lines(AUTO)}</w:sdtContent></w:sdt>`;
    expect(flowHeight(kind, wrapped)).toBeCloseTo(flowHeight(kind, lines(EXPLICIT)), 3);
  });

  test(`a ${kind} story keeps the measured space after under fixed spacing`, () => {
    const tail =
      paragraph('First', AUTO) + paragraph('Second', AUTO) + paragraph('Third', AUTO_BEFORE);
    // The setting keeps the authored 5pt after in place of 14pt; the story end keeps it too.
    expect(story(kind, lines(AUTO), fixedSpacing()).flowHeight).toBeCloseTo(
      story(kind, tail, fixedSpacing()).flowHeight + 5,
      3
    );
  });
}

test('a table cell in a header still drops its last paragraph automatic space after', () => {
  const table = (spacing: string) =>
    '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
    `<w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>${paragraph('Cell', spacing)}</w:tc></w:tr></w:tbl>`;
  // The story ends with an unspaced paragraph so that only the cell edge differs.
  const after = paragraph('Below', NONE);
  expect(flowHeight('hdr', table(AUTO) + after)).toBeCloseTo(
    flowHeight('hdr', table(NONE) + after),
    3
  );
});

test('a frame in a header drops its last paragraph automatic space after, like a cell', () => {
  const frame =
    '<w:framePr w:w="4000" w:x="6400" w:y="960" w:hAnchor="page" w:vAnchor="text" w:wrap="around"/>';
  const height = (spacing: string) => {
    const framed = paragraph('Framed', frame + spacing) + paragraph('Anchor', NONE);
    const fragments = story('hdr', framed).fragments as readonly ParagraphFragmentRecord[];
    const placed = fragments.find((fragment) => fragment.outOfFlow);
    expect(placed).toBeDefined();
    return placed!.box.height;
  };
  expect(height(AUTO)).toBeCloseTo(height(AUTO_BEFORE), 3);
});

test('a page-number frame that opens a header drops its automatic space after', () => {
  const frame =
    '<w:framePr w:wrap="around" w:vAnchor="text" w:hAnchor="margin" w:xAlign="inside" w:y="1"/>';
  const field =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve">PAGE</w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const content =
    `<w:p><w:pPr><w:pStyle w:val="Framed"/>${frame}</w:pPr>${field}</w:p>` +
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>RUNNING HEAD</w:t></w:r></w:p>';
  // The frame's style carries the spacing; the fixed frame lane refuses direct spacing.
  const styled = (spacing: string) =>
    buildStyleCascadeTable(
      read(
        `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Framed">` +
          `<w:name w:val="framed"/><w:pPr>${spacing}</w:pPr></w:style></w:styles>`,
        '/word/styles.xml'
      ).root
    );
  const auto = story('hdr', content, styled(AUTO));
  // The frame shares the running head's line, so the header is one line tall either way.
  expect(auto.fragments[1]!.box.y).toBe(0);
  expect(auto.flowHeight).toBeCloseTo(story('hdr', content, styled(AUTO_BEFORE)).flowHeight, 3);
});
