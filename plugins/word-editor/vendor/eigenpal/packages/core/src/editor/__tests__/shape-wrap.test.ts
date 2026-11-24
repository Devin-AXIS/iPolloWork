// Text wrap for text boxes, shapes, lines and groups: `setImageWrapType` changes the DrawingML
// frame, as it does for a picture, and the `image.wrap` slot enables for them. A legacy VML shape
// and a shape selected inside a group refuse.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import type { DocxEditorInstance } from '../docx-editor.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../../layout/drawing-layout.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import {
  EMU,
  GROUP,
  LINE,
  MC,
  SHAPE_URI,
  SOLID,
  anchor,
  mount,
  p,
  saved,
  text,
  wsp,
} from './shape-selection-fixture.ts';

const VML = 'urn:schemas-microsoft-com:vml';

const textbox = (id: number, name: string, y: number) =>
  anchor({
    id,
    name,
    x: 300 * EMU,
    y,
    cx: 144 * EMU,
    cy: 72 * EMU,
    graphic:
      `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>` +
      `<a:ext cx="${144 * EMU}" cy="${72 * EMU}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${SOLID('FFFF00')}</wps:spPr>` +
      `<wps:txbx><w:txbxContent><w:p><w:r><w:t>${name}</w:t></w:r></w:p></w:txbxContent>` +
      '</wps:txbx><wps:bodyPr/></wps:wsp>',
    uri: SHAPE_URI,
  });

const TEXTBOX = textbox(15, 'Note', 250 * EMU);

/** A text box as Word writes it: the DrawingML copy in `mc:Choice`, a VML copy in `mc:Fallback`. */
const WP14 = 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing';
const WORD_TEXTBOX = textbox(16, 'Word note', 450 * EMU)
  // Word writes a relative size after the graphic on almost every text box; `wp:inline` takes none.
  .replace(
    '</a:graphic></wp:anchor>',
    `</a:graphic><wp14:sizeRelH xmlns:wp14="${WP14}" relativeFrom="margin"><wp14:pctWidth>0` +
      `</wp14:pctWidth></wp14:sizeRelH><wp14:sizeRelV xmlns:wp14="${WP14}" relativeFrom="margin">` +
      '<wp14:pctHeight>0</wp14:pctHeight></wp14:sizeRelV></wp:anchor>'
  )
  .replace(
    '<w:r><w:drawing>',
    `<w:r><mc:AlternateContent xmlns:mc="${MC}"><mc:Choice Requires="wps"><w:drawing>`
  )
  .replace(
    '</w:drawing></w:r>',
    `</w:drawing></mc:Choice><mc:Fallback><w:pict><v:rect xmlns:v="${VML}" ` +
      'style="position:absolute;width:144pt;height:72pt" fillcolor="yellow"><v:textbox>' +
      '<w:txbxContent><w:p><w:r><w:t>Word note</w:t></w:r></w:p></w:txbxContent></v:textbox>' +
      '</v:rect></w:pict></mc:Fallback></mc:AlternateContent></w:r>'
  );

const SHAPE = anchor({
  id: 12,
  name: 'Oval',
  x: 300 * EMU,
  y: 120 * EMU,
  cx: 100 * EMU,
  cy: 50 * EMU,
  graphic: wsp(100 * EMU, 50 * EMU, 'ellipse', SOLID('00B050')),
  uri: SHAPE_URI,
});

const LEGACY =
  `<w:r><w:pict><v:rect xmlns:v="${VML}" id="Box" ` +
  'style="position:absolute;margin-left:72pt;margin-top:520pt;width:144pt;height:72pt;' +
  'z-index:2" fillcolor="#d9e2f3" strokecolor="#1f3864" strokeweight="1pt"/></w:pict></w:r>';

const FILLERS = Array.from({ length: 30 }, (_, i) => p(text(`Filler ${i}`))).join('');

function drawings(editor: DocxEditorInstance): (InlineDrawingRecord | AnchoredDrawingRecord)[] {
  return editor
    .surface!.layout()
    .pages.flatMap((page) => [
      ...(page.anchoredDrawings ?? []),
      ...page.fragments.flatMap((block) =>
        block.kind === 'paragraph' ? block.lines.flatMap((line) => line.drawings ?? []) : []
      ),
    ]);
}

function select(editor: DocxEditorInstance, record: InlineDrawingRecord | AnchoredDrawingRecord) {
  expect(editor.surface!.selectDrawing(record.drawingNodeId, record.paragraphId)).toBe(true);
}

/** The anchored drawing whose `wp:docPr/@name` is `name`, read from the saved XML. */
function anchorXml(xml: string, name: string): string {
  const at = xml.indexOf(`name="${name}"`);
  expect(at).toBeGreaterThan(-1);
  const start = Math.max(xml.lastIndexOf('<wp:anchor', at), xml.lastIndexOf('<wp:inline', at));
  return xml.slice(start, at);
}

test('a text box, shape, line and group each take behind and in front of text', async () => {
  const body = p(SHAPE + LINE + GROUP + TEXTBOX + WORD_TEXTBOX + text('Anchor')) + FILLERS;
  const { editor, container } = await mount(body);
  try {
    const all = drawings(editor).filter((record) => record.kind === 'anchoredDrawing');
    expect(all).toHaveLength(5);
    for (const record of all) {
      select(editor, record);
      expect(editor.getSelectedImage!()?.canChangeWrap).toBe(true);
      const state = toolbarCommandState(editor, 'image.wrap');
      expect(state.enabled).toBe(true);
      expect(state.value).toBe('inFront');
      expect(editor.can({ type: 'setImageWrapType', target: 'behind' })).toEqual({ ok: true });
      expect(editor.exec({ type: 'setImageWrapType', target: 'behind' })).toMatchObject({
        ok: true,
      });
      expect(editor.getSelectedImage!()?.wrap).toBe('behind');
    }
    // Each text box keeps its story: its paragraphs still lay out and paint.
    expectStories(editor, container);
    const behind = await saved(editor);
    for (const name of ['Oval', 'Rule', 'Group', 'Note', 'Word note']) {
      expect(anchorXml(behind, name)).toContain('behindDoc="1"');
      expect(anchorXml(behind, name)).toContain('<wp:wrapNone/>');
    }
    for (const record of drawings(editor).filter((r) => r.kind === 'anchoredDrawing')) {
      select(editor, record);
      expect(editor.exec({ type: 'setImageWrapType', target: 'inFront' })).toMatchObject({
        ok: true,
      });
      expect(editor.getSelectedImage!()?.wrap).toBe('inFront');
    }
    const front = await saved(editor);
    for (const name of ['Oval', 'Rule', 'Group', 'Note', 'Word note']) {
      expect(anchorXml(front, name)).toContain('behindDoc="0"');
    }
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('each kind goes inline and floats again, and the saved file reopens', async () => {
  const body = p(SHAPE + LINE + GROUP + TEXTBOX + WORD_TEXTBOX + text('Anchor')) + FILLERS;
  const { editor, container } = await mount(body);
  const names = ['Oval', 'Rule', 'Group', 'Note', 'Word note'];
  try {
    for (const name of names) {
      select(editor, drawingByName(editor, name));
      expect(editor.exec({ type: 'setImageWrapType', target: 'inline' })).toMatchObject({
        ok: true,
      });
      expect(editor.getSelectedImage!()?.kind).toBe('inline');
      expect(drawingByName(editor, name).kind).toBe('inlineDrawing');
    }
    expectStories(editor, container);
    const inline = await saved(editor);
    for (const name of names) expect(anchorXml(inline, name)).toStartWith('<wp:inline');
    expect(inline).not.toContain('sizeRel');
    const reopened = await reopen(editor);
    try {
      for (const name of names) {
        select(reopened.editor, drawingByName(reopened.editor, name));
        expect(reopened.editor.getSelectedImage!()?.wrap).toBe('inline');
        expect(reopened.editor.getSelectedImage!()?.canChangeWrap).toBe(true);
        expect(reopened.editor.exec({ type: 'setImageWrapType', target: 'square' })).toMatchObject({
          ok: true,
        });
        expect(drawingByName(reopened.editor, name).kind).toBe('anchoredDrawing');
      }
      const square = await saved(reopened.editor);
      for (const name of names) expect(anchorXml(square, name)).toContain('<wp:wrapSquare');
    } finally {
      reopened.editor.destroy();
      reopened.container.remove();
    }
  } finally {
    editor.destroy();
    container.remove();
  }
});

/** Both text boxes lay out their one paragraph and paint its text. */
function expectStories(editor: DocxEditorInstance, container: HTMLElement): void {
  const stories = drawings(editor).filter((record) => record.textboxStory);
  expect(stories).toHaveLength(2);
  for (const record of stories) expect(record.textboxStory!.fragments.length).toBeGreaterThan(0);
  expect(container.textContent).toContain('Word note');
  expect(container.textContent).toContain('Note');
}

/** The drawing whose `wp:docPr/@name` is `name`, found by selecting each in turn. */
function drawingByName(
  editor: DocxEditorInstance,
  name: string
): InlineDrawingRecord | AnchoredDrawingRecord {
  const found = drawings(editor).find((record) => {
    select(editor, record);
    return editor.getSelectedImage!()?.name === name;
  });
  if (!found) throw new Error(`no drawing named ${name}`);
  return found;
}

/** A second editor on the bytes `editor` saves. */
async function reopen(editor: DocxEditorInstance) {
  const container = document.createElement('div');
  document.body.append(container);
  const next = createDocxEditor({ container, document: new Uint8Array(await editor.save()) });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    next.surface?.layout();
  }
  return { editor: next, container };
}

test('square wrap moves body text beside a text box, and undo restores it', async () => {
  const body = p(TEXTBOX + text('Anchor')) + FILLERS;
  const { editor, container } = await mount(body);
  try {
    const before = await saved(editor);
    const [record] = drawings(editor);
    select(editor, record!);
    expect(editor.exec({ type: 'setImageWrapType', target: 'square' })).toMatchObject({ ok: true });
    expect(editor.getSelectedImage!()?.wrap).toBe('square');
    expect(anchorXml(await saved(editor), 'Note')).toContain('<wp:wrapSquare');
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    expect(await saved(editor)).toBe(before);
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('a legacy VML shape refuses a wrap change and keeps the slot disabled', async () => {
  const body = p(LEGACY + text('Anchor')) + FILLERS;
  const { editor, container } = await mount(body);
  try {
    const before = await saved(editor);
    const [record] = drawings(editor);
    select(editor, record!);
    expect(editor.getSelectedImage!()?.canChangeWrap).toBe(false);
    expect(toolbarCommandState(editor, 'image.wrap').enabled).toBe(false);
    expect(editor.exec({ type: 'setImageWrapType', target: 'behind' }).ok).toBe(false);
    expect(await saved(editor)).toBe(before);
  } finally {
    editor.destroy();
    container.remove();
  }
});
