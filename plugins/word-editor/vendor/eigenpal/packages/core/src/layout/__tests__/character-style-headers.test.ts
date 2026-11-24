import type { SemanticLayoutOptions } from '../semantic-layout-options.ts';
import { createPageContentInsets } from '../page-furniture-insets.ts';
import { registerCharacterHeaderPages } from '../character-header-pages.ts';
import { layoutWithCharacterHeaders } from '../character-header-layout.ts';
import {
  headerStoryForPage,
  characterHeaderReserveHeight,
  characterHeaderPageToken,
} from '../character-header-pages.ts';
import { expect, test } from 'bun:test';
import { applyTreeOp } from '@docx-editor.dev/core/store';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { layoutSemanticDocument, createLayoutSession } from '../semantic-layout.ts';
import { parseCharacterStyleField } from '../field-character-style.ts';
import { paragraphFragmentsOfBlocks } from '../semantic-record-queries.ts';
import { characterStyleIndex, characterStylePageValues } from '../character-style-index.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string, style = '') =>
  `<w:r>${style ? `<w:rPr><w:rStyle w:val="${style}"/></w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (text: string, style = '', page = false) =>
  `<w:p>${page ? '<w:pPr><w:pageBreakBefore/></w:pPr>' : ''}${run(text, style)}</w:p>`;
const field = (name: string, suffix = '') =>
  `<w:fldSimple w:instr=" STYLEREF &quot;${name}&quot; ${suffix}">${run('cached')}</w:fldSimple>`;
function part(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';
const styles = buildStyleCascadeTable(
  part(
    `<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}<w:style w:type="character" w:styleId="Base"><w:name w:val="Header Source"/></w:style><w:style w:type="character" w:styleId="Derived"><w:name w:val="Derived Source"/><w:basedOn w:val="Base"/></w:style></w:styles>`,
    '/word/styles.xml'
  ).root
);
const measurer = createFixedMeasurer(5, 10);
function fixture(
  body: string,
  header = field('Header Source'),
  displayMode: RevisionDisplayMode = 'all-markup'
) {
  const main = part(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    '/word/document.xml'
  );
  const hdr = part(`<w:hdr xmlns:w="${W}"><w:p>${header}</w:p></w:hdr>`, '/word/header1.xml');
  const story = layoutHeaderFooterStory(hdr, 100, measurer, 'test', undefined, styles);
  const options = {
    measurer,
    displayMode,
    styleCascade: styles,
    geometry: {
      width: 120,
      height: 140,
      margin: { top: 15, bottom: 15, left: 10, right: 10 },
      headerDistance: 5,
    },
    furniture: {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default' as const, story]]),
      footers: new Map(),
    },
  };
  const session = createLayoutSession();
  const before = serializeOoxmlPart(main);
  const laid = layoutSemanticDocument(main, 1, { ...options, session });
  const warm = layoutSemanticDocument(main, 1, { ...options, session });
  expect(text(warm)).toEqual(text(laid));
  for (let i = 0; i < laid.pages.length; i += 1) expect(warm.pages[i]).toBe(laid.pages[i]);
  expect(warm.pages.map((page) => page.contentBox)).toEqual(
    laid.pages.map((page) => page.contentBox)
  );
  expect(serializeOoxmlPart(main)).toBe(before);
  return { laid, main, options, session };
}
function text(layout: SemanticLayout): string[] {
  return layout.pages.map((page) =>
    paragraphFragmentsOfBlocks(page.header?.fragments ?? [])
      .flatMap((f) => f.lines.flatMap((l) => l.spans.map((s) => s.text)))
      .join('')
  );
}

test('first and last character occurrences use the current physical page', () => {
  const { laid } = fixture(
    p('Alpha', 'Base') + p('Omega', 'Base') + p('Next page', '', true),
    field('Header Source') + run('/') + field('Header Source', '\\l')
  );
  expect(text(laid)).toEqual(['Alpha/Omega', 'Omega/Omega']);
});
test('a derived character style does not match the base style field', () => {
  expect(text(fixture(p('Derived', 'Derived') + p('Exact', 'Base')).laid)).toEqual(['Exact']);
});
test('missing style preserves the cached field result', () => {
  expect(text(fixture(p('Plain')).laid)).toEqual(['cached']);
});
test('a page before the first styled occurrence uses the following occurrence', () => {
  expect(text(fixture(p('Plain') + p('Later', 'Base', true)).laid)).toEqual(['Later', 'Later']);
});
test('a page without an occurrence uses the last preceding occurrence', () => {
  expect(
    text(fixture(p('Earlier', 'Base') + p('Plain', '', true) + p('Later', 'Base', true)).laid)
  ).toEqual(['Earlier', 'Earlier', 'Later']);
});
test('unsupported switches preserve cached results', () => {
  expect(text(fixture(p('Live', 'Base'), field('Header Source', '\\n')).laid)).toEqual(['cached']);
  expect(parseCharacterStyleField(' STYLEREF Base \\p ')).toBeNull();
  expect(parseCharacterStyleField(' STYLEREF Base \\* Upper ')).toBeNull();
  expect(parseCharacterStyleField(' STYLEREF "unterminated ')).toBeNull();
  expect(parseCharacterStyleField(' STYLEREF ' + 'x'.repeat(5000))).toBeNull();
});
test('a longer header increases only the page-local body inset', () => {
  const { laid } = fixture(
    p('A long character title that fills several header lines', 'Base') + p('Short', 'Base', true)
  );
  expect(laid.pages[0]!.contentBox.y).toBeGreaterThan(
    laid.pages[1]!.contentBox.y - laid.pages[1]!.box.y
  );
  expect(text(laid)).toEqual(['A long character title that fills several header lines', 'Short']);
});
test('complex fields without cached results retain their one-unit source range', () => {
  const complex =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> STYLEREF &quot;Header Source&quot; </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const { laid } = fixture(p('Resolved', 'Base'), complex + run(' suffix'));
  expect(text(laid)).toEqual(['Resolved suffix']);
  const spans = paragraphFragmentsOfBlocks(laid.pages[0]!.header!.fragments)[0]!.lines[0]!.spans;
  expect(spans.find((s) => s.text === 'Resolved')?.range).toMatchObject({ start: 0, end: 1 });
});

for (const mode of ['proposed', 'original', 'all-markup'] as const) {
  test(`style lookup follows visible revisions (${mode})`, () => {
    const deleted =
      '<w:del w:id="1" w:author="A">' +
      run('Old', 'Base').replace('<w:t ', '<w:delText ').replace('</w:t>', '</w:delText>') +
      '</w:del>';
    const inserted = '<w:ins w:id="2" w:author="A">' + run('New', 'Base') + '</w:ins>';
    expect(
      text(fixture('<w:p>' + deleted + inserted + '</w:p>', field('Header Source'), mode).laid)
    ).toEqual([mode === 'proposed' ? 'New' : mode === 'original' ? 'Old' : 'OldNew']);
  });
}
test('hidden runs and field instruction text do not supply header text', () => {
  const hidden = '<w:r><w:rPr><w:rStyle w:val="Base"/><w:vanish/></w:rPr><w:t>Hidden</w:t></w:r>';
  const instruction =
    '<w:r><w:rPr><w:rStyle w:val="Base"/></w:rPr><w:instrText>Secret</w:instrText></w:r>';
  expect(
    text(fixture('<w:p>' + hidden + instruction + run('Visible', 'Base') + '</w:p>').laid)
  ).toEqual(['Visible']);
});
test('a body edit refreshes header values in the same layout session', () => {
  const f = fixture(p('Old', 'Base'));
  const changed = part(
    `<w:document xmlns:w="${W}"><w:body>${p('Changed', 'Base')}</w:body></w:document>`,
    '/word/document.xml'
  );
  const warm = layoutSemanticDocument(changed, 2, { ...f.options, session: f.session });
  const cold = layoutSemanticDocument(changed, 2, f.options);
  expect(text(warm)).toEqual(['Changed']);
  expect(text(warm)).toEqual(text(cold));
});
test('unsupported outer fields retain their nested PAGE result', () => {
  const unsupported =
    '<w:fldSimple w:instr=" STYLEREF &quot;Header Source&quot; \\n ">' +
    run('cached ') +
    '<w:fldSimple w:instr=" PAGE ">' +
    run('99') +
    '</w:fldSimple></w:fldSimple>';
  expect(text(fixture(p('Live', 'Base') + p('Next', '', true), unsupported).laid)).toEqual([
    'cached 1',
    'cached 2',
  ]);
});
test('an oversized contiguous styled occurrence never exposes a partial result', () => {
  const f = fixture(p('Short', 'Base'));
  const huge = part(
    `<w:document xmlns:w="${W}"><w:body><w:p>${run('a'.repeat(3000), 'Base')}${run('b'.repeat(3000), 'Base')}</w:p></w:body></w:document>`,
    '/word/document.xml'
  );
  const index = characterStyleIndex(huge, f.options)!;
  const values = characterStylePageValues(index, f.laid, [
    parseCharacterStyleField('STYLEREF "Header Source"')!,
    parseCharacterStyleField('STYLEREF "Header Source" \\l')!,
  ]);
  expect(values[0]!.size).toBe(0);
});
test('a body past the scan limit gives no index, so saved results stay', () => {
  const f = fixture(p('Short', 'Base'));
  let root = f.main.root;
  for (let n = 0; n < 66; n += 1) root = { ...root, children: [root] };
  expect(characterStyleIndex({ ...f.main, root }, f.options)).toBeUndefined();
});
test('section page restarts preserve logical PAGE and physical even-header selection', () => {
  const f = fixture(p('Seed', 'Base'));
  const pageField = '<w:fldSimple w:instr=" PAGE ">' + run('99') + '</w:fldSimple>';
  const header = (prefix: string) =>
    layoutHeaderFooterStory(
      part(
        `<w:hdr xmlns:w="${W}"><w:p>${run(prefix)}${field('Header Source')}${run('/')}${pageField}</w:p></w:hdr>`,
        '/word/header' + prefix + '.xml'
      ),
      100,
      measurer,
      'test',
      undefined,
      styles
    );
  const furniture = {
    ...f.options.furniture,
    evenAndOddHeaders: true,
    headers: new Map([
      ['default' as const, header('D')],
      ['even' as const, header('E')],
    ]),
  };
  const sect = (start: number) =>
    `<w:sectPr><w:pgSz w:w="2400" w:h="2800"/><w:pgMar w:top="300" w:bottom="300" w:left="200" w:right="200" w:header="100"/><w:pgNumType w:start="${start}"/></w:sectPr>`;
  const body =
    p('Alpha', 'Base') + '<w:p><w:pPr>' + sect(3) + '</w:pPr></w:p>' + p('Beta', 'Base') + sect(12);
  const main = part(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    '/word/document.xml'
  );
  const options = { ...f.options, sectionFurniture: [furniture, furniture] };
  const laid = layoutSemanticDocument(main, 1, options);
  expect(text(laid)).toEqual(['DAlpha/3', 'EBeta/12']);
  const session = createLayoutSession();
  const warm = layoutSemanticDocument(main, 1, { ...options, session });
  const repeated = layoutSemanticDocument(main, 1, { ...options, session });
  expect(text(repeated)).toEqual(text(laid));
  for (let i = 0; i < warm.pages.length; i += 1) expect(repeated.pages[i]).toBe(warm.pages[i]);
});
test('nested PAGE stays live inside an otherwise recognized character-style field', () => {
  const simple =
    '<w:fldSimple w:instr=" STYLEREF &quot;Header Source&quot; ">' +
    run('cached ') +
    '<w:fldSimple w:instr=" PAGE ">' +
    run('99') +
    '</w:fldSimple></w:fldSimple>';
  expect(text(fixture(p('Live', 'Base') + p('Next', '', true), simple).laid)).toEqual([
    'cached 1',
    'cached 2',
  ]);
  const complex =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> STYLEREF &quot;Header Source&quot; </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    run('cached ') +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    run('99') +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  expect(text(fixture(p('Live', 'Base') + p('Next', '', true), complex).laid)).toEqual([
    'cached 1',
    'cached 2',
  ]);
});
test('a shrinking live header retains its page reserve and settles', () => {
  const body =
    p('Prior', 'Base') +
    Array.from({ length: 7 }, () => p('filler')).join('') +
    '<w:p><w:pPr><w:keepLines/></w:pPr>' +
    run('A long styled title with enough words to fill three lines', 'Base') +
    '</w:p>';
  const { laid } = fixture(body, field('Header Source', '\\l'));
  expect(laid.pages).toHaveLength(2);
  expect(text(laid)[0]).toBe('Prior');
  expect(laid.pages[0]!.contentBox.y).toBeGreaterThan(
    laid.pages[0]!.header!.box.y + laid.pages[0]!.header!.box.height
  );
});

test('a style identifier does not replace its display name', () => {
  expect(text(fixture(p('Live', 'Base'), field('Base')).laid)).toEqual(['cached']);
});

for (const [start, format] of [
  [9999, 'decimal'],
  [888, 'upperRoman'],
] as const) {
  test(`logical PAGE ${start} ${format} reserves its final header height`, () => {
    const header =
      field('Header Source') +
      run(' ') +
      '<w:fldSimple w:instr=" PAGE ">' +
      run('1') +
      '</w:fldSimple>';
    const sect = `<w:sectPr><w:pgNumType w:start="${start}" w:fmt="${format}"/></w:sectPr>`;
    const { laid } = fixture(p('Alpha Beta GammaZZ', 'Base') + p('Body content') + sect, header);
    const page = laid.pages[0]!;
    expect(page.header!.box.height).toBeGreaterThan(10);
    expect(page.header!.box.y + page.header!.box.height).toBeLessThanOrEqual(
      page.contentBox.y + 0.001
    );
  });
}

test('the character query bound covers all header parts together', () => {
  const f = fixture(p('Plain'));
  const definitions = Array.from(
    { length: 129 },
    (_, i) => `<w:style w:type="character" w:styleId="S${i}"><w:name w:val="Style ${i}"/></w:style>`
  ).join('');
  const cascade = buildStyleCascadeTable(
    part(
      `<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}${definitions}</w:styles>`,
      '/word/styles.xml'
    ).root
  );
  const story = (start: number, count: number) =>
    layoutHeaderFooterStory(
      part(
        `<w:hdr xmlns:w="${W}"><w:p>${Array.from({ length: count }, (_, i) => field(`Style ${start + i}`)).join('')}</w:p></w:hdr>`,
        `/word/header${start}.xml`
      ),
      100,
      measurer,
      'test',
      undefined,
      cascade
    );
  const furniture = {
    ...f.options.furniture,
    headers: new Map([
      ['default' as const, story(0, 65)],
      ['even' as const, story(65, 64)],
    ]),
  };
  expect(() =>
    layoutSemanticDocument(f.main, 1, { ...f.options, styleCascade: cascade, furniture })
  ).toThrow('queries exceed their bound');
});

test('a visible merged paragraph retains the second paragraph style occurrence', () => {
  const body =
    '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>' +
    run('Prefix ') +
    '</w:p>' +
    p('Merged title', 'Base');
  expect(text(fixture(body, field('Header Source'), 'proposed').laid)).toEqual(['Merged title']);
});

test('a stale long saved result does not become a live header reserve', () => {
  const cached = field('Header Source').replace(
    'cached',
    'Saved text with enough words to fill many header lines'
  );
  const { laid } = fixture(p('Short', 'Base'), cached);
  expect(text(laid)).toEqual(['Short']);
  expect(laid.pages[0]!.contentBox.y).toBe(15);
});

test('furniture edits reset the live reserve history in a warm session', () => {
  const body =
    p('Prior', 'Base') +
    Array.from({ length: 7 }, () => p('filler')).join('') +
    '<w:p><w:pPr><w:keepLines/></w:pPr>' +
    run('A long styled title with enough words to fill three lines', 'Base') +
    '</w:p>';
  const initial = fixture(body, field('Header Source', '\\l'));
  const hdr = part(
    `<w:hdr xmlns:w="${W}"><w:p>${field('Header Source')}</w:p></w:hdr>`,
    '/word/header1.xml'
  );
  const story = layoutHeaderFooterStory(hdr, 100, measurer, 'test', undefined, styles);
  const options = {
    ...initial.options,
    furniture: { ...initial.options.furniture, headers: new Map([['default' as const, story]]) },
  };
  const warm = layoutSemanticDocument(initial.main, 2, { ...options, session: initial.session });
  const cold = layoutSemanticDocument(initial.main, 2, options);
  expect(warm.pages).toEqual(cold.pages);
  expect(warm.pages[0]!.contentBox.y).toBe(15);
  expect(warm.pages[0]!.contentBox.y).toBeLessThan(initial.laid.pages[0]!.contentBox.y);
});

test('page geometry edits reset live header reserves', () => {
  const body =
    p('Prior', 'Base') +
    Array.from({ length: 7 }, () => p('filler')).join('') +
    '<w:p><w:pPr><w:keepLines/></w:pPr>' +
    run('A long styled title with enough words to fill three lines', 'Base') +
    '</w:p>';
  const initial = fixture(body, field('Header Source', '\\l'));
  const options = { ...initial.options, geometry: { ...initial.options.geometry, height: 100 } };
  const warm = layoutSemanticDocument(initial.main, 2, { ...options, session: initial.session });
  const cold = layoutSemanticDocument(initial.main, 2, options);
  expect(warm.pages).toEqual(cold.pages);
  expect(warm.pages[0]!.contentBox.y).toBe(15);
});

/**
 * The first answer of a mocked run, with a header taller than the projected one. A first pass
 * whose header heights all hold settles without projected passes, so these tests start from a
 * height that moves to reach the projected passes they check.
 */
function tallerFirstHeader(layout: SemanticLayout): SemanticLayout {
  const [first, ...rest] = layout.pages;
  const header = first!.header!;
  return {
    ...layout,
    pages: [
      { ...first!, header: { ...header, box: { ...header.box, height: header.box.height + 10 } } },
      ...rest,
    ],
  };
}

for (const value of ['Alpha', 'Alpha Beta Gamma Delta Epsilon Zeta']) {
  test(`stable live header avoids a reserve-only repeat: ${value}`, () => {
    const f = fixture(p(value, 'Base'));
    const tall = tallerFirstHeader(f.laid);
    const session = createLayoutSession();
    const options = { ...f.options, session };
    let calls = 0;
    const tokens: string[] = [];
    const run = (input: SemanticLayoutOptions) => {
      calls += 1;
      tokens.push(characterHeaderPageToken(input.furniture!));
      headerStoryForPage(input.furniture, 'default', 0);
      characterHeaderReserveHeight(input.furniture, 0);
      return calls === 1 ? tall : f.laid;
    };
    layoutWithCharacterHeaders(f.main, options, run);
    expect(calls).toBe(2);
    const lastToken = tokens.at(-1);
    layoutWithCharacterHeaders(f.main, options, run);
    expect(calls).toBe(3);
    expect(tokens.at(-1)).toBe(lastToken);
  });
}

test('a projected header without an inset read does not reserve the shared page', () => {
  const f = fixture(p('Alpha Beta Gamma Delta Epsilon Zeta', 'Base'));
  const tall = tallerFirstHeader(f.laid);
  let calls = 0;
  layoutWithCharacterHeaders(f.main, f.options, (input) => {
    calls += 1;
    // A continued section shares the sheet. Simulate its late story resolution
    // after an earlier section already consumed that sheet's inset.
    characterHeaderReserveHeight(input.furniture, 0);
    headerStoryForPage(input.furniture, 'default', 0);
    return calls === 1 ? tall : f.laid;
  });
  expect(calls).toBe(2);
});

test('continuous sections share a page without losing warm header geometry', () => {
  const f = fixture(p('Alpha', 'Base'));
  const section = (continuous: boolean) =>
    `<w:sectPr>${continuous ? '<w:type w:val="continuous"/>' : ''}<w:pgSz w:w="2400" w:h="2800"/><w:pgMar w:top="300" w:bottom="300" w:left="200" w:right="200" w:header="100"/></w:sectPr>`;
  const main = part(
    `<w:document xmlns:w="${W}"><w:body>${p('Alpha', 'Base')}${p('Line').repeat(9)}<w:p><w:pPr>${section(false)}</w:pPr></w:p>${p('')}${section(true)}</w:body></w:document>`,
    '/word/document.xml'
  );
  const second = {
    ...f.options.furniture,
    headers: new Map([
      [
        'default' as const,
        layoutHeaderFooterStory(
          part(
            `<w:hdr xmlns:w="${W}"><w:p>${run('Second header with several words that occupies many separate lines ')}${field('Header Source')}</w:p></w:hdr>`,
            '/word/header2.xml'
          ),
          100,
          measurer,
          'test',
          undefined,
          styles
        ),
      ],
    ]),
  };
  const options = {
    ...f.options,
    sectionFurniture: [f.options.furniture, second],
    session: createLayoutSession(),
  };
  const cold = layoutSemanticDocument(main, 1, options);
  const warm = layoutSemanticDocument(main, 1, options);
  expect(cold.pages).toHaveLength(1);
  expect(warm.pages[0]).toEqual(cold.pages[0]);
  expect(text(warm)).toEqual(text(cold));
});

test('an exact negative margin never admits an ignored header reserve', () => {
  const f = fixture(p('Alpha', 'Base'));
  const furniture = { ...f.options.furniture };
  let reads = 0;
  registerCharacterHeaderPages(furniture, {
    token: 'negative-margin-control',
    reserveHeight: () => {
      reads += 1;
      return 50;
    },
    resolve: (variant) => furniture.headers.get(variant),
  });
  const inset = createPageContentInsets({
    furniture,
    pageHeight: 140,
    marginTop: -15,
    marginBottom: 15,
    headerDistance: 5,
    footerDistance: 5,
    pageIndexStart: 0,
  })(0);
  expect(inset.top).toBe(15);
  expect(reads).toBe(0);
});

test('an absent header never admits a reserve', () => {
  const furniture = {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map(),
    footers: new Map(),
  };
  let reads = 0;
  registerCharacterHeaderPages(furniture, {
    token: 'absent-header-control',
    reserveHeight: () => {
      reads += 1;
      return 50;
    },
    resolve: () => undefined,
  });
  expect(
    createPageContentInsets({
      furniture,
      pageHeight: 140,
      marginTop: 15,
      marginBottom: 15,
      headerDistance: 5,
      footerDistance: 5,
      pageIndexStart: 0,
    })(0).top
  ).toBe(15);
  expect(reads).toBe(0);
});

test('an ignored tall header does not enlarge a following shared-page inset', () => {
  const f = fixture(p('Alpha', 'Base'));
  const tall = {
    ...f.options.furniture,
    headers: new Map([
      [
        'default' as const,
        layoutHeaderFooterStory(
          part(
            `<w:hdr xmlns:w="${W}"><w:p>${run('A much longer header with enough words to wrap across several lines ')}${field('Header Source')}</w:p></w:hdr>`,
            '/word/tall-header.xml'
          ),
          100,
          measurer,
          'test',
          undefined,
          styles
        ),
      ],
    ]),
  };
  let positiveInset = 0;
  layoutWithCharacterHeaders(
    f.main,
    { ...f.options, sectionFurniture: [tall, f.options.furniture] },
    (input) => {
      const common = {
        pageHeight: 140,
        marginBottom: 15,
        headerDistance: 5,
        footerDistance: 5,
        pageIndexStart: 0,
      };
      createPageContentInsets({ ...common, marginTop: -15, furniture: input.sectionFurniture![0] })(
        0
      );
      positiveInset = createPageContentInsets({
        ...common,
        marginTop: 15,
        furniture: input.sectionFurniture![1],
      })(0).top;
      return f.laid;
    }
  );
  expect(positiveInset).toBe(15);
});

for (const mark of ['<w:vanish/>', '<w:vanish/><w:specVanish/>']) {
  test(`joined source members supply first and last character values ${mark}`, () => {
    const lead = (value: string, style = '') =>
      `<w:p><w:pPr><w:rPr>${mark}</w:rPr></w:pPr>${run(value, style)}</w:p>`;
    expect(text(fixture(lead('Prefix ') + p('Joined title', 'Base')).laid)).toEqual([
      'Joined title',
    ]);
    expect(
      text(
        fixture(
          lead('Alpha', 'Base') + p('Omega', 'Base'),
          field('Header Source') + run('/') + field('Header Source', '\\l')
        ).laid
      )
    ).toEqual(['Alpha/Omega']);
  });
}

test('a wrapped joined member supplies its complete occurrence on every occupied page', () => {
  const title = 'Title '.repeat(30).trim();
  const main = part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr>${run('Prefix ')}</w:p>${p(title, 'Base')}</w:body></w:document>`,
    '/word/document.xml'
  );
  const options = {
    measurer,
    styleCascade: styles,
    geometry: {
      width: 80,
      height: 60,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    },
  };
  const laid = layoutSemanticDocument(main, 1, options);
  expect(laid.pages.length).toBeGreaterThan(1);
  const query = parseCharacterStyleField('STYLEREF "Header Source"')!;
  const values = characterStylePageValues(characterStyleIndex(main, options)!, laid, [query]);
  expect(values.map((value) => value.get(query.key))).toEqual(laid.pages.map(() => title));
});

test('editing a joined later member refreshes its header in a retained session', () => {
  const f = fixture(
    '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr>' +
      run('Prefix ') +
      '</w:p>' +
      p('Title', 'Base')
  );
  const body = f.main.root.children.find((node) => node.kind === 'body')!;
  if (body.kind === 'textValue') throw Error('body');
  const member = body.children[1]!;
  const edit = applyTreeOp(f.main, {
    op: 'insertText',
    paragraphId: member.id,
    offset: 5,
    text: ' edited',
  });
  expect(edit.ok).toBe(true);
  if (!edit.ok) return;
  const warm = layoutSemanticDocument(edit.part, 2, { ...f.options, session: f.session });
  const cold = layoutSemanticDocument(edit.part, 2, f.options);
  expect(text(warm)).toEqual(['Title edited']);
  expect(warm.pages).toEqual(cold.pages);
});

test('joined RTL members keep canonical first and last occurrence order', () => {
  const lead =
    '<w:p><w:pPr><w:bidi/><w:rPr><w:vanish/></w:rPr></w:pPr>' + run('Alpha', 'Base') + '</w:p>';
  const tail = '<w:p><w:pPr><w:bidi/></w:pPr>' + run('Omega', 'Base') + '</w:p>';
  expect(
    text(
      fixture(lead + tail, field('Header Source') + run('/') + field('Header Source', '\\l')).laid
    )
  ).toEqual(['Alpha/Omega']);
});

for (const longFirst of [true, false]) {
  test(`parallel cell occurrences expire before fallback (${longFirst})`, () => {
    const long = 'Alpha '.repeat(20).trim();
    const titles = longFirst ? [long, 'Beta'] : ['Beta', long];
    const cells = titles
      .map(
        (title) =>
          '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1200"/></w:tcPr>' + p(title, 'Base') + '</w:tc>'
      )
      .join('');
    const table =
      '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="2400"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid><w:tr>' +
      cells +
      '</w:tr></w:tbl>';
    const main = part(
      `<w:document xmlns:w="${W}"><w:body>${table}${p('After', '', true)}</w:body></w:document>`,
      '/word/document.xml'
    );
    const options = {
      measurer,
      styleCascade: styles,
      geometry: { width: 120, height: 60, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    };
    const before = serializeOoxmlPart(main);
    const laid = layoutSemanticDocument(main, 1, options);
    expect(laid.pages.length).toBeGreaterThan(2);
    const first = parseCharacterStyleField('STYLEREF "Header Source"')!;
    const last = parseCharacterStyleField('STYLEREF "Header Source" \\l')!;
    const values = characterStylePageValues(characterStyleIndex(main, options)!, laid, [
      first,
      last,
    ]);
    expect(values[0]!.get(first.key)).toBe(titles[0]);
    expect(values[0]!.get(last.key)).toBe(titles[1]);
    for (const value of values.slice(1, -1)) {
      expect(value.get(first.key)).toBe(long);
      expect(value.get(last.key)).toBe(long);
    }
    expect(values.at(-1)!.get(first.key)).toBe(titles[1]);
    expect(values.at(-1)!.get(last.key)).toBe(titles[1]);
    expect(serializeOoxmlPart(main)).toBe(before);
  });
}
