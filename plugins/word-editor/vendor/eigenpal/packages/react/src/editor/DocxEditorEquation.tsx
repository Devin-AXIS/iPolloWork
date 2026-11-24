import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { EquationActivation } from '@docx-editor.dev/core/editor';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';
import { useDocxEditor } from './context';
import { absolutePointInScroller } from './scroller-geometry.ts';
import { useEditorState } from './useEditorState.ts';
import { isDomNode } from '@docx-editor.dev/core/editor';

interface EquationPopupState {
  readonly activation: EquationActivation;
  readonly mountGeneration: number;
  readonly draft: string;
  readonly error: boolean;
}

const selectSnapshot = (snapshot: EditorSnapshot): EditorSnapshot => snapshot;

/** Keeps button chrome from moving the document caret. Inputs retain normal focus behavior. */
function guardMousedown(event: React.MouseEvent): void {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
}

/** Default equation editor mounted by the packaged React host. */
export function DocxEditorEquation() {
  const editor = useDocxEditor();
  const { t } = useTranslation();
  const [state, setState] = useState<EquationPopupState | null>(null);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const releasePinRef = useRef<(() => void) | null>(null);
  const inputId = useId();
  const errorId = useId();
  const disabledReasonId = useId();
  const activation = state?.activation ?? null;
  const editorSnapshot = useEditorState(selectSnapshot);
  const mutationAvailability = useMemo(() => {
    void editorSnapshot;
    if (!editor?.surface || !activation) {
      return { replaceEnabled: false, removeEnabled: false, reason: null };
    }
    const replace = editor.surface.equations.can(activation.equation.id, 'replace');
    const remove = editor.surface.equations.can(activation.equation.id, 'remove');
    const refusal = !replace.ok ? replace.reason : !remove.ok ? remove.reason : null;
    return {
      replaceEnabled: replace.ok,
      removeEnabled: remove.ok,
      reason: refusal ? localizeDisabledReason(refusal, t) : null,
    };
  }, [activation, editor, editorSnapshot, t]);

  const close = useCallback(
    (restoreFocus = false) => {
      releasePinRef.current?.();
      releasePinRef.current = null;
      setState(null);
      if (restoreFocus && editor) queueMicrotask(() => editor.focus());
    },
    [editor]
  );

  useEffect(() => {
    if (!editor) return undefined;
    const unregister = editor.setEquationChrome({
      onPopover: (activation) => {
        releasePinRef.current?.();
        const surface = editor.surface;
        if (surface && typeof surface.retainSelection === 'function') {
          const pin = surface.retainSelection();
          releasePinRef.current = () => surface.releaseSelection(pin);
        } else {
          releasePinRef.current = null;
        }
        setState({
          activation,
          mountGeneration: editor.mountGeneration,
          draft: activation.equation.linear,
          error: false,
        });
      },
    });
    return () => {
      unregister();
      releasePinRef.current?.();
      releasePinRef.current = null;
      setState(null);
    };
  }, [editor, close]);

  useEffect(() => {
    if (!state || !editor?.surface) return;
    const stale =
      editor.mountGeneration !== state.mountGeneration ||
      !editor.surface.equations.equationById(state.activation.equation.id);
    if (stale) close();
  }, [editor, editorSnapshot, state, close]);

  useEffect(() => {
    if (!state) return undefined;
    const panel = panelRef.current;
    const ownerDocument = panel?.ownerDocument;
    const view = ownerDocument?.defaultView;
    if (!panel || !ownerDocument || !view) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (isDomNode(event.target) && panel.contains(event.target)) return;
      close();
    };
    ownerDocument.addEventListener('keydown', onKeyDown);
    ownerDocument.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      ownerDocument.removeEventListener('keydown', onKeyDown);
      ownerDocument.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [state, close]);

  useLayoutEffect(() => {
    if (!activation) {
      setPlacement(null);
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    const container = panel.offsetParent as HTMLElement | null;
    if (!container) {
      setPlacement(null);
      return;
    }
    const rect = activation.rect;
    const point = absolutePointInScroller(container, rect.left, rect.bottom);
    const maxLeft = Math.max(0, container.scrollWidth - panel.offsetWidth);
    setPlacement({ left: Math.max(0, Math.min(point.left, maxLeft)), top: point.top });
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [activation]);

  const apply = useCallback((): boolean => {
    if (!state || !editor?.surface || !mutationAvailability.replaceEnabled) return false;
    const applied = editor.surface.equations.applyEquation(
      state.activation.equation.id,
      state.draft
    );
    if (applied) close(true);
    else setState((current) => (current ? { ...current, error: true } : current));
    return applied;
  }, [editor, state, close, mutationAvailability.replaceEnabled]);

  const remove = useCallback((): boolean => {
    if (!state || !editor?.surface || !mutationAvailability.removeEnabled) return false;
    const removed = editor.surface.equations.removeEquation(state.activation.equation.id);
    if (removed) close(true);
    else setState((current) => (current ? { ...current, error: true } : current));
    return removed;
  }, [editor, state, close, mutationAvailability.removeEnabled]);

  if (!state) return null;
  const describedBy = [
    state.error ? errorId : null,
    mutationAvailability.reason ? disabledReasonId : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      ref={panelRef}
      className="docx-equation-popup"
      data-testid="equation-popup"
      role="dialog"
      aria-modal={false}
      aria-label={t('equationPopup.title')}
      style={placement ?? undefined}
      onMouseDown={guardMousedown}
    >
      <label className="docx-editor-sr-only" htmlFor={inputId}>
        {t('equationPopup.inputLabel')}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        className="docx-equation-popup__input"
        data-testid="equation-popup-input"
        value={state.draft}
        placeholder={t('equationPopup.placeholder')}
        spellCheck={false}
        aria-describedby={describedBy || undefined}
        onChange={(event) =>
          setState((current) =>
            current ? { ...current, draft: event.target.value, error: false } : current
          )
        }
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          apply();
        }}
      />
      {state.error ? (
        <div
          id={errorId}
          className="docx-equation-popup__error"
          data-testid="equation-popup-error"
          role="alert"
        >
          {t('equationPopup.refused')}
        </div>
      ) : null}
      {mutationAvailability.reason ? (
        <div
          id={disabledReasonId}
          className="docx-equation-popup__error"
          data-testid="equation-popup-disabled-reason"
          role="status"
        >
          {mutationAvailability.reason}
        </div>
      ) : null}
      <div className="docx-equation-popup__actions">
        <button
          type="button"
          className="docx-equation-popup__apply"
          data-testid="equation-popup-apply"
          disabled={!mutationAvailability.replaceEnabled}
          title={mutationAvailability.reason ?? undefined}
          onMouseDown={guardMousedown}
          onClick={apply}
        >
          {t('equationPopup.apply')}
        </button>
        <button
          type="button"
          className="docx-equation-popup__delete"
          data-testid="equation-popup-delete"
          disabled={!mutationAvailability.removeEnabled}
          title={mutationAvailability.reason ?? undefined}
          onMouseDown={guardMousedown}
          onClick={remove}
        >
          {t('equationPopup.delete')}
        </button>
      </div>
    </div>
  );
}
