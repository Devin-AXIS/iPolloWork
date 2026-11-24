import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { sha256FontBytes } from '../../layout/index.ts';
import type { FontResolutionRequest } from '../font-composition.ts';

const bytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const source = {
  request: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
  id: 'live-font',
  bytes,
  hash: sha256FontBytes(bytes),
  faceIndex: 0,
};
const catalog = ['Brand Sans', 'Brand Serif'];
const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});
const open = (fonts: Parameters<typeof createDocxEditor>[0]['fonts']) => {
  const editor = createDocxEditor({
    document: 'blank',
    container: document.createElement('div'),
    fonts,
  });
  editors.push(editor);
  return editor;
};
const pick = (editor: DocxEditorInstance, family: string) =>
  expect(
    editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: family }).ok
  ).toBe(true);
async function settled(editor: DocxEditorInstance) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 150; i++) {
    if (!editor.fontMeasurement().resolving) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('font resolution did not settle');
}
const fragment = (family: string) => ({
  supportedFamilies: catalog,
  sources: [source],
  substitutions: [{ from: { ...source.request, family }, to: source.request }],
});

test('a catalog-only resolver lists choices without font errors or loading their bytes', async () => {
  const errors: unknown[] = [];
  const calls: FontResolutionRequest[] = [];
  const editor = createDocxEditor({
    document: 'blank',
    container: document.createElement('div'),
    fonts: (request) => {
      calls.push(request);
      return { supportedFamilies: catalog };
    },
    onFontError: (error) => errors.push(error),
  });
  editors.push(editor);
  await settled(editor);
  expect(editor.getAvailableFonts()).toContain('Brand Serif');
  expect(calls).toHaveLength(1);
  expect(calls[0]!.families).not.toContain('Brand Serif');
  expect(errors).toEqual([]);
});

test('selecting an unloaded family resolves it in place and keeps typing marks and undo', async () => {
  const calls: FontResolutionRequest[] = [];
  let release!: () => void;
  const editor = open(async (request) => {
    calls.push(request);
    if (!request.families.includes('Brand Sans')) return { supportedFamilies: catalog };
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return fragment('Brand Sans');
  });
  await settled(editor);
  const surface = editor.surface!;
  pick(editor, 'Brand Sans');
  await new Promise((resolve) => setTimeout(resolve, 0));
  editor.exec({ type: 'insertText', text: 'Keep my edits' });
  const selection = surface.state().selection;
  expect(calls).toHaveLength(2);
  expect(calls[1]!.families).toEqual(['Brand Sans']);
  release();
  await settled(editor);
  expect(editor.surface).toBe(surface);
  expect(surface.state().selection).toEqual(selection);
  expect(editor.fontMeasurement().measurer).toBe('shaped');
  expect(editor.snapshot().formatting?.fontFamily).toBe('Brand Sans');
  expect(editor.snapshot().canUndo).toBe(true);
  surface.undo();
  expect(surface.session.bodyText()).toBe('');
  expect(calls).toHaveLength(2);
});

test('a second family selected during a download is queued and both remain usable', async () => {
  const calls: FontResolutionRequest[] = [];
  let release!: () => void;
  const editor = open(async (request) => {
    calls.push(request);
    if (request.families.includes('Brand Sans')) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return fragment('Brand Sans');
    }
    if (request.families.includes('Brand Serif')) return fragment('Brand Serif');
    return { supportedFamilies: catalog };
  });
  await settled(editor);
  pick(editor, 'Brand Sans');
  await new Promise((resolve) => setTimeout(resolve, 0));
  pick(editor, 'Brand Serif');
  release();
  await settled(editor);
  expect(calls).toHaveLength(3);
  expect(calls[2]!.families).toContain('Brand Serif');
  expect(calls[2]!.resolvedFaces?.some((face) => face.family.toLowerCase() === 'brand sans')).toBe(
    true
  );
  expect(editor.snapshot().formatting?.fontFamily).toBe('Brand Serif');
  pick(editor, 'Brand Sans');
  await settled(editor);
  expect(calls).toHaveLength(3);
});

test('a failed family does not retry on every keystroke', async () => {
  let calls = 0;
  const editor = open((request) => {
    calls++;
    return request.families.includes('Brand Sans') ? undefined : { supportedFamilies: catalog };
  });
  await settled(editor);
  pick(editor, 'Brand Sans');
  await settled(editor);
  editor.exec({ type: 'insertText', text: 'a' });
  editor.exec({ type: 'insertText', text: 'b' });
  await settled(editor);
  expect(calls).toBe(2);
});

test('a document load supersedes a pending selection download', async () => {
  let release!: () => void;
  let gated = false;
  const editor = open(async (request) => {
    if (!request.families.includes('Brand Sans')) return { supportedFamilies: catalog };
    if (!gated) {
      gated = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return fragment('Brand Sans');
  });
  await settled(editor);
  pick(editor, 'Brand Sans');
  await new Promise((resolve) => setTimeout(resolve, 0));
  editor.load('blank');
  const replacement = editor.surface;
  release();
  await settled(editor);
  expect(editor.surface).toBe(replacement);
  expect(editor.snapshot().formatting?.fontFamily).toBe('Calibri');
  expect(editor.fontMeasurement().measurer).toBe('fixed');
  pick(editor, 'Brand Sans');
  await settled(editor);
  expect(editor.surface).toBe(replacement);
  expect(editor.fontMeasurement().measurer).toBe('shaped');
});
