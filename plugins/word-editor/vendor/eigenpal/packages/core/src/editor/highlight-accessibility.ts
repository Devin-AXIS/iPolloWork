// What a proofing highlight set means, for assistive technology.
//
// Marks are painted on an overlay, so a screen reader cannot tell that a word is misspelled.
// For a set with a `kind`, the painted text spans that a mark covers carry `aria-invalid`
// (`spelling` or `grammar`) and, for a range with a `description`, `aria-describedby` to an
// off-screen element the editor owns. Where the browser has the CSS Custom Highlight API, the
// covered text also joins a `spelling-error` or `grammar-error` highlight: the browser exposes
// that type to assistive technology and paints it with the core stylesheet's tokens. A polite
// live region says how many issues each kind has once the count settles.
//
// Painted spans are pictures of the tree: the page painter can replace them on any render. A
// paint whose marks, layout and pages are the last ones, and whose marked spans are all still in
// the page, changes nothing. Any other paint queries the spans of the marked paragraphs only,
// applies the attributes again, and removes them from spans no mark covers now.

import { createT, en } from '@docx-editor.dev/i18n';
import type { HighlightKind } from '../contracts/editor-highlights.ts';
import { createEditorAnnouncer } from './editor-announcer.ts';
import { hostTimers } from './host-realm.ts';

/** One mark of a `kind` set, at its current offsets. */
export interface AccessibleMark {
  readonly blockId: string;
  readonly start: number;
  readonly end: number;
  readonly description?: string;
}

/** The marks of one `kind` set that paint now. */
export interface AccessibleSet {
  readonly kind: HighlightKind;
  readonly marks: readonly AccessibleMark[];
}

/** Names of the shared CSS highlights. The core stylesheet styles `::highlight()` by them. */
export const PROOFING_HIGHLIGHT_NAMES: Readonly<Record<HighlightKind, string>> = Object.freeze({
  spelling: 'docx-spelling-error',
  grammar: 'docx-grammar-error',
});

/** How long the issue count must stay the same before the live region reads it. */
export const ISSUE_ANNOUNCE_DELAY_MS = 1500;

type Translate = (key: string, params?: Record<string, string | number>) => string;
const english = createT(en) as Translate;

/** The part of the CSS Custom Highlight API this module uses. */
interface NativeHighlight {
  type: string;
  add(range: Range): unknown;
  delete(range: Range): boolean;
  readonly size: number;
}
interface NativeRegistry {
  get(name: string): NativeHighlight | undefined;
  set(name: string, highlight: NativeHighlight): unknown;
  delete(name: string): boolean;
}

/** The shared highlight of `kind` in `document`, or null without the API. */
function nativeHighlight(document: Document, kind: HighlightKind): NativeHighlight | null {
  const view = document.defaultView as
    | (Window & {
        CSS?: { highlights?: NativeRegistry };
        Highlight?: new () => NativeHighlight;
      })
    | null;
  const registry = view?.CSS?.highlights;
  const Highlight = view?.Highlight;
  if (!registry || typeof registry.get !== 'function' || typeof Highlight !== 'function') {
    return null;
  }
  const name = PROOFING_HIGHLIGHT_NAMES[kind];
  let highlight = registry.get(name);
  if (!highlight) {
    highlight = new Highlight();
    highlight.type = kind === 'spelling' ? 'spelling-error' : 'grammar-error';
    registry.set(name, highlight);
  }
  return highlight;
}

/** A DOM range over `from`..`to` of a span's own text, or null when its text is not the model's. */
function spanRange(span: HTMLElement, start: number, from: number, to: number): Range | null {
  const document = span.ownerDocument;
  const walker = document.createTreeWalker(span, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Text[] = [];
  let length = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
    length += (node as Text).data.length;
  }
  // A span whose painted text differs from its model range has no exact position to mark.
  if (length !== Number(span.dataset.end) - start) return null;
  const range = document.createRange();
  let offset = start;
  let started = false;
  for (const node of nodes) {
    const end = offset + node.data.length;
    if (!started && from >= offset && from <= end) {
      range.setStart(node, from - offset);
      started = true;
    }
    if (started && to <= end) {
      range.setEnd(node, to - offset);
      return range;
    }
    offset = end;
  }
  return null;
}

/** A selector value for an attribute, quoted. Node ids come from the engine, never the file. */
function quoted(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, ' ')}"`;
}

/** The painted text spans of `ids` under `root`, by paragraph id, in one query. */
function spansOf(root: HTMLElement, ids: ReadonlySet<string>): Map<string, HTMLElement[]> {
  const spans = new Map<string, HTMLElement[]>();
  if (ids.size === 0) return spans;
  const selector = [...ids].map((id) => `[data-paragraph-id=${quoted(id)}][data-start]`).join(',');
  for (const span of root.querySelectorAll<HTMLElement>(selector)) {
    const id = span.dataset.paragraphId!;
    const list = spans.get(id) ?? [];
    list.push(span);
    spans.set(id, list);
  }
  return spans;
}

/** One string per set list, so an unchanged paint can be recognised. */
function setsKey(sets: readonly AccessibleSet[]): string {
  return JSON.stringify(
    sets.map((set) => [set.kind, set.marks.map((m) => [m.blockId, m.start, m.end, m.description])])
  );
}

/** Distinct id prefixes for editors that share a document. */
let editorCount = 0;

interface SpanState {
  invalid: HighlightKind;
  descriptions: string[];
}

/** The accessibility half of the highlight painter that one editor owns. */
export function createHighlightAccessibility(deps: {
  container(): HTMLElement | null;
  translate?(): Translate | null;
}) {
  /** Spans this module changed, with the `aria-describedby` they had before. */
  let marked = new Map<HTMLElement, string | null>();
  /** Ranges this editor added to each shared highlight. */
  let owned: { highlight: NativeHighlight; range: Range }[] = [];
  let descriptionHost: HTMLElement | null = null;
  let descriptionCount = 0;
  const descriptions = new Map<string, HTMLElement>();
  /** Description texts the last application used; the rest leave the off-screen element. */
  let used = new Set<string>();
  editorCount += 1;
  const prefix = `docx-highlight-description-${editorCount}`;
  const announcer = createEditorAnnouncer(deps.container);
  const timers = hostTimers(deps.container);
  let announced = new Map<HighlightKind, number>();
  let pending = new Map<HighlightKind, number>();
  let announceTimer: number | undefined;
  /** What the last application used: its root, marks, and the frame it painted in. */
  let last: { root: HTMLElement | null; key: string; frame: readonly unknown[] } | null = null;

  /** The off-screen element that holds `text`, created on first use. */
  function descriptionId(document: Document, text: string): string | null {
    const container = deps.container();
    if (!container) return null;
    if (!descriptionHost || descriptionHost.parentElement !== container) {
      descriptionHost?.remove();
      descriptions.clear();
      descriptionHost = document.createElement('div');
      descriptionHost.className = 'docx-editor-sr-only';
      descriptionHost.setAttribute('data-docx-marker', '');
      descriptionHost.contentEditable = 'false';
      container.append(descriptionHost);
    }
    used.add(text);
    let element = descriptions.get(text);
    if (!element) {
      element = document.createElement('span');
      element.id = `${prefix}-${(descriptionCount += 1)}`;
      element.textContent = text;
      descriptionHost.append(element);
      descriptions.set(text, element);
    }
    return element.id;
  }

  function release(): void {
    for (const { highlight, range } of owned) highlight.delete(range);
    owned = [];
    for (const [span, before] of marked) {
      span.removeAttribute('aria-invalid');
      if (before === null) span.removeAttribute('aria-describedby');
      else span.setAttribute('aria-describedby', before);
    }
    marked = new Map();
  }

  function announce(): void {
    announceTimer = undefined;
    const translate = deps.translate?.() ?? english;
    const parts: string[] = [];
    for (const kind of ['spelling', 'grammar'] as const) {
      const count = pending.get(kind);
      if (count === undefined || announced.get(kind) === count) continue;
      announced.set(kind, count);
      parts.push(
        translate(kind === 'spelling' ? 'editor.spellingIssueCount' : 'editor.grammarIssueCount', {
          count,
        })
      );
    }
    if (parts.length > 0) announcer.announce(parts.join(' '));
  }

  return {
    /**
     * Apply the sets' meaning to the painted text under `root`, replacing the last one.
     * `frame` names what the painted spans depend on (the layout and the painted pages); with
     * the same root, marks and frame, and every marked span still in the page, nothing runs.
     */
    apply(
      root: HTMLElement | null,
      sets: readonly AccessibleSet[],
      frame: readonly unknown[] = []
    ): void {
      if (sets.length === 0 && marked.size === 0 && owned.length === 0) return;
      const key = setsKey(sets);
      if (
        last !== null &&
        last.root === root &&
        last.key === key &&
        last.frame.length === frame.length &&
        last.frame.every((item, at) => item === frame[at]) &&
        [...marked.keys()].every((span) => span.isConnected)
      ) {
        return;
      }
      last = { root, key, frame };
      const previous = marked;
      used = new Set();
      for (const { highlight, range } of owned) highlight.delete(range);
      owned = [];
      marked = new Map();
      const states = new Map<HTMLElement, SpanState>();
      if (root && sets.length > 0) {
        const spans = spansOf(
          root,
          new Set(sets.flatMap((set) => set.marks.map((mark) => mark.blockId)))
        );
        for (const set of sets) {
          const highlight = nativeHighlight(root.ownerDocument, set.kind);
          for (const mark of set.marks) {
            for (const span of spans.get(mark.blockId) ?? []) {
              const start = Number(span.dataset.start);
              const end = Number(span.dataset.end);
              if (!(start < mark.end && mark.start < end)) continue;
              const state = states.get(span) ?? { invalid: set.kind, descriptions: [] };
              // One value per span: spelling outranks grammar, as the narrower claim.
              if (set.kind === 'spelling') state.invalid = 'spelling';
              if (mark.description && !state.descriptions.includes(mark.description)) {
                state.descriptions.push(mark.description);
              }
              states.set(span, state);
              const range = highlight
                ? spanRange(span, start, Math.max(start, mark.start), Math.min(end, mark.end))
                : null;
              if (highlight && range) {
                highlight.add(range);
                owned.push({ highlight, range });
              }
            }
          }
        }
      }
      for (const [span, state] of states) {
        const before = previous.has(span)
          ? previous.get(span)!
          : span.getAttribute('aria-describedby');
        marked.set(span, before);
        span.setAttribute('aria-invalid', state.invalid);
        const ids = state.descriptions
          .map((text) => descriptionId(span.ownerDocument, text))
          .filter((id): id is string => id !== null);
        const all = [...(before ? [before] : []), ...ids].join(' ');
        if (all) span.setAttribute('aria-describedby', all);
        else span.removeAttribute('aria-describedby');
      }
      for (const [span, before] of previous) {
        if (marked.has(span)) continue;
        span.removeAttribute('aria-invalid');
        if (before === null) span.removeAttribute('aria-describedby');
        else span.setAttribute('aria-describedby', before);
      }
      for (const [text, element] of descriptions) {
        if (used.has(text)) continue;
        descriptions.delete(text);
        element.remove();
      }
    },
    /**
     * Note each kind's issue count. The live region reads a count once it has not changed for
     * {@link ISSUE_ANNOUNCE_DELAY_MS}, so typing never queues a message per keystroke. A kind
     * without a set is forgotten without a message.
     */
    noteCounts(counts: ReadonlyMap<HighlightKind, number>): void {
      for (const kind of [...announced.keys()]) if (!counts.has(kind)) announced.delete(kind);
      const changed = [...counts].some(([kind, count]) => announced.get(kind) !== count);
      const waiting =
        announceTimer !== undefined &&
        pending.size === counts.size &&
        [...counts].every(([kind, count]) => pending.get(kind) === count);
      pending = new Map(counts);
      // A repaint with the counts already waiting keeps their timer: it is the same count.
      if (changed && waiting) return;
      timers.clearTimeout(announceTimer);
      announceTimer = changed ? timers.setTimeout(announce, ISSUE_ANNOUNCE_DELAY_MS) : undefined;
    },
    /** Remove everything this module added. */
    dispose(): void {
      release();
      last = null;
      timers.clearTimeout(announceTimer);
      announceTimer = undefined;
      announced = new Map();
      pending = new Map();
      announcer.dispose();
      descriptionHost?.remove();
      descriptionHost = null;
      descriptions.clear();
    },
  };
}
