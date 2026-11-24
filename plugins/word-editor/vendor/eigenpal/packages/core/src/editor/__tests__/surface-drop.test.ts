import { paragraphTextOf } from '../../store/store/tree-op-apply.ts';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, describe, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { editorDropHandled } from '../surface-drop.ts';
import { stubRect } from './surface-pointer-harness.ts';
import { PNG_1X1, decodePort, deferredDecodePort } from './image-decode-harness.ts';

const clientOf = (x: number, y: number) => ({
  clientX: 100 + ((72 + x) * 4) / 3,
  clientY: 50 + ((72 + y) * 4) / 3,
});
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function opened(port = decodePort()) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: 'blank', imageDecodePort: port, zoom: 1 });
  editor.exec({ type: 'insertText', text: 'alpha bravo charlie' });
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  stubRect(pages, { left: 100, top: 50 });
  cleanups.push(() => {
    editor.destroy();
    container.remove();
  });
  return { editor, pages, container };
}
function drag(type: string, x: number, y: number, data: DataTransfer) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...clientOf(x, y) });
  Object.defineProperty(event, 'dataTransfer', { value: data });
  return event as DragEvent;
}
function textTransfer(text: string) {
  const data = new DataTransfer();
  data.setData('text/plain', text);
  return data;
}
function imageCommand(editor: DocxEditorInstance, x = 5) {
  const { clientX, clientY } = clientOf(x, 5);
  const at = editor.positionAtPoint(clientX, clientY);
  expect(at).not.toBeNull();
  return {
    type: 'insertImage' as const,
    at: at!,
    data: PNG_1X1,
    mime: 'image/png' as const,
    widthPoints: 10,
    heightPoints: 10,
  };
}

describe('drop position and insertion', () => {
  test('rejects gutters, margins, non-finite points, and detached editors', () => {
    const { editor } = opened();
    expect(editor.positionAtPoint(0, 0)).toBeNull();
    expect(editor.positionAtPoint(100 + 30, 50 + 30)).toBeNull();
    expect(editor.positionAtPoint(NaN, 150)).toBeNull();
    expect(editor.positionAtPoint(200, Infinity)).toBeNull();
    editor.detach();
    expect(editor.positionAtPoint(200, 150)).toBeNull();
  });

  test('inserts plain text at the drop point without replacing the old selection', () => {
    const { editor, pages } = opened();
    const position = imageCommand(editor).at;
    const old = editor.surface!.state().selection.anchor;
    expect(old.offset).toBeGreaterThan(position.offset);
    const event = drag('drop', 5, 5, textTransfer('DROP'));
    pages.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(editorDropHandled(event)).toBe(true);
    expect(paragraphTextOf(editor.surface!.session.part(), position.paragraphId)).toContain('DROP');
    expect(paragraphTextOf(editor.surface!.session.part(), position.paragraphId)).not.toBe(
      'alpha bravo charlieDROP'
    );
  });

  test('custom handlers claim the native payload before default insertion', () => {
    const { editor, pages } = opened();
    let observed = '';
    editor.on('drop', ({ event, position }) => {
      observed = event.dataTransfer!.getData('application/x-card');
      expect(position.part).toBe('/word/document.xml');
      event.preventDefault();
    });
    const data = textTransfer('must not insert');
    data.setData('application/x-card', 'card-42');
    const event = drag('drop', 5, 5, data);
    pages.dispatchEvent(event);
    expect(observed).toBe('card-42');
    expect(editorDropHandled(event)).toBe(true);
    expect(
      paragraphTextOf(
        editor.surface!.session.part(),
        editor.surface!.state().selection.head.paragraphId
      )
    ).toBe('alpha bravo charlie');
  });

  test('image payloads with a plain path remain available to the adapter', () => {
    const { pages } = opened();
    const data = textTransfer('/private/picture.png');
    data.items.add(new File([PNG_1X1], 'picture.png', { type: 'image/png' }));
    const event = drag('drop', 5, 5, data);
    pages.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(editorDropHandled(event)).toBe(false);
  });

  test('an image target survives selection movement during decoding', async () => {
    const deferred = deferredDecodePort();
    const { editor } = opened(deferred.port);
    const command = imageCommand(editor);
    const inserting = editor.executeImageCommand(command);
    editor.exec({
      type: 'setSelection',
      range: {
        anchor: { paragraphId: command.at.paragraphId, offset: 18 },
        head: { paragraphId: command.at.paragraphId, offset: 18 },
      },
    });
    deferred.release();
    expect((await inserting).ok).toBe(true);
    const line = editor.surface!.layout().pages[0]!.fragments[0];
    expect(line.kind).toBe('paragraph');
    if (line.kind === 'paragraph')
      expect(line.lines.flatMap((line) => line.drawings ?? [])[0]?.start).toBe(command.at.offset);
  });

  test('stale targets and copied targets refuse insertion', async () => {
    const { editor } = opened();
    const command = imageCommand(editor);
    expect((await editor.executeImageCommand({ ...command, at: { ...command.at } })).ok).toBe(
      false
    );
    editor.exec({ type: 'insertText', text: 'changed' });
    expect((await editor.executeImageCommand(command)).ok).toBe(false);
  });

  test('detaching before a file read finishes invalidates the target', async () => {
    const { editor } = opened();
    const command = imageCommand(editor);
    editor.detach();
    expect((await editor.executeImageCommand(command)).ok).toBe(false);
  });

  test('reload invalidates a target even when document revision repeats', async () => {
    const { editor } = opened();
    const command = imageCommand(editor);
    editor.load('blank');
    editor.exec({ type: 'insertText', text: 'alpha bravo charlie' });
    expect((await editor.executeImageCommand(command)).ok).toBe(false);
  });
});

test('drag feedback preserves selection and layout across repeated events', async () => {
  const { editor, pages, container } = opened();
  const before = editor.surface!.layout();
  const selection = editor.surface!.state().selection;
  const perf = editor.surface!.state().perf;
  let changes = 0;
  let selections = 0;
  editor.on('change', () => changes++);
  editor.on('selectionChange', () => selections++);
  for (let i = 0; i < 50; i++)
    pages.dispatchEvent(drag('dragover', 5 + i, 5, textTransfer('drag')));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(container.querySelectorAll('[data-docx-drop-caret]').length).toBe(1);
  expect(editor.surface!.layout()).toBe(before);
  expect(editor.surface!.state().selection).toEqual(selection);
  expect(editor.surface!.state().perf.fullPasses).toBe(perf.fullPasses);
  expect(changes).toBe(0);
  expect(selections).toBe(0);
  pages.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
  expect(container.querySelector('[data-docx-drop-caret]')).toBeNull();
});

test('a document change clears drag feedback', async () => {
  const { editor, pages, container } = opened();
  pages.dispatchEvent(drag('dragover', 5, 5, textTransfer('drag')));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(container.querySelector('[data-docx-drop-caret]')).not.toBeNull();
  editor.exec({ type: 'insertText', text: 'edit' });
  expect(container.querySelector('[data-docx-drop-caret]')).toBeNull();
});

test('zoomed client coordinates resolve the same model offset', () => {
  const { editor } = opened();
  const before = imageCommand(editor, 25).at;
  editor.setZoom(1.5);
  const { paintScale } = editor.surface!.overlayCoordinates();
  expect(editor.positionAtPoint(100 + (72 + 25) * paintScale, 50 + 77 * paintScale)).toMatchObject(
    before
  );
});

test('viewing mode rejects drops without changing the selection', () => {
  const { editor, pages, container } = opened();
  editor.surface!.setEditingMode('view');
  const selection = editor.surface!.state().selection;
  const event = drag('drop', 5, 5, textTransfer('refused'));
  pages.dispatchEvent(event);
  expect(editorDropHandled(event)).toBe(true);
  expect(editor.surface!.state().selection).toEqual(selection);
  expect(container.querySelector('[data-docx-drop-caret]')).toBeNull();
});

test('rejected drag feedback is stable and clears on acceptance and cancellation', async () => {
  const { editor, pages, container } = opened();
  const unsupported = new DataTransfer();
  unsupported.setData('application/x-unknown', 'value');
  pages.dispatchEvent(drag('dragover', 5, 5, unsupported));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const badge = container.querySelector('[data-docx-drop-rejection]');
  expect(badge?.textContent).toBe('Drop a PNG, JPEG, GIF, or text.');
  expect(unsupported.dropEffect).toBe('none');
  pages.dispatchEvent(drag('dragover', 8, 5, unsupported));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(container.querySelector('[data-docx-drop-rejection]')).toBe(badge);
  pages.dispatchEvent(drag('dragover', 5, 5, textTransfer('accepted')));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(container.querySelector('[data-docx-drop-rejection]')).toBeNull();
  expect(container.querySelector('[data-docx-drop-caret]')).not.toBeNull();
  editor.surface!.setEditingMode('view');
  pages.dispatchEvent(drag('dragover', 5, 5, textTransfer('refused')));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(container.querySelector('[data-docx-drop-rejection]')?.textContent).toBe(
    'This document is read-only.'
  );
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(container.querySelector('[data-docx-drop-rejection]')).toBeNull();
});

test('stationary edge scrolling retains the gesture through layout refreshes', async () => {
  const { editor, pages, container } = opened();
  editor.surface!.insertPlainText(
    Array.from({ length: 80 }, (_, i) => `Paragraph ${i}`).join('\n')
  );
  const viewport = document.createElement('div');
  viewport.className = 'docx-editor__scroll-container';
  document.body.append(viewport);
  viewport.append(container);
  let scrollTop = 0;
  Object.defineProperty(viewport, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.max(0, Math.min(3000, value));
    },
  });
  stubRect(viewport, { left: 100, top: 50, bottom: 450 });
  Object.defineProperty(pages, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 100,
      top: 50 - viewport.scrollTop,
      right: 1000,
      bottom: 5000 - viewport.scrollTop,
    }),
  });
  cleanups.push(() => viewport.remove());
  const selection = editor.surface!.state().selection;
  const beforeRevision = editor.getDocumentHandle().revision;
  const event = new MouseEvent('dragover', {
    bubbles: true,
    cancelable: true,
    clientX: 250,
    clientY: 449,
  });
  Object.defineProperty(event, 'dataTransfer', { value: textTransfer('drop') });
  pages.dispatchEvent(event);
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(viewport.scrollTop).toBeGreaterThan(10);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  const stopped = viewport.scrollTop;
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(viewport.scrollTop).toBe(stopped);
  expect(editor.getDocumentHandle().revision).toBe(beforeRevision);
  expect(editor.surface!.state().selection).toEqual(selection);
});
