import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { writeZip, strToU8 } from '../../store/package/zip.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { interopHtmlFromFragment } from '../clipboard-html-write.ts';
import { projectExternalHtml } from '../clipboard-html-read.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const cell = (text: string, properties = '') =>
  `<w:tc><w:tcPr>${properties}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const table = (properties: string, cells = cell('FIRST') + cell('SECOND')) =>
  `<w:tbl><w:tblPr>${properties}</w:tblPr><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`;
function html(body: string, styles = ''): string {
  const entries = new Map<string, Uint8Array>([
    [
      '[Content_Types].xml',
      strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
      ),
    ],
    [
      '_rels/.rels',
      strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
    ],
    [
      'word/_rels/document.xml.rels',
      strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/></Relationships>`
      ),
    ],
    [
      'word/document.xml',
      strToU8(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
    ],
    ['word/styles.xml', strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`)],
  ]);
  return interopHtmlFromFragment(writeZip(entries));
}
function reopened(markup: string) {
  const result = projectExternalHtml(markup);
  if (!result.ok) throw Error(result.reason);
  const read = readOoxmlPackage(result.fragmentBytes);
  if (!read.ok) throw Error(read.reason);
  const part = read.package.parts.get('/word/document.xml')!;
  return { markup: interopHtmlFromFragment(result.fragmentBytes), xml: serializeOoxmlPart(part) };
}
function parsed(markup: string) {
  return new DOMParser().parseFromString(markup, 'text/html');
}

test.each([false, true])(
  'HTML preserves direct or inherited RTL table direction (inherited=%s)',
  (inherited) => {
    const styles =
      '<w:style w:type="table" w:styleId="Base"><w:tblPr><w:bidiVisual/></w:tblPr></w:style><w:style w:type="table" w:styleId="Derived"><w:basedOn w:val="Base"/></w:style>';
    const markup = html(
      table(inherited ? '<w:tblStyle w:val="Derived"/>' : '<w:bidiVisual/>'),
      styles
    );
    const doc = parsed(markup);
    expect(doc.querySelector('table')?.getAttribute('dir')).toBe('rtl');
    expect(doc.querySelector('table')?.getAttribute('align')).toBe('right');
    expect([...doc.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['FIRST', 'SECOND']);
    expect(doc.querySelector('td')?.getAttribute('dir')).toBe('ltr');
    const roundtrip = reopened(markup);
    expect(roundtrip.xml).toContain('<w:bidiVisual/>');
    expect(parsed(roundtrip.markup).querySelector('table')?.getAttribute('dir')).toBe('rtl');
  }
);

test('explicit false overrides the table style and nested tables isolate their direction', () => {
  const styles =
    '<w:style w:type="table" w:styleId="RTL"><w:tblPr><w:bidiVisual/></w:tblPr></w:style>';
  const inner = table('<w:tblStyle w:val="RTL"/><w:bidiVisual w:val="0"/>');
  const markup = html(
    table('<w:bidiVisual/>', `<w:tc>${inner}<w:p/></w:tc>` + cell('OUTER')),
    styles
  );
  for (const output of [markup, reopened(markup).markup]) {
    expect([...parsed(output).querySelectorAll('table')].map((t) => t.getAttribute('dir'))).toEqual(
      ['rtl', 'ltr']
    );
  }
});

test('HTML roundtrip preserves physical border, padding, and alignment in RTL tables', () => {
  const markup = html(
    table(
      '<w:bidiVisual/><w:jc w:val="right"/><w:tblCellMar><w:start w:w="200" w:type="dxa"/><w:end w:w="40" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:start w:val="single" w:sz="8" w:color="AA0000"/></w:tblBorders>',
      cell(
        'FIRST',
        '<w:tcBorders><w:right w:val="single" w:sz="8" w:color="0000AA"/></w:tcBorders>'
      ) + cell('SECOND')
    )
  );
  for (const output of [markup, reopened(markup).markup]) {
    const doc = parsed(output);
    expect(doc.querySelector('table')?.getAttribute('align')).toBe('left');
    const c = doc.querySelector('td')!;
    expect(c.style.borderRightColor).toBe('#aa0000');
    expect(c.style.borderLeftColor).toBe('#0000aa');
    expect(c.style.paddingRight).toBe('10pt');
    expect(c.style.paddingLeft).toBe('2pt');
  }
});

test('CSS direction overrides dir for imported table geometry without changing cell text', () => {
  const result = reopened(
    '<table dir="ltr" style="direction:rtl"><tr><td><p>FIRST</p></td><td><p>SECOND</p></td></tr></table>'
  );
  expect(result.xml).toContain('<w:bidiVisual/>');
  expect(result.xml).not.toContain('<w:bidi/>');
  expect(parsed(result.markup).querySelector('table')?.getAttribute('align')).toBe('left');
});

test('default table style supplies RTL direction and direct margins merge by edge', () => {
  const styles =
    '<w:style w:type="table" w:default="1" w:styleId="Default"><w:tblPr><w:bidiVisual/><w:tblCellMar><w:start w:w="200" w:type="dxa"/><w:end w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>';
  const markup = html(table('<w:tblCellMar><w:top w:w="60" w:type="dxa"/></w:tblCellMar>'), styles);
  const doc = parsed(markup);
  expect(doc.querySelector('table')?.getAttribute('dir')).toBe('rtl');
  const c = doc.querySelector('td')!;
  expect(c.style.paddingTop).toBe('3pt');
  expect(c.style.paddingRight).toBe('10pt');
  expect(c.style.paddingLeft).toBe('2pt');
  const overridden = parsed(html(table('<w:bidiVisual w:val="false"/>'), styles));
  expect(overridden.querySelector('table')?.getAttribute('dir')).toBe('ltr');
});

test.each(['Missing', 'WrongType'])('unresolved named table style %s uses the default', (name) => {
  const styles =
    '<w:style w:type="table" w:default="1" w:styleId="Default"><w:tblPr><w:bidiVisual/></w:tblPr></w:style><w:style w:type="paragraph" w:styleId="WrongType"/>';
  const doc = parsed(html(table(`<w:tblStyle w:val="${name}"/>`), styles));
  expect(doc.querySelector('table')?.getAttribute('dir')).toBe('rtl');
});
