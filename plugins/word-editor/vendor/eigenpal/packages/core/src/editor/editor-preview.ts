// A preview: other wording painted over the document, before anyone writes it.
//
// A FORK, NOT A TRANSACTION. The preview's writes go to a scratch package store opened over the
// live session's current package (an immutable snapshot, so the fork costs one store and no
// copy). Nothing reaches the live session: no op, no history entry, no collaboration journal.
// A preview written as real edits and undone on cancel would reach every peer and the undo
// stack; a layout projection with invented text would break every lane keyed on tree offsets
// (selection, caret, review anchors, highlights). The fork has neither problem: it is a
// complete document of its own, painted by a complete surface of its own.
//
// Two phases. BEGIN forks and hands out an automation host over the fork; the live editor stays
// fully editable while the caller builds the preview, so a callback that waits on a model does
// not freeze anyone. SHOW paints the fork over the live pages (see `editor-preview-display.ts`)
// and raises the write guard: from then on the keymap, `exec` writes, undo and redo, and
// automation all refuse with `PREVIEW_WRITE_REFUSAL`, while remote edits keep landing in the
// live session. Any move of the live revision after BEGIN, local or remote, is the caller's to
// see: it marks the preview stale.
//
// Committing is not this module's job. The editor-api runtime replays the preview's recorded
// batches against the live host as one history group. This module only forks, paints and ends.

import type { AutomationCapabilities, AutomationHost } from '../automation/protocol.ts';
import { createAutomationHost } from '../automation/host.ts';
import { en } from '@docx-editor.dev/i18n';
import { openTreeSessionFromPackage } from '../binding/tree-session.ts';
import { TreePackageStore } from '../store/store/tree-package-store.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';
import {
  firstChangedParagraph,
  showPreviewOver,
  type PreviewDisplay,
} from './editor-preview-display.ts';
import { previewForkPort } from './editor-preview-port.ts';
import type { PaginatedSurfaceOptions, ScaleMutableSurface } from './paginated-surface-contract.ts';
import { mountPaginatedSurface } from './paginated-surface.ts';
import {
  refreshCompositionActive,
  refreshWriteBlocked,
  setPreviewWriteGuard,
} from './refresh-write-guard.ts';
import type { PaginatedSurfaceRuntimeOptions } from './surface-runtime-options.ts';

export { PREVIEW_WRITE_REFUSAL } from './refresh-write-guard.ts';

/**
 * Why a preview could not begin.
 *
 * - `no-document`: the editor is detached, still opening, or holds no document.
 * - `viewing`: the editor is open for viewing, so a commit could never write.
 * - `blocked`: an external refresh is replacing the document.
 * - `composing`: an input method composition is in progress in the editor.
 * - `preview-active`: another preview is already open on this editor.
 *
 * @internal
 */
export type EditorPreviewRefusal =
  'no-document' | 'viewing' | 'blocked' | 'composing' | 'preview-active';

/**
 * One open preview over a live editor.
 *
 * @internal
 */
export interface EditorPreviewFork {
  /** Defer host event listeners until a synchronous commit finishes. */
  deferEvents<T>(run: () => T): T;
  /** An automation host over the fork. Its writes never reach the live editor. */
  readonly host: AutomationHost;
  /**
   * Paint the fork over the live pages and refuse live writes from now on. False when it
   * cannot mount; nothing changes then.
   */
  show(): boolean;
  /** Whether the fork is painted now. */
  readonly shown: boolean;
  /** Bring the first body paragraph the fork changed into view. False when there is none. */
  reveal(): boolean;
  /** Whether the preview has ended. Final. */
  readonly ended: boolean;
  /** Restore the live pages and lift the write guard. Idempotent. */
  end(): void;
  /** Told once when the preview ends, by `end()` or because the editor remounted. */
  onEnd(listener: () => void): () => void;
}

/** What the facade lends a preview. */
interface PreviewHost {
  readonly deferEvents: <T>(run: () => T) => T;
  /** The options the facade's own mount paints with. */
  readonly displayOptions: () => PaginatedSurfaceRuntimeOptions;
  /** Publish a state change: the write guard moves `snapshot().editable`. */
  readonly changed: () => void;
}

interface PreviewRecord extends PreviewHost {
  active: EditorPreviewFork | null;
}

const records = new WeakMap<object, PreviewRecord>();

/** Called once by the editor factory. @internal */
export function registerEditorPreviewHost(editor: object, host: PreviewHost): void {
  records.set(editor, { ...host, active: null });
}

/** End the preview on `editor`, if any: the facade replaces, parks, or destroys its surface. @internal */
export function endEditorPreview(editor: object): void {
  records.get(editor)?.active?.end();
}

/** Whether a preview is painted over `editor`, so its writes are refused. @internal */
export function editorPreviewActive(editor: object): boolean {
  const active = records.get(editor)?.active;
  return !!active && !active.ended && active.shown;
}

/**
 * What a preview host can do. It paints nothing itself and has no reader to move, so it claims
 * neither; it raises no events, because nothing but the preview writes to it.
 */
const PREVIEW_CAPABILITIES: AutomationCapabilities = Object.freeze({
  document: true,
  save: false,
  events: false,
  selection: false,
  scrolling: false,
  layout: false,
});

const NO_BYTES = new Uint8Array(0);

/**
 * Open a preview over `editor`'s current document.
 *
 * Flushes buffered typing first, so the fork starts from the revision the caller compares
 * against at commit. Writes nothing and refuses nothing on the live editor until `show()`.
 *
 * @internal
 */
export function beginEditorPreview(
  editor: DocxEditorInstance
):
  | { readonly ok: true; readonly fork: EditorPreviewFork }
  | { readonly ok: false; readonly reason: EditorPreviewRefusal } {
  const record = records.get(editor);
  const surface = editor.surface;
  if (!record || !surface || surface.parked()) return { ok: false, reason: 'no-document' };
  if (record.active && !record.active.ended) return { ok: false, reason: 'preview-active' };
  const container = surface.hostElement();
  if (refreshWriteBlocked(container)) return { ok: false, reason: 'blocked' };
  if (surface.editingMode() === 'view') return { ok: false, reason: 'viewing' };
  // Composed text is not in the document until the composition ends, so a fork taken now would
  // miss it and the guard raised over it would strand it.
  if (refreshCompositionActive(surface)) return { ok: false, reason: 'composing' };
  surface.flushPendingInput();
  const live = surface.session.currentPackage();
  const main = live.parts.get(live.mainDocumentPart);
  if (!main) return { ok: false, reason: 'no-document' };

  const initial = record.displayOptions();
  const store = new TreePackageStore(
    live,
    main,
    initial.contentLockPolicy ? { contentLockPolicy: initial.contentLockPolicy } : {}
  );
  const host = createAutomationHost({
    port: previewForkPort(store, surface, record.displayOptions),
    capabilities: PREVIEW_CAPABILITIES,
  });

  const generation = editor.mountGeneration;
  const listeners = new Set<() => void>();
  let display: PreviewDisplay | null = null;
  let ended = false;

  // A remount, a detach or a move to another element replaces what the preview covers: it ends
  // rather than paint over a document it was not forked from.
  const unsubscribe = editor.on('change', () => {
    if (ended) return;
    if (editor.surface !== surface || editor.mountGeneration !== generation) {
      fork.end();
      return;
    }
    if (!display) return;
    // Zoom and paragraph marks are the reader's view, not the document: the preview follows.
    const { scale, showParagraphMarks } = record.displayOptions();
    if (scale !== undefined && (display.surface as ScaleMutableSurface).setScale(scale)) {
      display.place();
    }
    display.surface.setShowParagraphMarks(showParagraphMarks ?? false);
  });

  const fork: EditorPreviewFork = {
    deferEvents: record.deferEvents,
    host,
    get shown() {
      return display !== null;
    },
    get ended() {
      return ended;
    },
    show() {
      if (ended || display) return false;
      const paint = record.displayOptions();
      const opened = openTreeSessionFromPackage(
        { ok: true, package: store.currentPackage() },
        {
          ...(paint.reviewModel ? { reviewModel: paint.reviewModel } : {}),
          ...(paint.contentLockPolicy ? { contentLockPolicy: paint.contentLockPolicy } : {}),
        }
      );
      if (!opened.ok) return false;
      const label = paint.translate?.('editor.previewContent') ?? en.editor.previewContent;
      display = showPreviewOver(container, label, (holder) => {
        // View-only and without a collaboration model: the fork joins no room and takes no edit.
        const options: PaginatedSurfaceRuntimeOptions = {
          ...paint,
          editingMode: 'view',
          revisionDisplayMode: surface.revisionDisplayMode(),
          openedSession: opened,
          // Laid out in slices after the first screen, so a long document shows at once.
          progressiveOpen: true,
        };
        const mounted = mountPaginatedSurface(holder, NO_BYTES, options as PaginatedSurfaceOptions);
        if (!mounted.ok) return null;
        mounted.surface.setEditable(false);
        return mounted.surface;
      });
      if (!display) return false;
      setPreviewWriteGuard(container, true);
      record.changed();
      return true;
    },
    reveal() {
      if (!display) return false;
      const paragraphId = firstChangedParagraph(live, store.currentPackage());
      if (paragraphId === null) return false;
      display.finishOpening();
      // Already in view scrolls nothing, and is still a reveal.
      display.surface.revealPosition({ paragraphId, offset: 0 });
      return true;
    },
    end() {
      if (ended) return;
      ended = true;
      unsubscribe();
      const shown = display !== null;
      display?.remove();
      display = null;
      if (shown) setPreviewWriteGuard(container, false);
      if (record.active === fork) record.active = null;
      if (shown) record.changed();
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          /* a listener must not keep the preview open */
        }
      }
      listeners.clear();
    },
    onEnd(listener) {
      if (ended) {
        listener();
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  record.active = fork;
  return { ok: true, fork };
}
