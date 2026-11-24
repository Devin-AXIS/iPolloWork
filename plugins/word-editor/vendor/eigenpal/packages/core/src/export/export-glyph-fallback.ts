import { shapeExportClusterFallback } from './export-cluster-fallback.ts';
import { orderFallbackFacesForCluster } from './export-color-font.ts';
import { orderFacesForScript } from './export-script-support.ts';
import { shapeExportHyphenFallback } from './export-hyphen-fallback.ts';
import { synthesizeExportSmallCaps } from './export-small-caps.ts';
// Optional export fallback over admitted faces. Measurement and PDF glyph publication
// share this shaper, so fallback changes pagination before any painter runs.
import {
  createShapingEnvironment,
  type ShapeInput,
  type ShapedRun,
  type TextShaper,
} from '../layout/shaped-run.ts';
import {
  FontResolutionError,
  type FontRequest,
  type ResolvedFont,
} from '../layout/font-resource.ts';
import type { LayoutShapingOptions } from '../layout/shaped-measurer.ts';

export function withExportGlyphFallbacks(
  shaping: LayoutShapingOptions,
  requests: readonly FontRequest[]
): LayoutShapingOptions {
  if (requests.length === 0) return shaping;
  if (requests.length > 16) throw new RangeError('At most 16 glyph fallback faces are supported');
  const fonts = requests
    .map((request) => shaping.fonts.resolve(request))
    .filter((font): font is ResolvedFont => !(font instanceof FontResolutionError));
  const compatible: TextShaper = {
    shape(input) {
      return shapeExportHyphenFallback(shaping.shaper, input, shaping.shaper.shape(input));
    },
  };
  // The fallback chain is a function of the input and of `fonts`, which this closure fixes.
  // A caching base shaper hands back one run object for every equal input, so the finished run
  // is kept against it and the chain runs once per distinct text, not once per span. The
  // input is compared as well, so a base shaper that reuses a run for unequal inputs still
  // gets the chain run for each.
  const finished = new WeakMap<
    ShapedRun,
    { readonly input: ShapeInput; readonly run: ShapedRun }
  >();
  const shaper: TextShaper = {
    shape(input) {
      const base = shaping.shaper.shape(input);
      const memo = finished.get(base);
      if (
        memo &&
        memo.input.text === input.text &&
        memo.input.fontSizeHalfPoints === input.fontSizeHalfPoints &&
        memo.input.bidiLevel === input.bidiLevel &&
        memo.input.context?.before === input.context?.before &&
        memo.input.context?.after === input.context?.after &&
        memo.input.environment === input.environment
      )
        return memo.run;
      const run = shapeWithFallbacks(input, shapeExportHyphenFallback(shaping.shaper, input, base));
      finished.set(base, { input, run });
      return run;
    },
  };
  const shapeWithFallbacks = (input: ShapeInput, compatibleRun: ShapedRun): ShapedRun => {
    const primary = synthesizeExportSmallCaps(compatible, input, compatibleRun);
    // Controls have no ink and are not evidence that a text face lacks coverage.
    if (!primary.glyphs.some((glyph) => glyph.id === 0) || /^[\t\n\r\f]*$/.test(input.text))
      return primary;
    // Preserve the authored face around missing symbols. Moving an entire Latin/CJK
    // run to a fallback also changes its supported letters, spaces and line breaks.
    // Hebrew letters in an Arabic face fall back the same way: the face keeps drawing the
    // spaces and punctuation it has, so its line height still applies to the line.
    // Joining scripts retain whole-run fallback so font boundaries do not sever joins.
    // A joining script falls back per cluster too when every missing cluster is a character no
    // join passes through, such as a checkbox symbol after an Arabic word: the face keeps the
    // letters, and only the symbol moves.
    if (
      /^(Latn|Cyrl|Grek|Hebr|Hani|Hira|Kana|Hang|Zyyy|Zinh)$/.test(input.environment.script) ||
      (/^(Arab|Syrc|Nkoo|Mong)$/.test(input.environment.script) &&
        missingClustersAreNonJoining(input.text, primary))
    ) {
      const mixed = shapeExportClusterFallback(compatible, input, primary, fonts);
      if (mixed) return mixed;
    }
    // Color faces go first for emoji presentation and last otherwise, so a dingbat stays a
    // symbol glyph and an emoji-default pictograph gets its color face. Within that, a face
    // that declares the run's script goes first: covering Arabic letters is not shaping
    // them, and a math face that only maps them draws every letter isolated.
    for (const font of orderFacesForScript(
      orderFallbackFacesForCluster(fonts, input.text),
      input.environment.script
    )) {
      if (
        font.hash === input.environment.font.hash &&
        font.faceIndex === input.environment.font.faceIndex
      )
        continue;
      try {
        const next = {
          ...input,
          environment: createShapingEnvironment({ ...input.environment, font }),
        };
        const run = synthesizeExportSmallCaps(compatible, next, compatible.shape(next));
        if (!run.glyphs.some((glyph) => glyph.id === 0)) return run;
      } catch {
        /* One unsupported fallback face does not hide later admitted faces. */
      }
    }
    // Partial font replacement cannot safely preserve joining-script context yet.
    // Keep uncovered runs explicit so strict exporters refuse them.
    return primary;
  };
  return { ...shaping, shaper };
}

/** Letters of the joining scripts, the tatweel, and the join controls: what a join passes through. */
const JOINING = /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mongolian}ـ‌‍]/u;

/** Whether every cluster the primary face could not draw holds no joining character. */
function missingClustersAreNonJoining(text: string, run: ShapedRun): boolean {
  let missing = false;
  for (const cluster of run.clusters) {
    if (!run.glyphs.slice(cluster.glyphStart, cluster.glyphEnd).some((glyph) => glyph.id === 0))
      continue;
    missing = true;
    if (JOINING.test(text.slice(cluster.textStart, cluster.textEnd))) return false;
  }
  return missing;
}
