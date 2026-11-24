import { combineStyleToggles } from './style-toggles.ts';
import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import type { ResolvedRunStyle } from './run-style.ts';

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const VALUES = new Set([
  'none',
  'standard',
  'contextual',
  'historical',
  'discretional',
  'standardContextual',
  'standardHistorical',
  'contextualHistorical',
  'standardDiscretional',
  'contextualDiscretional',
  'historicalDiscretional',
  'standardContextualHistorical',
  'standardContextualDiscretional',
  'standardHistoricalDiscretional',
  'contextualHistoricalDiscretional',
  'all',
]);

export function runLigaturesValue(node: OoxmlElement): string | undefined {
  if (node.namespaceUri !== W14 || node.localName !== 'ligatures') return undefined;
  return node.attributes.find((a) => a.namespaceUri === W14 && a.localName === 'val')?.value;
}

export function resolveRunLigatures(value: string | undefined): ResolvedRunStyle['ligatures'] {
  if (!value || !VALUES.has(value)) return undefined;
  const normalized = value.toLowerCase();
  return {
    standard: value === 'all' || normalized.includes('standard'),
    contextual: value === 'all' || normalized.includes('contextual'),
    historical: value === 'all' || normalized.includes('historical'),
    discretionary: value === 'all' || normalized.includes('discretional'),
  };
}

/** Optional substitutions only; required script shaping (rlig, ccmp, etc.) stays enabled. */
export function runLigatureFeatures(style: ResolvedRunStyle): Record<string, number> {
  return {
    liga: style.ligatures?.standard ? 1 : 0,
    clig: style.ligatures?.contextual ? 1 : 0,
    hlig: style.ligatures?.historical ? 1 : 0,
    dlig: style.ligatures?.discretionary ? 1 : 0,
  };
}

export function runLigatureFeatureKey(style: ResolvedRunStyle): string {
  return `${style.ligatures?.standard ? 1 : 0}${style.ligatures?.contextual ? 1 : 0}${style.ligatures?.historical ? 1 : 0}${style.ligatures?.discretionary ? 1 : 0}`;
}

const NO_OPTIONAL_LIGATURES: readonly OoxmlProperty[] = Object.freeze([
  Object.freeze({ localName: 'ligatures', attributes: Object.freeze({ val: 'none' }) }),
]);

export function applyLigatureCompatibility(
  properties: readonly OoxmlProperty[],
  disabled: boolean | undefined
): readonly OoxmlProperty[] {
  if (
    !disabled ||
    !properties.some((p) => p.localName === 'ligatures' && p.attributes?.val !== 'none')
  )
    return properties;
  // Preserve carried toggle state when appending the compatibility override.
  return combineStyleToggles([
    { properties, role: 'carried', emit: true },
    { properties: NO_OPTIONAL_LIGATURES, role: 'direct', emit: true },
  ]);
}
