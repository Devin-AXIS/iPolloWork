// Resolve language-selected font needs through the same cascade and slots as layout.
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { validFontFamily } from '../store/package/run-defaults.ts';
import {
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  cascadeRunProperties,
  type TableCellStyleFormatting,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { piecesOfParagraph } from './field-projection.ts';
import { readTableStructure } from './semantic-table.ts';
import type { ThemeFonts } from './run-style.ts';
import { createFontFamilyTreeCache, fontScanChildren } from './font-family-tree-cache.ts';

interface ScanContext {
  readonly key: string;
  readonly baseKey: string;
  readonly styles: StyleCascadeTable;
  readonly theme: ThemeFonts;
  readonly supplementalFamilies: ReadonlySet<string>;
  readonly cellStyle?: TableCellStyleFormatting;
  readonly depth: number;
}

/**
 * One string and one context per distinct cell scope. Every cell built its own key string
 * and context, and the subtree cache kept them, one per cell of every table.
 */
const cellContexts = new WeakMap<ScanContext, Map<string, ScanContext>>();
const MAX_CELL_CONTEXTS = 4096;

function cellContext(
  context: ScanContext,
  cellStyle: TableCellStyleFormatting | undefined
): ScanContext {
  const key = `${context.baseKey}|${context.depth + 1}|${JSON.stringify(cellStyle)}`;
  let known = cellContexts.get(context);
  if (!known) cellContexts.set(context, (known = new Map()));
  const cached = known.get(key);
  if (cached) return cached;
  const next = { ...context, depth: context.depth + 1, cellStyle, key };
  if (known.size < MAX_CELL_CONTEXTS) known.set(key, next);
  return next;
}

function inspectFontNode(node: OoxmlElement, context: ScanContext) {
  const { styles, theme, supplementalFamilies, depth } = context;
  if (node.kind === 'table') {
    const structure = readTableStructure(node, 468, depth, styles);
    const children = [];
    for (const row of structure?.rows ?? []) {
      for (const cell of row.cells) {
        const next = cellContext(context, cell.styleFormatting);
        for (const block of cell.blocks) children.push({ node: block, context: next });
      }
    }
    return { children: children.reverse() };
  }
  const families = new Set<string>();
  if (node.kind === 'paragraph') {
    const pPr = node.children.find((child) => child.kind === 'paragraphProperties');
    const inherited = cascadeParagraphFormatting(styles, pPr, context.cellStyle).runProperties;
    for (const piece of piecesOfParagraph(
      node,
      inherited,
      undefined,
      (base, direct) => cascadeRunProperties(base, direct, styles),
      undefined,
      undefined,
      'all-markup',
      undefined,
      undefined,
      theme
    )) {
      if (!piece.text) continue;
      if (piece.fontSlot !== 'eastAsia' && !supplementalFamilies.has(piece.style.fontFamily ?? ''))
        continue;
      const family = validFontFamily(
        (piece.fontSlot === 'eastAsia' ? piece.style.fontFamilyEastAsia : piece.style.fontFamily) ??
          undefined
      );
      if (family) families.add(family);
    }
  }
  const next =
    node.localName === 'txbxContent'
      ? { ...context, cellStyle: undefined, key: `${context.baseKey}|${depth}|undefined` }
      : context;
  return { families: [...families], children: fontScanChildren(node, next).reverse() };
}

/** A live scanner, plus a warm-up for one long table a few rows at a time. */
export type EastAsianLanguageFontScanner = ((
  roots: readonly OoxmlElement[],
  stylesRoot: OoxmlElement | null,
  theme: ThemeFonts
) => readonly string[]) & {
  /**
   * Scan rows `[from, to)` of the top-level `table` into the cache a full read uses, with the
   * same cell scopes. Answers the row count, so a caller knows when it is done.
   */
  warmTableRows(
    table: OoxmlElement,
    from: number,
    to: number,
    stylesRoot: OoxmlElement | null,
    theme: ThemeFonts
  ): number;
};

/** Reusable discovery belongs to the live editor session that needs incremental updates. */
export function createEastAsianLanguageFontScanner(): EastAsianLanguageFontScanner {
  const scan = createFontFamilyTreeCache(inspectFontNode);
  let previousContext: ScanContext | undefined;
  let previousStylesRoot: OoxmlElement | null | undefined;
  const contextFor = (stylesRoot: OoxmlElement | null, theme: ThemeFonts): ScanContext => {
    if (!previousContext || previousStylesRoot !== stylesRoot || previousContext.theme !== theme) {
      const styles = buildStyleCascadeTable(stylesRoot, theme);
      previousStylesRoot = stylesRoot;
      previousContext = {
        key: `${styles.cacheToken}|0|undefined`,
        baseKey: styles.cacheToken,
        styles,
        theme,
        depth: 0,
        supplementalFamilies: new Set([
          ...Object.values(theme.majorSupplemental ?? {}),
          ...Object.values(theme.minorSupplemental ?? {}),
        ]),
      };
    }
    return previousContext;
  };
  const scanner = (
    roots: readonly OoxmlElement[],
    stylesRoot: OoxmlElement | null,
    theme: ThemeFonts
  ) => scan([...roots].reverse(), contextFor(stylesRoot, theme));
  return Object.assign(scanner, {
    warmTableRows(
      table: OoxmlElement,
      from: number,
      to: number,
      stylesRoot: OoxmlElement | null,
      theme: ThemeFonts
    ): number {
      const context = contextFor(stylesRoot, theme);
      // The same structure and cell scopes `inspectFontNode` gives a table at the top level.
      const rows = readTableStructure(table, 468, context.depth, context.styles)?.rows ?? [];
      for (const row of rows.slice(from, to)) {
        for (const cell of row.cells) scan(cell.blocks, cellContext(context, cell.styleFormatting));
      }
      return rows.length;
    },
  });
}

/** One-shot export discovery releases its subtree cache before layout allocates its live set. */
export function eastAsianLanguageFontFamilies(
  roots: readonly OoxmlElement[],
  stylesRoot: OoxmlElement | null,
  theme: ThemeFonts
): readonly string[] {
  return createEastAsianLanguageFontScanner()(roots, stylesRoot, theme);
}
