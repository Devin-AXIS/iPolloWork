import { expect, test } from 'bun:test';
import { strToU8, zipSync, unzipSync } from 'fflate';
import { defineFontResolver } from '../../layout/font-resolver.ts';
import { openFontBackedDocumentForExport } from '../document-export-shaping.ts';
import { forEachSemanticSpan } from '../../layout/export-traversal.ts';
import { openDocumentForExport } from '../export-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

function themedBytes(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rDoc" Type="${OFFICE_REL}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rStyles" Type="${OFFICE_REL}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rTheme" Type="${OFFICE_REL}/theme" Target="theme/theme1.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>漢字</w:t></w:r></w:p></w:body></w:document>`
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
        '<w:rFonts w:eastAsiaTheme="minorEastAsia"/>' +
        '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>'
    ),
    'word/theme/theme1.xml': strToU8(
      `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme name="Parity">` +
        '<a:majorFont><a:latin typeface="Major Latin"/><a:ea typeface="MS Gothic"/></a:majorFont>' +
        '<a:minorFont><a:latin typeface="Minor Latin"/><a:ea typeface="SimSun"/></a:minorFont>' +
        '</a:fontScheme></a:themeElements></a:theme>'
    ),
  });
}

test('byte exports resolve the same East Asian theme face exposed by live layout', async () => {
  const opened = openDocumentForExport(themedBytes());
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;

  try {
    const layout = await opened.session.layout();
    const faces: Array<string | null> = [];
    forEachSemanticSpan(layout, ({ span }) => faces.push(span.style.fontFamilyEastAsia));
    expect(faces).toContain('SimSun');
  } finally {
    opened.session.dispose();
  }
});

test('invalid display modes never enter export-session caches', async () => {
  expect(() =>
    openDocumentForExport(new Uint8Array(), {
      displayMode: 'final' as never,
    })
  ).toThrow(RangeError);

  const opened = openDocumentForExport(themedBytes());
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    for (const invalid of ['final', 'all_markup', '']) {
      await expect(opened.session.layoutFor(invalid as never)).rejects.toThrow(RangeError);
    }
    expect((await opened.session.layoutFor('all-markup')).displayMode).toBe('all-markup');
  } finally {
    opened.session.dispose();
  }
});

test('empty theme faces select and request the inherited language face before export layout', async () => {
  const files = unzipSync(themedBytes());
  files['word/theme/theme1.xml'] = strToU8(
    `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme name="Empty">` +
      '<a:majorFont><a:latin typeface="Major Latin"/><a:ea typeface=""/><a:font script="Hans" typeface="Chinese Heading"/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="Minor Latin"/><a:ea typeface=""/><a:font script="Hans" typeface="Chinese Body"/><a:font script="Jpan" typeface="Japanese Body"/></a:minorFont>' +
      '</a:fontScheme></a:themeElements></a:theme>'
  );
  files['word/styles.xml'] = strToU8(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
      '<w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/>' +
      '</w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="character" w:styleId="Japanese"><w:rPr><w:lang w:eastAsia="ja-JP"/></w:rPr></w:style></w:styles>'
  );
  files['word/document.xml'] = strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>中文</w:t></w:r>` +
      '<w:r><w:rPr><w:rStyle w:val="Japanese"/></w:rPr><w:t>日本語</w:t></w:r></w:p></w:body></w:document>'
  );
  let requested: readonly string[] = [];
  const opened = await openFontBackedDocumentForExport(zipSync(files), {
    fonts: defineFontResolver((request) => {
      requested = request.families;
      return { sources: [], defaultFont: { family: 'Minor Latin', sizeHalfPoints: 22 } };
    }),
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    // Without a theme language the empty slot takes the Simplified Chinese supplemental face,
    // for the Japanese-language run too: the run language selects no theme face (probes
    // z01-z04 in local/evidence/hansi-font-slots).
    expect(requested).toContain('Chinese Body');
    expect(requested).not.toContain('Japanese Body');
    expect(requested).not.toContain('Chinese Heading');
    expect(requested).not.toContain('SimSun');
    const faces: Array<string | null> = [];
    forEachSemanticSpan(await opened.session.layout(), ({ span }) =>
      faces.push(span.style.fontFamilyEastAsia)
    );
    expect(new Set(faces)).toEqual(new Set(['Chinese Body']));
  } finally {
    opened.session.dispose();
  }
});

test('empty theme mixed Chinese and Latin wraps exactly like an explicit CJK face', async () => {
  const files = unzipSync(themedBytes());
  files['word/styles.xml'] = strToU8(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
      '<w:rFonts w:ascii="Latin Face" w:eastAsiaTheme="minorEastAsia"/><w:lang w:eastAsia="zh-CN"/>' +
      '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>'
  );
  files['word/document.xml'] = strToU8(
    `<w:document xmlns:w="${W}"><w:body>` +
      Array.from(
        { length: 40 },
        () => '<w:p><w:r><w:t>中文測試 ABC 中文測試 ABC 中文測試 ABC 中文測試 ABC</w:t></w:r></w:p>'
      ).join('') +
      '<w:sectPr><w:pgSz w:w="5940" w:h="16840"/><w:pgMar w:left="720" w:right="720" w:top="720" w:bottom="720"/></w:sectPr>' +
      '</w:body></w:document>'
  );
  const signature = async (face: string) => {
    files['word/theme/theme1.xml'] = strToU8(
      `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme name="Mixed"><a:minorFont><a:latin typeface="Latin Face"/><a:ea typeface="${face}"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`
    );
    const measuredCjk = new Set<string | null>();
    const opened = openDocumentForExport(zipSync(files), {
      measurer: {
        measure(text, style) {
          if (/[\u4e00-\u9fff]/u.test(text)) measuredCjk.add(style.fontFamily);
          return [...text].length * (style.fontFamily === 'SimSun' ? 11 : 5.5);
        },
        lineMetrics: () => ({ height: 14, baseline: 11 }),
      },
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error('fixture rejected');
    try {
      const spans: unknown[] = [];
      forEachSemanticSpan(await opened.session.layout(), ({ span }) =>
        spans.push([span.text, span.box])
      );
      expect([...measuredCjk]).toEqual(['SimSun']);
      return spans;
    } finally {
      opened.session.dispose();
    }
  };
  expect(await signature('')).toEqual(await signature('SimSun'));
});

test.each([
  ['w:val="ja-JP" w:eastAsia="zh-CN"', 'minorHAnsi', 'Hiragino Mincho ProN'],
  ['w:val="fr-FR" w:bidi="ar-SA"', 'majorBidi', 'Times New Roman'],
])('exports request and apply the language-selected %s theme', async (language, token, family) => {
  const files = unzipSync(themedBytes());
  files['word/_rels/document.xml.rels'] = strToU8(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="styles" Type="${OFFICE_REL}/styles" Target="styles.xml"/>` +
      `<Relationship Id="theme" Type="${OFFICE_REL}/theme" Target="theme/theme1.xml"/>` +
      `<Relationship Id="settings" Type="${OFFICE_REL}/settings" Target="settings.xml"/>` +
      '</Relationships>'
  );
  files['word/settings.xml'] = strToU8(
    `<w:settings xmlns:w="${W}"><w:themeFontLang ${language}/></w:settings>`
  );
  files['word/theme/theme1.xml'] = strToU8(
    `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme name="Languages">` +
      ['majorFont', 'minorFont']
        .map(
          (slot) =>
            `<a:${slot}><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface="Courier New"/>` +
            '<a:font script="Arab" typeface="Times New Roman"/><a:font script="Jpan" typeface="Hiragino Mincho ProN"/>' +
            `<a:font script="Hans" typeface="Songti SC"/></a:${slot}>`
        )
        .join('') +
      '</a:fontScheme></a:themeElements></a:theme>'
  );
  files['word/styles.xml'] = strToU8(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
      `<w:rFonts w:ascii="Calibri" w:asciiTheme="${token}" w:hAnsiTheme="${token}"/>` +
      '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>'
  );
  files['word/document.xml'] = strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Hamburgefonts 012345 日本語</w:t></w:r></w:p></w:body></w:document>`
  );
  let requested: readonly string[] = [];
  const opened = await openFontBackedDocumentForExport(zipSync(files), {
    fonts: defineFontResolver((request) => {
      requested = request.families;
      return { sources: [], defaultFont: { family: 'Calibri', sizeHalfPoints: 22 } };
    }),
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    expect(requested).toContain(family);
    const families = new Set<string | null>();
    forEachSemanticSpan(await opened.session.layout(), ({ span }) =>
      families.add(span.style.fontFamily)
    );
    expect([...families]).toEqual([family]);
    if (token === 'minorHAnsi') {
      // No level names an East Asian face, so CJK text takes the format default face, not
      // the theme's supplemental face (probes z09 and z11).
      expect(requested).toContain('SimSun');
      expect(requested).not.toContain('Songti SC');
      const eastAsianFamilies = new Set<string | null>();
      forEachSemanticSpan(await opened.session.layout(), ({ span }) => {
        if (span.fontSlot === 'eastAsia') eastAsianFamilies.add(span.style.fontFamilyEastAsia);
      });
      expect([...eastAsianFamilies]).toEqual(['SimSun']);
    }
  } finally {
    opened.session.dispose();
  }
});
