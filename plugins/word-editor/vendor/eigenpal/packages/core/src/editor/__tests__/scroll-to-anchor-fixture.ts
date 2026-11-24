import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorConfig } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';

export const TARGET_ID = '1B4C77A2';
export const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

export function paragraph(paraId: string, runs: string): string {
  return `<w:p xmlns:w14="${W14}" w14:paraId="${paraId}">${runs}</w:p>`;
}

export const FILLER = Array.from(
  { length: 120 },
  (_, index) => `<w:p><w:r><w:t>Paragraph ${index}</w:t></w:r></w:p>`
).join('');

export function anchorDocx(target = paragraph(TARGET_ID, '<w:r><w:t>Target</w:t></w:r>')) {
  return docx(FILLER + target);
}

export function replacePart(bytes: Uint8Array, name: string, edit: (xml: string) => string) {
  const parts = unzipSync(bytes);
  parts[name] = strToU8(edit(strFromU8(parts[name]!)));
  return zipSync(parts);
}

/** State viewport metrics because happy-dom does not calculate CSS layout. */
export function mountAnchorEditor(
  bytes = anchorDocx(),
  config: Partial<DocxEditorConfig> = {},
  height = 600
) {
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  const host = document.createElement('div');
  scroller.append(host);
  document.body.append(scroller);
  Object.defineProperty(scroller, 'clientHeight', { value: height, configurable: true });
  Object.defineProperty(scroller, 'scrollHeight', { value: 100_000, configurable: true });
  let scrollCalls = 0;
  scroller.scrollTo = ((options: ScrollToOptions) => {
    scrollCalls += 1;
    scroller.scrollTop = options.top ?? 0;
  }) as HTMLElement['scrollTo'];
  const editor = createDocxEditor({ document: bytes, container: host, ...config });
  return {
    editor,
    host,
    scroller,
    scrollCalls: () => scrollCalls,
    destroy() {
      editor.destroy();
      scroller.remove();
      document.getSelection()?.removeAllRanges();
    },
  };
}
