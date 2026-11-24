import { ReviewAnchorIndex } from './review-anchor-index.ts';
// Where a review card sits beside the page.
//
// One index per layout, covering every story a card can be anchored in: the body, the
// headers and footers, and the notes. Split out of the editor facade because it is pure over
// a published layout — it reads records and returns geometry, and nothing about it needs the
// editor's state.
//
// The recurring subtlety is that a fragment answers for more than the paragraph it is named
// after. A resolved display mode publishes a merged run as ONE fragment under the survivor's
// identity, so a card anchored in an absorbed member has no fragment of its own. Registering
// only `fragment.paragraphId` left those cards with no geometry, and the rail drops a card it
// cannot place.

import {
  paragraphFragmentsOfBlocks,
  type ReviewParagraphAnchor,
  type SemanticLayout,
} from '@docx-editor.dev/core/layout';
import { bodyReviewAnchors } from '../layout/body-review-anchors.ts';
import { textboxOnlyLayout } from './textbox-presence-layout.ts';
import { fragmentParagraphs } from '../layout/line-segments.ts';
import { weakRefOf, type WeakRefOf } from '../store/package/weak-ref.ts';

/**
 * Paragraph anchors for every story on a layout, memoized on the layout OBJECT.
 *
 * A published layout is immutable, so the index is valid for exactly as long as that object
 * is the current one, and a new revision brings a new one.
 */

export function createAnchorIndex(
  hostOf?: (paragraphId: string) => string | null
): (layout: SemanticLayout) => ReadonlyMap<string, ReviewParagraphAnchor> {
  const index = createStoryAnchorIndex();
  if (!hostOf) return index;
  const boxIndex = createStoryAnchorIndex();
  const views = new WeakMap<ReadonlyMap<string, ReviewParagraphAnchor>, TextboxHostAnchors>();
  return (layout) => {
    const stories = index(layout);
    let view = views.get(stories);
    if (!view) {
      const boxes = () => boxIndex(textboxOnlyLayout(layout));
      views.set(stories, (view = new TextboxHostAnchors(stories, boxes, hostOf)));
    }
    return view;
  };
}

/**
 * The story anchors, answering for a text box paragraph too. Box text is laid out inside its
 * drawing, never in a story's fragments, so a card on it and the comment affordance over it
 * had no geometry and the rail could not place them. A box paragraph answers with its own
 * lines, from the box paragraphs laid out on each page, so its card sits level with its text; a
 * box with no such lines answers with the top of the paragraph it rides in. Only a miss
 * builds either, so ordinary paragraphs cost what they always did.
 */
class TextboxHostAnchors implements ReadonlyMap<string, ReviewParagraphAnchor> {
  readonly [Symbol.toStringTag] = 'Map';
  private readonly hosted = new Map<string, ReviewParagraphAnchor | null>();

  constructor(
    private readonly stories: ReadonlyMap<string, ReviewParagraphAnchor>,
    private readonly boxes: () => ReadonlyMap<string, ReviewParagraphAnchor>,
    private readonly hostOf: (paragraphId: string) => string | null
  ) {}

  get(paragraphId: string): ReviewParagraphAnchor | undefined {
    const own = this.stories.get(paragraphId);
    if (own) return own;
    let hosted = this.hosted.get(paragraphId);
    if (hosted === undefined) {
      // The box's own lines first: a box paragraph laid out on a page needs no tree walk.
      const boxed = this.boxes().get(paragraphId);
      if (boxed) {
        this.hosted.set(paragraphId, boxed);
        return boxed;
      }
      const hostId = this.hostOf(paragraphId);
      const host = hostId === null ? undefined : this.stories.get(hostId);
      // Without lines: the host's lines count offsets in the host, not in the box.
      hosted = host
        ? { pageIndex: host.pageIndex, contentY: host.contentY, fragmentY: host.fragmentY }
        : null;
      this.hosted.set(paragraphId, hosted);
    }
    return hosted ?? undefined;
  }

  has(paragraphId: string): boolean {
    return this.get(paragraphId) !== undefined;
  }

  get size(): number {
    return this.stories.size;
  }

  forEach(
    callback: (
      value: ReviewParagraphAnchor,
      key: string,
      map: ReadonlyMap<string, ReviewParagraphAnchor>
    ) => void,
    thisArg?: unknown
  ): void {
    this.stories.forEach((value, key) => callback.call(thisArg, value, key, this));
  }

  entries() {
    return this.stories.entries();
  }

  keys() {
    return this.stories.keys();
  }

  values() {
    return this.stories.values();
  }

  [Symbol.iterator]() {
    return this.stories[Symbol.iterator]();
  }
}

function createStoryAnchorIndex(): (
  layout: SemanticLayout
) => ReadonlyMap<string, ReviewParagraphAnchor> {
  const cache = new WeakMap<SemanticLayout, ReviewAnchorIndex>();
  let last: {
    readonly pages: WeakRefOf<SemanticLayout['pages']>;
    readonly index: WeakRefOf<ReviewAnchorIndex>;
  } | null = null;
  return (layout) => {
    const cached = cache.get(layout);
    if (cached) return cached;
    const carried = last && carriedIndex(last, layout);
    if (carried) {
      cache.set(layout, carried);
      last = { pages: weakRefOf(layout.pages), index: weakRefOf(carried) };
      return carried;
    }
    const index = new Map<string, ReviewParagraphAnchor>();
    for (const page of layout.pages)
      for (const [id, anchor] of bodyReviewAnchors(page)) if (!index.has(id)) index.set(id, anchor);
    for (const page of layout.pages)
      for (const [id, anchor] of otherStoryAnchors(page)) if (!index.has(id)) index.set(id, anchor);
    const complete = ReviewAnchorIndex.from(index);
    cache.set(layout, complete);
    last = { pages: weakRefOf(layout.pages), index: weakRefOf(complete) };
    return complete;
  };
}

function sameKeys(a: ReadonlyMap<string, unknown>, b: ReadonlyMap<string, unknown>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a.keys()) if (!b.has(key)) return false;
  return true;
}

const otherAnchors = new WeakMap<
  SemanticLayout['pages'][number],
  Map<string, ReviewParagraphAnchor>
>();

/** Furniture and notes in the same first-page order as the complete index. */
function otherStoryAnchors(
  page: SemanticLayout['pages'][number]
): Map<string, ReviewParagraphAnchor> {
  const known = otherAnchors.get(page);
  if (known) return known;
  const anchors = new Map<string, ReviewParagraphAnchor>();
  for (const story of [page.header, page.footer]) {
    if (story) register(anchors, story.fragments, page.index, story.box.y);
  }
  for (const area of [page.footnotes, page.endnotes]) {
    if (!area) continue;
    for (const note of area.notes) register(anchors, note.fragments, page.index, note.box.y);
  }
  otherAnchors.set(page, anchors);
  return anchors;
}

/** One page's body anchors, from the per-page cache the full index reads. */
const bodyAnchorsOf = (page: SemanticLayout['pages'][number]) => bodyReviewAnchors(page);

/**
 * The previous index with each changed page's anchors swapped in, when nothing else can have
 * moved. A keystroke publishes a new layout whose pages are the previous objects but the one it
 * landed on, and the whole index was built again per keystroke. A changed page qualifies when
 * its body and other stories anchor the same
 * paragraphs; an entry is replaced only where the previous index took it from that page, since
 * the first page wins.
 */
function carriedIndex(
  last: {
    readonly pages: WeakRefOf<SemanticLayout['pages']>;
    readonly index: WeakRefOf<ReviewAnchorIndex>;
  },
  layout: SemanticLayout
): ReviewAnchorIndex | null {
  const previous = last.pages.deref();
  const lastIndex = last.index.deref();
  if (!previous || !lastIndex || previous.length !== layout.pages.length) return null;
  let index: Map<string, ReviewParagraphAnchor> | null = null;
  for (const [position, page] of layout.pages.entries()) {
    const before = previous[position]!;
    if (page === before) continue;
    const anchors = bodyAnchorsOf(page);
    const was = bodyAnchorsOf(before);
    if (!sameKeys(anchors, was)) return null;
    // A pass lays the page's note areas out again; their paragraphs must be the ones it held.
    const other = otherStoryAnchors(page);
    const wasOther = otherStoryAnchors(before);
    if (!sameKeys(other, wasOther)) return null;
    index ??= new Map();
    for (const [id, anchor] of anchors)
      if (lastIndex.get(id) === was.get(id)) index.set(id, anchor);
    // Body anchors and earlier story occurrences retain precedence.
    for (const [id, anchor] of other)
      if (lastIndex.get(id) === wasOther.get(id)) index.set(id, anchor);
  }
  return index ? lastIndex.updated(index) : lastIndex;
}

function register(
  index: Map<string, ReviewParagraphAnchor>,
  fragments: Parameters<typeof paragraphFragmentsOfBlocks>[0],
  pageIndex: number,
  contentY: number
): void {
  for (const fragment of paragraphFragmentsOfBlocks(fragments)) {
    for (const paragraphId of fragmentParagraphs(fragment)) {
      if (index.has(paragraphId)) continue;
      index.set(paragraphId, {
        pageIndex,
        contentY,
        fragmentY: fragment.box.y,
        ...(fragment.lines ? { lines: fragment.lines } : {}),
      });
    }
  }
}

const warmsPending = new WeakSet<object>();

/**
 * Run `warm` once the window is idle, at most once at a time per `key`.
 *
 * A layout can replace every page record without a change a host hears about (a background
 * pass settling footnote reserves does). The review rail then re-anchors every page on the
 * next keystroke instead, and that keystroke waited for it. Warming the index in idle time
 * moves that work off the keystroke.
 */
export function warmAnchorsWhenIdle(key: object, view: Window, warm: () => void): void {
  if (warmsPending.has(key)) return;
  warmsPending.add(key);
  const run = (): void => {
    warmsPending.delete(key);
    warm();
  };
  if (typeof view.requestIdleCallback === 'function')
    view.requestIdleCallback(run, { timeout: 1000 });
  else view.setTimeout(run, 200);
}
