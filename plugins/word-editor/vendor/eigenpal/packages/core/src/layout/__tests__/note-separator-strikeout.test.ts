import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { layoutNoteSeparator, noteSeparatorAreaBox } from '../note-layout.ts';
import type { TextMeasurer } from '../semantic-records.ts';
import { sfntStrikeoutStrokeEm } from '../sfnt-strikeout-metrics.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const base: TextMeasurer = {
  measure: (text) => text.length * 5,
  lineMetrics: (style) => ({ height: style.fontSizePt, baseline: style.fontSizePt * 0.8 }),
};

/** A face's stroke, as em fractions read from `OS/2`. */
function withStroke(offsetEm: number, thicknessEm: number): TextMeasurer {
  return {
    ...base,
    strikeoutMetrics: (style) => ({
      offsetPt: style.fontSizePt * offsetEm,
      thicknessPt: style.fontSizePt * thicknessEm,
    }),
  };
}

function separatorPart(body: string) {
  const parsed = readOoxmlPart(
    `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1">${body}</w:footnote></w:footnotes>`,
    { name: '/word/footnotes.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

// `w:sz` is half-points: 40 is a 20 pt marker run.
const marker = '<w:p><w:r><w:rPr><w:sz w:val="40"/></w:rPr><w:separator/></w:r></w:p>';

test('the rule takes its thickness and offset from the face strikeout stroke', () => {
  // Calibri and Carlito both declare yStrikeoutSize 134 / yStrikeoutPosition 512 over 2048.
  const calibri = layoutNoteSeparator(
    separatorPart(marker),
    'separator',
    400,
    { measurer: withStroke(512 / 2048, 134 / 2048), producer: 'strikeout-test' },
    'footnote'
  );
  expect(calibri.ruleBox!.height).toBeCloseTo(20 * (134 / 2048), 6);
  expect(calibri.ruleBox!.y).toBeCloseTo(16 - 20 * 0.25, 6);

  // Aptos declares yStrikeoutPosition 731, which no quarter-of-the-size rule reaches.
  const aptos = layoutNoteSeparator(
    separatorPart(marker),
    'separator',
    400,
    { measurer: withStroke(731 / 2048, 102 / 2048), producer: 'strikeout-test' },
    'footnote'
  );
  expect(aptos.ruleBox!.height).toBeCloseTo(20 * (102 / 2048), 6);
  expect(aptos.ruleBox!.y).toBeCloseTo(16 - 20 * (731 / 2048), 6);
});

test('a measurer with no strikeout metrics keeps the legacy hairline', () => {
  const result = layoutNoteSeparator(
    separatorPart(marker),
    'separator',
    400,
    { measurer: base, producer: 'strikeout-test' },
    'footnote'
  );
  expect(result.ruleBox).toEqual({ x: 0, y: 11, width: 144, height: 0.5 });
});

test('a measured stroke thinner than the synthetic floor is not thickened', () => {
  const result = layoutNoteSeparator(
    separatorPart(marker),
    'separator',
    400,
    { measurer: withStroke(0.25, 0.01), producer: 'strikeout-test' },
    'footnote'
  );
  expect(noteSeparatorAreaBox(result, 72, 400, 500).height).toBeCloseTo(0.2, 6);
  // A synthetic rule still takes the floor, because nothing measured it.
  const synthetic = layoutNoteSeparator(
    null,
    'separator',
    400,
    { measurer: base, producer: 's' },
    'footnote'
  );
  expect(noteSeparatorAreaBox(synthetic, 72, 400, 500).height).toBe(0.5);
});

/** Minimal SFNT carrying just the two tables the stroke is read from. */
function sfnt(options: {
  readonly unitsPerEm: number;
  readonly thickness: number;
  readonly position: number;
  readonly omitOs2?: boolean;
}): Uint8Array {
  const records = options.omitOs2 ? 1 : 2;
  const directory = 12 + records * 16;
  const headOffset = directory;
  const os2Offset = headOffset + 54;
  const bytes = new Uint8Array(os2Offset + 96);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, records);
  view.setUint32(12, 0x68656164);
  view.setUint32(12 + 8, headOffset);
  view.setUint32(12 + 12, 54);
  view.setUint16(headOffset + 18, options.unitsPerEm);
  if (!options.omitOs2) {
    view.setUint32(28, 0x4f532f32);
    view.setUint32(28 + 8, os2Offset);
    view.setUint32(28 + 12, 96);
    view.setInt16(os2Offset + 26, options.thickness);
    view.setInt16(os2Offset + 28, options.position);
  }
  return bytes;
}

test('the SFNT reader returns em fractions and refuses faces it cannot trust', () => {
  expect(
    sfntStrikeoutStrokeEm(sfnt({ unitsPerEm: 2048, thickness: 134, position: 512 }), 0)
  ).toEqual({ offsetEm: 512 / 2048, thicknessEm: 134 / 2048 });
  // File-supplied int16 over a file-supplied em: a stroke taller than the em is refused
  // rather than clamped, so the caller keeps its own default.
  expect(
    sfntStrikeoutStrokeEm(sfnt({ unitsPerEm: 16, thickness: 32767, position: 0 }), 0)
  ).toBeNull();
  expect(
    sfntStrikeoutStrokeEm(sfnt({ unitsPerEm: 2048, thickness: 0, position: 512 }), 0)
  ).toBeNull();
  expect(
    sfntStrikeoutStrokeEm(sfnt({ unitsPerEm: 2048, thickness: 134, position: 30000 }), 0)
  ).toBeNull();
  expect(
    sfntStrikeoutStrokeEm(
      sfnt({ unitsPerEm: 2048, thickness: 134, position: 512, omitOs2: true }),
      0
    )
  ).toBeNull();
  expect(sfntStrikeoutStrokeEm(new Uint8Array(4), 0)).toBeNull();
});
