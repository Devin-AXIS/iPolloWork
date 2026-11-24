// The identity of a composed font configuration, so a resolution that brings nothing new (a
// first italic in a family that no resolver serves) does not rebuild shaping and lay out every
// page again.

import type { FontConfiguration } from '../contracts/editor.ts';
import { fontRequestKey } from '../layout/font-resource.ts';

/** Equal for two configurations that measure and paint the same faces. */
export function fontInstallKey(fonts: FontConfiguration): string {
  const sources = fonts.sources
    .map((source) => `${fontRequestKey(source.request)}=${source.hash}#${source.faceIndex}`)
    .sort();
  const substitutions = (fonts.substitutions ?? [])
    .map(
      (substitution) =>
        `${fontRequestKey(substitution.from)}>${fontRequestKey(substitution.to)}` +
        (substitution.lineMetrics
          ? `@${substitution.lineMetrics.heightEm}/${substitution.lineMetrics.baselineEm}`
          : '')
    )
    .sort();
  return JSON.stringify([sources, substitutions, fonts.maxFontBytes ?? null]);
}
