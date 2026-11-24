import { isApplePlatform } from '@docx-editor.dev/i18n';
import type { Editor, EditorSnapshot } from '../contracts/editor.ts';
import type { ReviewDisplayMode } from '../layout/revision-projection.ts';
import {
  runChromeExport,
  type ChromeExportHandlers,
  type ChromePrintSettings,
} from './chrome-export.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';

/** How long the hidden frame may take to load the PDF before printing fails. */
const PRINT_FRAME_TIMEOUT_MS = 15_000;

/** Why the browser could not print the converted PDF. @public */
export type ChromePrintErrorCode =
  'pdf-viewer-unavailable' | 'pdf-load-failed' | 'print-refused' | 'print-ended';

/**
 * The browser could not print the converted PDF. The PDF at `ChromePrintJob.url` is still
 * available, so the user can open it and print from the PDF viewer.
 * @public
 */
export class ChromePrintError extends Error {
  /** Why the browser could not print. */
  readonly code: ChromePrintErrorCode;
  constructor(code: ChromePrintErrorCode) {
    super(
      code === 'pdf-viewer-unavailable'
        ? 'This browser cannot display PDF files in the page.'
        : code === 'pdf-load-failed'
          ? 'The PDF did not load for printing.'
          : code === 'print-refused'
            ? 'The browser refused to print the PDF from the page.'
            : 'The print job has ended.'
    );
    this.code = code;
    this.name = 'ChromePrintError';
  }
}

/**
 * True for the print shortcut: Cmd+P on Apple platforms, Ctrl+P elsewhere. On macOS,
 * Ctrl+P moves the caret to the previous line, so it is not a print shortcut there. The P
 * key matches by `code` too when it types no Latin letter, as on Cyrillic or Hebrew layouts.
 * @public
 */
export function isChromePrintShortcut(event: KeyboardEvent): boolean {
  if (event.altKey || event.shiftKey || typeof event.key !== 'string') return false;
  const key = event.key.toLowerCase();
  // The physical P key counts only when it types no Latin letter. On Dvorak it types "l",
  // and Ctrl+L belongs to that letter.
  if (key !== 'p' && (event.code !== 'KeyP' || /^[a-z]$/.test(key))) return false;
  return isApplePlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** Options for `ChromePrintJob.print`. @public */
export interface ChromePrintOptions {
  /**
   * Runs after the PDF loads and before the print dialog opens. Close any modal dialog
   * here: a modal dialog makes the rest of the page, including the print frame, inert.
   */
  readonly beforePrint?: () => void | Promise<void>;
}

/**
 * A converted PDF, ready for the browser print dialog.
 * Call `dispose()` when the job ends: it removes the print frame and revokes `url`.
 * @public
 */
export interface ChromePrintJob {
  /** An object URL for the PDF. It stays valid until `dispose()`. */
  readonly url: string;
  /**
   * Opens the browser print dialog for the PDF from a hidden frame.
   * Rejects with `ChromePrintError` when the browser has no PDF viewer, the frame cannot
   * load the PDF, or the job has ended. A browser without a PDF viewer would download the
   * PDF instead of loading it, so the frame is not created in that case.
   */
  print(options?: ChromePrintOptions): Promise<void>;
  /** Removes the print frame and revokes `url`. Later `print()` calls reject. */
  dispose(): void;
}

/** Print settings with every choice made. @public */
export type ResolvedChromePrintSettings = Required<ChromePrintSettings>;

/**
 * The display modes a print form offers, in Review menu order, with their label keys.
 * @public
 */
export const CHROME_PRINT_DISPLAY_MODES: readonly {
  readonly mode: ReviewDisplayMode;
  readonly labelKey:
    'review.simpleMarkup' | 'review.allMarkup' | 'review.noMarkup' | 'review.original';
}[] = Object.freeze([
  { mode: 'simple-markup', labelKey: 'review.simpleMarkup' },
  { mode: 'all-markup', labelKey: 'review.allMarkup' },
  { mode: 'proposed', labelKey: 'review.noMarkup' },
  { mode: 'original', labelKey: 'review.original' },
] as const);

/**
 * The settings a print form starts with: the editor's current display mode, with comments
 * shown, as the PDF converter does by default. All Markup prints comments in a pane beside
 * each page. The other modes print them as PDF annotations on the commented text.
 * @public
 */
export function initialChromePrintSettings(
  snapshot: Pick<EditorSnapshot, 'reviewDisplayMode'> | null | undefined
): ResolvedChromePrintSettings {
  return { displayMode: snapshot?.reviewDisplayMode ?? 'proposed', comments: true };
}

/**
 * Saves the current document, converts it with the configured PDF handler, and prepares
 * the result for printing. Uses the same handler and checks as File > Export > PDF, so a
 * missing handler rejects with `ChromeExportError` before the document is saved.
 * Saving commits pending form input and can refresh field results with an undo step.
 * `container` receives the hidden print frame. For an editor inside a modal dialog,
 * pass an element inside that dialog. `settings` carries the user's print settings, such
 * as the display mode and whether comments print. Omitted settings keep the current view.
 * @public
 */
export async function runChromePrint(
  editor: Pick<Editor, 'save'> & Partial<Pick<DocxEditorInstance, 'snapshot' | 'getReviewAuthors'>>,
  handlers: ChromeExportHandlers = {},
  container: Document | Element = globalThis.document,
  settings: ChromePrintSettings = {}
): Promise<ChromePrintJob> {
  const { bytes, mimeType } = await runChromeExport(editor, 'pdf', handlers, settings);
  return createPrintJob(bytes, mimeType, container);
}

function createPrintJob(bytes: Uint8Array, mimeType: string, container: Document | Element) {
  const host = container.nodeType === 9 ? (container as Document).body : (container as Element);
  if (!host) throw new TypeError('Printing requires a document body.');
  const ownerDocument = host.ownerDocument;
  const view = ownerDocument.defaultView;
  if (!view) throw new TypeError('Printing requires a document with a window.');
  // The Blob copies the bytes. Only bytes in shared memory need a copy first, because a
  // Blob refuses them.
  const part = (
    bytes.buffer instanceof ArrayBuffer ? bytes : bytes.slice()
  ) as Uint8Array<ArrayBuffer>;
  const url = view.URL.createObjectURL(new view.Blob([part], { type: mimeType }));
  let frame: HTMLIFrameElement | null = null;
  let loaded: Promise<Window> | null = null;
  let timer: number | undefined;
  let rejectLoad: ((reason: ChromePrintError) => void) | null = null;
  let disposed = false;

  /** Ends the current load, if any, with `reason`, and removes its frame. */
  const removeFrame = (reason: ChromePrintError) => {
    view.clearTimeout(timer);
    rejectLoad?.(reason);
    rejectLoad = null;
    frame?.remove();
    frame = null;
    loaded = null;
  };

  const load = (): Promise<Window> => {
    if (loaded) return loaded;
    const element = ownerDocument.createElement('iframe');
    frame = element;
    // Browsers skip loading and printing a frame with `display: none`, so the frame keeps
    // a layout box and stays invisible and out of the accessibility tree instead.
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('tabindex', '-1');
    element.setAttribute('data-docx-print-frame', '');
    element.style.cssText =
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    loaded = new Promise<Window>((resolve, reject) => {
      rejectLoad = reject;
      // A later print() starts over with a new frame instead of this failed load.
      timer = view.setTimeout(
        () => removeFrame(new ChromePrintError('pdf-load-failed')),
        PRINT_FRAME_TIMEOUT_MS
      );
      element.addEventListener(
        'load',
        () => {
          view.clearTimeout(timer);
          if (!element.contentWindow) {
            removeFrame(new ChromePrintError('pdf-load-failed'));
            return;
          }
          rejectLoad = null;
          resolve(element.contentWindow);
        },
        { once: true }
      );
    });
    // Mark the promise handled: a load that ends after dispose() has no caller left.
    loaded.catch(() => undefined);
    element.src = url;
    // Inside the editor, not always the body: an editor in a host's modal dialog would
    // otherwise get an inert frame, outside that dialog.
    host.append(element);
    return loaded;
  };

  const job: ChromePrintJob = {
    url,
    async print(options = {}) {
      if (disposed) throw new ChromePrintError('print-ended');
      if (view.navigator.pdfViewerEnabled === false) {
        throw new ChromePrintError('pdf-viewer-unavailable');
      }
      const target = await load();
      if (disposed) throw new ChromePrintError('print-ended');
      await options.beforePrint?.();
      if (disposed) throw new ChromePrintError('print-ended');
      // The frame takes focus so its PDF viewer prints. Focus returns afterward, because
      // nothing else moves it out of an invisible frame.
      const previous = ownerDocument.activeElement as HTMLElement | null;
      try {
        target.focus();
        target.print();
      } catch {
        // A browser can deny access to its PDF viewer's window.
        throw new ChromePrintError('print-refused');
      } finally {
        if (previous?.isConnected) previous.focus({ preventScroll: true });
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeFrame(new ChromePrintError('print-ended'));
      view.URL.revokeObjectURL(url);
    },
  };
  return job;
}
