import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createLayoutShaping, disposeLayoutShaping, sha256FontBytes } from '../../layout/index.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';

const bytes = new Uint8Array(16 * 2 ** 20 + 1);
bytes.set(
  new Uint8Array(
    readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  )
);
const family = 'Public Host Execution Face';
const fonts = {
  epoch: 1,
  maxFontBytes: 20 * 2 ** 20,
  sources: [
    {
      request: { family, weight: 400, style: 'normal' as const },
      id: 'public-host-execution-face',
      bytes,
      hash: sha256FontBytes(bytes),
      faceIndex: 0,
    },
  ],
  defaultFont: { family, sizeHalfPoints: 24 },
};
const source = docx(
  `<w:p><w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/><w:sz w:val="24"/></w:rPr><w:t>office</w:t></w:r></w:p>`
);

async function settled(editor: DocxEditorInstance) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (!editor.fontMeasurement().resolving && editor.fontMeasurement().producer) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Public host font resolution did not settle');
}

test('the mounted host samples an explicit execution policy before its async font resolver', async () => {
  const original = source.slice();
  const execution = { maxFontBytes: 20 * 2 ** 20 };
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: source,
    fontShaping: execution,
    fonts: async () => {
      requested = true;
      await waiting;
      return fonts;
    },
  });
  const reference = await createLayoutShaping(fonts, undefined, { maxFontBytes: 20 * 2 ** 20 });
  const defaults = await createLayoutShaping(fonts);
  try {
    execution.maxFontBytes = 1;
    release();
    await settled(editor);
    expect(requested).toBe(true);
    expect(editor.fontMeasurement().producer).toContain(reference.operation.shapingHash);
    expect(editor.fontMeasurement().producer).not.toContain(defaults.operation.shapingHash);
    const paragraphs = editor
      .surface!.layout()
      .pages.flatMap((page) => page.fragments)
      .filter((fragment) => fragment.kind === 'paragraph');
    expect(
      paragraphs
        .flatMap((paragraph) => paragraph.lines)
        .flatMap((line) => line.spans)
        .map((span) => span.text)
        .join('')
    ).toBe('office');
    expect(source).toEqual(original);
  } finally {
    release();
    editor.destroy();
    disposeLayoutShaping(reference);
    disposeLayoutShaping(defaults);
  }
}, 10_000);
