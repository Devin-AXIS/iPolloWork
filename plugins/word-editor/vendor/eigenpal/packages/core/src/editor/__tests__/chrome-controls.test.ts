// Legacy chrome descriptor contract (interactive-paginated-editing M6V.1).
//
// M6V.1 is a visual-parity gate whose first rule is easy to break silently: every
// legacy control must remain PRESENT, because a dropped control understates the parity
// gap. Its second rule — which controls may ACT — is no longer the descriptor's to
// state: enabled state is `Editor.can`'s answer, so the descriptor only says HOW a
// control reaches the engine, and the assertions below hold it to the command table
// rather than to a pinned list of "permitted" controls. Both adapters render from this
// descriptor, so asserting it here covers React and Vue at once.
//
// The slot-id vocabulary (`${groupId}.${controlId}`) is public API forever; the
// pinned lists below are the breaking-change tripwire.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHROME_GROUPS,
  CHROME_MENUS,
  CHROME_UNAVAILABLE_KEY,
  chromeControlCount,
  chromeMenuSlots,
  chromeSlotId,
  defaultChromeGroups,
  formattingBarChromeGroups,
  type ChromeMenuEntry,
  type ChromeSlotId,
} from '../chrome-controls.ts';
import {
  chromeProbeForSlot,
  commandForSlot,
  commandForSlotValue,
  toolbarCommandState,
} from '../toolbar-commands.ts';

/**
 * The toolbar groups in the chrome spec's bar order: history, zoom, styles, font,
 * then the text group carrying colour and highlight (B I U S · A · pen · link),
 * script, the merged-rendering alignment group, the list group carrying line
 * spacing, standalone clear, the trailing review controls, content-control
 * authoring chrome — with the contextual image/table/file/insert groups (not in
 * the default bar) closing the registry.
 */
const EXPECTED_GROUPS = [
  'history',
  'zoom',
  'styles',
  'font',
  'text',
  'script',
  'alignment',
  'direction',
  'list',
  'format',
  'review',
  'contentControl',
  'image',
  'shape',
  'chart',
  'table',
  'paragraph',
  'file',
  'insert',
];

/** THE public slot taxonomy. A change here is a breaking API change — rename knowingly. */
const EXPECTED_SLOTS: readonly ChromeSlotId[] = [
  'history.undo',
  'history.redo',
  'zoom.level',
  'styles.style',
  'font.family',
  'font.size',
  'text.bold',
  'text.italic',
  'text.underline',
  'text.strike',
  'text.color',
  'text.highlight',
  'text.link',
  'script.super',
  'script.sub',
  'alignment.left',
  'alignment.center',
  'alignment.right',
  'alignment.justify',
  'direction.ltr',
  'direction.rtl',
  'list.bullet',
  'list.numbered',
  'list.outdent',
  'list.indent',
  'list.lineSpacing',
  'format.painter',
  'format.clear',
  'review.revisionMarkup',
  'review.simpleMarkup',
  'review.allMarkup',
  'review.noMarkup',
  'review.original',
  'review.previousChange',
  'review.nextChange',
  'review.acceptAllChanges',
  'review.rejectAllChanges',
  'review.paragraphMarks',
  'review.bookmarks',
  'review.protectDocument',
  'review.compareDocuments',
  'review.comments',
  'review.addComment',
  'review.authors',
  'review.editingMode',
  'contentControl.showAll',
  'contentControl.formFill',
  'contentControl.inspector',
  'contentControl.remove',
  'image.insert',
  'image.properties',
  'image.editChart',
  'image.formatShape',
  'image.wrap',
  'image.altText',
  'shape.fill',
  'shape.fillTransparency',
  'shape.outlineColor',
  'shape.outlineWidth',
  'shape.outlineDash',
  'chart.type',
  'chart.title',
  'chart.legend',
  'chart.dataLabels',
  'chart.axes',
  'chart.gridlines',
  'chart.categoryAxisTitle',
  'chart.valueAxisTitle',
  'chart.seriesColor',
  'chart.data',
  'table.insert',
  'table.borderTarget',
  'table.borderColor',
  'table.borderStyle',
  'table.borderWidth',
  'table.cellFill',
  'table.mergeCells',
  'table.splitCell',
  'paragraph.dialog',
  'file.open',
  'file.save',
  'file.exportMarkdown',
  'file.exportPdf',
  'file.print',
  'file.pageSetup',
  'insert.textBox',
  'insert.chart',
  'insert.footnote',
  'insert.endnote',
  'insert.pageNumber',
  'insert.totalPages',
  'insert.sectionPages',
  'insert.pageXofY',
  'insert.pageBreak',
  'insert.sectionBreakNextPage',
  'insert.sectionBreakContinuous',
  'insert.toc',
  'insert.bookmark',
  'insert.goToBookmark',
  'insert.watermark',
];

const allSlots = (): ChromeSlotId[] =>
  CHROME_GROUPS.flatMap((g) => g.controls.map((c) => chromeSlotId(g, c)));

describe('legacy chrome descriptor', () => {
  test('carries every legacy toolbar group, in legacy order', () => {
    expect(CHROME_GROUPS.map((g) => g.id)).toEqual(EXPECTED_GROUPS);
  });

  test('the slot taxonomy is exactly the pinned public vocabulary, in order', () => {
    expect(allSlots()).toEqual([...EXPECTED_SLOTS]);
  });

  test('every slot the engine wires is declared as a command, and only save may save', () => {
    const commandSlots = CHROME_GROUPS.flatMap((g) =>
      g.controls.filter((c) => c.state.kind === 'command').map((c) => chromeSlotId(g, c))
    );
    // The descriptor may not UNDER-claim: a slot the command table wires must be
    // declared 'command', or an adapter that trusts the descriptor renders a working
    // command permanently disabled — which is exactly what Vue did for twelve slots
    // while React ran them.
    for (const slot of allSlots()) {
      if (commandForSlot(slot) === null) continue;
      expect(commandSlots, `${slot} is wired but not declared a command`).toContain(slot);
    }

    const saves = CHROME_GROUPS.flatMap((g) => g.controls.filter((c) => c.state.kind === 'save'));
    expect(saves).toHaveLength(1);
  });

  test('the value-typed slots are declared as values, not commands', () => {
    // These take a PICKED value through `commandForSlotValue`; there is no fixed
    // command to hand `Editor.can`, so a bare click has nothing to send and chrome must
    // produce a value first.
    const valueSlots = CHROME_GROUPS.flatMap((g) =>
      g.controls.filter((c) => c.state.kind === 'value').map((c) => chromeSlotId(g, c))
    );
    expect([...valueSlots].sort()).toEqual([
      'chart.categoryAxisTitle',
      'chart.data',
      'chart.legend',
      'chart.seriesColor',
      'chart.title',
      'chart.type',
      'chart.valueAxisTitle',
      'font.family',
      'font.size',
      'image.altText',
      'image.wrap',
      'insert.chart',
      'shape.fill',
      'shape.fillTransparency',
      'shape.outlineColor',
      'shape.outlineDash',
      'shape.outlineWidth',
      'styles.style',
      'table.borderColor',
      'table.borderStyle',
      'table.borderTarget',
      'table.borderWidth',
      'table.cellFill',
      'text.color',
      'text.highlight',
    ]);
    for (const slot of valueSlots) {
      expect(commandForSlot(slot)).toBeNull();
      if (slot.startsWith('table.')) {
        const probe =
          slot === 'table.borderTarget'
            ? 'all'
            : slot === 'table.borderStyle'
              ? 'single'
              : slot === 'table.borderWidth'
                ? 8
                : slot === 'table.cellFill'
                  ? { kind: 'hex', value: 'FF0000' }
                  : { kind: 'hex', value: '000000' };
        expect(commandForSlotValue(slot, probe)).not.toBeNull();
        continue;
      }
      const objectSamples: Record<string, unknown> = {
        'chart.categoryAxisTitle': 'Month',
        'chart.data': { kind: 'category', categories: [{ label: 'A' }], series: [] },
        'chart.legend': 'top',
        'chart.seriesColor': { index: 0, color: 'accent2' },
        'chart.title': 'Sales',
        'chart.type': 'line',
        'chart.valueAxisTitle': 'Units',
        'shape.fill': 'accent1:40',
        'shape.fillTransparency': 25,
        'shape.outlineColor': '#1F3864',
        'shape.outlineDash': 'dash',
        'shape.outlineWidth': 2.25,
      };
      if (slot in objectSamples) {
        expect(commandForSlotValue(slot, objectSamples[slot])).not.toBeNull();
        continue;
      }
      const sample =
        slot === 'image.wrap'
          ? 'square'
          : slot === 'image.altText'
            ? 'Accessible label'
            : slot === 'insert.chart'
              ? 'pie'
              : 'Arial';
      expect(commandForSlotValue(slot, sample)).not.toBeNull();
    }
  });

  test('underline is wired, and the descriptor says so', () => {
    // The regression this pins: underline carried a "permanently disabled" descriptor
    // long after `commandForSlot('text.underline')` started answering. A registry
    // constant cannot be a second, staler answer to what `Editor.can` decides.
    const underline = CHROME_GROUPS.flatMap((g) => g.controls).find((c) => c.id === 'underline');
    expect(underline).toBeDefined();
    expect(underline!.state.kind).toBe('command');
    expect(commandForSlot('text.underline')).not.toBeNull();
  });

  test('the script controls name no keyboard chord, because React zoom owns that one', () => {
    // `formattingBar.subscriptShortcut` / `...superscriptShortcut` render as
    // "Subscript (Ctrl+=)" / "Superscript (Ctrl+Shift+=)". React's live zoom claims Ctrl/Cmd
    // `=` and its shifted spelling, so those tooltips would tell a React user to press a chord
    // that zooms instead. The plain keys are true in every host; both toggles stay reachable
    // from the button the tooltip is on, and the engine keymap still binds the chord for hosts
    // that mount no zoom handler.
    const script = CHROME_GROUPS.find((group) => group.id === 'script')!;
    expect(script.controls.map((control) => control.labelKey)).toEqual([
      'formattingBar.superscript',
      'formattingBar.subscript',
    ]);
  });

  test('every control has a label key and no control hardcodes English', () => {
    for (const group of CHROME_GROUPS) {
      expect(group.labelKey).toMatch(/^[a-z][a-zA-Z]*\./);
      for (const c of group.controls) {
        expect(c.labelKey, `${c.id} labelKey`).toMatch(/^[a-z][a-zA-Z]*\./);
        // A key, never a display string: keys have no spaces.
        expect(c.labelKey).not.toContain(' ');
        if (c.valueKey) expect(c.valueKey).not.toContain(' ');
      }
    }
    expect(CHROME_UNAVAILABLE_KEY).toBe('formattingBar.unavailableInPreview');
  });

  test('slot ids are unique, so a testid cannot collide', () => {
    // Control ids alone are NOT globally unique (`image.insert` / `table.insert`);
    // uniqueness — and every consumer key — lives at the slot level.
    const slots = allSlots();
    expect(new Set(slots).size).toBe(slots.length);
  });

  test('control ids are unique within their group', () => {
    for (const group of CHROME_GROUPS) {
      const ids = group.controls.map((c) => c.id);
      expect(new Set(ids).size, `group ${group.id}`).toBe(ids.length);
    }
  });

  test('ids are short lowercaseCamel and never repeat their group name', () => {
    for (const group of CHROME_GROUPS) {
      expect(group.id).toMatch(/^[a-z][a-zA-Z]*$/);
      for (const c of group.controls) {
        expect(c.id, `${group.id}.${c.id}`).toMatch(/^[a-z][a-zA-Z]*$/);
        expect(
          c.id.toLowerCase().includes(group.id.toLowerCase()),
          `${group.id}.${c.id} repeats its group name`
        ).toBe(false);
      }
    }
  });

  test('icon controls carry at least one path, pickers carry none', () => {
    for (const c of CHROME_GROUPS.flatMap((g) => g.controls)) {
      if (c.paths === null) {
        // A picker must say what value it displays, or it renders as an empty box.
        expect(c.valueKey, `${c.id} needs a valueKey`).toBeDefined();
        continue;
      }
      expect(c.paths.length, `${c.id} paths`).toBeGreaterThan(0);
      for (const d of c.paths) {
        // Material Symbols path data, lifted verbatim from the reference commit.
        // A truncated or retyped path is a silent visual regression.
        expect(d.length, `${c.id} path length`).toBeGreaterThan(20);
        expect(d).toMatch(/^[Mm]/);
      }
    }
  });

  test('every control label is a NAME, not an instruction', () => {
    // A registry label is the button's `aria-label`, its `title`, AND the overflow panel's
    // visible row text — three places a sentence does not belong. The longest packaged label
    // names the control and its chord ("Format painter (Ctrl+Alt+C, Ctrl+Alt+V)"); anything
    // materially longer is prose, and prose belongs in the docs.
    const catalogue = JSON.parse(
      readFileSync(resolve(import.meta.dir, '../../../../i18n/en.json'), 'utf8')
    ) as Record<string, Record<string, unknown>>;
    const resolve_ = (key: string): string => {
      let node: unknown = catalogue;
      for (const part of key.split('.')) {
        node = (node as Record<string, unknown> | undefined)?.[part];
      }
      return typeof node === 'string' ? node : '';
    };
    for (const group of CHROME_GROUPS) {
      for (const control of group.controls) {
        const label = resolve_(control.labelKey);
        expect(label, `${chromeSlotId(group, control)} label`).not.toBe('');
        expect(
          label.length,
          `${chromeSlotId(group, control)} label is ${label.length} characters: "${label}"`
        ).toBeLessThanOrEqual(48);
      }
    }
  });

  test('the count is stable, so a dropped control fails rather than passing quietly', () => {
    expect(chromeControlCount()).toBe(100);
  });

  test('the table group is contextual and carries border, fill, merge, and split slots', () => {
    const table = CHROME_GROUPS.find((g) => g.id === 'table');
    expect(table?.contextual).toBe(true);
    const slots = table!.controls.map((c) => chromeSlotId(table!, c));
    expect(slots).toEqual([
      'table.insert',
      'table.borderTarget',
      'table.borderColor',
      'table.borderStyle',
      'table.borderWidth',
      'table.cellFill',
      'table.mergeCells',
      'table.splitCell',
    ]);
    for (const slot of slots.slice(1, 6)) {
      expect(commandForSlot(slot as ChromeSlotId)).toBeNull();
    }
    expect(commandForSlot('table.mergeCells')).toEqual({ type: 'mergeCells' });
    // Split takes its counts from a dialog, so only a probe stands behind it.
    expect(commandForSlot('table.splitCell')).toBeNull();
  });

  test('the image group carries insert, properties, editChart, formatShape, wrap, and altText', () => {
    const image = CHROME_GROUPS.find((g) => g.id === 'image');
    expect(image).toBeDefined();
    expect(image!.contextual).toBe(true);
    expect(image!.controls.map((c) => c.id)).toEqual([
      'insert',
      'properties',
      'editChart',
      'formatShape',
      'wrap',
      'altText',
    ]);
    expect(image!.controls.map((c) => c.state.kind)).toEqual([
      'command',
      'command',
      'command',
      'command',
      'value',
      'value',
    ]);
    expect(image!.controls.find((c) => c.id === 'wrap')!.shape).toBe('dropdown');
    expect(commandForSlot('image.insert')).toBeNull();
    expect(commandForSlot('image.properties')).toBeNull();
    expect(commandForSlot('image.wrap')).toBeNull();
    expect(commandForSlot('image.altText')).toBeNull();
  });

  test('formatting bar includes the image group only when a drawing is selected', () => {
    const withoutImage = formattingBarChromeGroups(null);
    expect(withoutImage.map((g) => g.id)).toEqual(defaultChromeGroups().map((g) => g.id));
    expect(withoutImage.some((g) => g.id === 'image')).toBe(false);

    const withImage = formattingBarChromeGroups({
      id: 'd1',
    } as Parameters<typeof formattingBarChromeGroups>[0]);
    expect(withImage.map((g) => g.id)).toEqual([
      ...defaultChromeGroups().map((g) => g.id),
      'image',
    ]);
  });

  test('the packaged Insert menu places image.insert', () => {
    // The row shares its slot with `DocxEditor.Toolbar.ImageInsert`, so both routes keep
    // one label, one icon and one enabled state. Asserted here so removing the row is a
    // deliberate edit, not a drift.
    expect(chromeMenuSlots()).toContain('image.insert');
    expect(allSlots()).toContain('image.insert');
  });

  test('the menu region carries the chrome menus, in bar order', () => {
    expect(CHROME_MENUS.map((m) => m.id)).toEqual(['file', 'format', 'insert', 'review', 'help']);
  });

  test('review authors stays composable without crowding the default toolbar', () => {
    const defaults = defaultChromeGroups().flatMap((group) =>
      group.controls.map((control) => chromeSlotId(group, control))
    );
    expect(defaults).not.toContain('review.authors');
    expect(defaults).not.toContain('review.paragraphMarks');
    expect(chromeMenuSlots()).toContain('review.paragraphMarks');
    expect(allSlots()).toContain('review.authors');
  });

  test('every menu row names a real slot, so a menu cannot describe a control twice', () => {
    // The whole point of arrangement-over-slots: a row's label, icon, command and enabled
    // state come from the registry entry it names. A slot that does not exist would leave
    // the row unlabelled and its enabled state unanswerable.
    const slots = new Set<string>(allSlots());
    for (const slot of chromeMenuSlots()) {
      expect(slots, `menu row ${slot}`).toContain(slot);
    }
  });

  test('menu rows are unique, so no capability appears twice in the bar', () => {
    const rows = chromeMenuSlots();
    expect(new Set(rows).size).toBe(rows.length);
  });

  test('submenu parents carry a label key and an icon, never a slot', () => {
    // A parent row opens a panel; it has no command, so giving it a slot would mint a
    // public id for a control `Editor.can` could never answer about.
    const walk = (entries: readonly ChromeMenuEntry[]): void => {
      for (const entry of entries) {
        if (entry.kind !== 'submenu') continue;
        expect(entry.labelKey).toMatch(/^[a-z][a-zA-Z]*\./);
        expect(entry.labelKey).not.toContain(' ');
        expect(entry.paths?.length ?? 0).toBeGreaterThan(0);
        expect(entry.items.length).toBeGreaterThan(0);
        walk(entry.items);
      }
    };
    for (const menu of CHROME_MENUS) walk(menu.entries);
  });

  test('the File menu offers open, save, print and page setup', () => {
    const file = CHROME_MENUS.find((m) => m.id === 'file');
    expect(file).toBeDefined();
    const rows = file!.entries.flatMap((e) => (e.kind === 'item' ? [e.slot] : []));
    expect(rows).toEqual(['file.open', 'file.save', 'file.print', 'file.pageSetup']);
    const print = file!.entries.find((e) => e.kind === 'item' && e.slot === 'file.print');
    expect(print).toMatchObject({ shortcutKey: 'toolbar.printShortcut' });
  });

  test('the Insert menu reaches all three break kinds the engine wires', () => {
    // Word's three break choices are three live commands. The two section kinds are
    // separate `insertBreak` kinds, not one command with a flag, so a host reading the
    // registry dispatches each without knowing what a `w:type` is.
    expect(commandForSlot('insert.pageBreak')).toEqual({ type: 'insertBreak', kind: 'page' });
    expect(commandForSlot('insert.sectionBreakNextPage')).toEqual({
      type: 'insertBreak',
      kind: 'section',
    });
    expect(commandForSlot('insert.sectionBreakContinuous')).toEqual({
      type: 'insertBreak',
      kind: 'sectionContinuous',
    });
  });

  test('open and save each report which of the two they are missing', () => {
    // Both capabilities EXIST — what neither has is a command. Reporting the generic "not
    // wired to an editor command" would tell a host the capability is missing.
    expect(toolbarCommandState(null, 'file.open').disabledReason).toBe('editor is not ready');
    const stub = {
      can: () => ({ ok: false as const, code: 'unsupported' as const, reason: 'no' }),
      exec: () => ({ ok: false as const, code: 'unsupported' as const, reason: 'no' }),
    } as unknown as Parameters<typeof toolbarCommandState>[0];
    expect(toolbarCommandState(stub, 'file.open').disabledReason).toContain('editor.load(bytes)');
    expect(toolbarCommandState(stub, 'file.save').disabledReason).toContain('runSave(editor)');
  });

  test('page setup is probe-driven, like the link control', () => {
    // The dialog supplies the values, so there is no fixed command — but the capability is
    // real, and the probe is how chrome that owns a dialog asks whether it is honoured.
    expect(commandForSlot('file.pageSetup')).toBeNull();
    expect(chromeProbeForSlot('file.pageSetup')).toEqual({
      type: 'setPageSetup',
      orientation: 'portrait',
    });
  });

  test('the watermark row is probe-driven and sits in the Insert menu', () => {
    expect(commandForSlot('insert.watermark')).toBeNull();
    expect(chromeProbeForSlot('insert.watermark')).toEqual({
      type: 'setWatermark',
      watermark: { text: 'DRAFT' },
    });
    const insert = CHROME_MENUS.find((m) => m.id === 'insert');
    const rows = insert!.entries.flatMap((e) => (e.kind === 'item' ? [e.slot] : []));
    expect(rows).toContain('insert.watermark');
  });
});
