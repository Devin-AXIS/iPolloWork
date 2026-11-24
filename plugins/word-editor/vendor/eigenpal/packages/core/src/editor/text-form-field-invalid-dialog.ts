import { textFormLabels, textFormTranslate } from './text-form-field-translations.ts';

/** Shared invalid-fill acknowledgement. The caller owns removal and selection restoration. */
export function textFormFieldInvalidDialog(
  container: HTMLElement,
  type: 'number' | 'date',
  acknowledge: () => void,
  translate?: ReturnType<typeof textFormTranslate>
): HTMLDialogElement {
  const t = textFormTranslate(translate);
  const document = container.ownerDocument;
  const panel = document.createElement('dialog');
  const text = textFormLabels(panel, t);
  panel.className = 'docx-text-form-dialog';
  panel.setAttribute('role', 'alertdialog');
  // An editor modal: an open toolbar popup stays open behind it (see popup-escape.ts).
  panel.setAttribute('data-docx-modal', '');
  text(panel, 'textFormField.invalidTitle', 'aria-label');
  text(panel, `textFormField.invalid${type === 'number' ? 'Number' : 'Date'}`, 'aria-description');
  const heading = document.createElement('h2');
  heading.className = 'docx-text-form-dialog__header';
  text(heading, 'textFormField.invalidTitle');
  const body = document.createElement('div');
  body.className = 'docx-text-form-dialog__body';
  text(body, `textFormField.invalid${type === 'number' ? 'Number' : 'Date'}`);
  const footer = document.createElement('div');
  footer.className = 'docx-text-form-dialog__footer';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'docx-text-form-dialog__button docx-text-form-dialog__button--primary';
  text(ok, 'textFormField.apply');
  let acknowledged = false;
  const accept = (): void => {
    if (acknowledged) return;
    acknowledged = true;
    acknowledge();
  };
  ok.addEventListener('click', accept);
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    accept();
  });
  panel.addEventListener('cancel', (event) => {
    event.preventDefault();
    accept();
  });
  footer.append(ok);
  panel.append(heading, body, footer);
  container.append(panel);
  panel.showModal();
  ok.focus();
  return panel;
}
