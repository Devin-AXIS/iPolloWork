import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { InvalidTextFormFieldSession } from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useFormControlTranslate } from './form-control-translate';
import { DialogFrame } from './dialog-parts';

/** Invalid-value acknowledgement with editor-owned clearing and focus restoration. @public */
export interface DocxEditorInvalidTextFormFieldDialogProps {
  session: InvalidTextFormFieldSession;
  className?: string;
  style?: CSSProperties;
  children?: DocxEditorChildren;
}
/** Default acknowledgement shell for a custom popup renderer. @public */
export function DocxEditorInvalidTextFormFieldDialog(
  props: DocxEditorInvalidTextFormFieldDialogProps
) {
  const [session, setSession] = useState(props.session);
  const [generation, setGeneration] = useState(0);
  if (session !== props.session) {
    setSession(props.session);
    setGeneration(generation + 1);
  }
  return <InvalidForm key={generation} {...props} />;
}
function InvalidForm({
  session,
  className,
  style,
  children,
}: DocxEditorInvalidTextFormFieldDialogProps) {
  const t = useFormControlTranslate();
  const [closed, setClosed] = useState(session.signal.aborted);
  const panelRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const abort = () => setClosed(true);
    session.signal.addEventListener('abort', abort, { once: true });
    if (session.signal.aborted) abort();
    return () => session.signal.removeEventListener('abort', abort);
  }, [session]);
  if (closed) return null;
  return (
    <DialogFrame
      kind="invalidTextFormField"
      role="alertdialog"
      label={t('textFormField.invalidTitle')}
      className={className}
      style={style}
      panelRef={panelRef}
      dismissOutside={false}
      onClose={session.acknowledge}
      sessionSignal={session.signal}
      restoreFocus={false}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          session.acknowledge();
        }
      }}
    >
      {children ?? (
        <>
          <header className="docx-dialog__header">
            <h2 className="docx-dialog__title">{t('textFormField.invalidTitle')}</h2>
          </header>
          <div className="docx-dialog__body">
            {t(
              session.type === 'number'
                ? 'textFormField.invalidNumber'
                : 'textFormField.invalidDate'
            )}
          </div>
          <footer className="docx-dialog__footer">
            <button
              type="button"
              className="docx-dialog__button docx-dialog__button--primary"
              onClick={session.acknowledge}
            >
              {t('textFormField.apply')}
            </button>
          </footer>
        </>
      )}
    </DialogFrame>
  );
}
