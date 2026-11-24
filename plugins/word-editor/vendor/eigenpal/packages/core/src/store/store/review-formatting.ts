import type { ReviewRevisionItem } from './review-items.ts';
// Formatting details for the review queue; language names belong to localized chrome.
import { WML_NAMESPACE_URI, type OoxmlElement } from '../package/ooxml-tree.ts';
import { readTwipsMeasure } from '../units.ts';
import type { RevisionSite } from './tree-op-revisions.ts';

export function changedLanguages(site: RevisionSite): string[] {
  if (!site.propertyChange || !site.parent) return [];
  const language = (
    properties: OoxmlElement | undefined,
    attribute: string
  ): string | undefined => {
    const lang = properties?.children.find(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === 'lang'
    );
    return lang && lang.kind !== 'textValue'
      ? lang.attributes.find(
          (entry) => entry.namespaceUri === WML_NAMESPACE_URI && entry.localName === attribute
        )?.value
      : undefined;
  };
  const previous = site.node.children.find(
    (child) => child.kind !== 'textValue' && child.localName === site.parent!.localName
  );
  const codes: string[] = [];
  for (const attribute of ['val', 'eastAsia', 'bidi']) {
    const current = language(site.parent, attribute);
    const old = language(previous?.kind !== 'textValue' ? previous : undefined, attribute);
    if (current && current !== old && !codes.includes(current)) codes.push(current);
  }
  return codes;
}

/** Direct formatting values that changed; null means return to inherited formatting. */
export type ReviewFormattingChange = NonNullable<ReviewRevisionItem['formattingChanges']>[number];

const FORMATTING_PROPERTIES: readonly {
  property: ReviewFormattingChange['property'];
  element: string;
  attribute: string;
  kind?: 'toggle' | 'halfPoints' | 'twips' | 'direction';
}[] = [
  { property: 'bold', element: 'b', attribute: 'val', kind: 'toggle' },
  { property: 'italic', element: 'i', attribute: 'val', kind: 'toggle' },
  { property: 'underline', element: 'u', attribute: 'val' },
  { property: 'strike', element: 'strike', attribute: 'val', kind: 'toggle' },
  { property: 'fontFamily', element: 'rFonts', attribute: 'ascii' },
  { property: 'fontSize', element: 'sz', attribute: 'val', kind: 'halfPoints' },
  { property: 'color', element: 'color', attribute: 'val' },
  { property: 'highlight', element: 'highlight', attribute: 'val' },
  { property: 'alignment', element: 'jc', attribute: 'val' },
  { property: 'leftIndent', element: 'ind', attribute: 'left', kind: 'twips' },
  { property: 'rightIndent', element: 'ind', attribute: 'right', kind: 'twips' },
  { property: 'firstLineIndent', element: 'ind', attribute: 'firstLine', kind: 'twips' },
  { property: 'hangingIndent', element: 'ind', attribute: 'hanging', kind: 'twips' },
  { property: 'spaceBefore', element: 'spacing', attribute: 'before', kind: 'twips' },
  { property: 'spaceAfter', element: 'spacing', attribute: 'after', kind: 'twips' },
  // Paragraph base direction, read as layout reads it: the last `w:bidi` wins, with the on/off
  // values layout honours. Only a paragraph's own properties carry it; a section's `w:bidi` is a
  // different setting.
  { property: 'direction', element: 'bidi', attribute: 'val', kind: 'direction' },
];

export function changedFormatting(site: RevisionSite): ReviewFormattingChange[] {
  if (!site.propertyChange || !site.parent) return [];
  const old = site.node.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === site.parent!.localName
  );
  const changes: ReviewFormattingChange[] = [];
  for (const spec of FORMATTING_PROPERTIES) {
    if (spec.kind === 'direction' && site.parent.localName !== 'pPr') continue;
    const valueOf = (properties: OoxmlElement | undefined): string | null => {
      const matches = (child: NonNullable<typeof properties>['children'][number]) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === spec.element;
      const children = properties?.children ?? [];
      const element =
        spec.kind === 'direction' ? [...children].reverse().find(matches) : children.find(matches);
      if (!element || element.kind === 'textValue') return null;
      const raw = element.attributes.find(
        (attr) => attr.namespaceUri === WML_NAMESPACE_URI && attr.localName === spec.attribute
      )?.value;
      if (spec.kind === 'toggle')
        return raw === '0' || raw === 'false' || raw === 'off' ? 'false' : 'true';
      if (spec.kind === 'direction')
        return raw === undefined || raw === '1' || raw === 'true' || raw === 'on' ? 'rtl' : 'ltr';
      if (raw === undefined) return null;
      if (spec.kind === 'halfPoints' || spec.kind === 'twips') {
        const numeric = spec.kind === 'twips' ? (readTwipsMeasure(raw) ?? Number.NaN) : Number(raw);
        return Number.isFinite(numeric)
          ? String(numeric / (spec.kind === 'halfPoints' ? 2 : 20))
          : raw;
      }
      return raw;
    };
    const value = valueOf(site.parent);
    if (value !== valueOf(old?.kind !== 'textValue' ? old : undefined))
      changes.push({ property: spec.property, value });
  }
  return changes;
}
