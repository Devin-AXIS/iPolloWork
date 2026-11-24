import { beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  initializeHarfBuzz,
  HarfBuzzShapingError,
  linesOf,
  sha256FontBytes,
} from '../../layout/index.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { EditorFontError, FontConfiguration } from '../../contracts/editor.ts';

beforeAll(async () => {
  await initializeHarfBuzz();
});
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function documentBytes(text: string, family = 'DejaVu Sans') {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body><w:p w14:paraId="1A2B3C4D" w14:textId="1A2B3C4D"><w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/><w:sz w:val="28"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}
function fonts(): FontConfiguration {
  // A public, already-repository-owned valid face; harmless trailing padding crosses
  // the real execution cap. No scripted shaper or private/system font is substituted.
  const fixture = readFileSync(
    new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
  );
  const bytes = new Uint8Array(16 * 1024 * 1024 + 1);
  bytes.set(fixture);
  return {
    epoch: 1,
    maxFontBytes: 64 * 1024 * 1024,
    sources: [
      {
        request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
        id: 'public-padded-dejavu',
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      },
    ],
    defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 28 },
  };
}
async function waitFor(check: () => boolean) {
  for (let n = 0; n < 200; n++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error('Real editor callback did not reach the required lifecycle state');
}
const executionRefusal = (error: EditorFontError) =>
  error.cause instanceof HarfBuzzShapingError && error.cause.code === 'fontOverLimit';

test('real facades report locally and preserve source XML and fallback geometry', async () => {
  const configuration = fonts(),
    source = documentBytes('Public lifecycle text');
  const reports: EditorFontError[][] = [[], []];
  const events: unknown[][] = [[], []];
  const containers = [document.createElement('div'), document.createElement('div')];
  containers.forEach((container) => document.body.append(container));
  const editors = containers.map((container, i) =>
    createDocxEditor({
      container,
      document: source,
      fonts: configuration,
      onFontError: (error) => reports[i]!.push(error),
    })
  );
  editors.forEach((editor, i) => editor.on('error', (error) => events[i]!.push(error)));
  try {
    await waitFor(() =>
      editors.every(
        (editor, i) => !editor.fontMeasurement().resolving && reports[i]!.some(executionRefusal)
      )
    );
    expect(reports.map((rows) => rows.filter(executionRefusal).length)).toEqual([1, 1]);
    const geometry = (editor: DocxEditorInstance) =>
      linesOf(editor.surface!.layout()).map((line) => ({
        box: line.box,
        spans: line.spans.map((span) => ({ text: span.text, range: span.range, box: span.box })),
      }));
    expect(geometry(editors[0]!)).toEqual(geometry(editors[1]!));
    expect(events.map((rows) => rows.length)).toEqual([1, 1]);
    expect(events[0]![0]).toBe(reports[0]![0]);
    expect(events[1]![0]).toBe(reports[1]![0]);
    expect(reports[0]![0]).not.toBe(reports[1]![0]);
    for (const editor of editors) {
      const saved = unzipSync(new Uint8Array(await editor.save()));
      expect(strFromU8(saved['word/document.xml']!)).toBe(
        strFromU8(unzipSync(source)['word/document.xml']!)
      );
      editor.relayout({ sync: true });
    }
    expect(reports.map((rows) => rows.filter(executionRefusal).length)).toEqual([1, 1]);
  } finally {
    editors.forEach((editor) => editor.destroy());
    containers.forEach((container) => container.remove());
  }
}, 10000);

test('throwing actual host callback still emits the current refusal once and keeps the editor usable', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  let count = 0;
  const errors: unknown[] = [];
  const fontDiagnostics: unknown[] = [];
  const editor = createDocxEditor({
    container,
    document: documentBytes('Throw public text'),
    fonts: fonts(),
    onFontError: (error) => {
      if (executionRefusal(error)) {
        count++;
        throw Error('Public host reporter failure');
      }
    },
  });
  editor.on('error', (error) => errors.push(error));
  editor.on('diagnostic', (diagnostic) => {
    if (diagnostic.kind === 'font.failed') fontDiagnostics.push(diagnostic);
  });
  try {
    await waitFor(() => count > 0 && !editor.fontMeasurement().resolving);
    expect(count).toBe(1);
    expect(errors).toHaveLength(1);
    expect(fontDiagnostics).toHaveLength(1);
    expect(executionRefusal(errors[0] as EditorFontError)).toBe(true);
    expect(container.textContent).toContain('Throw public text');
    editor.relayout({ sync: true });
    expect(count).toBe(1);
    const saved = unzipSync(new Uint8Array(await editor.save()));
    expect(strFromU8(saved['word/document.xml']!)).toContain('Throw public text');
  } finally {
    editor.destroy();
    container.remove();
  }
}, 10000);

test('destroy inside the actual font-error callback cannot revive a surface or emit stale errors', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  let refusal: EditorFontError | undefined;
  const errors: unknown[] = [];
  const fontDiagnostics: unknown[] = [];
  const editor: DocxEditorInstance = createDocxEditor({
    container,
    document: documentBytes('Destroy public text'),
    fonts: fonts(),
    onFontError: (error) => {
      if (executionRefusal(error) && !refusal) {
        refusal = error;
        editor.destroy();
      }
    },
  });
  const unsubscribe = editor.on('error', (error) => errors.push(error));
  editor.on('diagnostic', (diagnostic) => {
    if (diagnostic.kind === 'font.failed') fontDiagnostics.push(diagnostic);
  });
  try {
    await waitFor(() => refusal !== undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.surface).toBeNull();
    expect(container.querySelector('.docx-line')).toBeNull();
    expect(errors).not.toContain(refusal);
    expect(fontDiagnostics).toEqual([]);
  } finally {
    unsubscribe();
    editor.destroy();
    container.remove();
  }
}, 10000);

test('load inside the actual font-error callback does not publish the old error into the new document', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const replacement = documentBytes('Replacement public text', 'Unresolved Public Replacement');
  let refusal: EditorFontError | undefined;
  const errors: unknown[] = [];
  const fontReports: { error: EditorFontError; bodyText: string }[] = [];
  let reportedError: EditorFontError | undefined;
  const fontDiagnostics: { owner: EditorFontError | undefined; bodyText: string; code: string }[] =
    [];
  const editor: DocxEditorInstance = createDocxEditor({
    container,
    document: documentBytes('Old public text'),
    fonts: fonts(),
    onFontError: (error) => {
      reportedError = error;
      fontReports.push({ error, bodyText: editor.surface?.session.bodyText() ?? '' });
      if (executionRefusal(error) && !refusal) {
        refusal = error;
        editor.load(replacement);
      }
    },
  });
  const unsubscribe = editor.on('error', (error) => errors.push(error));
  editor.on('diagnostic', (diagnostic) => {
    if (diagnostic.kind === 'font.failed') {
      fontDiagnostics.push({
        owner: reportedError,
        bodyText: editor.surface?.session.bodyText() ?? '',
        code: diagnostic.code,
      });
    }
  });
  try {
    await waitFor(
      () =>
        refusal !== undefined &&
        container.textContent!.includes('Replacement public text') &&
        !editor.fontMeasurement().resolving
    );
    expect(container.textContent).not.toContain('Old public text');
    expect(errors).not.toContain(refusal);
    const replacementReports = fontReports.filter((row) => row.error !== refusal);
    expect(fontReports[0]!.error).toBe(refusal);
    expect(fontReports[0]!.bodyText).toBe('Old public text');
    expect(replacementReports).toHaveLength(1);
    const replacementReport = replacementReports[0]!;
    expect(replacementReport.bodyText).toBe('Replacement public text');
    // The new measurement owner also measures the configured padded default face.
    // Its current refusal must stay distinct from the superseded owner's error.
    expect(executionRefusal(replacementReport.error)).toBe(true);
    expect(replacementReport.error.code).toBe('overLimit');
    expect(replacementReport.error.request).toEqual({
      family: 'DejaVu Sans',
      weight: 400,
      style: 'normal',
    });
    expect(replacementReport.error).not.toBe(refusal);
    expect(replacementReport.error.cause).not.toBe(refusal!.cause);
    expect(errors).toEqual([replacementReport.error]);
    expect(fontDiagnostics.filter((row) => row.owner === refusal)).toEqual([]);
    expect(fontDiagnostics).toEqual([
      {
        owner: replacementReport.error,
        bodyText: 'Replacement public text',
        code: 'font.size-limit',
      },
    ]);
    const saved = unzipSync(new Uint8Array(await editor.save()));
    expect(strFromU8(saved['word/document.xml']!)).toContain('Replacement public text');
    expect(strFromU8(saved['word/document.xml']!)).not.toContain('Old public text');
  } finally {
    unsubscribe();
    editor.destroy();
    container.remove();
  }
}, 10000);
