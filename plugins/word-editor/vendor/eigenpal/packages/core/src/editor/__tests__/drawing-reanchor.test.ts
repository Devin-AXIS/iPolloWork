import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { stubReviewModule } from './review-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const EMU = 12_700;

const LINE = 'The quick brown fox jumps over the lazy dog again and again. ';
const BODY = [1, 2, 3, 4, 5]
  .map((n) => `<w:p><w:r><w:t>Paragraph ${n}. ${LINE.repeat(3)}</w:t></w:r></w:p>`)
  .join('');

function documentBytes(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${BODY}</w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}"></Relationships>`),
  });
}

/** An editor with a square-wrapped chart anchored in the last paragraph. */
function mountFloatingChart(): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: documentBytes(),
    author: 'Reviewer',
    modules: [stubReviewModule()],
  });
  const surface = editor.surface!;
  const last = surface.session.paragraphIds().at(-1)!;
  surface.setSelection({
    anchor: { paragraphId: last, offset: 0 },
    head: { paragraphId: last, offset: 0 },
  });
  expect(editor.exec({ type: 'insertChart', chartType: 'columnClustered' }).ok).toBe(true);
  expect(editor.exec({ type: 'setImageWrapType', target: 'square' }).ok).toBe(true);
  return editor;
}

function chartRecord(editor: DocxEditorInstance) {
  for (const page of editor.surface!.layout().pages) {
    const record = page.anchoredDrawings?.[0];
    if (record) return record;
  }
  throw new Error('no floating chart');
}

function paragraphBox(editor: DocxEditorInstance, paragraphId: string) {
  const fragment = editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments)
    .find((f) => f.kind === 'paragraph' && f.paragraphId === paragraphId);
  if (!fragment) throw new Error(`no fragment for ${paragraphId}`);
  return fragment.box;
}

/** Moves the selected chart so its frame top lands `pt` below the top of `paragraphId`. */
function moveTopTo(editor: DocxEditorInstance, paragraphId: string, pt: number) {
  const record = chartRecord(editor);
  const top = paragraphBox(editor, paragraphId).y + pt;
  return editor.exec({
    type: 'setImagePosition',
    verticalEmu: Math.round((top - record.verticalFrameOrigin) * EMU),
  });
}

describe('moving a floating drawing', () => {
  test('a move up the page anchors the drawing in the paragraph under its new top', () => {
    const editor = mountFloatingChart();
    const ids = editor.surface!.session.paragraphIds();
    const before = chartRecord(editor);
    expect(before.anchorParagraphId).toBe(ids.at(-1)!);

    const target = paragraphBox(editor, ids[1]!);
    expect(moveTopTo(editor, ids[1]!, 4).ok).toBe(true);
    const after = chartRecord(editor);
    expect(after.anchorParagraphId).toBe(ids[1]!);
    // The frame top stays where the drop put it, though the text now wraps below the chart.
    expect(after.verticalFrameOrigin).toBeCloseTo(target.y, 3);
    expect(Math.abs(after.y - (target.y + 4))).toBeLessThan(1);
    expect(paragraphBox(editor, ids[1]!).y).toBeGreaterThanOrEqual(after.y + after.height);
    // The chart stays selected, with its pane data.
    expect(editor.snapshot().chart?.drawingNodeId).toBe(after.drawingNodeId);
  });

  test('the move is one undo step, and redo moves it again', () => {
    const editor = mountFloatingChart();
    const ids = editor.surface!.session.paragraphIds();
    expect(moveTopTo(editor, ids[0]!, 2).ok).toBe(true);
    expect(chartRecord(editor).anchorParagraphId).toBe(ids[0]!);
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(chartRecord(editor).anchorParagraphId).toBe(ids.at(-1)!);
    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(chartRecord(editor).anchorParagraphId).toBe(ids[0]!);
    // Redo selects the moved chart again, as undo selects the chart in its old place.
    expect(editor.snapshot().chart?.drawingNodeId).toBe(chartRecord(editor).drawingNodeId);
  });

  test('a small move inside the anchor paragraph keeps the drawing node', () => {
    const editor = mountFloatingChart();
    const ids = editor.surface!.session.paragraphIds();
    const before = chartRecord(editor);
    expect(moveTopTo(editor, ids.at(-1)!, 3).ok).toBe(true);
    const after = chartRecord(editor);
    expect(after.anchorParagraphId).toBe(ids.at(-1)!);
    expect(after.drawingNodeId).toBe(before.drawingNodeId);
  });

  test('the new anchor survives save and reopen', async () => {
    const editor = mountFloatingChart();
    const ids = editor.surface!.session.paragraphIds();
    expect(moveTopTo(editor, ids[2]!, 2).ok).toBe(true);
    const bytes = new Uint8Array(await editor.save());
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: bytes,
    });
    const reopenedIds = reopened.surface!.session.paragraphIds();
    expect(chartRecord(reopened).anchorParagraphId).toBe(reopenedIds[2]!);
    expect(reopened.surface!.session.paragraphIds()).toHaveLength(ids.length);
  });
});
