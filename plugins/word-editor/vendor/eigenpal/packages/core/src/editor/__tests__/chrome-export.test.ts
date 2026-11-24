import { DEFAULT_REVISION_MARKUP } from '../../contracts/revision-markup.ts';
import { LOADING_SNAPSHOT } from '../loading-snapshot.ts';
import { expect, test } from 'bun:test';
import { ChromeExportError, runChromeExport } from '../chrome-export.ts';

test('missing converters fail before serializing the document', async () => {
  let saves = 0;
  const editor = {
    save: async () => {
      saves++;
      return new ArrayBuffer(0);
    },
  };
  for (const format of ['markdown', 'pdf'] as const) {
    try {
      await runChromeExport(editor, format);
      throw new Error('Expected a missing converter error');
    } catch (error) {
      expect(error).toBeInstanceOf(ChromeExportError);
      expect((error as ChromeExportError).code).toBe('missing-exporter');
      expect((error as Error).message).toContain(`@docx-editor.dev/docx-to-${format}`);
    }
  }
  expect(saves).toBe(0);
});

test('Markdown exports current bytes as continuous text without page output', async () => {
  const source = new Uint8Array([1, 2, 3]);
  const result = await runChromeExport({ save: async () => source.buffer }, 'markdown', {
    markdown: async (bytes) => {
      expect(bytes).toEqual(source);
      return { markdown: '# Title\n\nContinuous body é', pages: [{ markdown: 'DO NOT DOWNLOAD' }] };
    },
  });
  expect(new TextDecoder().decode(result.bytes)).toBe('# Title\n\nContinuous body é');
  expect(result.extension).toBe('md');
  expect(result.mimeType).toBe('text/markdown;charset=utf-8');
});

test('PDF exports handler bytes and reports conversion failures', async () => {
  const editor = { save: async () => new ArrayBuffer(1) };
  const bytes = new TextEncoder().encode('%PDF-1.7\n');
  expect(await runChromeExport(editor, 'pdf', { pdf: async () => ({ bytes }) })).toEqual({
    bytes,
    extension: 'pdf',
    mimeType: 'application/pdf',
  });
  await expect(
    runChromeExport(editor, 'pdf', {
      pdf: async () => {
        throw new Error('Server refused conversion');
      },
    })
  ).rejects.toThrow('Server refused conversion');
  await expect(
    runChromeExport(editor, 'pdf', {
      pdf: async () => ({ bytes: new Uint8Array() }),
    })
  ).rejects.toThrow('no PDF bytes');
});

test('PDF export rejects endpoint error pages and incomplete headers', async () => {
  for (const body of [
    '<!doctype html><title>Missing PDF endpoint</title>',
    '{"message":"Converter is not installed"}',
    '%PD',
  ]) {
    await expect(
      runChromeExport({ save: async () => new ArrayBuffer(0) }, 'pdf', {
        pdf: async () => ({ bytes: new TextEncoder().encode(body) }),
      })
    ).rejects.toThrow('without a PDF header');
  }
});

test('PDF receives the viewer settings captured before an asynchronous save', async () => {
  let snapshot = {
    ...LOADING_SNAPSHOT,
    reviewDisplayMode: 'all-markup' as const,
    revisionMarkup: DEFAULT_REVISION_MARKUP,
  };
  const original = snapshot;
  let authors = [{ author: 'Retained author', slot: 5, color: 'blue' }];
  await runChromeExport(
    {
      snapshot: () => snapshot,
      getReviewAuthors: () => authors,
      save: async () => {
        authors = [];
        snapshot = {
          ...snapshot,
          revisionMarkup: { ...DEFAULT_REVISION_MARKUP, trackMoves: false },
        };
        return new ArrayBuffer(0);
      },
    },
    'pdf',
    {
      pdf: async (_bytes, view) => {
        expect(view?.displayMode).toBe('all-markup');
        expect(view?.revisionMarkup).toBe(original.revisionMarkup);
        expect(view?.revisionAuthorSlots).toEqual({ 'Retained author': 5 });
        expect(Object.isFrozen(view?.revisionAuthorSlots)).toBe(true);
        return { bytes: new TextEncoder().encode('%PDF-1.7') };
      },
    }
  );
});

test('PDF print settings override the display mode and carry the comments choice', async () => {
  const snapshot = {
    ...LOADING_SNAPSHOT,
    reviewDisplayMode: 'all-markup' as const,
    revisionMarkup: DEFAULT_REVISION_MARKUP,
  };
  const views: unknown[] = [];
  const editor = {
    snapshot: () => snapshot,
    getReviewAuthors: () => [{ author: 'Author', slot: 2, color: 'blue' }],
    save: async () => new ArrayBuffer(0),
  };
  const handlers = {
    pdf: async (_bytes: Uint8Array, view?: unknown) => {
      views.push(view);
      return { bytes: new TextEncoder().encode('%PDF-1.7') };
    },
  };
  await runChromeExport(editor, 'pdf', handlers);
  await runChromeExport(editor, 'pdf', handlers, { displayMode: 'original', comments: false });
  await runChromeExport(editor, 'pdf', handlers, { comments: true });
  expect(views).toEqual([
    {
      displayMode: 'all-markup',
      revisionMarkup: DEFAULT_REVISION_MARKUP,
      revisionAuthorSlots: { Author: 2 },
    },
    {
      displayMode: 'original',
      comments: false,
      revisionMarkup: DEFAULT_REVISION_MARKUP,
      revisionAuthorSlots: { Author: 2 },
    },
    {
      displayMode: 'all-markup',
      comments: true,
      revisionMarkup: DEFAULT_REVISION_MARKUP,
      revisionAuthorSlots: { Author: 2 },
    },
  ]);
});

test('PDF print settings reach the handler from an editor without a snapshot', async () => {
  let received: unknown;
  await runChromeExport(
    { save: async () => new ArrayBuffer(0) },
    'pdf',
    {
      pdf: async (_bytes, view) => {
        received = view;
        return { bytes: new TextEncoder().encode('%PDF-1.7') };
      },
    },
    { displayMode: 'original', comments: false }
  );
  expect(received).toEqual({
    displayMode: 'original',
    comments: false,
    revisionMarkup: DEFAULT_REVISION_MARKUP,
  });
});
