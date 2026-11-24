import { useEffect, useState, useSyncExternalStore, useCallback, useRef, useId } from 'react';
import type {
  RevisionMarkupDialogSession,
  ResolvedRevisionMarkup,
} from '@docx-editor.dev/core/editor';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';
import {
  createDialogParts,
  DialogFrame,
  type DialogCustomizationProps,
  type UseDialogReturn,
} from './dialog-parts';
import { revisionMarkupFields } from './revision-markup-fields';

/** Revision markup session and presentation. @public */
export interface DocxEditorRevisionMarkupDialogProps extends DialogCustomizationProps {
  session: RevisionMarkupDialogSession | null;
}
/** Revision markup draft and actions. @public */
export interface UseRevisionMarkupDialogReturn extends UseDialogReturn<ResolvedRevisionMarkup> {
  reset(): void;
}
const parts = createDialogParts<keyof ResolvedRevisionMarkup, UseRevisionMarkupDialogReturn>();
/** Read the enclosing revision markup draft. @public */
export function useRevisionMarkupDialog(): UseRevisionMarkupDialogReturn {
  return parts.useState();
}

function RevisionMarkupDialogRoot({ session, ...props }: DocxEditorRevisionMarkupDialogProps) {
  return session ? <RevisionMarkupForm session={session} {...props} /> : null;
}
function RevisionMarkupForm({
  session,
  children,
  preset,
  className,
  style,
}: DialogCustomizationProps & {
  session: RevisionMarkupDialogSession;
}) {
  const noteId = useId();
  const { t: translate } = useTranslation();
  const t = (key: string) => translate(`revisionMarkup.${key}` as TranslationKey);
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session]);
  const get = useCallback(() => session.get(), [session]);
  const values = useSyncExternalStore(subscribe, get, get);
  const [closed, setClosed] = useState(session.signal.aborted);
  const lifetime = useRef<RevisionMarkupDialogSession | null>(null);
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
  const state: UseRevisionMarkupDialogReturn = {
    values,
    setValue(name, value) {
      session.set({ [name]: value });
    },
    errors: {},
    isEnabled: !closed && session.canApply(),
    apply() {
      session.apply();
    },
    cancel() {
      session.cancel();
    },
    reset() {
      session.reset();
    },
  };
  if (closed) return null;
  return (
    <DialogFrame
      kind="revisionMarkup"
      label={t('title')}
      className={['docx-revision-markup-dialog', className].filter(Boolean).join(' ')}
      style={style}
      onClose={state.cancel}
      dismissOutside={false}
      sessionSignal={session.signal}
    >
      <parts.Composition
        state={state}
        preset={preset}
        defaults={
          <>
            <div data-docx-part="header">
              <h2 data-docx-part="title">{t('title')}</h2>
            </div>
            <div data-docx-part="body" className="docx-revision-markup-body">
              {revisionMarkupFields(state, t, noteId)}
            </div>
            <div data-docx-part="footer" className="docx-revision-markup-actions">
              <button data-docx-part="reset" type="button" onClick={state.reset}>
                {t('reset')}
              </button>
              <span data-docx-part="error" role="alert">
                {state.errors.form}
              </span>
              <button data-docx-part="cancel" type="button" onClick={state.cancel}>
                {t('cancel')}
              </button>
              <button
                data-docx-part="apply"
                type="button"
                disabled={!state.isEnabled}
                onClick={state.apply}
              >
                {t('ok')}
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
/** Track changes options with replaceable controls and layout. @public */
export const DocxEditorRevisionMarkupDialog = Object.assign(RevisionMarkupDialogRoot, {
  Header: parts.Header,
  Title: parts.Title,
  Body: parts.Body,
  Footer: parts.Footer,
  Apply: parts.Apply,
  Cancel: parts.Cancel,
  Error: parts.Error,
  Field: parts.Field,
  Reset: parts.Reset,
});
