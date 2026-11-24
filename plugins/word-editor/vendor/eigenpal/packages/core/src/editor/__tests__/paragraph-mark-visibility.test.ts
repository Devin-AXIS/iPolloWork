import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { EditorModule } from '../../contracts/modules.ts';
import { collectReviewItems } from '../../store/index.ts';
import { createDocxEditor } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems,
      revisionItemsOfParagraph: () => [],
    },
  };
}

describe('tracked paragraph-mark visibility', () => {
  test('Show/Hide is independent of revision selection and leaves the document unchanged', () => {
    const mark =
      '<w:pPr><w:rPr><w:ins w:id="7" w:author="Ada" w:date="2026-09-09T08:00:00Z"/></w:rPr></w:pPr>';
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docx(
        `<w:p>${mark}<w:r><w:t>one</w:t></w:r></w:p>` +
          `<w:p>${mark}<w:r><w:t>two</w:t></w:r></w:p>` +
          '<w:p><w:r><w:t>three</w:t></w:r></w:p>'
      ),
      modules: [reviewModule()],
    });
    const card = editor
      .getReviewItems()
      .find((entry) => entry.kind === 'revision' && entry.revisionKind === 'paragraphMark');
    expect(card).toBeDefined();
    expect(card!.item.ranges).toHaveLength(2);

    const glyphs = container.querySelectorAll('.docx-revision-pmark');
    expect(glyphs).toHaveLength(2);
    expect(container.querySelectorAll('.docx-revision-pmark--active')).toHaveLength(0);

    expect(editor.setActiveReviewItem(card!.key).ok).toBe(true);
    expect(container.querySelectorAll('.docx-revision-pmark--active')).toHaveLength(0);
    const revision = editor.getDocumentHandle().revision;
    expect(editor.exec({ type: 'toggleParagraphMarks' }).ok).toBe(true);
    expect(editor.snapshot().showParagraphMarks).toBe(true);
    expect(container.querySelectorAll('.docx-paragraph-mark')).toHaveLength(3);
    expect(container.querySelector('.docx-show-paragraph-marks')).not.toBeNull();
    expect(editor.getDocumentHandle().revision).toBe(revision);

    expect(editor.setActiveReviewItem(null).ok).toBe(true);
    expect(container.querySelectorAll('.docx-revision-pmark--active')).toHaveLength(0);
    expect(editor.exec({ type: 'toggleParagraphMarks' }).ok).toBe(true);
    expect(container.querySelector('.docx-show-paragraph-marks')).toBeNull();
    editor.destroy();
  });
});

test('Show/Hide works by keyboard in viewing mode, survives reload, and does not enter undo history', async () => {
  const container = document.createElement('div');
  const bytes = docx('<w:p><w:r><w:t>Text</w:t><w:br/><w:cr/><w:t>After</w:t></w:r></w:p><w:p/>');
  const editor = createDocxEditor({ container, document: bytes, mode: 'view' });
  const before = new Uint8Array(await editor.save());
  const surface = container.querySelector('.docx-pages')!;
  surface.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: '8',
      code: 'Digit8',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  expect(editor.snapshot().showParagraphMarks).toBe(true);
  expect(editor.snapshot().canUndo).toBe(false);
  expect(container.querySelectorAll('.docx-paragraph-mark')).toHaveLength(2);
  expect(container.querySelectorAll('.docx-line-break-mark')).toHaveLength(2);
  expect(editor.exec({ type: 'selectAll' }).ok).toBe(true);
  expect(editor.surface!.selectedText()).toBe('Text\n\nAfter\n');
  for (const mark of container.querySelectorAll('.docx-paragraph-mark, .docx-line-break-mark')) {
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.getAttribute('contenteditable')).toBe('false');
  }
  expect(new Uint8Array(await editor.save())).toEqual(before);
  await editor.load(bytes);
  expect(editor.snapshot().showParagraphMarks).toBe(true);
  expect(container.querySelectorAll('.docx-paragraph-mark')).toHaveLength(2);
  expect(container.querySelectorAll('.docx-line-break-mark')).toHaveLength(2);
  container.querySelector('.docx-pages')!.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: '*',
      code: 'Digit8',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  expect(editor.snapshot().showParagraphMarks).toBe(false);
  expect(container.querySelectorAll('.docx-paragraph-mark')).toHaveLength(0);
  expect(container.querySelectorAll('.docx-line-break-mark')).toHaveLength(0);
  expect(new Uint8Array(await editor.save())).toEqual(before);
  editor.destroy();
  expect(editor.can({ type: 'toggleParagraphMarks' }).ok).toBe(false);
  expect(editor.exec({ type: 'toggleParagraphMarks' }).ok).toBe(false);
});
