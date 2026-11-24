import { TEXT_FORM_FORMATS } from '../store/store/text-form-field-options.ts';
import { textFormLabels, textFormTranslate } from './text-form-field-translations.ts';
import {
  type TextFormFieldOptions,
  type TextFormFieldType,
  type TextFormFieldRange,
} from '@docx-editor.dev/core/store';
import { isHTMLElementTag } from './host-realm.ts';

/** The same accessible options dialog is mounted by every adapter. */
export function textFormFieldDialog(
  container: HTMLElement,
  field: TextFormFieldRange,
  save: (text: string, options: TextFormFieldOptions) => boolean,
  close: () => void,
  translate?: ReturnType<typeof textFormTranslate>
): HTMLDialogElement {
  const t = textFormTranslate(translate);
  const document = container.ownerDocument;
  const panel = document.createElement('dialog');
  const text = textFormLabels(panel, t);
  panel.className = 'docx-text-form-dialog';
  // An editor modal: an open toolbar popup stays open behind it (see popup-escape.ts).
  panel.setAttribute('data-docx-modal', '');
  text(panel, 'textFormField.title', 'aria-label');
  const heading = document.createElement('h2');
  heading.className = 'docx-text-form-dialog__header';
  text(heading, 'textFormField.title');
  const body = document.createElement('div');
  body.className = 'docx-text-form-dialog__body';
  const footer = document.createElement('div');
  footer.className = 'docx-text-form-dialog__footer';
  panel.append(heading, body, footer);
  const label = (key: Parameters<typeof t>[0], control: HTMLElement): void => {
    const element = document.createElement('label');
    element.className = 'docx-text-form-dialog__row';
    const caption = document.createElement('span');
    caption.className = 'docx-text-form-dialog__label';
    text(caption, key);
    control.className = 'docx-text-form-dialog__input';
    element.append(caption, control);
    body.append(element);
  };
  const input = document.createElement('input');
  input.type = 'text';
  input.value = field.defaultText;
  label('textFormField.defaultText', input);
  const type = document.createElement('select');
  const types = ['regular', 'number', 'date'] as const;
  for (const value of types) {
    const option = document.createElement('option');
    option.value = value;
    text(option, `textFormField.${value}`);
    type.append(option);
  }
  if (!types.includes(field.type as TextFormFieldType)) {
    const option = document.createElement('option');
    option.value = field.type;
    text(option, 'textFormField.preservedType');
    option.disabled = true;
    type.append(option);
  }
  type.value = field.type;
  label('textFormField.type', type);
  const max = document.createElement('input');
  max.type = 'number';
  max.min = '0';
  max.max = '32767';
  max.step = '1';
  max.value = String(field.maxLength);
  label('textFormField.maxLength', max);
  const format = document.createElement('select');
  const populateFormats = (selected: string): void => {
    format.replaceChildren();
    const values: readonly string[] = TEXT_FORM_FORMATS[type.value as TextFormFieldType] ?? [];
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      const regularLabels = {
        Uppercase: 'textFormField.uppercase',
        Lowercase: 'textFormField.lowercase',
        'First capital': 'textFormField.firstCapital',
        'Title case': 'textFormField.titleCase',
      } as const;
      const key = regularLabels[value as keyof typeof regularLabels];
      if (key || !value) text(option, key ?? 'textFormField.noFormat');
      else option.textContent = value;
      format.append(option);
    }
    if (!values.includes(selected)) {
      const option = document.createElement('option');
      option.value = selected;
      if (selected) option.textContent = selected;
      else text(option, 'textFormField.noFormat');
      option.disabled = true;
      format.append(option);
    }
    format.value = selected;
  };
  populateFormats(field.format);
  type.addEventListener('change', () => populateFormats(''));
  label('textFormField.format', format);
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = field.enabled;
  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'docx-text-form-dialog__checkbox-row';
  const enabledText = document.createElement('span');
  text(enabledText, 'textFormField.enabled');
  enabledLabel.append(enabled, enabledText);
  body.append(enabledLabel);
  const error = document.createElement('p');
  error.className = 'docx-text-form-dialog__error';
  error.setAttribute('role', 'alert');
  body.append(error);
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'docx-text-form-dialog__button';
  text(cancel, 'textFormField.cancel');
  cancel.addEventListener('click', close);
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'docx-text-form-dialog__button docx-text-form-dialog__button--primary';
  text(apply, 'textFormField.apply');
  const submit = (): void => {
    if (
      !max.value ||
      !max.checkValidity() ||
      !save(input.value, {
        type: type.value as TextFormFieldType,
        maxLength: Number(max.value),
        format: format.value,
        enabled: enabled.checked,
      })
    ) {
      text(error, 'textFormField.invalidOptions');
      return;
    }
    close();
  };
  apply.addEventListener('click', submit);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing && isHTMLElementTag(event.target, 'input')) {
      event.preventDefault();
      submit();
    }
  });
  panel.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  footer.append(cancel, apply);
  container.append(panel);
  panel.showModal();
  input.focus();
  input.select();
  return panel;
}
