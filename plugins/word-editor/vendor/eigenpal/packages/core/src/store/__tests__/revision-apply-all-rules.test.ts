// What Accept All and Reject All leave: a lock keeps only the decisions it must, a nested table
// with no text left goes with its inserted row, and an emptied custom XML block goes whole.
import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  planRevisionBatch,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlPart,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ann = (id: number, author = 'Ann') => `w:id="${id}" w:author="${author}"`;
const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function load(body: string): OoxmlPart {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw Error(read.reason);
  return read.part;
}
function decideAll(body: string, action: 'accept' | 'reject') {
  let part = load(body);
  const plan = planRevisionBatch(part, action);
  for (const op of plan.ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw Error(result.reason);
    part = result.part;
  }
  const xml = serializeOoxmlPart(part);
  const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>(.*?)<\/w:p>/gs)].map((match) =>
    [...match[1]!.matchAll(/<w:(?:t|delText)\b[^>]*>([^<]*)<\/w:(?:t|delText)>/g)]
      .map((text) => text[1])
      .join('')
  );
  return { xml, paragraphs, plan };
}

test('reject all restores a deletion inside a locked insertion and keeps the insertion pending', () => {
  const control =
    '<w:p><w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
    '<w:r><w:t xml:space="preserve">in </w:t></w:r>' +
    `<w:ins ${ann(1)}><w:r><w:t xml:space="preserve">keep </w:t></w:r>` +
    `<w:del ${ann(2, 'Bob')}><w:r><w:delText xml:space="preserve">cut </w:delText></w:r></w:del></w:ins>` +
    '<w:r><w:t>end</w:t></w:r></w:sdtContent></w:sdt></w:p>';
  const { xml, plan } = decideAll(control, 'reject');
  expect(plan.result.resolved.map((entry) => entry.author)).toEqual(['Bob']);
  expect(plan.result.skipped).toMatchObject([{ detail: 'locked-content' }]);
  expect(xml).not.toContain('<w:del ');
  expect(xml).toContain('>cut </w:t>');
  expect(xml).toContain('<w:ins ');
});

const nestedRow = (inner: string) =>
  '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/>' +
  '<w:gridCol w:w="3000"/></w:tblGrid>' +
  `<w:tr><w:tc>${p('a')}</w:tc><w:tc>${p('b')}</w:tc></w:tr>` +
  `<w:tr><w:trPr><w:ins ${ann(10)}/></w:trPr><w:tc>` +
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
  `<w:tr><w:tc>${inner}</w:tc></w:tr></w:tbl>` +
  `<w:p><w:pPr><w:rPr><w:ins ${ann(11)}/></w:rPr></w:pPr><w:ins ${ann(12)}><w:r><w:t>n1</w:t></w:r></w:ins></w:p>` +
  `</w:tc><w:tc><w:p><w:pPr><w:rPr><w:ins ${ann(13)}/></w:rPr></w:pPr><w:ins ${ann(14)}><w:r><w:t>n2</w:t></w:r></w:ins></w:p></w:tc></w:tr>` +
  `</w:tbl>${p('After')}`;

test('reject all removes an inserted row whose nested table holds only inserted text', () => {
  const inner = `<w:p><w:pPr><w:rPr><w:ins ${ann(20)}/></w:rPr></w:pPr><w:ins ${ann(21)}><w:r><w:t>in</w:t></w:r></w:ins></w:p>`;
  const { xml, paragraphs, plan } = decideAll(nestedRow(inner), 'reject');
  expect(plan.result.skipped).toEqual([]);
  expect(paragraphs).toEqual(['a', 'b', 'After']);
  expect(xml.match(/<w:tbl>/g)).toHaveLength(1);
});

test('reject all keeps an inserted row whose nested table holds untracked text', () => {
  const { plan } = decideAll(nestedRow(p('kept')), 'reject');
  expect(plan.result.skipped).toMatchObject([{ reason: 'retained-structure' }]);
});

test('reject all removes a custom XML block that held only an inserted paragraph', () => {
  const block =
    `${p('Before')}<w:customXml w:element="section"><w:p><w:pPr><w:rPr><w:ins ${ann(30)}/></w:rPr></w:pPr>` +
    `<w:ins ${ann(31)}><w:r><w:t>added</w:t></w:r></w:ins></w:p></w:customXml>${p('After')}`;
  const { xml, paragraphs } = decideAll(block, 'reject');
  expect(paragraphs).toEqual(['Before', 'After']);
  expect(xml).not.toContain('customXml');
});

test('reject all keeps an inserted row whose nested table holds an untracked picture', () => {
  const picture =
    '<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" id="s"/></w:pict></w:r></w:p>';
  const { plan } = decideAll(nestedRow(picture), 'reject');
  expect(plan.result.skipped).toMatchObject([{ reason: 'retained-structure' }]);
});

test('a custom XML block alone in a cell keeps a paragraph in the cell', () => {
  const body =
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc>' +
    `<w:customXml w:element="section"><w:p><w:pPr><w:rPr><w:ins ${ann(40)}/></w:rPr></w:pPr>` +
    `<w:ins ${ann(41)}><w:r><w:t>added</w:t></w:r></w:ins></w:p></w:customXml>` +
    `</w:tc></w:tr></w:tbl>${p('After')}`;
  const { xml } = decideAll(body, 'reject');
  const cell = xml.match(/<w:tc>(.*?)<\/w:tc>/s)![1]!;
  expect(cell).toMatch(/<w:p\b/);
});

// An insertion nested in a deletion is not a shape the reference editor opens; both stay pending.
test('reject all leaves a locked deletion that holds an insertion pending', () => {
  const control =
    '<w:p><w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
    `<w:del ${ann(50, 'Bob')}><w:r><w:delText xml:space="preserve">gone </w:delText></w:r>` +
    `<w:ins ${ann(51)}><w:r><w:t xml:space="preserve">new </w:t></w:r></w:ins></w:del>` +
    '<w:r><w:t>end</w:t></w:r></w:sdtContent></w:sdt></w:p>';
  const { xml, plan } = decideAll(control, 'reject');
  expect(plan.result.resolved).toEqual([]);
  expect(xml).toContain('>gone </w:delText>');
  expect(xml).toContain('>new </w:t>');
});

test('a custom XML block after a table in a cell stays, so the cell ends with a paragraph', () => {
  const inner =
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
    `<w:tr><w:tc>${p('x')}</w:tc></w:tr></w:tbl>`;
  const body =
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc>' +
    inner +
    `<w:customXml w:element="section"><w:p><w:pPr><w:rPr><w:ins ${ann(60)}/></w:rPr></w:pPr>` +
    `<w:ins ${ann(61)}><w:r><w:t>added</w:t></w:r></w:ins></w:p></w:customXml>` +
    `</w:tc></w:tr></w:tbl>${p('After')}`;
  const { xml } = decideAll(body, 'reject');
  const afterInner = xml.slice(xml.indexOf('</w:tbl>') + '</w:tbl>'.length);
  expect(afterInner.startsWith('<w:customXml') || afterInner.startsWith('<w:p')).toBe(true);
});

test('a custom XML block holding only a bookmark stays when another paragraph is decided', () => {
  const body =
    `${p('Before')}<w:customXml w:element="anchor"><w:bookmarkStart w:id="7" w:name="b"/>` +
    '<w:bookmarkEnd w:id="7"/></w:customXml>' +
    `<w:p><w:pPr><w:rPr><w:ins ${ann(70)}/></w:rPr></w:pPr><w:ins ${ann(71)}><w:r><w:t>x</w:t></w:r></w:ins></w:p>` +
    p('After');
  const { xml } = decideAll(body, 'reject');
  expect(xml).toContain('w:name="b"');
});

test('reject all keeps an inserted row whose nested table holds an untracked equation', () => {
  const equation =
    '<w:p><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">' +
    '<m:r><m:t>x=1</m:t></m:r></m:oMath></w:p>';
  const { plan } = decideAll(nestedRow(equation), 'reject');
  expect(plan.result.skipped).toMatchObject([{ reason: 'retained-structure' }]);
});

test('reject all removes a custom XML block that held two inserted paragraphs', () => {
  const inserted = (id: number, text: string) =>
    `<w:p><w:pPr><w:rPr><w:ins ${ann(id)}/></w:rPr></w:pPr>` +
    `<w:ins ${ann(id + 1)}><w:r><w:t>${text}</w:t></w:r></w:ins></w:p>`;
  const block =
    `${p('Before')}<w:customXml w:element="section">${inserted(80, 'one')}${inserted(82, 'two')}` +
    `</w:customXml>${p('After')}`;
  const { xml, paragraphs } = decideAll(block, 'reject');
  expect(paragraphs).toEqual(['Before', 'After']);
  expect(xml).not.toContain('customXml');
});
