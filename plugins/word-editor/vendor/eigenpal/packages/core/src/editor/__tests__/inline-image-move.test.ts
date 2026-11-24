import { test, expect, afterEach } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import {
  beginInlineImageDrag,
  canMoveInlineImage,
  cancelInlineImageDrag,
  moveInlineImage,
} from '../inline-image-drag.ts';
import { PNG_1X1, decodePort } from './image-decode-harness.ts';
import { findNode } from '../../store/package/ooxml-edit.ts';
import { paragraphContainingNode } from '../../store/store/tree-op-nodes.ts';
const cleaners: Array<() => void> = [];
afterEach(() => {
  for (const f of cleaners.splice(0)) f();
});
async function setup() {
  const c = document.createElement('div');
  document.body.append(c);
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>first</w:t></w:r></w:p><w:p><w:r><w:t>second</w:t></w:r></w:p></w:body></w:document>'
    ),
  });
  const e = createDocxEditor({
    container: c,
    document: bytes.buffer,
    imageDecodePort: decodePort(),
  });
  cleaners.push(() => {
    e.destroy();
    c.remove();
  });
  const paragraphs = e.surface!.layout().pages[0]!.fragments.filter((f) => f.kind === 'paragraph');
  const first = paragraphs[0]!.paragraphId,
    second = paragraphs[1]!.paragraphId;
  e.exec({
    type: 'setSelection',
    range: { anchor: { paragraphId: first, offset: 2 }, head: { paragraphId: first, offset: 2 } },
  });
  expect(
    (
      await e.executeImageCommand({
        type: 'insertImage',
        data: PNG_1X1,
        mime: 'image/png',
        widthPoints: 20,
        heightPoints: 20,
        title: 'kept title',
        description: 'kept description',
      })
    ).ok
  ).toBe(true);
  const drawing = e
    .surface!.layout()
    .pages[0]!.fragments.flatMap((f) =>
      f.kind === 'paragraph' ? f.lines.flatMap((l) => l.drawings ?? []) : []
    )[0]!;
  return { e, first, second, id: drawing.drawingNodeId };
}
test('moves one drawing with its identity and resources, undo and redo', async () => {
  const { e, first, second, id } = await setup();
  const s = e.surface!;
  const before = findNode(s.session.part(), id);
  const media = [...s.session.currentPackage().parts.keys()].filter((k) => k.includes('/media/'));
  expect(
    moveInlineImage(s, id, { paragraphId: second, offset: 3 }, s.session.packageRevision())
      .committed
  ).toBe(true);
  expect(findNode(s.session.part(), id)).toEqual(before);
  expect(paragraphContainingNode(s.session.part(), id)?.id).toBe(second);
  expect([...s.session.currentPackage().parts.keys()].filter((k) => k.includes('/media/'))).toEqual(
    media
  );
  e.exec({ type: 'undo' });
  expect(paragraphContainingNode(s.session.part(), id)?.id).toBe(first);
  e.exec({ type: 'redo' });
  expect(paragraphContainingNode(s.session.part(), id)?.id).toBe(second);
  const saved = await e.save();
  e.load(saved);
  expect(
    e
      .surface!.layout()
      .pages[0]!.fragments.flatMap((f) =>
        f.kind === 'paragraph' ? f.lines.flatMap((l) => l.drawings ?? []) : []
      )
  ).toHaveLength(1);
});
test('adjusts same-paragraph offsets and refuses stale moves', async () => {
  const { e, first, id } = await setup();
  const s = e.surface!,
    revision = s.session.packageRevision();
  expect(moveInlineImage(s, id, { paragraphId: first, offset: 6 }, revision).committed).toBe(true);
  const drawings = s
    .layout()
    .pages[0]!.fragments.flatMap((f) =>
      f.kind === 'paragraph' ? f.lines.flatMap((l) => l.drawings ?? []) : []
    );
  expect(drawings[0]?.start).toBe(5);
  expect(moveInlineImage(s, id, { paragraphId: first, offset: 0 }, revision).rejected).toBe(true);
});

test('refuses viewing, suggesting, locked pictures, and foreign targets without mutation', async () => {
  const { e, second, id } = await setup();
  const s = e.surface!;
  const target = { paragraphId: second, offset: 0 };
  expect(canMoveInlineImage(e, id)).toBe(true);
  expect(canMoveInlineImage(e, id)).toBe(true);
  expect(canMoveInlineImage(e, 'missing-drawing')).toBe(false);
  expect(canMoveInlineImage(e, id)).toBe(true);
  for (const mode of ['view', 'suggest'] as const) {
    s.setEditingMode(mode);
    const revision = s.session.packageRevision();
    expect(canMoveInlineImage(e, id)).toBe(false);
    expect(moveInlineImage(s, id, target, revision).committed).toBe(false);
    expect(s.session.packageRevision()).toBe(revision);
  }
  s.setEditingMode('edit');
  expect(canMoveInlineImage(e, id)).toBe(true);
  const revision = s.session.packageRevision();
  expect(
    moveInlineImage(s, id, { paragraphId: 'foreign-story', offset: 0 }, revision).committed
  ).toBe(false);
  expect(s.session.packageRevision()).toBe(revision);
  expect(
    s.applyDrawingOps([{ op: 'setDrawingLocks', drawingNodeId: id, locks: { move: true } }])
      .committed
  ).toBe(true);
  const lockedRevision = s.session.packageRevision();
  expect(canMoveInlineImage(e, id)).toBe(false);
  expect(moveInlineImage(s, id, target, lockedRevision).committed).toBe(false);
  expect(s.session.packageRevision()).toBe(lockedRevision);
});

test('modified presses keep their selection meaning instead of starting a move', async () => {
  const { e, id } = await setup();
  const press = (init: PointerEventInit) =>
    new PointerEvent('pointerdown', { button: 0, pointerId: 1, pointerType: 'mouse', ...init });
  for (const modifier of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey'] as const) {
    const event = press({ [modifier]: true });
    expect(beginInlineImageDrag(e, event, id)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(beginInlineImageDrag(e, press({}), id)).toBe(true);
  cancelInlineImageDrag(e.surface!);
});
