import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import {
  APPLICATION_RUN_PROPERTIES,
  omittedDocDefaults,
} from '../store/package/application-doc-defaults.ts';
import {
  FORMAT_DEFAULT_EAST_ASIAN_FAMILY,
  FORMAT_DEFAULT_LATIN_FAMILY,
} from '../store/package/default-font-faces.ts';

/**
 * Layout-only property: the faces of the `w:ascii`, `w:hAnsi` and `w:eastAsia` slots when no
 * level names one. Not an OOXML element, so no authored property can collide with it.
 * `resolveRunStyle` reads its ascii and East Asian faces; `applyHAnsiFontSlots` reads its
 * hAnsi face, and only for a run that names an ascii face, because a run naming no Latin face
 * uses its ascii face for both Latin slots.
 */
export const RUN_FONT_DEFAULTS = 'runFontDefaults';

/**
 * The application profile's slot defaults: the body theme faces. Its ascii slot falls back to
 * the body face in `resolveRunStyle`.
 */
const APPLICATION_PROFILE_FONTS: OoxmlProperty = Object.freeze({
  localName: RUN_FONT_DEFAULTS,
  attributes: Object.freeze({ hAnsiTheme: 'minorHAnsi', eastAsiaTheme: 'minorEastAsia' }),
});

const APPLICATION_RUN: readonly OoxmlProperty[] = Object.freeze([
  ...APPLICATION_RUN_PROPERTIES,
  APPLICATION_PROFILE_FONTS,
]);

const APPLICATION_MODERN_RUN: readonly OoxmlProperty[] = Object.freeze([
  ...APPLICATION_RUN,
  Object.freeze({
    localName: 'ligatures',
    attributes: Object.freeze({ val: 'standardContextual' }),
  }),
]);

/** The format defaults under an authored `w:rPrDefault`: format faces, not the theme. */
const FORMAT_RUN: readonly OoxmlProperty[] = Object.freeze([
  Object.freeze({
    localName: RUN_FONT_DEFAULTS,
    attributes: Object.freeze({
      ascii: FORMAT_DEFAULT_LATIN_FAMILY,
      hAnsi: FORMAT_DEFAULT_LATIN_FAMILY,
      eastAsia: FORMAT_DEFAULT_EAST_ASIAN_FAMILY,
    }),
  }),
]);

/**
 * An omitted rPrDefault uses the application profile; an authored one, even empty, uses the
 * format defaults instead (`application-doc-defaults.ts`). Keep this layout-only so source
 * styles round-trip unchanged, and later style/direct properties can disable or raise the
 * threshold.
 */
export function applicationRunDefaults(
  styles: OoxmlElement | null,
  optionalLigatures = false
): readonly OoxmlProperty[] {
  if (!omittedDocDefaults(styles).run) return FORMAT_RUN;
  return optionalLigatures ? APPLICATION_MODERN_RUN : APPLICATION_RUN;
}
