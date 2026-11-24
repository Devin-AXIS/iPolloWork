// Refuse an endpoint whose position moved after the endpoint was read.
//
// Offsets are raw UTF-16 positions in one paragraph. An edit before an offset moves it, so an
// endpoint read before that edit names different text afterwards. Written through, it edits
// whatever now sits at the old offset: the wrong words, silently.
//
// The host stamps every endpoint it answers with the revision it was read at (`readAt`), and
// records the text of the endpoint's paragraph at that revision. An endpoint at offset k read at
// an older revision is still valid while the paragraph's first k characters are unchanged: an
// edit after it, or a formatting edit anywhere, moves nothing. A span's end endpoint covers its
// content in a one-paragraph span. A span's start in an EARLIER paragraph than its end covers
// the rest of that paragraph too, so there the whole paragraph must be unchanged, and so must every
// paragraph between the two endpoints and the list of those paragraphs: a paragraph that another
// writer inserted or removed between them changes what the span covers. A revision the history
// no longer holds cannot be checked, so it is stale too: the caller reads again.
//
// The history is kept per paragraph, not per revision: a paragraph whose text does not change
// keeps one record for as long as it stays unchanged, so a long run of writes elsewhere never
// expires it. Superseded records go first, oldest first, once the total text exceeds a budget.
// Current records have a budget of their own: past it, the keys read least recently leave
// first. Those are mostly keys that are never read again, such as deleted paragraphs and the
// `between` and `next` keys around them, so a long session does not grow without bound.

import type { AutomationHandleTable } from './handles.ts';
import type { AutomationPackageReads } from './reads.ts';
import { resolveParagraphHandle } from './spans.ts';

/**
 * UTF-16 code units of SUPERSEDED paragraph text the host keeps for this check. The current
 * record of each key does not count against it.
 */
export const STALE_SPAN_TEXT_BUDGET = 4_000_000;

/**
 * UTF-16 code units of CURRENT records (key and text) the host keeps. Past it, the current
 * records of the keys read least recently leave, and reads at them are no longer checkable.
 */
export const STALE_SPAN_CURRENT_TEXT_BUDGET = 16_000_000;

/** Nesting a request or answer may use before the walk stops looking for endpoints. */
const MAX_DEPTH = 12;

interface StampedEndpoint {
  readonly paragraph: unknown;
  readonly offset: number;
  readonly readAt?: unknown;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isEndpoint(
  value: Record<string, unknown>
): value is Record<string, unknown> & StampedEndpoint {
  return 'paragraph' in value && typeof value.offset === 'number';
}

/** One text a key held, from the first to the last revision it was read at. */
interface TextRecord {
  readonly from: number;
  to: number;
  readonly text: string;
}

/**
 * The text each key (a paragraph, or the paragraphs between a span's endpoints) held at the
 * revisions it was read at.
 *
 * A key gets a new record only when its text changes. A read at a later revision with the same
 * text extends the current record. Superseded records leave in the order they were superseded,
 * once their total length exceeds `budget`. Current records leave, the key read least recently
 * first, once their total length exceeds `currentBudget`.
 */
export function createReadTexts(
  budget = STALE_SPAN_TEXT_BUDGET,
  currentBudget = STALE_SPAN_CURRENT_TEXT_BUDGET
) {
  // Map order is read order: a key moves to the end each time it is recorded.
  const byKey = new Map<string, TextRecord[]>();
  const superseded: { readonly key: string; readonly record: TextRecord }[] = [];
  let supersededLength = 0;
  let currentLength = 0;
  const currentCost = (key: string, record: TextRecord) => key.length + record.text.length;
  return {
    record(revision: number, key: string, read: string): void {
      const records = byKey.get(key);
      const current = records?.at(-1);
      if (records) {
        byKey.delete(key);
        byKey.set(key, records);
      }
      if (current && current.text === read) {
        if (revision > current.to) current.to = revision;
        return;
      }
      const record: TextRecord = { from: revision, to: revision, text: read };
      currentLength += currentCost(key, record);
      if (!records || !current) {
        byKey.set(key, [record]);
      } else {
        records.push(record);
        currentLength -= currentCost(key, current);
        superseded.push({ key, record: current });
        supersededLength += current.text.length;
        while (supersededLength > budget && superseded.length > 0) {
          const oldest = superseded.shift()!;
          supersededLength -= oldest.record.text.length;
          const list = byKey.get(oldest.key);
          // Records of one key are superseded, and so leave, oldest first.
          if (list?.[0] === oldest.record) list.shift();
        }
      }
      // The key just recorded is the most recent, so it is the last to leave.
      while (currentLength > currentBudget && byKey.size > 1) {
        const [oldestKey, list] = byKey.entries().next().value!;
        byKey.delete(oldestKey);
        const last = list.at(-1);
        if (last) currentLength -= currentCost(oldestKey, last);
        // Its superseded records stay counted until they leave in order; `list` is gone, so
        // they are no longer reachable.
      }
    },
    clear(): void {
      byKey.clear();
      superseded.length = 0;
      supersededLength = 0;
      currentLength = 0;
    },
    /** How many keys hold records. */
    size(): number {
      return byKey.size;
    },
    /** The text `key` held at `revision`, or undefined when no kept record covers it. */
    at(revision: number, key: string): string | undefined {
      const records = byKey.get(key);
      if (!records) return undefined;
      for (let index = records.length - 1; index >= 0; index -= 1) {
        const record = records[index]!;
        if (record.from <= revision) return revision <= record.to ? record.text : undefined;
      }
      return undefined;
    },
  };
}

export type ReadTexts = ReturnType<typeof createReadTexts>;

function paragraphOf(
  endpoint: StampedEndpoint,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
) {
  const point = resolveParagraphHandle(
    endpoint.paragraph as Parameters<typeof resolveParagraphHandle>[0],
    handles,
    reads
  );
  if (!point.ok) return null;
  const story = reads.story(point.value.story);
  const text = story?.rawText(point.value.paragraphId);
  return text === null || text === undefined || !story
    ? null
    : { id: point.value.paragraphId, text, story };
}

/** The key under which the paragraph after an endpoint's paragraph is recorded. */
const nextKey = (paragraphId: string): string => `next\u0000${paragraphId}`;

/** The key under which the paragraphs between two endpoints' paragraphs are recorded. */
const betweenKey = (startId: string, endId: string): string =>
  `between\u0000${startId}\u0000${endId}`;

/**
 * The paragraphs strictly between a span's start and end paragraphs, or null when the two are
 * the same paragraph, sit in different stories, or come in the wrong order.
 */
function paragraphsBetween(
  start: StampedEndpoint,
  end: StampedEndpoint,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
) {
  const first = paragraphOf(start, handles, reads);
  const last = paragraphOf(end, handles, reads);
  if (!first || !last || first.id === last.id || first.story !== last.story) return null;
  const from = first.story.indexOf(first.id);
  const to = first.story.indexOf(last.id);
  if (from < 0 || to <= from) return null;
  const ids = first.story.paragraphIds.slice(from + 1, to);
  return {
    key: betweenKey(first.id, last.id),
    ids,
    texts: ids.map((id) => first.story.rawText(id) ?? ''),
  };
}

/**
 * The answer with every endpoint stamped `readAt: revision`, its paragraph text recorded.
 *
 * `reads` must be the package the answer describes. Only plain objects and arrays are rebuilt,
 * and only along paths that hold an endpoint, so byte arrays and opaque handles pass through.
 */
export function stampEndpoints<T>(
  value: T,
  revision: number,
  texts: ReadTexts,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads,
  depth = 0
): T {
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((item) => {
      const next = stampEndpoints(item, revision, texts, handles, reads, depth + 1);
      if (next !== item) changed = true;
      return next;
    });
    return (changed ? Object.freeze(mapped) : value) as T;
  }
  if (!isPlain(value)) return value;
  // A span across paragraphs also records the paragraphs between its endpoints.
  const { start, end } = value;
  if (isPlain(start) && isEndpoint(start) && isPlain(end) && isEndpoint(end)) {
    const between = paragraphsBetween(start, end, handles, reads);
    if (between) {
      texts.record(revision, between.key, between.ids.join('\u0000'));
      between.ids.forEach((id, index) => texts.record(revision, id, between.texts[index]!));
    }
  }
  if (isEndpoint(value)) {
    const paragraph = paragraphOf(value, handles, reads);
    // An endpoint the host cannot place is not stamped: there is nothing to check it against.
    if (!paragraph) return value;
    texts.record(revision, paragraph.id, paragraph.text);
    // The paragraph after it, so two endpoints read in different answers can still be told
    // to be neighbours with nothing between them.
    const index = paragraph.story.indexOf(paragraph.id);
    texts.record(revision, nextKey(paragraph.id), paragraph.story.paragraphIds[index + 1] ?? '');
    return Object.freeze({ ...value, readAt: revision }) as T;
  }
  let copy: Record<string, unknown> | null = null;
  for (const [key, child] of Object.entries(value)) {
    const next = stampEndpoints(child, revision, texts, handles, reads, depth + 1);
    if (next === child) continue;
    copy ??= { ...value };
    copy[key] = next;
  }
  return (copy ? Object.freeze(copy) : value) as T;
}

interface CheckedEndpoint {
  readonly endpoint: StampedEndpoint;
  /** For a span's start: the span's end, whose paragraph may differ. */
  readonly end?: StampedEndpoint;
}

function endpointsOf(value: unknown, into: CheckedEndpoint[], depth = 0): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) endpointsOf(item, into, depth + 1);
    return;
  }
  if (!isPlain(value)) return;
  if (isEndpoint(value)) {
    if (value.readAt !== undefined) into.push({ endpoint: value });
    return;
  }
  const { start, end } = value;
  if (isPlain(start) && isEndpoint(start) && isPlain(end) && isEndpoint(end)) {
    if (start.readAt !== undefined) into.push({ endpoint: start, end });
    if (end.readAt !== undefined) into.push({ endpoint: end });
    for (const [key, child] of Object.entries(value))
      if (key !== 'start' && key !== 'end') endpointsOf(child, into, depth + 1);
    return;
  }
  for (const child of Object.values(value)) endpointsOf(child, into, depth + 1);
}

/**
 * Why this operation addresses text that moved since it was read, or null when it does not.
 *
 * An endpoint whose handle does not resolve is left to the planner, which reports it as the
 * invalid handle it is.
 */
export function staleEndpointDetail(
  operation: unknown,
  revision: number,
  texts: ReadTexts,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): string | null {
  const endpoints: CheckedEndpoint[] = [];
  endpointsOf(operation, endpoints);
  for (const { endpoint, end } of endpoints) {
    if (endpoint.readAt === revision) continue;
    if (typeof endpoint.readAt !== 'number' || !Number.isSafeInteger(endpoint.readAt))
      return 'invalid-read-revision';
    // A revision the host has not reached yet was never read.
    if (endpoint.readAt > revision)
      return `read-at ${String(endpoint.readAt)} was never read: the document is at revision ${String(revision)}`;
    const paragraph = paragraphOf(endpoint, handles, reads);
    if (!paragraph) continue;
    const before = texts.at(endpoint.readAt, paragraph.id);
    if (before === undefined) return `read-at ${String(endpoint.readAt)} is no longer checkable`;
    const now = paragraph.text;
    const k = endpoint.offset;
    // An offset that was never inside the paragraph is the planner's to refuse, as the bad
    // argument it is. One the paragraph shrank below is stale.
    if (!Number.isInteger(k) || k < 0 || k > before.length) continue;
    const spansOn = end !== undefined && paragraphOf(end, handles, reads)?.id !== paragraph.id;
    if (spansOn ? before !== now : now.length < k || before.slice(0, k) !== now.slice(0, k))
      return spansOn
        ? `the paragraph a span starts in changed since revision ${String(endpoint.readAt)}`
        : `text before offset ${String(k)} changed since revision ${String(endpoint.readAt)}`;
    if (spansOn) {
      const detail = betweenDetail(endpoint, end!, endpoint.readAt, texts, handles, reads);
      if (detail) return detail;
    }
  }
  return null;
}

/** Why the paragraphs between a span's endpoints changed since `readAt`, or null. */
function betweenDetail(
  start: StampedEndpoint,
  end: StampedEndpoint,
  readAt: number,
  texts: ReadTexts,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): string | null {
  const first = paragraphOf(start, handles, reads);
  const last = paragraphOf(end, handles, reads);
  if (!first || !last) return null;
  const now = paragraphsBetween(start, end, handles, reads);
  const key = betweenKey(first.id, last.id);
  // Endpoints read in different answers carry no record of what lies between them. They are
  // checkable only as neighbours that are still neighbours.
  const recorded =
    texts.at(readAt, key) ?? (texts.at(readAt, nextKey(first.id)) === last.id ? '' : undefined);
  if (recorded === undefined)
    return `the paragraphs a span covers are no longer checkable at revision ${String(readAt)}`;
  if (!now || now.ids.join('\u0000') !== recorded)
    return `a paragraph was inserted or removed inside a span since revision ${String(readAt)}`;
  for (const [index, id] of now.ids.entries()) {
    if (texts.at(readAt, id) !== now.texts[index])
      return `a paragraph inside a span changed since revision ${String(readAt)}`;
  }
  return null;
}
