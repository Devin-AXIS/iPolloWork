/**
 * TableGridInline — a grid picker for table dimensions, rendered inline (no button/dropdown wrapper).
 * Used both standalone inside menu submenus and internally by TableGridPicker.
 */

import { useState, useCallback } from 'react';
import type { CSSProperties, ReactElement } from 'react';

interface TableGridInlineProps {
  onInsert: (rows: number, columns: number) => void;
  gridRows?: number;
  gridColumns?: number;
}

const CELL_SIZE = 18;
const CELL_GAP = 2;

const cellStyle: CSSProperties = {
  width: CELL_SIZE,
  height: CELL_SIZE,
  backgroundColor: 'var(--doc-surface)',
  border: '1px solid var(--doc-border)',
  borderRadius: 2,
  transition: 'background-color 0.1s, border-color 0.1s',
  cursor: 'pointer',
};

const cellSelectedStyle: CSSProperties = {
  ...cellStyle,
  backgroundColor: 'var(--doc-primary)',
  border: '1px solid var(--doc-primary)',
};

const labelStyle: CSSProperties = {
  marginTop: 6,
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--doc-text)',
  textAlign: 'center',
};

export function TableGridInline({ onInsert, gridRows = 6, gridColumns = 6 }: TableGridInlineProps) {
  const [hoverRows, setHoverRows] = useState(0);
  const [hoverCols, setHoverCols] = useState(0);

  const handleCellClick = useCallback(() => {
    if (hoverRows > 0 && hoverCols > 0) {
      onInsert(hoverRows, hoverCols);
    }
  }, [hoverRows, hoverCols, onInsert]);

  const gridCells: ReactElement[] = [];
  for (let row = 1; row <= gridRows; row++) {
    for (let col = 1; col <= gridColumns; col++) {
      const isSelected = row <= hoverRows && col <= hoverCols;
      gridCells.push(
        <div
          key={`${row}-${col}`}
          style={isSelected ? cellSelectedStyle : cellStyle}
          onMouseEnter={() => {
            setHoverRows(row);
            setHoverCols(col);
          }}
          onClick={handleCellClick}
          role="gridcell"
          aria-selected={isSelected}
        />
      );
    }
  }

  const gridLabel = hoverRows > 0 && hoverCols > 0 ? `${hoverCols} × ${hoverRows}` : 'Select size';

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gap: CELL_GAP,
          gridTemplateColumns: `repeat(${gridColumns}, ${CELL_SIZE}px)`,
        }}
        onMouseLeave={() => {
          setHoverRows(0);
          setHoverCols(0);
        }}
        role="grid"
        aria-label="Table size selector"
      >
        {gridCells}
      </div>
      <div style={labelStyle}>{gridLabel}</div>
    </div>
  );
}
