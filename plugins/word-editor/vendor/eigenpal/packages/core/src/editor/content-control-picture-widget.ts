// The picture content control's widget: select the control's drawing, then replace its image.
//
// The widget swaps the image and keeps the drawing's size and metadata. The host may own
// the pick through a `picture` widget
// session; when nobody takes it, the engine opens its own file picker. Either way the bytes
// land through the surface's `replaceImage`, so the trust boundary, the undo unit and the
// mode rules are the ones every image write already has.

import type { TranslationKey } from '@docx-editor.dev/i18n';
import { textFormTranslate } from './text-form-field-translations.ts';
import { armContentControlMenuDismiss } from './content-control-widget-dismiss.ts';
import {
  contentControlPopupKeyDown,
  observeContentControlPopup,
} from './content-control-popup-behavior.ts';
import { DEFAULT_IMAGE_RESOURCE_LIMITS } from '../store/runtime/limits.ts';
import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { findDrawingOverlayFrameInLayout } from '../layout/semantic-hit-test.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';
import { sniffImageMime, type SupportedImageMime } from '../store/package/image-resources.ts';
import type { ImageIntentResult } from '../store/store/tree-package-images.ts';

/** The `accept` list of the engine's picker: what `replaceImage` takes. */
export const CONTENT_CONTROL_PICTURE_ACCEPT = 'image/png,image/jpeg,image/gif,image/bmp,image/webp';

const SUPPORTED: ReadonlySet<string> = new Set(CONTENT_CONTROL_PICTURE_ACCEPT.split(','));

/** How deep the drawing may sit under `w:sdtContent` (a run, a hyperlink, a nested control). */
const MAX_CONTENT_DEPTH = 8;

export interface ContentControlPictureHost {
  readonly document: Document;
  /** The pages layer; the engine's hidden picker lives here while a pick is open. */
  readonly layer: HTMLElement;
  find(controlId: string): OoxmlElement | null;
  layout(): SemanticLayout;
  allowed(controlId: string): boolean;
  translate(key: TranslationKey): string;
  selectDrawing(drawingNodeId: string, paragraphId: string): boolean;
  replaceImage(
    drawingNodeId: string,
    bytes: Uint8Array,
    mime: SupportedImageMime,
    canCommit: () => boolean
  ): Promise<ImageIntentResult>;
  setOpen(controlId: string, open: boolean): void;
  /** Publish a refusal the way every other widget write does. */
  reject(reason: string): void;
}

/** The drawing node inside a picture control's content, if it holds one. */
export function contentControlDrawingId(control: OoxmlNode | null): string | undefined {
  if (!control || control.kind === 'textValue') return undefined;
  const visit = (node: OoxmlNode, depth: number): string | undefined => {
    if (node.kind === 'textValue' || depth > MAX_CONTENT_DEPTH) return undefined;
    if (node.kind === 'drawing') return node.id;
    if (node.localName === 'sdtPr') return undefined;
    for (const child of node.children) {
      const found = visit(child, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return visit(control, 0);
}

export function createContentControlPictureWidget(host: ContentControlPictureHost) {
  let picker: HTMLInputElement | null = null;
  let pickerControlId: string | null = null;
  let panel: HTMLElement | null = null;
  let stopDismiss: (() => void) | undefined;
  let stopPosition: (() => void) | undefined;
  let generation = 0;
  let destroyed = false;

  const closePicker = () => {
    generation++;
    stopDismiss?.();
    stopPosition?.();
    panel?.remove();
    panel = null;
    const open = pickerControlId;
    picker?.remove();
    picker = null;
    pickerControlId = null;
    if (open) {
      host.setOpen(open, false);
      if (!destroyed) host.layer.focus({ preventScroll: true });
    }
  };

  const drawingOf = (controlId: string): string | undefined =>
    contentControlDrawingId(host.find(controlId));

  const replace = async (
    controlId: string,
    bytes: Uint8Array,
    canCommit: () => boolean = () => true
  ): Promise<boolean> => {
    if (destroyed || !canCommit() || !host.allowed(controlId)) return false;
    if (bytes.byteLength > DEFAULT_IMAGE_RESOURCE_LIMITS.maxEncodedBytes) {
      host.reject('image-resource-limit');
      return false;
    }
    const drawingNodeId = drawingOf(controlId);
    if (!drawingNodeId) {
      host.reject('no-picture');
      return false;
    }
    const mime = sniffImageMime(bytes);
    if (!SUPPORTED.has(mime)) {
      host.reject('unsupported-image');
      return false;
    }
    const result = await host.replaceImage(
      drawingNodeId,
      bytes,
      mime as SupportedImageMime,
      () =>
        !destroyed &&
        canCommit() &&
        host.allowed(controlId) &&
        drawingOf(controlId) === drawingNodeId
    );
    if (!result.ok) {
      host.reject(result.detail ?? result.reason);
      return false;
    }
    return true;
  };

  return {
    drawingOf,
    replace,
    cancel: closePicker,
    /** Select the control's drawing, as a press on the picture would. */
    select(controlId: string): boolean {
      const drawingNodeId = drawingOf(controlId);
      const frame = drawingNodeId
        ? findDrawingOverlayFrameInLayout(host.layout(), drawingNodeId)
        : null;
      return frame ? host.selectDrawing(drawingNodeId!, frame.record.paragraphId) : false;
    },
    /**
     * The engine's own pick: a file input the widget press opens. The `cancel` event (or
     * the next press, or teardown) closes it without a write; a chosen file replaces.
     */
    pick(controlId: string): void {
      closePicker();
      if (destroyed || !host.allowed(controlId)) return;
      const current = generation;
      const active = () => !destroyed && generation === current;
      if (!drawingOf(controlId)) {
        host.reject('no-picture');
        return;
      }
      const input = host.document.createElement('input');
      input.type = 'file';
      input.accept = CONTENT_CONTROL_PICTURE_ACCEPT;
      input.className = 'docx-content-control-picture-picker';
      input.dataset.docxMarker = '';
      input.dataset.docxCcId = controlId;
      input.setAttribute('contenteditable', 'false');
      input.setAttribute('aria-hidden', 'true');
      input.tabIndex = -1;
      const t = textFormTranslate(host.translate);
      const menu = host.document.createElement('div');
      menu.className = 'docx-content-control-menu';
      menu.style.position = 'absolute';
      menu.style.zIndex = '20';
      menu.style.pointerEvents = 'auto';
      menu.dataset.docxCcId = controlId;
      menu.dataset.docxMarker = '';
      menu.setAttribute('role', 'dialog');
      menu.setAttribute('aria-label', t('contentControl.types.picture'));
      menu.setAttribute('contenteditable', 'false');
      menu.hidden = true;
      const error = host.document.createElement('div');
      error.className = 'docx-content-control-widget-error';
      error.setAttribute('role', 'alert');
      error.textContent = t('disabledReason.invalidValue');
      const cancel = host.document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = t('common.cancel');
      cancel.addEventListener('click', closePicker);
      menu.addEventListener('pointerdown', (event) => event.stopPropagation());
      menu.addEventListener('keydown', (event) => {
        contentControlPopupKeyDown(menu, event, closePicker);
        event.stopPropagation();
      });
      menu.append(error, cancel);
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file || !active()) return;
        input.value = '';
        input.disabled = true;
        void (async () => {
          let accepted = false;
          try {
            if (file.size > DEFAULT_IMAGE_RESOURCE_LIMITS.maxEncodedBytes)
              host.reject('image-resource-limit');
            else
              accepted = await replace(controlId, new Uint8Array(await file.arrayBuffer()), active);
          } catch {
            if (active()) host.reject('image-read-failed');
          }
          if (!active()) return;
          if (accepted) {
            closePicker();
            return;
          }
          input.disabled = false;
          input.className = 'docx-content-control-picture-input';
          input.removeAttribute('aria-hidden');
          input.tabIndex = 0;
          input.setAttribute('aria-label', t('contentControl.types.picture'));
          input.setAttribute('aria-invalid', 'true');
          menu.prepend(input);
          menu.hidden = false;
          const anchor = [
            ...host.layer.querySelectorAll<HTMLElement>('[data-docx-content-control]'),
          ]
            .find((node) => node.getAttribute('data-docx-content-control') === controlId)
            ?.querySelector<HTMLElement>('.docx-content-control-boundary');
          stopPosition?.();
          stopDismiss?.();
          if (anchor) stopPosition = observeContentControlPopup(menu, anchor);
          stopDismiss = armContentControlMenuDismiss(menu, closePicker);
          input.focus();
        })();
      });
      input.addEventListener('cancel', closePicker);
      host.layer.append(input);
      (host.layer.closest<HTMLElement>('.docx-editor__scroll-container') ?? host.layer).append(
        menu
      );
      panel = menu;
      picker = input;
      pickerControlId = controlId;
      host.setOpen(controlId, true);
      input.click();
    },
    destroy() {
      destroyed = true;
      closePicker();
    },
  };
}
