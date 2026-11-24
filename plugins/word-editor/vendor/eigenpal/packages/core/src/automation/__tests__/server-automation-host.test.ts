// The headless automation host: the same protocol a browser host serves, with no browser.
//
// What these tests pin down is the part an object model cannot check for itself: that a
// batch is ORDERED and ATOMIC, that a refused command writes nothing at all, that handles
// carry no engine identity a consumer could reach through, and that every refusal has a
// code rather than a thrown string.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { createServerAutomationHost } from '../server-host.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

const TWO_PARAGRAPHS = docx(`${p('alpha')}${p('beta')}`);

function open(bytes: Uint8Array = TWO_PARAGRAPHS): AutomationHost {
  const opened = createServerAutomationHost(bytes);
  if (!opened.ok) throw new Error(`host did not open: ${opened.reason}`);
  return opened.host;
}

/** The document/body/paragraph handles of a freshly opened host, in one batch. */
function handles(host: AutomationHost): {
  document: AutomationHandle;
  body: AutomationHandle;
  paragraphs: readonly AutomationHandle[];
} {
  const first = host.execute({ operations: [{ op: 'getDocument' }] });
  const document = expectHandle(first, 0);
  const second = host.execute({ operations: [{ op: 'getBody', document }] });
  const body = expectHandle(second, 0);
  const third = host.execute({ operations: [{ op: 'getParagraphs', body }] });
  const result = third.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'handles') {
    throw new Error('expected paragraph handles');
  }
  return { document, body, paragraphs: result.value.handles };
}

function expectHandle(
  response: { readonly results: readonly { readonly status: string }[] },
  index: number
): AutomationHandle {
  const result = response.results[index] as
    { status: 'ok'; value: { kind: string; handle?: AutomationHandle } } | undefined;
  if (result?.status !== 'ok' || result.value.kind !== 'handle' || !result.value.handle) {
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

describe('opening untrusted bytes', () => {
  test('a package the bounded reader refuses is a typed rejection, not a throw', () => {
    const opened = createServerAutomationHost(new Uint8Array([1, 2, 3, 4]));
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(typeof opened.reason).toBe('string');
  });

  test('a zip with no main document part is refused before a host exists', () => {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(`<Types xmlns="${CT}"/>`),
      '_rels/.rels': strToU8(`<Relationships xmlns="${REL}"/>`),
    });
    const opened = createServerAutomationHost(bytes);
    expect(opened.ok).toBe(false);
  });

  test('a real package opens and reports what it can do', () => {
    const host = open();
    expect(host.capabilities).toEqual({
      document: true,
      save: true,
      events: true,
      selection: false,
      scrolling: false,
      layout: false,
    });
    expect(Object.isFrozen(host.capabilities)).toBe(true);
    expect(host.revision()).toBe(0);
  });
});

describe('reading the document', () => {
  test('document, body and paragraph handles come back in document order', () => {
    const host = open();
    const { paragraphs } = handles(host);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs.map((handle) => handle.kind)).toEqual(['paragraph', 'paragraph']);
    expect(textOf(host, paragraphs[0]!)).toBe('alpha');
    expect(textOf(host, paragraphs[1]!)).toBe('beta');
  });

  test('the body reads as its paragraphs, joined by a paragraph mark', () => {
    const host = open();
    const { body } = handles(host);
    // A carriage return, which is the separator Word's own text properties use.
    expect(textOf(host, body)).toBe('alpha\rbeta');
  });

  test('the same object asked for twice is the same handle', () => {
    // Stability is what lets an object model hold a reference across batches. Minting a
    // fresh handle per read would make every held reference a slow leak instead.
    const host = open();
    const first = handles(host);
    const second = handles(host);
    expect(second.document).toEqual(first.document);
    expect(second.body).toEqual(first.body);
    expect(second.paragraphs.map((h) => h.ref)).toEqual(first.paragraphs.map((h) => h.ref));
  });

  test('a handle exposes no node id, part name, or engine object', () => {
    // The one property that makes this protocol safe to put behind a transport: a handle is
    // a name the host minted, not a pointer into the canonical tree.
    const host = open();
    const { document, body, paragraphs } = handles(host);
    for (const handle of [document, body, ...paragraphs]) {
      expect(Object.keys(handle).sort()).toEqual(['kind', 'ref']);
      expect(typeof handle.ref).toBe('string');
      expect(handle.ref).not.toContain('/word/');
      expect(handle.ref).not.toContain('#');
      expect(JSON.stringify(handle)).not.toContain('word');
    }
  });

  test('a read-only batch changes nothing and publishes nothing', () => {
    const host = open();
    const { body } = handles(host);
    const events: number[] = [];
    host.subscribe((event) => events.push(event.revision));
    const response = host.execute({ operations: [{ op: 'getText', target: body }] });
    expect({ ok: response.ok, changed: response.changed, revision: response.revision }).toEqual({
      ok: true,
      changed: false,
      revision: 0,
    });
    expect(events).toEqual([]);
  });
});

describe('writing through the one canonical path', () => {
  test('an insert commits, bumps the revision, and reports the change', () => {
    const host = open();
    const { paragraphs } = handles(host);
    const events: number[] = [];
    host.subscribe((event) => events.push(event.revision));

    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'X' }],
    });

    expect({ ok: response.ok, changed: response.changed }).toEqual({ ok: true, changed: true });
    expect(response.revision).toBeGreaterThan(0);
    expect(host.revision()).toBe(response.revision);
    expect(textOf(host, paragraphs[0]!)).toBe('Xalpha');
    expect(events).toEqual([response.revision]);
  });

  test('the write reaches saved bytes, and the saved package reopens', () => {
    const host = open();
    const { paragraphs } = handles(host);
    host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[1]!, offset: 4 }, text: '!' }],
    });
    const saved = host.save();
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const reopened = readOoxmlPackage(saved.bytes);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const main = reopened.package.parts.get(reopened.package.mainDocumentPart)!;
    const body = main.root.children.find((child) => child.kind === 'body')!;
    if (body.kind === 'textValue') throw new Error('no body');
    const second = body.children.filter((child) => child.kind === 'paragraph')[1]!;
    expect(paragraphTextOf(main, second.id)).toBe('beta!');
  });

  test('ordered commands in one batch commit as one revision', () => {
    // One batch is one transaction, so two inserts are one undoable unit and one event —
    // not two of each with a visible document in between.
    const host = open();
    const { paragraphs } = handles(host);
    const events: number[] = [];
    host.subscribe((event) => events.push(event.revision));
    const response = host.execute({
      operations: [
        { op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: '<' },
        { op: 'insertText', at: { paragraph: paragraphs[1]!, offset: 0 }, text: '>' },
      ],
    });
    expect(response.ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(textOf(host, paragraphs[0]!)).toBe('<alpha');
    expect(textOf(host, paragraphs[1]!)).toBe('>beta');
  });
});

describe('refusals are typed, and a refused batch writes nothing', () => {
  test('a stale expected revision is refused before anything runs', () => {
    const host = open();
    const { paragraphs } = handles(host);
    host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'X' }],
    });
    const before = textOf(host, paragraphs[0]!);

    const response = host.execute({
      expectedRevision: 0,
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'Y' }],
    });

    expect(response.ok).toBe(false);
    expect(response.changed).toBe(false);
    expect(response.results[0]).toEqual({
      status: 'error',
      error: {
        code: 'stale-revision',
        message: expect.any(String),
        detail: `expected 0, at ${host.revision()}`,
      },
    });
    expect(textOf(host, paragraphs[0]!)).toBe(before);
  });

  test('a current expected revision is honoured', () => {
    const host = open();
    const { paragraphs } = handles(host);
    const response = host.execute({
      expectedRevision: host.revision(),
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'X' }],
    });
    expect(response.ok).toBe(true);
  });

  test('a handle this host never minted is invalid-handle', () => {
    const host = open();
    const { paragraphs } = handles(host);
    const forged = { kind: 'paragraph', ref: 'paragraph:999' } as unknown as AutomationHandle;
    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: forged, offset: 0 }, text: 'X' }],
    });
    expect(response.ok).toBe(false);
    expect(errorCodeAt(response, 0)).toBe('invalid-handle');
    expect(textOf(host, paragraphs[0]!)).toBe('alpha');
  });

  test('a handle of the wrong kind is invalid-handle, not a silent coercion', () => {
    const host = open();
    const { document, body } = handles(host);
    const response = host.execute({ operations: [{ op: 'getParagraphs', body: document }] });
    expect(errorCodeAt(response, 0)).toBe('invalid-handle');
    // The right kind still works, so the check is about kind and not about the ref.
    expect(host.execute({ operations: [{ op: 'getParagraphs', body }] }).ok).toBe(true);
  });

  test('an offset past the end of the paragraph is invalid-offset', () => {
    const host = open();
    const { paragraphs } = handles(host);
    for (const offset of [6, -1, 1.5, Number.NaN]) {
      const response = host.execute({
        operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset }, text: 'X' }],
      });
      expect({ offset, code: errorCodeAt(response, 0) }).toEqual({
        offset,
        code: 'invalid-offset',
      });
    }
    // The end of the paragraph is a legal insertion point, so the bound is not off by one.
    expect(
      host.execute({
        operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 5 }, text: '!' }],
      }).ok
    ).toBe(true);
  });

  test('text the store cannot author is a transaction refusal, and nothing is written', () => {
    const host = open();
    const { paragraphs } = handles(host);
    const response = host.execute({
      operations: [
        { op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: '\u0000' },
      ],
    });
    expect(response.ok).toBe(false);
    expect(errorCodeAt(response, 0)).toBe('transaction-refused');
    expect(response.changed).toBe(false);
    expect(host.revision()).toBe(0);
    expect(textOf(host, paragraphs[0]!)).toBe('alpha');
  });

  test('a mixed batch whose second command is invalid writes neither', () => {
    // The property the whole two-phase execute exists for: ordered semantics do not mean
    // "apply what you can".
    const host = open();
    const { paragraphs } = handles(host);
    const events: number[] = [];
    host.subscribe((event) => events.push(event.revision));

    const response = host.execute({
      operations: [
        { op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'good' },
        { op: 'insertText', at: { paragraph: paragraphs[1]!, offset: 99 }, text: 'bad' },
      ],
    });

    expect(response.ok).toBe(false);
    expect(response.changed).toBe(false);
    expect(response.results[0]).toEqual({ status: 'skipped' });
    expect(errorCodeAt(response, 1)).toBe('invalid-offset');
    expect(textOf(host, paragraphs[0]!)).toBe('alpha');
    expect(textOf(host, paragraphs[1]!)).toBe('beta');
    expect(host.revision()).toBe(0);
    expect(events).toEqual([]);
  });

  test('every operation after a failure is skipped, so no result is invented', () => {
    const host = open();
    const { body, paragraphs } = handles(host);
    const response = host.execute({
      operations: [
        { op: 'getText', target: body },
        { op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 99 }, text: 'bad' },
        { op: 'getText', target: paragraphs[0]! },
      ],
    });
    expect(response.results.map((result) => result.status)).toEqual([
      'skipped',
      'error',
      'skipped',
    ]);
  });
});

describe('disposal', () => {
  test('dispose is idempotent and every later call fails with a code', () => {
    const host = open();
    const { body } = handles(host);
    let events = 0;
    host.subscribe(() => {
      events += 1;
    });

    host.dispose();
    expect(() => host.dispose()).not.toThrow();
    host.dispose();

    const response = host.execute({ operations: [{ op: 'getText', target: body }] });
    expect(response.ok).toBe(false);
    expect(errorCodeAt(response, 0)).toBe('disposed');
    const saved = host.save();
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.error.code).toBe('disposed');
    expect(events).toBe(0);
  });

  test('subscribing after disposal hands back a no-op unsubscribe rather than throwing', () => {
    const host = open();
    host.dispose();
    const unsubscribe = host.subscribe(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});

function errorCodeAt(
  response: { readonly results: readonly { readonly status: string }[] },
  index: number
): string {
  const result = response.results[index] as
    { status: 'error'; error: { code: string } } | undefined;
  if (result?.status !== 'error') throw new Error(`expected an error at ${index}`);
  return result.error.code;
}
