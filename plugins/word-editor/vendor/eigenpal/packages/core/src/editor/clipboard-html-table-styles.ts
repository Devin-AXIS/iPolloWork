import { tableSide } from './clipboard-table-direction.ts';
import { rowRevisionXml } from './clipboard-html-revisions.ts';
import {
  cssBackgroundFill,
  parseCssColor,
  parseCssLengthPt,
  parseInlineStyle,
  splitBorderTokens,
  tagOf,
} from './clipboard-html-styles.ts';

const MAX_TABLE_TWIPS = 31_680;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function widthPointsOf(element: Element): number | null {
  const styled = parseCssLengthPt(parseInlineStyle(element).get('width') ?? '');
  if (styled !== null && styled > 0) return styled;
  const attribute = element.getAttribute('width')?.trim();
  if (attribute === undefined || !/^\d{1,6}(\.\d+)?$/.test(attribute)) return null;
  const pixels = Number.parseFloat(attribute);
  return Number.isFinite(pixels) && pixels > 0 ? pixels * 0.75 : null;
}

function cellSpanOf(cell: Element): number {
  return htmlSpanOf(cell, 'colspan', 63);
}

export function tableRowsOf(table: Element): Element[] {
  return Array.from(table.children).flatMap((child) => {
    const tag = tagOf(child);
    if (tag === 'tr') return [child];
    if (tag !== 'thead' && tag !== 'tbody' && tag !== 'tfoot') return [];
    return Array.from(child.children).filter((inner) => tagOf(inner) === 'tr');
  });
}

export function htmlSpanOf(cell: Element, attribute: 'colspan' | 'rowspan', max: number): number {
  const raw = cell.getAttribute(attribute);
  if (raw === null || !/^\d{1,4}$/.test(raw.trim())) return 1;
  return clamp(Number.parseInt(raw, 10), 1, max);
}

/** Preferred table width for `w:tblW`. Percentage widths stay RELATIVE (type
 *  `pct`, fiftieths of a percent) and unsized tables stay `auto`, so the HOST
 *  document's content width decides — freezing them to a 6.5in dxa value would
 *  overflow narrower pages and never reflow on margin changes. Absolute widths
 *  emit dxa. `twips` is only the GRID basis for column ratios. */
export function tablePreferredWidth(
  table: Element,
  fallbackTwips: number
): { readonly xml: string; readonly twips: number } {
  const rawWidth = (
    parseInlineStyle(table).get('width') ??
    table.getAttribute('width') ??
    ''
  ).trim();
  const percent = /^(\d{1,3}(?:\.\d+)?)%$/.exec(rawWidth);
  if (percent) {
    const pct = clamp(Math.round(Number.parseFloat(percent[1]!) * 50), 50, 5000);
    return { xml: `<w:tblW w:w="${pct}" w:type="pct"/>`, twips: fallbackTwips };
  }
  const points = widthPointsOf(table);
  if (points === null) {
    return { xml: '<w:tblW w:w="0" w:type="auto"/>', twips: fallbackTwips };
  }
  const twips = clamp(Math.round(points * 20), 1, MAX_TABLE_TWIPS);
  return { xml: `<w:tblW w:w="${twips}" w:type="dxa"/>`, twips };
}

/** Map HTML table alignment to OOXML table justification. `text-align` is NOT a
 *  table-position signal — it centers the cells' inline text, never the table box. */
export function tableJustification(table: Element): 'left' | 'center' | 'right' | undefined {
  const style = parseInlineStyle(table);
  const positioned = style.get('mso-table-left')?.trim().toLowerCase();
  const value =
    (positioned === 'left' || positioned === 'center' || positioned === 'right'
      ? positioned
      : undefined) ?? table.getAttribute('align')?.trim().toLowerCase();
  return value === 'left' || value === 'center' || value === 'right' ? value : undefined;
}

/** Map Word's positioned-table CSS to bounded `w:tblpPr` attributes. */
export function tablePositionXml(table: Element): string {
  const style = parseInlineStyle(table);
  const horizontal = style.get('mso-table-anchor-horizontal')?.trim().toLowerCase();
  const vertical = style.get('mso-table-anchor-vertical')?.trim().toLowerCase();
  if (horizontal === undefined && vertical === undefined) return '';
  const anchor = (value: string | undefined): 'text' | 'margin' | 'page' =>
    value === 'margin' || value === 'page' ? value : 'text';
  let attributes = ` w:horzAnchor="${anchor(horizontal)}"` + ` w:vertAnchor="${anchor(vertical)}"`;
  const left = style.get('mso-table-left')?.trim().toLowerCase();
  if (left === 'left' || left === 'center' || left === 'right') {
    attributes += ` w:tblpXSpec="${left}"`;
  } else {
    const x = parseCssLengthPt(left ?? '');
    if (x !== null)
      attributes += ` w:tblpX="${clamp(Math.round(x * 20), -MAX_TABLE_TWIPS, MAX_TABLE_TWIPS)}"`;
  }
  const top = parseCssLengthPt(style.get('mso-table-top') ?? '');
  if (top !== null) {
    attributes += ` w:tblpY="${clamp(Math.round(top * 20), -MAX_TABLE_TWIPS, MAX_TABLE_TWIPS)}"`;
  }
  return `<w:tblpPr${attributes}/>`;
}

/**
 * Infer a fixed table grid from the row with the most explicit cell-width coverage.
 * Word writes matching `width` CSS and attributes, including on colspan cells.
 */
export function tableColumnWidths(
  rows: readonly Element[],
  columns: number,
  totalTwips: number
): readonly number[] {
  const equal = Math.max(1, Math.floor(totalTwips / columns));
  let bestScore = -1;
  let best = Array.from({ length: columns }, () => equal);
  // Track rowspan carry-over the way the cell placement walk does, so a row's widths
  // land in the grid columns its cells actually occupy.
  type Carry = { remaining: number; readonly span: number };
  const carry: Array<Carry | null> = new Array<Carry | null>(columns).fill(null);
  for (const row of rows) {
    const candidate = Array.from({ length: columns }, () => equal);
    let score = 0;
    let column = 0;
    // Snapshot the carries entering THIS row, then age every entry exactly once —
    // the same discipline as the cell placement walk.
    const carriedNow: Array<number | null> = carry.map((entry) => (entry ? entry.span : null));
    for (let index = 0; index < columns; index += 1) {
      const entry = carry[index];
      if (entry) {
        entry.remaining -= 1;
        if (entry.remaining <= 0) carry[index] = null;
      }
    }
    const cells = Array.from(row.children).filter((cell) => /^t[dh]$/.test(tagOf(cell)));
    let sourceAt = 0;
    while (column < columns) {
      const carriedSpan = carriedNow[column];
      if (carriedSpan !== null) {
        column += carriedSpan;
        continue;
      }
      const cell = cells[sourceAt];
      if (cell === undefined) break;
      sourceAt += 1;
      // Clamp at the next carried column exactly like the cell placement walk, or
      // a width would spread across grid columns the emitted cell never occupies.
      let span = Math.min(cellSpanOf(cell), columns - column);
      for (let ahead = column + 1; ahead < column + span; ahead += 1) {
        if (carriedNow[ahead] !== null) {
          span = ahead - column;
          break;
        }
      }
      const rowSpan = htmlSpanOf(cell, 'rowspan', 1000);
      if (rowSpan > 1) carry[column] = { remaining: rowSpan - 1, span };
      const points = widthPointsOf(cell);
      if (points !== null) {
        // Clamp per column so a hostile huge width cannot overflow the later
        // normalization into NaN attribute values.
        const each = clamp(Math.round((points * 20) / span), 1, MAX_TABLE_TWIPS);
        for (let offset = 0; offset < span; offset += 1) candidate[column + offset] = each;
        score += span;
      }
      column += span;
    }
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  const sourceTotal = best.reduce((sum, width) => sum + width, 0);
  if (sourceTotal <= 0) return best;
  const normalized = best.map((width) =>
    Math.max(1, Math.round((width * totalTwips) / sourceTotal))
  );
  const correction = totalTwips - normalized.reduce((sum, width) => sum + width, 0);
  normalized[normalized.length - 1] = Math.max(1, normalized[normalized.length - 1]! + correction);
  return normalized;
}

/** Sum the inferred grid columns covered by one table cell. */
export function tableSpanWidth(widths: readonly number[], column: number, span: number): number {
  let total = 0;
  for (let offset = 0; offset < span; offset += 1) total += widths[column + offset] ?? 0;
  return Math.max(1, total);
}

type BorderValue = {
  readonly val: 'single' | 'double' | 'dotted' | 'dashed' | 'nil';
  readonly size: number;
  readonly color: string;
};

const BORDER_VALUES: ReadonlyMap<string, BorderValue['val']> = new Map([
  ['solid', 'single'],
  ['double', 'double'],
  ['dotted', 'dotted'],
  ['dashed', 'dashed'],
  ['none', 'nil'],
  ['hidden', 'nil'],
]);

const BORDER_WIDTH_KEYWORD_PT: ReadonlyMap<string, number> = new Map([
  ['thin', 0.75],
  ['medium', 2.25],
  ['thick', 3.75],
]);

function borderSizeOf(points: number): number {
  return clamp(Math.round(points * 8), 2, 96);
}

function borderValueOf(value: string | undefined): BorderValue | undefined {
  if (value === undefined || value.length === 0 || value.length > 128) return undefined;
  let val: BorderValue['val'] | undefined;
  let points: number | undefined;
  let color: string | undefined;
  for (const token of splitBorderTokens(value)) {
    const mapped = BORDER_VALUES.get(token.toLowerCase());
    if (mapped !== undefined) {
      val = mapped;
      continue;
    }
    const length = BORDER_WIDTH_KEYWORD_PT.get(token.toLowerCase()) ?? parseCssLengthPt(token);
    if (length !== null) {
      points = length;
      continue;
    }
    const parsedColor = parseCssColor(token);
    if (parsedColor !== null) {
      color = parsedColor;
      continue;
    }
    return undefined;
  }
  if (val === undefined) return undefined;
  if (val === 'nil') return { val, size: 0, color: color ?? 'auto' };
  // A visible style with no width takes Word's default hairline, like `border:solid`.
  if (points === undefined) return { val, size: 4, color: color ?? '000000' };
  if (points <= 0) return undefined;
  return { val, size: borderSizeOf(points), color: color ?? '000000' };
}

/** Compose a border from `-style`/`-width`/`-color` longhands when no shorthand is set. */
function longhandBorderOf(
  style: ReadonlyMap<string, string>,
  prefix: string
): BorderValue | undefined {
  const styleValue = style.get(`${prefix}-style`)?.trim();
  if (styleValue === undefined || styleValue.length === 0 || styleValue.length > 64) {
    return undefined;
  }
  const val = BORDER_VALUES.get(styleValue.split(/\s+/)[0]!.toLowerCase());
  if (val === undefined) return undefined;
  if (val === 'nil') return { val, size: 0, color: 'auto' };
  const widthToken = style.get(`${prefix}-width`)?.trim().split(/\s+/)[0];
  const points =
    widthToken === undefined || widthToken.length > 64
      ? null
      : (BORDER_WIDTH_KEYWORD_PT.get(widthToken.toLowerCase()) ?? parseCssLengthPt(widthToken));
  if (points !== null && points <= 0) return undefined;
  const colorToken = style.get(`${prefix}-color`)?.trim().split(/\s+/)[0];
  const color =
    colorToken === undefined || colorToken.length > 64 ? null : parseCssColor(colorToken);
  return {
    val,
    size: points === null ? 4 : borderSizeOf(points),
    color: color ?? '000000',
  };
}

function borderElementXml(name: string, border: BorderValue): string {
  return (
    `<w:${name} w:val="${border.val}" w:sz="${border.size}" ` +
    `w:space="0" w:color="${border.color}"/>`
  );
}

/** Preserve Word's table border styles instead of replacing them with generic black lines. */
export function tableBordersXml(table: Element, rtl = false): string {
  const style = parseInlineStyle(table);
  // Per-PARSE fallback: an mso-border-alt token outside the parser must not
  // shadow the parseable CSS shorthand beside it.
  const common =
    borderValueOf(style.get('mso-border-alt')) ??
    borderValueOf(style.get('border')) ??
    longhandBorderOf(style, 'border');
  const fallback =
    common ??
    (table.getAttribute('border')?.trim() && table.getAttribute('border')?.trim() !== '0'
      ? { val: 'single' as const, size: 4, color: 'auto' }
      : undefined);
  const names = [
    ['top', 'top'],
    ['left', 'left'],
    ['bottom', 'bottom'],
    ['right', 'right'],
    ['insideH', 'insideh'],
    ['insideV', 'insidev'],
  ] as const;
  let inner = '';
  for (const [xmlName, physicalName] of names) {
    const cssName = tableSide(physicalName, rtl);
    const border =
      borderValueOf(style.get(`mso-border-${cssName}-alt`)) ??
      borderValueOf(style.get(`mso-border-${cssName}`)) ??
      borderValueOf(style.get(`border-${cssName}`)) ??
      longhandBorderOf(style, `border-${cssName}`) ??
      fallback;
    if (border !== undefined) inner += borderElementXml(xmlName, border);
  }
  return inner.length > 0 ? `<w:tblBorders>${inner}</w:tblBorders>` : '';
}

/** Preserve a bounded Word row height and its exact/at-least rule, and a tracked row. */
export function tableRowPropertiesXml(row: Element): string {
  const style = parseInlineStyle(row);
  // `w:ins` / `w:del` follow the row properties in `CT_TrPr`.
  const revisions = rowRevisionXml(style);
  const points = parseCssLengthPt(style.get('height') ?? '');
  if (points === null || points <= 0) return revisions ? `<w:trPr>${revisions}</w:trPr>` : '';
  const height = clamp(Math.round(points * 20), 1, MAX_TABLE_TWIPS);
  const rule = style.get('mso-height-rule')?.trim().toLowerCase();
  const hRule = rule === 'exactly' ? 'exact' : 'atLeast';
  return `<w:trPr><w:trHeight w:val="${height}" w:hRule="${hRule}"/>${revisions}</w:trPr>`;
}

function cellMarginsXml(style: ReadonlyMap<string, string>, rtl: boolean): string {
  const edges: Record<'top' | 'right' | 'bottom' | 'left', number | null> = {
    top: null,
    right: null,
    bottom: null,
    left: null,
  };
  const value = style.get('padding');
  if (value !== undefined && value.length <= 128) {
    const parsed = value
      .trim()
      .split(/\s+/)
      .map((token) => parseCssLengthPt(token));
    if (
      parsed.length >= 1 &&
      parsed.length <= 4 &&
      !parsed.some((item) => item === null || item < 0)
    ) {
      const [top, right = top, bottom = top, left = right] =
        parsed.length === 2
          ? [parsed[0], parsed[1], parsed[0], parsed[1]]
          : parsed.length === 3
            ? [parsed[0], parsed[1], parsed[2], parsed[1]]
            : parsed;
      edges.top = top ?? null;
      edges.right = right ?? null;
      edges.bottom = bottom ?? null;
      edges.left = left ?? null;
    }
  }
  // The outbound writer emits `padding-<edge>` longhands; they override the shorthand.
  for (const name of ['top', 'right', 'bottom', 'left'] as const) {
    const points = parseCssLengthPt(style.get(`padding-${name}`) ?? '');
    if (points !== null && points >= 0) edges[name] = points;
  }
  let inner = '';
  // CT_TcMar sequence order: top, left, bottom, right.
  for (const name of ['top', 'left', 'bottom', 'right'] as const) {
    const physical = tableSide(name, rtl) as keyof typeof edges;
    const points = edges[physical];
    if (points === null) continue;
    inner += `<w:${name} w:w="${clamp(Math.round(points * 20), 0, MAX_TABLE_TWIPS)}" w:type="dxa"/>`;
  }
  return inner.length > 0 ? `<w:tcMar>${inner}</w:tcMar>` : '';
}

/** Emit cell borders, shading, margins, and vertical alignment in CT_TcPr order. */
export function cellCssPropertiesXml(cell: Element, rtl = false): string {
  const style = parseInlineStyle(cell);
  // Per-PARSE fallback, same rule as tableBordersXml.
  const common =
    borderValueOf(style.get('mso-border-alt')) ??
    borderValueOf(style.get('border')) ??
    longhandBorderOf(style, 'border');
  let borders = '';
  for (const name of ['top', 'left', 'bottom', 'right'] as const) {
    const edge = tableSide(name, rtl);
    const border =
      borderValueOf(style.get(`mso-border-${edge}-alt`)) ??
      borderValueOf(style.get(`mso-border-${edge}`)) ??
      borderValueOf(style.get(`border-${edge}`)) ??
      longhandBorderOf(style, `border-${edge}`) ??
      common;
    if (border !== undefined) borders += borderElementXml(name, border);
  }
  let xml = borders.length > 0 ? `<w:tcBorders>${borders}</w:tcBorders>` : '';
  const fill = cssBackgroundFill(style);
  if (fill) xml += `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`;
  xml += cellMarginsXml(style, rtl);
  const vertical =
    style.get('vertical-align')?.toLowerCase() ?? cell.getAttribute('valign')?.toLowerCase();
  if (vertical === 'top') xml += '<w:vAlign w:val="top"/>';
  else if (vertical === 'middle' || vertical === 'center') {
    xml += '<w:vAlign w:val="center"/>';
  } else if (vertical === 'bottom') xml += '<w:vAlign w:val="bottom"/>';
  return xml;
}
