// The defaults the application supplies when a document omits its own (§17.7.5).
//
// Each half of `w:docDefaults` falls back on its own. An omitted `w:rPrDefault` gives runs
// application kerning and 12pt in both size lanes; an omitted `w:pPrDefault` gives paragraphs
// 8pt after and 278/240 automatic line spacing. A package with no styles part, and a styles
// part with no `w:docDefaults`, omit both halves. An authored empty half keeps the format
// defaults (10pt, no spacing), and so does an `w:rPrDefault` without `w:sz`. Layout, the
// formatting readers, and the clipboard all read omission here, so they agree on one answer.

import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from './ooxml-tree.ts';
import type { OoxmlProperty } from '../store/tree-op-types.ts';
import { propertyElement } from '../store/tree-op-properties.ts';

/** The run size an omitted `w:rPrDefault` supplies, in half-points. */
export const APPLICATION_FONT_SIZE_HALF_POINTS = 24;

/** Run properties an omitted `w:rPrDefault` supplies. */
export const APPLICATION_RUN_PROPERTIES: readonly OoxmlProperty[] = Object.freeze([
  Object.freeze({ localName: 'kern', attributes: Object.freeze({ val: '2' }) }),
  Object.freeze({
    localName: 'sz',
    attributes: Object.freeze({ val: String(APPLICATION_FONT_SIZE_HALF_POINTS) }),
  }),
  Object.freeze({
    localName: 'szCs',
    attributes: Object.freeze({ val: String(APPLICATION_FONT_SIZE_HALF_POINTS) }),
  }),
]);

/** Paragraph properties an omitted `w:pPrDefault` supplies. */
export const APPLICATION_PARAGRAPH_PROPERTIES: readonly OoxmlProperty[] = Object.freeze([
  Object.freeze({
    localName: 'spacing',
    attributes: Object.freeze({ after: '160', line: '278', lineRule: 'auto' }),
  }),
]);

/** Which halves of the document defaults a styles part leaves to the application. */
export interface OmittedDocDefaults {
  readonly run: boolean;
  readonly paragraph: boolean;
}

const BOTH: OmittedDocDefaults = Object.freeze({ run: true, paragraph: true });
const NEITHER: OmittedDocDefaults = Object.freeze({ run: false, paragraph: false });

/** The halves a `w:docDefaults` element leaves out; a missing element leaves out both. */
export function omittedHalves(docDefaults: OoxmlElement | null | undefined): OmittedDocDefaults {
  if (!docDefaults) return BOTH;
  const has = (localName: string): boolean =>
    docDefaults.children.some(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === localName
    );
  return { run: !has('rPrDefault'), paragraph: !has('pPrDefault') };
}

/**
 * The halves a reader leaves to the application, judged on the `w:docDefaults` element it took
 * from `stylesRoot`. A root outside the WordprocessingML namespace is not a styles part, so it
 * supplies nothing; `null` is a package with no styles part.
 */
export function omittedFor(
  stylesRoot: OoxmlElement | null,
  docDefaults: OoxmlElement | null | undefined
): OmittedDocDefaults {
  if (stylesRoot && stylesRoot.namespaceUri !== WML_NAMESPACE_URI) return NEITHER;
  return omittedHalves(docDefaults);
}

/**
 * The halves of `w:docDefaults` a styles root omits, read from the first `w:docDefaults` as
 * layout reads it. `null` is a package with no styles part. A root outside the
 * WordprocessingML namespace is not a styles part, so it supplies nothing.
 */
export function omittedDocDefaults(stylesRoot: OoxmlElement | null): OmittedDocDefaults {
  if (!stylesRoot) return BOTH;
  if (stylesRoot.namespaceUri !== WML_NAMESPACE_URI) return NEITHER;
  return omittedHalves(firstDocDefaults(stylesRoot));
}

function wmlElement(
  kind: string,
  localName: string,
  id: string,
  children: readonly OoxmlNode[]
): OoxmlElement {
  return {
    id,
    kind,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children,
  } as unknown as OoxmlElement;
}

/** A `w:rPr` or `w:pPr` holding the application's properties for an omitted default half. */
export function applicationDefaultsContainer(
  localName: 'rPr' | 'pPr',
  idPrefix: string
): OoxmlElement {
  const properties =
    localName === 'rPr' ? APPLICATION_RUN_PROPERTIES : APPLICATION_PARAGRAPH_PROPERTIES;
  return wmlElement(
    localName === 'rPr' ? 'runProperties' : 'paragraphProperties',
    localName,
    `${idPrefix}-${localName}`,
    properties.map((property) =>
      propertyElement(property, `${idPrefix}-${localName}-${property.localName}`)
    )
  );
}

/** The `w:docDefaults` layout reads: the first one, as `readDocDefaults` does. */
function firstDocDefaults(stylesRoot: OoxmlElement): OoxmlElement | undefined {
  const found = stylesRoot.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'docDefaults'
  );
  return found && found.kind !== 'textValue' ? (found as OoxmlElement) : undefined;
}

/**
 * `authored`, the `w:docDefaults` a reader takes from `stylesRoot`, with every omitted half
 * stated as the application's properties, so a copy of the document carries what it painted.
 * A root outside the WordprocessingML namespace supplies nothing, so `authored` stays as is.
 */
export function explicitDocDefaults(
  stylesRoot: OoxmlElement | null,
  authored: OoxmlElement | null,
  idPrefix: string
): OoxmlElement | null {
  const omitted = omittedFor(stylesRoot, authored);
  if (!omitted.run && !omitted.paragraph) return authored;
  const stated: OoxmlNode[] = [];
  if (omitted.run)
    stated.push(
      wmlElement('generic', 'rPrDefault', `${idPrefix}-rPrDefault`, [
        applicationDefaultsContainer('rPr', idPrefix),
      ])
    );
  if (omitted.paragraph)
    stated.push(
      wmlElement('generic', 'pPrDefault', `${idPrefix}-pPrDefault`, [
        applicationDefaultsContainer('pPr', idPrefix),
      ])
    );
  // CT_DocDefaults is a sequence: rPrDefault, then pPrDefault.
  const children = omitted.run
    ? [...stated, ...(authored?.children ?? [])]
    : [...(authored?.children ?? []), ...stated];
  return authored
    ? ({ ...authored, children } as OoxmlElement)
    : wmlElement('generic', 'docDefaults', `${idPrefix}-docDefaults`, children);
}
