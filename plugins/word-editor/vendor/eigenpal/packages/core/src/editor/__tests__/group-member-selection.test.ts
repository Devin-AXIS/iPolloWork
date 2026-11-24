// A second press on a selected group selects the shape under the pointer: its own frame, its
// own fill and outline, shape commands on it alone, Escape back to the group, and refused
// moves, resizes, and deletes while it is selected.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { drawingNamed, mount, pressOn, saved, SCALE } from './shape-selection-fixture.ts';
import {
  GROUP_MEMBER_PROPERTIES_REASON,
  GROUP_MEMBER_REASON,
  leaveGroupMember,
} from '../group-member-selection.ts';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { selectedDrawingOverlayTargetOf } from '../drawing-overlay-target.ts';
import type { DocxEditorInstance } from '../docx-editor.ts';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';

/** Give the painted group its client rectangle: happy-dom lays nothing out. */
function laidOut(container: HTMLElement, editor: DocxEditorInstance, group: AnchoredDrawingRecord) {
  const painted = container.querySelector<HTMLElement>(
    `[data-drawing-node-id="${CSS.escape(group.drawingNodeId)}"]`
  )!;
  const page = editor.surface!.layout().pages[0]!;
  const paint = group.paintBounds;
  painted.getBoundingClientRect = () =>
    ({
      left: (page.contentBox.x + paint.x) * SCALE,
      top: (page.contentBox.y + paint.y) * SCALE,
      width: paint.width * SCALE,
      height: paint.height * SCALE,
    }) as DOMRect;
  return painted;
}

/** A press on the group at a fraction of its width, on its painted element. */
function pressGroupAt(
  container: HTMLElement,
  editor: DocxEditorInstance,
  group: AnchoredDrawingRecord,
  fraction: number
) {
  const painted = laidOut(container, editor, group);
  const page = editor.surface!.layout().pages[0]!;
  const event = new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    clientX: (page.contentBox.x + group.x + group.width * fraction) * SCALE,
    clientY: (page.contentBox.y + group.y + group.height / 2) * SCALE,
  });
  painted.dispatchEvent(event);
}

function key(container: HTMLElement, name: string) {
  container
    .querySelector('.docx-pages')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
}

test('a second press on a group selects the shape under the pointer, and Escape goes back up', async () => {
  const { editor, container } = await mount();
  try {
    const group = drawingNamed(editor, 3);
    pressOn(container, editor, group);
    const first = editor.snapshot().image!;
    expect(first.memberId).toBeUndefined();
    expect(first.shapeFormat?.fill.type).toBe('mixed');
    const groupFrame = selectedDrawingOverlayTargetOf(editor.surface)!;

    // Second press on the left rectangle: that shape, its own fill, its own frame.
    pressGroupAt(container, editor, group, 0.25);
    const member = editor.snapshot().image!;
    expect(member.id).toBe(first.id);
    expect(member.memberId).toBeString();
    expect(member.shapeFormat?.fill).toEqual({ type: 'solid', color: '9DC3E6', transparency: 0 });
    expect(member).toMatchObject({ canMove: false, canResize: false });
    const frame = selectedDrawingOverlayTargetOf(editor.surface)!;
    expect(frame.width).toBeCloseTo(groupFrame.width / 2, 3);
    expect(frame.x).toBeCloseTo(groupFrame.x, 3);
    expect(frame).toMatchObject({ canMove: false, canResize: false });

    // The fill changes that shape alone, and the shape stays selected for the next edit.
    expect(editor.exec({ type: 'setShapeFill', color: 'FF0000' })).toMatchObject({ ok: true });
    expect(editor.snapshot().image?.memberId).toBe(member.memberId);
    expect(editor.snapshot().image?.shapeFormat?.fill.color).toBe('FF0000');
    expect(editor.exec({ type: 'setShapeOutline', widthPt: 3 })).toMatchObject({ ok: true });
    let xml = await saved(editor);
    expect(xml).toContain('<a:srgbClr val="FF0000"/>');
    expect(xml).toContain('<a:srgbClr val="A9D18E"/>');
    expect(xml.match(/<a:ln w="38100">/g)).toHaveLength(1);

    // Moves, resizes, and deletes refuse with a typed reason; Delete keeps the group.
    const refused = { ok: false, code: 'unsupported', reason: GROUP_MEMBER_REASON };
    expect(editor.can({ type: 'deleteImage' })).toMatchObject(refused);
    expect(editor.exec({ type: 'deleteImage' })).toMatchObject(refused);
    expect(editor.exec({ type: 'setImageProperties', widthEmu: 12700 * 50 })).toMatchObject(
      refused
    );
    key(container, 'Delete');
    expect(editor.snapshot().image?.memberId).toBe(member.memberId);
    expect(await saved(editor)).toContain('<wpg:wgp>');

    // A press on the other rectangle moves to it; Escape selects the group again.
    pressGroupAt(container, editor, drawingNamed(editor, 3), 0.75);
    const second = editor.snapshot().image!;
    expect(second.memberId).not.toBe(member.memberId);
    expect(second.shapeFormat?.fill.color).toBe('A9D18E');
    key(container, 'Escape');
    expect(editor.snapshot().image?.memberId).toBeUndefined();
    expect(editor.snapshot().image?.shapeFormat?.fill.type).toBe('mixed');
    expect(leaveGroupMember(editor)).toBe(false);

    // With the group selected, the fill goes to both shapes again; undo takes it back.
    expect(editor.exec({ type: 'setShapeFill', color: '00B050' })).toMatchObject({ ok: true });
    expect(editor.snapshot().image?.shapeFormat?.fill.color).toBe('00B050');
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    xml = await saved(editor);
    expect(xml).toContain('<a:srgbClr val="FF0000"/>');
    expect(xml).toContain('<a:srgbClr val="A9D18E"/>');
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('the surface selects only a shape that the selected group holds', async () => {
  const { editor, container } = await mount();
  try {
    const group = drawingNamed(editor, 3);
    pressOn(container, editor, group);
    pressGroupAt(container, editor, group, 0.25);
    const memberId = editor.snapshot().image!.memberId!;
    expect(memberId).toBeString();
    // An id that is not a shape of the group selects nothing.
    expect(editor.surface!.selectDrawingMember('not-a-member')).toBe(false);
    expect(editor.snapshot().image?.memberId).toBe(memberId);
    expect(editor.surface!.selectDrawingMember(null)).toBe(true);
    expect(editor.snapshot().image?.memberId).toBeUndefined();
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('wrap, alt text, and properties refuse with their own reason; another drawing is not refused', async () => {
  const { editor, container } = await mount();
  try {
    const group = drawingNamed(editor, 3);
    pressOn(container, editor, group);
    pressGroupAt(container, editor, group, 0.25);
    expect(editor.snapshot().image?.memberId).toBeString();
    const properties = { ok: false, code: 'unsupported', reason: GROUP_MEMBER_PROPERTIES_REASON };
    expect(editor.can({ type: 'setImageProperties', alt: 'Logo' })).toMatchObject(properties);
    expect(editor.can({ type: 'setImageWrapType', target: 'square' })).toMatchObject(properties);
    expect(editor.can({ type: 'setImageProperties', widthEmu: 12700 * 40 })).toMatchObject({
      reason: GROUP_MEMBER_REASON,
    });
    // A command that names another drawing is not the group's: the member gate stays out.
    const line = drawingNamed(editor, 2);
    const other = editor.can({
      type: 'setImageProperties',
      drawingNodeId: line.drawingNodeId,
      alt: 'Rule',
    });
    expect(other.ok ? null : other.reason).not.toBe(GROUP_MEMBER_PROPERTIES_REASON);
    // Both reasons have catalogue keys.
    const t = (key: string) => `t:${key}`;
    expect(localizeDisabledReason(GROUP_MEMBER_REASON, t as never)).toBe(
      't:disabledReason.groupMemberMove'
    );
    expect(localizeDisabledReason(GROUP_MEMBER_PROPERTIES_REASON, t as never)).toBe(
      't:disabledReason.groupMemberProperties'
    );
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('undo and redo of an edit to a shape in a group keep that shape selected', async () => {
  const { editor, container } = await mount();
  try {
    const group = drawingNamed(editor, 3);
    pressOn(container, editor, group);
    pressGroupAt(container, editor, group, 0.75);
    const memberId = editor.snapshot().image!.memberId;
    expect(memberId).toBeString();
    expect(editor.exec({ type: 'setShapeFill', color: 'FF0000' })).toMatchObject({ ok: true });
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(editor.snapshot().image?.memberId).toBe(memberId);
    expect(editor.snapshot().image?.shapeFormat?.fill.color).toBe('A9D18E');
    expect(editor.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
    expect(editor.snapshot().image?.memberId).toBe(memberId);
    expect(editor.snapshot().image?.shapeFormat?.fill.color).toBe('FF0000');
  } finally {
    editor.destroy();
    container.remove();
  }
});
