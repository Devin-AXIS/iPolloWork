// Watermarks on landscape pages and in documents that mix orientations. Each header part takes
// the shape size of the first section that shows it, so a landscape section with its own
// header gets a shape fitted to its own text area, and both sizes survive save and reopen.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { blankDocumentBytes } from '../blank-document.ts';
import { watermarkShapeBox } from '../watermark-geometry.ts';
import { PNG_1X1 } from './image-decode-harness.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEADER_TYPE = `${R}/header`;
const HEADER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';

const PORTRAIT = '<w:pgSz w:w="12240" w:h="15840"/>';
const LANDSCAPE = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>';
const MARGINS =
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';

/**
 * A document from section page sizes. With `ownHeaders`, every section references its own
 * default header; without, only the first section has one and the rest inherit it.
 */
function documentWith(pageSizes: readonly string[], ownHeaders: boolean): Uint8Array {
  const files = unzipSync(blankDocumentBytes());
  const headerCount = ownHeaders ? pageSizes.length : 1;
  const sectPr = (index: number) =>
    `<w:sectPr>${index < headerCount ? `<w:headerReference w:type="default" r:id="rIdH${index}"/>` : ''}` +
    `${pageSizes[index]}${MARGINS}</w:sectPr>`;
  const body = pageSizes
    .map((_, index) =>
      index < pageSizes.length - 1
        ? `<w:p><w:pPr>${sectPr(index)}</w:pPr><w:r><w:t>Section ${index + 1}</w:t></w:r></w:p>`
        : `<w:p><w:r><w:t>Section ${index + 1}</w:t></w:r></w:p>${sectPr(index)}`
    )
    .join('');
  files['word/document.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
  );
  let rels = strFromU8(files['word/_rels/document.xml.rels']!);
  let types = strFromU8(files['[Content_Types].xml']!);
  for (let index = 0; index < headerCount; index++) {
    files[`word/header${index + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W}"><w:p/></w:hdr>`
    );
    rels = rels.replace(
      '</Relationships>',
      `<Relationship Id="rIdH${index}" Type="${HEADER_TYPE}" Target="header${index + 1}.xml"/></Relationships>`
    );
    types = types.replace(
      '</Types>',
      `<Override PartName="/word/header${index + 1}.xml" ContentType="${HEADER_CONTENT_TYPE}"/></Types>`
    );
  }
  files['word/_rels/document.xml.rels'] = strToU8(rels);
  files['[Content_Types].xml'] = strToU8(types);
  return zipSync(files);
}

function mount(document: Uint8Array): DocxEditorInstance {
  const container = window.document.createElement('div');
  const editor = createDocxEditor({ container, document });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

/** The watermark shape size written in each header part, in header part order. */
async function shapeSizes(editor: DocxEditorInstance): Promise<Array<[number, number]>> {
  const files = unzipSync(new Uint8Array(await editor.save()));
  return Object.keys(files)
    .filter((name) => /^word\/header\d+\.xml$/.test(name))
    .sort()
    .map((name) => {
      const xml = strFromU8(files[name]!);
      const style =
        /id="(?:PowerPlusWaterMarkObject|WordPictureWatermark)\d+"[^>]*style="([^"]*)"/.exec(
          xml
        )?.[1];
      const side = (key: string) => Number(new RegExp(`${key}:([\\d.]+)pt`).exec(style ?? '')?.[1]);
      return [side('width'), side('height')];
    });
}

// One-inch margins: a portrait Letter text area is 468 by 648 points, landscape 648 by 468.
const PORTRAIT_AREA = { width: 468, height: 648 };
const LANDSCAPE_AREA = { width: 648, height: 468 };

describe('watermark page orientation', () => {
  test('a landscape document fits the text watermark to its wider text area', async () => {
    const editor = mount(documentWith([LANDSCAPE], true));
    expect(editor.exec({ type: 'setWatermark', watermark: { text: 'DRAFT' } }).ok).toBe(true);
    const [[width, height]] = (await shapeSizes(editor)) as [[number, number]];
    // The measured advance differs from the estimate, so compare the horizontal layout's
    // exact width and the diagonal's sum of half-diagonals instead of both sides.
    // A turned box spans (width + height) / sqrt(2) both ways, so it fits the shorter side.
    expect(width + height).toBeCloseTo(LANDSCAPE_AREA.height * Math.SQRT2, 0);
    editor.exec({ type: 'setWatermark', watermark: { text: 'DRAFT', layout: 'horizontal' } });
    expect((await shapeSizes(editor))[0]![0]).toBeCloseTo(LANDSCAPE_AREA.width, 1);
  });

  test('each section with its own header gets a shape for its own orientation', async () => {
    const editor = mount(documentWith([PORTRAIT, LANDSCAPE, PORTRAIT], true));
    editor.exec({ type: 'setWatermark', watermark: { text: 'DRAFT', layout: 'horizontal' } });
    const sizes = await shapeSizes(editor);
    expect(sizes.map(([width]) => Math.round(width))).toEqual([468, 648, 468]);

    const picture = PNG_1X1;
    editor.exec({ type: 'setWatermark', watermark: { imageData: picture } });
    const expected = [PORTRAIT_AREA, LANDSCAPE_AREA, PORTRAIT_AREA].map((area) =>
      watermarkShapeBox({ imageData: picture }, area)!
    );
    const pictures = await shapeSizes(editor);
    pictures.forEach(([width, height], index) => {
      expect(width).toBeCloseTo(expected[index]!.width, 1);
      expect(height).toBeCloseTo(expected[index]!.height, 1);
    });
  });

  test('a fixed size and a picture scale do not depend on the orientation', async () => {
    const editor = mount(documentWith([PORTRAIT, LANDSCAPE], true));
    editor.exec({ type: 'setWatermark', watermark: { imageData: PNG_1X1, scale: 2 } });
    const sizes = await shapeSizes(editor);
    expect(sizes[0]).toEqual(sizes[1]!);
  });

  test('a section that inherits its header shares the shape of the section that owns it', async () => {
    const editor = mount(documentWith([PORTRAIT, LANDSCAPE], false));
    editor.exec({ type: 'setWatermark', watermark: { text: 'DRAFT', layout: 'horizontal' } });
    const sizes = await shapeSizes(editor);
    expect(sizes).toHaveLength(1);
    expect(Math.round(sizes[0]![0])).toBe(468);
  });

  test('per-section sizes survive save and reopen', async () => {
    const editor = mount(documentWith([PORTRAIT, LANDSCAPE], true));
    editor.exec({ type: 'setWatermark', watermark: { text: 'DRAFT', layout: 'horizontal' } });
    const reopened = mount(new Uint8Array(await editor.save()));
    expect(reopened.getWatermark()).toMatchObject({ text: 'DRAFT', layout: 'horizontal' });
    expect((await shapeSizes(reopened)).map(([width]) => Math.round(width))).toEqual([468, 648]);
  });
});
