import { createDocumentRefresh } from '../document-refresh.ts';
import { beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorConfig } from '../docx-editor.ts';
import { DEFAULT_RUN_STYLE, initializeHarfBuzz, sha256FontBytes } from '../../layout/index.ts';
import type { FontConfiguration, EditorFontError } from '../../contracts/editor.ts';
import type { FontResolutionRequest } from '../font-composition.ts';

beforeAll(() => initializeHarfBuzz());
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const opaque = new Uint8Array([0, 7, 255, 19]);
function source(text = 'iiiiiiii original') {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body><w:p w14:paraId="A1B2C3D4" w14:textId="A1B2C3D4"><w:r><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
    ),
    'word/embeddings/opaque.bin': opaque,
  });
}
function fonts(): FontConfiguration {
  const bytes = new Uint8Array(
    readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  );
  return {
    epoch: 1,
    maxFontBytes: 16 * 1024 * 1024,
    sources: [
      {
        request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
        id: 'public-dejavu',
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      },
    ],
    defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 22 },
  };
}
function mount(options: Partial<DocxEditorConfig> = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: source(), ...options });
  return {
    editor,
    container,
    dispose() {
      editor.destroy();
      container.remove();
    },
  };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('The public font lifecycle did not settle');
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const style = { ...DEFAULT_RUN_STYLE, fontFamily: 'DejaVu Sans', fontSizePt: 11 };

test('setFonts removes warm font and paragraph caches without replacing editable state', async () => {
  const state = mount({ fonts: fonts() });
  try {
    await until(
      () =>
        state.editor.fontMeasurement().measurer === 'shaped' &&
        !state.editor.fontMeasurement().resolving
    );
    const editor = state.editor,
      surface = editor.surface!,
      session = surface.session;
    surface.type('A');
    surface.type('B');
    const text = session.bodyText(),
      selection = surface.state().selection,
      revision = session.packageRevision();
    const oldMeasurer = surface.textMeasurer!(),
      oldLayout = surface.layout();
    const beforeSave = unzipSync(new Uint8Array(await editor.save()));
    const changes: unknown[] = [];
    editor.on('change', (change) => changes.push(change));
    expect(oldMeasurer.hasResolvedFont!(style)).toBe(true);
    const width = oldMeasurer.measure('iiiiiiii', style);
    expect(editor.snapshot().canUndo).toBe(true);
    await editor.setFonts(undefined);
    expect(editor.surface).toBe(surface);
    expect(surface.session).toBe(session);
    expect(session.packageRevision()).toBe(revision);
    expect(session.bodyText()).toBe(text);
    expect(editor.getDocumentHandle().revision).toBe(revision);
    expect(changes).toHaveLength(0);
    const afterSave = unzipSync(new Uint8Array(await editor.save()));
    expect(Object.keys(afterSave).sort()).toEqual(Object.keys(beforeSave).sort());
    for (const name of Object.keys(beforeSave)) expect(afterSave[name]).toEqual(beforeSave[name]);
    expect(surface.state().selection).toEqual(selection);
    expect(editor.snapshot().canUndo).toBe(true);
    expect(editor.fontMeasurement().measurer).toBe('fixed');
    expect(editor.fontMeasurement().resolving).toBe(false);
    const current = surface.textMeasurer!();
    expect(current).not.toBe(oldMeasurer);
    expect(current.hasResolvedFont?.(style) ?? false).toBe(false);
    expect(current.measure('iiiiiiii', style)).not.toBe(width);
    expect(surface.layout()).not.toBe(oldLayout);
    expect(state.container.textContent).toContain(text);
    surface.undo();
    expect(session.bodyText()).not.toBe(text);
    surface.redo();
    expect(session.bodyText()).toBe(text);
    const saved = unzipSync(new Uint8Array(await editor.save()));
    expect(saved['word/embeddings/opaque.bin']).toEqual(opaque);
    const reopened = mount({ document: new Uint8Array(await editor.save()) });
    try {
      await until(() => !!reopened.editor.surface);
      expect(reopened.editor.surface!.session.bodyText()).toBe(text);
    } finally {
      reopened.dispose();
    }
  } finally {
    state.dispose();
  }
});

test('a replaced resolver is aborted and its late face cannot revive the retired font set', async () => {
  const reports: EditorFontError[] = [],
    state = mount({ fonts: fonts(), onFontError: (error) => reports.push(error) }),
    pending = deferred<FontConfiguration>();
  let request: FontResolutionRequest | undefined;
  try {
    await until(() => state.editor.fontMeasurement().measurer === 'shaped');
    const session = state.editor.surface!.session;
    const first = state.editor.setFonts((value) => {
      request = value;
      return pending.promise;
    });
    await until(() => !!request);
    const stopped = state.editor.setFonts(undefined);
    expect(request!.signal!.aborted).toBe(true);
    await stopped;
    pending.resolve(fonts());
    await first;
    expect(state.editor.surface!.session).toBe(session);
    expect(state.editor.fontMeasurement().measurer).toBe('fixed');
    expect(reports).toHaveLength(0);
  } finally {
    state.dispose();
  }
});

test('a late rejection belongs to the retired resolution, not the new font owner', async () => {
  const reports: EditorFontError[] = [],
    events: unknown[] = [],
    pending = deferred<undefined>(),
    state = mount({ onFontError: (error) => reports.push(error) });
  state.editor.on('error', (error) => events.push(error));
  try {
    const first = state.editor.setFonts(() => pending.promise);
    await state.editor.setFonts(undefined);
    pending.reject(new Error('retired provider'));
    await first;
    expect(reports).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(state.editor.fontMeasurement().resolving).toBe(false);
  } finally {
    state.dispose();
  }
});

test('a current font failure preserves its cause and does not restore removed faces', async () => {
  const reports: EditorFontError[] = [],
    cause = new Error('new owner denied'),
    state = mount({ fonts: fonts(), onFontError: (error) => reports.push(error) });
  try {
    await until(() => state.editor.fontMeasurement().measurer === 'shaped');
    await state.editor.setFonts(() => Promise.reject(cause));
    expect(reports).toHaveLength(1);
    expect(reports[0]!.cause).toBe(cause);
    expect(state.editor.fontMeasurement().measurer).toBe('fixed');
    expect(state.editor.surface!.session.bodyText()).toContain('original');
  } finally {
    state.dispose();
  }
});

test('a font error callback can replace fonts without publishing an old error event', async () => {
  const events: unknown[] = [];
  let calls = 0;
  const state = mount({
    onFontError: () => {
      calls++;
      void state.editor.setFonts(undefined);
    },
  });
  state.editor.on('error', (error) => events.push(error));
  try {
    await state.editor.setFonts(() => Promise.reject(new Error('replace during callback')));
    expect(calls).toBe(1);
    expect(events).toHaveLength(0);
    expect(state.editor.fontMeasurement().measurer).toBe('fixed');
  } finally {
    state.dispose();
  }
});

test('font replacement preserves the read-only command boundary', async () => {
  const state = mount({ mode: 'view', fonts: fonts() });
  try {
    await until(() => state.editor.fontMeasurement().measurer === 'shaped');
    const text = state.editor.surface!.session.bodyText();
    await state.editor.setFonts(undefined);
    expect(state.editor.snapshot().editable).toBe(false);
    state.editor.surface!.type('forbidden');
    expect(state.editor.surface!.session.bodyText()).toBe(text);
    expect(state.editor.snapshot().canUndo).toBe(false);
    expect(
      strFromU8(unzipSync(new Uint8Array(await state.editor.save()))['word/document.xml']!)
    ).not.toContain('forbidden');
  } finally {
    state.dispose();
  }
});

test('parked font replacement keeps the same session and undo history on attach', async () => {
  const state = mount({ fonts: fonts() });
  try {
    await until(() => state.editor.fontMeasurement().measurer === 'shaped');
    const surface = state.editor.surface!,
      session = surface.session;
    surface.type('parked ');
    const text = session.bodyText();
    state.editor.detach();
    await state.editor.setFonts(undefined);
    state.editor.attach(state.container);
    expect(state.editor.surface).toBe(surface);
    expect(surface.session).toBe(session);
    expect(session.bodyText()).toBe(text);
    expect(state.editor.snapshot().canUndo).toBe(true);
    expect(state.editor.fontMeasurement().measurer).toBe('fixed');
    surface.undo();
    expect(session.bodyText()).not.toBe(text);
    surface.redo();
    expect(session.bodyText()).toBe(text);
  } finally {
    state.dispose();
  }
});

test('loading a new document and destroying an editor abort their outstanding resolver', async () => {
  const pending = deferred<undefined>(),
    state = mount();
  let request: FontResolutionRequest | undefined;
  try {
    const first = state.editor.setFonts((value) => {
      request = value;
      return pending.promise;
    });
    await until(() => !!request);
    const oldRequest = request!;
    state.editor.load(source('replacement document'));
    expect(oldRequest.signal!.aborted).toBe(true);
    pending.resolve(undefined);
    await first;
    expect(state.editor.surface!.session.bodyText()).toBe('replacement document');
    const next = deferred<undefined>();
    let final: FontResolutionRequest | undefined;
    const work = state.editor.setFonts((value) => {
      final = value;
      return next.promise;
    });
    await until(() => !!final);
    state.editor.destroy();
    expect(final!.signal!.aborted).toBe(true);
    next.resolve(undefined);
    await work;
    await expect(state.editor.setFonts(undefined)).rejects.toMatchObject({ code: 'destroyed' });
  } finally {
    state.dispose();
  }
});

test('setFonts flushes pending native input as one authored edit and adds no resource transaction', async () => {
  const state = mount({ fonts: fonts() });
  try {
    await until(() => state.editor.fontMeasurement().measurer === 'shaped');
    const surface = state.editor.surface!,
      session = surface.session,
      id = session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 0 },
    });
    const revision = session.packageRevision(),
      text = session.bodyText(),
      changes: unknown[] = [];
    state.editor.on('change', (change) => changes.push(change));
    for (const data of ['p', 'q'])
      state.container.querySelector('.docx-pages')!.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data,
        })
      );
    expect(session.bodyText()).toBe(text);
    const work = state.editor.setFonts(undefined);
    expect(session.bodyText()).toBe('pq' + text);
    await work;
    expect(session.packageRevision()).toBe(revision + 1);
    expect(changes).toHaveLength(1);
    expect(state.editor.surface!.state().selection.head.offset).toBe(2);
    surface.undo();
    expect(session.bodyText()).toBe(text);
    surface.redo();
    expect(session.bodyText()).toBe('pq' + text);
  } finally {
    state.dispose();
  }
});

test('an old abort listener can replace fonts without the outer call overwriting its new owner', async () => {
  const state = mount(),
    pending = deferred<undefined>();
  let request: FontResolutionRequest | undefined, newest: Promise<void> | undefined;
  try {
    const first = state.editor.setFonts((value) => {
      request = value;
      value.signal!.addEventListener(
        'abort',
        () => {
          newest = state.editor.setFonts(fonts());
        },
        { once: true }
      );
      return pending.promise;
    });
    await until(() => !!request);
    const session = state.editor.surface!.session;
    await state.editor.setFonts(undefined);
    expect(request!.signal!.aborted).toBe(true);
    expect(newest).toBeDefined();
    await newest;
    pending.resolve(undefined);
    await first;
    expect(state.editor.surface!.session).toBe(session);
    expect(state.editor.fontMeasurement().measurer).toBe('shaped');
    expect(state.editor.fontMeasurement().resolving).toBe(false);
    expect(state.editor.surface!.textMeasurer!().hasResolvedFont!(style)).toBe(true);
  } finally {
    state.dispose();
  }
});

test('a newer font replacement from a pending-input change listener owns the final resources', async () => {
  const state = mount({ fonts: fonts() });
  try {
    await until(() => state.editor.fontMeasurement().measurer === 'shaped');
    const surface = state.editor.surface!;
    const session = surface.session;
    const id = session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 0 },
    });
    const original = session.bodyText();
    const revision = session.packageRevision();
    let replacements = 0;
    let newest: Promise<void> | undefined;
    state.editor.on('change', () => {
      if (replacements++ === 0) newest = state.editor.setFonts(undefined);
    });
    for (const data of ['p', 'q'])
      state.container.querySelector('.docx-pages')!.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data,
        })
      );
    expect(session.bodyText()).toBe(original);
    const older = state.editor.setFonts(fonts());
    await older;
    expect(newest).toBeDefined();
    await newest;
    expect(replacements).toBe(1);
    expect(state.editor.surface).toBe(surface);
    expect(surface.session).toBe(session);
    expect(session.bodyText()).toBe('pq' + original);
    expect(session.packageRevision()).toBe(revision + 1);
    expect(state.editor.fontMeasurement().resolving).toBe(false);
    expect(state.editor.fontMeasurement().measurer).toBe('fixed');
    expect(surface.textMeasurer!().hasResolvedFont?.(style) ?? false).toBe(false);
    surface.undo();
    expect(session.bodyText()).toBe(original);
    surface.redo();
    expect(session.bodyText()).toBe('pq' + original);
    const saved = unzipSync(new Uint8Array(await state.editor.save()));
    expect(saved['word/embeddings/opaque.bin']).toEqual(opaque);
  } finally {
    state.dispose();
  }
});

function paddedSource(text: string) {
  const bytes = zipSync(
    { ...unzipSync(source(text)), 'word/embeddings/padding.bin': new Uint8Array(600 * 1024) },
    { level: 0 }
  );
  expect(bytes.byteLength).toBeGreaterThan(512 * 1024);
  return bytes;
}
test('the latest font replacement survives flushing an earlier deferred refresh', async () => {
  const state = mount({ fonts: fonts() });
  try {
    await until(() => state.editor.fontMeasurement().measurer === 'shaped');
    const oldSurface = state.editor.surface!;
    const refresh = createDocumentRefresh(state.editor);
    const submission = await refresh.capture();
    const next = paddedSource('previously scheduled refresh owner');
    expect(typeof state.container.ownerDocument.defaultView!.requestAnimationFrame).toBe(
      'function'
    );
    const applying = refresh.applyUpdate({ submission, sequence: 1, bytes: next });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(refresh.snapshot().phase).toBe('refreshing');
    expect(state.editor.surface).toBe(oldSurface);
    expect(oldSurface.session.bodyText()).not.toContain('previously scheduled refresh owner');
    await state.editor.setFonts(undefined);
    expect((await applying).ok).toBe(true);
    await until(
      () =>
        state.editor.surface?.session.bodyText().includes('previously scheduled refresh owner') ===
          true && !state.editor.fontMeasurement().resolving
    );
    expect(state.editor.surface!.session).not.toBe(oldSurface.session);
    expect(state.editor.surface!.session.bodyText()).toBe('previously scheduled refresh owner');
    expect(state.editor.fontMeasurement().measurer).toBe('fixed');
    expect(state.editor.surface!.textMeasurer!().hasResolvedFont?.(style) ?? false).toBe(false);
    const saved = unzipSync(new Uint8Array(await state.editor.save()));
    expect(saved['word/embeddings/opaque.bin']).toEqual(opaque);
    expect(saved['word/embeddings/padding.bin']).toHaveLength(600 * 1024);
  } finally {
    state.dispose();
  }
});

test('a replacement keeps the current faces until the new ones install', async () => {
  const pending = deferred<FontConfiguration>(),
    state = mount({ fonts: fonts() });
  try {
    await until(() => state.editor.fontMeasurement().measurer === 'shaped');
    const session = state.editor.surface!.session;
    const measured: string[] = [];
    const off = state.editor.on('change', () =>
      measured.push(state.editor.fontMeasurement().measurer)
    );
    const replaced = state.editor.setFonts(() => pending.promise);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // No fallback frame between the two font sets: the old faces still measure the pages.
    expect(state.editor.fontMeasurement().measurer).toBe('shaped');
    pending.resolve(fonts());
    await replaced;
    off();
    expect(state.editor.fontMeasurement().measurer).toBe('shaped');
    expect(measured).not.toContain('fixed');
    expect(state.editor.surface!.session).toBe(session);
  } finally {
    state.dispose();
  }
});

test('a replacement that supplies nothing usable still removes the replaced faces', async () => {
  const state = mount({ fonts: fonts() });
  try {
    await until(() => state.editor.fontMeasurement().measurer === 'shaped');
    await state.editor.setFonts(() => Promise.resolve(undefined));
    expect(state.editor.fontMeasurement().measurer).toBe('fixed');
    expect(state.editor.fontMeasurement().resolving).toBe(false);
  } finally {
    state.dispose();
  }
});
