import { DOMParser, XMLSerializer, type Document as Xml, type Element } from '@xmldom/xmldom';
import { unzipSync, zipSync } from 'fflate';
import { posix } from 'node:path';
import type { Cell, CellChange, Sheet } from './api.ts';
import { decodeText, Failure } from '../../_shared/workspace-document-files.ts';
import { cellPosition } from './file-contract.ts';

const xmlSpace = 'http://www.w3.org/XML/1998/namespace';
const coordinate = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;
const workbookPath = 'xl/workbook.xml';
const relationshipPath = 'xl/_rels/workbook.xml.rels';
const maxCells = 100_000;

export function parts(bytes: Uint8Array) {
  try {
    let expanded = 0;
    let count = 0;
    return unzipSync(bytes, { filter(entry) {
      expanded += entry.originalSize;
      if (++count > 2500 || expanded > 100 * 1024 * 1024 || entry.originalSize > 24 * 1024 * 1024)
        throw new Failure('too-large', 413);
      if (entry.name.split('/').some(segment => ['..', '__proto__', 'constructor'].includes(segment))
        || entry.name.includes('\\') || entry.name.startsWith('/'))
        throw new Failure('unsupported-file', 415);
      return true;
    } });
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure('unsupported-file', 415);
  }
}

export function parseXml(bytes: Uint8Array | undefined) {
  if (!bytes) throw new Failure('unsupported-file', 415);
  // XML parts can start with a UTF-8 BOM. The decoder keeps it for text files.
  const text = decodeText(bytes).replace(/^\uFEFF/u, '');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw new Failure('unsupported-file', 415);
  try {
    return new DOMParser({ onError(level, message) {
      if (level !== 'warning') throw Error(message);
    } }).parseFromString(text, 'text/xml');
  } catch {
    throw new Failure('unsupported-file', 415);
  }
}

export function descendants(node: Xml | Element, name: string) {
  return Array.from(node.getElementsByTagName('*')).filter(element => element.localName === name);
}

function children(node: Element, name: string) {
  return Array.from(node.childNodes).filter((child): child is Element =>
    child.nodeType === 1 && (child as Element).localName === name);
}

export function columnLabel(number: number): string {
  let letters = '';
  for (let index = number; index > 0; index = Math.floor((index - 1) / 26)) {
    letters = String.fromCharCode(65 + (index - 1) % 26) + letters;
  }
  return letters;
}

function position(address: string) {
  const match = coordinate.exec(address);
  if (!match?.[1] || !match[2]) throw new Failure('invalid-cell');
  const row = Number(match[2]);
  const column = [...match[1]].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
  if (row > 1_048_576 || column > 16_384) throw new Failure('invalid-cell');
  return { row, column };
}

function stringsIn(node: Element) {
  return children(node, 't').concat(children(node, 'r').flatMap(run => children(run, 't')))
    .map(tag => tag.textContent ?? '').join('');
}

function openWorkbook(bytes: Uint8Array) {
  const archive = parts(bytes);
  if (Object.keys(archive).some(path => /^_xmlsignatures\//i.test(path)))
    throw new Failure('unsupported-file', 415);
  const workbook = parseXml(archive[workbookPath]);
  const relationships = new Map(descendants(parseXml(archive[relationshipPath]), 'Relationship')
    .filter(node => node.getAttribute('TargetMode') !== 'External')
    .map(node => [node.getAttribute('Id'), node]));
  const target = (url: string) => (url.startsWith('/') ? posix.normalize(url).slice(1) : posix.join('xl', url));
  const shared = [...relationships.values()].find(node => node.getAttribute('Type')?.endsWith('/sharedStrings'));
  const strings = shared && shared.getAttribute('Target')
    ? descendants(parseXml(archive[target(shared.getAttribute('Target')!)]), 'si').map(stringsIn)
    : [];
  const sheets = descendants(workbook, 'sheet').flatMap(node => {
    const id = Array.from(node.attributes).find(attribute => attribute.localName === 'id')?.value;
    const relation = id ? relationships.get(id) : undefined;
    const name = node.getAttribute('name');
    const url = relation?.getAttribute('Target');
    if (!name || !url || !relation?.getAttribute('Type')?.endsWith('/worksheet')) return [];
    return [{ name, path: target(url), hidden: ['hidden', 'veryHidden'].includes(node.getAttribute('state') ?? '') }];
  });
  if (!sheets.some(sheet => !sheet.hidden) || sheets.length > 120) throw new Failure('unsupported-file', 415);
  const styleUrl = [...relationships.values()].find(node => node.getAttribute('Type')?.endsWith('/styles'))?.getAttribute('Target');
  return { archive, workbook, sheets, strings, stylePath: styleUrl ? target(styleUrl) : 'xl/styles.xml' };
}

export type WorkbookNumberFormatter = (format: number | string, value: number, date1904: boolean) => string;

function workbookFormat(archive: Record<string, Uint8Array>, stylePath: string, workbook: Xml, format?: WorkbookNumberFormatter) {
  if (!format) return;
  const styleBytes = archive[stylePath];
  const styles = styleBytes && parseXml(styleBytes);
  const formats = new Map(styles ? descendants(styles, 'numFmt')
    .map(node => [Number(node.getAttribute('numFmtId')), node.getAttribute('formatCode') ?? '']) : []);
  const xfs = styles && descendants(styles, 'cellXfs')[0];
  const codes = xfs ? children(xfs, 'xf').map(node => Number(node.getAttribute('numFmtId'))) : [];
  const dateSystem = descendants(workbook, 'workbookPr')[0]?.getAttribute('date1904');
  return (cell: Element, raw: string) => {
    const code = codes[Number(cell.getAttribute('s') ?? 0)] ?? 0;
    if (!code || raw === '' || !Number.isFinite(Number(raw))) return raw;
    try { return format(formats.get(code) ?? code, Number(raw), dateSystem === '1' || dateSystem === 'true'); }
    catch { return raw; }
  };
}

function cellValue(node: Element, strings: string[], locked: boolean, format?: (node: Element, raw: string) => string): Cell {
  const address = node.getAttribute('r') ?? '';
  const raw = children(node, 'v')[0]?.textContent ?? '';
  const formula = children(node, 'f')[0];
  const type = node.getAttribute('t');
  const rawDisplay = type === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE') : type === 's' ? strings[Number(raw)] ?? ''
    : !type || type === 'n' ? format?.(node, raw) ?? raw : raw;
  if (formula) return { address, value: formula.textContent ? '=' + formula.textContent : '',
    ...(raw !== '' && { display: rawDisplay }), kind: 'formula' };
  if (type === 's') return { address, value: strings[Number(raw)] ?? '', kind: locked ? 'locked' : 'text' };
  const inline = children(node, 'is')[0];
  if (inline) return { address, value: stringsIn(inline), kind: locked ? 'locked' : 'text' };
  if (type === 'e' || type === 'd' || locked) return { address, value: raw, kind: 'locked' };
  if (type === 'b') return { address, value: raw === '1' ? 'TRUE' : 'FALSE', kind: 'boolean' };
  return { address, value: raw, ...(rawDisplay !== raw && { display: rawDisplay }),
    kind: !type || type === 'n' ? (raw === '' ? 'text' : 'number') : 'text' };
}

function blockedRanges(xml: Xml) {
  return descendants(xml, 'mergeCell').concat(descendants(xml, 'f')
    .filter(formula => ['array', 'shared', 'dataTable'].includes(formula.getAttribute('t') ?? '')))
    .map(tag => tag.getAttribute('ref') ?? '').filter(Boolean);
}

export function readWorkbook(bytes: Uint8Array, format?: WorkbookNumberFormatter): Sheet[] {
  const { archive, workbook, sheets, strings, stylePath } = openWorkbook(bytes);
  const showNumber = workbookFormat(archive, stylePath, workbook, format);
  let total = 0;
  return sheets.filter(sheet => !sheet.hidden).map(({ name, path }) => {
    const xml = parseXml(archive[path]);
    const protectedSheet = descendants(xml, 'sheetProtection').length > 0;
    let rows = 1;
    let columns = 1;
    const cells: Cell[] = [];
    for (const node of descendants(xml, 'c')) {
      if (++total > maxCells) throw new Failure('too-large', 413);
      const cell = cellValue(node, strings, protectedSheet, showNumber);
      const point = position(cell.address);
      rows = Math.max(rows, point.row);
      columns = Math.max(columns, point.column);
      if (cell.value || cell.kind === 'formula' || cell.kind === 'locked') cells.push(cell);
    }
    const blocked = blockedRanges(xml);
    for (const range of blocked) {
      const end = range.split(':')[1];
      const point = end && cellPosition(end);
      if (point) { rows = Math.max(rows, point.row); columns = Math.max(columns, point.column); }
    }
    return { name, rows, columns, cells, ...(protectedSheet && { protected: true }), ...(blocked.length && { blocked }) };
  });
}

const serialize = (xml: Xml) => new TextEncoder().encode(new XMLSerializer().serializeToString(xml));

function create(xml: Xml, context: Element, name: string) {
  return xml.createElementNS(context.namespaceURI, context.prefix ? context.prefix + ':' + name : name);
}

function insideRange(address: string, range: string) {
  const [start, end] = range.split(':');
  if (!start || !end || address === start) return false;
  const from = cellPosition(start), to = cellPosition(end), cell = position(address);
  return from && to && cell.row >= from.row && cell.row <= to.row && cell.column >= from.column && cell.column <= to.column;
}

function setCell(xml: Xml, cell: Element, change: CellChange) {
  if (children(cell, 'f').length || ['e', 'd'].includes(cell.getAttribute('t') ?? ''))
    throw new Failure('protected-cell', 409);
  for (const tag of [...children(cell, 'v'), ...children(cell, 'is')]) cell.removeChild(tag);
  cell.removeAttribute('t');
  if (change.kind === 'empty') return;
  if (change.kind === 'text') {
    cell.setAttribute('t', 'inlineStr');
    const inline = create(xml, cell, 'is');
    const text = create(xml, cell, 't');
    text.setAttributeNS(xmlSpace, 'xml:space', 'preserve');
    text.appendChild(xml.createTextNode(change.value));
    inline.appendChild(text);
    cell.insertBefore(inline, cell.firstChild);
  } else {
    const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(change.value) && Number.isFinite(Number(change.value));
    const boolean = /^(?:true|false)$/i.test(change.value);
    if (change.kind === 'number' ? !number : !boolean) throw new Failure('invalid-cell');
    cell.setAttribute('t', change.kind === 'number' ? 'n' : 'b');
    const value = create(xml, cell, 'v');
    value.appendChild(xml.createTextNode(change.kind === 'number' ? change.value : change.value.toLowerCase() === 'true' ? '1' : '0'));
    cell.insertBefore(value, cell.firstChild);
  }
}

function patchSheet(xml: Xml, changes: CellChange[]) {
  if (descendants(xml, 'sheetProtection').length) throw new Failure('protected-cell', 409);
  const grid = descendants(xml, 'sheetData')[0];
  if (!grid) throw new Failure('unsupported-file', 415);
  const rows = new Map(children(grid, 'row').map(row => [Number(row.getAttribute('r')), row]));
  const blocked = blockedRanges(xml);
  for (const change of changes) {
    const point = position(change.address);
    if (blocked.some(range => insideRange(change.address, range))) throw new Failure('protected-cell', 409);
    let row = rows.get(point.row);
    if (!row) {
      if (change.kind === 'empty') continue;
      row = create(xml, grid, 'row');
      row.setAttribute('r', String(point.row));
      grid.insertBefore(row, children(grid, 'row').find(node => Number(node.getAttribute('r')) > point.row) ?? null);
      rows.set(point.row, row);
    }
    const cells = children(row, 'c');
    let cell = cells.find(node => node.getAttribute('r') === change.address);
    if (!cell) {
      if (change.kind === 'empty') continue;
      cell = create(xml, row, 'c');
      cell.setAttribute('r', change.address);
      row.insertBefore(cell, cells.find(node => position(node.getAttribute('r') ?? '').column > point.column)
        ?? children(row, 'extLst')[0] ?? null);
    }
    setCell(xml, cell, change);
  }
  const dimension = descendants(xml, 'dimension')[0];
  if (dimension) {
    const addresses = descendants(grid, 'c').map(node => position(node.getAttribute('r') ?? ''));
    const last = addresses.reduce((point, next) => ({
      row: Math.max(point.row, next.row), column: Math.max(point.column, next.column),
    }), { row: 1, column: 1 });
    dimension.setAttribute('ref', 'A1:' + columnLabel(last.column) + last.row);
  }
}

export function updateWorkbook(bytes: Uint8Array, changes: CellChange[]) {
  const { archive, workbook, sheets } = openWorkbook(bytes);
  const grouped = Map.groupBy(changes, change => change.sheet);
  for (const [name, edits] of grouped) {
    const sheet = sheets.find(sheet => sheet.name === name && !sheet.hidden);
    if (!sheet) throw new Failure('invalid-cell');
    const xml = parseXml(archive[sheet.path]);
    patchSheet(xml, edits);
    archive[sheet.path] = serialize(xml);
  }
  let calc = descendants(workbook, 'calcPr')[0];
  if (!calc) {
    const root = workbook.documentElement;
    if (root) {
      calc = create(workbook, root, 'calcPr');
      const following = new Set(['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes',
        'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst']);
      const next = Array.from(root.childNodes).find(node => node.nodeType === 1 && following.has((node as Element).localName ?? ''));
      root.insertBefore(calc, next ?? null);
    }
  }
  if (calc && calc.getAttribute('calcMode') !== 'manual') {
    calc.setAttribute('fullCalcOnLoad', '1');
    archive[workbookPath] = serialize(workbook);
  }
  return zipSync(archive, { level: 3 });
}
