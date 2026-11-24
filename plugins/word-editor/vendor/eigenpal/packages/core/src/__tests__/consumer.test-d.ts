/**
 * Consumer-side type test.
 *
 * The package typechecking on its own proves only that the declarations are
 * internally consistent. It does not prove a consumer can construct a command,
 * read a query result, or narrow a result. Every check below is written the way
 * an adapter would write it, and each one caught a real defect when added.
 */

import type { ApplyResult, DocEdit, DocQueryResults } from '../index';
import {
  type Editor,
  type EditorCommand,
  type EditorSnapshot,
  type TableColumnDividerResizeTarget,
  type TableColumnOccurrenceTarget,
  type TableRightEdgeResizeTarget,
  type TableRowOccurrenceTarget,
} from '../contracts/editor';
import { type SemanticTarget } from '../contracts/interaction';
import type { DocAnchor, DocxDocument } from '../contracts/types';

// A no-arg command must be constructible. `Record<string, never>` made this
// impossible: the `type` discriminant collided with the index signature.
const undoCmd: EditorCommand = { type: 'undo' };
const redoCmd: EditorCommand = { type: 'redo' };
const deleteRowCmd: EditorCommand = { type: 'deleteRow' };
const clearFill: EditorCommand = { type: 'setCellFill', color: null };
const dottedBorders: EditorCommand = {
  type: 'setTableBorders',
  scope: 'inside',
  spec: { style: 'dotted', size: 8, color: { kind: 'hex', value: '336699' } },
};
const clearBorders: EditorCommand = { type: 'setTableBorders', scope: 'none', target: 'top' };
// @ts-expect-error none scope requires the active edge target
const clearBordersWithoutTarget: EditorCommand = { type: 'setTableBorders', scope: 'none' };

// @ts-expect-error concrete border scopes require a complete spec
const bordersWithoutSpec: EditorCommand = { type: 'setTableBorders', scope: 'inside' };

const noneWithSpec: EditorCommand = {
  type: 'setTableBorders',
  scope: 'none',
  target: 'top',
  // @ts-expect-error none scope must not carry a spec
  spec: { style: 'dotted', size: 8, color: { kind: 'hex', value: '336699' } },
};

const invalidStyleBorders: EditorCommand = {
  type: 'setTableBorders',
  scope: 'top',
  spec: {
    // @ts-expect-error border style must be allowlisted
    style: 'groove',
    size: 8,
    color: { kind: 'hex', value: '336699' },
  },
};

// Commands with arguments.
const boldCmd: EditorCommand = { type: 'toggleMark', mark: 'bold' };
const tableCmd: EditorCommand = { type: 'insertTable', rows: 3, cols: 4 };

const rowTarget: TableRowOccurrenceTarget = {
  sourceRevision: 1,
  tableId: 'tbl-1',
  rowId: 'row-1',
  isHeaderRepeat: false,
};
const columnTarget: TableColumnOccurrenceTarget = {
  sourceRevision: 1,
  tableId: 'tbl-1',
  gridColumnId: 'col-1',
  isHeaderRepeat: true,
};
const dividerTarget: TableColumnDividerResizeTarget = {
  sourceRevision: 2,
  tableId: 'tbl-1',
  leftGridColumnId: 'col-a',
  rightGridColumnId: 'col-b',
  isHeaderRepeat: false,
};
const rightEdgeTarget: TableRightEdgeResizeTarget = {
  sourceRevision: 2,
  tableId: 'tbl-1',
  gridColumnId: 'col-last',
  isHeaderRepeat: true,
};

const insertRowWithTarget: EditorCommand = { type: 'insertRow', where: 'below', target: rowTarget };
const deleteColumnWithTarget: EditorCommand = { type: 'deleteColumn', target: columnTarget };
const dividerResize: EditorCommand = {
  type: 'commitTableColumnDividerResize',
  target: dividerTarget,
  leftWidthTwips: 2400,
  rightWidthTwips: 3600,
};
const rightEdgeResize: EditorCommand = {
  type: 'commitTableRightEdgeResize',
  target: rightEdgeTarget,
  columnWidthTwips: 3600,
  tableWidthTwips: 6000,
};

// @ts-expect-error occurrence targets require isHeaderRepeat
const rowTargetMissingRepeat: TableRowOccurrenceTarget = {
  sourceRevision: 1,
  tableId: 'tbl-1',
  rowId: 'row-1',
};

// @ts-expect-error divider resize targets require isHeaderRepeat
const dividerTargetMissingRepeat: TableColumnDividerResizeTarget = {
  sourceRevision: 2,
  tableId: 'tbl-1',
  leftGridColumnId: 'col-a',
  rightGridColumnId: 'col-b',
};

// @ts-expect-error right-edge resize targets require isHeaderRepeat
const rightEdgeTargetMissingRepeat: TableRightEdgeResizeTarget = {
  sourceRevision: 2,
  tableId: 'tbl-1',
  gridColumnId: 'col-last',
};

// Declaration-only public entries must resolve for a consumer without exposing
// any ProseMirror-facing types.
//
// The plugin and MCP contracts that used to be exercised here were deleted rather than
// implemented. Every function in them threw, `coreTools` was an `export declare const`
// with nothing behind it — so a consumer importing it got a binding that does not exist
// at runtime — and the active change defers extensions and MCP to a separately specified
// contract. `EditorModule` is the seam a capability actually arrives through, and it says
// so: the shape is closed on purpose.
declare const target: SemanticTarget;
void target;

// Every form `can()` says it accepts must be CONSTRUCTIBLE without a cast, and nothing else
// should be. Both adapter call sites and the facade's own test used to write
// `{ anchor, head } as never` against a union that named a `SemanticTarget` the engine
// refuses and omitted the paragraph-id form it honours — the cast was load-bearing, which is
// how the contract stayed wrong. These four lines are the gate in
// `editor/docx-editor-support.ts`, spelled as types.
const semanticCaret: EditorCommand = {
  type: 'setSelection',
  range: { anchor: { paragraphId: 'p1', offset: 0 }, head: { paragraphId: 'p1', offset: 0 } },
};
const semanticRange: EditorCommand = {
  type: 'setSelection',
  range: { anchor: { paragraphId: 'p1', offset: 1 }, head: { paragraphId: 'p2', offset: 4 } },
};
const anchorRange: EditorCommand = {
  type: 'setSelection',
  range: { from: { paraId: 'A1B2C3D4' }, to: { paraId: 'E5F6A7B8' } },
};
const collapsedAnchor: EditorCommand = { type: 'setSelection', anchor: { paraId: 'A1B2C3D4' } };

const mixedEndpoints: EditorCommand = {
  type: 'setSelection',
  // @ts-expect-error the two endpoint vocabularies do not mix; `can()` refuses this pair
  range: { from: { paraId: 'A1B2C3D4' }, to: { paragraphId: 'p2', offset: 0 } },
};

void semanticCaret;
void semanticRange;
void anchorRange;
void collapsedAnchor;
void mixedEndpoints;

export function exercise(editor: Editor, doc: DocxDocument): void {
  // Writes return a result that narrows.
  const result = editor.exec(boldCmd);
  if (result.ok) {
    const changed: boolean = result.changed;
    void changed;
  } else {
    const code: string = result.code;
    void code;
  }

  // `can` is a dry run and must not report `changed`.
  const dry = editor.can(tableCmd);
  if (dry.ok) {
    // @ts-expect-error a dry run changes nothing, so `changed` must not exist
    void dry.changed;
  }

  // Query results must be typed per query, not `unknown`.
  const text: string = editor.query({ type: 'selectedText' });
  const inToc: boolean = editor.query({ type: 'isInsideToc', pos: 0 });
  const table = editor.query({ type: 'tableContext' });
  const rows: number | undefined = table?.rows;
  void text;
  void inToc;
  void rows;

  // Snapshot payloads must carry real shapes.
  const snap: EditorSnapshot = editor.snapshot();
  const bold: boolean | undefined = snap.formatting?.bold;
  void bold;

  // Geometry: ONE member, and it is typed without exposing an editing engine's positions.
  // The interaction/hit-test/caret-rect cluster that used to be exercised here was deleted
  // rather than implemented — every member was a stub with no caller, and a stub whose empty
  // answer is indistinguishable from a real one is worse than an absent member.
  const pages = editor.getPageGeometry();
  const pageIndex: number | undefined = pages[0]?.index;
  const pageWidth: number | undefined = pages[0]?.box.width;
  const textLeft: number | undefined = pages[0]?.contentBox.x;
  void pageIndex;
  void pageWidth;
  void textLeft;

  const focus = editor.focus();
  if (focus.ok) {
    void focus.value;
  } else {
    const focusCode: string = focus.code;
    void focusCode;
  }

  // Document-layer query results are readable without narrowing by hand.
  const paras: DocQueryResults['paragraphs'] = [{ text: 'hello' }];
  const first: string | undefined = paras[0]?.text;
  void first;

  // An edit must be CONSTRUCTIBLE from the vocabulary: `type` has to narrow the
  // rest of the shape, or a consumer cannot write one down without a cast.
  const anchor: DocAnchor = { paraId: 'A1B2C3D4', search: 'hello' };
  const edits: DocEdit[] = [{ type: 'insertText', target: anchor, text: 'x' }];
  void edits;

  // And a batch result is one entry per edit, positionally aligned.
  const applied: Pick<ApplyResult, 'results'> = { results: [] };
  const n: number = applied.results.length;
  void n;

  void doc;

  void undoCmd;
  void redoCmd;
  void deleteRowCmd;
  void clearFill;
  void dottedBorders;
  void clearBorders;
  void clearBordersWithoutTarget;
  void bordersWithoutSpec;
  void noneWithSpec;
  void invalidStyleBorders;
  void insertRowWithTarget;
  void deleteColumnWithTarget;
  void dividerResize;
  void rightEdgeResize;
  void rowTargetMissingRepeat;
  void dividerTargetMissingRepeat;
  void rightEdgeTargetMissingRepeat;
}
