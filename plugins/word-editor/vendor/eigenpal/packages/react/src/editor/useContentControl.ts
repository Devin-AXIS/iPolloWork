// Content-control authoring chrome, UI-free.
//
// Prefers `surface.contentControls` (boundary record at the caret, show-all / form-fill,
// disabled reasons, remove / setValue) and falls back to `Editor.query` /
// `Editor.exec` when the surface is not mounted. Inspector open state is adapter-local
// — `runToolbarCommand('contentControl.inspector')` only validates that a control is
// at the caret; opening the panel is this hook's job.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ContentControlSummary, ContentControlType } from '@docx-editor.dev/core';
import type { CanResult, EditorSnapshot, ExecResult } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/**
 * OOXML content-control lock axis, mirrored from layout boundary records for the
 * React-only inspector surface — adapters must not import the layout package.
 *
 * @public
 */
export type ContentControlLock = 'unlocked' | 'sdtLocked' | 'contentLocked' | 'sdtContentLocked';

/** Chrome slots for the content-control group (design S14). @public */
export const CONTENT_CONTROL_SLOTS = {
  showAll: 'contentControl.showAll',
  formFill: 'contentControl.formFill',
  inspector: 'contentControl.inspector',
  remove: 'contentControl.remove',
} as const;

/** @public */
export type ContentControlSlotId =
  (typeof CONTENT_CONTROL_SLOTS)[keyof typeof CONTENT_CONTROL_SLOTS];

/**
 * Live inspector model for the control at the caret.
 *
 * `locked` is the content-edit axis. Removal lock is reported separately via
 * `removalLocked` from the boundary's effective lock / surface disabled reason.
 *
 * @public
 */
export interface ContentControlInspectorState {
  readonly id: string;
  readonly tag: string | null;
  readonly alias: string | null;
  readonly controlType: ContentControlType;
  /** Content-edit locked (`contentLocked` / `sdtContentLocked` union). */
  readonly locked: boolean;
  /** Wrapper removal refused (`sdtLocked` / `sdtContentLocked` union). */
  readonly removalLocked: boolean;
  readonly placeholder: boolean;
  readonly bound: boolean;
  readonly effectiveLock: ContentControlLock | null;
}

/** What `useContentControl` answers. @public */
export interface UseContentControlResult {
  /** The control at the caret, or null when the caret is outside every control. */
  readonly control: ContentControlInspectorState | null;
  /** Every control in reading order. */
  readonly controls: readonly ContentControlSummary[];
  /** Whether show-all boundary chrome is on. */
  readonly showAll: boolean;
  /** Whether form-fill Tab navigation is on. */
  readonly formFill: boolean;
  /** Whether the inspector panel is open. */
  readonly inspectorOpen: boolean;
  /** Document is editable and a control at the caret allows value edits. */
  readonly canSetValue: boolean;
  /** Document is editable, a control is at the caret, and removal is not locked. */
  readonly canRemove: boolean;
  /** Engine reason when set-value would be refused, else null. */
  readonly setValueDisabledReason: string | null;
  /** Engine reason when remove would be refused, else null. */
  readonly removeDisabledReason: string | null;
  readonly setShowAll: (show: boolean) => void;
  readonly toggleShowAll: () => void;
  readonly setFormFill: (on: boolean) => void;
  readonly toggleFormFill: () => void;
  readonly openInspector: () => void;
  readonly closeInspector: () => void;
  readonly toggleInspector: () => void;
  /** Unwrap the control at the caret, keeping content. */
  readonly remove: () => ExecResult;
  /** Set the control's value (string mapped by type inside the engine). */
  readonly setValue: (value: string) => ExecResult;
}

function removalLockedFrom(lock: ContentControlLock | null | undefined): boolean {
  return lock === 'sdtLocked' || lock === 'sdtContentLocked';
}

function contentLockedFrom(lock: ContentControlLock | null | undefined): boolean {
  return lock === 'contentLocked' || lock === 'sdtContentLocked';
}

function reasonFromCan(result: CanResult, code: 'locked' | 'bound' | 'notFound'): boolean {
  return !result.ok && result.code === code;
}

/**
 * Headless content-control chrome. Mount under `DocxEditor.Root`.
 *
 * Both the context-provided instance and a local fallback run every render (same order),
 * matching `useHyperlinkPopup`.
 *
 * @public
 */
export function useContentControl(): UseContentControlResult {
  const provided = useContext(ContentControlContext);
  // Hooks cannot be skipped, so the own state is built either way. Under a provider it does
  // not follow the editor, or every consumer would re-render on each keystroke.
  const own = useContentControlState(provided === null);
  return provided ?? own;
}

/**
 * Create the content-control chrome state. Used by `DocxEditor.Root` to publish one
 * shared instance; also usable in tests without the provider.
 *
 * @public
 */
export function useContentControlInstance(): UseContentControlResult {
  return useContentControlState(true);
}

const selectSnapshot = (snapshot: EditorSnapshot): EditorSnapshot | null => snapshot;
const selectNothing = (): EditorSnapshot | null => null;

/** The chrome state; while `active` is false it does not follow editor changes. */
function useContentControlState(active: boolean): UseContentControlResult {
  const editor = useDocxEditor();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // Show-all / form-fill live on the surface and often move without a document revision or
  // caret change, so the editor snapshot tick alone is not a reliable store signal. Keep
  // React-owned mirrors updated by the setters (and re-synced when a tick does arrive).
  const [showAll, setShowAllState] = useState(false);
  const [formFill, setFormFillState] = useState(false);

  // Snapshot is the change signal; surface content-control state moves with it.
  const tick = useEditorState(active ? selectSnapshot : selectNothing);

  const surface = editor?.surface ?? null;
  const cc = surface?.contentControls;

  useEffect(() => {
    void tick;
    setShowAllState(cc?.showAll() ?? surface?.state().contentControls.showAll ?? false);
    setFormFillState(cc?.formFill() ?? surface?.state().contentControls.formFill ?? false);
  }, [tick, cc, surface]);

  // Both reads run on every editor change and build new objects. The previous object stays
  // while every value is the same, so this context does not re-render its consumers on
  // each keystroke.
  const lastControl = useRef<ContentControlInspectorState | null>(null);
  const lastControls = useRef<readonly ContentControlSummary[]>([]);
  const freshControl = useMemo((): ContentControlInspectorState | null => {
    void tick;
    if (!editor) return null;

    const boundary = cc?.atCaret() ?? null;
    if (boundary) {
      const editReason = cc?.disabledReason(boundary.id, 'edit') ?? null;
      const removeReason = cc?.disabledReason(boundary.id, 'remove') ?? null;
      return {
        id: boundary.id,
        tag: boundary.tag ?? null,
        alias: boundary.alias ?? null,
        controlType: boundary.controlType,
        locked: contentLockedFrom(boundary.effectiveLock) || editReason === 'locked',
        removalLocked: removalLockedFrom(boundary.effectiveLock) || removeReason === 'locked',
        placeholder: boundary.placeholder,
        bound: boundary.bound || editReason === 'bound',
        effectiveLock: boundary.effectiveLock,
      };
    }

    // Fallback when layout has not published a boundary yet (or Content is not mounted):
    // prefer surface refusal reasons and `editor.can`, not the summary's content-lock bit alone.
    // `ContentControlSummary.locked` is the content-edit axis only — sdtLocked must not
    // masquerade as content-locked, and bound is not on the summary.
    const summary = editor.query({ type: 'contentControlAt' });
    if (!summary) return null;
    const editReason = cc?.disabledReason(summary.id, 'edit') ?? null;
    const removeReason = cc?.disabledReason(summary.id, 'remove') ?? null;
    const canEdit = editor.can({ type: 'setContentControlValue', value: '' });
    const canRemove = editor.can({ type: 'removeContentControl' });
    const locked =
      summary.locked === true || editReason === 'locked' || reasonFromCan(canEdit, 'locked');
    const bound = editReason === 'bound' || reasonFromCan(canEdit, 'bound');
    const removalLocked = removeReason === 'locked' || reasonFromCan(canRemove, 'locked');
    return {
      id: summary.id,
      tag: summary.tag ?? null,
      alias: summary.alias ?? null,
      controlType: summary.controlType,
      locked,
      removalLocked,
      placeholder: false,
      bound,
      effectiveLock: null,
    };
  }, [editor, tick, cc]);
  const control = sameFlatRecord(lastControl.current, freshControl)
    ? lastControl.current
    : freshControl;

  const freshControls = useMemo((): readonly ContentControlSummary[] => {
    void tick;
    if (!editor) return [];
    return editor.query({ type: 'contentControls' });
  }, [editor, tick]);
  const controls = sameFlatRecords(lastControls.current, freshControls)
    ? lastControls.current
    : freshControls;
  useEffect(() => {
    lastControl.current = control;
    lastControls.current = controls;
  });

  const setShowAll = useCallback(
    (show: boolean) => {
      cc?.setShowAll(show);
      setShowAllState(show);
    },
    [cc]
  );

  const setFormFill = useCallback(
    (on: boolean) => {
      cc?.setFormFill(on);
      setFormFillState(on);
    },
    [cc]
  );

  const toggleShowAll = useCallback(() => setShowAll(!showAll), [setShowAll, showAll]);
  const toggleFormFill = useCallback(() => setFormFill(!formFill), [setFormFill, formFill]);

  const openInspector = useCallback(() => setInspectorOpen(true), []);
  const closeInspector = useCallback(() => setInspectorOpen(false), []);
  const toggleInspector = useCallback(() => setInspectorOpen((open) => !open), []);

  const setValueDisabledReason = useMemo(() => {
    if (!control) return 'no content control at the current selection';
    if (cc) {
      const reason = cc.disabledReason(control.id, 'edit');
      if (reason === 'locked') return 'the content control is locked';
      if (reason === 'bound') return 'the content control is bound to external data';
      if (reason === 'notFound') return 'the content control was not found';
      return reason;
    }
    // Unmounted Content: derive from inspector model + `editor.can` without inventing reasons.
    if (control.locked) return 'the content control is locked';
    if (control.bound) return 'the content control is bound to external data';
    if (!editor) return 'no document is loaded';
    const canEdit = editor.can({ type: 'setContentControlValue', value: '' });
    if (!canEdit.ok) return canEdit.reason;
    return null;
  }, [control, cc, editor]);

  const removeDisabledReason = useMemo(() => {
    if (!control) return 'no content control at the current selection';
    if (cc) {
      const reason = cc.disabledReason(control.id, 'remove');
      if (reason === 'locked') return 'the content control is locked';
      if (reason === 'notFound') return 'the content control was not found';
      return reason;
    }
    if (control.removalLocked) return 'the content control is locked';
    if (!editor) return 'no document is loaded';
    const canRemove = editor.can({ type: 'removeContentControl' });
    if (!canRemove.ok) return canRemove.reason;
    return null;
  }, [control, cc, editor]);

  const setValue = useCallback(
    (value: string): ExecResult => {
      if (!editor) {
        return { ok: false, code: 'notFound', reason: 'no document is loaded' };
      }
      if (cc && control) {
        const reason = cc.disabledReason(control.id, 'edit');
        if (reason) {
          return {
            ok: false,
            code: reason === 'bound' ? 'bound' : reason === 'locked' ? 'locked' : 'notFound',
            reason:
              reason === 'bound'
                ? 'the content control is bound to external data'
                : reason === 'locked'
                  ? 'the content control is locked'
                  : 'the content control was not found',
          };
        }
      }
      return editor.exec({ type: 'setContentControlValue', value });
    },
    [editor, cc, control]
  );

  const remove = useCallback((): ExecResult => {
    if (!editor) {
      return { ok: false, code: 'notFound', reason: 'no document is loaded' };
    }
    if (cc) {
      const id = control?.id;
      if (!id) {
        return {
          ok: false,
          code: 'notFound',
          reason: 'no content control at the current selection',
        };
      }
      const reason = cc.disabledReason(id, 'remove');
      if (reason) {
        return {
          ok: false,
          code: reason === 'locked' ? 'locked' : 'notFound',
          reason:
            reason === 'locked'
              ? 'the content control is locked'
              : 'the content control was not found',
        };
      }
      const ok = cc.remove(id);
      return ok
        ? { ok: true, changed: true }
        : { ok: false, code: 'unsupported', reason: 'the edit was refused' };
    }
    return editor.exec({ type: 'removeContentControl' });
  }, [editor, cc, control]);

  return useMemo(
    () => ({
      control,
      controls,
      showAll,
      formFill,
      inspectorOpen,
      canSetValue: setValueDisabledReason === null && control !== null,
      canRemove: removeDisabledReason === null && control !== null,
      setValueDisabledReason,
      removeDisabledReason,
      setShowAll,
      toggleShowAll,
      setFormFill,
      toggleFormFill,
      openInspector,
      closeInspector,
      toggleInspector,
      remove,
      setValue,
    }),
    [
      control,
      controls,
      showAll,
      formFill,
      inspectorOpen,
      setValueDisabledReason,
      removeDisabledReason,
      setShowAll,
      toggleShowAll,
      setFormFill,
      toggleFormFill,
      openInspector,
      closeInspector,
      toggleInspector,
      remove,
      setValue,
    ]
  );
}

/** Shared chrome state — one per `DocxEditor.Root`. @internal */
export const ContentControlContext = createContext<UseContentControlResult | null>(null);

/** Same own keys with `Object.is` values: the flat records a content-control read returns. */
function sameFlatRecord(a: object | null, b: object | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  );
}

function sameFlatRecords(a: readonly object[], b: readonly object[]): boolean {
  return a.length === b.length && a.every((entry, index) => sameFlatRecord(entry, b[index]!));
}
