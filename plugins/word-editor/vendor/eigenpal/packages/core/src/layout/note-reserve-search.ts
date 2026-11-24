// Runs the page-by-page footnote reserve walk (`note-reserve-walk.ts`) for one notes pass.
//
// A pass with a previous walk on its session first lays the body out under the previous
// reserves, each page reading the reserve its content had before. That probe is cheap: it
// resumes at the edit and reuses the unchanged pages after it. Comparing its pages with the
// previous layout shows where the content changed and where it stops changing, whatever the
// change was: text, styles, pictures or note numbers. The walk keeps the decisions on the
// pages before the change, and takes the previous decisions again once it reaches unchanged
// content.
//
// The walk's rounds lay out only a few pages past the page being decided. They run on the
// caller's session, which is then put back as the probe left it, so the final pass resumes
// at the edit and reuses the pages after it as any warm pass does.

import { snapshotLayoutSession } from './layout-session-snapshot.ts';
import { fragmentParagraphs } from './line-segments.ts';
import { fragmentFlowBottom } from './note-fragment-geometry.ts';
import type { LayoutSession } from './layout-session.ts';
import type { LayoutProgress, LayoutSteps } from './layout-steps.ts';
import { noteBodyGeometryChanged } from './note-body-geometry.ts';
import { previousBodyLayout } from './previous-body-pages.ts';
import { layoutNodeDigest } from './layout-cache.ts';
import {
  walkFootnoteReserves,
  type ReserveComputeRange,
  type ReserveComputeResult,
  type ReserveWalkRecord,
  type ReserveWalkRound,
} from './note-reserve-walk.ts';
import type { BlockFragmentRecord, PageRecord, SemanticLayout } from './semantic-records.ts';
import type { DocumentSection } from './section-properties.ts';
import { W14_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';

type Reserves = ReadonlyMap<number, number>;

/** Inputs that change every page's notes without changing the body. */
export interface ReserveSearchInputs {
  readonly footnotesPart: OoxmlPart | null;
  /** Everything else the notes read; compared item by item. */
  readonly others: readonly unknown[];
}

/**
 * The walk a pass made, for the next pass on the same session. It rides the session's notes
 * memo, so a host that puts a dropped pass back puts this back with the layout it describes.
 */
export interface ReserveSearchState {
  readonly record: ReserveWalkRecord;
  readonly inputs: ReserveSearchInputs;
  readonly limit: number;
  /** Some page of the walk took a cycle answer. */
  readonly exhausted: boolean;
}

export interface ReserveSearchOptions {
  readonly session: LayoutSession | undefined;
  /** The walk of the pass that published `session.previous`, if it ran one. */
  readonly state: ReserveSearchState | null;
  readonly part: OoxmlPart;
  /** The body blocks the pass lays out, in order. */
  readonly blocks: readonly OoxmlNode[];
  readonly inputs: ReserveSearchInputs;
  /** The pass's body block limit, or -1. */
  readonly limit: number;
  /** The block index each section of the body ends before, in order. */
  readonly sectionEnds?: readonly number[];
  /** Body paragraph ids that cite each footnote id. */
  readonly citingParagraphs: (noteId: number) => readonly string[];
  /**
   * Some section starts on an odd or even page. A page's answer then may read the page after
   * a blank sheet that only one of its trial reserves makes.
   */
  readonly parityStarts: boolean;
  /**
   * Lay out the body under `reserves`. `blockLimit` lays out only that many blocks; `follow`
   * reads each page's reserve where its content stood in the previous pass.
   */
  readonly body: (
    reserves: Reserves,
    blockLimit: number | undefined,
    follow: boolean
  ) => LayoutSteps<SemanticLayout>;
  /** After a `follow` run: the reserves its pages were laid out under. */
  readonly followedReserves: (given: Reserves) => Reserves;
  readonly compute: (
    layout: SemanticLayout,
    used: Reserves,
    allowOrphanDeferral: boolean,
    range: ReserveComputeRange
  ) => ReserveComputeResult;
  readonly carryKey: (carry: unknown) => string;
  readonly stopped: () => boolean;
}

export interface ReserveSearchResult {
  readonly layout: SemanticLayout;
  readonly reserves: Reserves;
  readonly exhausted: boolean;
  readonly state: ReserveSearchState;
}

function reservesEqual(a: Reserves, b: Reserves): boolean {
  if (a.size !== b.size) return false;
  for (const [index, height] of a) if (b.get(index) !== height) return false;
  return true;
}

/** A paragraph's `w14:paraId` or `w14:textId`: identity only, which layout never reads. */
function isParagraphIdentity(attribute: { localName: string; namespaceUri?: string }): boolean {
  return (
    attribute.namespaceUri === W14_NAMESPACE_URI &&
    (attribute.localName === 'paraId' || attribute.localName === 'textId')
  );
}

/**
 * Two note stories that lay out alike: equal, or equal apart from paragraph identity, which
 * an editor adds to every paragraph when it opens a file.
 */
function sameStory(a: OoxmlNode, b: OoxmlNode): boolean {
  if (a === b) return true;
  if (a.kind === 'textValue' || b.kind === 'textValue') {
    return a.kind === 'textValue' && b.kind === 'textValue' && a.value === b.value;
  }
  if (a.localName !== b.localName || a.namespaceUri !== b.namespaceUri) return false;
  const left = a.attributes.filter((attribute) => !isParagraphIdentity(attribute));
  const right = b.attributes.filter((attribute) => !isParagraphIdentity(attribute));
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const was = left[index]!;
    const now = right[index]!;
    if (
      was.localName !== now.localName ||
      was.namespaceUri !== now.namespaceUri ||
      was.value !== now.value
    ) {
      return false;
    }
  }
  if (a.children.length !== b.children.length) return false;
  for (let index = 0; index < a.children.length; index += 1) {
    if (!sameStory(a.children[index]!, b.children[index]!)) return false;
  }
  return true;
}

/** Two note stories that lay out alike, by digest first. */
function sameNote(was: OoxmlNode, now: OoxmlNode): boolean {
  return was === now || layoutNodeDigest(was) === layoutNodeDigest(now) || sameStory(was, now);
}

/**
 * A notes part with the same notes: the same object, or one whose root holds the same
 * stories. Only the root's own attributes may differ; they declare namespaces, and a store
 * can add one to the root without changing a note.
 */
function samePart(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const left = a as Partial<OoxmlPart> | null;
  const right = b as Partial<OoxmlPart> | null;
  if (!left?.root || !right?.root || left.name !== right.name) return false;
  const before = left.root.children;
  const after = right.root.children;
  if (before.length !== after.length) return false;
  for (let index = 0; index < before.length; index += 1) {
    const was = before[index]!;
    const now = after[index]!;
    if (!sameNote(was, now)) return false;
  }
  return true;
}

function sameInputs(a: ReserveSearchInputs, b: ReserveSearchInputs): boolean {
  return (
    a.others.length === b.others.length &&
    a.others.every((value, i) => samePart(value, b.others[i]))
  );
}

/**
 * Where a page starts: its first block and offset, its geometry, and the notes it carries in.
 * Empty when the start does not name one place in the document: a page with no content, or
 * a page that opens inside a split table row, whose cells each resume at their own offset.
 */
function pageStart(page: PageRecord, carry: string): string {
  const first = page.fragments[0];
  if (!first || page.parityBlank) return '';
  let at: string;
  if (first.kind === 'paragraph') {
    at = `p:${first.paragraphId}:${first.range.start}:${first.fragmentIndex}`;
  } else {
    if (first.rows.some((row) => row.isContinuation)) return '';
    at = `t:${first.tableId}:${first.fragmentIndex}:${first.rows.map((row) => row.id).join(',')}`;
  }
  const box = page.contentBox;
  return `${at}|${box.width}x${box.height}|${carry}`;
}

function footnoteNodes(part: OoxmlPart | null): Map<string, OoxmlNode> {
  const notes = new Map<string, OoxmlNode>();
  if (!part) return notes;
  for (const child of part.root.children) {
    if (child.kind === 'textValue' || child.localName !== 'footnote') continue;
    const id = child.attributes.find(
      (attribute) => attribute.localName === 'id' && attribute.namespaceUri === WML_NAMESPACE_URI
    )?.value;
    if (id !== undefined) notes.set(id, child);
  }
  return notes;
}

/** Footnote ids whose story changed between two notes parts. */
function changedFootnotes(before: OoxmlPart | null, after: OoxmlPart | null): number[] | null {
  if (before === after) return [];
  if (!before || !after) return null;
  const old = footnoteNodes(before);
  const now = footnoteNodes(after);
  const changed = new Set<string>();
  for (const [id, node] of now) {
    const was = old.get(id);
    if (!was || !sameNote(was, node)) changed.add(id);
  }
  for (const id of old.keys()) if (!now.has(id)) changed.add(id);
  const ids: number[] = [];
  for (const id of changed) {
    const value = Number(id);
    // A separator or notice changes every note area, whatever its id.
    if (!Number.isInteger(value) || value <= 0) return null;
    if (isSpecialNote(old.get(id)) || isSpecialNote(now.get(id))) return null;
    ids.push(value);
  }
  return ids;
}

/** A separator, continuation separator, or continuation notice: any typed note story. */
function isSpecialNote(node: OoxmlNode | undefined): boolean {
  if (!node || node.kind === 'textValue') return false;
  return node.attributes.some(
    (attribute) =>
      attribute.localName === 'type' &&
      attribute.namespaceUri === WML_NAMESPACE_URI &&
      attribute.value !== 'normal'
  );
}

/** The first and last previous-layout page holding a fragment of one of `paragraphIds`. */
function pagesHolding(
  layout: SemanticLayout,
  paragraphIds: ReadonlySet<string>
): [number, number] | null {
  let first = -1;
  let lastPage = -1;
  layout.pages.forEach((page, index) => {
    if (!holdsParagraph(page.fragments, paragraphIds, 0)) return;
    if (first < 0) first = index;
    lastPage = index;
  });
  return first < 0 ? null : [first, lastPage];
}

/** Fragments, table cell content included, hold a fragment of one of `paragraphIds`. */
function holdsParagraph(
  fragments: readonly BlockFragmentRecord[],
  paragraphIds: ReadonlySet<string>,
  depth: number
): boolean {
  // Past the depth bound, count the page as holding one: a wider changed range is only slower.
  if (depth > MAX_RECORD_DEPTH) return true;
  for (const fragment of fragments) {
    if (fragment.kind === 'paragraph') {
      if (paragraphIds.has(fragment.paragraphId)) return true;
      // A merged fragment of a display mode is named after the paragraph that survives; the
      // paragraphs it absorbed cite their notes from it too.
      if (fragmentParagraphs(fragment).some((id) => paragraphIds.has(id))) return true;
      continue;
    }
    for (const row of fragment.rows) {
      for (const cell of row.cells) {
        if (holdsParagraph(cell.blocks, paragraphIds, depth + 1)) return true;
      }
    }
  }
  return false;
}

/** How many blocks past its target a round lays out to end at a section end. */
const SECTION_END_REACH_BLOCKS = 400;

/** The finest step of the round block limit grid; see `onLimitGrid`. */
const MIN_LIMIT_STEP = 64;

/**
 * `limit` rounded up to a grid whose step is about a quarter of it, at most `count`.
 *
 * A round lays out the blocks before its limit. The body pass keeps its section preparation
 * while the blocks stay the same, and the walk mostly asks for a few pages past the last
 * round, so on the grid most rounds cut where the previous one did and prepare nothing again.
 * The blocks a coarser cut adds past the target are placed only once: the next round resumes
 * before them and stops where its flow meets the previous round's.
 */
function onLimitGrid(limit: number, count: number): number {
  let step = MIN_LIMIT_STEP;
  while (step * 8 <= limit) step *= 2;
  return Math.min(count, Math.ceil(limit / step) * step);
}

/** Blocks a page holds, as a walk with no layout to read guesses for its first round. */
const COLD_BLOCKS_PER_PAGE = 8;

/** Deeper records than this count as different; layout records stay far below it. */
const MAX_RECORD_DEPTH = 32;

/**
 * Two layout records hold the same values. Shared objects compare by identity first, so a
 * reused subtree costs one step.
 */
function sameRecord(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (depth >= MAX_RECORD_DEPTH || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    if (a.length !== other.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!sameRecord(a[index], other[index], depth + 1)) return false;
    }
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  const pageField = isPageFieldSpan(left) && isPageFieldSpan(right);
  for (const key of keys) {
    if (pageField && (key === 'text' || key === 'box')) continue;
    // A picture's loading state: its box comes from the authored extent, never from the image.
    if (key === 'resource') continue;
    if (!Object.hasOwn(right, key) || !sameRecord(left[key], right[key], depth + 1)) return false;
  }
  return true;
}

/**
 * A span that shows a page number or page count. Its text is projected after layout, and a
 * published layout counts the note-only sheets that the body pass does not, so the text can
 * differ while the body is the same.
 */
function isPageFieldSpan(record: Record<string, unknown>): boolean {
  const atom = record['fieldAtom'];
  return (
    record['projected'] === true &&
    typeof atom === 'object' &&
    atom !== null &&
    typeof (atom as { pageField?: unknown }).pageField === 'object'
  );
}

/**
 * A page holds the same body content as a previous page. A reused page can carry new
 * fragment objects with the same values: a pass refreshes page-count field text on every
 * page that shows it.
 */
function sameBody(page: PageRecord | undefined, previous: PageRecord): boolean {
  if (!page || !sameFrame(page, previous)) return false;
  return page.fragments === previous.fragments || sameRecord(page.fragments, previous.fragments);
}

/**
 * Two pages have the same sheet size and margins. The note area limit comes from them, so a
 * page size edit changes a page's reserve also when its body stays the same. The sheet's
 * position on the canvas is not compared: it moves with every page above it.
 */
function sameFrame(page: PageRecord, previous: PageRecord): boolean {
  const a = page.box;
  const b = previous.box;
  const ac = page.contentBox;
  const bc = previous.contentBox;
  return (
    a.width === b.width &&
    a.height === b.height &&
    ac.width === bc.width &&
    ac.height === bc.height &&
    ac.x - a.x === bc.x - b.x &&
    ac.y - a.y === bc.y - b.y
  );
}

/**
 * The first page whose body differs from the previous layout, and the first previous page
 * from which every page is reused unchanged (Infinity when none is).
 */
function changedRange(probe: SemanticLayout, previous: SemanticLayout): [number, number] {
  const shared = Math.min(probe.pages.length, previous.pages.length);
  let first = 0;
  while (first < shared && sameBody(probe.pages[first], previous.pages[first]!)) first += 1;
  const delta = probe.pages.length - previous.pages.length;
  let from = previous.pages.length;
  while (from > 0) {
    const at = from - 1 + delta;
    if (at < first || !sameBody(probe.pages[at], previous.pages[from - 1]!)) break;
    from -= 1;
  }
  return [first, from >= previous.pages.length ? Number.POSITIVE_INFINITY : from];
}

/** The first page whose reserve differs between `a` and `b`; a missing page reserves nothing. */
function firstDifferentReserve(a: Reserves, b: Reserves): number {
  let first = Number.POSITIVE_INFINITY;
  for (const [index, height] of a) {
    if (index < first && (b.get(index) ?? 0) !== height) first = index;
  }
  for (const [index, height] of b) {
    if (index < first && (a.get(index) ?? 0) !== height) first = index;
  }
  return first;
}

/**
 * Whether a pass with body block limit `next` (-1 for none) can resume the walk of a pass with
 * limit `previous`. A progressive open lays out growing prefixes of the body. The blocks a
 * larger limit adds act as an edit after the previous cut, so the walk keeps the pages before
 * it, as for any edit. Without this, each prefix decides every page again from the first.
 */
function extendsLimit(previous: number, next: number): boolean {
  if (previous === next) return true;
  return previous !== -1 && (next === -1 || next > previous);
}

/** Report only the pages the walk has decided, so a host shows no undecided page. */
function* decidedProgress<T>(steps: LayoutSteps<T>, decided: () => number): LayoutSteps<T> {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    const progress = next.value;
    if (!progress) {
      yield progress;
      continue;
    }
    const count = Math.min(decided(), progress.pages.length);
    const clamped: LayoutProgress = { ...progress, pages: progress.pages.slice(0, count) };
    yield clamped;
  }
}

/** Decide the footnote reserves for one pass and return its published body layout. */
export function* searchFootnoteReserves(
  options: ReserveSearchOptions
): LayoutSteps<ReserveSearchResult> {
  const { session, part, blocks, state } = options;
  const previousLayout = previousBodyLayout(session?.previous ?? null);
  // Block positions by id, for the rounds' block limits. Built on the first round that needs
  // one: an edit whose probe answers every round lays out no round.
  let blockIndex: Map<string, number> | null = null;

  // The probe: the body under the previous answer. It is also the published layout when the
  // walk keeps that answer. When the edit moved pages and nothing after it lined up, a second
  // probe reads each page's reserve where its content stood, so the pages after the edit do.
  // That one only locates the change: the reserves its pages read are not one map.
  let probe: { layout: SemanticLayout; used: Reserves } | null = null;
  let startFloor = 0;
  let unchangedFrom = Number.POSITIVE_INFINITY;
  let probeLayout: SemanticLayout | null = null;
  let unchanged = false;
  let followed = false;
  const reuse =
    state && previousLayout && extendsLimit(state.limit, options.limit) ? state : undefined;
  if (reuse && sameInputs(reuse.inputs, options.inputs)) {
    const given = reuse.record.reserves;
    let layout = yield* options.body(given, undefined, false);
    probe = { layout, used: given };
    let range = changedRange(layout, previousLayout!);
    if (!Number.isFinite(range[1]) && layout.pages.length !== previousLayout!.pages.length) {
      layout = yield* options.body(given, undefined, true);
      // Each page read one reserve, so this probe is the body under the reserves it read, and
      // serves the walk's rounds as the first probe does. It is not the previous answer.
      probe = { layout, used: options.followedReserves(given) };
      followed = true;
      range = changedRange(layout, previousLayout!);
    }
    probeLayout = layout;
    const notes = changedFootnotes(reuse.inputs.footnotesPart, options.inputs.footnotesPart);
    if (!noteBodyGeometryChanged(session, layout, part) && notes !== null) {
      let [first, from] = range;
      unchanged =
        probe !== null &&
        !followed &&
        notes.length === 0 &&
        first >= previousLayout!.pages.length &&
        layout.pages.length === previousLayout!.pages.length;
      const citing = new Set(notes.flatMap((id) => options.citingParagraphs(id)));
      const held = citing.size > 0 ? pagesHolding(previousLayout!, citing) : null;
      if (held) {
        first = Math.min(first, held[0]);
        from = Math.max(from, held[1] + 1);
      }
      // A page's answer reads the next page, or the one after a blank parity sheet.
      const reads = options.parityStarts || previousLayout!.pages[first - 1]?.parityBlank ? 2 : 1;
      startFloor = Math.max(0, Math.min(first - reads, reuse.record.decided));
      // The walk starts from the notes carried into its first page; a page with no record of
      // them starts earlier.
      while (startFloor > 0 && reuse.record.carries[startFloor] === undefined) startFloor -= 1;
      unchangedFrom = from;
    }
  } else if (session) {
    noteBodyGeometryChanged(session, previousLayout ?? { revision: 0, pages: [] }, part);
  }
  // The session as the probe left it, saved before the first round the walk lays out: a walk
  // whose rounds the probe answers changes nothing in it.
  const saved: { restore?: () => void } = {};
  // The reserves the session's checkpoints were last laid out under. A round resumes at the
  // first page whose reserve differs from them. The probe covers the whole body, so a round
  // whose reserves agree with the probe's further than with the last round's starts from the
  // probe instead: it then lays out from the page being decided, not from the note page the
  // last real round decided. A followed probe keeps its seed's record, so it is not used here.
  let sessionUsed: Reserves | null = probe && !followed ? probe.used : null;

  // The latest round's layout, and the latest layout that reached the end of the body.
  let reference: SemanticLayout | null = probeLayout ?? previousLayout;
  let wholeReference = reference;
  const blockAt = (page: PageRecord | undefined, last: boolean): number | undefined => {
    const fragments = page?.fragments ?? [];
    for (let at = 0; at < fragments.length; at += 1) {
      const fragment = fragments[last ? fragments.length - 1 - at : at]!;
      const id =
        fragment.kind === 'paragraph'
          ? fragment.paragraphId
          : fragment.kind === 'table'
            ? fragment.tableId
            : undefined;
      if (id === undefined) continue;
      if (blockIndex === null) {
        blockIndex = new Map();
        for (let at = 0; at < blocks.length; at += 1) blockIndex.set(blocks[at]!.id, at);
      }
      const index = blockIndex.get(id);
      if (index !== undefined) return index;
    }
    return undefined;
  };
  // How many blocks a round lays out: through the first block of the page after `page`. The
  // latest round is cut short, so a page past its end is looked up in the latest whole layout,
  // and estimated from the blocks per page so far when no layout names it.
  const blockLimitThrough = (page: number): number => {
    const index =
      blockAt(reference?.pages[page + 1], false) ?? blockAt(wholeReference?.pages[page + 1], false);
    if (index !== undefined) return index + 1;
    const pages = reference?.pages ?? [];
    // With no layout at all, a first round guesses a few blocks a page and grows from there.
    if (pages.length === 0) return Math.min(blocks.length, (page + 2) * COLD_BLOCKS_PER_PAGE);
    const reached = blockAt(pages[pages.length - 1], true);
    if (reached === undefined) return blocks.length;
    return Math.min(blocks.length, Math.ceil(((reached + 1) * (page + 2)) / pages.length) + 16);
  };
  let decided = startFloor;
  // A round ends at a section end when one is near. Each section it lays out is then complete,
  // as in every other round, so the next round reuses those sections and their table rows
  // instead of laying them out again; a cut inside a section matches no other round's cut.
  const sectionEnds = options.sectionEnds ?? [];
  const atSectionEnd = (limit: number): number => {
    for (const end of sectionEnds) {
      if (end < limit) continue;
      // The last section ends with the body: a round that reached it would be whole.
      if (end >= blocks.length) return limit;
      return end - limit <= SECTION_END_REACH_BLOCKS ? Math.min(blocks.length, end) : limit;
    }
    return limit;
  };
  function* round(
    reserves: Reserves,
    throughPage: number,
    neededPage: number
  ): LayoutSteps<ReserveWalkRound> {
    // The probe already laid these pages: a page depends only on the reserves of the pages up
    // to it, so the probe's pages before the first reserve that differs are this round's. Its
    // last page is left out, so the walk reads no page as whole that this round would cut.
    if (probe) {
      const shared = Math.min(
        firstDifferentReserve(probe.used, reserves),
        probe.layout.pages.length - 1
      );
      if (shared >= neededPage + 2) {
        const layout = { ...probe.layout, pages: probe.layout.pages.slice(0, shared) };
        reference = layout;
        return { layout, whole: false };
      }
    }
    if (session && !saved.restore) saved.restore = snapshotLayoutSession(session);
    else if (
      saved.restore &&
      probe &&
      !followed &&
      sessionUsed !== probe.used &&
      firstDifferentReserve(probe.used, reserves) >
        (sessionUsed ? firstDifferentReserve(sessionUsed, reserves) : -1)
    ) {
      saved.restore();
      sessionUsed = probe.used;
    }
    let limit = atSectionEnd(onLimitGrid(blockLimitThrough(throughPage + 1), blocks.length));
    for (;;) {
      const whole = limit >= blocks.length;
      const layout = yield* decidedProgress(
        options.body(reserves, whole ? undefined : limit, false),
        () => decided
      );
      reference = layout;
      sessionUsed = reserves;
      if (whole) wholeReference = layout;
      // A round short of its target still serves when the walk can decide a page from it.
      if (whole || layout.pages.length >= neededPage + 2) return { layout, whole };
      // Too few pages: grow by the pages still missing, as the blocks so far fill them. The
      // last page of a cut-short layout is partial, so it does not count.
      const filled = Math.max(1, layout.pages.length - 1);
      const grown = Math.ceil((limit * (throughPage + 2)) / filled);
      limit = atSectionEnd(onLimitGrid(Math.max(limit + 16, grown), blocks.length));
    }
  }

  const prefix = reuse?.record;
  // Nothing the notes read moved: the previous answer stands, and so does its layout.
  if (unchanged && probe && prefix?.complete && reuse) {
    // Keep this pass's inputs: the next pass then compares against these objects by identity
    // instead of comparing every note story again.
    const state = { ...reuse, inputs: options.inputs };
    return { layout: probe.layout, reserves: probe.used, exhausted: reuse.exhausted, state };
  }
  const walked = yield* walkFootnoteReserves({
    start: {
      reserves: prefix && startFloor > 0 ? prefix.reserves : new Map(),
      floor: startFloor,
      carry: (startFloor > 0 ? prefix?.carries[startFloor] : undefined) ?? new Map(),
      starts: startFloor > 0 ? (prefix?.starts ?? []) : [],
      carries: startFloor > 0 ? (prefix?.carries ?? []) : [],
    },
    ...(prefix && Number.isFinite(unchangedFrom)
      ? { previous: { record: prefix, unchangedFrom } }
      : {}),
    round,
    growAfterReserve: sectionEnds.length > 1,
    parityStarts: options.parityStarts,
    compute: (layout, used, deferral, range) => {
      decided = range.from;
      return options.compute(layout, used, deferral, range);
    },
    startOf: (page, carry) => pageStart(page, options.carryKey(carry)),
    keepsBody: (page, reserve) =>
      fragmentFlowBottom(page.fragments) + reserve <= page.contentBox.height + 0.001,
    stopped: options.stopped,
  });

  let layout: SemanticLayout;
  if (walked.last?.whole && walked.lastCurrent) {
    layout = walked.last.layout;
  } else if (probe && reservesEqual(probe.used, walked.reserves)) {
    saved.restore?.();
    layout = probe.layout;
  } else {
    saved.restore?.();
    decided = Number.POSITIVE_INFINITY;
    layout = yield* options.body(walked.reserves, undefined, false);
  }
  return {
    layout,
    reserves: walked.reserves,
    exhausted: walked.exhausted,
    state: {
      record: walked.record,
      inputs: options.inputs,
      limit: options.limit,
      exhausted: walked.exhausted,
    },
  };
}

/**
 * The blocks and sections a body run lays out: all of them, or the first
 * `noteRoundBlockLimit` for a round of the reserve search. A section the limit cuts keeps its
 * own properties; only its end moves.
 *
 * A document with more than one section lays every round out on the multi-section path, even
 * a round cut inside its first section. The rounds of one search then share its section
 * sessions, and a round that reaches the later sections resumes from them instead of laying
 * out every page again.
 */
export function noteRoundBlocks<Block extends OoxmlElement>(
  _part: OoxmlPart,
  blocks: readonly Block[],
  sections: readonly DocumentSection[],
  options: { readonly noteRoundBlockLimit?: number }
): readonly [readonly Block[], readonly DocumentSection[]] {
  const limit = options.noteRoundBlockLimit;
  if (limit === undefined || limit >= blocks.length) return [blocks, sections];
  const end = Math.max(1, limit);
  // Rounds of one search mostly cut where the previous one did: the same arrays then, so the
  // checks a pass keys on its block list's identity hold.
  const previous = roundCuts.get(blocks);
  if (previous && previous.end === end && previous.sections === sections) {
    return previous.cut as readonly [readonly Block[], readonly DocumentSection[]];
  }
  const kept: DocumentSection[] = [];
  for (const section of sections) {
    if (section.blockStart >= end && kept.length > 0) break;
    kept.push(section.blockEndExclusive > end ? { ...section, blockEndExclusive: end } : section);
  }
  const cut = [blocks.slice(0, end), kept] as const;
  roundCuts.set(blocks, { end, sections, cut });
  return cut;
}

/** The last round cut of each block list; see `noteRoundBlocks`. */
const roundCuts = new WeakMap<
  readonly OoxmlElement[],
  {
    readonly end: number;
    readonly sections: readonly DocumentSection[];
    readonly cut: readonly [readonly OoxmlElement[], readonly DocumentSection[]];
  }
>();
