// `w:numPicBullet` / `w:lvlPicBulletId`: an image marker, and every way it falls back to text.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import {
  pictureBulletFontScale,
  readNumberingPictureBullets,
  resolvePictureBullet,
  type NumberingPictureBullet,
} from '../numbering-picture-bullet.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const O = 'urn:schemas-microsoft-com:office:office';

const measurer = createFixedMeasurer(6, 14);

/** A `w:numPicBullet` whose VML shape is exactly what Word writes for an image bullet. */
function picBullet(id: string, style: string, imagedata = `<v:imagedata r:id="rId1"/>`): string {
  return (
    `<w:numPicBullet w:numPicBulletId="${id}"><w:pict>` +
    `<v:shape id="_x0000_i1030" type="#_x0000_t75" style="${style}" o:bullet="t">` +
    `${imagedata}</v:shape></w:pict></w:numPicBullet>`
  );
}

function numberingPart(inner: string): OoxmlPart {
  const part = readOoxmlPart(
    `<w:numbering xmlns:w="${W}" xmlns:v="${V}" xmlns:r="${R}" xmlns:o="${O}">${inner}</w:numbering>`,
    { name: '/word/numbering.xml', contentType: 'app/xml' }
  );
  if (!part.ok) throw new Error(part.reason);
  return part.part;
}

function listDefinition(levelExtras: string, markerHalfPoints = 24): string {
  return (
    `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">` +
    `<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>${levelExtras}` +
    `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>` +
    `<w:rPr><w:sz w:val="${markerHalfPoints}"/></w:rPr>` +
    `</w:lvl></w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>`
  );
}

function bodyPart(): OoxmlPart {
  const part = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:numPr>` +
      `<w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
      `<w:r><w:t>Item</w:t></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!part.ok) throw new Error(part.reason);
  return part.part;
}

/** A context that resolves every bullet to one fixed state, or to nothing. */
function drawingContext(resource: ImageResourceState | null): InlineDrawingLayoutContext {
  return {
    ownerPartName: '/word/document.xml',
    project: () => null,
    resourceOf: () => ({ kind: 'missing', relationshipId: 'rId0' }),
    pictureBulletResource: () =>
      resource ? { ownerPartName: '/word/numbering.xml', resource } : null,
  };
}

const PENDING: ImageResourceState = Object.freeze({
  kind: 'pending',
  resourceKey: 'picbullet:/word/numbering.xml:rId1',
});

function layoutOf(numbering: string, context?: InlineDrawingLayoutContext) {
  const numberingIndex = buildNumberingIndex(numberingPart(numbering).root);
  return layoutSemanticDocument(bodyPart(), 1, {
    measurer,
    numberingIndex,
    ...(context ? { inlineDrawingLayout: context } : {}),
  });
}

describe('numbering picture bullet projection', () => {
  test('reads the authored extent and the image relationship', () => {
    const bullets = readNumberingPictureBullets(
      numberingPart(picBullet('0', 'width:9pt;height:9pt')).root
    );
    expect(bullets.get('0')).toEqual({
      picBulletId: '0',
      relationshipId: 'rId1',
      width: 9,
      height: 9,
    });
  });

  test('converts non-point VML units', () => {
    const bullets = readNumberingPictureBullets(
      numberingPart(picBullet('0', 'width:12px;height:1in')).root
    );
    expect(bullets.get('0')?.width).toBeCloseTo(9, 6);
    expect(bullets.get('0')?.height).toBe(72);
  });

  test('drops a shape with no size, no image, or a zero extent', () => {
    for (const declaration of [
      picBullet('0', 'margin-left:0'),
      picBullet('0', 'width:9pt;height:9pt', '<v:imagedata o:title="no rel"/>'),
      picBullet('0', 'width:0pt;height:9pt'),
      '<w:numPicBullet w:numPicBulletId="0"/>',
    ]) {
      expect(readNumberingPictureBullets(numberingPart(declaration).root).size).toBe(0);
    }
  });

  test('a duplicate id keeps the first declaration', () => {
    const bullets = readNumberingPictureBullets(
      numberingPart(
        picBullet('0', 'width:9pt;height:9pt') + picBullet('0', 'width:40pt;height:40pt')
      ).root
    );
    expect(bullets.get('0')?.width).toBe(9);
  });
});

/**
 * The six captured controls behind `resolvePictureBullet`, each varying exactly one input.
 *
 * Pinned so a future change cannot silently re-guess the factor. The drawn column is the
 * exact rule; the reference's own painted value differs only by its 0.24pt paint grid, which
 * layout deliberately does not carry (15 -> 15.12, 33 -> 33.12, 7.5 -> 7.44).
 */
const CAPTURED_SIZES: readonly (readonly [number, number, number])[] = [
  [9, 12, 15],
  [18, 12, 30],
  [4.5, 12, 7.5],
  [9, 18, 24],
  [9, 24, 33],
  [18, 24, 66],
];

describe('picture bullet drawn size', () => {
  const authored = (extent: number): NumberingPictureBullet => ({
    picBulletId: '0',
    relationshipId: 'rId1',
    width: extent,
    height: extent,
  });

  test.each(CAPTURED_SIZES)(
    'authored %ppt at a %ppt marker draws at %ppt',
    (extent, fontSizePt, drawn) => {
      const resolved = resolvePictureBullet(authored(extent), fontSizePt);
      expect(resolved).not.toBeNull();
      expect(resolved!.width).toBeCloseTo(drawn, 9);
      expect(resolved!.height).toBeCloseTo(drawn, 9);
      expect(resolved!.authored.width).toBe(extent);
    }
  );

  test('the scale rises by exactly one for every six points of marker font', () => {
    expect(pictureBulletFontScale(12)).toBeCloseTo(5 / 3, 12);
    expect(pictureBulletFontScale(18)).toBeCloseTo(8 / 3, 12);
    expect(pictureBulletFontScale(24)).toBeCloseTo(11 / 3, 12);
    expect(pictureBulletFontScale(18) - pictureBulletFontScale(12)).toBeCloseTo(1, 12);
  });

  test('a non-positive or non-finite result is no picture at all', () => {
    for (const fontSizePt of [2, 1, 0, -12, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolvePictureBullet(authored(9), fontSizePt)).toBeNull();
    }
    // Past the authored-extent ceiling the projection already clamps to.
    expect(resolvePictureBullet(authored(1584), 1000)).toBeNull();
  });

  test('a non-square extent keeps its aspect ratio', () => {
    const resolved = resolvePictureBullet({ ...authored(9), width: 18 }, 12);
    expect(resolved!.width).toBeCloseTo(30, 9);
    expect(resolved!.height).toBeCloseTo(15, 9);
  });
});

describe('picture bullet markers in layout', () => {
  // Authored 24pt at a 12pt marker draws at 24 * (12 - 2) / 6 = 40pt.
  const declared =
    picBullet('0', 'width:24pt;height:24pt') + listDefinition('<w:lvlPicBulletId w:val="0"/>');
  const DRAWN = 40;
  /** The height this list item's line takes with an ordinary text marker. */
  const textLineHeight = paragraphFragmentsOf(
    layoutOf(listDefinition(''), drawingContext(PENDING)).pages[0]!
  )[0]!.lines[0]!.box.height;

  test('a lvlPicBulletId level publishes an image marker on the first line baseline', () => {
    const layout = layoutOf(declared, drawingContext(PENDING));
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    const picture = fragment.marker?.picture;
    expect(picture).toBeDefined();
    expect(picture!.ownerPartName).toBe('/word/numbering.xml');
    expect(picture!.relationshipId).toBe('rId1');
    expect(picture!.resource).toEqual(PENDING);
    expect(picture!.box.width).toBe(DRAWN);
    expect(picture!.box.height).toBe(DRAWN);
    // The image sits on the baseline, and the line grew to hold it.
    const line = fragment.lines[0]!;
    expect(line.baseline).toBeGreaterThanOrEqual(DRAWN);
    expect(picture!.box.y + picture!.box.height).toBeCloseTo(line.box.y + line.baseline, 6);
    expect(line.box.height).toBeGreaterThan(DRAWN);
  });

  test('the marker slot takes the image width, not the glyph width', () => {
    const layout = layoutOf(declared, drawingContext(PENDING));
    const marker = paragraphFragmentsOf(layout.pages[0]!)[0]!.marker!;
    expect(marker.box.width).toBe(DRAWN);
    // The level's text is still published so a sink that cannot draw the image has a marker.
    expect(marker.text).toBe('•');
  });

  test('the marker font size the level authors drives the drawn size', () => {
    // Authored 9pt at a level `w:sz` of 24 half-points (12pt): 9 * (12 - 2) / 6 = 15pt.
    const layout = layoutOf(
      picBullet('0', 'width:9pt;height:9pt') + listDefinition('<w:lvlPicBulletId w:val="0"/>', 24),
      drawingContext(PENDING)
    );
    expect(paragraphFragmentsOf(layout.pages[0]!)[0]!.marker!.picture!.box.height).toBeCloseTo(
      15,
      9
    );
    // The same bullet under a 24pt marker: 9 * (24 - 2) / 6 = 33pt.
    const bigger = layoutOf(
      picBullet('0', 'width:9pt;height:9pt') + listDefinition('<w:lvlPicBulletId w:val="0"/>', 48),
      drawingContext(PENDING)
    );
    expect(paragraphFragmentsOf(bigger.pages[0]!)[0]!.marker!.picture!.box.height).toBeCloseTo(
      33,
      9
    );
  });

  test('a marker font of two points or less falls back to the level text', () => {
    const layout = layoutOf(
      picBullet('0', 'width:9pt;height:9pt') + listDefinition('<w:lvlPicBulletId w:val="0"/>', 4),
      drawingContext(PENDING)
    );
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    expect(fragment.marker?.picture).toBeUndefined();
    expect(fragment.marker?.text).toBe('•');
  });

  test('a level without lvlPicBulletId is untouched', () => {
    const layout = layoutOf(
      picBullet('0', 'width:24pt;height:24pt') + listDefinition(''),
      drawingContext(PENDING)
    );
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    expect(fragment.marker?.picture).toBeUndefined();
    expect(fragment.marker?.text).toBe('•');
    expect(fragment.lines[0]!.box.height).toBe(textLineHeight);
  });

  test('a broken picture bullet falls back to the level text and the plain line height', () => {
    // Every arm resolves to no `w:numPicBullet` this projection can use.
    for (const numbering of [
      listDefinition('<w:lvlPicBulletId w:val="7"/>'),
      picBullet('0', 'width:9pt') + listDefinition('<w:lvlPicBulletId w:val="0"/>'),
      picBullet('0', 'width:9pt;height:9pt', '<v:imagedata/>') +
        listDefinition('<w:lvlPicBulletId w:val="0"/>'),
    ]) {
      const fragment = paragraphFragmentsOf(
        layoutOf(numbering, drawingContext(PENDING)).pages[0]!
      )[0]!;
      expect(fragment.marker?.picture).toBeUndefined();
      expect(fragment.marker?.text).toBe('•');
      expect(fragment.lines[0]!.box.height).toBe(textLineHeight);
    }
  });

  test('a host that resolves no image still reserves the marker box, never a picture', () => {
    const fragment = paragraphFragmentsOf(layoutOf(declared, drawingContext(null)).pages[0]!)[0]!;
    expect(fragment.marker?.picture).toBeUndefined();
    expect(fragment.marker?.text).toBe('•');
    // The extent comes from the file, so the line is tall with or without the bytes.
    expect(fragment.lines[0]!.baseline).toBeGreaterThanOrEqual(DRAWN);
  });

  test('a host with no drawing context at all keeps the text marker', () => {
    const fragment = paragraphFragmentsOf(layoutOf(declared).pages[0]!)[0]!;
    expect(fragment.marker?.picture).toBeUndefined();
    expect(fragment.marker?.text).toBe('•');
  });
});

describe('picture bullet geometry follows the marker when a block is moved', () => {
  // A bottom-aligned cell taller than its content moves the paragraph down inside it. The
  // marker box moved with the lines; the nested picture box did not, so the image painted at
  // the pre-shift origin while its own text sat lower. Both share the marker's space and move.
  test('a bottom-aligned tall cell moves the picture with its first line', () => {
    const declared =
      picBullet('0', 'width:24pt;height:24pt') + listDefinition('<w:lvlPicBulletId w:val="0"/>');
    const numberingIndex = buildNumberingIndex(numberingPart(declared).root);
    const part = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>` +
        `<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="4000" w:hRule="exact"/></w:trPr>` +
        `<w:tc><w:tcPr><w:vAlign w:val="bottom"/></w:tcPr><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
        `<w:r><w:t>Item</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!part.ok) throw new Error(part.reason);
    const layout = layoutSemanticDocument(part.part, 1, {
      measurer,
      numberingIndex,
      inlineDrawingLayout: drawingContext(PENDING),
    });
    const table = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
    if (!table || table.kind !== 'table') throw new Error('Expected a table');
    const block = table.rows[0]!.cells[0]!.blocks[0]!;
    if (block.kind !== 'paragraph') throw new Error('Expected a paragraph');
    const picture = block.marker?.picture;
    expect(picture).toBeDefined();
    const line = block.lines[0]!;
    // The cell is 200pt tall and the content much shorter, so bottom alignment moved it down.
    expect(line.box.y).toBeGreaterThan(50);
    // The record's invariant: the image sits with its bottom on the first line's baseline.
    expect(picture!.box.y + picture!.box.height).toBeCloseTo(line.box.y + line.baseline, 6);
    expect(picture!.box.x).toBeCloseTo(block.marker!.box.x, 6);
  });
});
