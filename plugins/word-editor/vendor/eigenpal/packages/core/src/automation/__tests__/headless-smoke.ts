// A whole document operation, in a process that has no browser in it.
//
// Not a test file, and deliberately not named like one: `bunfig.toml` preloads happy-dom for
// every `bun test` module, so a test can never observe the absence of a DOM. This runs as a
// plain script — `bun <this file>` — which the preload does not touch, and
// `automation-lane-safety.test.ts` spawns it and reads the sentinel below.
//
// It fails loudly rather than silently: any assertion that does not hold throws, so a non-zero
// exit is the failure signal and the sentinel line is the only success signal.

import { strToU8, zipSync } from 'fflate';
import { createServerAutomationHost } from '../server-host.ts';
import type { AutomationBatchResponse, AutomationHandle } from '../protocol.ts';

function check(condition: boolean, what: string): void {
  if (!condition) throw new Error(`headless smoke failed: ${what}`);
}

const hasDom =
  typeof (globalThis as { document?: unknown }).document !== 'undefined' ||
  typeof (globalThis as { window?: unknown }).window !== 'undefined';
check(!hasDom, 'a DOM was present, so this run proves nothing');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const bytes = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>headless</w:t></w:r></w:p></w:body></w:document>`
  ),
});

function handleAt(response: AutomationBatchResponse, index: number): AutomationHandle {
  const result = response.results[index];
  check(result?.status === 'ok', `operation ${index} did not succeed`);
  if (result?.status !== 'ok' || result.value.kind !== 'handle') {
    throw new Error(`headless smoke failed: no handle at ${index}`);
  }
  return result.value.handle;
}

const opened = createServerAutomationHost(bytes);
check(opened.ok, 'the package did not open');
if (!opened.ok) throw new Error(opened.reason);
const host = opened.host;

const documentHandle = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
const body = handleAt(
  host.execute({ operations: [{ op: 'getBody', document: documentHandle }] }),
  0
);
const listed = host.execute({ operations: [{ op: 'getParagraphs', body }] });
const paragraphs = listed.results[0];
if (paragraphs?.status !== 'ok' || paragraphs.value.kind !== 'handles') {
  throw new Error('headless smoke failed: no paragraph handles');
}

const written = host.execute({
  operations: [
    {
      op: 'insertText',
      at: { paragraph: paragraphs.value.handles[0]!, offset: 0 },
      text: 'still ',
    },
  ],
});
check(written.ok && written.changed, 'the insert did not commit');

const read = host.execute({ operations: [{ op: 'getText', target: body }] });
const text = read.results[0];
check(
  text?.status === 'ok' && text.value.kind === 'text' && text.value.text === 'still headless',
  'the write did not read back'
);

const saved = host.save();
check(saved.ok && saved.bytes.byteLength > 0, 'save produced nothing');
host.dispose();

// The sentinel the spawning test looks for. It carries the DOM verdict so a run that somehow
// acquired a browser cannot be mistaken for a run that proved the point. Written straight to
// the stream because the spawning test asserts that stderr is EMPTY, and the repository's
// console policy leaves only `warn`/`error` — both of which write to stderr.
process.stdout.write(`automation-headless-ok dom=${String(hasDom)}\n`);
