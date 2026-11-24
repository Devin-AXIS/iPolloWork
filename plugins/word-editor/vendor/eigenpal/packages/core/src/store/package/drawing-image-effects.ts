import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

/** Picture color adjustments shared by projection, layout, and paint.
 * @public
 */
export interface DrawingImageEffects {
  /** Fixed alpha multiplier for raster painting; omitted means opaque. */
  readonly opacity?: number;
  readonly grayscale: boolean;
  readonly brightness: number;
  readonly contrast: number;
  readonly bilevel?: number;
}

/** ST_FixedPercentage in 1/1000 %: `70001` reads as `70.001`, clamped to Word's [-100, 100]. */
function parseLumPercent(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  return Math.max(-100, Math.min(100, parsed / 1000));
}

/** Bounded picture colour modes; projection never rewrites source media. */
export function readBlipEffects(blip: OoxmlElement): DrawingImageEffects {
  let opacity: number | undefined;
  let grayscale = false;
  let brightness = 0;
  let contrast = 0;
  let bilevel: number | undefined;
  for (const child of blip.children) {
    if (child.kind !== 'generic' || child.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) continue;
    if (child.localName === 'alphaModFix') {
      const raw = schemaAttributeValue(child.attributes, 'amt');
      const value = raw !== undefined && /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
      if (Number.isInteger(value) && value >= 0 && value <= 100_000) opacity = value / 100_000;
    } else if (child.localName === 'biLevel') {
      const raw = schemaAttributeValue(child.attributes, 'thresh');
      const value = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (Number.isInteger(value) && value >= 0 && value <= 100_000) bilevel = value / 100_000;
    } else if (child.localName === 'grayscl') {
      grayscale = true;
    } else if (child.localName === 'lum') {
      const bright = parseLumPercent(schemaAttributeValue(child.attributes, 'bright'));
      const contrastRaw = parseLumPercent(schemaAttributeValue(child.attributes, 'contrast'));
      if (bright !== null) brightness = bright;
      if (contrastRaw !== null) contrast = contrastRaw;
    }
  }
  return Object.freeze({
    ...(opacity === undefined ? {} : { opacity }),
    grayscale,
    brightness,
    contrast,
    ...(bilevel === undefined ? {} : { bilevel }),
  });
}
