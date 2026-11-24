// The compound toolbar's public surface.

export {
  DocxEditorToolbar,
  type DocxEditorToolbarNamespace,
  type DocxEditorToolbarProps,
} from './DocxEditorToolbar';
export { ToolbarButton, type ToolbarButtonProps } from './ToolbarButton';
export { ToolbarAction, type ToolbarActionProps } from './ToolbarAction';
export { type DocxEditorToolbarGroupProps, type DocxEditorToolbarSlotProps } from './ToolbarGroup';
export {
  ToolbarSeparator,
  type ToolbarPartComponent,
  type ToolbarPartProps,
  type ToolbarSeparatorProps,
  type ToolbarSlotPartComponent,
  type ToolbarSlotPartProps,
} from './parts';
export {
  useFontFamily,
  type FontFamilyItemProps,
  type FontFamilyNamespace,
  type FontFamilyPartProps,
  type FontFamilyProps,
  type UseFontFamilyResult,
} from './FontFamily';
export {
  useParagraphStyle,
  type ParagraphStyleItemProps,
  type ParagraphStyleNamespace,
  type ParagraphStyleOption,
  type ParagraphStylePartProps,
  type ParagraphStyleProps,
  type UseParagraphStyleResult,
} from './ParagraphStyle';
export { ToolbarAlignment, type ToolbarAlignmentComponent } from './Alignment';
export {
  ToolbarTableBorderColor,
  ToolbarTableBorderStyle,
  ToolbarTableBorderTarget,
  ToolbarTableBorderWidth,
  ToolbarTableCellFill,
  useTableBorderTargetLabel,
  type TableBorderColorNamespace,
  type TableBorderStyleNamespace,
  type TableBorderTargetNamespace,
  type TableBorderWidthNamespace,
  type TableCellFillNamespace,
  type TableChromeItemProps,
  type TableChromePartComponent,
  type TableChromePartProps,
} from './TableControls';
export { TableChromeProvider } from './useTableChrome';
export { ToolbarTableMergeCells, ToolbarTableSplitCell } from './TableCellStructure';
export type { ToolbarTranslate } from './toolbar-context';
export type { ToolbarReviewersProps } from './Reviewers';
export {
  ToolbarContentControlShowAll,
  ToolbarContentControlFormFill,
  ToolbarContentControlInspector,
  ToolbarContentControlRemove,
} from './ContentControlParts';
