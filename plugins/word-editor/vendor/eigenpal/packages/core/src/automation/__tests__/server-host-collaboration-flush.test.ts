// An automation write must be PUBLISHED by the time it returns, not merely committed.
//
// Publication is deferred so that holding a key down never waits on encoding. That trade is
// right for a browser and wrong here: no frame is pending, and a script's next line may read a
// peer. Left deferred, an agent inserted text, awaited `sync()`, and the other replica still
// held the old paragraph. The edit arrived a moment later, so nothing was lost — but for that
// window "committed" and "replicated" disagreed, which reads as data loss to anyone holding
// both documents.
//
// The flush is pinned per WRITE KIND rather than once, so a write path added later cannot
// quietly inherit the browser's timing.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createServerAutomationHost } from '../server-host.ts';
import { stubCollaborationSession } from '../../editor/__tests__/collaboration-test-module.ts';
import type { AutomationBatchResponse, AutomationHandle, AutomationHost } from '../protocol.ts';

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

const TWO_PARAGRAPHS = docx(
  `<w:p><w:r><w:t>alpha</w:t></w:r></w:p><w:p><w:r><w:t>beta</w:t></w:r></w:p>`
);

/** A host with a replica attached, plus a live count of how often it was asked to publish. */
function attachedHost(sessionOverrides: Record<string, unknown> = {}): {
  host: AutomationHost;
  flushes: () => number;
} {
  let flushes = 0;
  const session = stubCollaborationSession({
    flushPendingJournals: () => {
      flushes += 1;
    },
    ...sessionOverrides,
  });
  const opened = createServerAutomationHost(TWO_PARAGRAPHS, {
    collaborationModel: { session },
  });
  if (!opened.ok) throw new Error(`host did not open: ${opened.reason}`);
  return { host: opened.host, flushes: () => flushes };
}

function handleOf(batch: AutomationBatchResponse): AutomationHandle {
  const result = batch.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'handle') {
    throw new Error('expected a handle');
  }
  return result.value.handle;
}

function firstParagraph(host: AutomationHost): AutomationHandle {
  const document = handleOf(host.execute({ operations: [{ op: 'getDocument' }] }));
  const body = handleOf(host.execute({ operations: [{ op: 'getBody', document }] }));
  const listed = host.execute({ operations: [{ op: 'getParagraphs', body }] });
  const result = listed.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'handles') {
    throw new Error('expected paragraph handles');
  }
  const paragraph = result.value.handles[0];
  if (!paragraph) throw new Error('expected a first paragraph');
  return paragraph;
}

function insertText(host: AutomationHost, paragraph: AutomationHandle): AutomationBatchResponse {
  return host.execute({
    operations: [{ op: 'insertText', at: { paragraph, offset: 0 }, text: 'agent ' }],
  });
}

describe('a headless automation write with a replica attached', () => {
  test('publishes an inserted run before the batch returns', () => {
    const { host, flushes } = attachedHost();
    const paragraph = firstParagraph(host);
    const before = flushes();
    expect(insertText(host, paragraph).results[0]?.status).toBe('ok');
    expect(flushes()).toBeGreaterThan(before);
  });

  test('publishes again for a second write, rather than once for the session', () => {
    const { host, flushes } = attachedHost();
    const paragraph = firstParagraph(host);
    insertText(host, paragraph);
    const afterFirst = flushes();
    insertText(host, paragraph);
    expect(flushes()).toBeGreaterThan(afterFirst);
  });

  test('does not publish a refused write, which committed nothing to publish', () => {
    const { host, flushes } = attachedHost({
      gateOperations: () => 'experimental-collaboration-refused',
    });
    const paragraph = firstParagraph(host);
    const before = flushes();
    expect(insertText(host, paragraph).results[0]?.status).toBe('error');
    expect(flushes()).toBe(before);
  });

  test('does not publish while only READING the document', () => {
    const { host, flushes } = attachedHost();
    const paragraph = firstParagraph(host);
    const before = flushes();
    host.execute({ operations: [{ op: 'getText', target: paragraph }] });
    expect(flushes()).toBe(before);
  });
});

describe('a headless automation write with no replica', () => {
  test('runs the write, since there is nothing to publish to', () => {
    const opened = createServerAutomationHost(TWO_PARAGRAPHS);
    if (!opened.ok) throw new Error(`host did not open: ${opened.reason}`);
    const paragraph = firstParagraph(opened.host);
    expect(insertText(opened.host, paragraph).results[0]?.status).toBe('ok');
  });
});
