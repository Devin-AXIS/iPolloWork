// The insert-table size grid, shared by the menu bar's Insert › Table row and the toolbar's
// table part. One grid, so the two places cannot disagree about size, keys, or naming.

import type { ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorCommand } from '../useEditorCommand';
import { guardToolbarMousedown } from './ToolbarButton';

/** The insert-table grid is 6 columns by 6 rows. */
export const TABLE_GRID_COLUMNS = 6;
export const TABLE_GRID_ROWS = 6;

export interface TableSizeGridProps {
  /** The slot whose enabled state gates the insert. */
  readonly slot: ChromeSlotId;
  /** Accessible name of the grid. */
  readonly label: string;
  /** Runs after a table is inserted, to close the surrounding popup. */
  readonly onInserted: () => void;
  readonly className?: string | undefined;
}

/**
 * A 6×6 grid that highlights as the pointer sweeps it and inserts a table of the size under
 * it. One tab stop, with arrows, Home and End moving inside it.
 */
export function TableSizeGrid({ slot, label, onInserted, className }: TableSizeGridProps) {
  const editor = useDocxEditor();
  const { isEnabled } = useEditorCommand(slot);
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null);
  // The cell that holds the grid's single tab stop. A 6x6 of tabbable buttons is 36 tab
  // stops for a keyboard user; a grid is ONE, with arrows moving inside it.
  const [cursor, setCursor] = useState({ rows: 1, cols: 1 });
  const gridRef = useRef<HTMLDivElement | null>(null);

  const insert = useCallback(
    (rows: number, cols: number) => {
      if (!editor || !isEnabled) return;
      // can-before-exec even here: the popup opened because the slot was enabled, and the
      // selection can move under it.
      const command = { type: 'insertTable' as const, rows, cols };
      if (!editor.can(command).ok) return;
      editor.exec(command);
      onInserted();
      // The engine left the caret in the first cell; DOM focus is still on the grid cell
      // that was clicked, and the popup is about to unmount. Without this the user has to
      // click into a table they just asked for before they can type in it.
      editor.focus();
    },
    [editor, isEnabled, onInserted]
  );

  /**
   * Move the cursor within the grid and follow it with focus.
   *
   * Takes a STEP from the current cell rather than an absolute target, applied through the
   * functional updater: two key presses in one React batch would both read the same
   * captured `cursor` and the second would go nowhere.
   */
  const move = useCallback((step: { rows?: number; cols?: number; toCol?: number }) => {
    setCursor((current) => {
      const next = {
        rows: Math.min(TABLE_GRID_ROWS, Math.max(1, current.rows + (step.rows ?? 0))),
        cols: Math.min(
          TABLE_GRID_COLUMNS,
          Math.max(1, step.toCol ?? current.cols + (step.cols ?? 0))
        ),
      };
      setHover(next);
      // Focus follows in a microtask so the cell it targets has been committed with its
      // new tabIndex.
      queueMicrotask(() =>
        gridRef.current
          ?.querySelector<HTMLElement>(`[data-cell="${next.rows}x${next.cols}"]`)
          ?.focus()
      );
      return next;
    });
  }, []);

  const cellRows: ReactNode[] = [];
  for (let row = 1; row <= TABLE_GRID_ROWS; row += 1) {
    const cells: ReactNode[] = [];
    for (let col = 1; col <= TABLE_GRID_COLUMNS; col += 1) {
      const filled = !!hover && row <= hover.rows && col <= hover.cols;
      cells.push(
        <button
          key={col}
          type="button"
          role="gridcell"
          data-cell={`${row}x${col}`}
          className="docx-menubar__grid-cell"
          // Roving tabindex across the whole grid.
          tabIndex={cursor.rows === row && cursor.cols === col ? 0 : -1}
          {...(filled ? { 'data-filled': '' } : {})}
          aria-label={`${col} × ${row}`}
          onMouseDown={guardToolbarMousedown}
          onMouseEnter={() => setHover({ rows: row, cols: col })}
          onFocus={() => setHover({ rows: row, cols: col })}
          onClick={() => insert(row, col)}
        />
      );
    }
    cellRows.push(
      <div key={row} role="row" className="docx-menubar__grid-row">
        {cells}
      </div>
    );
  }

  return (
    <div
      ref={gridRef}
      // A 2-D size picker is a GRID, not a list of menu items: `menuitem` on 36 cells
      // announces them without any positional context.
      role="grid"
      aria-label={label}
      className={`docx-menubar__grid${className ? ` ${className}` : ''}`}
      onMouseLeave={() => setHover(null)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') move({ cols: 1 });
        else if (event.key === 'ArrowLeft') move({ cols: -1 });
        else if (event.key === 'ArrowDown') move({ rows: 1 });
        else if (event.key === 'ArrowUp') move({ rows: -1 });
        else if (event.key === 'Home') move({ toCol: 1 });
        else if (event.key === 'End') move({ toCol: TABLE_GRID_COLUMNS });
        else return;
        // Stopped so the grid's arrows do not ALSO walk the menu rows behind it.
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="docx-menubar__grid-cells">{cellRows}</div>
      {/* Not a live region: `role="status"` here announced on every one of the 36 cells a
          pointer sweep crosses. The size is already on each cell's accessible name. */}
      <div className="docx-menubar__grid-caption" aria-hidden="true">
        {hover ? `${hover.cols} × ${hover.rows}` : ''}
      </div>
    </div>
  );
}
