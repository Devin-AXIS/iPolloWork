// Embedded DOCX fonts reach shaped measurement automatically (font-resolution-overhaul
// group 2, plus the group-1 composition/lifecycle guarantees).
//
// The fixture embeds REAL faces (the DejaVu test fonts) behind Word's §2.8.1 obfuscation
// — `deobfuscateFont` is a pure XOR, so applying it to clean bytes produces a correctly
// obfuscated part. What these tests pin down, end to end through `createDocxEditor`:
//
// - zero config + embedded fonts → the shaped measurer engages, exactly one remount
// - pre-resolution edits survive the shaped remount
// - explicit config sources beat embedded faces on the same request
// - a corrupt embedded face degrades THAT face with a typed report; the load never blocks
// - zero config + no embedded fonts stays fixed with no font work and no errors

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import type { EditorFontError } from '../../contracts/editor.ts';
import { sha256FontBytes, type LayoutFontConfiguration } from '../../layout/index.ts';
import { deobfuscateFont } from '../../store/package/embedded-fonts.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { embeddedFontSources } from '../embedded-font-sources.ts';
import * as fontConfiguration from '../font-configuration.ts';
const createLayoutShapingReal = fontConfiguration.createLayoutShaping;
const disposeLayoutShapingReal = fontConfiguration.disposeLayoutShaping;
import { stubReviewModule } from './review-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const FT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable';
const FONT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font';

const GUID = '001B70DC-AA60-4AD5-90EC-18A0948E1EAE';

const fontFixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(new URL(`../../layout/__tests__/fixtures/fonts/${name}`, import.meta.url))
  );

const regularBytes = fontFixture('DejaVuSans.ttf');
const boldBytes = fontFixture('DejaVuSans-Bold.ttf');

/** Obfuscate per §2.8.1 — the same XOR that deobfuscates. */
const obfuscate = (bytes: Uint8Array): Uint8Array => deobfuscateFont(bytes, GUID)!;

interface EmbedEntry {
  readonly family: string;
  readonly slot: 'embedRegular' | 'embedBold' | 'embedItalic' | 'embedBoldItalic';
  readonly bytes: Uint8Array;
}

/** A DOCX whose fontTable embeds the given faces, one obfuscated part each. */
function docxWithEmbeds(body: string, embeds: readonly EmbedEntry[]): Uint8Array {
  const byFamily = new Map<string, EmbedEntry[]>();
  for (const embed of embeds) {
    const list = byFamily.get(embed.family) ?? [];
    list.push(embed);
    byFamily.set(embed.family, list);
  }
  const fontRels: string[] = [];
  const fontEntries: string[] = [];
  const parts: Record<string, Uint8Array> = {};
  let partIndex = 0;
  for (const [family, list] of byFamily) {
    const slots = list
      .map((embed) => {
        partIndex += 1;
        const relId = `rIdFont${partIndex}`;
        const partName = `fonts/font${partIndex}.odttf`;
        parts[`word/${partName}`] = obfuscate(embed.bytes);
        fontRels.push(`<Relationship Id="${relId}" Type="${FONT_REL}" Target="${partName}"/>`);
        return `<w:${embed.slot} r:id="${relId}" w:fontKey="{${GUID}}"/>`;
      })
      .join('');
    fontEntries.push(`<w:font w:name="${family}">${slots}</w:font>`);
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId10" Type="${FT}" Target="fontTable.xml"/></Relationships>`
    ),
    'word/_rels/fontTable.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${fontRels.join('')}</Relationships>`
    ),
    'word/fontTable.xml': strToU8(
      `<w:fonts xmlns:w="${W}" xmlns:r="${R}">${fontEntries.join('')}</w:fonts>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    ...parts,
  });
}

const p = (text: string, family = 'DejaVu Sans') =>
  `<w:p><w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const insertion = (id: number, author: string, text: string) =>
  `<w:ins w:id="${id}" w:author="${author}" w:date="2026-01-01T00:00:00Z">` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:ins>`;

/** Controllable proportional browser metrics, deliberately unlike the fixed 6pt grid. */
function mockCanvasContext(): CanvasRenderingContext2D {
  let currentFont = '';
  return {
    get font() {
      return currentFont;
    },
    set font(value: string) {
      currentFont = value;
    },
    measureText(text: string) {
      const match = /(\d+(?:\.\d+)?)px/.exec(currentFont);
      const sizePx = match ? Number(match[1]) : 11;
      return {
        width: text.length * sizePx * 0.7,
        fontBoundingBoxAscent: sizePx * 0.8,
      };
    },
  } as CanvasRenderingContext2D;
}

/** Wait out the open yield: the embedded-font fixtures cross the size threshold past
 *  which a document mounts behind one painted frame (see `docx-editor-open-scheduler`). */
async function mounted(editor: DocxEditorInstance): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (editor.surface) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('the deferred open never mounted');
}

/** Wait until shaped resolution lands (or the editor settles on fixed). */
async function fontsSettled(editor: DocxEditorInstance): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const measurement = editor.fontMeasurement();
    if (!measurement.resolving && (measurement.measurer === 'shaped' || attempt > 20)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('font resolution never settled');
}

const EMBED_BOTH: readonly EmbedEntry[] = [
  { family: 'DejaVu Sans', slot: 'embedRegular', bytes: regularBytes },
  { family: 'DejaVu Sans', slot: 'embedBold', bytes: boldBytes },
];

const pendingCaptureRestores = new Set<() => void>();

afterEach(() => {
  for (const restore of [...pendingCaptureRestores]) restore();
});

function captureLayoutConfigurations(): {
  readonly configurations: LayoutFontConfiguration[];
  restore(): void;
} {
  const configurations: LayoutFontConfiguration[] = [];
  const spy = spyOn(fontConfiguration, 'createLayoutShaping').mockImplementation(
    async (configuration, instrumentation) => {
      configurations.push(configuration);
      return createLayoutShapingReal(configuration, instrumentation);
    }
  );
  const restore = (): void => {
    spy.mockRestore();
    pendingCaptureRestores.delete(restore);
  };
  pendingCaptureRestores.add(restore);
  return { configurations, restore };
}

describe('embedded fonts auto-wire into shaped measurement', () => {
  test('zero config + embedded fonts engages the shaped measurer', async () => {
    const container = document.createElement('div');
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('shaped hello'), EMBED_BOTH),
      onFontError: (error) => errors.push(error),
    });
    await mounted(editor);
    // The document is READABLE before its fonts resolve — that is the property, and it is
    // what `measurer: 'fixed'` here stood for. Asserting the measurer is still fixed at
    // this point asserts that an async resolution has not landed yet, which nothing
    // promises: `mounted` polls on a timer, and under a loaded parallel run the upgrade
    // can arrive inside one of its sleeps.
    expect(editor.surface).not.toBeNull();
    expect(container.textContent).toContain('shaped hello');
    await fontsSettled(editor);
    expect(editor.fontMeasurement()).toMatchObject({ measurer: 'shaped', resolving: false });
    expect(errors).toHaveLength(0);
    expect(container.textContent).toContain('shaped hello');
    editor.destroy();
  });

  test('an unresolved run keeps browser canvas metrics after shaped resolution', async () => {
    const previous = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => mockCanvasContext()) as typeof previous;
    try {
      const container = document.createElement('div');
      const editor = createDocxEditor({
        container,
        // DejaVu activates HarfBuzz; Helvetica has no byte-backed source and must take the
        // browser fallback that paints it, not the deterministic fixed-width test grid.
        document: docxWithEmbeds(p('shaped') + p('fallback', 'Helvetica'), EMBED_BOTH),
      });
      await fontsSettled(editor);

      expect(editor.fontMeasurement().measurer).toBe('shaped');
      expect(editor.fontMeasurement().producer).toContain('fallback:canvas-measurer+embedded');
      const fallbackSpan = editor
        .surface!.layout()
        .pages.flatMap((page) => page.fragments)
        .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
        .flatMap((line) => line.spans)
        .find((span) => span.text === 'fallback');
      expect(fallbackSpan).toBeDefined();
      // Font size × 0.7 per character from the canvas mock. The former fixed fallback was
      // 6pt per character at 11pt, which is the accumulating caret drift regression.
      expect(fallbackSpan!.box.width).toBeCloseTo(
        'fallback'.length * fallbackSpan!.style.fontSizePt * 0.7,
        5
      );
      editor.destroy();
    } finally {
      HTMLCanvasElement.prototype.getContext = previous;
    }
  });

  test('font resolution keeps the session and pre-resolution edits', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('base'), EMBED_BOTH),
    });
    // Typed BEFORE fonts resolved: the remount must carry this edit.
    editor.exec({ type: 'insertText', text: 'X' });
    const surfaceBeforeResolve = editor.surface;
    await fontsSettled(editor);
    const surfaceAfterResolve = editor.surface;
    expect(surfaceAfterResolve).toBe(surfaceBeforeResolve);
    expect(editor.surface!.session.bodyText()).toBe('Xbase');
    // Settled: no further remount happens once shaped layout is in place.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(editor.surface).toBe(surfaceAfterResolve);
    editor.destroy();
  });

  test('a same-document remount keeps author slots, while a true load resets them', async () => {
    const container = document.createElement('div');
    const trackedBody =
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans"/></w:rPr>' +
      '<w:t xml:space="preserve">base </w:t></w:r>' +
      insertion(1, 'Ada', 'one ') +
      insertion(2, 'Bea', 'two ') +
      insertion(3, 'Cora', 'three') +
      '</w:p>';
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(trackedBody, EMBED_BOTH),
      author: 'Grace',
      modules: [stubReviewModule()],
    });
    await mounted(editor);
    expect(
      new Map(editor.getReviewAuthors().map((author) => [author.author, author.slot]))
    ).toEqual(
      new Map([
        ['Ada', 0],
        ['Bea', 1],
        ['Cora', 2],
      ])
    );

    editor.setEditingMode('suggesting');
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    editor.surface!.type('X');
    const slotsBeforeRemount = new Map(
      editor.getReviewAuthors().map((author) => [author.author, author.slot])
    );
    expect(slotsBeforeRemount.get('Grace')).toBe(3);
    const surfaceBeforeResolve = editor.surface;

    // Detach/attach MOVES the same surface for the same load, so the author slots, like the
    // rest of the editing state, are the ones it already had.
    editor.detach();
    editor.attach(container);
    await mounted(editor);
    await fontsSettled(editor);

    expect(editor.surface).toBe(surfaceBeforeResolve);
    expect(
      new Map(editor.getReviewAuthors().map((author) => [author.author, author.slot]))
    ).toEqual(slotsBeforeRemount);

    editor.load(docxWithEmbeds(`<w:p>${insertion(1, 'Grace', 'new document')}</w:p>`, []));
    expect(editor.surface!.session.bodyText()).toBe('new document');
    expect(editor.getReviewAuthors()).toEqual([
      { author: 'Grace', slot: 0, color: 'var(--doc-review-author-0)' },
    ]);
    editor.destroy();
  });

  test('a pre-resolution programmatic range survives the shaped remount', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('select this text'), EMBED_BOTH),
    });
    await mounted(editor);
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    const paraId = editor.surface!.session.paraIdOf(paragraphId)!;
    const range = {
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 'select this text'.length },
    };

    editor.setEditingMode('suggesting');
    expect(
      editor.exec({
        type: 'setSelection',
        range: { from: { paraId }, to: { paraId } },
      })
    ).toEqual({ ok: true, changed: false });
    expect(document.getSelection()!.isCollapsed).toBe(false);
    await fontsSettled(editor);

    expect(editor.surface!.state().selection).toEqual(range);
    expect(document.getSelection()!.isCollapsed).toBe(false);
    expect(document.getSelection()!.toString()).toBe('select this text');
    editor.destroy();
    container.remove();
  });

  test('bold-italic slot resolves bold+italic runs (style-slot mapping)', async () => {
    const container = document.createElement('div');
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('bold italic text'), [
        { family: 'DejaVu Sans', slot: 'embedBoldItalic', bytes: boldBytes },
      ]),
      onFontError: (error) => errors.push(error),
    });
    await fontsSettled(editor);
    // The single embedded face admits: shaped measurement is live and nothing errored.
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    expect(errors).toHaveLength(0);
    editor.destroy();
  });

  test('a corrupt embedded face degrades that face only, with a typed report', async () => {
    const container = document.createElement('div');
    const errors: EditorFontError[] = [];
    const corrupt = new Uint8Array(4096).fill(0x42);
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('still opens'), [
        { family: 'DejaVu Sans', slot: 'embedRegular', bytes: regularBytes },
        { family: 'Broken Face', slot: 'embedRegular', bytes: corrupt },
      ]),
      onFontError: (error) => errors.push(error),
    });
    await mounted(editor);
    expect(editor.surface).not.toBeNull();
    await fontsSettled(editor);
    // The valid face admitted…
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    // …and the broken one was reported, not swallowed.
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.request?.family).toBe('Broken Face');
    // The document stays fully editable throughout.
    expect(editor.exec({ type: 'insertText', text: 'Y' })).toEqual({ ok: true, changed: true });
    editor.destroy();
  });

  test('every embedded face corrupt: the load never blocks, editing works on fixed', async () => {
    const container = document.createElement('div');
    const errors: EditorFontError[] = [];
    const corrupt = new Uint8Array(4096).fill(0x42);
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('resilient'), [
        { family: 'Broken Face', slot: 'embedRegular', bytes: corrupt },
      ]),
      onFontError: (error) => errors.push(error),
    });
    expect(editor.surface).not.toBeNull();
    await fontsSettled(editor);
    expect(errors.length).toBeGreaterThan(0);
    expect(editor.exec({ type: 'insertText', text: 'Z' })).toEqual({ ok: true, changed: true });
    expect(editor.surface!.session.bodyText()).toBe('Zresilient');
    editor.destroy();
  });

  test('undefined and empty resolver answers stay equivalent when embedded faces are dropped', async () => {
    const errorCodes: string[][] = [];
    const resolvers = [
      () => undefined,
      () => ({ sources: [], substitutions: [], failures: [] }),
    ] as const;

    for (const fonts of resolvers) {
      const errors: EditorFontError[] = [];
      const editor = createDocxEditor({
        container: document.createElement('div'),
        document: docxWithEmbeds(p('still resilient'), [
          { family: '   ', slot: 'embedRegular', bytes: boldBytes },
        ]),
        fonts,
        onFontError: (error) => errors.push(error),
      });
      await fontsSettled(editor);
      errorCodes.push(errors.map((error) => error.code));
      editor.destroy();
    }

    expect(errorCodes[0]).toEqual(errorCodes[1]);
    expect(errorCodes[0]).not.toContain('missing');
    expect(errorCodes[0]!.length).toBeGreaterThan(0);
  });

  test('explicit config sources beat embedded faces on the same request', async () => {
    const captured = captureLayoutConfigurations();
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('precedence'), [
        // The embedded regular face is the BOLD file, mislabeled — if it won, the
        // regular request would resolve to the bold hash below.
        { family: 'DejaVu Sans', slot: 'embedRegular', bytes: boldBytes },
      ]),
      fonts: {
        epoch: 1,
        maxFontBytes: 2_000_000,
        sources: [
          {
            request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
            id: 'explicit-regular',
            bytes: regularBytes,
            hash: sha256FontBytes(regularBytes),
            faceIndex: 0,
          },
        ],
        defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 24 },
      },
    });
    await fontsSettled(editor);
    const measurement = editor.fontMeasurement();
    expect(measurement.measurer).toBe('shaped');
    const hashes = captured.configurations.at(-1)?.sources.map((source) => source.hash) ?? [];
    expect(hashes).toContain(sha256FontBytes(regularBytes));
    expect(hashes).not.toContain(sha256FontBytes(boldBytes));
    expect(editor.exec({ type: 'insertText', text: 'ok' })).toEqual({ ok: true, changed: true });
    editor.destroy();
    captured.restore();
  });

  test('a rejected explicit face reveals a valid embedded face on the same request', async () => {
    const captured = captureLayoutConfigurations();
    const malformed = new Uint8Array(4096).fill(0x42);
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docxWithEmbeds(p('embedded survives', 'Original Face'), [
        { family: 'Original Face', slot: 'embedRegular', bytes: regularBytes },
      ]),
      fonts: {
        sources: [
          {
            request: { family: 'Original Face', weight: 400, style: 'normal' },
            id: 'rejected-explicit',
            bytes: malformed,
            hash: sha256FontBytes(malformed),
            faceIndex: 0,
          },
        ],
      },
    });
    await fontsSettled(editor);
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    expect(captured.configurations.at(-1)?.sources.map((source) => source.hash)).toContain(
      sha256FontBytes(regularBytes)
    );
    editor.destroy();
    captured.restore();
  });

  test('over-limit explicit faces do not consume the embedded-font budget', async () => {
    const captured = captureLayoutConfigurations();
    const oversized = new Uint8Array(8 * 1024 * 1024);
    const oversizedHash = sha256FontBytes(oversized);
    const explicitSources = Array.from({ length: 16 }, (_, index) => ({
      request: { family: `Rejected ${index}`, weight: 400, style: 'normal' as const },
      id: `over-limit-${index}`,
      bytes: oversized,
      hash: oversizedHash,
      faceIndex: 0,
    }));
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docxWithEmbeds(p('embedded budget'), [
        { family: 'DejaVu Sans', slot: 'embedRegular', bytes: regularBytes },
      ]),
      fonts: { maxFontBytes: 1024 * 1024, sources: explicitSources },
    });
    await fontsSettled(editor);
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    expect(captured.configurations.at(-1)?.sources.map((source) => source.hash)).toContain(
      sha256FontBytes(regularBytes)
    );
    editor.destroy();
    captured.restore();
  });

  test('an admitted embedded face wins over its configured substitution', async () => {
    const captured = captureLayoutConfigurations();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docxWithEmbeds(p('original', 'Original Face'), [
        { family: 'Original Face', slot: 'embedRegular', bytes: regularBytes },
      ]),
      fonts: {
        sources: [
          {
            request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
            id: 'substitute-target',
            bytes: regularBytes,
            hash: sha256FontBytes(regularBytes),
            faceIndex: 0,
          },
        ],
        substitutions: [
          {
            from: { family: 'Original Face', weight: 400, style: 'normal' },
            to: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
          },
        ],
      },
    });
    await fontsSettled(editor);
    // The file's OWN face wins, so the composed configuration drops the redirect.
    expect(captured.configurations.at(-1)?.substitutions ?? []).toEqual([]);
    expect(editor.snapshot().fontSubstitutions ?? []).not.toContain('Original Face');
    editor.destroy();
    captured.restore();
  });

  test('a refused embedded face restores its configured substitution', async () => {
    const captured = captureLayoutConfigurations();
    const corrupt = new Uint8Array(4096).fill(0x42);
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docxWithEmbeds(p('substitute', 'Original Face'), [
        { family: 'Original Face', slot: 'embedRegular', bytes: corrupt },
      ]),
      fonts: {
        sources: [
          {
            request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
            id: 'substitute-target',
            bytes: regularBytes,
            hash: sha256FontBytes(regularBytes),
            faceIndex: 0,
          },
        ],
        substitutions: [
          {
            from: { family: 'Original Face', weight: 400, style: 'normal' },
            to: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
          },
        ],
      },
    });
    await fontsSettled(editor);
    // A refused embedded face restores the configured redirect on recomposition.
    expect(captured.configurations.at(-1)?.substitutions).toEqual([
      expect.objectContaining({
        from: expect.objectContaining({ family: 'Original Face' }),
        to: expect.objectContaining({ family: 'DejaVu Sans' }),
      }),
    ]);
    // Covered THROUGH the redirect, so the fidelity notice stays quiet: the run paginates
    // on the metrics the app chose for it.
    expect(editor.snapshot().fontSubstitutions ?? []).not.toContain('Original Face');
    editor.destroy();
    captured.restore();
  });

  test('a superseded shaping is released, not leaked', async () => {
    // The recompose builds a SECOND shaper and the first one has to go: it owns wasm
    // memory that nothing collects. Counted rather than eyeballed, because a dropped
    // dispose leaks silently — every test still passes and the page still renders.
    const corrupt = new Uint8Array(4096).fill(0x42);
    const created: unknown[] = [];
    const disposed: unknown[] = [];
    const createSpy = spyOn(fontConfiguration, 'createLayoutShaping').mockImplementation(
      async (configuration) => {
        const shaping = await createLayoutShapingReal(configuration);
        created.push(shaping.shaper);
        return shaping;
      }
    );
    const disposeSpy = spyOn(fontConfiguration, 'disposeLayoutShaping').mockImplementation(
      (shaping) => {
        disposed.push(shaping.shaper);
        disposeLayoutShapingReal(shaping);
      }
    );
    try {
      const editor = createDocxEditor({
        container: document.createElement('div'),
        document: docxWithEmbeds(p('substitute', 'Original Face'), [
          { family: 'Original Face', slot: 'embedRegular', bytes: corrupt },
        ]),
        fonts: {
          sources: [
            {
              request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
              id: 'substitute-target',
              bytes: regularBytes,
              hash: sha256FontBytes(regularBytes),
              faceIndex: 0,
            },
          ],
          substitutions: [
            {
              from: { family: 'Original Face', weight: 400, style: 'normal' },
              to: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
            },
          ],
        },
      });
      await fontsSettled(editor);
      // Two built (the first attempt and the recompose), and the superseded one released.
      expect(created.length).toBeGreaterThan(1);
      expect(disposed).toContain(created[0]);
      expect(created.filter((shaper) => !disposed.includes(shaper))).toHaveLength(1);
      editor.destroy();
    } finally {
      createSpy.mockRestore();
      disposeSpy.mockRestore();
    }
    // These patch a SHARED module record, so every other file in the same process sees
    // them until they are put back. Asserted, not assumed: a spy that outlived this test
    // would only show up in the serial run, as someone else's failure.
    expect(fontConfiguration.createLayoutShaping).toBe(createLayoutShapingReal);
    expect(fontConfiguration.disposeLayoutShaping).toBe(disposeLayoutShapingReal);
  });

  test('an over-budget drop is reported even when nothing else survives validation', async () => {
    // Both diagnostics or neither. The refusal path returns early once no source is left,
    // and reporting the drops only AFTER that loop lost the `overLimit` report for exactly
    // the file that needed it most: one oversized face and one damaged one.
    // Incompressible on purpose: a 2 MB run of zeros trips the package reader's
    // decompression-ratio cap and the document never opens at all.
    const oversized = new Uint8Array(2 * 1024 * 1024);
    for (let index = 0; index < oversized.length; index += 1) {
      oversized[index] = (index * 2654435761) >>> 24;
    }
    const corrupt = new Uint8Array(4096).fill(0x42);
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docxWithEmbeds(p('diagnosable'), [
        { family: 'Oversized Face', slot: 'embedRegular', bytes: oversized },
        { family: 'Broken Face', slot: 'embedRegular', bytes: corrupt },
      ]),
      fonts: { maxFontBytes: 1024 * 1024, sources: [] },
      onFontError: (error) => errors.push(error),
    });
    await fontsSettled(editor);
    expect(editor.fontMeasurement().measurer).toBe('fixed');
    expect(
      errors
        .map((error) => error.request?.family)
        .filter(Boolean)
        .sort()
    ).toEqual(['Broken Face', 'Oversized Face']);
    expect(errors.some((error) => error.code === 'overLimit')).toBe(true);
    editor.destroy();
  });

  test('zero config + no embedded fonts stays fixed with no font work and no errors', async () => {
    const container = document.createElement('div');
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container,
      document: zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>plain</w:t></w:r></w:p></w:body></w:document>`
        ),
      }),
      onFontError: (error) => errors.push(error),
    });
    const surfaceAtMount = editor.surface;
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    await new Promise((resolve) => setTimeout(resolve, 150));
    // No resolution started, no remount happened, nothing errored.
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    expect(editor.surface).toBe(surfaceAtMount);
    expect(errors).toHaveLength(0);
    editor.destroy();
  });

  test('a whitespace-only family degrades that face; other faces and explicit fonts survive', async () => {
    // The family is attacker-controlled and the request contract THROWS on
    // empty/whitespace names — one crafted face must not detonate the composition
    // carrying every other face.
    const container = document.createElement('div');
    const errors: EditorFontError[] = [];
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('crafted'), [
        { family: 'DejaVu Sans', slot: 'embedRegular', bytes: regularBytes },
        { family: '   ', slot: 'embedRegular', bytes: boldBytes },
      ]),
      onFontError: (error) => errors.push(error),
    });
    await fontsSettled(editor);
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    expect(errors.some((error) => error.code === 'malformed')).toBe(true);
    editor.destroy();
  });

  test('a load superseding an in-flight resolution never leaves resolving stuck true', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('first'), EMBED_BOTH),
    });
    // Font work starts at the mount, which this big fixture defers — flush it through
    // the public path so the in-flight window is still open when the next load lands.
    editor.exec({ type: 'setEditingMode', mode: 'editing' });
    // Immediately supersede with a document that starts NO font work of its own.
    expect(editor.fontMeasurement().resolving).toBe(true);
    editor.load(
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>plain</w:t></w:r></w:p></w:body></w:document>`
        ),
      })
    );
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    // Let the superseded resolution land: it must neither install the previous
    // document's measurer nor flip resolving back on.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    editor.destroy();
  });

  test('load() of a NEW document re-resolves for that document', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('first'), EMBED_BOTH),
    });
    await fontsSettled(editor);
    expect(editor.fontMeasurement().measurer).toBe('shaped');
    // The second document has NO embedded fonts: the previous document's shaped
    // measurer must not leak onto it.
    editor.load(
      zipSync({
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>second</w:t></w:r></w:p></w:body></w:document>`
        ),
      })
    );
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(editor.fontMeasurement()).toEqual({ measurer: 'fixed', resolving: false });
    editor.destroy();
  });
});

// A file may declare the SAME face twice, each pointing at a different part. Composition
// validates the first and drops the rest, so the mapper must not emit the duplicates
// either: a caller iterating the mapper's output would otherwise treat bytes that never
// reached the validator as admitted.
describe('duplicate embedded face declarations collapse at the mapper', () => {
  test('a second declaration of the same family and slot is dropped, first-wins', () => {
    const duplicate = embeddedFontSources(
      [
        {
          family: 'DejaVu Sans',
          style: 'regular',
          partName: '/word/fonts/font1.odttf',
          bytes: regularBytes,
        },
        {
          family: 'DejaVu Sans',
          style: 'regular',
          partName: '/word/fonts/font2.odttf',
          bytes: new Uint8Array(2048).fill(0xde),
        },
      ],
      { maxFontBytes: 1_000_000, aggregateBudget: 10_000_000 }
    );
    expect(duplicate.sources).toHaveLength(1);
    expect(duplicate.sources[0]!.id).toBe('embedded:/word/fonts/font1.odttf#regular');
    expect(duplicate.sources[0]!.hash).toBe(sha256FontBytes(regularBytes));
  });

  test('the same family in a different slot is a distinct face and still admits', () => {
    const both = embeddedFontSources(
      [
        {
          family: 'DejaVu Sans',
          style: 'regular',
          partName: '/word/fonts/font1.odttf',
          bytes: regularBytes,
        },
        {
          family: 'DejaVu Sans',
          style: 'bold',
          partName: '/word/fonts/font2.odttf',
          bytes: boldBytes,
        },
      ],
      { maxFontBytes: 1_000_000, aggregateBudget: 10_000_000 }
    );
    expect(both.sources).toHaveLength(2);
  });
});

// The run family is file-derived and reaches the resolver on EVERY measured run. A
// family the request contract refuses (whitespace-only) used to throw through layout,
// fail the shaped remount, and leave the editor with no surface and no bytes — the
// document silently vanished mid-session. Fidelity must never cost the document.
describe('a hostile run family cannot destroy the mounted document', () => {
  const HOSTILE_RUN =
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="   " w:hAnsi="   "/></w:rPr>' +
    '<w:t xml:space="preserve">crafted</w:t></w:r></w:p>';

  test('the document survives shaped resolution and stays saveable', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(HOSTILE_RUN + p('normal'), EMBED_BOTH),
      onFontError: () => {},
    });
    await mounted(editor);
    expect(container.textContent).toContain('crafted');
    await fontsSettled(editor);
    // Still mounted, still showing the document, still saveable.
    expect(editor.surface).not.toBeNull();
    expect(container.textContent).toContain('crafted');
    expect(editor.surface!.session.bodyText()).toContain('crafted');
    expect(editor.snapshot().parseError ?? null).toBeNull();
    editor.destroy();
  });
});

// Paint-side registration, end to end (issue #78). Happy-dom ships neither
// `document.fonts` nor `FontFace`, so the environment is stubbed per test.
describe('embedded faces paint through an engine-minted alias', () => {
  class StubFontFace {
    constructor(
      readonly family: string,
      readonly bytes: ArrayBuffer,
      readonly descriptors: { readonly weight: string; readonly style: string }
    ) {}
    load(): Promise<unknown> {
      return Promise.resolve(this);
    }
  }
  class StubFontFaceSet {
    readonly faces = new Set<StubFontFace>();
    add(face: StubFontFace): void {
      this.faces.add(face);
    }
    delete(face: StubFontFace): boolean {
      return this.faces.delete(face);
    }
  }

  let fontSet: StubFontFaceSet;
  beforeEach(() => {
    fontSet = new StubFontFaceSet();
    (document as unknown as { fonts: StubFontFaceSet }).fonts = fontSet;
    (globalThis as unknown as { FontFace: typeof StubFontFace }).FontFace = StubFontFace;
  });
  afterEach(() => {
    delete (document as unknown as { fonts?: StubFontFaceSet }).fonts;
    delete (globalThis as unknown as { FontFace?: typeof StubFontFace }).FontFace;
  });

  test('a hostile declared family never reaches document.fonts, but still paints', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      // The document claims to embed the host application's own UI font.
      document: docxWithEmbeds(p('spoofed', 'Segoe UI'), [
        { family: 'Segoe UI', slot: 'embedRegular', bytes: regularBytes },
      ]),
      onFontError: () => {},
    });
    await fontsSettled(editor);

    const registered = [...fontSet.faces].map((face) => face.family);
    expect(registered).toHaveLength(1);
    // THE security property: the page-global registry never learns "Segoe UI".
    expect(registered[0]).not.toBe('Segoe UI');
    expect(registered[0]).toMatch(/^docx-embedded-/);

    // And the painted run asks for the alias FIRST, with the declared family behind it,
    // so the embedded glyphs are used without shadowing anything.
    const painted = container.querySelector<HTMLElement>('[data-paragraph-id] .layout-run-text');
    expect(painted).not.toBeNull();
    expect(painted!.style.fontFamily).toContain(registered[0]!);
    expect(painted!.style.fontFamily).toContain('Segoe UI');
    expect(painted!.style.fontFamily.indexOf(registered[0]!)).toBeLessThan(
      painted!.style.fontFamily.indexOf('Segoe UI')
    );
    editor.destroy();
    expect(fontSet.faces.size).toBe(0);
  });

  test('a replaced document removes the previous document’s faces', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('first'), EMBED_BOTH),
    });
    await fontsSettled(editor);
    expect(fontSet.faces.size).toBe(2);
    editor.load(docxWithEmbeds(p('second, no embeds'), []));
    expect(fontSet.faces.size).toBe(0);
    editor.destroy();
  });

  test('a validator-rejected face is never registered', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docxWithEmbeds(p('partial'), [
        { family: 'DejaVu Sans', slot: 'embedRegular', bytes: regularBytes },
        { family: 'Broken Face', slot: 'embedRegular', bytes: new Uint8Array(4096).fill(0x42) },
      ]),
      onFontError: () => {},
    });
    await fontsSettled(editor);
    expect(fontSet.faces.size).toBe(1);
    editor.destroy();
  });
});
