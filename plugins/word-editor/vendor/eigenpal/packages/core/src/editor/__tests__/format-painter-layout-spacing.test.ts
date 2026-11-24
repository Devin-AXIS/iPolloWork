import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { linesOf, type TextMeasurer } from '../../layout/semantic-records.ts';
import { serializeOoxmlPart } from '../../store/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/package/2006/relationships';
const O = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const measurer: TextMeasurer = {
  measure: (text, style) =>
    [...text].length * style.fontSizePt + text.length * style.characterSpacingPt,
  lineMetrics: () => ({ height: 16, baseline: 12 }),
  inkBounds: (text, style) => {
    const bounds = text === '（' ? [0.662, 0.899] : text === '）' ? [0.135, 0.372] : [0.05, 0.95];
    return { left: bounds[0]! * style.fontSizePt, right: bounds[1]! * style.fontSizePt };
  },
};
interface PunctuationSource {
  kern?: number;
  eastAsianDefault?: boolean;
  noPunctuation?: boolean;
  split?: number;
}
function fixture(
  text: string,
  spacing = 0,
  compression = 'compressPunctuation',
  punctuation?: PunctuationSource
): Uint8Array {
  const run = (text: string) =>
    `<w:r><w:rPr><w:sz w:val="24"/>${spacing ? `<w:spacing w:val="${spacing * 20}"/>` : ''}${punctuation?.kern === undefined ? '' : `<w:kern w:val="${punctuation.kern}"/>`}</w:rPr><w:t>${text}</w:t></w:r>`;
  const sourceRuns =
    punctuation?.split === undefined
      ? run(text)
      : run(text.slice(0, punctuation.split)) + run(text.slice(punctuation.split));
  const styles = punctuation?.eastAsianDefault
    ? `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="Yu Mincho"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
    : null;
  return zipSync({
    ...(styles ? { 'word/styles.xml': strToU8(styles) } : {}),
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        (styles
          ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${R}"><Relationship Id="rId1" Type="${O}officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${R}"><Relationship Id="rId2" Type="${O}settings" Target="settings.xml"/>${styles ? `<Relationship Id="rId3" Type="${O}styles" Target="styles.xml"/>` : ''}</Relationships>`
    ),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="${compression}"/>${punctuation?.noPunctuation ? '<w:noPunctuationKerning/>' : ''}</w:settings>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        `<w:p><w:pPr><w:jc w:val="both"/><w:overflowPunct w:val="0"/></w:pPr>${sourceRuns}</w:p>` +
        `<w:p>${run('target')}</w:p><w:sectPr><w:pgSz w:w="2200" w:h="10000"/>` +
        '<w:pgMar w:top="200" w:bottom="200" w:left="200" w:right="200"/></w:sectPr></w:body></w:document>'
    ),
  });
}
function withSurface(bytes: Uint8Array, run: (surface: PaginatedSurface) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, { measurer });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}
function select(surface: PaginatedSurface, paragraph: number, start: number, end: number): void {
  const paragraphId = surface.session.paragraphIds()[paragraph]!;
  surface.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}
function targetSpacing(surface: PaginatedSurface): string | undefined {
  const id = surface.session.paragraphIds()[1]!;
  const body = surface.session
    .part()
    .root.children.find((node) => node.kind !== 'textValue' && node.localName === 'body');
  if (!body || body.kind === 'textValue') throw new Error('Missing body');
  const paragraph = body.children.find((node) => node.id === id);
  if (!paragraph || paragraph.kind === 'textValue') throw new Error('Missing target');
  const run = paragraph.children.find((node) => node.kind === 'run');
  if (!run || run.kind === 'textValue') throw new Error('Missing run');
  const properties = run.children.find((node) => node.kind === 'runProperties');
  if (!properties || properties.kind === 'textValue') return;
  const spacing = properties.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'spacing'
  );
  return spacing && spacing.kind !== 'textValue'
    ? spacing.attributes.find((attribute) => attribute.localName === 'val')?.value
    : undefined;
}
for (const { kind, text, spacing, compression, punctuation } of [
  {
    kind: 'optical fitting',
    punctuation: false,
    text: '甲乙（丙丁）戊己',
    spacing: 0,
    compression: 'compressPunctuation',
  },
  {
    kind: 'punctuation seam compression',
    punctuation: true,
    text: '甲（（乙））丙',
    spacing: 0,
    compression: 'compressPunctuation',
  },
  {
    kind: 'authored tracking and compression',
    punctuation: true,
    text: '甲（（乙））丙',
    spacing: 1,
    compression: 'compressPunctuation',
  },
  {
    kind: 'natural kana widths under spacing control',
    punctuation: false,
    text: 'あいうえおかきく',
    spacing: 0,
    compression: 'compressPunctuationAndJapaneseKana',
  },
])
  test(`Format Painter copies authored spacing after ${kind}, save, and reopen`, () => {
    withSurface(
      fixture(
        text,
        spacing,
        compression,
        // Optical fitting needs an East Asian face in the document defaults.
        punctuation ? { kern: 2, eastAsianDefault: true, split: 2 } : { eastAsianDefault: true }
      ),
      (surface) => {
        const naturalKana = compression === 'compressPunctuationAndJapaneseKana';
        const expectedLines = naturalKana ? [text.slice(0, 7), text.slice(7)] : [text];
        const sourceId = surface.session.paragraphIds()[0]!;
        const sourceLines = linesOf(surface.layout()).filter(
          (line) => line.range.paragraphId === sourceId
        );
        expect(sourceLines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual(
          expectedLines
        );
        const opening = sourceLines
          .flatMap((line) => line.spans)
          .find((span) => span.range.start <= 2 && span.range.end > 2)!;
        expect(opening.text.slice(2 - opening.range.start, 3 - opening.range.start)).toBe(text[2]!);
        if (naturalKana) {
          // Eight natural 12pt kana exceed the fixture's 90pt measure.
          expect(measurer.measure(text, opening.style)).toBe(96);
          expect(opening.style.characterSpacingPt).toBe(spacing);
        } else expect(opening.style.characterSpacingPt).toBeLessThan(spacing);
        const original = serializeOoxmlPart(surface.session.part());
        withSurface(surface.session.save(), (reopened) => {
          expect(serializeOoxmlPart(reopened.session.part())).toBe(original);
        });
        select(surface, 0, 2, 3);
        expect(surface.formatPainter.capture()).toBe(true);
        select(surface, 1, 0, 1);
        expect(surface.formatPainter.apply()).toBe('painted');
        expect(targetSpacing(surface)).toBe(String(spacing * 20));
        withSurface(surface.session.save(), (reopened) => {
          expect(targetSpacing(reopened)).toBe(String(spacing * 20));
          const source = linesOf(reopened.layout()).filter(
            (line) => line.range.paragraphId === reopened.session.paragraphIds()[0]
          );
          expect(source.map((line) => line.spans.map((span) => span.text).join(''))).toEqual(
            expectedLines
          );
          const reopenedSpacing = source
            .flatMap((line) => line.spans)
            .find((span) => span.range.start <= 2 && span.range.end > 2)!.style.characterSpacingPt;
          if (naturalKana) expect(reopenedSpacing).toBe(spacing);
          else expect(reopenedSpacing).toBeLessThan(spacing);
        });
      }
    );
  });

for (const { kind, source } of [
  { kind: 'missing run kerning', source: { eastAsianDefault: true } },
  { kind: 'disabled run kerning', source: { kern: 0, eastAsianDefault: true } },
  { kind: 'missing authored East Asian default', source: { kern: 2 } },
  { kind: 'kerning threshold above run size', source: { kern: 60, eastAsianDefault: true } },
  {
    kind: 'noPunctuationKerning',
    source: { kern: 2, eastAsianDefault: true, noPunctuation: true },
  },
]) {
  test(`Format Painter keeps authored spacing without punctuation source eligibility: ${kind}`, () => {
    const text = '甲（（乙））丙';
    withSurface(fixture(text, 0, 'compressPunctuation', source), (surface) => {
      const sourceId = surface.session.paragraphIds()[0]!;
      const sourceLines = linesOf(surface.layout()).filter(
        (line) => line.range.paragraphId === sourceId
      );
      expect(sourceLines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
        text,
      ]);
      const opening = sourceLines
        .flatMap((line) => line.spans)
        .find((span) => span.range.start <= 2 && span.range.end > 2)!;
      expect(opening.style.characterSpacingPt).toBe(0);
      const original = serializeOoxmlPart(surface.session.part());
      withSurface(surface.session.save(), (reopened) => {
        expect(serializeOoxmlPart(reopened.session.part())).toBe(original);
      });
      select(surface, 0, 2, 3);
      expect(surface.formatPainter.capture()).toBe(true);
      select(surface, 1, 0, 1);
      expect(surface.formatPainter.apply()).toBe('painted');
      expect(targetSpacing(surface)).toBe('0');
      withSurface(surface.session.save(), (reopened) => {
        expect(targetSpacing(reopened)).toBe('0');
        const spans = linesOf(reopened.layout())
          .filter((line) => line.range.paragraphId === reopened.session.paragraphIds()[0])
          .flatMap((line) => line.spans);
        expect(spans.map((span) => span.text).join('')).toBe(text);
        expect(
          spans.find((span) => span.range.start <= 2 && span.range.end > 2)!.style
            .characterSpacingPt
        ).toBe(0);
      });
    });
  });
}
