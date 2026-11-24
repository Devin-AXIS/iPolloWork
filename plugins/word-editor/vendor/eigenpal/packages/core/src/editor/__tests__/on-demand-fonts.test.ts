// `config.fonts` as a FUNCTION: resolve once the document's needs are known.
//
// The value form is answered before the file is open, so it loads the same bytes whatever
// the document turns out to say. The resolver form is called after the parse, with the
// families the file declares, and only what it returns is loaded. What these pin down end
// to end through `createDocxEditor`:
//
// - the resolver sees the families the document actually names, and its default face
// - a resolver returning nothing is a normal answer: no error, no shaped measurer
// - what it DOES return reaches shaped measurement exactly like a static configuration
// - the families it supplied are reported as covered, not as rendering in a substitute
// - a resolver that throws degrades to fixed with a typed report; the load never blocks
// - a superseded load never installs the previous document's answer
// - the file-declared family list is capped before it reaches the resolver

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { EditorFontError } from '../../contracts/editor.ts';
import { sha256FontBytes } from '../../layout/index.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { MAX_RESOLVER_FAMILIES, type FontResolutionRequest } from '../font-composition.ts';
import { composeFontOrigins, defineFontResolver } from '../font-resolver.ts';
import { docx } from './paginated-surface-fixtures.ts';

const regularBytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);

/** A paragraph whose runs name `family`, so it lands in `documentFonts()`. */
const runIn = (family: string, text: string) =>
  `<w:p><w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

const dejaVuFragment = {
  sources: [
    {
      request: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
      id: 'on-demand-dejavu',
      bytes: regularBytes,
      hash: sha256FontBytes(regularBytes),
      faceIndex: 0,
    },
  ],
};

/** Wait until shaped resolution lands (or the editor settles on fixed). */
async function fontsSettled(editor: DocxEditorInstance): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const measurement = editor.fontMeasurement();
    if (!measurement.resolving && (measurement.measurer === 'shaped' || attempt > 20)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('font resolution never settled');
}

describe('on-demand font resolution', () => {
  test('the resolver is told the families the document declares, and the default face', async () => {
    const seen: FontResolutionRequest[] = [];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Garamond', 'one') + runIn('Consolas', 'two')),
      fonts: (request) => {
        seen.push(request);
        return undefined;
      },
    });
    await fontsSettled(editor);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.families).toContain('Garamond');
    expect(seen[0]!.families).toContain('Consolas');
    expect(seen[0]!.defaultFamily).toBe('Calibri');
    editor.destroy();
  });

  test('the resolver also hears the face a w:sym names, after the declared families', async () => {
    // `layout/symbol-run.ts` keeps an unmapped private-use code point in the authored face,
    // which paints as a tofu box in any other. An app can only supply Wingdings if it is
    // told the file wants it. The document still DECLARES only Garamond: a symbol face is
    // not an `w:rFonts` declaration, and the notice reports neither.
    const seen: FontResolutionRequest[] = [];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(
        '<w:p><w:r><w:rPr><w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/></w:rPr>' +
          '<w:t>bullet</w:t><w:sym w:font="Wingdings" w:char="F0A8"/></w:r></w:p>'
      ),
      fonts: (request) => {
        seen.push(request);
        // Answer it, the way an app that owns Wingdings would.
        return {
          sources: [
            {
              request: { family: 'Wingdings', weight: 400, style: 'normal' as const },
              id: 'on-demand-wingdings',
              bytes: regularBytes,
              hash: sha256FontBytes(regularBytes),
              faceIndex: 0,
            },
          ],
        };
      },
    });
    await fontsSettled(editor);
    // Garamond is a serif family, so its serif fallback is requested after the document's own.
    expect(seen[0]!.families).toEqual(['Garamond', 'Wingdings', 'Times New Roman']);
    expect(editor.snapshot().fontSubstitutions).not.toContain('Wingdings');
    expect(editor.getDocumentFonts()).toEqual(['Garamond']);
    editor.destroy();
  });

  test('resolving to nothing is a normal answer: fixed measurer, no error', async () => {
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Garamond', 'nothing covered')),
      fonts: () => undefined,
      onFontError: (error) => errors.push(error),
    });
    await fontsSettled(editor);
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    expect(errors).toHaveLength(0);
    expect(editor.exec({ type: 'insertText', text: 'X' })).toEqual({ ok: true, changed: true });
    editor.destroy();
  });

  test('a completely empty fragment is the same normal answer as undefined', async () => {
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Garamond', 'nothing covered')),
      fonts: () => ({ sources: [], substitutions: [], failures: [] }),
      onFontError: (error) => errors.push(error),
    });
    await fontsSettled(editor);
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    expect(errors).toHaveLength(0);
    editor.destroy();
  });

  test('a fragment with failures still reports that no usable source survived', async () => {
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Garamond', 'failed source')),
      fonts: (request) =>
        composeFontOrigins(
          [
            defineFontResolver(async () => ({
              sources: [],
              substitutions: [],
              failures: [{ family: 'Garamond', diagnostic: 'offline' }],
            })),
          ],
          request
        ),
      onFontError: (error) => errors.push(error),
    });
    await fontsSettled(editor);
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('missing');
    editor.destroy();
  });

  test('substitutions without usable sources still report missing', async () => {
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Garamond', 'unusable substitution')),
      fonts: () => ({
        sources: [],
        substitutions: [
          {
            from: { family: 'Garamond', weight: 400, style: 'normal' },
            to: { family: 'Unavailable Substitute', weight: 400, style: 'normal' },
          },
        ],
        failures: [],
      }),
      onFontError: (error) => errors.push(error),
    });
    await fontsSettled(editor);
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('missing');
    editor.destroy();
  });

  test('a rejected substitute target still reports the affected family', async () => {
    const malformed = new Uint8Array(256).fill(0x42);
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as { getContext: unknown }).getContext = () => ({
      font: '',
      measureText: (text: string) => ({ width: text.length * 10 }),
    });
    let editor: DocxEditorInstance | undefined;
    try {
      editor = createDocxEditor({
        container: document.createElement('div'),
        document: docx(runIn('Definitely Missing Typeface', 'fallback')),
        fonts: () => ({
          sources: [
            {
              request: { family: 'Broken Target', weight: 400, style: 'normal' },
              id: 'broken-substitute-target',
              bytes: malformed,
              hash: sha256FontBytes(malformed),
              faceIndex: 0,
            },
          ],
          substitutions: [
            {
              from: { family: 'Definitely Missing Typeface', weight: 400, style: 'normal' },
              to: { family: 'Broken Target', weight: 400, style: 'normal' },
            },
          ],
        }),
      });
      await fontsSettled(editor);
      expect(editor.snapshot().fontSubstitutions ?? []).toContain('Definitely Missing Typeface');
    } finally {
      editor?.destroy();
      (HTMLCanvasElement.prototype as { getContext: unknown }).getContext = originalGetContext;
    }
  });

  test('what the resolver returns reaches shaped measurement', async () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('DejaVu Sans', 'shaped')),
      fonts: async (request) =>
        request.families.includes('DejaVu Sans') ? dejaVuFragment : undefined,
    });
    await fontsSettled(editor);
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    editor.destroy();
  });

  test('a resolved family reads as covered, not as rendering in a substitute', async () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('DejaVu Sans', 'covered')),
      fonts: () => dejaVuFragment,
    });
    await fontsSettled(editor);
    // The capability reads describe what the resolver supplied, not an empty catalog:
    // both are computed from `config.fonts`, which for the function form is only known
    // once a document has been through it.
    expect(editor.getAvailableFonts()).toContain('DejaVu Sans');
    expect(editor.snapshot().fontSubstitutions ?? []).not.toContain('DejaVu Sans');
    editor.destroy();
  });

  test('a configured redirect counts as available, not as a substitution to warn about', async () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Brand Sans', 'substituted')),
      fonts: () => ({
        ...dejaVuFragment,
        substitutions: [
          {
            from: { family: 'Brand Sans', weight: 400, style: 'normal' },
            to: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
          },
        ],
      }),
    });
    await fontsSettled(editor);
    // The notice reports what is UNAVAILABLE. A resolver that deliberately answers this
    // family has made it available: the run measures and paints on the face the app chose,
    // so telling the user the font "isn't available" would be the opposite of the truth.
    expect(editor.snapshot().fontSubstitutions ?? []).not.toContain('Brand Sans');
    editor.destroy();
  });

  test('a resolver that throws degrades to fixed with a typed report', async () => {
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('DejaVu Sans', 'thrown')),
      fonts: () => {
        throw new Error('resolver exploded');
      },
      onFontError: (error) => errors.push(error),
    });
    await fontsSettled(editor);
    expect(editor.fontMeasurement().measurer).toBe('fixed');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('resolver exploded');
    expect(editor.exec({ type: 'insertText', text: 'X' })).toEqual({ ok: true, changed: true });
    editor.destroy();
  });

  test('a superseded load never installs the superseded answer', async () => {
    let resolveFirst: (value: undefined) => void = () => {};
    let call = 0;
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('DejaVu Sans', 'first')),
      fonts: async () => {
        call += 1;
        if (call === 1) {
          // Hold the first document's resolution open across the second load.
          await new Promise<undefined>((resolve) => {
            resolveFirst = resolve;
          });
          return dejaVuFragment;
        }
        return undefined;
      },
    });
    editor.load(docx(runIn('Garamond', 'second')));
    resolveFirst(undefined);
    await fontsSettled(editor);
    // The first document's fonts belong to a document that is no longer open.
    expect(editor.fontMeasurement().measurer).toBe('fixed');
    editor.destroy();
  });

  test('the declared-family list is capped before it reaches the resolver', async () => {
    const families = Array.from({ length: MAX_RESOLVER_FAMILIES + 40 }, (_, index) =>
      runIn(`Face ${String(index).padStart(3, '0')}`, `t${index}`)
    ).join('');
    let handed = -1;
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(families),
      fonts: (request) => {
        handed = request.families.length;
        return undefined;
      },
    });
    await fontsSettled(editor);
    expect(handed).toBeLessThanOrEqual(MAX_RESOLVER_FAMILIES);
    editor.destroy();
  });

  test('the value form still works, and is not called as a function', async () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('DejaVu Sans', 'static')),
      fonts: dejaVuFragment,
    });
    await fontsSettled(editor);
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    expect(editor.getAvailableFonts()).toContain('DejaVu Sans');
    editor.destroy();
  });
});
