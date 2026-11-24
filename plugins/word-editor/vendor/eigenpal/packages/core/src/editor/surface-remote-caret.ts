/**
 * Keeps the local selection where the user put it while other people edit.
 *
 * A remote commit changes text the local caret is addressed into by offset. Without this,
 * text a peer inserted before the caret left the caret at its old offset, so the next
 * keystroke landed inside the peer's words, and a peer's deletion could leave the offset
 * past the end, where every keystroke was refused. Yjs editors solve this with relative
 * positions; this engine addresses text by paragraph id and offset, so it carries the
 * selection across the before and after text of the paragraphs it touches, which gives
 * the same answer for every change a peer can make to that text.
 *
 * The before text comes from the layout that is still on screen when the remote commit
 * arrives, and the mapping runs when the next layout is published, so a burst of remote
 * commits costs one mapping and no extra layout pass.
 */
import type { SemanticPosition, SemanticSelection } from '@docx-editor.dev/core/layout';
import type {
  CollaborationEditorPosition,
  CollaborationEditorSelection,
  CollaborationLocalSelection,
  EditorCollaborationSession,
} from '../collaboration/index.ts';
import { mapOffsetAcrossText } from '../collaboration/offset-mapping.ts';

/**
 * A selection carried across a change to ONE paragraph's text: each endpoint stays next to
 * the same character, also when one remote update changed text on both sides of it, as a
 * reconnect that brings several peers' edits at once does.
 */
export function mapSelectionAcrossText(
  current: SemanticSelection,
  paragraphId: string,
  beforeText: string,
  afterText: string
): SemanticSelection {
  if (afterText === beforeText) return current;
  const move = (position: SemanticPosition): SemanticPosition =>
    position.paragraphId === paragraphId
      ? { ...position, offset: mapOffsetAcrossText(position.offset, beforeText, afterText) }
      : position;
  return { anchor: move(current.anchor), head: move(current.head) };
}

export interface RemoteCaretDeps {
  /** Text of a paragraph in the layout on screen, or null when that layout lacks it. */
  readonly textOf: (paragraphId: string) => string | null;
  /** Paragraph ids of the active story, in order, in the layout on screen. */
  readonly order: () => readonly string[];
  /**
   * Where the collaboration session carried the selection across the last remote change, on
   * the shared characters beside it, and the selection it carried. Null when it could not.
   */
  readonly carried?: () => {
    readonly from: SemanticSelection;
    readonly to: SemanticSelection;
  } | null;
}

interface EndpointContext {
  readonly before: string;
  readonly after: string;
}

interface Capture {
  /** The selection the commit arrived over; a caret moved since is the user's, not mapped. */
  readonly selection: SemanticSelection;
  readonly before: ReadonlyMap<string, string>;
  readonly order: readonly string[];
  /** The text on each side of each endpoint when the commit arrived. */
  readonly context: { readonly anchor: EndpointContext; readonly head: EndpointContext };
  /** Paragraphs an undo or redo rewrote, with their text before; the first that changed wins. */
  readonly history: readonly { readonly id: string; readonly text: string }[];
}

/** The lengths of text before an endpoint tried to find its place, longest first. */
const CONTEXT_LENGTHS = [24, 16, 12, 8, 6, 4];
/** How much of the text after an endpoint confirms the mapping kept its place. */
const FOLLOWING_LENGTH = 8;

/**
 * Put an endpoint back after the text it followed, when the mapping moved it away from that
 * text. One commit can split or join the caret's paragraph and also change text around it, as
 * a reconnect that brings several edits at once does; the split and join checks then miss, and
 * the caret landed at a paragraph start. The text is looked for in the paragraphs the caret
 * could have gone to: the longest end of it that occurs exactly once places the endpoint, and
 * one that occurs more than once leaves the mapping as it is. A mapping that still has the
 * text that followed the endpoint after it is kept: a peer deleted what came before.
 */
function reanchored(
  mapped: SemanticPosition,
  original: SemanticPosition,
  context: EndpointContext,
  deps: RemoteCaretDeps,
  order: readonly string[]
): SemanticPosition {
  const here = deps.textOf(mapped.paragraphId) ?? '';
  const following = context.after.slice(0, FOLLOWING_LENGTH);
  if (following && here.slice(mapped.offset, mapped.offset + following.length) === following) {
    return mapped;
  }
  const candidates = new Set<string>();
  for (const id of [mapped.paragraphId, original.paragraphId]) {
    const at = order.indexOf(id);
    if (at < 0) continue;
    for (const index of [at, at - 1, at + 1]) if (order[index]) candidates.add(order[index]!);
  }
  for (const length of CONTEXT_LENGTHS) {
    if (context.before.length < length) continue;
    const end = context.before.slice(-length);
    if (here.slice(Math.max(0, mapped.offset - length), mapped.offset) === end) return mapped;
    let found: SemanticPosition | null = null;
    for (const id of candidates) {
      const text = deps.textOf(id) ?? '';
      for (let at = text.indexOf(end); at >= 0; at = text.indexOf(end, at + 1)) {
        if (found) return mapped;
        found = { ...mapped, paragraphId: id, offset: at + end.length };
      }
    }
    if (found) return found;
  }
  return mapped;
}

/** A remote commit landed over a layout that does not show the revision before it. */
const STALE = 'stale';
/** An undo of a large region names many paragraphs; the caret needs only the first change. */
const MAX_HISTORY_CANDIDATES = 16;

export interface RemoteCaret {
  /**
   * The next shared commit is this user's own undo or redo. Shared history arrives the way a
   * peer's edit does, so without this the caret stayed wherever the user had moved to.
   */
  expectHistory(expected: boolean): void;
  /**
   * A remote commit arrived; remember what the selection's paragraphs say before it.
   * `dirty` names the paragraphs the commit rewrote, when the commit narrowed them.
   * `layoutCurrent` says the layout on screen shows the revision just before the commit. When
   * it does not, a local commit is still waiting for layout and the selection is already past
   * it, so the screen's text is not the selection's baseline and nothing is mapped.
   */
  note(selection: SemanticSelection, dirty: readonly string[], layoutCurrent: boolean): void;
  /**
   * A local commit landed before the remote one reached layout. Its selection is already
   * past the local edit, so the screen's text no longer describes it; mapping would count
   * the user's own typing as the peer's.
   */
  noteLocal(): void;
  /**
   * The host set the selection itself. A remote commit noted before it carries the caret the
   * user had then, which the host's choice replaces: nothing is carried.
   */
  discard(): void;
  /** Whether a remote commit is waiting for the next layout to carry the selection. */
  pending(): boolean;
  /** The layout now shows the remote commit; carry the selection across it. */
  map(selection: SemanticSelection): SemanticSelection;
}

function sameSelection(left: SemanticSelection, right: SemanticSelection): boolean {
  return (
    left.anchor.paragraphId === right.anchor.paragraphId &&
    left.anchor.offset === right.anchor.offset &&
    left.head.paragraphId === right.head.paragraphId &&
    left.head.offset === right.head.offset
  );
}

export function createRemoteCaret(deps: RemoteCaretDeps): RemoteCaret {
  let capture: Capture | typeof STALE | null = null;
  let historyNext = false;
  const historyOf = (dirty: readonly string[]) => {
    const onScreen = new Set(deps.order());
    return dirty
      .filter((id) => onScreen.has(id))
      .slice(0, MAX_HISTORY_CANDIDATES)
      .map((id) => ({ id, text: deps.textOf(id) ?? '' }));
  };
  return {
    expectHistory(expected) {
      historyNext = expected;
    },
    note(selection, dirty, layoutCurrent) {
      const history = historyNext;
      historyNext = false;
      // The first remote commit since the last layout owns the baseline: later ones in the
      // same burst are still described by the screen's text, not by the commit before them.
      // An undo later in the burst still names where it changed.
      if (capture !== null) {
        if (history && capture !== STALE && capture.history.length === 0) {
          capture = { ...capture, history: historyOf(dirty) };
        }
        return;
      }
      if (!layoutCurrent) {
        capture = STALE;
        return;
      }
      const before = new Map<string, string>();
      for (const id of [selection.anchor.paragraphId, selection.head.paragraphId]) {
        const text = deps.textOf(id);
        if (text !== null) before.set(id, text);
      }
      const contextOf = (position: SemanticPosition): EndpointContext => {
        const text = before.get(position.paragraphId) ?? '';
        const reach = CONTEXT_LENGTHS[0]!;
        return {
          before: text.slice(Math.max(0, position.offset - reach), position.offset),
          after: text.slice(position.offset, position.offset + reach),
        };
      };
      capture = {
        selection,
        before,
        order: deps.order(),
        context: { anchor: contextOf(selection.anchor), head: contextOf(selection.head) },
        history: history ? historyOf(dirty) : [],
      };
    },
    noteLocal() {
      if (capture !== null) capture = STALE;
    },
    discard() {
      capture = null;
    },
    pending: () => capture !== null,
    map(selection) {
      const next = carry(selection);
      // The same selection when nothing moved: a caller treats a new one as a caret move.
      return sameSelection(next, selection) ? selection : next;
    },
  };
  function carry(selection: SemanticSelection): SemanticSelection {
    const taken = capture;
    capture = null;
    if (!taken) return selection;
    // The session carried the caret on the characters beside it: exact wherever text
    // moved, and with no guess among equal letters. It answers for the selection it saw,
    // and reads no screen text, so it answers too when the screen was behind the model.
    const carried = deps.carried?.() ?? null;
    const carriedTo = (seen: SemanticSelection): SemanticSelection | null =>
      carried &&
      sameSelection(carried.from, seen) &&
      sameSelection(selection, seen) &&
      // Any story's paragraph, as a text box's, which the active story's order leaves out.
      deps.textOf(carried.to.anchor.paragraphId) !== null &&
      deps.textOf(carried.to.head.paragraphId) !== null
        ? carried.to
        : null;
    if (taken === STALE) return carriedTo(selection) ?? selection;
    const after = deps.order();
    // Undo and redo put the caret where the text changed: after restored words, or where
    // removed words were.
    const onScreen = new Set(after);
    for (const { id, text } of taken.history) {
      if (!onScreen.has(id)) continue;
      const now = deps.textOf(id) ?? text;
      if (now === text) continue;
      let start = 0;
      while (start < text.length && start < now.length && text[start] === now[start]) {
        start += 1;
      }
      const site = { paragraphId: id, offset: start + Math.max(0, now.length - text.length) };
      return { anchor: site, head: site };
    }
    const present = new Set(after);
    const moved = carriedTo(taken.selection);
    if (moved) return moved;
    const known = new Set(taken.order);
    // A peer pressed Enter before the caret: the paragraph keeps the head of its text and a
    // new paragraph right after it starts with the rest. The caret goes with its characters.
    const followSplit = (position: SemanticPosition): SemanticPosition | null => {
      const beforeText = taken.before.get(position.paragraphId);
      const head = deps.textOf(position.paragraphId);
      if (beforeText === undefined || head === null || head.length >= beforeText.length) {
        return null;
      }
      if (!beforeText.startsWith(head) || position.offset <= head.length) return null;
      const next = after[after.indexOf(position.paragraphId) + 1];
      if (next === undefined || known.has(next)) return null;
      if (!(deps.textOf(next) ?? '').startsWith(beforeText.slice(head.length))) return null;
      return { paragraphId: next, offset: position.offset - head.length };
    };
    const anchorSplit = followSplit(selection.anchor);
    const headSplit = followSplit(selection.head);
    let mapped = selection;
    for (const [id, beforeText] of taken.before) {
      if (!present.has(id)) continue;
      mapped = mapSelectionAcrossText(mapped, id, beforeText, deps.textOf(id) ?? beforeText);
    }
    mapped = { anchor: anchorSplit ?? mapped.anchor, head: headSplit ?? mapped.head };
    const survive = (position: SemanticPosition): SemanticPosition => {
      if (present.has(position.paragraphId)) return position;
      const at = taken.order.indexOf(position.paragraphId);
      let previous: string | null = null;
      for (let index = at - 1; index >= 0 && previous === null; index -= 1) {
        if (present.has(taken.order[index]!)) previous = taken.order[index]!;
      }
      // A join: the paragraph's text now ends the one before it, so the caret follows it.
      const removedText = taken.before.get(position.paragraphId);
      const previousText = previous === null ? '' : (deps.textOf(previous) ?? '');
      if (previous !== null && removedText !== undefined && previousText.endsWith(removedText)) {
        const offset = previousText.length - removedText.length + position.offset;
        return { paragraphId: previous, offset };
      }
      // A removal: land where the paragraph was, at the start of the next surviving one,
      // or at the end of the previous one when it was the last.
      for (let index = at + 1; at >= 0 && index < taken.order.length; index += 1) {
        const id = taken.order[index]!;
        if (present.has(id)) return { paragraphId: id, offset: 0 };
      }
      return previous === null ? position : { paragraphId: previous, offset: previousText.length };
    };
    // The text around the caret names its place only when the paragraphs themselves changed:
    // a split or a join the checks above missed. An edit inside one paragraph is the
    // alignment's to place, and a caret the user moved meanwhile is the user's.
    const structural =
      after.length !== taken.order.length || after.some((id, at) => id !== taken.order[at]);
    if (!structural || !sameSelection(selection, taken.selection)) {
      return { anchor: survive(mapped.anchor), head: survive(mapped.head) };
    }
    return {
      anchor: reanchored(
        survive(mapped.anchor),
        selection.anchor,
        taken.context.anchor,
        deps,
        after
      ),
      head: reanchored(survive(mapped.head), selection.head, taken.context.head, deps, after),
    };
  }
}

/**
 * The selection an undo or redo step was made from, in this editor's paragraph ids, or null
 * when the session recorded none or a paragraph it names is gone.
 */
export function historySelectionOf(
  session: { historySelection?(): CollaborationLocalSelection | null } | null | undefined,
  port: StableParagraphs | null
): SemanticSelection | null {
  const recorded = session?.historySelection?.() ?? null;
  return recorded && port ? inEditorIds(recorded, port) : null;
}

/**
 * Where the session carried the selection across the last remote change, and the selection
 * it carried, in this editor's paragraph ids. Null when it carried none.
 */
export function carriedSelectionOf(
  session: Pick<EditorCollaborationSession, 'remoteSelectionMove'> | null | undefined
): { readonly from: SemanticSelection; readonly to: SemanticSelection } | null {
  const move = session?.remoteSelectionMove?.();
  if (!move) return null;
  const position = (at: CollaborationEditorPosition) => ({
    paragraphId: at.nodeId,
    offset: at.offset,
  });
  const selection = (of: CollaborationEditorSelection): SemanticSelection => ({
    anchor: position(of.anchor),
    head: position(of.head),
  });
  return { from: selection(move.from), to: selection(move.to) };
}

interface StableParagraphs {
  paragraphByStableId(id: string): { nodeId: string; text: string } | null;
}

/** A selection in stable paragraph ids, in this editor's ids, or null when a paragraph is gone. */
function inEditorIds(
  selection: CollaborationLocalSelection,
  port: StableParagraphs
): SemanticSelection | null {
  const resolve = (address: CollaborationLocalSelection['anchor']): SemanticPosition | null => {
    const paragraph = port.paragraphByStableId(address.paragraphId);
    if (!paragraph) return null;
    return {
      paragraphId: paragraph.nodeId,
      offset: Math.min(address.offset, paragraph.text.length),
    };
  };
  const anchor = resolve(selection.anchor);
  const head = resolve(selection.head);
  return anchor && head ? { anchor, head } : null;
}
