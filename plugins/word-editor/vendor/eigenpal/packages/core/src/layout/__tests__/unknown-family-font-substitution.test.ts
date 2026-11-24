import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { openHeadlessDocument } from '../../store/headless-document-view.ts';
import { fontFamilyName } from '../../store/package/font-family-name.ts';
import { fontTableAlternates } from '../../store/package/font-table-alternates.ts';
import { serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { collectDocumentFonts } from '../../binding/document-catalog.ts';
import {
  documentFontSubstitutionPlan,
  applyDocumentFontSubstitutions,
} from '../document-font-substitution.ts';
import { composeFontConfiguration } from '../font-composition.ts';
import type { FontSource } from '../../contracts/editor.ts';
import { openFontBackedDocumentForExport } from '../../export/document-export-shaping.ts';
import { sha256FontBytes } from '../font-resource.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function documentBytes(
  primary = 'Georgia;Verdana',
  alternate = 'Courier New',
  location = 'fontTable.xml',
  defaults = ''
) {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="f" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="${location}"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="${primary}" w:hAnsi="${primary}" w:eastAsia="${primary}"/></w:rPr><w:t>PUBLIC A文</w:t></w:r></w:p></w:body></w:document>`
    ),
    [`word/${location}`]: strToU8(
      `<w:fonts xmlns:w="${W}"><w:font w:name="${primary}"><w:altName w:val="${alternate}"/></w:font></w:fonts>`
    ),
    ...(defaults
      ? {
          'word/styles.xml': strToU8(
            `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>${defaults}</w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
          ),
        }
      : {}),
  });
}

function view(primary = 'Georgia;Verdana', alternate = 'Courier New', location = 'fontTable.xml') {
  const opened = openHeadlessDocument(documentBytes(primary, alternate, location));
  if (!opened.ok) throw new Error(opened.reason);
  return opened.view;
}

function source(family: string, weight = 400, style: 'normal' | 'italic' = 'normal'): FontSource {
  return {
    request: { family, weight, style },
    id: family,
    bytes: new Uint8Array([1]),
    hash: '0'.repeat(64),
    faceIndex: 0,
  };
}

test('punctuation remains part of one safe font name', () => {
  for (const value of ['Georgia;Verdana', 'Georgia,Verdana', '宋体;SimSun'])
    expect(fontFamilyName(value)).toBe(value);
  for (const value of ['', ' ', 'A";color:red', 'A\\B', 'A\nB', 'A'.repeat(65)])
    expect(fontFamilyName(value)).toBeNull();
});

test('canonical package aliases preserve complete primary and alternate names', () => {
  const document = view('Georgia;Verdana', 'Courier New', 'tables/fonts.xml');
  const before = serializeOoxmlPart(document.part());
  expect(fontTableAlternates(document.currentPackage()).get('georgia;verdana')).toBe('Courier New');
  expect(collectDocumentFonts([document.part().root])).toEqual(['Georgia;Verdana']);
  expect(documentFontSubstitutionPlan(document, ['Georgia;Verdana']).families).toEqual([
    'Georgia;Verdana',
    'Courier New',
    'DengXian',
  ]);
  expect(serializeOoxmlPart(document.part())).toBe(before);
});

test('alternate names longer than 31 characters are ignored', () => {
  const limit = 'A'.repeat(31);
  expect(
    fontTableAlternates(view('Unknown Face', limit).currentPackage()).get('unknown face')
  ).toBe(limit);
  const long = 'A'.repeat(32);
  expect(fontTableAlternates(view('Unknown Face', long).currentPackage()).has('unknown face')).toBe(
    false
  );
  const plan = documentFontSubstitutionPlan(view('Unknown Face', long), ['Unknown Face']);
  expect(plan.families).not.toContain(long);
});

test('known primary faces win over whole alternate names', () => {
  const plan = documentFontSubstitutionPlan(view(), ['Georgia;Verdana']);
  const fonts = composeFontConfiguration({
    sources: [source('Georgia;Verdana'), source('Courier New')],
  });
  expect(applyDocumentFontSubstitutions(fonts, plan).substitutions).toBeUndefined();
});

test('unused script defaults do not spend the resolver request bound', () => {
  const archive = unzipSync(documentBytes('Unknown Latin', 'Unknown Alternate'));
  archive['word/document.xml'] = strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Unknown Latin"/></w:rPr><w:t>PUBLIC</w:t></w:r></w:p></w:body></w:document>`
  );
  const opened = openHeadlessDocument(zipSync(archive));
  if (!opened.ok) throw new Error(opened.reason);
  expect(documentFontSubstitutionPlan(opened.view, ['Unknown Latin']).families).toEqual([
    'Unknown Latin',
    'Unknown Alternate',
  ]);
});

test('unknown primary uses the whole alternate, never a listed primary candidate', () => {
  const plan = documentFontSubstitutionPlan(view(), ['Georgia;Verdana']);
  const fonts = composeFontConfiguration({
    sources: [source('Georgia'), source('Verdana'), source('Courier New')],
  });
  expect(applyDocumentFontSubstitutions(fonts, plan).substitutions).toEqual([
    {
      from: { family: 'Georgia;Verdana', weight: 400, style: 'normal' },
      to: { family: 'Courier New', weight: 400, style: 'normal' },
    },
  ]);
});

test('comma and semicolon alternate names are also whole names', () => {
  for (const alternate of ['Georgia,Verdana', 'Georgia;Verdana']) {
    const plan = documentFontSubstitutionPlan(view('Unknown Face', alternate), ['Unknown Face']);
    const fonts = composeFontConfiguration({ sources: [source('Georgia'), source('Verdana')] });
    expect(applyDocumentFontSubstitutions(fonts, plan).substitutions).toBeUndefined();
  }
});

test('whole alternate wins before an explicit generic stand-in', () => {
  const plan = documentFontSubstitutionPlan(view(), ['Georgia;Verdana']);
  const fonts = composeFontConfiguration({
    sources: [source('Courier New'), source('Calibri')],
    substitutions: [
      {
        from: { family: 'Georgia;Verdana', weight: 400, style: 'normal' },
        to: { family: 'Calibri', weight: 400, style: 'normal' },
      },
    ],
  });
  expect(applyDocumentFontSubstitutions(fonts, plan).substitutions?.[0]?.to.family).toBe(
    'Courier New'
  );
});

test('face variants do not claim bytes that the host never supplied', () => {
  const plan = documentFontSubstitutionPlan(view(), ['Georgia;Verdana']);
  const fonts = composeFontConfiguration({ sources: [source('Courier New', 700, 'italic')] });
  const result = applyDocumentFontSubstitutions(fonts, plan).substitutions!;
  expect(result).toHaveLength(1);
  expect(result[0]?.from).toEqual({ family: 'Georgia;Verdana', weight: 700, style: 'italic' });
});

test('unavailable whole alternate can use an explicitly chosen script default', () => {
  const plan = documentFontSubstitutionPlan(
    view('Meiryo;SimSun', 'Unknown Alternate'),
    ['Meiryo;SimSun'],
    ['SimSun']
  );
  const fonts = composeFontConfiguration({ sources: [source('SimSun')] });
  const result = applyDocumentFontSubstitutions(
    fonts,
    plan,
    new Map([['meiryo;simsun', 'SimSun']])
  );
  expect(result.substitutions?.[0]?.from.family).toBe('Meiryo;SimSun');
  expect(result.substitutions?.[0]?.to.family).toBe('SimSun');
});

test('font-backed export evidence and geometry use the admitted whole alternate', async () => {
  const bytes = new Uint8Array(
    readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  );
  const physical = {
    request: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
    id: 'public-font-fixture',
    bytes,
    hash: sha256FontBytes(bytes),
    faceIndex: 0,
  };
  const requested: (readonly string[])[] = [];
  const document = documentBytes('Georgia;Verdana', 'DejaVu Sans');
  const opened = await openFontBackedDocumentForExport(document, {
    fonts: (request) => {
      requested.push(request.families);
      return { sources: [physical] };
    },
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    expect(requested[0]).toContain('Georgia;Verdana');
    expect(requested[0]).toContain('DejaVu Sans');
    expect(requested[0]).not.toContain('Georgia');
    expect(requested[0]).not.toContain('Verdana');
    const face = opened.session.admittedFontFace({
      family: 'Georgia;Verdana',
      weight: 400,
      style: 'normal',
    });
    expect(face?.id).toBe(physical.id);
    expect(face?.hash).toBe(physical.hash);
    expect(face?.substitution?.resolved.family).toBe('DejaVu Sans');
    expect(
      opened.session.fontResolution.families.find((family) => family.family === 'Georgia;Verdana')
        ?.faces[0]?.sourceFamily
    ).toBe('DejaVu Sans');
    const layout = await opened.session.layout();
    expect(layout.pages.length).toBeGreaterThan(0);
  } finally {
    opened.session.dispose();
  }
});

test('script defaults stay distinct when one unknown name occupies different slots', () => {
  const opened = openHeadlessDocument(
    documentBytes(
      'Unknown Shared',
      '',
      'fontTable.xml',
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun"/><w:lang w:eastAsia="zh-CN"/>'
    )
  );
  if (!opened.ok) throw new Error(opened.reason);
  const plan = documentFontSubstitutionPlan(opened.view, ['Unknown Shared']);
  expect(plan.families).toContain('Times New Roman');
  expect(plan.families).toContain('SimSun');
  expect(plan.ambiguousFamilies).toContain('unknown shared');
  expect(plan.fallbacks.has('unknown shared')).toBe(false);
  const fonts = composeFontConfiguration({
    sources: [source('Times New Roman'), source('SimSun')],
  });
  expect(applyDocumentFontSubstitutions(fonts, plan).substitutions).toBeUndefined();
});

test('new aliases cannot exceed the snapshot substitution budget', () => {
  const plan = documentFontSubstitutionPlan(view(), ['Georgia;Verdana']);
  const host = Array.from({ length: 256 }, (_, index) => ({
    from: { family: 'HOST-' + index, weight: 400, style: 'normal' as const },
    to: { family: 'Courier New', weight: 400, style: 'normal' as const },
  }));
  const fonts = composeFontConfiguration({ sources: [source('Courier New')], substitutions: host });
  const applied = applyDocumentFontSubstitutions(fonts, plan);
  expect(applied.substitutions).toHaveLength(256);
  expect(applied.substitutions).toEqual(host);
});

test('an isolated East Asian unknown uses the document script default, never a Latin face', () => {
  const parts = unzipSync(
    documentBytes(
      'Meiryo;SimSun',
      '',
      'fontTable.xml',
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun"/><w:lang w:eastAsia="zh-CN"/>'
    )
  );
  parts['word/document.xml'] = strToU8(
    strFromU8(parts['word/document.xml']!).replace(
      'w:ascii="Meiryo;SimSun" w:hAnsi="Meiryo;SimSun"',
      'w:ascii="Times New Roman" w:hAnsi="Times New Roman"'
    )
  );
  const opened = openHeadlessDocument(zipSync(parts));
  if (!opened.ok) throw new Error(opened.reason);
  const plan = documentFontSubstitutionPlan(opened.view, ['Meiryo;SimSun']);
  expect(plan.families).toContain('SimSun');
  expect(plan.fallbacks.get('meiryo;simsun')).toBe('SimSun');
  const fonts = composeFontConfiguration({
    sources: [source('Times New Roman'), source('SimSun')],
  });
  const result = applyDocumentFontSubstitutions(fonts, plan);
  expect(
    result.substitutions?.find((substitution) => substitution.from.family === 'Meiryo;SimSun')?.to
      .family
  ).toBe('SimSun');
});

test('a large document keeps the script default of a run after much body text', () => {
  const parts = unzipSync(
    documentBytes(
      'Meiryo;SimSun',
      '',
      'fontTable.xml',
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun"/><w:lang w:eastAsia="zh-CN"/>'
    )
  );
  // More than 200,000 nodes of plain body text precede the only run that names the font.
  const filler = '<w:p><w:r><w:t>PUBLIC</w:t></w:r></w:p>'.repeat(60_000);
  parts['word/document.xml'] = strToU8(
    strFromU8(parts['word/document.xml']!)
      .replace('<w:body>', `<w:body>${filler}`)
      .replace(
        'w:ascii="Meiryo;SimSun" w:hAnsi="Meiryo;SimSun"',
        'w:ascii="Times New Roman" w:hAnsi="Times New Roman"'
      )
  );
  const opened = openHeadlessDocument(zipSync(parts));
  if (!opened.ok) throw new Error(opened.reason);
  const plan = documentFontSubstitutionPlan(opened.view, ['Meiryo;SimSun']);
  expect(plan.fallbacks.get('meiryo;simsun')).toBe('SimSun');
  expect(plan.ambiguousFamilies).toEqual([]);
});

function slotDefaultPlan(runDefaults?: string, theme?: string, settings?: string) {
  const files = unzipSync(documentBytes('Unknown Primary', ''));
  files['word/document.xml'] = strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr>` +
      '<w:rFonts w:ascii="Unknown Latin" w:hAnsi="Unknown High" w:eastAsia="Unknown East" w:cs="Unknown Complex"/>' +
      '</w:rPr><w:t>PUBLIC é文</w:t></w:r></w:p></w:body></w:document>'
  );
  if (runDefaults !== undefined)
    files['word/styles.xml'] = strToU8(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>${runDefaults}</w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
    );
  if (theme) files['word/theme/theme1.xml'] = strToU8(theme);
  if (settings) files['word/settings.xml'] = strToU8(settings);
  const opened = openHeadlessDocument(zipSync(files));
  if (!opened.ok) throw new Error(opened.reason);
  return documentFontSubstitutionPlan(opened.view, [
    'Unknown Latin',
    'Unknown High',
    'Unknown East',
    'Unknown Complex',
  ]);
}

test('unknown slot defaults share layout format faces beneath an authored empty rPrDefault', () => {
  const plan = slotDefaultPlan('');
  expect(plan.fallbacks.get('unknown latin')).toBe('Times New Roman');
  expect(plan.fallbacks.get('unknown high')).toBe('Times New Roman');
  expect(plan.fallbacks.get('unknown east')).toBe('SimSun');
});

test('omitted defaults retain the application profile and built-in East Asian theme face', () => {
  const plan = slotDefaultPlan();
  expect(plan.fallbacks.get('unknown latin')).toBe('Calibri');
  expect(plan.fallbacks.get('unknown high')).toBe('Calibri');
  expect(plan.fallbacks.get('unknown east')).toBe('DengXian');
});

test('explicit document defaults keep ascii, hAnsi, East Asian, and complex faces independent', () => {
  const plan = slotDefaultPlan(
    '<w:rFonts w:ascii="Georgia" w:hAnsi="Verdana" w:eastAsia="SimHei" w:cs="Arial"/>'
  );
  expect(plan.fallbacks.get('unknown latin')).toBe('Georgia');
  expect(plan.fallbacks.get('unknown high')).toBe('Verdana');
  expect(plan.fallbacks.get('unknown east')).toBe('SimHei');
  expect(plan.fallbacks.get('unknown complex')).toBe('Arial');
});

test('document defaults resolve independent theme tokens and empty theme slots through main selection', () => {
  const theme =
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="PUBLIC">' +
    '<a:majorFont><a:latin typeface="Georgia"/><a:ea typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Courier New"/><a:ea typeface=""/></a:minorFont>' +
    '</a:fontScheme></a:themeElements></a:theme>';
  const plan = slotDefaultPlan(
    '<w:rFonts w:asciiTheme="minorAscii" w:hAnsiTheme="majorHAnsi" w:eastAsiaTheme="minorEastAsia"/>',
    theme,
    `<w:settings xmlns:w="${W}"><w:themeFontLang w:eastAsia="ja-JP"/></w:settings>`
  );
  expect(plan.fallbacks.get('unknown latin')).toBe('Courier New');
  expect(plan.fallbacks.get('unknown high')).toBe('Georgia');
  expect(plan.fallbacks.get('unknown east')).toBe('MS Mincho');
});
