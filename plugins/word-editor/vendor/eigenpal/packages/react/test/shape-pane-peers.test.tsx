// The Format shape pane in two collaborating editors: a remote delete while the color grid is
// open, a remote recolor while a hex draft is in the field, undo after a remote edit, and a
// shape inside a group selected by a second press, which stays local while its edits sync.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import { strFromU8, unzipSync } from 'fflate';
import {
  runToolbarCommand,
  toolbarCommandState,
  type DocxEditorInstance,
} from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorSidePanel } from '../src/editor/panes/SidePanel.tsx';
import { collaborationModule } from '../../pro/src/collaboration/collaboration-module';
import type { DocumentCollaborationHandle } from '../../pro/src/collaboration/document-session';
import { createPeerHarness } from '../../pro/src/collaboration/__tests__/document-peer-support';
import {
  GROUP_DRAWING,
  SHAPE_PANE_CASES,
  selectParityShape,
  shapePaneDocx,
} from './shape-pane-parity.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function update(action: () => unknown = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

async function mount(room: DocumentCollaborationHandle) {
  let editor: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={room.document}
      modules={[collaborationModule({ session: room.session })]}
      onReady={(value) => {
        editor = value as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
      <DocxEditorSidePanel onClose={() => {}} />
    </DocxEditorRoot>
  );
  cleanups.push(() => view.unmount());
  await update();
  const panel = () => view.container.querySelector<HTMLElement>('.docx-side-panel')!;
  return {
    container: view.container,
    editor: () => editor!,
    panel,
    input: (label: string) =>
      panel().querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!,
    fillButton: () => panel().querySelector<HTMLButtonElement>('.docx-shape-pane__color-button')!,
    /** The hex field of the fill grid; opens the grid first. */
    fillHex: async () => {
      const open = () => panel().querySelector<HTMLInputElement>('.docx-color-picker__hex input');
      if (!open())
        await update(() =>
          panel().querySelector<HTMLButtonElement>('.docx-shape-pane__color-button')!.click()
        );
      return open()!;
    },
  };
}

const xml = async (editor: DocxEditorInstance) =>
  strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);

async function pair(bytes: Uint8Array, name: string) {
  const harness = createPeerHarness(name, { offlineEditing: true });
  const { alice, bob } = await harness.pair(bytes);
  alice.detach();
  bob.detach();
  const left = await mount(alice.room);
  const right = await mount(bob.room);
  cleanups.push(() => harness.cleanup());
  return { left, right };
}

test('a remote delete while the color grid is open closes the grid and empties the pane', async () => {
  const { left, right } = await pair(shapePaneDocx(SHAPE_PANE_CASES.theme), 'shape-pane-delete');
  await update(() => selectParityShape(left.editor()));
  await update(() => left.fillButton().click());
  expect(left.panel().querySelector('.docx-chart-pane__grid')).not.toBeNull();
  await update(() => selectParityShape(right.editor()));
  await update(() =>
    expect(right.editor().exec({ type: 'deleteImage' })).toMatchObject({ ok: true })
  );
  expect(left.panel().querySelector('.docx-chart-pane__grid')).toBeNull();
  expect(left.panel().textContent).toContain('No shape selected');
  expect(await xml(left.editor())).toBe(await xml(right.editor()));
  // Undo on the deleting side brings the shape back for both.
  await update(() => right.editor().exec({ type: 'undo' }));
  expect(await xml(left.editor())).toContain('<wps:wsp>');
  expect(await xml(left.editor())).toBe(await xml(right.editor()));
});

test('a remote recolor keeps a hex draft in the field, and Enter then writes the draft', async () => {
  const { left, right } = await pair(shapePaneDocx(SHAPE_PANE_CASES.solid), 'shape-pane-draft');
  await update(() => selectParityShape(left.editor()));
  const hex = await left.fillHex();
  await update(() => fireEvent.change(hex, { target: { value: '#123456' } }));
  await update(() => selectParityShape(right.editor()));
  await update(() => right.editor().exec({ type: 'setShapeFill', color: 'FF0000' }));
  // The remote color shows on the button; the open grid and the typed draft stay.
  expect(left.fillButton().getAttribute('data-color')).toBe('#FF0000');
  expect((await left.fillHex()).value).toBe('#123456');
  await update(async () => fireEvent.keyDown(await left.fillHex(), { key: 'Enter' }));
  expect(right.editor().snapshot().image?.shapeFormat?.fill.color).toBe('123456');
  expect(await xml(left.editor())).toBe(await xml(right.editor()));
});

test('undo after a remote edit takes back the local edit only', async () => {
  const { left, right } = await pair(shapePaneDocx(SHAPE_PANE_CASES.solid), 'shape-pane-undo');
  await update(() => selectParityShape(left.editor()));
  const width = left.input('Width (pt)');
  await update(() => {
    fireEvent.change(width, { target: { value: '3' } });
    fireEvent.keyDown(width, { key: 'Enter' });
  });
  await update(() => selectParityShape(right.editor()));
  await update(() => right.editor().exec({ type: 'setShapeFill', color: 'FF0000' }));
  await update(() => left.editor().exec({ type: 'undo' }));
  for (const side of [left, right])
    expect(side.editor().snapshot().image?.shapeFormat).toMatchObject({
      fill: { color: 'FF0000' },
      outline: { widthPt: 1 },
    });
  expect(left.input('Width (pt)').value).toBe('1');
  expect(await xml(left.editor())).toBe(await xml(right.editor()));
});

/** A press and release on the group's overlay frame at a fraction of its width. */
async function pressFrameAt(container: HTMLElement, fraction: number) {
  const frame = container.querySelector<HTMLElement>('.docx-image-selection-overlay__frame')!;
  frame.getBoundingClientRect = () =>
    ({ left: 100, top: 100, width: 192, height: 48, right: 292, bottom: 148 }) as DOMRect;
  const at = { clientX: 100 + 192 * fraction, clientY: 124, button: 0, pointerId: 1 };
  await update(() => {
    frame.dispatchEvent(
      new PointerEvent('pointerdown', { ...at, bubbles: true, cancelable: true })
    );
    window.dispatchEvent(new PointerEvent('pointerup', { ...at, bubbles: true }));
  });
}

test('a second press selects a shape inside a group; the selection stays local, edits sync', async () => {
  const { left, right } = await pair(shapePaneDocx('', GROUP_DRAWING), 'shape-pane-member');
  await update(() => selectParityShape(left.editor()));
  expect(left.fillButton().textContent).toContain('Mixed');
  await pressFrameAt(left.container, 0.25);
  const memberId = left.editor().snapshot().image?.memberId;
  expect(memberId).toBeString();
  expect(left.fillButton().getAttribute('data-color')).toBe('#9DC3E6');
  expect(right.editor().snapshot().image).toBeNull();

  // The pane edits that shape alone, for both editors.
  const hex = await left.fillHex();
  await update(() => {
    fireEvent.change(hex, { target: { value: '#FF0000' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
  });
  let saved = await xml(right.editor());
  expect(saved).toContain('<a:srgbClr val="FF0000"/>');
  expect(saved).toContain('<a:srgbClr val="A9D18E"/>');
  expect(left.editor().snapshot().image?.memberId).toBe(memberId);

  // The other shape, recolored on the right, repaints nothing in the left pane.
  await update(() => selectParityShape(right.editor()));
  await pressFrameAt(right.container, 0.75);
  expect(right.editor().snapshot().image?.memberId).not.toBe(memberId);
  await update(() => right.editor().exec({ type: 'setShapeFill', color: '7030A0' }));
  expect(left.fillButton().getAttribute('data-color')).toBe('#FF0000');
  expect(left.editor().snapshot().image?.memberId).toBe(memberId);

  // Moves and deletes refuse on a shape inside a group; Escape on the frame selects the group.
  expect(left.editor().exec({ type: 'deleteImage' })).toMatchObject({
    ok: false,
    code: 'unsupported',
  });
  const overlay = left.container.querySelector<HTMLElement>('.docx-image-selection-overlay')!;
  await update(() => fireEvent.keyDown(overlay, { key: 'Escape' }));
  expect(left.editor().snapshot().image?.memberId).toBeUndefined();
  expect(left.fillButton().textContent).toContain('Mixed');

  // The group goes on the left: the right pane empties, and both save the same document.
  await update(() =>
    expect(left.editor().exec({ type: 'deleteImage' })).toMatchObject({ ok: true })
  );
  expect(right.panel().textContent).toContain('No shape selected');
  saved = await xml(left.editor());
  expect(saved).toBe(await xml(right.editor()));
  expect(saved).not.toContain('<wpg:wgp>');
});

test('a remote delete of the group drops the selected shape; Delete never acts on its stale id', async () => {
  const { left, right } = await pair(shapePaneDocx('', GROUP_DRAWING), 'shape-pane-removed');
  await update(() => selectParityShape(left.editor()));
  await pressFrameAt(left.container, 0.25);
  expect(left.editor().snapshot().image?.memberId).toBeString();
  // The right editor deletes the group: the selected shape's id no longer resolves.
  await update(() => selectParityShape(right.editor()));
  await update(() => right.editor().exec({ type: 'deleteImage' }));
  expect(left.editor().snapshot().image).toBeNull();
  // Delete on the left drops the stale shape; with no drawing selected it is a text key.
  await update(() =>
    left.container
      .querySelector('.docx-pages')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
      )
  );
  const intent = left.editor().surface!.drawingSelectionIntent();
  expect(intent.kind === 'pointer' ? intent.memberNodeId : undefined).toBeUndefined();
  // The group comes back by undo on the right; the left editor does not select the old shape.
  await update(() => right.editor().exec({ type: 'undo' }));
  expect(left.editor().snapshot().image?.memberId).toBeUndefined();
  expect(await xml(left.editor())).toBe(await xml(right.editor()));
});

test('a dash syncs to the other peer; slot commands on a shape the other peer deleted refuse', async () => {
  const { left, right } = await pair(shapePaneDocx(SHAPE_PANE_CASES.solid), 'shape-pane-dash');
  await update(() => selectParityShape(left.editor()));
  await update(() => selectParityShape(right.editor()));
  // The dash part in the pane writes the dash, and the other peer reads it back.
  const dash = left
    .panel()
    .querySelector<HTMLSelectElement>('[data-slot="shape.outlineDash"] select')!;
  await update(() => fireEvent.change(dash, { target: { value: 'sysDash' } }));
  expect(right.editor().snapshot().image?.shapeFormat?.outline.dash).toBe('sysDash');
  expect(await xml(right.editor())).toContain('<a:prstDash val="sysDash"/>');
  // Concurrent edits converge: a remote width and a local dash both land.
  await update(() => {
    runToolbarCommand(right.editor(), 'shape.outlineWidth', 4.5);
    runToolbarCommand(left.editor(), 'shape.outlineDash', 'lgDash');
  });
  expect(await xml(left.editor())).toBe(await xml(right.editor()));
  expect(left.editor().snapshot().image?.shapeFormat?.outline).toMatchObject({
    widthPt: 4.5,
    dash: 'lgDash',
  });
  // Undo takes back the local dash only.
  await update(() => left.editor().exec({ type: 'undo' }));
  expect(right.editor().snapshot().image?.shapeFormat?.outline).toMatchObject({
    widthPt: 4.5,
    dash: 'sysDash',
  });
  // The right peer deletes the shape: the left slots disable and a run refuses.
  await update(() =>
    expect(right.editor().exec({ type: 'deleteImage' })).toMatchObject({ ok: true })
  );
  expect(toolbarCommandState(left.editor(), 'shape.outlineDash').enabled).toBe(false);
  expect(runToolbarCommand(left.editor(), 'shape.outlineDash', 'dot')).toMatchObject({ ok: false });
  expect(left.panel().textContent).toContain('No shape selected');
  expect(await xml(left.editor())).toBe(await xml(right.editor()));
});
