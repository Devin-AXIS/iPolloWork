// A handle addresses ONE host's document, and no other.
//
// Handles used to be numbered per host — `paragraph:1` in every host that had ever been asked
// for a paragraph. Two hosts open on two different documents therefore accepted each other's
// refs and resolved them against their own tree, so a ref obtained from a document a caller was
// allowed to read named a paragraph in one it was not. Handles are the only thing the protocol
// hands out, and an opaque name that collides is not opaque.
//
// So every ref carries a per-host token drawn from the platform CSPRNG. What that buys is not
// secrecy of the document — it is that a ref cannot be transplanted or guessed, which is the
// property an object model behind a transport has to be able to rely on.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
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
const PUBLIC_DOC = docx(p('public'));
const PRIVATE_DOC = docx(p('confidential'));

function open(bytes: Uint8Array): AutomationHost {
  const opened = createServerAutomationHost(bytes);
  if (!opened.ok) throw new Error(`host did not open: ${opened.reason}`);
  return opened.host;
}

function paragraphsOf(host: AutomationHost): readonly AutomationHandle[] {
  const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
  const body = handleAt(host.execute({ operations: [{ op: 'getBody', document }] }), 0);
  const listed = host.execute({ operations: [{ op: 'getParagraphs', body }] });
  const result = listed.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'handles') {
    throw new Error('expected paragraph handles');
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

function errorCodeAt(
  response: { readonly results: readonly { readonly status: string }[] },
  index: number
): string {
  const result = response.results[index] as
    { status: 'error'; error: { code: string } } | undefined;
  if (result?.status !== 'error') throw new Error(`expected an error at ${index}`);
  return result.error.code;
}

describe('refs are scoped to the host that minted them', () => {
  test('two hosts on the SAME bytes mint different refs for the same paragraph', () => {
    // Same document, same questions, same order: the ordinal part matches and the ref does not.
    const first = paragraphsOf(open(PUBLIC_DOC));
    const second = paragraphsOf(open(PUBLIC_DOC));
    expect(first).toHaveLength(second.length);
    expect(first[0]!.ref).not.toBe(second[0]!.ref);
  });

  test('a ref carries enough entropy that two hosts never collide by accident', () => {
    // 32 hosts, 32 distinct tokens. A per-host counter would produce one value here.
    const refs = new Set(Array.from({ length: 32 }, () => paragraphsOf(open(PUBLIC_DOC))[0]!.ref));
    expect(refs.size).toBe(32);
    const [sample] = refs;
    // The token itself: long enough that guessing is not a strategy.
    expect(sample!.length).toBeGreaterThanOrEqual(24);
  });

  test("a handle from another host cannot READ this host's document", () => {
    const readable = open(PUBLIC_DOC);
    const secret = open(PRIVATE_DOC);
    const stolen = paragraphsOf(secret)[0]!;
    // The victim has been asked the same questions, so the ORDINAL part of the stolen ref
    // names a real paragraph here. Only the token stops it.
    paragraphsOf(readable);

    const response = readable.execute({ operations: [{ op: 'getText', target: stolen }] });

    expect(response.ok).toBe(false);
    expect(errorCodeAt(response, 0)).toBe('invalid-handle');
  });

  test("a handle from another host cannot WRITE into this host's document", () => {
    const victim = open(PUBLIC_DOC);
    const attacker = open(PRIVATE_DOC);
    const stolen = paragraphsOf(attacker)[0]!;
    const own = paragraphsOf(victim)[0]!;

    const response = victim.execute({
      operations: [{ op: 'insertText', at: { paragraph: stolen, offset: 0 }, text: 'INJECTED' }],
    });

    expect(response.ok).toBe(false);
    expect(errorCodeAt(response, 0)).toBe('invalid-handle');
    expect(response.changed).toBe(false);
    expect(victim.revision()).toBe(0);
    expect(textOf(victim, own)).toBe('public');
  });

  test('a ref with the right shape but a forged token is refused', () => {
    const host = open(PUBLIC_DOC);
    const real = paragraphsOf(host)[0]!;
    const forged = {
      kind: 'paragraph',
      ref: real.ref.replace(/[0-9a-f]/, (digit) => (digit === '0' ? '1' : '0')),
    } as unknown as AutomationHandle;
    expect(forged.ref).not.toBe(real.ref);

    const response = host.execute({ operations: [{ op: 'getText', target: forged }] });
    expect(errorCodeAt(response, 0)).toBe('invalid-handle');
    // And the real one still works, so the check is about the token and not about the shape.
    expect(textOf(host, real)).toBe('public');
  });

  test('the host still recognizes its OWN refs across batches', () => {
    // The property the token must not break: a ref is stable for the life of its host.
    const host = open(PUBLIC_DOC);
    const first = paragraphsOf(host)[0]!;
    const again = paragraphsOf(host)[0]!;
    expect(again).toEqual(first);
    expect(textOf(host, first)).toBe('public');
  });

  test('the token leaks nothing about the document', () => {
    const host = open(PRIVATE_DOC);
    const handles = [
      handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0),
      ...paragraphsOf(host),
    ];
    for (const handle of handles) {
      expect(Object.keys(handle).sort()).toEqual(['kind', 'ref']);
      expect(handle.ref).not.toContain('confidential');
      expect(handle.ref).not.toContain('/word/');
      expect(JSON.stringify(handle)).not.toContain('word');
    }
  });
});

describe('the random source is required, not preferred', () => {
  test('a runtime with no CSPRNG fails closed rather than minting guessable refs', () => {
    // Every runtime this ships to has `crypto.getRandomValues`. If one ever does not, the
    // failure has to be loud: silently falling back to a counter would restore exactly the
    // collision this file exists to prevent, with no signal that it had.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      expect(() => open(PUBLIC_DOC)).toThrow(/random/i);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
      else Reflect.deleteProperty(globalThis, 'crypto');
    }
    // And the restore worked, so the rest of the suite is unaffected.
    expect(paragraphsOf(open(PUBLIC_DOC))[0]!.ref.length).toBeGreaterThan(12);
  });
});
