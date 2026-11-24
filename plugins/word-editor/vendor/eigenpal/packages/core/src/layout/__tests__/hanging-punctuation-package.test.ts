import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { canonicalOoxmlFingerprint, semanticDigest, writeOoxmlPackage } from '../../store/index.ts';
import { openHeadlessDocument } from '../../store/headless-document-view.ts';
import { createDocumentStyleDependencies } from '../document-style-deps.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { caretAt } from '../semantic-interaction.ts';
import { linesOf } from '../semantic-records.ts';
import { loadFixture, measurer } from './punctuation-kerning-fixture.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const H = '国'.repeat(19);
const paragraph = (text: string, language: string) =>
  '<w:p><w:pPr><w:jc w:val="both"/><w:overflowPunct/></w:pPr><w:r><w:rPr>' +
  `<w:sz w:val="48"/><w:lang w:eastAsia="${language}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const cell = (content: string) =>
  '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
  '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
  '</w:tblPr><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:tc><w:tcPr>' +
  '<w:tcW w:w="9360" w:type="dxa"/></w:tcPr>' +
  content +
  '</w:tc></w:tr></w:tbl><w:p/>';

function source() {
  const { entries } = loadFixture();
  entries['word/document.xml'] =
    `<w:document xmlns:w="${W}"><w:body>` +
    paragraph(H + '！国', 'ja-JP') +
    paragraph(H + '！国', 'ko-KR') +
    paragraph(H + '。', 'ja-JP') +
    cell(paragraph(H + '。', 'ja-JP')) +
    '</w:body></w:document>';
  return zipSync(
    Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)]))
  );
}
function open(bytes: Uint8Array) {
  const opened = openHeadlessDocument(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  return opened.view;
}
function render(view: ReturnType<typeof open>, session = createLayoutSession()) {
  const dependencies = createDocumentStyleDependencies(view);
  return layoutSemanticDocument(view.part(), view.packageRevision(), {
    measurer,
    session,
    styleCascade: dependencies.styleCascade(),
    geometry: { width: 488, height: 1000, margin: { top: 10, bottom: 10, left: 10, right: 10 } },
  });
}
const fingerprint = (view: ReturnType<typeof open>) =>
  [...view.currentPackage().parts].map(([name, part]) => [name, canonicalOoxmlFingerprint(part)]);

test('hanging punctuation keeps body and cell geometry through canonical save and reopen', () => {
  const view = open(source());
  const before = fingerprint(view);
  const session = createLayoutSession();
  const first = render(view, session);
  expect(render(view, session).pages).toEqual(first.pages);
  const lines = linesOf(first).filter((line) => line.spans.some((span) => span.text.length));
  expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    H.slice(1),
    '国！国',
    H,
    '！国',
    H + '。',
    H + '。',
  ]);
  for (const line of lines.slice(-2)) {
    expect(
      caretAt(first, { paragraphId: line.range.paragraphId, offset: 19 }, measurer)!.x - line.box.x
    ).toBeCloseTo(468, 6);
  }
  expect(fingerprint(view)).toEqual(before);
  const pkg = view.currentPackage();
  const reopened = open(writeOoxmlPackage(pkg));
  expect(semanticDigest([...reopened.currentPackage().parts.values()])).toEqual(
    semanticDigest([...pkg.parts.values()])
  );
  expect(
    linesOf(render(reopened)).map((line) => line.spans.map((span) => span.text).join(''))
  ).toEqual(linesOf(first).map((line) => line.spans.map((span) => span.text).join('')));
});
