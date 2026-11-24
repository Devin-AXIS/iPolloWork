// Resource-exhaustion guards for the paste merge: how its cost GROWS with the size of the
// fragment, for the two axes a prior review measured O(n^2) freezes on.
//
// THEY MEASURE THE SHAPE OF THE CURVE, NOT THE CLOCK. Each guard used to assert one absolute
// millisecond ceiling, which is a claim about the machine as much as about the code: a shared
// CI runner that stalls for a few seconds fails a merge that never changed, and the only way
// to quiet it is to raise the ceiling until it stops catching the regression it exists for.
// One such stall put a 1.5s merge at 12.9s against a 4s ceiling.
//
// So each guard times the SAME merge at two input sizes and asserts how the time grew. Linear
// work over an 8x bigger input takes about 8x as long; quadratic work takes about 64x. A slow
// machine slows both measurements together and the ratio does not move, which is exactly the
// property an absolute ceiling lacks.
//
// A GROWTH RATIO IS ONLY HONEST WHERE BOTH MEASUREMENTS ARE DOMINATED BY THE WORK. The style
// axis is: 1000 styles cost ~5ms and 8000 cost ~55ms, so the constant overhead is already
// noise at the small end.
//
// THE RATIO IS NOT EXACTLY THE SIZE STEP, EVEN FOR LINEAR WORK. The merge does the same work
// per style at every size (a profile is flat: tree walks, id rewrites, one append), but the
// wall-clock cost per style still rises with the size of the tree it walks, because a bigger
// working set spills further down the cache hierarchy. Measured here, best of 5 runs:
//
//   n        500    1000   2000   4000   8000   16000  32000
//   us/style 4.6    5.0    5.2    6.1    6.9    7.5    7.6     <- flattens, never doubles
//
// So an 8x step reads about 11x on this machine, and it read 26.5x once on a shared CI runner
// with the rest of the test pool competing for the same cache and memory bandwidth — the same
// slope, steeper. That slope belongs to the runner, not the merge, so the guard has to
// tolerate it; what it must still catch is quadratic work, which lands at 64x before any of
// that and only climbs from there.
//
// The media axis uses 1000 and 8000 distinct images. Fixture creation stays outside timing.
// Both sizes do measurable merge work. Smaller fixtures can mostly measure fixed overhead.
// Before the indexed content-type edit, this step grew by 68x on Windows; after it, by 7.8x.
// Keep the same generous growth threshold as the style axis, plus the absolute backstop.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import { relationshipsOf, validatePackageInvariants } from '../package/package-edit.ts';
import { resolveInternalTarget } from '../package/opc-names.ts';
import { mergeFragmentIntoPackage } from '../store/clipboard-fragment-merge.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function load(bytes: Uint8Array): OoxmlPackage {
  const r = readOoxmlPackage(bytes);
  if (!r.ok) throw new Error(r.reason);
  return r.package;
}

const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function blankTarget(): OoxmlPackage {
  return load(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`
      ),
    })
  );
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

/** The size step between the two measurements. Linear grows by this; quadratic by its square. */
const SIZE_FACTOR = 8;

/**
 * How much growth still counts as linear.
 *
 * Four times the size factor, which sits clear of both ends: linear work lands at about
 * `SIZE_FACTOR` and quadratic at about `SIZE_FACTOR ** 2` (64), so there is 4x of headroom
 * above the shape that must pass and 2x of margin below the shape that must fail. The
 * headroom is that wide because linear work does not read as exactly `SIZE_FACTOR` in wall
 * time — see the file header: the per-style cost rises with the working set, ~11x locally
 * and 26.5x once on a loaded shared runner, for a merge whose profile is flat. Three times
 * the size factor (24) was under that tail; a quadratic merge is not under this one.
 */
const NEAR_LINEAR_GROWTH = SIZE_FACTOR * 4;

/**
 * A backstop no plausible machine reaches.
 *
 * It catches what a ratio cannot — a constant factor a hundred times worse grows at the same
 * rate. Both axes also have a growth guard.
 * Two orders of magnitude above the ~1.5s the biggest of these merges takes, so a stalled
 * runner cannot reach it: the 12.9s stall that started all this would still pass.
 */
const ABSURD_MS = 60_000;

/**
 * The FASTEST of several runs, in milliseconds.
 *
 * The minimum, not the mean: noise on a shared runner only ever adds time, so the best run is
 * the closest estimate of what the code costs and the outliers are exactly what should be
 * discarded. Five runs, because the ratio fails only when EVERY large run is slow while the
 * small ones are not. The first run also warms the JIT, which otherwise lands
 * on the small measurement and deflates the ratio. `prepare` builds the inputs and returns
 * the call to time, so fixture construction stays outside the measurement.
 *
 * A full collection precedes each timed run: the garbage left by fixture construction and
 * the previous run is otherwise collected INSIDE the measurement, and the large run, which
 * allocates the most, inherits the most.
 */
function fastestMs(prepare: () => () => void, repeats = 5): number {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < repeats; attempt += 1) {
    const run = prepare();
    Bun.gc(true);
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/**
 * How much slower the merge gets when the fragment grows by `SIZE_FACTOR`.
 *
 * `fragmentOf` builds the fragment for a size and `targetOf` a fresh target per run, because a
 * merge returns a new package and a reused one would measure a different starting state.
 */
function growthOverSizeStep(
  small: number,
  fragmentOf: (n: number) => OoxmlPackage,
  targetOf: () => OoxmlPackage
): number {
  const timeAt = (n: number): number => {
    const fragment = fragmentOf(n);
    return fastestMs(() => {
      const target = targetOf();
      return () => {
        const merged = mergeFragmentIntoPackage(target, fragment, target.mainDocumentPart);
        // Asserted every run: a merge that started failing would "get faster" and pass a
        // ratio it never earned.
        expect(merged.ok).toBe(true);
      };
    });
  };
  const smallMs = timeAt(small);
  const largeMs = timeAt(small * SIZE_FACTOR);
  if (process.env.DOCX_PASTE_BENCH === '1') {
    console.warn(
      JSON.stringify({
        small,
        large: small * SIZE_FACTOR,
        smallMs,
        largeMs,
        ratio: largeMs / smallMs,
      })
    );
  }
  expect(largeMs).toBeLessThan(ABSURD_MS);
  // Guard the division: a small measurement of zero on a very fast machine is not a signal.
  return smallMs > 0 ? largeMs / smallMs : 0;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A fragment of `n` paragraphs, each holding one distinct inline image. */
function mediaFragment(n: number): OoxmlPackage {
  const entries: Record<string, Uint8Array> = {};
  const paras: string[] = [];
  const rels: string[] = [];
  for (let i = 0; i < n; i += 1) {
    // Each distinct image: flip one byte so the content hash differs.
    const bytes = new Uint8Array(TINY_PNG);
    bytes[bytes.length - 5] = i & 0xff;
    bytes[bytes.length - 6] = (i >> 8) & 0xff;
    entries[`word/media/img${i}.png`] = bytes;
    rels.push(`<Relationship Id="rId${i + 10}" Type="${R}/image" Target="media/img${i}.png"/>`);
    paras.push(
      `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><wp:extent cx="100" cy="100"/><wp:docPr id="${i + 1}" name=""/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${i + 10}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    );
  }
  entries['[Content_Types].xml'] = strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  entries['_rels/.rels'] = strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  entries['word/_rels/document.xml.rels'] = strToU8(
    `<Relationships xmlns="${REL}">${rels.join('')}</Relationships>`
  );
  entries['word/document.xml'] = strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${paras.join('')}</w:body></w:document>`
  );
  return load(zipSync(entries));
}

/** A fragment whose `n` styles are all named `Normal`, all colliding with the target's. */
function collidingStyleFragment(n: number): OoxmlPackage {
  const styles: string[] = [];
  for (let i = 0; i < n; i += 1) {
    styles.push(
      `<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="${20 + (i % 40)}"/></w:rPr></w:style>`
    );
  }
  return load(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdS" Type="${R}/styles" Target="styles.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`
      ),
      'word/styles.xml': strToU8(
        `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${styles.join('')}</w:styles>`
      ),
    })
  );
}

/** A target whose own `Normal` differs, so every incoming style collides on name. */
function styledTarget(): OoxmlPackage {
  return load(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdS" Type="${R}/styles" Target="styles.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`
      ),
      'word/styles.xml': strToU8(
        `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style></w:styles>`
      ),
    })
  );
}

describe('how the paste merge grows with the fragment', () => {
  test('distinct images have near-linear merge growth (no O(media^2))', () => {
    expect(growthOverSizeStep(1000, mediaFragment, blankTarget)).toBeLessThan(NEAR_LINEAR_GROWTH);
  }, 300_000);

  test('colliding style ids resolve in linear time (no O(style^2))', () => {
    // 1000 then 8000. The target's own `Normal` differs, so every one of them collides.
    expect(growthOverSizeStep(1000, collidingStyleFragment, styledTarget)).toBeLessThan(
      NEAR_LINEAR_GROWTH
    );
  }, 60_000);

  test('a fragment of distinct images merges at all, well inside any budget', () => {
    // Keep the absolute backstop and check that faster merging does not lose media.
    const fragment = mediaFragment(3000);
    const target = blankTarget();
    const start = performance.now();
    const merged = mergeFragmentIntoPackage(target, fragment, target.mainDocumentPart);
    const elapsed = performance.now() - start;
    expect(merged.ok).toBe(true);
    expect(elapsed).toBeLessThan(ABSURD_MS);
    if (!merged.ok) return;
    expect(merged.blocks).toHaveLength(3000);
    expect(validatePackageInvariants(merged.pkg).ok).toBe(true);
    const reopened = load(writeOoxmlPackage(merged.pkg));
    const images = relationshipsOf(reopened, reopened.mainDocumentPart).filter(
      (rel) => rel.type === `${R}/image`
    );
    expect(images).toHaveLength(3000);
    const expected = new Set<string>();
    for (const [name, bytes] of fragment.partBytes) {
      if (name.includes('/media/')) expected.add(Array.from(bytes).join(','));
    }
    const actual = new Set<string>();
    for (const rel of images) {
      const targetName = resolveInternalTarget(rel.ownerPart, rel.rawTarget);
      expect(targetName.ok).toBe(true);
      if (!targetName.ok) continue;
      const bytes = reopened.partBytes.get(targetName.partName)!;
      actual.add(Array.from(bytes).join(','));
      expect(reopened.contentTypes.overrides.get(targetName.partName)).toBe('image/png');
    }
    expect(actual.size).toBe(3000);
    expect(actual).toEqual(expected);
  }, 60_000);
});
