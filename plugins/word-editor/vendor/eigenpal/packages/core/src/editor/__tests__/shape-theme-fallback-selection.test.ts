// A shape with a theme fill and a VML fallback, as the reference application saves it, selects
// as a shape and takes the shape commands. Its paint needs the package's theme; without it the
// wrapper showed the read-only fallback, and nothing could be selected or edited.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import {
  EMU,
  SHAPE_URI,
  anchor,
  documentBytes,
  p,
  saved,
  text,
} from './shape-selection-fixture.ts';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const THEME =
  `<a:theme xmlns:a="${A}" name="Fixture"><a:themeElements><a:clrScheme name="Fixture">` +
  '<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
  '</a:clrScheme><a:fontScheme name="Fixture"><a:majorFont><a:latin typeface="Calibri Light"/>' +
  '<a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/>' +
  '<a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Fixture">' +
  '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
  '<a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/>' +
  '</a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';

const SHAPE =
  `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${200 * EMU}" ` +
  `cy="${100 * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
  '<a:solidFill><a:schemeClr val="accent1"><a:lumMod val="40000"/><a:lumOff val="60000"/>' +
  '</a:schemeClr></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>';
/** The drawing wrapped with a VML fallback, inside the same run. */
const WRAPPED = anchor({
  id: 7,
  name: 'Themed',
  x: 100 * EMU,
  y: 0,
  cx: 200 * EMU,
  cy: 100 * EMU,
  graphic: SHAPE,
  uri: SHAPE_URI,
})
  .replace('<w:drawing>', '<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>')
  .replace(
    '</w:drawing>',
    '</w:drawing></mc:Choice><mc:Fallback><w:pict><v:rect xmlns:v="urn:schemas-microsoft-com:vml" ' +
      'id="Themed" style="position:absolute;width:150pt;height:75pt" fillcolor="#b4c7e7" ' +
      'stroked="f"/></w:pict></mc:Fallback></mc:AlternateContent>'
  );

/** The fixture document with a theme part. */
function themedDocument(body: string): Uint8Array {
  const files = unzipSync(documentBytes(body));
  const types = new TextDecoder().decode(files['[Content_Types].xml']);
  files['[Content_Types].xml'] = strToU8(
    types.replace(
      '</Types>',
      '<Override PartName="/word/theme/theme1.xml" ' +
        'ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>'
    )
  );
  const rels = new TextDecoder().decode(files['word/_rels/document.xml.rels']);
  files['word/_rels/document.xml.rels'] = strToU8(
    rels.replace(
      '</Relationships>',
      '<Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/' +
        'relationships/theme" Target="theme/theme1.xml"/></Relationships>'
    )
  );
  files['word/theme/theme1.xml'] = strToU8(THEME);
  return zipSync(files);
}

test('a themed shape with a VML fallback selects, recolours and deletes as a shape', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: themedDocument(p(WRAPPED + text('Anchor words'))),
  });
  const onlyDrawing = () => {
    for (let attempt = 0; attempt < 5; attempt += 1) editor.surface!.layout();
    const drawings = editor.surface!.layout().pages.flatMap((page) => page.anchoredDrawings ?? []);
    expect(drawings).toHaveLength(1);
    return drawings[0]!;
  };
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      editor.surface?.layout();
    }
    const record = onlyDrawing();
    expect(editor.surface!.selectDrawing(record.drawingNodeId, record.paragraphId)).toBe(true);
    expect(editor.getSelectedImage!()).toMatchObject({ id: record.drawingNodeId });
    expect(editor.exec({ type: 'setShapeFill', color: 'FF0000' })).toMatchObject({ ok: true });
    const xml = await saved(editor);
    expect(xml).toContain('<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>');
    expect(xml).toContain('fillcolor="#ff0000"');
    const again = onlyDrawing();
    expect(editor.surface!.selectDrawing(again.drawingNodeId, again.paragraphId)).toBe(true);
    expect(editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true });
    expect(await saved(editor)).not.toContain('AlternateContent');
  } finally {
    editor.destroy();
    container.remove();
  }
});

/** An editor over the themed shape, opened and laid out, and its one drawing. */
async function open(document: Uint8Array) {
  const container = globalThis.document.createElement('div');
  globalThis.document.body.append(container);
  const editor = createDocxEditor({ container, document });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.surface?.layout();
  }
  const drawing = () => {
    const drawings = editor.surface!.layout().pages.flatMap((page) => page.anchoredDrawings ?? []);
    expect(drawings).toHaveLength(1);
    return drawings[0]!;
  };
  const select = () => {
    const record = drawing();
    expect(editor.surface!.selectDrawing(record.drawingNodeId, record.paragraphId)).toBe(true);
  };
  return {
    editor,
    select,
    close() {
      editor.destroy();
      container.remove();
    },
  };
}

/** The modern copy's horizontal offset and the VML copy, from the saved document. */
async function copies(editor: Awaited<ReturnType<typeof open>>['editor']) {
  const xml = await saved(editor);
  return {
    offset: /<wp:positionH[^>]*><wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(xml)?.[1],
    fallback: /<mc:Fallback>.*<\/mc:Fallback>/.exec(xml)?.[0] ?? null,
  };
}

test('a themed shape with a VML fallback moves, and undo and redo restore both copies', async () => {
  const { editor, select, close } = await open(themedDocument(p(WRAPPED + text('Anchor words'))));
  try {
    const before = await copies(editor);
    expect(before.offset).toBe(String(100 * EMU));
    expect(before.fallback).toContain('v:rect');
    select();
    expect(editor.exec({ type: 'setImagePosition', horizontalEmu: 150 * EMU })).toMatchObject({
      ok: true,
    });
    const moved = await copies(editor);
    expect(moved.offset).toBe(String(150 * EMU));
    expect(moved.fallback).toContain('v:rect');
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    expect(await copies(editor)).toEqual(before);
    expect(editor.exec({ type: 'redo' })).toMatchObject({ ok: true });
    expect(await copies(editor)).toEqual(moved);
  } finally {
    close();
  }
});

test('a theme colour that does not resolve still selects the shape', async () => {
  // No theme part, and a theme part without the colour the shape names.
  // A style fill the theme's style matrix does not hold.
  const bad = WRAPPED.replace(
    /<a:solidFill><a:schemeClr val="accent1">.*?<\/a:solidFill>/,
    ''
  ).replace(
    '<wps:bodyPr/>',
    '<wps:style><a:lnRef idx="0"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="3">' +
      '<a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/>' +
      '</a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></wps:style>' +
      '<wps:bodyPr/>'
  );
  for (const document of [
    documentBytes(p(WRAPPED + text('Anchor words'))),
    themedDocument(p(bad + text('Anchor words'))),
  ]) {
    const { editor, select, close } = await open(document);
    try {
      select();
      expect(editor.getSelectedImage!()).not.toBeNull();
      expect(editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true });
    } finally {
      close();
    }
  }
});
