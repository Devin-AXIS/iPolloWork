import type { Editor, EditorExecOptions } from '../contracts/editor.ts';
import type { ImageWrapTarget } from '../contracts/editor.ts';
import type { TableChromeSlotId } from './table-chrome.ts';
import type { ObjectSlotValueMap } from './object-chrome-slots.ts';

/**
 * Value types accepted by toolbar controls. Font size uses half-points. The `shape.*` and
 * `chart.*` values are `ObjectSlotValueMap`'s. @public
 */
export interface ToolbarValueMap extends ObjectSlotValueMap {
  'font.family': string;
  'font.size': number;
  'text.color': string;
  'text.highlight': string;
  'styles.style': string;
  'list.lineSpacing': number;
  'image.wrap': ImageWrapTarget;
  'image.altText': string;
  'insert.chart': import('../contracts/chart.ts').ChartType;
  'review.editingMode': 'editing' | 'suggesting' | 'viewing';
}
/** @public */
export type ToolbarValueSlot = keyof ToolbarValueMap | TableChromeSlotId;
/** @public */
export type ToolbarSlotValue<K extends ToolbarValueSlot> = K extends keyof ToolbarValueMap
  ? ToolbarValueMap[K]
  : unknown;

/** Shared snapshot reading for value hooks. Absence represents mixed or unavailable values. */
export function toolbarFormattingValue(editor: Editor, id: string): string | undefined {
  const f = editor.snapshot().formatting;
  if (!f) return undefined;
  switch (id) {
    case 'text.color':
      return f.color?.kind === 'hex' ? f.color.value.replace(/^#/, '') : undefined;
    case 'text.highlight':
      return f.highlight;
    case 'styles.style':
      return f.styleId;
    case 'font.family':
      return f.fontFamily;
    case 'font.size':
      return f.fontSizePt === undefined ? undefined : String(f.fontSizePt * 2);
    case 'list.lineSpacing':
      return f.lineSpacing?.rule === 'multiple' ? String(f.lineSpacing.value) : undefined;
    default:
      return undefined;
  }
}

/** A command hook keeps its nullary event-handler form and accepts explicit options. @public */
export interface EditorCommandExecute {
  (): boolean;
  (options: EditorExecOptions): boolean;
}
/** Ignore framework events passed to a command used directly as an event handler. */
export function commandExecOptions(value: unknown): EditorExecOptions | undefined {
  if (!value || typeof value !== 'object' || 'preventDefault' in value) return undefined;
  return value as EditorExecOptions;
}
