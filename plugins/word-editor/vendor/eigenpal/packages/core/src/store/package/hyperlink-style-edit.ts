// The built-in `Hyperlink` character style, added to a document that does not define it yet
// when the first link is inserted, so a new link is visibly a link.

import type { OoxmlPackage } from './ooxml-package.ts';
import { stylesPartOf } from './ooxml-indexes.ts';
import { collectThemeColorScheme, packageThemeRoot } from './theme-color-resolution.ts';
import {
  defaultStyleIdOf,
  ensureStyleDefinition,
  markDocumentSetupEdit,
  styleElementsOf,
} from './style-definition-edit.ts';

/** The default Office theme's `hlink` color, used when the document has no theme. */
const DEFAULT_HYPERLINK_HEX = '0563C1';
const HEX = /^[0-9A-Fa-f]{6}$/;

/**
 * The style id to give a new hyperlink character style: `Hyperlink`, or the first free
 * `HyperlinkN` when another style already uses that id (a paragraph style, for example).
 */
export function freeHyperlinkStyleId(usedIds: ReadonlySet<string>): string {
  const taken = new Set([...usedIds].map((id) => id.toLowerCase()));
  if (!taken.has('hyperlink')) return 'Hyperlink';
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `Hyperlink${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * A package edit that defines the hyperlink character style: the theme's hyperlink color
 * (a literal value plus the `hyperlink` theme reference, or the default literal value when
 * the document has no theme) and a single underline, based on the default character style
 * when the document has one.
 */
export function ensureHyperlinkStyle(styleId: string): (pkg: OoxmlPackage) => OoxmlPackage {
  return markDocumentSetupEdit((pkg) => {
    const themeHex = collectThemeColorScheme(packageThemeRoot(pkg)).get('hlink');
    const themed = themeHex !== undefined && HEX.test(themeHex);
    // The theme reference only where the document has a theme: without one, a reader resolves
    // `hyperlink` against its own default theme, and the link shows a color the file never
    // states. The literal value then says exactly what every reader paints.
    const color: Record<string, string> = themed
      ? { val: themeHex.toUpperCase(), themeColor: 'hyperlink' }
      : { val: DEFAULT_HYPERLINK_HEX };
    return ensureStyleDefinition(styleId, (element, stylesRoot) => {
      const basedOn = defaultStyleIdOf(stylesRoot, 'character');
      return element('style', { type: 'character', styleId }, [
        element('name', { val: 'Hyperlink' }),
        ...(basedOn ? [element('basedOn', { val: basedOn })] : []),
        element('uiPriority', { val: '99' }),
        element('unhideWhenUsed'),
        element('rPr', {}, [element('color', color), element('u', { val: 'single' })]),
      ]);
    })(pkg);
  });
}

/**
 * The hyperlink character style id a new link should name, and the package edit that
 * defines it when the document does not. A character style matches by id `Hyperlink` first,
 * then by name `Hyperlink` (a localized id, or a `HyperlinkN` added here), case-insensitively.
 *
 * With `add` false, or with `createPart` false and no styles part, a document without the
 * style gets no edit and a null id: the link takes no style. A collaboration session never
 * creates the styles part: two participants who each created it while apart would leave the
 * main part with two styles relationships.
 */
export function hyperlinkStyleFor(
  pkg: OoxmlPackage | null,
  options: { readonly add?: boolean; readonly createPart?: boolean } = {}
): {
  readonly styleId: string | null;
  readonly edit: ((pkg: OoxmlPackage) => OoxmlPackage) | null;
} {
  const root = pkg ? (stylesPartOf(pkg)?.root ?? null) : null;
  const used = new Set<string>();
  let named: string | null = null;
  for (const style of root ? styleElementsOf(root) : []) {
    const id = style.attributes.find((a) => a.localName === 'styleId')?.value;
    if (!id) continue;
    used.add(id);
    if (style.attributes.find((a) => a.localName === 'type')?.value !== 'character') continue;
    if (id.toLowerCase() === 'hyperlink') return { styleId: id, edit: null };
    const name = style.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'name'
    );
    const value =
      name && name.kind !== 'textValue'
        ? name.attributes.find((a) => a.localName === 'val')?.value
        : undefined;
    if (named === null && value?.toLowerCase() === 'hyperlink') named = id;
  }
  if (named !== null) return { styleId: named, edit: null };
  if (options.add === false || (options.createPart === false && !root)) {
    return { styleId: null, edit: null };
  }
  const styleId = freeHyperlinkStyleId(used);
  return { styleId, edit: ensureHyperlinkStyle(styleId) };
}
