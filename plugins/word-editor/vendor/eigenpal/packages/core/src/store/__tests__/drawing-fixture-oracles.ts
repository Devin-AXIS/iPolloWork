// Manifest-driven per-fixture oracles for Task 17 §7.1–7.9.

import { expect } from 'bun:test';
import type { DrawingProjection } from '../package/drawing-projection.ts';
import type { ImageResourceState } from '../package/image-resources.ts';
import type { SemanticLayout } from '../../layout/semantic-layout.ts';

export interface FixtureLayoutPaintOracle {
  readonly drawingCount: number;
  readonly pageCount: number;
  readonly readyCount: number;
  readonly placeholderCount: number;
  readonly assertProjections: (projections: readonly DrawingProjection[]) => void;
  readonly assertResourceKinds?: (kinds: readonly ImageResourceState['kind'][]) => void;
  readonly assertLayout?: (layout: SemanticLayout) => void;
}

export const FIXTURE_ORACLES: Readonly<Record<string, FixtureLayoutPaintOracle>> = {
  'comprehensive-word-element-test.docx': {
    drawingCount: 11,
    pageCount: 26,
    readyCount: 11,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expectNames(projections, [
        'green',
        'red',
        'blue',
        'green',
        'orange',
        'banner',
        'float',
        'red',
        'blue',
        'green',
        'orange',
      ]);
      expect(projections.filter((p) => p.wrap === 'square')).toHaveLength(1);
      expect(projections.every((p) => p.picture?.crop.left === 0)).toBe(true);
    },
  },
  'list-pagination-break.docx': {
    // Word-authored VML uses repeated inert styles and page wrap anchors.
    // The paint harness injects ready resources; the package tests refuse external fetches.
    drawingCount: 28,
    // Fixed-measurer baseline: all 717 authored w:cr breaks remain line breaks.
    // Empty section marks reuse the preceding page break, which removes 17 empty sheets.
    // Their editable fragments remain on the preceding sheet; text and drawings stay intact.
    pageCount: 66,
    readyCount: 27,
    placeholderCount: 0,
    assertLayout: (layout) => {
      // Each retained sheet holds text, a table, or a drawing.
      for (const page of layout.pages) {
        const holdsContent =
          (page.anchoredDrawings?.length ?? 0) > 0 ||
          page.fragments.some(
            (fragment) =>
              fragment.kind !== 'paragraph' ||
              fragment.lines.some(
                (line) =>
                  (line.drawings?.length ?? 0) > 0 ||
                  line.spans.some((span) => /[^\s\u200b]/.test(span.text))
              )
          );
        expect(holdsContent).toBe(true);
      }
      // Seventeen marks join their break sheet; two collapse before continuous sections.
      const outOfFlow = layout.pages.flatMap((page) =>
        page.fragments.filter((fragment) => fragment.kind === 'paragraph' && fragment.outOfFlow)
      );
      expect(outOfFlow).toHaveLength(19);
    },
    assertProjections: (projections) => {
      const photos = projections.filter((projection) => projection.picture);
      expect(photos).toHaveLength(27);
      for (const photo of photos) {
        expect(photo.legacyGraphic).toBeUndefined();
        expect(photo.position?.horizontal.relativeFrom).toBe('page');
        expect(photo.position?.vertical.relativeFrom).toBe('page');
        expect(photo.anchor?.behindDocument).toBe(true);
      }
      const textbox = projections.find((projection) => projection.textboxStory);
      expect(textbox?.ownerPartName).toBe('/word/header3.xml');
    },
  },
  'float-wrap-comprehensive-test.docx': {
    drawingCount: 26,
    pageCount: 5,
    readyCount: 26,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections.some((p) => p.wrap === 'tight')).toBe(true);
      expect(projections.some((p) => p.wrap === 'through')).toBe(true);
      expect(projections.some((p) => p.wrap === 'topAndBottom')).toBe(true);
      expect(projections.some((p) => p.wrap === 'squareLeft')).toBe(true);
      expect(projections.some((p) => p.wrap === 'squareRight')).toBe(true);
      expect(projections.some((p) => p.wrap === 'behind')).toBe(true);
    },
    // The page count alone is a weak gate: it moved from 7 to 5 only because every wrapped
    // line used to break at roughly half the column. These pin the geometry that decides it.
    assertLayout: (layout) => {
      const columnRight = layout.pages[0]!.contentBox.width;
      let widest = 0;

      for (const page of layout.pages) {
        // Anchors and lines are page-local coordinates — never compare across pages.
        const lines = page.fragments.flatMap((fragment) =>
          fragment.kind === 'paragraph' ? fragment.lines : []
        );
        const anchors = page.anchoredDrawings ?? [];
        for (const line of lines) {
          for (const span of line.spans) {
            widest = Math.max(widest, span.box.x + span.box.width);
          }
        }

        for (const anchor of anchors) {
          const top = anchor.y;
          const bottom = anchor.y + anchor.height;
          const overlappingLines = lines.filter(
            (line) => line.box.y < bottom - 0.001 && line.box.y + line.box.height > top + 0.001
          );

          // A tight/through polygon excludes the whole picture, not a sliver of its left
          // edge: no glyph may sit inside one.
          if (anchor.wrap === 'tight' || anchor.wrap === 'through') {
            for (const line of overlappingLines) {
              for (const span of line.spans) {
                const overlaps =
                  span.box.x < anchor.x + anchor.width - 0.001 &&
                  span.box.x + span.box.width > anchor.x + 0.001;
                expect(overlaps).toBe(false);
              }
            }
          }

          // A topAndBottom band sits ABOVE the text it displaced — the anchor's own paragraph
          // clears it rather than being painted over by it.
          if (anchor.wrap === 'topAndBottom') {
            for (const line of overlappingLines) expect(line.spans).toHaveLength(0);
          }
        }
      }

      // A line clear of every wrap zone reaches the full column, not a halved one, and
      // nothing overhangs the column either.
      expect(widest).toBeGreaterThan(columnRight * 0.9);
      expect(widest).toBeLessThanOrEqual(columnRight + 1);
    },
  },
  'image-layout-modes-demo.docx': {
    drawingCount: 3,
    pageCount: 1,
    readyCount: 3,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections.map((p) => p.wrap).sort()).toEqual(['inline', 'square', 'topAndBottom']);
    },
  },
  'issue-705-anchored-header-letterhead.docx': {
    // Seven MC-wrapped letterhead textboxes (one body, six header) surfaced when textbox
    // stories became renderable payloads; all were invisible before textbox-story-layout.
    // The header also has a standalone horizontal line with `cy="0"`, which projects as a
    // vector shape since zero-height lines draw (#972).
    drawingCount: 8,
    pageCount: 1,
    readyCount: 0,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections).toHaveLength(8);
      const textboxes = projections.filter((p) => p.textboxStory !== null);
      expect(textboxes).toHaveLength(7);
      expect(textboxes.every((p) => p.picture === null && p.vectorShape === null)).toBe(true);
      expect(textboxes.filter((p) => p.ownerPartName === '/word/document.xml')).toHaveLength(1);
      const line = projections.find((p) => p.vectorShape !== null);
      expect(line?.vectorShape?.extentEmu).toEqual({ cx: 107_950, cy: 0 });
      expect(line?.vectorShape?.strokeHex).toBe('00445E');
    },
  },
  'wrap-none-positioned-image-demo.docx': {
    drawingCount: 1,
    pageCount: 1,
    readyCount: 1,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections[0]!.wrap).toBe('inFront');
      expect(projections[0]!.anchor?.behindDocument).toBe(false);
    },
  },
  'images-external.docx': {
    drawingCount: 4,
    pageCount: 3,
    readyCount: 4,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections).toHaveLength(4);
    },
    assertResourceKinds: (kinds) => {
      expect(kinds.filter((kind) => kind === 'external')).toHaveLength(2);
      // `spoof.jpg` has PNG bytes, so its raster signature selects the decoder.
      expect(kinds.filter((kind) => kind === 'ready')).toHaveLength(2);
      expect(kinds).not.toContain('unrenderable');
    },
  },
  'images-wrap-sides.docx': {
    drawingCount: 9,
    pageCount: 1,
    readyCount: 9,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections.map((p) => p.wrap).sort()).toEqual(
        [
          'behind',
          'inFront',
          'square',
          'square',
          'squareLeft',
          'squareRight',
          'through',
          'tight',
          'topAndBottom',
        ].sort()
      );
    },
  },
  'images-crop.docx': {
    drawingCount: 1,
    pageCount: 1,
    readyCount: 1,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections[0]!.picture?.crop).toEqual({
        left: 0.1,
        top: 0.15,
        right: 0.2,
        bottom: 0.25,
      });
    },
  },
  'images-zorder.docx': {
    drawingCount: 2,
    pageCount: 1,
    readyCount: 2,
    placeholderCount: 0,
    assertProjections: (projections) => {
      const behind = projections.find((p) => p.name === 'behind');
      const front = projections.find((p) => p.name === 'front');
      expect(behind?.anchor?.behindDocument).toBe(true);
      expect(behind?.anchor?.relativeHeight).toBe(100);
      expect(behind?.anchor?.allowOverlap).toBe(false);
      expect(front?.anchor?.behindDocument).toBe(false);
      expect(front?.anchor?.relativeHeight).toBe(200);
      expect(front?.anchor?.allowOverlap).toBe(false);
    },
  },
  'images-formats.docx': {
    drawingCount: 7,
    pageCount: 1,
    readyCount: 7,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expectNames(projections, ['png', 'jpeg', 'gif', 'svg', 'tif', 'emf', 'wmf']);
    },
    assertResourceKinds: (kinds) => {
      // PNG, JPEG, GIF decode; SVG paints straight from bytes. TIFF/EMF/WMF need a
      // converting decode port, which this one is not, so they stay placeholders.
      expect(kinds.filter((kind) => kind === 'ready')).toHaveLength(4);
      expect(kinds.filter((kind) => kind === 'unrenderable')).toHaveLength(3);
    },
  },
  'images-tiff.docx': {
    drawingCount: 3,
    pageCount: 1,
    readyCount: 3,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expectNames(projections, ['tiff little-endian', 'tiff big-endian', 'tiff truncated']);
    },
    assertResourceKinds: (kinds) => {
      // Both byte orders and the truncated file alike: a port with no TIFF converter
      // renders none of them. The conversion path is covered by its own suite.
      expect(kinds.filter((kind) => kind === 'unrenderable')).toHaveLength(3);
    },
  },
  'images-header.docx': {
    drawingCount: 1,
    pageCount: 1,
    readyCount: 0,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections[0]!.wrap).toBe('inFront');
      expect(projections[0]!.ownerPartName).toBe('/word/header1.xml');
    },
  },
  'images-nonpicture.docx': {
    drawingCount: 3,
    pageCount: 1,
    // The chart and group still paint through the (mock-ready) resource path; the text box
    // now renders its story instead, so it is no longer a ready-image element.
    readyCount: 2,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expectNames(projections, ['chart', 'group', 'textbox']);
      expect(projections.every((p) => p.picture === null)).toBe(true);
      expect(projections.filter((p) => p.textboxStory !== null)).toHaveLength(1);
      expect(
        projections.flatMap((p) => p.diagnostics).filter((d) => d.code === 'unsupported-graphic')
      ).toHaveLength(3);
    },
  },
  'images-transform.docx': {
    drawingCount: 3,
    pageCount: 1,
    readyCount: 3,
    placeholderCount: 0,
    assertProjections: (projections) => {
      const rot90 = projections.find((p) => p.name === 'rot90');
      const flipH = projections.find((p) => p.name === 'flipH');
      const flipV = projections.find((p) => p.name === 'flipV');
      expect(rot90?.picture?.transform.rotationDegrees).toBe(90);
      expect(flipH?.picture?.transform.flipHorizontal).toBe(true);
      expect(flipV?.picture?.transform.flipVertical).toBe(true);
    },
  },
  'images-compatibility-malformed.docx': {
    drawingCount: 2,
    pageCount: 1,
    readyCount: 2,
    placeholderCount: 0,
    assertProjections: (projections) => {
      // One selected DrawingML branch plus the independent native VML photo.
      // The malformed anchor and unselected fallback still add nothing.
      expect(projections).toHaveLength(2);
      expect(projections.filter((projection) => projection.legacyGraphic)).toHaveLength(0);
      expect(projections.filter((projection) => projection.picture)).toHaveLength(2);
    },
  },
  'images-drawingml-watermark.docx': {
    drawingCount: 1,
    pageCount: 1,
    readyCount: 1,
    placeholderCount: 0,
    assertProjections: (projections) => {
      expect(projections.some((p) => p.effects.grayscale === true)).toBe(true);
      expect(projections[0]!.wrap).toBe('behind');
    },
  },
  'footer-textbox-page-fields.docx': {
    // Sanitized multi-section document whose only page numbers live in anchored footer
    // textboxes (PAGE / NUMPAGES with stale cached results). Per-page field projection is
    // asserted in layout/__tests__/textbox-story-layout.test.ts; this oracle pins the
    // package-wide projection census and body-only paint.
    drawingCount: 15,
    pageCount: 62,
    readyCount: 2,
    placeholderCount: 0,
    assertProjections: (projections) => {
      const stories = projections.filter((p) => p.textboxStory !== null);
      expect(stories).toHaveLength(3);
      expect(stories.map((p) => p.ownerPartName).sort()).toEqual([
        '/word/footer1.xml',
        '/word/footer2.xml',
        '/word/footer4.xml',
      ]);
      expect(projections.filter((p) => p.picture !== null)).toHaveLength(2);
      expect(projections.filter((p) => p.vectorShape !== null)).toHaveLength(10);
      // The authored Group 7 consists of three open two-point rules, now supported.
      const rules = projections.find(
        (p) => p.drawingNodeId === '/word/document.xml#0.0.33.1.1.0.0'
      )!.vectorShape!;
      expect(rules.components.map((component) => component.subpathsClosed)).toEqual([
        [false],
        [false],
        [false],
      ]);
      expect(rules.subpathsEmu.map((points) => points.length)).toEqual([2, 2, 2]);
    },
  },
};

function expectNames(projections: readonly DrawingProjection[], names: readonly string[]): void {
  expect(projections.map((p) => p.name)).toEqual(names);
}
