import { numberingFontInputs } from './numbering-font-inputs.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import type { ThemeFonts } from '../layout/run-style.ts';
import { createEastAsianLanguageFontScanner } from '../layout/east-asian-font-families.ts';
import type { TreeDocxSessionView } from '../binding/tree-session-contract.ts';
import {
  symbolFieldFontFamilies,
  usedNumberingFontFamilies,
} from '../layout/synthesized-font-families.ts';

const cache = new WeakMap<
  TreeDocxSessionView,
  {
    eastAsianFonts: ReturnType<typeof createEastAsianLanguageFontScanner>;
    revision: number;
    families: readonly string[];
    numberingInputs: readonly string[];
    numberingFamilies: readonly string[];
    numberingRoot: OoxmlElement | null;
    stylesRoot: OoxmlElement | null;
    theme: ThemeFonts;
  }
>();

/** Each session's East Asian scanner, so a warm-up and the full read share its cache. */
const scanners = new WeakMap<
  TreeDocxSessionView,
  ReturnType<typeof createEastAsianLanguageFontScanner>
>();

function scannerOf(session: TreeDocxSessionView) {
  let scanner = scanners.get(session);
  if (!scanner) scanners.set(session, (scanner = createEastAsianLanguageFontScanner()));
  return scanner;
}

/**
 * Scan `blocks`, a run of body blocks, into the subtree caches that
 * {@link resolverGlyphFontFamilies} reads. The full read after a warm-up over the whole body
 * finds every block cached, so a caller can spread the first scan over several tasks.
 */
export function warmResolverGlyphFontFamilies(
  session: TreeDocxSessionView,
  blocks: readonly OoxmlElement[]
): void {
  scannerOf(session)(blocks, session.stylesRoot(), session.documentThemeFonts());
  symbolFieldFontFamilies(blocks);
  numberingFontInputs(blocks);
}

/**
 * {@link warmResolverGlyphFontFamilies} for rows `[from, to)` of one top-level body table, so a
 * long table's scan also runs in short tasks. Answers the table's row count.
 */
export function warmResolverGlyphFontTableRows(
  session: TreeDocxSessionView,
  table: OoxmlElement,
  from: number,
  to: number
): number {
  const rows = scannerOf(session).warmTableRows(
    table,
    from,
    to,
    session.stylesRoot(),
    session.documentThemeFonts()
  );
  // These two read every child with one scope, so a row can stand in for its table.
  const children = (table.children as readonly OoxmlElement[]).slice(from, to);
  symbolFieldFontFamilies(children);
  numberingFontInputs(children);
  return Math.max(rows, table.children.length);
}

/** Rendered faces absent from declarations use the resolver's reserved share. */
export function resolverGlyphFontFamilies(session: TreeDocxSessionView): readonly string[] {
  const revision = session.packageRevision();
  const cached = cache.get(session);
  if (cached?.revision === revision) return cached.families;
  const eastAsianFonts = cached?.eastAsianFonts ?? scannerOf(session);
  const roots = session.storyParts().map((part) => part.root);
  const stylesRoot = session.stylesRoot();
  const numberingRoot = session.numberingRoot();
  const theme = session.documentThemeFonts();
  const numberingInputs = numberingFontInputs(roots);
  const numberingUnchanged =
    cached &&
    cached.stylesRoot === stylesRoot &&
    cached.numberingRoot === numberingRoot &&
    cached.theme === theme &&
    cached.numberingInputs.length === numberingInputs.length &&
    cached.numberingInputs.every((input, index) => input === numberingInputs[index]);
  const numberingFamilies = numberingUnchanged
    ? cached.numberingFamilies
    : usedNumberingFontFamilies(roots, numberingRoot, stylesRoot, theme);
  const families = [
    ...session.symbolFontFamilies(),
    ...eastAsianFonts(roots, stylesRoot, theme),
    ...symbolFieldFontFamilies(roots),
    ...numberingFamilies,
  ];
  cache.set(session, {
    eastAsianFonts,
    revision,
    families,
    numberingInputs,
    numberingFamilies,
    numberingRoot,
    stylesRoot,
    theme,
  });
  return families;
}
