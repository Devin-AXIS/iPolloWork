import type { DocxEditorInstance } from './docx-editor-types.ts';
import type { ReviewDisplayMode } from '../layout/revision-projection.ts';
import {
  DEFAULT_REVISION_MARKUP,
  type ResolvedRevisionMarkup,
} from '../contracts/revision-markup.ts';
import type { Editor } from '../contracts/editor.ts';

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

/** File menu conversion formats. @public */
export type ChromeExportFormat = 'markdown' | 'pdf';

/** Viewer settings captured before PDF conversion. @public */
export interface ChromeExportView {
  readonly displayMode: ReviewDisplayMode;
  readonly revisionMarkup: ResolvedRevisionMarkup;
  /** Stable session slots, including gaps left by removed authors. */
  readonly revisionAuthorSlots?: Readonly<Record<string, number>>;
  /**
   * Whether the PDF shows comments. Set from the print settings the user chose. Pass it to
   * `exportPdf` as `comments`. Absent means the converter default, which shows comments.
   */
  readonly comments?: boolean;
}

/**
 * Settings the user picks before printing. Each omitted setting keeps the editor's current
 * view: the review display mode, and comments shown.
 * @public
 */
export interface ChromePrintSettings {
  /** Which markup prints, as on the Review tab. */
  readonly displayMode?: ReviewDisplayMode;
  /**
   * Whether the PDF shows comments. All Markup prints them in a pane beside each page; the
   * other modes print them as annotations on the commented text.
   */
  readonly comments?: boolean;
}

/**
 * Conversion handlers for File > Export. Install the corresponding converter package.
 * Use `exportMarkdown` for Markdown. PDF requires `exportPdf` on a Node.js server.
 * Browser hosts supply a PDF handler that calls that server after the user selects Export.
 * @public
 */
export interface ChromeExportHandlers {
  /** Returns continuous document Markdown. Page output is not downloaded. */
  readonly markdown?: (source: Uint8Array) => Promise<{ readonly markdown: string }>;
  /** Returns PDF bytes from `@docx-editor.dev/docx-to-pdf` on Node.js. */
  readonly pdf?: (
    source: Uint8Array,
    view?: ChromeExportView
  ) => Promise<{ readonly bytes: Uint8Array }>;
}

/** Download data from a completed conversion. @public */
export interface ChromeExportResult {
  readonly bytes: Uint8Array;
  readonly extension: 'md' | 'pdf';
  readonly mimeType: string;
}

/** An export has no configured converter. @public */
export class ChromeExportError extends Error {
  readonly code = 'missing-exporter';
  constructor(readonly format: ChromeExportFormat) {
    super(
      `Install @docx-editor.dev/docx-to-${format} and configure menu.exporters.${format}.` +
        (format === 'pdf' ? ' PDF conversion requires a Node.js server.' : '')
    );
    this.name = 'ChromeExportError';
  }
}

/**
 * Saves the current document and converts those bytes through the configured handler.
 * Missing handlers fail before saving. Conversion never changes the editor document.
 * `settings` overrides the captured view for PDF conversion, such as print settings.
 * @public
 */
export async function runChromeExport(
  editor: Pick<Editor, 'save'> & Partial<Pick<DocxEditorInstance, 'snapshot' | 'getReviewAuthors'>>,
  format: ChromeExportFormat,
  handlers: ChromeExportHandlers = {},
  settings: ChromePrintSettings = {}
): Promise<ChromeExportResult> {
  if (format === 'markdown') {
    if (!handlers.markdown) throw new ChromeExportError(format);
    const result = await handlers.markdown(new Uint8Array(await editor.save()));
    if (typeof result?.markdown !== 'string')
      throw new TypeError('The Markdown converter returned no Markdown.');
    return {
      bytes: new TextEncoder().encode(result.markdown),
      extension: 'md',
      mimeType: 'text/markdown;charset=utf-8',
    };
  }
  if (format !== 'pdf') throw new TypeError('Unsupported export format.');
  if (!handlers.pdf) throw new ChromeExportError(format);
  const snapshot = editor.snapshot?.();
  const chosen = settings.displayMode !== undefined || settings.comments !== undefined;
  // Without a snapshot, explicit settings still reach the handler, with default markup.
  const view =
    snapshot || chosen
      ? {
          displayMode: settings.displayMode ?? snapshot?.reviewDisplayMode ?? 'proposed',
          ...(settings.comments === undefined ? {} : { comments: settings.comments }),
          revisionMarkup: snapshot?.revisionMarkup ?? DEFAULT_REVISION_MARKUP,
          ...(editor.getReviewAuthors
            ? {
                revisionAuthorSlots: Object.freeze(
                  Object.fromEntries(
                    editor.getReviewAuthors().map(({ author, slot }) => [author, slot])
                  )
                ),
              }
            : {}),
        }
      : undefined;
  const result = await handlers.pdf(new Uint8Array(await editor.save()), view);
  if (!(result?.bytes instanceof Uint8Array) || result.bytes.length === 0) {
    throw new TypeError('The PDF converter returned no PDF bytes.');
  }
  if (!PDF_HEADER.every((byte, index) => result.bytes[index] === byte)) {
    throw new TypeError('The PDF converter returned a file without a PDF header.');
  }
  return { bytes: result.bytes, extension: 'pdf', mimeType: 'application/pdf' };
}
