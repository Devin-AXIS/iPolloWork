import { characterHeaderPageToken, headerStoryForPage } from './character-header-pages.ts';
// The furniture one section's pages show, and the shell a sheet minted after layout gets.
//
// Extracted from the section pass so both live beside each other: what a page's header and
// footer records ARE, and what a page that did not exist when the pass ran should be given.
// They have to agree — a page whose content box comes from one variant and whose header comes
// from another paints an empty band exactly a header high — and keeping them in one factory is
// what makes that agreement checkable.

import type { FieldPageContext } from './field-page-furniture.ts';
import { storyNeedsPageFields } from './field-projection.ts';
import type { HeaderFooterLayoutPageContext, HeaderFooterStoryLayout } from './hf-layout.ts';
import {
  headerFooterVariantFor,
  type HeaderFooterVariantName,
  type OverflowPageShell,
  type PageContentInsets,
  type PageFurniture,
} from './page-furniture-insets.ts';
import { pageBorderFrame } from './page-border-frame.ts';
import type { ExclusionZone } from './drawing-exclusion.ts';
import { furnitureDrawingExclusionsForPage } from './furniture-drawing-exclusion.ts';
import { clipFurnitureFragments, furniturePaintLimit } from './furniture-overflow-clip.ts';
import type { SectionPageBorders } from './page-borders.ts';
import type {
  HeaderFooterStoryRecord,
  LayoutBox,
  PageGeometry,
  PageRecord,
} from './semantic-records.ts';

export interface SectionPageFurnitureInputs {
  readonly furniture?: PageFurniture;
  readonly geometry: PageGeometry;
  /** `w:pgMar/@w:header` in points. */
  readonly headerDistance: number;
  /** `w:pgMar/@w:footer` in points. */
  readonly footerDistance: number;
  /** Where this section's first sheet lands in the DOCUMENT. */
  readonly pageIndexStart: number;
  /** Displayed number of local page zero. */
  readonly pageNumberStart?: number;
  /** Content width the stories were laid out at. */
  readonly contentWidth: number;
  /** This section's per-page content insets, by section-local index. */
  readonly insetsFor: (localIndex: number) => PageContentInsets;
  /** Pages the pass has completed so far, read when a story projects NUMPAGES. */
  readonly pageCount: () => number;
  /** The section's `w:pgBorders`, for the frame a minted sheet draws. */
  readonly pageBorders?: SectionPageBorders;
}

export interface SectionPageFurniture {
  /** The sheet rectangle for section-local `index`, including the scroll-surface gutter. */
  pageBox(index: number): LayoutBox;
  /** The variant page `index` shows — the same resolution its content box was derived from. */
  variantFor(index: number): HeaderFooterVariantName;
  /** The placed header or footer record for section-local `index` on `box`. */
  furnitureFor(
    kind: 'header' | 'footer',
    index: number,
    box: LayoutBox
  ): HeaderFooterStoryRecord | undefined;
  /**
   * Content box AND furniture for a sheet minted at a DOCUMENT index, placed on `box`.
   * `pageNumberShift` asks for a body page whose displayed number moved by that much after
   * the body pass; see {@link OverflowPageShellResolver}.
   */
  overflowShellAt(
    documentPageIndex: number,
    box: LayoutBox,
    pageNumberShift?: number
  ): OverflowPageShell;
  /**
   * The page record of section-local page `index` before its body: its box, content box, page
   * borders, header and footer. `index` is section-local, which is what `w:display` asks about.
   */
  pageShell(index: number): PageShell;
  /** The wrap zones the header and footer of section-local page `index` lay over its body. */
  furnitureZonesFor(index: number, omitHidden?: boolean): readonly ExclusionZone[];
}

/** A page record without its body fragments. */
export type PageShell = Pick<
  PageRecord,
  'id' | 'index' | 'box' | 'contentBox' | 'pageBorders' | 'header' | 'footer'
>;

/** Everything a placed header or footer story reads, and nothing from the pass that placed it. */
interface StoryPlacement {
  readonly kind: 'header' | 'footer';
  readonly variant: HeaderFooterVariantName;
  readonly story: HeaderFooterStoryLayout;
  readonly box: LayoutBox;
  readonly geometry: PageGeometry;
  readonly headerDistance: number;
  readonly footerDistance: number;
  readonly contentWidth: number;
  readonly insets: PageContentInsets;
  /** The height the story may paint, when the page's furniture is too tall to show whole. */
  readonly paintLimit?: number;
}

function placeStory(at: StoryPlacement, laid: HeaderFooterStoryLayout): HeaderFooterStoryRecord {
  const { kind, box, geometry } = at;
  const shown =
    at.paintLimit !== undefined && laid.flowHeight > at.paintLimit
      ? clipFurnitureFragments(laid.fragments, at.paintLimit)
      : { fragments: laid.fragments, height: laid.flowHeight };
  const storyY =
    kind === 'header'
      ? box.y + at.headerDistance
      : box.y + geometry.height - at.footerDistance - shown.height;
  return {
    kind,
    variant: at.variant,
    partName: laid.partName,
    ...(laid.part ? { part: laid.part } : {}),
    ...(laid.rId ? { rId: laid.rId } : {}),
    box: {
      x: box.x + geometry.margin.left,
      y: storyY,
      width: at.contentWidth,
      height: shown.height,
    },
    fragments: shown.fragments,
    ...(laid.anchoredDrawings ? { anchoredDrawings: laid.anchoredDrawings } : {}),
  };
}

function layoutStoryForPage(at: StoryPlacement, fields: FieldPageContext): HeaderFooterStoryLayout {
  const { story, geometry } = at;
  let laid = story;
  for (let pass = 0; pass < 8; pass += 1) {
    const storyTop =
      at.kind === 'header'
        ? at.headerDistance
        : geometry.height - at.footerDistance - laid.flowHeight;
    const context: HeaderFooterLayoutPageContext = {
      ...fields,
      contentInsetTop: at.insets.top,
      contentInsetBottom: at.insets.bottom,
      storyTop,
    };
    const next = story.withPageContext(context);
    if (Math.abs(next.flowHeight - laid.flowHeight) <= 0.001) return next;
    laid = next;
  }
  throw new Error('header/footer attached-page anchor layout did not converge');
}

/**
 * The projector a published story keeps for NUMPAGES. Built here, outside the section
 * factory, so it holds its placement and not the pass: a projector minted inside the
 * factory reached the pass's page counter, and through it every prepass, flow and table
 * memo of the pass that placed the sheet, for as long as the sheet was reused.
 */
function storyProjector(
  at: StoryPlacement
): (context: FieldPageContext) => HeaderFooterStoryRecord {
  return (context) => placeStory(at, layoutStoryForPage(at, context));
}

/** 24pt gutter between sheets, for the scroll surface. */
export const SHEET_GUTTER_PT = 24;

export function createSectionPageFurniture(
  inputs: SectionPageFurnitureInputs
): SectionPageFurniture {
  const { furniture, geometry, headerDistance, footerDistance, pageIndexStart } = inputs;

  const pageBox = (index: number): LayoutBox => ({
    x: 0,
    y: index * (geometry.height + SHEET_GUTTER_PT),
    width: geometry.width,
    height: geometry.height,
  });

  const variantFor = (index: number, pageNumberShift = 0): HeaderFooterVariantName =>
    headerFooterVariantFor(
      furniture,
      (inputs.pageNumberStart ?? pageIndexStart + 1) + pageNumberShift,
      index
    );

  const furnitureFor = (
    kind: 'header' | 'footer',
    index: number,
    box: LayoutBox,
    pageNumberShift = 0
  ): HeaderFooterStoryRecord | undefined => {
    if (!furniture) return undefined;
    const variant = variantFor(index, pageNumberShift);
    const header = headerStoryForPage(furniture, variant, pageIndexStart + index);
    const footer = furniture.footers.get(variant);
    const story = kind === 'header' ? header : footer;
    // An absent variant shows nothing: the page falls back to blank, not to `default`.
    if (!story) return undefined;
    const paintLimit = furniturePaintLimit(
      geometry.height,
      header?.flowHeight ?? 0,
      footer?.flowHeight ?? 0
    );
    const pageNumber = (inputs.pageNumberStart ?? pageIndexStart + 1) + pageNumberShift + index;
    const pageContext: FieldPageContext = {
      pageNumber,
      pageCount: Math.max(pageNumber, inputs.pageCount() + 1),
      sectionPageCount: index + 1,
      sheetNumber: pageIndexStart + index + 1,
    };
    const placement: StoryPlacement = {
      kind,
      variant,
      story,
      box,
      geometry,
      headerDistance,
      footerDistance,
      contentWidth: inputs.contentWidth,
      insets: inputs.insetsFor(index),
      ...(paintLimit !== undefined ? { paintLimit } : {}),
    };
    const needs = story.pageFieldNeeds;
    const needsPerPageLayout =
      storyNeedsPageFields(needs) || (story.anchoredDrawings?.length ?? 0) > 0;
    const laid = needsPerPageLayout ? layoutStoryForPage(placement, pageContext) : story;
    const placed = placeStory(placement, laid);
    if (storyNeedsPageFields(needs)) {
      return { ...placed, pageFieldProjector: storyProjector(placement) };
    }
    return placed;
  };

  const overflowShellAt = (
    documentPageIndex: number,
    box: LayoutBox,
    pageNumberShift = 0
  ): OverflowPageShell => {
    const local = documentPageIndex - pageIndexStart;
    // A renumbered page keeps its own index, so its place in the section, its running
    // header values and its section page count stay its own; only the number moves. A
    // `first` page stays `first`, because that variant follows the index. A header that
    // repeats running values is laid out per page index and is not re-resolved here.
    const shift = furniture && characterHeaderPageToken(furniture) ? 0 : pageNumberShift;
    const header = furnitureFor('header', local, box, shift);
    const footer = furnitureFor('footer', local, box, shift);
    // Same rule as a body page: `w:display` asks about the page's place in ITS section.
    const pageBorders = pageBorderFrame(inputs.pageBorders, geometry, local === 0);
    return {
      // Off the first page, insets depend only on the variant. A page that changes variant
      // takes the insets of the next local page, which shows the other parity's variant.
      insets: inputs.insetsFor(variantFor(local, shift) === variantFor(local) ? local : local + 1),
      ...(header ? { header } : {}),
      ...(footer ? { footer } : {}),
      ...(pageBorders ? { pageBorders } : {}),
    };
  };

  /**
   * The wrap zones the header and footer of local page `index` lay over its body, resolved on
   * the page being filled so newly minted pages wrap too. `omitHidden` leaves out hidden
   * records (`refusalYieldsHiddenFurniture`).
   */
  const furnitureZonesFor = (index: number, omitHidden = false): readonly ExclusionZone[] => {
    const box = pageBox(index);
    const insets = inputs.insetsFor(index);
    return furnitureDrawingExclusionsForPage(
      {
        box,
        contentBox: {
          x: box.x + geometry.margin.left,
          y: box.y + insets.top,
          width: inputs.contentWidth,
          height: insets.height,
        },
        header: furnitureFor('header', index, box),
        footer: furnitureFor('footer', index, box),
      },
      omitHidden
    );
  };

  const pageShell = (index: number): PageShell => {
    const box = pageBox(index);
    const header = furnitureFor('header', index, box);
    const footer = furnitureFor('footer', index, box);
    const insets = inputs.insetsFor(index);
    const borderFrame = pageBorderFrame(inputs.pageBorders, geometry, index === 0);
    return {
      id: `page-${index}`,
      index,
      box,
      contentBox: {
        x: box.x + geometry.margin.left,
        y: box.y + insets.top,
        width: inputs.contentWidth,
        height: insets.height,
      },
      ...(borderFrame ? { pageBorders: borderFrame } : {}),
      ...(header ? { header } : {}),
      ...(footer ? { footer } : {}),
    };
  };

  return { pageBox, variantFor, furnitureFor, overflowShellAt, furnitureZonesFor, pageShell };
}
