import { GENERATED_ICON_PATHS } from './generated-icon-paths.ts';

export const INSERT_CHROME_GROUP = {
  // The Insert menu's own controls: the ones that are not already slots elsewhere.
  // Image and table insertion live in the `image` and `table` groups above and are
  // REFERENCED by the Insert menu rather than duplicated here — a slot is one control,
  // and the menu is an arrangement over slots, not a second registry.
  id: 'insert',
  labelKey: 'toolbar.insert',
  contextual: true,
  controls: [
    {
      id: 'textBox',
      labelKey: 'toolbar.insertTextBox',
      paths: GENERATED_ICON_PATHS['format_shapes'],
      state: { kind: 'command' },
    },
    {
      // A dropdown of chart types; the adapters list `CHART_TYPE_CHOICES` and run `insertChart`.
      id: 'chart',
      shape: 'dropdown',
      labelKey: 'chart.insert',
      paths: GENERATED_ICON_PATHS['insert_chart'],
      valueKey: 'chart.insert',
      state: { kind: 'value' },
    },
    {
      id: 'footnote',
      labelKey: 'toolbar.insertFootnote',
      paths: GENERATED_ICON_PATHS['superscript'],
      state: { kind: 'command' },
    },
    {
      id: 'endnote',
      labelKey: 'toolbar.insertEndnote',
      paths: GENERATED_ICON_PATHS['edit_note'],
      state: { kind: 'command' },
    },
    {
      id: 'pageNumber',
      labelKey: 'headerFooter.insertPageNumber',
      paths: GENERATED_ICON_PATHS['format_list_numbered'],
      state: { kind: 'command' },
    },
    {
      id: 'totalPages',
      labelKey: 'headerFooter.insertTotalPages',
      paths: GENERATED_ICON_PATHS['format_list_numbered'],
      state: { kind: 'command' },
    },
    {
      id: 'sectionPages',
      labelKey: 'headerFooter.insertSectionPages',
      paths: GENERATED_ICON_PATHS['format_list_numbered'],
      state: { kind: 'command' },
    },
    {
      id: 'pageXofY',
      labelKey: 'headerFooter.insertPageXofY',
      paths: GENERATED_ICON_PATHS['format_list_numbered'],
      state: { kind: 'command' },
    },
    {
      id: 'pageBreak',
      labelKey: 'toolbar.pageBreak',
      paths: GENERATED_ICON_PATHS['page_break'],
      state: { kind: 'command' },
    },
    {
      id: 'sectionBreakNextPage',
      labelKey: 'toolbar.sectionBreakNextPage',
      paths: GENERATED_ICON_PATHS['horizontal_rule'],
      state: { kind: 'command' },
    },
    {
      // The section that starts here keeps the sheet the previous one ended, which is
      // how Word authors a mid-page column or margin change.
      id: 'sectionBreakContinuous',
      labelKey: 'toolbar.sectionBreakContinuous',
      paths: GENERATED_ICON_PATHS['border_horizontal'],
      state: { kind: 'command' },
    },
    {
      id: 'toc',
      labelKey: 'toolbar.tableOfContents',
      paths: GENERATED_ICON_PATHS['toc'],
      state: { kind: 'command' },
    },
    {
      // Opens the Bookmark dialog; the dialog supplies the name.
      id: 'bookmark',
      labelKey: 'toolbar.bookmark',
      paths: GENERATED_ICON_PATHS['bookmark'],
      state: { kind: 'command' },
    },
    {
      // Opens Go To on bookmarks (the Go to tab of the navigation pane).
      id: 'goToBookmark',
      labelKey: 'toolbar.goToBookmark',
      paths: GENERATED_ICON_PATHS['bookmarks'],
      state: { kind: 'command' },
    },
    {
      // Opens the Watermark dialog; the dialog supplies the command's values.
      id: 'watermark',
      labelKey: 'toolbar.watermark',
      paths: GENERATED_ICON_PATHS['branding_watermark'],
      state: { kind: 'command' },
    },
  ],
} as const;
