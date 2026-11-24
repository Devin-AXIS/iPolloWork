import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  COMPARE_DOCUMENTS_ACCEPT,
  COMPARE_DOCUMENTS_PHASE_ATTRIBUTE,
  compareDocumentsErrorKey,
  focusCompareDocumentsControl,
  type CompareDocumentsDialogSession,
  type CompareDocumentsProgress,
} from '@docx-editor.dev/core/editor';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';
import { useEditorState } from './useEditorState';
import {
  createDialogParts,
  DialogFrame,
  type DialogCustomizationProps,
  type UseDialogReturn,
} from './dialog-parts';

/** Compare documents session and presentation. @public */
export interface DocxEditorCompareDocumentsDialogProps extends DialogCustomizationProps {
  session: CompareDocumentsDialogSession | null;
}
/** The Compare documents draft. @public */
export interface CompareDocumentsDialogValues {
  /** The revised document. The open document is the original. */
  readonly revised: File | null;
  readonly authorName: string;
  readonly detectFormatChanges: boolean;
  /**
   * Write the revisions without dates. Default `false`. The preset has no control for it; a
   * custom part sets it with `setValue('removeDateAndTime', true)`.
   */
  readonly removeDateAndTime: boolean;
}
/** Compare documents draft and actions. @public */
export interface UseCompareDocumentsDialogReturn extends UseDialogReturn<CompareDocumentsDialogValues> {
  /**
   * True while the chosen file is read and compared. `apply()` does nothing while it is true,
   * so a second press cannot start a second compare.
   */
  readonly busy: boolean;
  /**
   * How far the running compare is, when the editor compares in the background (see
   * `reviewModule({ compareWorker })`). Null when no compare runs or none reports its steps.
   */
  readonly progress: CompareDocumentsProgress | null;
  /** Whether `cancel()` stops a running compare. True when the editor compares in the background. */
  readonly cancelable: boolean;
  /** A message that is not an error, such as that the documents have no differences. */
  readonly notice: string | undefined;
  /** Whether the open document has tracked changes, which the compare treats as accepted. */
  readonly originalHasTrackedChanges: boolean;
}
const parts = createDialogParts<
  keyof CompareDocumentsDialogValues,
  UseCompareDocumentsDialogReturn
>();
/** Read the enclosing Compare documents draft. @public */
export function useCompareDocumentsDialog(): UseCompareDocumentsDialogReturn {
  return parts.useState();
}

// A stable key per session: a new session mounts a new form, so no draft, busy state, or
// progress of the previous session carries over.
const sessionKeys = new WeakMap<CompareDocumentsDialogSession, number>();
let nextSessionKey = 0;
const sessionKey = (session: CompareDocumentsDialogSession): number => {
  let key = sessionKeys.get(session);
  if (key === undefined) sessionKeys.set(session, (key = nextSessionKey++));
  return key;
};

function CompareDocumentsDialogRoot({ session, ...props }: DocxEditorCompareDocumentsDialogProps) {
  return session ? (
    <CompareDocumentsForm key={sessionKey(session)} session={session} {...props} />
  ) : null;
}
function CompareDocumentsForm({
  session,
  children,
  preset,
  className,
  style,
}: DialogCustomizationProps & { session: CompareDocumentsDialogSession }) {
  const ids = useId();
  const { t: translate } = useTranslation();
  const t = (key: string) => translate(`compareDocuments.${key}` as TranslationKey);
  const [values, setValues] = useState<CompareDocumentsDialogValues>(() => ({
    revised: null,
    authorName: session.defaultAuthor,
    detectFormatChanges: true,
    removeDateAndTime: false,
  }));
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<CompareDocumentsProgress | null>(null);
  const [closed, setClosed] = useState(session.signal.aborted);
  const panel = useRef<HTMLDialogElement | null>(null);
  // Where focus goes once the next render is on screen: Compare disables itself while busy.
  const [focusMoment, setFocusMoment] = useState<{
    readonly moment: 'busy' | 'refused' | 'unchanged';
  } | null>(null);
  useLayoutEffect(() => {
    if (focusMoment) focusCompareDocumentsControl(panel.current, focusMoment.moment);
  }, [focusMoment]);
  // The session's own state (viewing, protection, collaboration, a preview) moves with the
  // editor; `session.canApply()` stays the authority.
  const canApply = useEditorState(
    useCallback(() => session.canApply(), [session]),
    Object.is
  );
  const running = useRef(false);
  const lifetime = useRef<CompareDocumentsDialogSession | null>(null);
  useEffect(() => {
    lifetime.current = session;
    const close = () => setClosed(true);
    setClosed(session.signal.aborted);
    session.signal.addEventListener('abort', close);
    return () => {
      session.signal.removeEventListener('abort', close);
      lifetime.current = null;
      queueMicrotask(() => {
        if (lifetime.current !== session) session.cancel();
      });
    };
  }, [session]);
  const compare = async () => {
    const file = values.revised;
    if (!file) {
      setError(t('fileRequired'));
      return;
    }
    // A duplicate submission while a compare runs is ignored; the session itself answers
    // `busy` to a second `apply`.
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFocusMoment({ moment: 'busy' });
    setError(undefined);
    setNotice(undefined);
    try {
      let revised: Uint8Array;
      try {
        revised = new Uint8Array(await file.arrayBuffer());
      } catch {
        if (!session.signal.aborted) {
          setError(t('readFailed'));
          setBusy(false);
          setFocusMoment({ moment: 'refused' });
        }
        return;
      }
      if (session.signal.aborted) return;
      const outcome = await session.apply(
        {
          revised,
          authorName: values.authorName,
          detectFormatChanges: values.detectFormatChanges,
          ...(values.removeDateAndTime ? { removeDateAndTime: true } : {}),
        },
        { onProgress: setProgress }
      );
      if (session.signal.aborted) return;
      setProgress(null);
      // With no differences the dialog stays open and says so; nothing changed.
      if (outcome.ok) setNotice(translate('compareDocuments.noDifferences'));
      else setError(translate(compareDocumentsErrorKey(outcome)));
      setBusy(false);
      setFocusMoment({ moment: outcome.ok ? 'unchanged' : 'refused' });
    } finally {
      running.current = false;
    }
  };
  const phaseText = progress
    ? translate(`compareDocuments.phases.${progress.phase}` as TranslationKey)
    : t('comparing');
  const state: UseCompareDocumentsDialogReturn = {
    values,
    setValue(name, value) {
      setError(undefined);
      setNotice(undefined);
      setValues((previous) => ({ ...previous, [name]: value }));
    },
    errors: error === undefined ? {} : { form: error },
    isEnabled: !closed && !busy && values.revised !== null && canApply,
    busy,
    progress,
    cancelable: session.cancelable,
    notice,
    originalHasTrackedChanges: session.originalHasTrackedChanges,
    apply() {
      void compare();
    },
    cancel() {
      if (!busy || session.cancelable) session.cancel();
    },
  };
  if (closed) return null;
  return (
    <DialogFrame
      kind="compareDocuments"
      label={t('title')}
      className={['docx-compare-documents-dialog', className].filter(Boolean).join(' ')}
      style={style}
      onClose={state.cancel}
      panelRef={panel}
      dismissOutside={false}
      sessionSignal={session.signal}
      // The description is part of the preset; without it the reference would point nowhere.
      describedBy={
        preset === false
          ? undefined
          : `${ids}-description${session.originalHasTrackedChanges ? ` ${ids}-tracked` : ''}`
      }
      busy={busy}
    >
      <parts.Composition
        state={state}
        preset={preset}
        defaults={
          <>
            <div data-docx-part="header">
              <h2 data-docx-part="title">{t('title')}</h2>
              <p id={`${ids}-description`}>{t('description')}</p>
              {session.originalHasTrackedChanges ? (
                <p
                  id={`${ids}-tracked`}
                  data-docx-part="trackedChanges"
                  className="docx-compare-documents-tracked"
                >
                  {t('trackedChangesAccepted')}
                </p>
              ) : null}
            </div>
            <div data-docx-part="body" className="docx-compare-documents-body">
              <label data-docx-part="field" data-docx-field="revised">
                <span>{t('revisedFile')}</span>
                <input
                  type="file"
                  accept={COMPARE_DOCUMENTS_ACCEPT}
                  disabled={busy}
                  onChange={(event) =>
                    state.setValue('revised', event.currentTarget.files?.[0] ?? null)
                  }
                />
              </label>
              <label data-docx-part="field" data-docx-field="authorName">
                <span>{t('author')}</span>
                <input
                  type="text"
                  autoComplete="off"
                  value={values.authorName}
                  disabled={busy}
                  onChange={(event) => state.setValue('authorName', event.currentTarget.value)}
                />
              </label>
              <label
                data-docx-part="field"
                data-docx-field="detectFormatChanges"
                className="docx-compare-documents-check"
              >
                <input
                  type="checkbox"
                  checked={values.detectFormatChanges}
                  disabled={busy}
                  onChange={(event) =>
                    state.setValue('detectFormatChanges', event.currentTarget.checked)
                  }
                />
                {t('detectFormatting')}
              </label>
            </div>
            {busy ? (
              <div data-docx-part="progress" aria-busy="true">
                {/* Indeterminate until the compare reports its first step. */}
                <progress
                  className="docx-compare-documents-progress"
                  max={1}
                  value={progress?.fraction}
                  aria-label={t('comparing')}
                  aria-valuetext={phaseText}
                />
                <span
                  className="docx-compare-documents-phase"
                  tabIndex={-1}
                  {...{ [COMPARE_DOCUMENTS_PHASE_ATTRIBUTE]: '' }}
                >
                  {phaseText}
                </span>
              </div>
            ) : null}
            <p data-docx-part="error" role="alert" className="docx-compare-documents-error">
              {state.errors.form}
            </p>
            <p data-docx-part="notice" role="status" className="docx-compare-documents-notice">
              {notice}
            </p>
            <div data-docx-part="footer" className="docx-compare-documents-actions">
              <button
                data-docx-part="cancel"
                type="button"
                disabled={busy && !session.cancelable}
                onClick={state.cancel}
              >
                {/* After a compare with no differences, nothing remains to cancel. */}
                {notice ? translate('common.close') : t('cancel')}
              </button>
              <button
                data-docx-part="apply"
                type="button"
                disabled={!state.isEnabled}
                onClick={state.apply}
              >
                {t(busy ? 'comparing' : 'compare')}
              </button>
            </div>
          </>
        }
      >
        {children}
      </parts.Composition>
    </DialogFrame>
  );
}
/** Compare documents with replaceable controls and layout. @public */
export const DocxEditorCompareDocumentsDialog = Object.assign(CompareDocumentsDialogRoot, {
  Header: parts.Header,
  Title: parts.Title,
  Body: parts.Body,
  Footer: parts.Footer,
  Apply: parts.Apply,
  Cancel: parts.Cancel,
  Error: parts.Error,
  Field: parts.Field,
  /** The progress bar and the running step in words, shown while a compare runs. */
  Progress: parts.part('progress'),
  /** A message that is not an error, such as that the documents have no differences. */
  Notice: parts.part('notice'),
});
