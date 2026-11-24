// M6V.4 — the toolbar's icon names must all exist in the real registry.
//
// The chrome shipped with hand-authored `d` strings: approximations of Material Symbols
// that render as plausible-but-wrong glyphs, which no screenshot review reliably catches.
// The fix is to name icons and resolve them through the registry ported verbatim from the
// legacy adapter. This test pins the id → name mapping against the registry's actual
// exports, so the swap in `chrome-controls.ts` is mechanical and a typo fails here rather
// than rendering an empty box.

import { describe, expect, test } from 'bun:test';
import iconPaths from '../../vue/src/components/ui/icon-paths.json';
import { CHROME_GROUPS, chromeSlotId } from '@docx-editor.dev/core/editor';

/**
 * SLOT id → MATERIAL SYMBOL name.
 *
 * Keyed on the slot (`text.bold`), not the bare control id: control ids are only unique
 * within their group (`image.insert` / `table.insert` name different icons).
 *
 * Not the React export name (`Bold`), which is what an earlier version of this table
 * used. `scripts/extract-icons.mjs` keys Vue's generated `icon-paths.json` by the
 * Material name (`format_bold`), so that is the only key both adapters can resolve: React
 * through its component registry, Vue through the JSON. Naming the descriptor after
 * React's exports would have made the generated file unusable from the shared descriptor.
 */
const ICON_FOR_SLOT: Record<string, string> = {
  'history.undo': 'undo',
  'review.revisionMarkup': 'edit_note',
  'history.redo': 'redo',
  'text.bold': 'format_bold',
  'text.italic': 'format_italic',
  'text.underline': 'format_underlined',
  'text.strike': 'strikethrough_s',
  'script.super': 'superscript',
  'script.sub': 'subscript',
  'text.color': 'format_color_text',
  'text.highlight': 'ink_highlighter',
  'text.link': 'link',
  'format.painter': 'format_paint',
  'format.clear': 'format_clear',
  'alignment.left': 'format_align_left',
  'alignment.center': 'format_align_center',
  'alignment.right': 'format_align_right',
  'alignment.justify': 'format_align_justify',
  'direction.ltr': 'format_textdirection_l_to_r',
  'direction.rtl': 'format_textdirection_r_to_l',
  'list.lineSpacing': 'format_line_spacing',
  'list.bullet': 'format_list_bulleted',
  'list.numbered': 'format_list_numbered',
  'list.outdent': 'format_indent_decrease',
  'list.indent': 'format_indent_increase',
  'image.insert': 'image',
  'image.properties': 'tune',
  'image.editChart': 'insert_chart',
  'image.formatShape': 'format_color_fill',
  'shape.fill': 'format_color_fill',
  'shape.fillTransparency': 'visibility',
  'shape.outlineColor': 'border_color',
  'shape.outlineWidth': 'line_weight',
  'shape.outlineDash': 'horizontal_rule',
  'chart.type': 'bar_chart',
  'chart.title': 'text_rotation_none',
  'chart.legend': 'format_list_bulleted',
  'chart.dataLabels': 'pie_chart',
  'chart.axes': 'show_chart',
  'chart.gridlines': 'grid_on',
  'chart.categoryAxisTitle': 'fit_width',
  'chart.valueAxisTitle': 'height',
  'chart.seriesColor': 'format_paint',
  'chart.data': 'table_chart',
  'image.wrap': 'wrap_text',
  'table.insert': 'table',
  'table.borderTarget': 'border_all',
  'table.borderColor': 'border_color',
  'table.borderStyle': 'border_horizontal',
  'table.borderWidth': 'line_weight',
  'table.cellFill': 'format_color_fill',
  'table.mergeCells': 'call_merge',
  'table.splitCell': 'call_split',
  'insert.textBox': 'format_shapes',
  'insert.chart': 'insert_chart',
  'insert.footnote': 'superscript',
  'insert.endnote': 'edit_note',
  'insert.pageNumber': 'format_list_numbered',
  'insert.totalPages': 'format_list_numbered',
  'insert.sectionPages': 'format_list_numbered',
  'insert.pageXofY': 'format_list_numbered',
  'review.paragraphMarks': 'format_paragraph',
  'review.bookmarks': 'bookmarks',
  'review.protectDocument': 'lock',
  'review.compareDocuments': 'difference',
  'review.simpleMarkup': 'visibility',
  'review.allMarkup': 'visibility',
  'review.noMarkup': 'visibility',
  'review.original': 'visibility',
  'review.previousChange': 'keyboard_arrow_up',
  'review.nextChange': 'keyboard_arrow_down',
  'review.acceptAllChanges': 'check',
  'review.rejectAllChanges': 'close',
  'review.comments': 'comment',
  'review.addComment': 'add_comment',
  'review.authors': 'visibility',
  // The "✎ Editing ▾" mode pill's leading pencil glyph.
  'review.editingMode': 'edit_note',
  'contentControl.showAll': 'visibility',
  'contentControl.formFill': 'edit_note',
  'contentControl.inspector': 'tune',
  'contentControl.remove': 'delete',
  'file.open': 'file_upload',
  'file.save': 'file_download',
  'file.exportMarkdown': 'file_download',
  'file.exportPdf': 'file_download',
  'file.print': 'print',
  'paragraph.dialog': 'format_line_spacing',
  'file.pageSetup': 'settings',
  'insert.pageBreak': 'page_break',
  'insert.sectionBreakNextPage': 'horizontal_rule',
  'insert.sectionBreakContinuous': 'border_horizontal',
  'insert.toc': 'toc',
  'insert.bookmark': 'bookmark',
  'insert.goToBookmark': 'bookmarks',
  'insert.watermark': 'branding_watermark',
};

const INSERT_NOTE_AND_TOC_SLOTS = ['insert.footnote', 'insert.endnote', 'insert.toc'] as const;

const slotsWithControls = CHROME_GROUPS.flatMap((g) =>
  g.controls.map((c) => ({ slot: chromeSlotId(g, c), control: c }))
);

describe('legacy icon mapping (M6V.4)', () => {
  test('every mapped name resolves in the GENERATED icon paths both adapters share', () => {
    // Generated by `scripts/extract-icons.mjs` from the React registry, so this asserts
    // the descriptor, the React components, and the Vue JSON all agree on one key set.
    const table = iconPaths as Record<string, readonly string[]>;
    const missing = Object.entries(ICON_FOR_SLOT)
      .filter(([, name]) => !Array.isArray(table[name]) || table[name].length === 0)
      .map(([slot, name]) => `${slot} → ${name}`);
    expect(missing).toEqual([]);
  });

  test('every icon-bearing control has a mapping, so none is left hand-drawn', () => {
    const unmapped = slotsWithControls
      .filter(({ control, slot }) => control.paths !== null && !ICON_FOR_SLOT[slot])
      .map(({ slot }) => slot);
    expect(unmapped, 'controls still without a registry icon').toEqual([]);
  });

  test('the mapping names no slot that does not exist', () => {
    const slots = new Set<string>(slotsWithControls.map(({ slot }) => slot));
    expect(Object.keys(ICON_FOR_SLOT).filter((slot) => !slots.has(slot))).toEqual([]);
  });

  test('insert footnote, endnote and table of contents resolve to distinct icons', () => {
    const table = iconPaths as Record<string, readonly string[]>;
    const pathsBySlot = Object.fromEntries(
      INSERT_NOTE_AND_TOC_SLOTS.map((slot) => [slot, table[ICON_FOR_SLOT[slot]!]])
    );
    const serialized = INSERT_NOTE_AND_TOC_SLOTS.map((slot) => pathsBySlot[slot]!.join('|'));
    expect(new Set(serialized).size).toBe(INSERT_NOTE_AND_TOC_SLOTS.length);

    const registryPaths = INSERT_NOTE_AND_TOC_SLOTS.map((slot) => {
      const entry = slotsWithControls.find(({ slot: s }) => s === slot);
      expect(entry?.control.paths).toBeTruthy();
      return entry!.control.paths!.join('|');
    });
    expect(new Set(registryPaths).size).toBe(INSERT_NOTE_AND_TOC_SLOTS.length);
  });
});
