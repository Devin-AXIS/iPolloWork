// The pane bus: the chrome asks the host to show a pane (Insert > Chart, Edit chart, Format
// shape), and the host's side panel, its packaged panes, and its own listeners hear the request.
//
// Each listener says which panes it shows. A request reaches only the listeners of its pane,
// and a pane is available only while one of them listens, so a host that shows only the Chart
// pane never gets an enabled Format shape that does nothing. A request that no listener takes
// is dropped at once; one that a listener hears waits a short time for the pane it mounts.

import type { Editor } from '@docx-editor.dev/core/contracts/editor';

/**
 * A pane that the chrome can ask the host to show: the Chart pane, or the Format shape pane.
 * More panes can join this union in a minor release, so a `switch` over it needs a default
 * branch. @public
 */
export type EditorPaneId = 'chart' | 'shape';

/** How a pane opens. @public */
export interface PaneRequestOptions {
  /** Whether the keyboard focus moves into the pane. Default true. */
  readonly focus?: boolean;
}

/** A pane request, as a listener receives it. @public */
export interface PaneRequest {
  readonly pane: EditorPaneId;
  readonly focus: boolean;
}

/** Which panes a listener shows. @public */
export interface PaneRequestListenerOptions {
  /**
   * The panes this listener shows. Default `['chart']`, the one pane that existed before the
   * list did, so a listener written for the Chart pane does not claim the Format shape pane.
   */
  readonly panes?: readonly EditorPaneId[];
}

interface Listener {
  readonly panes: ReadonlySet<EditorPaneId>;
  readonly call: (request: PaneRequest) => void;
}

/** How long a heard request waits for the pane that the host mounts for it, in ms. */
const PENDING_MS = 1000;

const listeners = new WeakMap<Editor, Set<Listener>>();
const pending = new WeakMap<Editor, { readonly request: PaneRequest; readonly at: number }>();

const now = (): number => globalThis.performance?.now?.() ?? Date.now();

/**
 * Ask the host to show `pane`. Only the listeners that show `pane` hear it. Returns whether one
 * did; when none did, the request is dropped. @public
 */
export function requestPane(
  editor: Editor,
  pane: EditorPaneId,
  options?: PaneRequestOptions
): boolean {
  const request: PaneRequest = { pane, focus: options?.focus ?? true };
  const takers = [...(listeners.get(editor) ?? [])].filter((entry) => entry.panes.has(pane));
  if (takers.length === 0) {
    pending.delete(editor);
    return false;
  }
  // Kept a short time, so a pane that the host mounts for the request still gets it.
  pending.set(editor, { request, at: now() });
  for (const listener of takers) listener.call(request);
  return true;
}

/** The pending request while it is fresh, else null (and a stale one is dropped). */
function fresh(editor: Editor): PaneRequest | null {
  const entry = pending.get(editor);
  if (!entry) return null;
  if (now() - entry.at > PENDING_MS) {
    pending.delete(editor);
    return null;
  }
  return entry.request;
}

/**
 * Take the last pane request that no pane has taken yet, or null. A side panel takes it when
 * it mounts and when it hears a request, to know whether to move the focus into itself.
 * @public
 */
export function takePaneRequest(editor: Editor): PaneRequest | null {
  const request = fresh(editor);
  pending.delete(editor);
  return request;
}

/**
 * Take the last pane request when it asks for `pane`, or null and leave it for another pane. A
 * packaged pane takes only its own requests, so a side panel that swaps one pane for another
 * hands the request to the pane that the selection shows. @public
 */
export function takePaneRequestFor(editor: Editor, pane: EditorPaneId): PaneRequest | null {
  return fresh(editor)?.pane === pane ? takePaneRequest(editor) : null;
}

/**
 * Listen for the pane requests of one editor, for the panes in `options.panes` (default the
 * Chart pane). Returns the function that stops listening. @public
 */
export function listenPaneRequests(
  editor: Editor,
  listener: (request: PaneRequest) => void,
  options?: PaneRequestListenerOptions
): () => void {
  let set = listeners.get(editor);
  if (!set) listeners.set(editor, (set = new Set()));
  const entry: Listener = { panes: new Set(options?.panes ?? ['chart']), call: listener };
  set.add(entry);
  return () => set.delete(entry);
}

/** Whether a listener shows `pane`: a side panel, the packaged pane, or a host listener. @public */
export function paneAvailable(editor: Editor | null, pane: EditorPaneId): boolean {
  if (!editor) return false;
  for (const entry of listeners.get(editor) ?? []) if (entry.panes.has(pane)) return true;
  return false;
}
