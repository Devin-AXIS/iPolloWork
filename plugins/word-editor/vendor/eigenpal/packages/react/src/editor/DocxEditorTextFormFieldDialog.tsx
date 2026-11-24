import { useEditorState } from './useEditorState';
import { useEffect, useState } from 'react';
import type { TextFormFieldDialogSession } from '@docx-editor.dev/core/editor';
import { isHTMLElementNode, TEXT_FORM_FORMATS } from '@docx-editor.dev/core/editor';
import type { TextFormFieldOptions } from '@docx-editor.dev/core/store';
import { useFormControlTranslate } from './form-control-translate';
import {
  createDialogParts,
  DialogFrame,
  type DialogCustomizationProps,
  type UseDialogReturn,
} from './dialog-parts';

/** Draft values for legacy text Field Options. @public */
export interface TextFormFieldDialogFields {
  defaultText: string;
  type: string;
  maxLength: number;
  format: string;
  enabled: boolean;
}
/** Field Options session and presentation. @public */
export interface DocxEditorTextFormFieldDialogProps extends DialogCustomizationProps {
  session: TextFormFieldDialogSession | null;
}
/** Field Options draft and actions. @public */
export interface UseTextFormFieldDialogReturn extends UseDialogReturn<TextFormFieldDialogFields> {}
const parts = createDialogParts<keyof TextFormFieldDialogFields, UseTextFormFieldDialogReturn>();
/** Read the enclosing Field Options draft. @public */
export function useTextFormFieldDialog(): UseTextFormFieldDialogReturn {
  return parts.useState();
}

function TextFormFieldDialogRoot({ session, ...props }: DocxEditorTextFormFieldDialogProps) {
  // A new request creates a new draft even if the same field opens again.
  const [current, setCurrent] = useState(session);
  const [generation, setGeneration] = useState(0);
  if (current !== session) {
    setCurrent(session);
    setGeneration(generation + 1);
  }
  return session ? <TextFormFieldForm key={generation} session={session} {...props} /> : null;
}
function TextFormFieldForm({
  session,
  children,
  preset,
  className,
  style,
}: DialogCustomizationProps & { session: TextFormFieldDialogSession }) {
  const t = useFormControlTranslate();
  const isEnabled = useEditorState(() => session.canApply());
  const [values, setValues] = useState<TextFormFieldDialogFields>(() => ({
    defaultText: session.field.defaultText,
    type: session.field.type,
    maxLength: session.field.maxLength,
    format: session.field.format,
    enabled: session.field.enabled,
  }));
  const [closed, setClosed] = useState(session.signal.aborted);
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    const close = () => setClosed(true);
    session.signal.addEventListener('abort', close);
    if (session.signal.aborted) close();
    return () => session.signal.removeEventListener('abort', close);
  }, [session]);
  const apply = () => {
    if (session.signal.aborted) return;
    const accepted =
      Number.isInteger(values.maxLength) &&
      values.maxLength >= 0 &&
      values.maxLength <= 32767 &&
      session.apply(values.defaultText, {
        type: values.type as TextFormFieldOptions['type'],
        maxLength: values.maxLength,
        format: values.format,
        enabled: values.enabled,
      });
    setRefused(!accepted);
  };
  const state: UseTextFormFieldDialogReturn = {
    values,
    setValue(name, value) {
      setValues((previous) => ({
        ...previous,
        [name]: value,
        ...(name === 'type' ? { format: '' } : {}),
      }));
      setRefused(false);
    },
    errors: refused ? { form: t('textFormField.invalidOptions') } : {},
    isEnabled: !closed && isEnabled,
    apply,
    cancel: session.cancel,
  };
  if (closed) return null;
  const formats: readonly string[] =
    TEXT_FORM_FORMATS[values.type as keyof typeof TEXT_FORM_FORMATS] ?? [];
  const formatKeys = {
    Uppercase: 'textFormField.uppercase',
    Lowercase: 'textFormField.lowercase',
    'First capital': 'textFormField.firstCapital',
    'Title case': 'textFormField.titleCase',
  } as const;
  const row = (name: keyof TextFormFieldDialogFields, control: React.ReactNode) => (
    <label data-docx-part="field" data-docx-field={name} className="docx-dialog__row">
      <span className="docx-dialog__label">{t(`textFormField.${name}`)}</span>
      {control}
    </label>
  );
  return (
    <DialogFrame
      kind="textFormField"
      className={className}
      style={style}
      label={t('textFormField.title')}
      onClose={session.cancel}
      dismissOutside={false}
      sessionSignal={session.signal}
      restoreFocus={false}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          session.cancel();
        }
        if (
          event.key === 'Enter' &&
          isHTMLElementNode(event.target) &&
          event.target.localName === 'input'
        ) {
          event.preventDefault();
          apply();
        }
      }}
    >
      <parts.Composition
        state={state}
        preset={preset}
        defaults={
          <>
            <div data-docx-part="header" className="docx-dialog__header">
              <span data-docx-part="title" className="docx-dialog__title">
                {t('textFormField.title')}
              </span>
            </div>
            <div data-docx-part="body" className="docx-dialog__body">
              {row(
                'defaultText',
                <input
                  className="docx-dialog__input"
                  value={values.defaultText}
                  onChange={(e) => state.setValue('defaultText', e.target.value)}
                />
              )}
              {row(
                'type',
                <select
                  className="docx-dialog__input"
                  value={values.type}
                  onChange={(e) => state.setValue('type', e.target.value)}
                >
                  {(['regular', 'number', 'date'] as const).map((type) => (
                    <option key={type} value={type}>
                      {t(`textFormField.${type}`)}
                    </option>
                  ))}
                  {!Object.hasOwn(TEXT_FORM_FORMATS, values.type) ? (
                    <option value={values.type} disabled>
                      {t('textFormField.preservedType')}
                    </option>
                  ) : null}
                </select>
              )}
              {row(
                'maxLength',
                <input
                  className="docx-dialog__input"
                  type="number"
                  min={0}
                  max={32767}
                  step={1}
                  value={Number.isNaN(values.maxLength) ? '' : values.maxLength}
                  onChange={(e) => state.setValue('maxLength', e.target.valueAsNumber)}
                />
              )}
              {row(
                'format',
                <select
                  className="docx-dialog__input"
                  value={values.format}
                  onChange={(e) => state.setValue('format', e.target.value)}
                >
                  {formats.map((format) => (
                    <option key={format} value={format}>
                      {formatKeys[format as keyof typeof formatKeys]
                        ? t(formatKeys[format as keyof typeof formatKeys])
                        : format || t('textFormField.noFormat')}
                    </option>
                  ))}
                  {!formats.includes(values.format) ? (
                    <option value={values.format} disabled>
                      {values.format || t('textFormField.noFormat')}
                    </option>
                  ) : null}
                </select>
              )}
              <label
                data-docx-part="field"
                data-docx-field="enabled"
                className="docx-dialog__checkbox-row"
              >
                <input
                  type="checkbox"
                  checked={values.enabled}
                  onChange={(e) => state.setValue('enabled', e.target.checked)}
                />
                {t('textFormField.enabled')}
              </label>
            </div>
            <div data-docx-part="footer" className="docx-dialog__footer">
              <span data-docx-part="error" className="docx-dialog__error" role="alert">
                {state.errors.form}
              </span>
              <button
                data-docx-part="cancel"
                className="docx-dialog__button"
                type="button"
                onClick={session.cancel}
              >
                {t('textFormField.cancel')}
              </button>
              <button
                disabled={!isEnabled}
                data-docx-part="apply"
                className="docx-dialog__button docx-dialog__apply"
                type="button"
                onClick={apply}
              >
                {t('textFormField.apply')}
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
/** Legacy text Field Options with replaceable controls and layout. @public */
export const DocxEditorTextFormFieldDialog = Object.assign(TextFormFieldDialogRoot, {
  Header: parts.Header,
  Title: parts.Title,
  Body: parts.Body,
  Footer: parts.Footer,
  Apply: parts.Apply,
  Cancel: parts.Cancel,
  Error: parts.Error,
  Field: parts.Field,
});
