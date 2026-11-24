import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import type { Cell, CellChange, Sheet } from './api.ts';
import { addressOf, cellPosition, maxCellChanges, sheetLimits } from './file-contract.ts';
import { label, type Language } from './browser.ts';
import { blockedCells, canEditCell, cellAddress, cellChange, clipboardCells, editKey, firstCell,
  rangeBounds, rangeText, singleCell, withinRange, type Changes, type Point, type Range } from './sheet-model.ts';

const rowHeight = 28;
const columnWidth = 116;
const rowHeader = 42;

function windowPositions(offset: number, size: number, pitch: number, count: number) {
  const first = Math.max(1, Math.floor(offset / pitch) - 1);
  const last = Math.min(count, Math.ceil((offset + size) / pitch) + 2);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
}

export function SheetEditor({ sheets, changes, stage, editing, delimited, language, undo, redo, canUndo, canRedo, setCellTyping }: {
  sheets: Sheet[]; changes: Changes; stage(next: Changes): void;
  editing: boolean; delimited: boolean; language: Language;
  undo(): void; redo(): void; canUndo: boolean; canRedo: boolean;
  setCellTyping(dirty: boolean): void;
}) {
  const t = (zh: string, en: string) => label(language, zh, en);
  const [name, setName] = useState(sheets[0]?.name ?? '');
  const [selection, setSelection] = useState<Range>(singleCell(firstCell));
  const [jump, setJump] = useState('');
  const [notice, setNotice] = useState<'bounds' | 'locked' | 'clipboard' | 'limit'>();
  const [finding, setFinding] = useState(false);
  const [search, setSearch] = useState('');
  const [matchIndex, setMatchIndex] = useState(-1);
  const [viewport, setViewport] = useState({ left: 0, top: 0, width: 400, height: 500 });
  const [activeInput, setActiveInput] = useState<{ point: Point; value: string; select: boolean }>();
  const field = useRef<HTMLTextAreaElement>(null);
  const finder = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const pendingReveal = useRef<Point>(undefined);
  const drag = useRef(false);
  const id = useId();
  const sheet = sheets.find(item => item.name === name) ?? sheets[0];
  const cells = useMemo(() => new Map(sheet?.cells.map(cell => [cell.address, cell]) ?? []), [sheet]);
  const blocked = useMemo(() => sheet ? blockedCells(sheet) : [], [sheet]);
  const sheetChanges = useMemo(() => Object.values(changes).filter(change => change.sheet === sheet?.name), [changes, sheet]);
  const size = sheetChanges.reduce((bounds, change) => {
    const point = cellPosition(change.address);
    return point ? { rows: Math.max(bounds.rows, point.row), columns: Math.max(bounds.columns, point.column) } : bounds;
  }, { rows: sheet?.rows ?? 1, columns: sheet?.columns ?? 1 });
  const matches = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return [];
    const candidates = new Map<string, Cell | CellChange>(cells);
    for (const change of sheetChanges) candidates.set(change.address, change);
    return [...candidates.values()].flatMap(cell => {
      const text = 'display' in cell ? cell.display ?? cell.value : cell.value;
      const point = cellPosition(cell.address);
      return point && (text.toLocaleLowerCase().includes(term) || cell.value.toLocaleLowerCase().includes(term)) ? [point] : [];
    }).sort((a, b) => a.row - b.row || a.column - b.column);
  }, [cells, search, sheetChanges]);

  function measure() {
    const node = grid.current;
    if (node) setViewport({ left: node.scrollLeft, top: node.scrollTop, width: node.clientWidth, height: node.clientHeight });
  }
  useEffect(() => {
    const node = grid.current;
    if (!node) return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [Boolean(sheet)]);
  useEffect(() => {
    const input = field.current;
    if (activeInput && input && input !== input.ownerDocument.activeElement) {
      input.focus({ preventScroll: true });
      const end = input.value.length;
      input.setSelectionRange(activeInput.select ? 0 : end, end);
    }
  }, [activeInput]);
  useEffect(() => { if (finding) finder.current?.focus(); }, [finding]);
  useLayoutEffect(() => {
    const point = pendingReveal.current;
    pendingReveal.current = undefined;
    if (point && point.row <= size.rows && point.column <= size.columns) reveal(point);
    else measure();
    const clamp = (cell: Point) => cell.row <= size.rows && cell.column <= size.columns ? cell
      : { row: Math.min(cell.row, size.rows), column: Math.min(cell.column, size.columns) };
    setSelection(current => {
      const start = clamp(current.start);
      const end = clamp(current.end);
      return start === current.start && end === current.end ? current : { start, end };
    });
  }, [size.rows, size.columns]);

  if (!sheet) return null;
  const workbookSheet = sheet;
  const selectedAddress = cellAddress(selection.end);
  const selectedBounds = rangeBounds(selection);
  const firstAddress = addressOf(selectedBounds.top, selectedBounds.left);
  const lastAddress = addressOf(selectedBounds.bottom, selectedBounds.right);
  const rangeLabel = firstAddress === lastAddress ? selectedAddress : firstAddress + ':' + lastAddress;
  const rows = windowPositions(viewport.top, viewport.height, rowHeight, size.rows);
  const columns = windowPositions(viewport.left, viewport.width, columnWidth, size.columns);
  const canvasWidth = rowHeader + size.columns * columnWidth;
  const sheetEditable = editing && !sheet.protected;
  const baseline = (point: Point) => cells.get(cellAddress(point));
  const at = (point: Point): (Cell | CellChange) | undefined =>
    changes[editKey(workbookSheet.name, cellAddress(point))] ?? baseline(point);
  const writable = (point: Point) => sheetEditable && canEditCell(workbookSheet, point, baseline(point), blocked);
  const selected = at(selection.end);

  function select(point: Point, extend = false) {
    setNotice(undefined);
    setSelection(current => extend ? { start: current.start, end: point } : singleCell(point));
  }
  function reveal(point: Point) {
    const node = grid.current;
    if (!node) return;
    const x = (point.column - 1) * columnWidth + rowHeader;
    const y = point.row * rowHeight;
    if (x < node.scrollLeft + rowHeader) node.scrollLeft = x - rowHeader;
    else if (x + columnWidth > node.scrollLeft + node.clientWidth) node.scrollLeft = x + columnWidth - node.clientWidth;
    if (y < node.scrollTop + rowHeight) node.scrollTop = y - rowHeight;
    else if (y + rowHeight > node.scrollTop + node.clientHeight) node.scrollTop = y + rowHeight - node.clientHeight;
    measure();
  }
  const focus = () => grid.current?.focus({ preventScroll: true });
  function go(point: Point, extend = false) {
    select(point, extend); reveal(point); focus();
  }

  function applyCells(entries: readonly { point: Point; value: string; kind?: CellChange['kind'] }[]) {
    if (entries.some(({ point }) => !writable(point))) { setNotice('locked'); return false; }
    const next = { ...changes };
    let changed = false;
    for (const { point, value, kind } of entries) {
      const key = editKey(workbookSheet.name, cellAddress(point));
      const change = cellChange(workbookSheet, point, value, baseline(point), delimited, kind);
      const previous = next[key];
      if (previous?.value === change?.value && previous?.kind === change?.kind) continue;
      if (change) next[key] = change; else delete next[key];
      changed = true;
    }
    if (Object.keys(next).length > maxCellChanges) { setNotice('limit'); return false; }
    if (changed) stage(next);
    setNotice(undefined);
    return true;
  }

  function add(axis: 'row' | 'column') {
    const point = { row: size.rows + Number(axis === 'row'), column: size.columns + Number(axis === 'column') };
    if (point.row > sheetLimits.rows || point.column > sheetLimits.columns ||
      !applyCells([{ point, value: '', kind: 'text' }])) return;
    pendingReveal.current = point;
    select(point); focus();
  }
  function locate(event: FormEvent) {
    event.preventDefault();
    const point = cellPosition(jump.trim().toUpperCase());
    if (!point || point.row > size.rows || point.column > size.columns) { setNotice('bounds'); return; }
    go(point);
  }
  function find(backwards = false) {
    if (!matches.length) return;
    const index = matchIndex < 0 ? (backwards ? matches.length - 1 : 0)
      : (matchIndex + matches.length + (backwards ? -1 : 1)) % matches.length;
    const point = matches[index];
    if (point) { setMatchIndex(index); select(point); reveal(point); }
  }

  function read(point: Point) {
    const cell = at(point);
    return (cell && 'display' in cell ? cell.display : undefined) ?? cell?.value ?? '';
  }
  function copy(event: ClipboardEvent) {
    if (activeInput) return;
    event.preventDefault();
    const source = rangeText(selection, read);
    if (source === undefined) { setNotice('limit'); return; }
    event.clipboardData.setData('text/plain', source);
  }
  function paste(event: ClipboardEvent) {
    if (activeInput || !sheetEditable || !event.clipboardData.types.includes('text/plain')) return;
    event.preventDefault();
    const start = { row: selectedBounds.top, column: selectedBounds.left };
    const parsed = clipboardCells(event.clipboardData.getData('text/plain'), start);
    if (!parsed) { setNotice('clipboard'); return; }
    if (applyCells(parsed.cells)) setSelection(parsed.range);
  }
  function clear() {
    const { top, bottom, left, right } = selectedBounds;
    if ((bottom - top + 1) * (right - left + 1) > maxCellChanges) { setNotice('limit'); return; }
    const entries = [];
    for (let row = top; row <= bottom; row += 1)
      for (let column = left; column <= right; column += 1) entries.push({ point: { row, column }, value: '' });
    applyCells(entries);
  }

  function begin(point: Point, input?: string) {
    if (!writable(point)) return;
    reveal(point);
    setCellTyping(input !== undefined && input !== at(point)?.value);
    setActiveInput({ point, value: input ?? at(point)?.value ?? '', select: input === undefined });
  }
  function finish(commit: boolean) {
    if (!activeInput) return;
    if (commit) applyCells([{ point: activeInput.point, value: activeInput.value }]);
    setCellTyping(false);
    setActiveInput(undefined);
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
    const command = event.metaKey || event.ctrlKey;
    const key = event.key;
    if (command) {
      if (key.toLowerCase() === 'f') { event.preventDefault(); setFinding(true); finder.current?.focus(); }
      if (sheetEditable && ['z', 'y'].includes(key.toLowerCase())) {
        event.preventDefault();
        if (key.toLowerCase() === 'y' || event.shiftKey) redo(); else undo();
      }
      return;
    }
    if (key === 'F2' || (key.length === 1 && !event.altKey)) {
      if (writable(selection.end)) { event.preventDefault(); begin(selection.end, key === 'F2' ? undefined : key); }
      return;
    }
    if (sheetEditable && (key === 'Delete' || key === 'Backspace')) { event.preventDefault(); clear(); return; }
    const { row, column } = selection.end;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)) return;
    let nextRow = row, nextColumn = column;
    if (key === 'ArrowUp' || (key === 'Enter' && event.shiftKey)) nextRow -= 1;
    if (key === 'ArrowDown' || (key === 'Enter' && !event.shiftKey)) nextRow += 1;
    if (key === 'ArrowLeft' || (key === 'Tab' && event.shiftKey)) nextColumn -= 1;
    if (key === 'ArrowRight' || (key === 'Tab' && !event.shiftKey)) nextColumn += 1;
    if (key === 'Home') nextColumn = 1;
    if (key === 'End') nextColumn = size.columns;
    const page = Math.max(1, Math.floor(viewport.height / rowHeight) - 1);
    if (key === 'PageUp') nextRow -= page;
    if (key === 'PageDown') nextRow += page;
    if (key === 'Tab' && (nextColumn < 1 || nextColumn > size.columns)) {
      nextRow += event.shiftKey ? -1 : 1;
      nextColumn = event.shiftKey ? size.columns : 1;
      if (nextRow < 1 || nextRow > size.rows) return;
    }
    event.preventDefault();
    go({ row: Math.max(1, Math.min(size.rows, nextRow)), column: Math.max(1, Math.min(size.columns, nextColumn)) },
      event.shiftKey && key !== 'Tab' && key !== 'Enter');
  }

  const noticeText = {
    bounds: t('地址超出当前工作表', 'The address is outside the current worksheet'),
    locked: t('区域含有公式、合并或受保护单元格，未应用修改', 'The range contains formula, merged, or protected cells. No edits were applied.'),
    clipboard: t('粘贴内容超过区域或单元格大小限制', 'The pasted values exceed the range or cell size limit'),
    limit: t('最多处理 1,000 个单元格，请缩小范围或先保存', 'Use 1,000 cells or fewer. Narrow the range or save your changes first.'),
  };
  return <div className="ipw-sheet">
    <div className="ipw-file-actions ipw-sheet-toolbar">
      {sheetEditable && <>
        <Button size="sm" variant="outline" onClick={() => add('row')} disabled={size.rows >= sheetLimits.rows}>{t('新增行', 'Add row')}</Button>
        <Button size="sm" variant="outline" onClick={() => add('column')} disabled={size.columns >= sheetLimits.columns}>{t('新增列', 'Add column')}</Button>
        <Button size="sm" disabled={!canUndo} onClick={undo}>{t('撤销', 'Undo')}</Button>
        <Button size="sm" disabled={!canRedo} onClick={redo}>{t('重做', 'Redo')}</Button>
      </>}
      <Button size="sm" aria-expanded={finding} onClick={() => { setFinding(!finding); if (finding) focus(); }}>{t('查找', 'Find')}</Button>
    </div>
    {finding && <form className="ipw-file-actions ipw-sheet-find" role="search" onSubmit={event => { event.preventDefault(); find(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); setFinding(false); focus(); }
        if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); find(true); }
      }}>
      <Input ref={finder} aria-label={t('查找内容', 'Find in sheet')} value={search} onChange={event => { setSearch(event.target.value); setMatchIndex(-1); }} />
      <span aria-live="polite">{search.trim() ? (matchIndex + 1) + ' / ' + matches.length : ''}</span>
      <Button size="sm" type="button" disabled={!matches.length} onClick={() => find(true)}>{t('上一个', 'Previous')}</Button>
      <Button size="sm" type="submit" disabled={!matches.length}>{t('下一个', 'Next')}</Button>
    </form>}
    <div className="ipw-sheet-formula">
      <form className="ipw-sheet-jump" onSubmit={locate}>
        <Input aria-label={t('跳转单元格', 'Go to cell')} placeholder={rangeLabel} value={jump} maxLength={10}
          onChange={event => { setJump(event.target.value); setNotice(undefined); }} />
      </form>
      <textarea aria-label={t('单元格内容', 'Cell contents')} value={selected?.value ?? ''} rows={1} maxLength={32767}
        readOnly={!writable(selection.end)} onChange={event => applyCells([{ point: selection.end, value: event.target.value }])} />
      {writable(selection.end) && !delimited && selected?.value && <select
        aria-label={t('值类型', 'Value type')} value={selected.kind === 'number' || selected.kind === 'boolean' ? selected.kind : 'text'}
        onChange={event => applyCells([{ point: selection.end, value: selected.value, kind: event.target.value as CellChange['kind'] }])}>
        <option value="text">{t('文本', 'Text')}</option><option value="number">{t('数字', 'Number')}</option><option value="boolean">{t('布尔值', 'Boolean')}</option>
      </select>}
      {selected?.kind === 'formula' && <span className="ipw-sheet-formula-label"
        title={t('表格内显示文件最后保存的计算结果', 'The grid shows the last result saved in the file')}>{t('公式', 'Formula')}</span>}
    </div>
    {notice && <div className="ipw-sheet-notice" role="status">{noticeText[notice]}</div>}
    {sheet.protected && <div className="ipw-sheet-notice" role="status">{t('此工作表受保护，可浏览和复制', 'This sheet is protected. You can browse and copy cells.')}</div>}
    <div className="ipw-sheet-grid" role="grid" aria-label={t('工作表网格', 'Worksheet grid')} ref={grid} tabIndex={0}
      aria-rowcount={size.rows + 1} aria-colcount={size.columns + 1} aria-readonly={!sheetEditable}
      aria-activedescendant={rows.includes(selection.end.row) && columns.includes(selection.end.column) ? id + selectedAddress : undefined}
      onScroll={event => {
        const node = event.currentTarget;
        if (activeInput && (!windowPositions(node.scrollTop, node.clientHeight, rowHeight, size.rows).includes(activeInput.point.row)
          || !windowPositions(node.scrollLeft, node.clientWidth, columnWidth, size.columns).includes(activeInput.point.column))) finish(true);
        measure();
      }} onKeyDown={keyDown} onCopy={copy} onPaste={paste} onMouseUp={() => { drag.current = false; }}>
      <div className="ipw-sheet-canvas" style={{ width: canvasWidth, height: rowHeight * (size.rows + 1) }}>
        <div className="ipw-sheet-column-header" role="row" aria-rowindex={1}>
          <span className="ipw-sheet-corner" role="columnheader" aria-label={t('行号', 'Row number')} />
          {columns.map(column => <span role="columnheader" key={column} aria-colindex={column + 1}
            style={{ left: rowHeader + (column - 1) * columnWidth }}>{addressOf(1, column).slice(0, -1)}</span>)}
        </div>
        {rows.map(row => <div className="ipw-sheet-row" role="row" key={row} aria-rowindex={row + 1} style={{ top: row * rowHeight }}>
          <span role="rowheader">{row}</span>
          {columns.map(column => {
            const point = { row, column };
            const address = cellAddress(point);
            const cell = at(point);
            const value = read(point);
            const selected = withinRange(point, selectedBounds);
            const active = address === selectedAddress;
            const input = activeInput && cellAddress(activeInput.point) === address ? activeInput : undefined;
            return <div role="gridcell" id={id + address} key={address} aria-label={address}
              aria-colindex={column + 1} aria-selected={selected} aria-readonly={!writable(point)}
              className="ipw-sheet-cell" data-cell-address={address} data-active={active || undefined}
              data-selected={selected || undefined} data-changed={Boolean(changes[editKey(sheet.name, address)]) || undefined}
              data-number={cell?.kind === 'number' || (cell?.kind === 'formula' && /^-?\d/.test(value)) || undefined}
              data-formula={cell?.kind === 'formula' || undefined} title={cell?.kind === 'formula' ? cell.value : value}
              style={{ left: rowHeader + (column - 1) * columnWidth }}
              onMouseDown={event => {
                if (event.button !== 0 || input) return;
                event.preventDefault(); finish(true); drag.current = true; select(point, event.shiftKey); focus();
              }}
              onMouseEnter={event => { if (drag.current && event.buttons === 1) select(point, true); }}
              onDoubleClick={() => { select(point); begin(point); }}>
              {input ? <textarea aria-label={t('编辑单元格', 'Edit cell') + ' ' + address} ref={field} rows={1} maxLength={32767}
                value={input.value} onChange={event => {
                  const value = event.target.value;
                  setCellTyping(value !== (cell?.value ?? ''));
                  setActiveInput({ ...input, value });
                }}
                onBlur={() => finish(true)} onKeyDown={event => {
                  if (event.nativeEvent.isComposing) return;
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { finish(true); return; }
                  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); focus(); }
                  if ((event.key === 'Enter' || event.key === 'Tab') && !event.altKey) {
                    event.preventDefault(); event.stopPropagation(); finish(true);
                    const step = event.shiftKey ? -1 : 1;
                    go(event.key === 'Enter' ? { row: Math.max(1, Math.min(size.rows, row + step)), column }
                      : { row, column: Math.max(1, Math.min(size.columns, column + step)) });
                  }
                }} /> : <span>{value}</span>}
            </div>;
          })}
        </div>)}
      </div>
    </div>
    <div className="ipw-sheet-bottom">
      {!delimited && <div className="ipw-sheet-tabs" role="group" aria-label={t('工作表', 'Worksheets')}>
        {sheets.map(item => <Button size="sm" key={item.name} aria-pressed={item.name === sheet.name} onClick={() => {
          setName(item.name); select(firstCell); setSearch(''); setMatchIndex(-1); setJump('');
          if (grid.current) grid.current.scrollTo(0, 0);
          measure();
        }}>{item.name}</Button>)}
      </div>}
      <div className="ipw-sheet-summary">
        <span>{size.rows} × {size.columns}</span>
        <span>{rangeLabel}</span>
      </div>
    </div>
  </div>;
}
