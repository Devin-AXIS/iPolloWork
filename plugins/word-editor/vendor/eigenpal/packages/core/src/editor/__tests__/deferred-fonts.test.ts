// Faces a resolver delivers after the first paint, end to end through `createDocxEditor`.
//
// - the immediate faces install without waiting for the late ones
// - `resolving` stays true, and the substitution notice stays quiet, until they land
// - the late faces then install, and their families count as covered
// - a late answer for a replaced document never installs

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { EditorFontError, FontSource } from '../../contracts/editor.ts';
import { deferFonts } from '../../layout/defer-fonts.ts';
import { sha256FontBytes } from '../../layout/index.ts';
import { defineFontResolver } from '../font-resolver.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { FontConfigurationFragment } from '../font-composition.ts';
import { docx } from './paginated-surface-fixtures.ts';

const bytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const source = (family: string): FontSource => ({
  request: { family, weight: 400, style: 'normal' },
  id: `deferred-${family}`,
  bytes,
  hash: sha256FontBytes(bytes),
  faceIndex: 0,
});
const runIn = (family: string, text: string) =>
  `<w:p><w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

async function until(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`never reached: ${label}`);
}

function lateAnswer() {
  let resolve!: (value: FontConfigurationFragment | undefined) => void;
  const promise = new Promise<FontConfigurationFragment | undefined>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const shaped = (editor: DocxEditorInstance) => editor.fontMeasurement().measurer === 'shaped';

describe('deferred font faces in the editor', () => {
  test('the immediate faces install first, the late ones on arrival', async () => {
    const late = lateAnswer();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Early', 'now') + runIn('Late', 'later')),
      fonts: () => ({ sources: [source('Early')], deferred: late.promise }),
    });
    try {
      await until(() => shaped(editor), 'immediate faces installed');
      expect(editor.fontMeasurement().resolving).toBe(true);
      expect(editor.snapshot().fontSubstitutions).toEqual([]);

      late.resolve({ sources: [source('Late')] });
      await until(() => !editor.fontMeasurement().resolving, 'late faces installed');
      expect(shaped(editor)).toBe(true);
      expect(editor.snapshot().fontSubstitutions).not.toContain('Late');
      expect(editor.snapshot().fontSubstitutions).not.toContain('Early');
    } finally {
      editor.destroy();
    }
  });

  test('a late answer that brings nothing ends the wait', async () => {
    const late = lateAnswer();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Early', 'now')),
      fonts: () => ({ sources: [source('Early')], deferred: late.promise }),
    });
    try {
      await until(() => shaped(editor), 'immediate faces installed');
      late.resolve(undefined);
      await until(() => !editor.fontMeasurement().resolving, 'wait ended');
      expect(shaped(editor)).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  test('a late answer for a replaced document never installs', async () => {
    const late = lateAnswer();
    let calls = 0;
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Late', 'first document')),
      fonts: () => {
        calls += 1;
        return calls === 1 ? { sources: [], deferred: late.promise } : undefined;
      },
    });
    try {
      await until(() => calls === 1, 'first resolution');
      editor.load(docx(runIn('Late', 'second document')));
      await until(() => calls === 2 && !editor.fontMeasurement().resolving, 'second settled');
      late.resolve({ sources: [source('Late')] });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(shaped(editor)).toBe(false);
      expect(editor.fontMeasurement().resolving).toBe(false);
    } finally {
      editor.destroy();
    }
  });

  test('a resolution still running when the document is replaced leaves the new one alone', async () => {
    // The first answer arrives only after the second document loaded, and its late faces
    // never arrive. The second document must not wait on them.
    let answerFirst!: (value: FontConfigurationFragment) => void;
    let calls = 0;
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Late', 'first document')),
      fonts: () => {
        calls += 1;
        if (calls > 1) return undefined;
        return new Promise<FontConfigurationFragment>((resolve) => (answerFirst = resolve));
      },
    });
    try {
      await until(() => calls === 1, 'first resolution started');
      editor.load(docx(runIn('Late', 'second document')));
      await until(() => calls === 2, 'second resolution started');
      answerFirst({ sources: [], deferred: new Promise(() => {}) });
      await until(() => !editor.fontMeasurement().resolving, 'second document settled');
    } finally {
      editor.destroy();
    }
  });

  test('a late promise that rejects ends the wait', async () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Early', 'now')),
      fonts: () => ({
        sources: [source('Early')],
        deferred: Promise.reject(new Error('host bug')),
      }),
    });
    try {
      await until(() => shaped(editor) && !editor.fontMeasurement().resolving, 'wait ended');
    } finally {
      editor.destroy();
    }
  });

  test('deferFonts as the only resolver still reports its failures', async () => {
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Late', 'text')),
      fonts: deferFonts(
        defineFontResolver(() => {
          throw new Error('offline');
        })
      ),
      onFontError: (error) => errors.push(error),
    });
    try {
      await until(() => errors.length > 0, 'failure reported');
      expect(String(errors[0]!.cause ?? errors[0]!.message)).toContain('offline');
    } finally {
      editor.destroy();
    }
  });

  test('setFonts with only background faces keeps waiting for them', async () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Late', 'text')),
    });
    try {
      await editor.setFonts(() => ({ sources: [], deferred: new Promise(() => {}) }));
      expect(editor.fontMeasurement().resolving).toBe(true);
    } finally {
      editor.destroy();
    }
  });
});
