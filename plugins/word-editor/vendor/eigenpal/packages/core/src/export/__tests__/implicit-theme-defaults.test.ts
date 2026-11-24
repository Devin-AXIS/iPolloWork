import { expect, test } from 'bun:test';
import { strToU8, zipSync, unzipSync } from 'fflate';
import { resolveRunStyle } from '../../layout/run-style.ts';
import { createRunDefaultsResolver } from '../../store/package/run-defaults.ts';
import { readOoxmlPart, type OoxmlElement } from '../../store/package/ooxml-tree.ts';
import { collectRenderedFontFamilyCandidates } from '../../store/package/rendered-fonts.ts';
import { defineFontResolver } from '../../layout/font-resolver.ts';
import { forEachSemanticSpan } from '../../layout/export-traversal.ts';
import { openFontBackedDocumentForExport } from '../document-export-shaping.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const theme = {
  major: 'Heading Face',
  minor: 'Body Face',
  majorEastAsia: null,
  minorEastAsia: 'CJK Face',
};
const latinAttributes = ['ascii', 'hAnsi', 'asciiTheme', 'hAnsiTheme'];

function root(xml: string, name = '/word/styles.xml'): OoxmlElement {
  const parsed = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part.root;
}

function styles(content = ''): OoxmlElement {
  return root(`<w:styles xmlns:w="${W}">${content}</w:styles>`);
}

function bytes(withTheme = true): Uint8Array {
  const rows = [
    '',
    'w:ascii="Arial" w:hAnsi="Arial"',
    'w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"',
    'w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"',
    'w:eastAsia="Hiragino Mincho ProN"',
    'w:eastAsiaTheme="minorEastAsia"',
    'w:eastAsiaTheme="majorEastAsia"',
  ];
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="doc" Type="${OFFICE}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${withTheme ? `<Relationship Id="theme" Type="${OFFICE}/theme" Target="theme/theme1.xml"/>` : ''}<Relationship Id="settings" Type="${OFFICE}/settings" Target="settings.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${rows.map((attributes, index) => `<w:p><w:r><w:rPr><w:rFonts ${attributes}/></w:rPr><w:t>${String.fromCharCode(65 + index)} Latin 日本語</w:t></w:r></w:p>`).join('')}</w:body></w:document>`
    ),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${W}"><w:themeFontLang w:val="ja-JP" w:eastAsia="zh-CN"/></w:settings>`
    ),
    'word/theme/theme1.xml': strToU8(
      `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme name="Languages">${['major', 'minor'].map((slot) => `<a:${slot}Font><a:latin typeface="Arial"/><a:ea typeface=""/><a:font script="Jpan" typeface="Hiragino Mincho ProN"/><a:font script="Hans" typeface="${slot === 'major' ? 'Hiragino Mincho ProN' : 'Songti SC'}"/></a:${slot}Font>`).join('')}</a:fontScheme></a:themeElements></a:theme>`
    ),
  });
}

test('omitted Latin slots inherit the body theme after the complete cascade', () => {
  const omitted: Record<string, string>[] = [
    {},
    { eastAsia: 'Explicit CJK' },
    { eastAsiaTheme: 'majorEastAsia' },
  ];
  for (const attributes of omitted) {
    expect(resolveRunStyle([{ localName: 'rFonts', attributes }], theme).fontFamily).toBe(
      'Body Face'
    );
  }
  expect(resolveRunStyle([], theme).fontFamily).toBe('Body Face');
  expect(resolveRunStyle([]).fontFamily).toBeNull();
  for (const name of latinAttributes) {
    const attributes = { [name]: name.endsWith('Theme') ? 'majorHAnsi' : 'Inherited Face' };
    expect(
      resolveRunStyle(
        [
          { localName: 'rFonts', attributes },
          { localName: 'rFonts', attributes: { eastAsia: 'CJK' } },
        ],
        theme
      ).fontFamily
    ).toBe(name.endsWith('Theme') ? 'Heading Face' : 'Inherited Face');
  }
});

test('an unresolved authored Latin theme reference retains the host fallback', () => {
  const attributes = { asciiTheme: 'minorEastAsia' };
  const emptyEA = {
    major: 'Heading Face',
    minor: 'Body Face',
    majorEastAsia: null,
    minorEastAsia: null,
  };
  expect(resolveRunStyle([{ localName: 'rFonts', attributes }], emptyEA).fontFamily).toBeNull();
  const unresolved = styles(
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorEastAsia"/></w:rPr></w:rPrDefault></w:docDefaults>'
  );
  expect(createRunDefaultsResolver(unresolved, emptyEA)(null).fontFamily).toBeNull();
  expect(
    createRunDefaultsResolver(null, emptyEA)(null, [{ localName: 'rFonts', attributes }]).fontFamily
  ).toBeNull();
});

test('formatting defaults preserve explicit document and inherited style fonts', () => {
  for (const styleRoot of [
    null,
    styles(),
    styles(
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="CJK"/></w:rPr></w:rPrDefault></w:docDefaults>'
    ),
  ]) {
    expect(createRunDefaultsResolver(styleRoot, theme)(null)).toEqual({
      fontFamily: 'Body Face',
      fontSizeHalfPoints: null,
    });
  }
  const styleRoot = styles(
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Default Face"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:styleId="Base"><w:rPr><w:rFonts w:hAnsi="Style Face"/></w:rPr></w:style><w:style w:styleId="Child"><w:basedOn w:val="Base"/><w:rPr><w:rFonts w:eastAsia="CJK"/></w:rPr></w:style>'
  );
  const resolve = createRunDefaultsResolver(styleRoot, theme);
  expect(resolve(null).fontFamily).toBe('Default Face');
  expect(resolve('Child').fontFamily).toBe('Style Face');
  expect(
    resolve('Child', [{ localName: 'rFonts', attributes: { asciiTheme: 'majorHAnsi' } }]).fontFamily
  ).toBe('Heading Face');
});

test('rendered font discovery includes an implicit body default only when text exists', () => {
  const body = root(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Text</w:t></w:r></w:p></w:body></w:document>`,
    '/word/document.xml'
  );
  for (const styleRoot of [null, styles()]) {
    expect(collectRenderedFontFamilyCandidates([body], styleRoot, theme).inherited).toEqual([
      'Body Face',
    ]);
    expect(collectRenderedFontFamilyCandidates([], styleRoot, theme).inherited).toEqual([]);
  }
});

test.each([true, false])(
  'no-styles export preserves theme and configured fallback precedence (theme=%s)',
  async (withTheme) => {
    let requested: readonly string[] = [];
    let requestedDefault: string | undefined;
    const files = unzipSync(bytes(withTheme));
    if (!withTheme) delete files['word/theme/theme1.xml'];
    const opened = await openFontBackedDocumentForExport(zipSync(files), {
      fonts: defineFontResolver((request) => {
        requested = request.families;
        requestedDefault = request.defaultFamily;
        return { sources: [], defaultFont: { family: 'Host Fallback', sizeHalfPoints: 22 } };
      }),
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error('fixture rejected');
    try {
      expect(requestedDefault).toBe('Calibri');
      if (withTheme) expect(requested).toContain('Hiragino Mincho ProN');
      else expect(requested).not.toContain('Songti SC');
      const firstSpans = new Map<string, string | null>();
      forEachSemanticSpan(await opened.session.layout(), ({ span }) => {
        if (/^[A-G](?: |$)/.test(span.text)) firstSpans.set(span.text[0]!, span.style.fontFamily);
      });
      // A null family preserves the configured terminal fallback at measurement/paint.
      expect([...firstSpans.values()]).toEqual(
        withTheme
          ? [
              'Hiragino Mincho ProN',
              'Arial',
              'Hiragino Mincho ProN',
              'Hiragino Mincho ProN',
              'Hiragino Mincho ProN',
              'Hiragino Mincho ProN',
              'Hiragino Mincho ProN',
            ]
          : [null, 'Arial', null, null, null, null, null]
      );
    } finally {
      opened.session.dispose();
    }
  }
);
