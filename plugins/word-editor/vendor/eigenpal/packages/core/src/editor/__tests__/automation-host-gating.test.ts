// A scripted edit obeys the same gate a keystroke does.
//
// The browser host writes into a document a person is looking at, and that person's editor has
// modes: viewing refuses every write, suggesting turns one into a proposal attributed to an
// author. A host that reached the session directly would satisfy none of that — it would type
// into a read-only document and write permanent text while the pill said Suggesting, which is
// precisely the failure the surface's one interception point exists to prevent.
//
// The other half is SCOPE. The surface applies an edit to whatever story the reader is in, so
// while a header is open its input path targets the header. An automation handle for a body
// paragraph must not follow the reader in there: the handle names a body paragraph, and it has
// to keep naming one no matter where the caret happens to be.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, setSystemTime, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createBrowserAutomationHost } from '../automation-host.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import type { AutomationHandle, AutomationHost } from '../../automation/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** A document with an optional default header, so scope has somewhere else to go. */
function docx(header?: string): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  const hasHeader = header !== undefined;
  entries['[Content_Types].xml'] = strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      (hasHeader
        ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
        : '') +
      '</Types>'
  );
  entries['_rels/.rels'] = strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  if (hasHeader) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/></Relationships>`
    );
    entries['word/header1.xml'] = strToU8(`<w:hdr xmlns:w="${W}">${header}</w:hdr>`);
  }
  entries['word/document.xml'] = strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
      `${p('alpha')}${p('beta')}` +
      `<w:sectPr>${hasHeader ? '<w:headerReference w:type="default" r:id="rId10"/>' : ''}</w:sectPr>` +
      '</w:body></w:document>'
  );
  return zipSync(entries);
}

/** A document with one footnote, so the note story has somewhere for a caret to be. */
function noteDocx(): Uint8Array {
  const body =
    `<w:p><w:r><w:t>alpha</w:t></w:r>` +
    `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
    `<w:footnoteReference w:id="1"/></w:r></w:p>`;
  const footnotes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>NOTE</w:t></w:r></w:p></w:footnote>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}${p('beta')}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${footnotes}</w:footnotes>`),
  });
}

/** A document whose body is exactly `body`, for a write that needs particular words. */
function bodyDocx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}"/>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  });
}

/** A document carrying one tracked insertion, so a DECISION has something to decide. */
function revisedDocx(): Uint8Array {
  const body =
    `<w:p><w:r><w:t>alpha</w:t></w:r>` +
    `<w:ins w:id="7" w:author="Ada" w:date="2024-01-01T00:00:00Z">` +
    `<w:r><w:t xml:space="preserve"> proposed</w:t></w:r></w:ins></w:p>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}"/>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  });
}

function mount(options: { author?: string; header?: string; bytes?: Uint8Array } = {}): {
  editor: DocxEditorInstance;
  container: HTMLElement;
  host: AutomationHost;
} {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: options.bytes ?? docx(options.header),
    ...(options.author === undefined ? {} : { author: options.author }),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container, host: createBrowserAutomationHost(editor) };
}

function bodyOf(host: AutomationHost): AutomationHandle {
  const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
  return handleAt(host.execute({ operations: [{ op: 'getBody', document }] }), 0);
}

function paragraphsOf(host: AutomationHost): readonly AutomationHandle[] {
  return handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body: bodyOf(host) }] }), 0);
}

function handlesAt(
  response: { readonly results: readonly { readonly status: string }[] },
  index: number
): readonly AutomationHandle[] {
  const result = response.results[index] as
    { status: 'ok'; value: { kind: string; handles: readonly AutomationHandle[] } } | undefined;
  if (result?.status !== 'ok' || result.value.kind !== 'handles') {
    throw new Error(`expected handles at ${index}`);
  }
  return result.value.handles;
}

function handleAt(
  response: { readonly results: readonly { readonly status: string }[] },
  index: number
): AutomationHandle {
  const result = response.results[index] as
    { status: 'ok'; value: { kind: string; handle: AutomationHandle } } | undefined;
  if (result?.status !== 'ok' || result.value.kind !== 'handle') {
    throw new Error(`expected a handle at ${index}`);
  }
  return result.value.handle;
}

function textOf(host: AutomationHost, target: AutomationHandle): string {
  const response = host.execute({ operations: [{ op: 'getText', target }] });
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'text') throw new Error('expected text');
  return result.value.text;
}

function errorAt(
  response: { readonly results: readonly { readonly status: string }[] },
  index: number
): { code: string; detail?: string } {
  const result = response.results[index] as
    { status: 'error'; error: { code: string; detail?: string } } | undefined;
  if (result?.status !== 'error') throw new Error(`expected an error at ${index}`);
  return result.error;
}

/** One part of a saved package, as text. Empty when the package does not hold it. */
function savedPart(host: AutomationHost, name: string): string {
  const saved = host.save();
  if (!saved.ok) throw new Error(`save failed: ${saved.error.code}`);
  const part = unzipSync(saved.bytes)[name];
  return part === undefined ? '' : new TextDecoder().decode(part);
}

/** The main document part of a saved package, as text — where `w:ins` is visible. */
function savedDocumentXml(host: AutomationHost): string {
  const saved = host.save();
  if (!saved.ok) throw new Error(`save failed: ${saved.error.code}`);
  const part = unzipSync(saved.bytes)['word/document.xml'];
  if (!part) throw new Error('saved package has no main document part');
  return new TextDecoder().decode(part);
}

describe('a scripted write obeys the editing mode', () => {
  test('control: in edit mode the write commits, so the refusals below mean something', () => {
    const { host } = mount();
    const paragraphs = paragraphsOf(host);
    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'X' }],
    });
    expect({ ok: response.ok, changed: response.changed }).toEqual({ ok: true, changed: true });
    expect(textOf(host, paragraphs[0]!)).toBe('Xalpha');
  });

  test('viewing refuses the write, and nothing about the document moves', () => {
    const { host, editor, container } = mount();
    const paragraphs = paragraphsOf(host);
    editor.surface!.setEditingMode('view');
    const events: number[] = [];
    host.subscribe((event) => events.push(event.revision));
    const before = host.revision();

    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'X' }],
    });

    expect({ ok: response.ok, changed: response.changed }).toEqual({ ok: false, changed: false });
    expect(errorAt(response, 0).code).toBe('transaction-refused');
    // The surface's own reason travels through, so a host above this can tell a reader WHY.
    // The surface's sentence leaves as its public code.
    expect(errorAt(response, 0).detail).toBe('edit.read-only');
    expect(textOf(host, paragraphs[0]!)).toBe('alpha');
    expect(host.revision()).toBe(before);
    expect(container.textContent).not.toContain('Xalpha');
    expect(events).toEqual([]);
  });

  test('suggesting with an author proposes the insertion rather than writing it outright', () => {
    const { host, editor } = mount({ author: 'Ada' });
    const paragraphs = paragraphsOf(host);
    editor.surface!.setEditingMode('suggest');

    const response = host.execute({
      operations: [
        { op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'Draft' },
      ],
    });

    expect({ ok: response.ok, changed: response.changed }).toEqual({ ok: true, changed: true });
    expect(textOf(host, paragraphs[0]!)).toBe('Draftalpha');
    const xml = savedDocumentXml(host);
    expect(xml).toContain('w:ins');
    expect(xml).toContain('Ada');
  });

  test('suggesting refuses page and section breaks that no runtime author tracks', () => {
    const { host, editor } = mount({ author: 'Ada' });
    const paragraphs = paragraphsOf(host);
    editor.surface!.setEditingMode('suggest');
    const before = savedDocumentXml(host);
    for (const breakType of ['Page', 'SectionNext'] as const) {
      const at = { paragraph: paragraphs[0]!, offset: 2 };
      const response = host.execute({
        operations: [
          { op: 'insertBreak', span: { start: at, end: at }, breakType, location: 'Before' },
        ],
      });
      expect(response.ok).toBe(false);
      expect(errorAt(response, 0).code).toBe('unsupported-capability');
    }
    expect(savedDocumentXml(host)).toBe(before);
  });

  test('suggesting writes a replacement as Word does and answers where the text landed', () => {
    // A scripted `Range.insertText(…, 'Replace')` aims the insertion where the range began,
    // which in suggesting mode is the front edge of the fresh strike. The store puts the
    // replacement AFTER the struck words — `w:del` then `w:ins`, each under its own id, as
    // Word writes it (#691) — so the answered span must name where the text actually sits,
    // not the struck words it was aimed at.
    const { host, editor } = mount({
      author: 'Ada',
      bytes: bodyDocx(
        '<w:p><w:r><w:t xml:space="preserve">The Receiving Party shall hold it.</w:t></w:r></w:p>'
      ),
    });
    editor.surface!.setEditingMode('suggest');
    const body = bodyOf(host);
    const found = host.execute({
      operations: [{ op: 'search', scope: { body }, text: 'Receiving Party' }],
    });
    const hit = found.results[0];
    if (hit?.status !== 'ok' || hit.value.kind !== 'spans' || !hit.value.spans[0]) {
      throw new Error('expected one search result');
    }

    const write = host.execute({
      operations: [{ op: 'replaceSpan', span: hit.value.spans[0], text: 'Recipient' }],
    });
    expect({ ok: write.ok, changed: write.changed }).toEqual({ ok: true, changed: true });
    const answered = write.results[0];
    if (answered?.status !== 'ok' || answered.value.kind !== 'span') {
      throw new Error('expected the written span');
    }
    const readBack = host.execute({
      operations: [{ op: 'getSpanText', span: answered.value.span, projection: 'allMarkup' }],
    });
    const text = readBack.results[0];
    if (text?.status !== 'ok' || text.value.kind !== 'text') throw new Error('expected text');
    expect(text.value.text).toBe('Recipient');

    const xml = savedDocumentXml(host);
    const struck = xml.indexOf('<w:del ');
    const inserted = xml.indexOf('<w:ins ');
    expect(struck).toBeGreaterThan(-1);
    expect(inserted).toBeGreaterThan(struck);
    const ids = [...xml.matchAll(/<w:(?:ins|del) [^>]*w:id="(\d+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  test('two replacements in one batch, in edit mode, each answer their own text', () => {
    // The answer is the planned landing, not an inference from the paragraph's length after
    // the whole batch — which counted the first replacement's growth into the second's span.
    const { host } = mount({
      bytes: bodyDocx(
        '<w:p><w:r><w:t>The quick brown fox jumps over the lazy dog.</w:t></w:r></w:p>'
      ),
    });
    const body = bodyOf(host);
    const found = host.execute({
      operations: [
        { op: 'search', scope: { body }, text: 'lazy' },
        { op: 'search', scope: { body }, text: 'quick' },
      ],
    });
    const lazy = found.results[0];
    const quick = found.results[1];
    if (lazy?.status !== 'ok' || lazy.value.kind !== 'spans' || !lazy.value.spans[0])
      throw new Error('lazy');
    if (quick?.status !== 'ok' || quick.value.kind !== 'spans' || !quick.value.spans[0])
      throw new Error('quick');
    const write = host.execute({
      operations: [
        { op: 'replaceSpan', span: lazy.value.spans[0], text: 'sleepy' },
        { op: 'replaceSpan', span: quick.value.spans[0], text: 'extraordinarily fast' },
      ],
    });
    expect(write.ok).toBe(true);
    const second = write.results[1];
    if (second?.status !== 'ok' || second.value.kind !== 'span') throw new Error('expected a span');
    const read = host.execute({ operations: [{ op: 'getSpanText', span: second.value.span }] });
    const text = read.results[0];
    if (text?.status !== 'ok' || text.value.kind !== 'text') throw new Error('expected text');
    expect(text.value.text).toBe('extraordinarily fast');
  });

  test('suggesting over words another author already struck lands after them, and says so', () => {
    // Nothing of the range is struck by THIS edit, so the front edge of the range is the front
    // edge of Grace's deletion. The landing rule aims past it, as typing does; the new text
    // sits after the struck words, and the answered span names it.
    const { host, editor } = mount({
      author: 'Ada',
      bytes: bodyDocx(
        '<w:p><w:r><w:t xml:space="preserve">The </w:t></w:r>' +
          '<w:del w:id="3" w:author="Grace" w:date="2020-01-01T00:00:00Z">' +
          '<w:r><w:delText>Receiving Party</w:delText></w:r></w:del>' +
          '<w:r><w:t xml:space="preserve"> shall hold it.</w:t></w:r></w:p>'
      ),
    });
    editor.surface!.setEditingMode('suggest');
    const body = bodyOf(host);
    const found = host.execute({
      operations: [
        {
          op: 'search',
          scope: { body },
          text: 'Receiving Party',
          options: { projection: 'allMarkup' },
        },
      ],
    });
    const hit = found.results[0];
    if (hit?.status !== 'ok' || hit.value.kind !== 'spans' || !hit.value.spans[0]) {
      throw new Error('expected one search result');
    }
    const write = host.execute({
      operations: [{ op: 'replaceSpan', span: hit.value.spans[0], text: 'Recipient' }],
    });
    expect(write.ok).toBe(true);
    const answered = write.results[0];
    if (answered?.status !== 'ok' || answered.value.kind !== 'span')
      throw new Error('expected a span');
    const read = host.execute({
      operations: [{ op: 'getSpanText', span: answered.value.span, projection: 'allMarkup' }],
    });
    const text = read.results[0];
    if (text?.status !== 'ok' || text.value.kind !== 'text') throw new Error('expected text');
    expect(text.value.text).toBe('Recipient');
    const xml = savedDocumentXml(host);
    expect(xml.indexOf('<w:del ')).toBeLessThan(xml.indexOf('<w:ins '));
  });

  test('replacing with nothing in suggesting mode answers where a replacement would go', () => {
    const { host, editor } = mount({
      author: 'Ada',
      bytes: bodyDocx('<w:p><w:r><w:t>alpha beta</w:t></w:r></w:p>'),
    });
    editor.surface!.setEditingMode('suggest');
    const body = bodyOf(host);
    const found = host.execute({ operations: [{ op: 'search', scope: { body }, text: 'beta' }] });
    const hit = found.results[0];
    if (hit?.status !== 'ok' || hit.value.kind !== 'spans' || !hit.value.spans[0])
      throw new Error('hit');
    const write = host.execute({
      operations: [{ op: 'replaceSpan', span: hit.value.spans[0], text: '' }],
    });
    expect(write.ok).toBe(true);
    const answered = write.results[0];
    if (answered?.status !== 'ok' || answered.value.kind !== 'span')
      throw new Error('expected a span');
    // The struck words keep their offsets, so the spot after them is the range END.
    expect(answered.value.span.start.offset).toBe('alpha beta'.length);
    expect(answered.value.span.end.offset).toBe('alpha beta'.length);
  });

  test('a scripted replacement across a paragraph mark lands after the struck head', () => {
    // The whole range is struck, the mark between the paragraphs is proposed deleted, and the
    // new text goes after the FIRST paragraph's struck tail. Not the last paragraph, where
    // typing puts it: the proposed merge really merges when the first paragraph's mark is
    // this author's own pending insertion, and an op naming the second paragraph would then
    // veto the transaction.
    const { host, editor } = mount({ author: 'Ada' });
    editor.surface!.setEditingMode('suggest');
    const paragraphs = paragraphsOf(host);
    const write = host.execute({
      operations: [
        {
          op: 'replaceSpan',
          span: {
            start: { paragraph: paragraphs[0]!, offset: 2 },
            end: { paragraph: paragraphs[1]!, offset: 2 },
          },
          text: 'XY',
        },
      ],
    });
    expect({ ok: write.ok, changed: write.changed }).toEqual({ ok: true, changed: true });
    const answered = write.results[0];
    if (answered?.status !== 'ok' || answered.value.kind !== 'span') {
      throw new Error('expected a span');
    }
    const read = host.execute({
      operations: [{ op: 'getSpanText', span: answered.value.span, projection: 'allMarkup' }],
    });
    const text = read.results[0];
    if (text?.status !== 'ok' || text.value.kind !== 'text') throw new Error('expected text');
    expect(text.value.text).toBe('XY');
    const xml = savedDocumentXml(host);
    expect(xml).toMatch(
      /<w:delText>pha<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t>XY<\/w:t><\/w:r><\/w:ins>/
    );
  });

  test('a spanning replacement commits when the first mark is the author’s own insertion', () => {
    // The proposed merge REALLY merges here — the first paragraph retracts its own mark, so
    // the second leaves the tree. Writing the new text into that second paragraph refused the
    // whole batch with `unknown-paragraph`, and the scripted edit did nothing at all.
    const { host, editor } = mount({
      author: 'Ada',
      bytes: bodyDocx(
        '<w:p><w:pPr><w:rPr><w:ins w:id="4" w:author="Ada" w:date="2026-09-01T00:00:00Z"/></w:rPr></w:pPr>' +
          '<w:r><w:t>alpha</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>beta</w:t></w:r></w:p>'
      ),
    });
    editor.surface!.setEditingMode('suggest');
    const paragraphs = paragraphsOf(host);
    const write = host.execute({
      operations: [
        {
          op: 'replaceSpan',
          span: {
            start: { paragraph: paragraphs[0]!, offset: 2 },
            end: { paragraph: paragraphs[1]!, offset: 2 },
          },
          text: 'XY',
        },
      ],
    });
    expect({ ok: write.ok, changed: write.changed }).toEqual({ ok: true, changed: true });
    // Pinned: the merge really happens, so the words land after the FIRST paragraph's struck
    // tail and the second paragraph's strike follows them into the merged host.
    expect(savedDocumentXml(host)).toMatch(
      /<w:delText>pha<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t>XY<\/w:t><\/w:r><\/w:ins><w:del[^>]*><w:r><w:delText>be<\/w:delText>/
    );
  });

  test("setting a whole story's text in suggesting mode answers the new words", () => {
    // `Body.insertText(…, 'Replace')` strikes the story and writes its text after the struck
    // words, the same relocation a span replacement gets. Answering offset 0 named the struck
    // words instead, so a script that formatted what it wrote formatted the strike.
    const { host, editor } = mount({
      author: 'Ada',
      bytes: bodyDocx('<w:p><w:r><w:t>alpha beta</w:t></w:r></w:p>'),
    });
    editor.surface!.setEditingMode('suggest');
    const body = bodyOf(host);
    const write = host.execute({
      operations: [{ op: 'replaceSpan', span: { body }, text: 'omega' }],
    });
    expect({ ok: write.ok, changed: write.changed }).toEqual({ ok: true, changed: true });
    const answered = write.results[0];
    if (answered?.status !== 'ok' || answered.value.kind !== 'span') {
      throw new Error('expected a span');
    }
    const read = host.execute({
      operations: [{ op: 'getSpanText', span: answered.value.span, projection: 'allMarkup' }],
    });
    const text = read.results[0];
    if (text?.status !== 'ok' || text.value.kind !== 'text') throw new Error('expected text');
    expect(text.value.text).toBe('omega');
    const xml = savedDocumentXml(host);
    expect(xml.indexOf('<w:del ')).toBeLessThan(xml.indexOf('<w:ins '));
  });

  test('a replacement whose strike JOINS one already standing answers the new words', () => {
    // The fresh strike merges with Ada\'s existing one, so the store clears the whole merged
    // wrapper before writing. The planner predicted the shorter, unmerged landing and answered
    // a span over the struck words instead of over what replaced them.
    const { host, editor } = mount({
      author: 'Ada',
      bytes: bodyDocx(
        '<w:p><w:r><w:t xml:space="preserve">hello </w:t></w:r>' +
          '<w:del w:id="5" w:author="Ada" w:date="2026-09-04T00:00:00Z">' +
          '<w:r><w:delText>world</w:delText></w:r></w:del></w:p>'
      ),
    });
    editor.surface!.setEditingMode('suggest');
    const body = bodyOf(host);
    const found = host.execute({
      operations: [
        { op: 'search', scope: { body }, text: 'hello ', options: { projection: 'allMarkup' } },
      ],
    });
    const hit = found.results[0];
    if (hit?.status !== 'ok' || hit.value.kind !== 'spans' || !hit.value.spans[0]) {
      throw new Error('expected one search result');
    }
    const write = host.execute({
      operations: [{ op: 'replaceSpan', span: hit.value.spans[0], text: 'hi ' }],
    });
    expect(write.ok).toBe(true);
    const answered = write.results[0];
    if (answered?.status !== 'ok' || answered.value.kind !== 'span') {
      throw new Error('expected a span');
    }
    const read = host.execute({
      operations: [{ op: 'getSpanText', span: answered.value.span, projection: 'allMarkup' }],
    });
    const text = read.results[0];
    if (text?.status !== 'ok' || text.value.kind !== 'text') throw new Error('expected text');
    expect(text.value.text).toBe('hi ');
  });

  test('typing over your own pending insertion plus a strike lands before the live words', () => {
    // The landing rule maps past the strike in the paragraph\'s PRE-edit offsets and only then
    // subtracts what this author\'s own insertion retracts. Mixing the two spaces read the
    // post-retraction offset against pre-edit spans and carried the words past "gh", which the
    // edit never touched.
    const { editor } = mount({
      author: 'Ada',
      bytes: bodyDocx(
        '<w:p><w:ins w:id="1" w:author="Ada" w:date="2026-09-04T00:00:00Z">' +
          '<w:r><w:t>ab</w:t></w:r></w:ins>' +
          '<w:del w:id="2" w:author="Ada" w:date="2026-09-04T00:00:00Z">' +
          '<w:r><w:delText>cd</w:delText></w:r></w:del><w:r><w:t>gh</w:t></w:r></w:p>'
      ),
    });
    const surface = editor.surface!;
    surface.setEditingMode('suggest');
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 4 },
    });
    surface.type('X');
    const out = serializeOoxmlPart(surface.session.part());
    expect(out).toMatch(
      /<w:delText>cd<\/w:delText><\/w:r><\/w:del><w:ins[^>]*><w:r><w:t>X<\/w:t><\/w:r><\/w:ins><w:r><w:t>gh<\/w:t>/
    );
  });

  test('a zero-width replaceSpan writes exactly where an insert at the same point writes', () => {
    // Both documents must receive the same revision timestamp even across a wall-clock second.
    setSystemTime(new Date('2026-09-06T12:00:00Z'));
    try {
      // It strikes nothing, so it replaces nothing, and the landing rule has no words to put it
      // after. Asking anyway carried it past a whole chain of struck text it never named.
      const paragraph =
        '<w:p><w:r><w:t>AA</w:t></w:r>' +
        '<w:del w:id="7" w:author="Ada" w:date="2026-09-04T00:00:00Z">' +
        '<w:r><w:delText>BB</w:delText></w:r></w:del>' +
        '<w:bookmarkStart w:id="1" w:name="m"/>' +
        '<w:del w:id="7" w:author="Ada" w:date="2026-09-04T00:00:00Z">' +
        '<w:r><w:delText>CC</w:delText></w:r></w:del>' +
        '<w:bookmarkEnd w:id="1"/><w:r><w:t>DD</w:t></w:r></w:p>';

      const replaced = mount({ author: 'Ada', bytes: bodyDocx(paragraph) });
      replaced.editor.surface!.setEditingMode('suggest');
      const target = paragraphsOf(replaced.host)[0]!;
      expect(
        replaced.host.execute({
          operations: [
            {
              op: 'replaceSpan',
              span: {
                start: { paragraph: target, offset: 3 },
                end: { paragraph: target, offset: 3 },
              },
              text: 'X',
            },
          ],
        }).ok
      ).toBe(true);

      const inserted = mount({ author: 'Ada', bytes: bodyDocx(paragraph) });
      inserted.editor.surface!.setEditingMode('suggest');
      expect(
        inserted.host.execute({
          operations: [
            {
              op: 'insertText',
              at: { paragraph: paragraphsOf(inserted.host)[0]!, offset: 3 },
              text: 'X',
            },
          ],
        }).ok
      ).toBe(true);

      expect(savedDocumentXml(replaced.host)).toBe(savedDocumentXml(inserted.host));
    } finally {
      setSystemTime();
    }
  });

  test('a batch settles buffered typing before it plans, and refuses a stale expectation', () => {
    // Coalesced keystrokes land as their own transaction the moment the host reads the
    // surface. Settled at the batch's entry, so `expectedRevision` is compared against the
    // document the batch will actually write to rather than the one it was about to leave.
    const { host, editor } = mount();
    const before = host.revision();
    const paragraphs = paragraphsOf(host);
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    editor.surface!.enqueueType('QQQ');

    // The stale expectation is refused rather than silently planned against.
    const stale = host.execute({
      expectedRevision: before,
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'Z' }],
    });
    expect(stale.ok).toBe(false);
    // And the buffered keystrokes are in the document, not still pending.
    expect(textOf(host, paragraphs[0]!)).toBe('QQQalpha');
    expect(host.revision()).toBeGreaterThan(before);

    // A batch that names the settled revision goes through.
    const fresh = host.execute({
      expectedRevision: host.revision(),
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'Z' }],
    });
    expect(fresh.ok).toBe(true);
    expect(textOf(host, paragraphs[0]!)).toBe('ZQQQalpha');
  });

  test('suggesting with no author refuses, exactly as a keystroke would', () => {
    // Preserved rather than reinvented: the surface refuses every edit in this state because
    // `CT_TrackChange` has nowhere to put an author, and writing an untracked change instead
    // would edit someone else's document while the review pane stayed empty.
    const { host, editor } = mount();
    const paragraphs = paragraphsOf(host);
    editor.surface!.setEditingMode('suggest');

    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'X' }],
    });

    expect(response.ok).toBe(false);
    expect(errorAt(response, 0).code).toBe('transaction-refused');
    expect(errorAt(response, 0).detail).toContain('author');
    expect(textOf(host, paragraphs[0]!)).toBe('alpha');
    expect(savedDocumentXml(host)).not.toContain('w:ins');
  });

  test('viewing refuses a link, and the relationships are the file’s own', () => {
    const { host, editor } = mount();
    const paragraphs = paragraphsOf(host);
    editor.surface!.setEditingMode('view');
    const before = savedPart(host, 'word/_rels/document.xml.rels');

    const response = host.execute({
      operations: [
        {
          op: 'setHyperlink',
          span: {
            start: { paragraph: paragraphs[0]!, offset: 0 },
            end: { paragraph: paragraphs[0]!, offset: 5 },
          },
          target: 'https://example.com/viewing',
        },
      ],
    });

    expect(response.ok).toBe(false);
    // The surface's sentence leaves as its public code.
    expect(errorAt(response, 0).detail).toBe('edit.read-only');
    // A relationship is minted on the PACKAGE, outside the undo stack and outside the mode gate
    // it was once minted before. A document open for reading must come out of a refused batch
    // byte-identical, or a reader has an external target in their file that they never authored.
    expect(savedPart(host, 'word/_rels/document.xml.rels')).toBe(before);
    expect(savedPart(host, 'word/_rels/document.xml.rels')).not.toContain('example.com/viewing');
  });

  test('suggesting with no author refuses a link, and mints nothing for it', () => {
    // The mint asks the mode the same question an edit asks, because it IS one: a relationship the
    // batch that needed it never got is a change to a document nobody was allowed to change.
    const { host, editor } = mount();
    const paragraphs = paragraphsOf(host);
    editor.surface!.setEditingMode('suggest');
    const before = savedPart(host, 'word/_rels/document.xml.rels');

    const response = host.execute({
      operations: [
        {
          op: 'setHyperlink',
          span: {
            start: { paragraph: paragraphs[0]!, offset: 0 },
            end: { paragraph: paragraphs[0]!, offset: 5 },
          },
          target: 'https://example.com/unattributed',
        },
      ],
    });

    expect(response.ok).toBe(false);
    expect(errorAt(response, 0).code).toBe('unsupported-capability');
    expect(savedPart(host, 'word/_rels/document.xml.rels')).toBe(before);
  });

  test('a tracked-change decision still lands where an edit would be refused', () => {
    // Deciding an existing change is not authoring one, so it needs no author — and the gate the
    // link's mint added must not have quietly turned every automation batch into an edit.
    const { host, editor } = mount({ bytes: revisedDocx() });
    const paragraphs = paragraphsOf(host);
    editor.surface!.setEditingMode('suggest');
    const listed = host.execute({ operations: [{ op: 'getRevisions', body: bodyOf(host) }] });
    const revision = handlesAt(listed, 0)[0]!;

    const response = host.execute({ operations: [{ op: 'acceptRevision', revision }] });

    expect(response.ok).toBe(true);
    expect(textOf(host, paragraphs[0]!)).toBe('alpha proposed');
    expect(savedDocumentXml(host)).not.toContain('w:ins');
  });

  test('a refused mode leaves the editor usable once the mode allows writing again', () => {
    const { host, editor } = mount();
    const paragraphs = paragraphsOf(host);
    editor.surface!.setEditingMode('view');
    host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'X' }],
    });
    editor.surface!.setEditingMode('edit');
    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'Y' }],
    });
    expect(response.ok).toBe(true);
    expect(textOf(host, paragraphs[0]!)).toBe('Yalpha');
  });
});

describe('a body handle names the body, wherever the reader is', () => {
  test('an automation write lands in the body while a header is open for editing', () => {
    const { host, editor } = mount({ header: p('HEADER') });
    const paragraphs = paragraphsOf(host);
    const surface = editor.surface!;
    expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rId10' });

    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'B' }],
    });

    expect(response.ok).toBe(true);
    expect(textOf(host, paragraphs[0]!)).toBe('Balpha');
    expect(surface.session.storyText({ kind: 'headerFooter', rId: 'rId10' })).toBe('HEADER');
  });

  test("and the reader's own typing still goes to the header, so scope was not broken", () => {
    // The control for the test above: forcing the body for automation must not force it for
    // the input path, or every header edit would land in the document instead.
    const { host, editor } = mount({ header: p('HEADER') });
    const paragraphs = paragraphsOf(host);
    const surface = editor.surface!;
    surface.enterHeaderFooter({ rId: 'rId10' });
    surface.type('Z');
    expect(surface.session.storyText({ kind: 'headerFooter', rId: 'rId10' })).toContain('Z');
    expect(textOf(host, paragraphs[0]!)).toBe('alpha');
  });
});

describe('a body write does not drag the reader out of the story they are in', () => {
  // The commit that follows a scripted edit re-clamps the caret, because an edit can remove the
  // characters it was sitting in. Clamping against the BODY's paragraphs while the reader is in
  // a header or a note is how a caret ends up naming a paragraph that story does not contain:
  // the scope stays furniture, the caret moves into the document, and the next keystroke is
  // applied to the header story with a body paragraph id — refused as `unknown-paragraph`, so
  // the reader types and nothing happens.

  test('the caret stays put in an open header, and typing still lands there', () => {
    const { host, editor } = mount({ header: p('HEADER') });
    const paragraphs = paragraphsOf(host);
    const surface = editor.surface!;
    surface.enterHeaderFooter({ rId: 'rId10' });
    const headerId = surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rId10' })[0]!;
    surface.setSelection({
      anchor: { paragraphId: headerId, offset: 3 },
      head: { paragraphId: headerId, offset: 3 },
    });
    const caretBefore = surface.state().selection;

    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'B' }],
    });
    expect(response.ok).toBe(true);

    expect(surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rId10' });
    expect(surface.state().selection).toEqual(caretBefore);

    surface.type('K');
    expect(surface.state().lastRejection).toBeNull();
    expect(surface.session.storyText({ kind: 'headerFooter', rId: 'rId10' })).toBe('HEAKDER');
    // And the scripted edit itself still went to the body, unaffected by the caret's story.
    expect(textOf(host, paragraphs[0]!)).toBe('Balpha');
  });

  test('the caret stays put in an open footnote, and typing still lands there', () => {
    const { host, editor } = mount({ bytes: noteDocx() });
    const paragraphs = paragraphsOf(host);
    const surface = editor.surface!;
    expect(surface.enterNote('footnote:1')).toBe(true);
    const caretBefore = surface.state().selection;
    expect(caretBefore.head.paragraphId).toContain('footnotes.xml');

    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[1]!, offset: 0 }, text: 'B' }],
    });
    expect(response.ok).toBe(true);

    expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:1' });
    expect(surface.state().selection).toEqual(caretBefore);

    surface.type('!');
    expect(surface.state().lastRejection).toBeNull();
    expect(surface.session.storyText({ kind: 'notesPart', noteKind: 'footnote' })).toContain('!');
    expect(textOf(host, paragraphs[1]!)).toBe('Bbeta');
    expect(textOf(host, paragraphs[0]!)).not.toContain('!');
  });

  test('a body reader is still re-clamped, so the clamp was scoped and not removed', () => {
    // The control. Body selection must keep being clamped by the same commit — dropping the
    // clamp instead of scoping it would leave a caret past the end of a shortened paragraph.
    const { host, editor } = mount();
    const paragraphs = paragraphsOf(host);
    const surface = editor.surface!;
    const bodyId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: bodyId, offset: 5 },
      head: { paragraphId: bodyId, offset: 5 },
    });

    host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'B' }],
    });

    const { anchor, head } = surface.state().selection;
    expect(anchor.paragraphId).toBe(bodyId);
    expect(head.paragraphId).toBe(bodyId);
    expect(head.offset).toBeLessThanOrEqual(6);
    surface.type('K');
    expect(surface.state().lastRejection).toBeNull();
    expect(textOf(host, paragraphs[0]!)).toContain('K');
  });
});
