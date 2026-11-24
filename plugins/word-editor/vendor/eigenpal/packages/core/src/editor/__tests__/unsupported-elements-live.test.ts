import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function source() {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:x="urn:widgets"><w:body><w:p><w:r><w:t>Hello</w:t><x:chip data="one"/></w:r></w:p><x:widget data="two"/><w:p><w:r><w:t>End</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

test('live registrations reveal inline and block unknown content, preserve edits and undo, and leave source XML intact', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: source() });
  try {
    expect(container.querySelectorAll('[data-docx-unsupported]').length).toBe(0);
    expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    const session = editor.surface!.session;
    const selection = editor.surface!.state().selection;
    editor.setUnsupportedElementRules([
      {
        match: (element) => element.namespaceUri === 'urn:widgets',
        layout: { width: 60, height: 30 },
      },
    ]);
    expect(editor.surface!.session).toBe(session);
    expect(editor.surface!.state().selection).toEqual(selection);
    expect(container.querySelectorAll('[data-docx-unsupported]').length).toBe(2);
    const firstBox = container.querySelector<HTMLElement>('[data-docx-unsupported]')!.style.cssText;
    editor.setUnsupportedElementRules([
      {
        match: (element) => element.namespaceUri === 'urn:widgets',
        layout: { width: 90, height: 45 },
      },
    ]);
    expect(container.querySelector<HTMLElement>('[data-docx-unsupported]')!.style.cssText).not.toBe(
      firstBox
    );
    const version = editor.stateVersion();
    editor.setUnsupportedElementRules([
      {
        match: (element) => element.namespaceUri === 'urn:widgets',
        layout: { width: 90, height: 45 },
      },
    ]);
    expect(editor.stateVersion()).toBe(version);
    const saved = await editor.save();
    const xml = strFromU8(unzipSync(new Uint8Array(saved!))['word/document.xml']!);
    expect(xml).toContain('x:chip');
    expect(xml).toContain('x:widget');
    expect(xml).not.toContain('docx-unsupported');
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(editor.surface!.session.bodyText()).not.toContain('XHello');
    editor.setUnsupportedElementRules([]);
    expect(container.querySelectorAll('[data-docx-unsupported]').length).toBe(0);
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('invalid dimensions fail before replacing active registrations', () => {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: source(), unsupportedElementRules: [{}] });
  try {
    expect(container.querySelectorAll('[data-docx-unsupported]').length).toBe(2);
    expect(() =>
      editor.setUnsupportedElementRules([{ layout: { width: NaN, height: 20 } }])
    ).toThrow(RangeError);
    expect(container.querySelectorAll('[data-docx-unsupported]').length).toBe(2);
  } finally {
    editor.destroy();
  }
});

test('rendered graphics opt into preview slots without changing layout, source, or selection', async () => {
  const { previewDocument, previewShape } =
    await import('../../store/__tests__/drawing-support-fixtures.ts');
  const { observeUnsupportedElements, unsupportedElementRuleMatches } = await import('../index.ts');
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: previewDocument(previewShape('<a:effectLst><a:blur rad="127000"/></a:effectLst>')),
  });
  let hosts: readonly import('../../output/unsupported-elements.ts').UnsupportedElementHost[] = [];
  const stop = observeUnsupportedElements(container, (next) => {
    hosts = next;
  });
  try {
    expect(container.querySelector('svg')).not.toBeNull();
    expect(hosts).toHaveLength(0);
    const selection = editor.surface!.state().selection;
    const before = editor.surface!.layout();
    editor.setUnsupportedElementRules([{ includePartial: true }]);
    expect(hosts).toHaveLength(1);
    const host = hosts[0]!;
    expect(host.unsupported.support).toBe('partial');
    expect(host.unsupported.drawingIssues).toContainEqual(
      expect.objectContaining({ detail: 'a:blur' })
    );
    expect(unsupportedElementRuleMatches({}, host.unsupported)).toBe(false);
    expect(unsupportedElementRuleMatches({ includePartial: true }, host.unsupported)).toBe(true);
    expect(host.fallback.hidden).toBe(false);
    host.slot.append(document.createElement('img'));
    host.setCustomized(true);
    expect(host.fallback.hidden).toBe(true);
    host.setCustomized(false);
    expect(host.fallback.hidden).toBe(false);
    expect(editor.surface!.layout()).toBe(before);
    expect(editor.surface!.state().selection).toEqual(selection);
    const saved = await editor.save();
    const xml = strFromU8(unzipSync(new Uint8Array(saved!))['word/document.xml']!);
    expect(xml).toContain('a:blur');
    expect(xml).not.toContain('docx-drawing-native');
    editor.setUnsupportedElementRules([]);
    expect(container.querySelector('[data-docx-unsupported]')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  } finally {
    stop();
    editor.destroy();
    container.remove();
  }
});

test('rendered-graphic opt-in keeps unchanged blocks when text elsewhere changes', async () => {
  const { previewDocument, previewShape } =
    await import('../../store/__tests__/drawing-support-fixtures.ts');
  const { observeUnsupportedElements } = await import('../index.ts');
  const paragraphs = Array.from(
    { length: 8 },
    (_, i) => `<w:p><w:r><w:t>Paragraph ${i}</w:t></w:r></w:p>`
  ).join('');
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: previewDocument(
      `${previewShape('<a:effectLst><a:blur rad="127000"/></a:effectLst>')}</w:r></w:p>${paragraphs}<w:p><w:r>`
    ),
    unsupportedElementRules: [{ includePartial: true }],
  });
  let hosts: readonly import('../../output/unsupported-elements.ts').UnsupportedElementHost[] = [];
  const stop = observeUnsupportedElements(container, (next) => {
    hosts = next;
  });
  try {
    expect(hosts).toHaveLength(1);
    const drawing = container.querySelector('svg');
    const slot = hosts[0]!.slot;
    const ids = editor.surface!.session.paragraphIds();
    const target = ids[ids.length - 2]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: target, offset: 2 },
      head: { paragraphId: target, offset: 2 },
    });
    expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    expect(container.querySelector('svg')).toBe(drawing);
    expect(hosts[0]!.slot).toBe(slot);
  } finally {
    stop();
    editor.destroy();
    container.remove();
  }
});

test('includePartial offers partly rendered drawings only, never fully supported ones', async () => {
  const { smartArtDocx } = await import('../../store/__tests__/smartart-fixture.ts');
  const { previewDocument, previewShape } =
    await import('../../store/__tests__/drawing-support-fixtures.ts');
  const { observeUnsupportedElements } = await import('../index.ts');
  for (const [bytes, expected] of [
    [smartArtDocx({ shapes: [{ preset: 'rect', off: [1000, 2000], ext: [3000, 4000] }] }), 0],
    [previewDocument(previewShape()), 0],
    [
      previewDocument(previewShape('<a:scene3d><a:camera prst="orthographicFront"/></a:scene3d>')),
      1,
    ],
  ] as const) {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: bytes,
      unsupportedElementRules: [{ includePartial: true }],
    });
    let hosts: readonly import('../../output/unsupported-elements.ts').UnsupportedElementHost[] =
      [];
    const stop = observeUnsupportedElements(container, (next) => {
      hosts = next;
    });
    try {
      expect(hosts).toHaveLength(expected);
      for (const host of hosts) {
        expect(host.unsupported.support).toBe('partial');
        expect(host.unsupported.graphicKind).toBe('textbox');
        expect(host.unsupported.drawingIssues).toContainEqual(
          expect.objectContaining({ code: 'unverified-3d' })
        );
      }
    } finally {
      stop();
      editor.destroy();
      container.remove();
    }
  }
});

test('an occurrence keeps its source object until the drawing itself changes', async () => {
  const { previewDocument, previewShape } =
    await import('../../store/__tests__/drawing-support-fixtures.ts');
  const { observeUnsupportedElements } = await import('../index.ts');
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: previewDocument(previewShape('<a:effectLst><a:blur rad="127000"/></a:effectLst>')),
    unsupportedElementRules: [{ includePartial: true }],
  });
  let hosts: readonly import('../../output/unsupported-elements.ts').UnsupportedElementHost[] = [];
  const stop = observeUnsupportedElements(container, (next) => {
    hosts = next;
  });
  try {
    const source = hosts[0]!.unsupported.source;
    // Typing in the drawing's own paragraph repaints it, but the drawing stays the same.
    const paragraph = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraph, offset: 1 },
      head: { paragraphId: paragraph, offset: 1 },
    });
    expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]!.unsupported.source).toBe(source);
  } finally {
    stop();
    editor.destroy();
    container.remove();
  }
});
