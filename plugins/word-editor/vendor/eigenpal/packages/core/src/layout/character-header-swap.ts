// Header style values that leave every header height unchanged, applied without another pass.
//
// A header's height is all the body flow reads from it: the inset below it. When the header a
// page shows keeps its height under that page's style values, a pass that projected the values
// would place the body exactly as the pass that showed saved results did. Only the header
// fragments differ, so they are replaced in place. Any height change answers `null`, and the
// caller runs the projected passes.
import type { OoxmlPart } from '@docx-editor.dev/core/store';
import type { HeaderFooterStoryRecord, PageRecord, SemanticLayout } from './semantic-records.ts';
import type { PageFurniture } from './page-furniture-insets.ts';
import { characterStyleValuesToken } from './character-style-tokens.ts';
import type { HeaderFooterStoryLayout } from './hf-layout.ts';
import { storyNeedsPageFields, type FieldPageContext } from './field-page-furniture.ts';
import { strippedStoryProjections } from './published-story-projections.ts';

const HEIGHT_TOLERANCE = 0.001;

/** Repeated passes return the same records: by source header and values, then by page. */
const headerMemo = new WeakMap<
  HeaderFooterStoryRecord,
  { readonly token: string; readonly header: HeaderFooterStoryRecord }
>();
const pageMemo = new WeakMap<
  PageRecord,
  { readonly header: HeaderFooterStoryRecord; readonly page: PageRecord }
>();
const valuesToken = (values: ReadonlyMap<string, string> | undefined): string =>
  values ? characterStyleValuesToken(values) : '';

/** The one header story laid out from each part, or `null` when a part has several. */
function storiesByPart(
  furniture: ReadonlySet<PageFurniture>,
  dynamic: ReadonlySet<HeaderFooterStoryLayout>
): Map<OoxmlPart, HeaderFooterStoryLayout | null> {
  const stories = new Map<OoxmlPart, HeaderFooterStoryLayout | null>();
  for (const value of furniture) {
    for (const story of value.headers.values()) {
      if (!story.part || !dynamic.has(story)) continue;
      const known = stories.get(story.part);
      stories.set(story.part, known === undefined || known === story ? story : null);
    }
  }
  return stories;
}

/**
 * `layout` with each page header showing its style values, or `null` when a value would
 * change a header's height or a header cannot be re-laid out here. Unchanged pages keep their
 * identity, and so does the layout when no page changes.
 */
export function headersWithStyleValues(
  layout: SemanticLayout,
  values: readonly ReadonlyMap<string, string>[],
  contexts: readonly FieldPageContext[],
  furniture: ReadonlySet<PageFurniture>,
  dynamic: ReadonlySet<HeaderFooterStoryLayout>
): SemanticLayout | null {
  const stories = storiesByPart(furniture, dynamic);
  let changed = false;
  const pages: PageRecord[] = [];
  for (const [index, page] of layout.pages.entries()) {
    const header = page.header;
    const story = header?.part ? stories.get(header.part) : undefined;
    if (!header || story === undefined) {
      pages.push(page);
      continue;
    }
    if (story === null || story.anchoredDrawings?.length || header.anchoredDrawings?.length)
      return null;
    const selected = values[index]?.size ? values[index] : undefined;
    const token = valuesToken(selected);
    const known = headerMemo.get(header);
    let next: HeaderFooterStoryRecord | null = known?.token === token ? known.header : null;
    if (!next) {
      next = storyNeedsPageFields(story.pageFieldNeeds)
        ? projectedHeader(header, selected, contexts[index])
        : plainHeader(header, story, selected, contexts[index]);
      if (!next) return null;
      headerMemo.set(header, { token, header: next });
    }
    if (next === header) {
      pages.push(page);
      continue;
    }
    changed = true;
    const reused = pageMemo.get(page);
    const result = reused?.header === next ? reused.page : { ...page, header: next };
    pageMemo.set(page, { header: next, page: result });
    pages.push(result);
  }
  return changed ? { ...layout, pages } : layout;
}

/** A header without page fields: the pass placed the story itself at the header distance. */
function plainHeader(
  header: HeaderFooterStoryRecord,
  story: HeaderFooterStoryLayout,
  selected: ReadonlyMap<string, string> | undefined,
  context: FieldPageContext | undefined
): HeaderFooterStoryRecord | null {
  const laid =
    selected && context
      ? story.withPageContext({ ...context, characterStyleValues: selected })
      : story;
  if (Math.abs(laid.flowHeight - header.box.height) > HEIGHT_TOLERANCE) return null;
  if (laid.fragments === header.fragments) return header;
  return { ...header, fragments: laid.fragments };
}

type StoryProjector = (context: FieldPageContext) => HeaderFooterStoryRecord;

/** The projector a values wrapper was built over, so wrappers never nest. */
const baseProjectors = new WeakMap<StoryProjector, StoryProjector>();
/**
 * The values a wrapper adds. Every later projection carries the projector over unchanged, while
 * the context it records can drop the values, so this is what a header currently shows.
 */
const wrapperValues = new WeakMap<StoryProjector, ReadonlyMap<string, string>>();

/**
 * A projector that adds this page's style values to every context it projects under. Finalize
 * and deferred furniture project again from a page context of their own, which has no values.
 */
function withValues(
  projector: StoryProjector,
  selected: ReadonlyMap<string, string> | undefined
): StoryProjector {
  const base = baseProjectors.get(projector) ?? projector;
  if (!selected) return base;
  const wrapped: StoryProjector = (context) => base({ ...context, characterStyleValues: selected });
  baseProjectors.set(wrapped, base);
  wrapperValues.set(wrapped, selected);
  return wrapped;
}

/** A header with page fields: finalize retained the projector that placed it. */
function projectedHeader(
  header: HeaderFooterStoryRecord,
  selected: ReadonlyMap<string, string> | undefined,
  pageContext: FieldPageContext | undefined
): HeaderFooterStoryRecord | null {
  if (header.pageFieldProjector || !pageContext) return null;
  const retained = strippedStoryProjections.get(header);
  if (!retained) return null;
  const projector = withValues(retained.projector, selected);
  // A deferred header keeps its earlier text until furniture completes. Its height is checked
  // under this page's own context, and the projector it completes through carries the values.
  if (retained.context.pageNumber < 0) {
    const live = projector({
      pageNumber: pageContext.pageNumber,
      pageCount: pageContext.pageCount,
      sectionPageCount: pageContext.sectionPageCount,
      ...(pageContext.format ? { format: pageContext.format } : {}),
      sheetNumber: pageContext.sheetNumber,
    });
    if (Math.abs(live.box.height - header.box.height) > HEIGHT_TOLERANCE) return null;
    strippedStoryProjections.set(header, { ...retained, projector });
    return header;
  }
  if (valuesToken(wrapperValues.get(retained.projector)) === valuesToken(selected)) return header;
  const context: FieldPageContext = { ...retained.context, characterStyleValues: selected };
  const { pageFieldProjector: _drop, box, ...rest } = projector(context);
  void _drop;
  if (Math.abs(box.height - header.box.height) > HEIGHT_TOLERANCE) return null;
  const placedBox = retained.dy === 0 ? box : { ...box, y: box.y + retained.dy };
  const sameBox =
    placedBox.x === header.box.x &&
    placedBox.y === header.box.y &&
    placedBox.width === header.box.width;
  if (rest.fragments === header.fragments && sameBox) return header;
  const placed: HeaderFooterStoryRecord = { ...rest, box: placedBox };
  strippedStoryProjections.set(placed, { ...retained, context, projector });
  return placed;
}
