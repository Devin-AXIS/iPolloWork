import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '@docx-editor.dev/core/layout';
import { caretAt } from '../../layout/semantic-interaction.ts';
import { layoutHeaderFooterStory } from '../../layout/hf-layout.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import { recordWebkitStyleWrites } from './style-writes.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
function part(xml: string, name = '/word/document.xml') {
  const read = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}
const authoredStyles = part(
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="Yu Mincho"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
  '/word/styles.xml'
);
function documentPart(text: string, pPr = '<w:jc w:val="both"/>', kern?: number) {
  return part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:overflowPunct w:val="0"/>${pPr}</w:pPr><w:r><w:rPr><w:sz w:val="22"/>${kern === undefined ? '' : `<w:kern w:val="${kern}"/>`}</w:rPr><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  );
}
const geometry = { width: 50, height: 500, margin: { top: 10, bottom: 10, left: 10, right: 10 } };

test('CJK justification paints every gap and maps each caret to the same geometry', () => {
  const layout = layoutSemanticDocument(documentPart('天地玄黄月、日'), 0, { measurer, geometry });
  const first = layout.pages[0]!.fragments[0]!.lines[0]!;
  expect(first.spans.map((span) => span.text)).toEqual(['天', '地', '玄', '黄']);
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const painted = container.querySelectorAll<HTMLElement>('.docx-line:first-child [data-start]');
  expect(painted.length).toBe(4);
  // Each gap paints as letter spacing on the character before it, so decorations run on.
  expect([...painted].map((span) => span.style.marginLeft)).toEqual(['', '', '', '']);
  expect([...painted].map((span) => span.style.letterSpacing)).toEqual(['2px', '2px', '2px', '']);
  for (const span of first.spans) {
    const caret = caretAt(
      layout,
      { paragraphId: span.range.paragraphId, offset: span.range.start },
      measurer
    );
    expect(caret).not.toBeNull();
    expect(caret!.x).toBeCloseTo(span.box.x, 5);
  }
  const last = layout.pages[0]!.fragments[0]!.lines.at(-1)!;
  expect(last.spans.map((span) => span.text).join('')).toBe('月、日');
});

test('CJK compression uses the same spacing in layout and DOM paint', () => {
  const settings = part(
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`,
    '/word/settings.xml'
  );
  const styleCascade = buildStyleCascadeTable(authoredStyles.root, undefined, settings.root);
  const layout = layoutSemanticDocument(documentPart('天地。。', '', 2), 0, {
    measurer,
    geometry,
    styleCascade,
  });
  const line = layout.pages[0]!.fragments[0]!.lines[0]!;
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const punctuation = [...container.querySelectorAll<HTMLElement>('[data-start]')].filter(
    (element) => element.textContent === '。'
  );
  expect(punctuation).toHaveLength(2);
  expect(punctuation.map((element) => element.style.letterSpacing)).toEqual(['-3px', '']);
  expect(line.spans.at(-1)!.box.x + line.spans.at(-1)!.box.width - line.spans[0]!.box.x).toBe(21);
});

test('authored typography eligibility invalidates cached layout without a text edit', () => {
  const document = documentPart('天地玄黄。。人。', '', 2);
  const session = createLayoutSession();
  const settings = part(
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`
  );
  const initial = layoutSemanticDocument(document, 0, {
    measurer,
    geometry,
    session,
    styleCascade: buildStyleCascadeTable(null),
  });
  const updated = layoutSemanticDocument(document, 0, {
    measurer,
    geometry,
    session,
    styleCascade: buildStyleCascadeTable(authoredStyles.root, undefined, settings.root),
  });
  const clean = layoutSemanticDocument(document, 0, {
    measurer,
    geometry,
    styleCascade: buildStyleCascadeTable(authoredStyles.root, undefined, settings.root),
  });
  expect(updated.pages).toEqual(clean.pages);
  expect(JSON.stringify(updated.pages)).not.toBe(JSON.stringify(initial.pages));
});

test('headers and table cells consume the same document typography settings', () => {
  const settings = part(
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`
  );
  const styleCascade = buildStyleCascadeTable(authoredStyles.root, undefined, settings.root);
  const p =
    '<w:p><w:pPr><w:overflowPunct w:val="0"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/><w:kern w:val="2"/></w:rPr><w:t>天地。。</w:t></w:r></w:p>';
  const header = part(`<w:hdr xmlns:w="${W}">${p}</w:hdr>`, '/word/header1.xml');
  const story = layoutHeaderFooterStory(header, 21, measurer, 'cjk-test', undefined, styleCascade);
  const headerParagraph = story.fragments[0]!;
  expect(headerParagraph.kind).toBe('paragraph');
  if (headerParagraph.kind !== 'paragraph') throw new Error('expected header paragraph');
  expect(headerParagraph.lines).toHaveLength(1);
  expect(headerParagraph.lines[0]!.spans.map((span) => span.text).join('')).toBe('天地。。');
  const table = part(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="420" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="420"/></w:tblGrid><w:tr><w:tc>${p}</w:tc></w:tr></w:tbl></w:body></w:document>`
  );
  const layout = layoutSemanticDocument(table, 0, { measurer, geometry, styleCascade });
  const tableFragment = layout.pages[0]!.fragments[0]!;
  expect(tableFragment.kind).toBe('table');
  if (tableFragment.kind !== 'table') throw new Error('expected table');
  const cell = tableFragment.rows[0]!.cells[0]!.blocks[0]!;
  if (cell.kind !== 'paragraph') throw new Error('expected cell paragraph');
  expect(cell.lines).toHaveLength(1);
  expect(cell.lines[0]!.spans.map((span) => span.text).join('')).toBe('天地。。');
});

test('compressed opening punctuation translates only ink and retains layout caret boundaries', () => {
  const settings = part(
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`
  );
  const layout = layoutSemanticDocument(documentPart('（（甲）', '', 2), 0, {
    measurer,
    geometry,
    styleCascade: buildStyleCascadeTable(authoredStyles.root, undefined, settings.root),
  });
  const line = layout.pages[0]!.fragments[0]!.lines[0]!;
  const container = document.createElement('div');
  const styles = recordWebkitStyleWrites();
  try {
    paintSemanticLayout(container, layout, { scale: 2 });
  } finally {
    styles.stop();
  }
  // Only the shifted glyph hides its own ink; its shadow paints the glyph at the offset.
  expect(styles.writes).toEqual([['-webkit-text-fill-color', 'transparent']]);
  const openings = [...container.querySelectorAll<HTMLElement>('[data-start]')].filter(
    (element) => element.textContent === '（'
  );
  expect(openings).toHaveLength(2);
  expect(container.querySelectorAll('[data-docx-shifted-ink]')).toHaveLength(1);
  expect(openings.map((element) => element.style.width)).toEqual(['', '6px']);
  // happy-dom drops `-webkit-text-fill-color` from the attribute (capricorn86/happy-dom#2401);
  // the recorded write covers it. When that is fixed, put it back into this string.
  expect(openings.map((element) => element.firstElementChild?.getAttribute('style'))).toEqual([
    undefined,
    'forced-color-adjust: preserve-parent-color; --docx-glyph-ink-offset: -6px; text-shadow: -6px 0 currentColor;',
  ]);
  for (const span of line.spans) {
    expect(
      caretAt(layout, { paragraphId: span.range.paragraphId, offset: span.range.start }, measurer)!
        .x
    ).toBeCloseTo(span.box.x, 5);
  }
  expect(line.spans.slice(0, 2).map((span) => span.glyphOffsetPt)).toEqual([undefined, -3]);
});

test('scaled revision punctuation retains natural advances and native decoration', () => {
  const settings = part(
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`
  );
  for (const revision of ['ins', 'del']) {
    const textTag = revision === 'del' ? 'delText' : 't';
    const doc = part(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:${revision} w:id="1" w:author="QA"><w:r><w:rPr><w:sz w:val="22"/><w:w w:val="200"/></w:rPr><w:${textTag}>（甲）</w:${textTag}></w:r></w:${revision}></w:p></w:body></w:document>`
    );
    const layout = layoutSemanticDocument(doc, 0, {
      measurer,
      styleCascade: buildStyleCascadeTable(null, undefined, settings.root),
    });
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 2 });
    expect(container.querySelector('[data-docx-glyph-offset]')).toBeNull();
    const run = container.querySelector<HTMLElement>('.layout-run-text')!;
    expect(run.style.textDecorationLine).toBe(revision === 'del' ? 'line-through' : 'underline');
    expect(run.style.transform).toBe('scaleX(2)');
    expect(run.textContent).toBe('（甲）');
    expect(run.style.textShadow).toBe('');
    for (const displayMode of ['original', 'proposed'] as const) {
      const projected = layoutSemanticDocument(doc, 0, {
        measurer,
        displayMode,
        styleCascade: buildStyleCascadeTable(null, undefined, settings.root),
      });
      const projectedHost = document.createElement('div');
      paintSemanticLayout(projectedHost, projected, { scale: 2 });
      const visible = revision === 'ins' ? displayMode === 'proposed' : displayMode === 'original';
      expect(projectedHost.textContent).toBe(visible ? '（甲）' : '');
      expect(projectedHost.querySelector('[data-docx-glyph-offset]') === null).toBe(true);
    }

    for (const span of layout.pages[0]!.fragments[0]!.lines[0]!.spans) {
      expect(span.glyphOffsetPt).toBeUndefined();
      expect(span.style.characterSpacingPt).toBe(0);
    }
  }
});

for (const { kind, kern, eastAsia, noPunctuation } of [
  { kind: 'missing authored East Asian default', kern: 2, eastAsia: false, noPunctuation: false },
  { kind: 'disabled run kerning', kern: 0, eastAsia: true, noPunctuation: false },
  { kind: 'kerning threshold above run size', kern: 60, eastAsia: true, noPunctuation: false },
  { kind: 'noPunctuationKerning', kern: 2, eastAsia: true, noPunctuation: true },
]) {
  test(`ineligible punctuation retains authored spacing in layout and DOM paint: ${kind}`, () => {
    const doc = documentPart('天地。。', '', kern);
    const original = serializeOoxmlPart(doc);
    const settings = part(
      `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/>${noPunctuation ? '<w:noPunctuationKerning/>' : ''}</w:settings>`,
      '/word/settings.xml'
    );
    const layout = layoutSemanticDocument(doc, 0, {
      measurer,
      geometry,
      styleCascade: buildStyleCascadeTable(
        eastAsia ? authoredStyles.root : null,
        undefined,
        settings.root
      ),
    });
    const spans = layout.pages[0]!.fragments[0]!.lines[0]!.spans;
    expect(spans.map((span) => span.text).join('')).toBe('天地。。');
    expect(spans.every((span) => span.style.characterSpacingPt === 0)).toBe(true);
    expect(spans.every((span) => span.glyphOffsetPt === undefined)).toBe(true);
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    expect(container.textContent).toBe('天地。。');
    expect(container.querySelector('[data-docx-shifted-ink]')).toBeNull();
    expect(serializeOoxmlPart(doc)).toBe(original);
  });
}
