// Toolbar honesty: does a control's enabled state, pressed state and displayed value
// follow the caret and the document — and does pressing it do what the label says?
//
// Three lies this pins down, all of one family (a control that looks live and is not):
//
// 1. A mark command the surface could not write reported `can: ok` and then
//    `{ ok: true, changed: false }`. Bold over several paragraphs left the button
//    enabled, un-pressed, and the document untouched. The surface writes that range now,
//    so the pin is that the control is live AND the press lands — `can`, `exec` and the
//    pressed state agreeing over a cross-paragraph selection. (A collapsed caret is a
//    third case: it arms the stored-marks lane, pinned below.)
// 2. `snapshot()` reused its previous REFERENCE across an edit that changed only
//    structure, so a `useSyncExternalStore` host never re-rendered and every control that
//    re-asks `Editor.can`/`isActive` on a store tick kept its stale answer — the bullet
//    button stayed pressed after a second press removed the list.
// 3. Paragraph-level formatting (alignment, style) answered for `selection.head` alone, so
//    a mixed multi-paragraph selection showed whichever paragraph the user dragged TO.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { CHROME_GROUPS, chromeSlotId, type ChromeSlotId } from '../chrome-controls.ts';
import {
  commandForSlot,
  runTableCommand,
  runToolbarCommand,
  tableCommandToolbarState,
  toolbarCommandState,
} from '../toolbar-commands.ts';
import { tableRowOccurrenceTargetFrom } from '../../layout/table-interaction-targets.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { MAX_TABLE_COLUMNS } from '../../store/store/table-constraints.ts';

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

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const PID = (index: number) => `/word/document.xml#0.0.${index}`;

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function select(
  editor: DocxEditorInstance,
  anchor: readonly [number, number],
  head: readonly [number, number]
): void {
  editor.exec({
    type: 'setSelection',
    range: {
      anchor: { paragraphId: PID(anchor[0]), offset: anchor[1] },
      head: { paragraphId: PID(head[0]), offset: head[1] },
    },
  });
}

describe('a run-formatting control never looks live over a selection it cannot write', () => {
  test('Bold across a paragraph boundary is live, and the press lands', () => {
    const editor = mount(p('alpha') + p('beta'));
    select(editor, [0, 0], [1, 4]);
    const revision = editor.surface!.session.revision();

    // Enabled with no reason to show, because the surface can write this range.
    const before = toolbarCommandState(editor, 'text.bold');
    expect(before.enabled).toBe(true);
    expect(before.disabledReason).toBe(null);
    expect(before.active).toBe(false);
    expect(editor.can({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);

    // `exec` agrees with `can`, and the document actually moves — the failure this pins is
    // a press that reports success over an unchanged document.
    expect(editor.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
    expect(editor.surface!.session.revision()).not.toBe(revision);
    expect(toolbarCommandState(editor, 'text.bold').active).toBe(true);
  });

  test('a collapsed caret arms pending formatting instead of disabling the marks', () => {
    // At a word's edge: inside a word a press formats the whole word instead.
    const editor = mount(p('al pha'));
    select(editor, [0, 2], [0, 2]);
    const revision = editor.surface!.session.revision();

    // Word's stored-marks lane: the controls stay live at a caret, and pressing one arms
    // the format for the next characters typed.
    for (const slot of [
      'text.bold',
      'text.italic',
      'text.underline',
      'text.strike',
      'font.family',
      'font.size',
      'text.color',
      'text.highlight',
    ] as const) {
      expect(toolbarCommandState(editor, slot).enabled).toBe(true);
    }

    // Arming changes no document text, but the toolbar reflects it immediately.
    expect(editor.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
    expect(editor.surface!.session.revision()).toBe(revision);
    expect(editor.snapshot().formatting?.bold).toBe(true);
    expect(toolbarCommandState(editor, 'text.bold').active).toBe(true);
    // A second press cancels the armed format rather than double-arming it.
    expect(editor.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
    expect(editor.snapshot().formatting?.bold).toBe(false);
    editor.exec({ type: 'toggleMark', mark: 'bold' });

    // Typing consumes it: the typed characters are bold, their neighbours untouched.
    editor.surface!.type('XY');
    select(editor, [0, 2], [0, 4]);
    expect(editor.snapshot().formatting?.bold).toBe(true);
    select(editor, [0, 0], [0, 2]);
    expect(editor.snapshot().formatting?.bold).toBe(false);
    select(editor, [0, 4], [0, 7]);
    expect(editor.snapshot().formatting?.bold).toBe(false);

    // Moving the caret discards an armed format instead of applying it somewhere else.
    select(editor, [0, 0], [0, 0]);
    editor.exec({ type: 'toggleMark', mark: 'italic' });
    expect(editor.snapshot().formatting?.italic).toBe(true);
    select(editor, [0, 6], [0, 6]);
    expect(editor.snapshot().formatting?.italic).toBe(false);
    editor.surface!.type('z');
    select(editor, [0, 6], [0, 7]);
    expect(editor.snapshot().formatting?.italic).toBe(false);
  });

  test('arming at a caret EMITS, so a host that only listens still re-renders', () => {
    // The lie this pins: arming moves no revision (so no `change`) and no caret (so the
    // selection guard used to return early), leaving a subscriber-driven toolbar showing
    // Bold unpressed while the engine had it armed. Both adapters read state only through
    // these events — `snapshot()` is PULLED, so a test that only reads it cannot see this.
    const editor = mount(p('alpha'));
    select(editor, [0, 2], [0, 2]);
    let ticks = 0;
    editor.on('selectionChange', () => {
      ticks += 1;
    });
    editor.on('change', () => {
      ticks += 1;
    });

    editor.exec({ type: 'toggleMark', mark: 'bold' });
    expect(ticks).toBeGreaterThan(0);
    expect(editor.snapshot().formatting?.bold).toBe(true);

    // Disarming has to reach the host too, or the button stays pressed over a caret that
    // no longer carries the format.
    const armed = ticks;
    editor.exec({ type: 'toggleMark', mark: 'bold' });
    expect(ticks).toBeGreaterThan(armed);
    expect(editor.snapshot().formatting?.bold).toBe(false);
  });
});

describe('the snapshot reference moves whenever the document does', () => {
  test('a second Bullet press un-presses the button', () => {
    const editor = mount(p('alpha'));
    select(editor, [0, 1], [0, 1]);

    editor.exec({ type: 'toggleList', kind: 'bullet' });
    const listed = editor.snapshot();
    expect(toolbarCommandState(editor, 'list.bullet').active).toBe(true);

    // Removing the list changes NOTHING the snapshot carries — same caret, same run
    // formatting, same page, canUndo already true — so the previous reference used to be
    // reused and a `useSyncExternalStore` host never re-rendered. The button stayed
    // pressed over a paragraph that was no longer a list.
    editor.exec({ type: 'toggleList', kind: 'bullet' });
    expect(editor.snapshot()).not.toBe(listed);
    expect(toolbarCommandState(editor, 'list.bullet').active).toBe(false);
  });

  test('an unchanged document at an unmoved caret still returns the same reference', () => {
    // The cache is not simply disabled: a re-derivation that found nothing new must still
    // hand back the previous object, or every subscriber re-renders on every tick.
    const editor = mount(p('alpha'));
    // Fixed first: the default mode is `auto`, and `setZoom` LEAVES a fit even when the
    // number is the one the fit had landed on, which is a real state change and correctly
    // moves the snapshot. What is being tested here is the no-op path.
    editor.setZoomMode({ type: 'fixed' });
    const before = editor.snapshot();
    expect(editor.setZoom(1)).toEqual({ ok: true, changed: false });
    expect(editor.snapshot()).toBe(before);
  });
});

describe('no wired toggle is a lie of omission', () => {
  // `isActive` answers honest-false for anything it does not derive, which is correct for
  // an ACTION (undo, indent) and a lie for a TOGGLE — a button that can never show pressed
  // looks permanently off over text it is already applied to. Underline was exactly that
  // once, missing from `isRunPropertyActive`'s switch. So: every toggle-shaped wired slot
  // must be able to REACH `active: true` against a real document.
  const TOGGLE_SHAPED = ['toggleMark', 'setAlignment', 'toggleList'] as const;

  test('every toggle-shaped wired slot can reach a pressed state', () => {
    const editor = mount(p('alpha'));
    const reachable: ChromeSlotId[] = [];
    const expected: ChromeSlotId[] = [];
    for (const group of CHROME_GROUPS) {
      for (const control of group.controls) {
        const slot = chromeSlotId(group, control) as ChromeSlotId;
        const command = commandForSlot(slot);
        if (!command) continue;
        if (!(TOGGLE_SHAPED as readonly string[]).includes(command.type)) continue;
        expected.push(slot);
        // Fresh document each time: a toggle left on would mask the next one.
        const probe = mount(p('alpha'));
        select(probe, [0, 0], [0, 5]);
        probe.exec(command);
        if (toolbarCommandState(probe, slot).active) reachable.push(slot);
        probe.destroy();
      }
    }
    expect(reachable).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    editor.destroy();
  });

  test('the action slots stay unpressed by design, and say why when refused', () => {
    // undo/redo/indent/outdent are not toggles: `active: false` forever is correct, and
    // React only puts `aria-pressed` on marks and alignment. What they owe instead is a
    // truthful ENABLED state, from the history and the list level.
    const editor = mount(p('alpha'));
    for (const slot of ['history.undo', 'history.redo'] as const) {
      const state = toolbarCommandState(editor, slot);
      expect(state.active).toBe(false);
      expect(state.enabled).toBe(false);
      expect(state.disabledReason).toBe(
        slot === 'history.undo' ? 'nothing to undo' : 'nothing to redo'
      );
    }
    // A plain paragraph at the margin cannot outdent, and says so.
    expect(toolbarCommandState(editor, 'list.outdent')).toMatchObject({
      enabled: false,
      active: false,
      disabledReason: 'the selection is already at the outermost level',
    });
  });

  test('save reports the reason it has no command, not that it is unwired', () => {
    // `file.save` IS wired — through `runSave`, because `Editor.save()` is not a command.
    // Claiming "not wired to an editor command" told a host the capability was missing.
    const editor = mount(p('alpha'));
    const state = toolbarCommandState(editor, 'file.save');
    expect(state.disabledReason).toBe('save is not a command; run it with runSave(editor)');
    // A genuinely unwired slot keeps the original wording.
    expect(toolbarCommandState(editor, 'zoom.level').disabledReason).toBe(
      'not wired to an editor command'
    );
  });

  test('the link slot is enabled exactly while a link UI is registered', async () => {
    // `text.link` runs no command: the registered link UI supplies the target. So the slot
    // is enabled only while one is registered, and running it opens that UI, as Ctrl/Cmd+K
    // does. A host with no link UI gets a disabled control with a reason, never a button
    // that does nothing.
    const editor = mount(p('alpha'));
    expect(toolbarCommandState(editor, 'text.link').disabledReason).toBe(
      'no link view is registered'
    );
    expect(editor.can({ type: 'insertHyperlink', href: 'https://example.com' }).ok).toBe(true);

    let requests = 0;
    const before = editor.snapshot();
    const unregister = editor.setHyperlinkChrome({ onRequest: () => (requests += 1) });
    // Registration moves the snapshot, so chrome that reads the slot re-renders.
    expect(editor.snapshot()).not.toBe(before);
    expect(toolbarCommandState(editor, 'text.link')).toEqual({
      id: 'text.link',
      enabled: true,
      disabledReason: null,
      active: false,
    });
    expect(runToolbarCommand(editor, 'text.link')).toEqual({ ok: true, changed: false });
    expect(requests).toBe(1);

    // A popover-only registration on top cannot open insert-or-edit.
    const popoverOnly = editor.setHyperlinkChrome({ onPopover: () => undefined });
    expect(toolbarCommandState(editor, 'text.link').enabled).toBe(false);
    popoverOnly();

    // The engine's refusal comes first: it is the reason a person can act on.
    editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    expect(toolbarCommandState(editor, 'text.link').disabledReason).toBe(
      'the document is open for viewing'
    );
    expect(runToolbarCommand(editor, 'text.link').ok).toBe(false);
    expect(requests).toBe(1);
    editor.exec({ type: 'setEditingMode', mode: 'editing' });

    unregister();
    await Promise.resolve();
    expect(toolbarCommandState(editor, 'text.link').disabledReason).toBe(
      'no link view is registered'
    );
  });
});

// Task 7: table commands use tableCommandToolbarState/runTableCommand — slot mapping is Task 9.
describe('table command toolbar honesty (Task 7)', () => {
  const TABLE_2X2 =
    '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    `<w:tr><w:tc>${p('A1')}</w:tc><w:tc>${p('B1')}</w:tc></w:tr>` +
    `<w:tr><w:tc>${p('A2')}</w:tc><w:tc>${p('B2')}</w:tc></w:tr></w:tbl>`;

  function paragraphByText(editor: DocxEditorInstance, text: string): string {
    for (const id of editor.surface!.session.paragraphIds()) {
      if (paragraphTextOf(editor.surface!.session.part(), id) === text) return id;
    }
    throw new Error(`paragraph ${text} not found`);
  }

  function tableFragment(editor: DocxEditorInstance) {
    for (const page of editor.surface!.layout().pages) {
      const block = page.fragments.find((b) => b.kind === 'table');
      if (block?.kind === 'table') return block;
    }
    throw new Error('no table');
  }

  test('stale explicit row target refusal matches can and exec', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    const table = tableFragment(editor);
    const target = tableRowOccurrenceTargetFrom(surface.session.revision(), {
      table,
      row: table.rows[0]!,
      rowIndex: 0,
    });
    surface.type('X');
    const cmd = { type: 'insertRow' as const, where: 'below' as const, target };
    const can = editor.can(cmd);
    expect(tableCommandToolbarState(surface, cmd).disabledReason).toBe('the table target is stale');
    expect(runTableCommand(editor, cmd)).toEqual(can);
    expect(can.ok).toBe(false);
  });

  test('resource limit refusal matches can and exec', () => {
    const cols = Array.from({ length: MAX_TABLE_COLUMNS }, () => '<w:gridCol w:w="100"/>').join('');
    const cells = Array.from(
      { length: MAX_TABLE_COLUMNS },
      (_, i) => `<w:tc>${p(`c${i}`)}</w:tc>`
    ).join('');
    const editor = mount(`<w:tbl><w:tblGrid>${cols}</w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`);
    const surface = editor.surface!;
    surface.setSelection({
      head: { paragraphId: paragraphByText(editor, 'c0'), offset: 1 },
      anchor: { paragraphId: paragraphByText(editor, 'c0'), offset: 1 },
    });
    const cmd = { type: 'insertColumn' as const, where: 'right' as const };
    const can = editor.can(cmd);
    expect(tableCommandToolbarState(surface, cmd).disabledReason).toBe(
      'the table has reached the supported size limit'
    );
    expect(runTableCommand(editor, cmd)).toEqual(can);
  });

  test('enabled insertRow runs through runTableCommand without a chrome slot', () => {
    const editor = mount(TABLE_2X2);
    const surface = editor.surface!;
    surface.setSelection({
      head: { paragraphId: paragraphByText(editor, 'A1'), offset: 1 },
      anchor: { paragraphId: paragraphByText(editor, 'A1'), offset: 1 },
    });
    const cmd = { type: 'insertRow' as const, where: 'below' as const };
    expect(tableCommandToolbarState(surface, cmd).enabled).toBe(true);
    expect(runTableCommand(editor, cmd).ok).toBe(true);
  });
});

describe('paragraph formatting answers for the whole selection, not its head', () => {
  test('a mixed selection presses no alignment button, whichever way it was dragged', () => {
    const editor = mount(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>alpha</w:t></w:r></w:p>' + p('beta')
    );

    select(editor, [0, 0], [1, 4]);
    expect(editor.snapshot().formatting?.alignment).toBeUndefined();
    // Dragging the other way used to flip the answer to `center`.
    select(editor, [1, 4], [0, 0]);
    expect(editor.snapshot().formatting?.alignment).toBeUndefined();
    for (const align of ['left', 'center', 'right', 'justify'] as const) {
      expect(editor.isActive({ type: 'setAlignment', align })).toBe(false);
    }
    for (const slot of [
      'alignment.left',
      'alignment.center',
      'alignment.right',
      'alignment.justify',
    ] as const) {
      expect(toolbarCommandState(editor, slot).active).toBe(false);
    }

    // Agreement, not absence: two paragraphs that DO agree still report their alignment.
    editor.exec({ type: 'setAlignment', align: 'center' });
    expect(editor.snapshot().formatting?.alignment).toBe('center');
    expect(editor.isActive({ type: 'setAlignment', align: 'center' })).toBe(true);
  });

  test('an absent w:jc and an explicit left are the same alignment', () => {
    const editor = mount(
      '<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>alpha</w:t></w:r></w:p>' + p('beta')
    );
    select(editor, [0, 0], [1, 4]);
    expect(editor.snapshot().formatting?.alignment).toBe('left');
  });

  test('a mixed style selection reports no style, not the head paragraph s', () => {
    const editor = mount(
      '<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>alpha</w:t></w:r></w:p>' + p('beta')
    );
    select(editor, [0, 0], [1, 4]);
    expect(editor.snapshot().formatting?.styleId).toBeUndefined();
    // Dragged the other way the head IS the styled paragraph, and the style box used to
    // claim the whole selection was Quote.
    select(editor, [1, 4], [0, 0]);
    expect(editor.snapshot().formatting?.styleId).toBeUndefined();
    select(editor, [0, 0], [0, 5]);
    expect(editor.snapshot().formatting?.styleId).toBe('Quote');
  });
});
