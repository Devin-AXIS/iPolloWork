// One protocol, two hosts, one answer.
//
// The headless host and the browser host are the same host: the same operations, the same
// handle table, the same reads, the same transaction. What is genuinely different is who owns
// the document — bytes this process opened, or an editor that is already painted — and that is
// exactly the difference a consumer must not be able to observe.
//
// So this runs an IDENTICAL script of batches against both and compares the transcripts whole,
// refs included, rather than comparing a curated summary. A divergence in a field nobody
// thought to assert is the failure mode this shape exists to catch. The document is deliberately
// not two plain paragraphs: a style cascade, a table with cell paragraphs, a tab and a break,
// and section properties are where a bespoke read would drift from the canonical one.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createServerAutomationHost } from '../../automation/index.ts';
import type {
  AutomationBatchResponse,
  AutomationHandle,
  AutomationHost,
} from '../../automation/index.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { canonicalOoxmlFingerprint } from '../../store/package/ooxml-serialize.ts';
import { semanticDigest } from '../../store/package/ooxml-digest.ts';
import { createBrowserAutomationHost } from '../automation-host.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const DOCUMENT =
  `<w:document xmlns:w="${W}"><w:body>` +
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr>' +
  '<w:r><w:rPr><w:b/></w:rPr><w:t>Quarterly report</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Prepared by </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>the team</w:t></w:r></w:p>' +
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>' +
  '<w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>Total</w:t></w:r></w:p></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>1200</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
  '<w:p><w:r><w:t>notes</w:t><w:tab/><w:t>and</w:t><w:br/><w:t>more</w:t></w:r></w:p>' +
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
  '</w:body></w:document>';

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>' +
  '<w:rPr><w:sz w:val="32"/></w:rPr></w:style>' +
  '</w:styles>';

function packageBytes(documentXml: string, stylesXml?: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (stylesXml
          ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        (stylesXml ? `<Relationship Id="rId2" Type="${STYLES_REL}" Target="styles.xml"/>` : '') +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(documentXml),
    ...(stylesXml ? { 'word/styles.xml': strToU8(stylesXml) } : {}),
  });
}

/** Representative bytes: a style cascade, a table, inline furniture, section properties. */
const REPRESENTATIVE = packageBytes(DOCUMENT, STYLES);

function serverHost(bytes: Uint8Array = REPRESENTATIVE): AutomationHost {
  const opened = createServerAutomationHost(bytes);
  if (!opened.ok) throw new Error(`headless host did not open: ${opened.reason}`);
  return opened.host;
}

function browserHost(bytes: Uint8Array = REPRESENTATIVE): {
  host: AutomationHost;
  editor: DocxEditorInstance;
} {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: bytes });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { host: createBrowserAutomationHost(editor), editor };
}

/** The two hosts under test, plus the editor the browser one borrowed. */
function bothHosts(bytes: Uint8Array = REPRESENTATIVE): {
  server: AutomationHost;
  browser: AutomationHost;
  editor: DocxEditorInstance;
} {
  const { host, editor } = browserHost(bytes);
  return { server: serverHost(bytes), browser: host, editor };
}

/**
 * Run one function against both hosts and return the two results for comparison.
 *
 * Named so a failure reads as "the hosts disagreed", which is the only thing these tests are
 * about — every assertion below is `expect(server).toEqual(browser)` over a whole value.
 */
function onBoth<T>(
  hosts: { server: AutomationHost; browser: AutomationHost },
  run: (host: AutomationHost) => T
): { server: T; browser: T } {
  return { server: run(hosts.server), browser: run(hosts.browser) };
}

function handlesOf(host: AutomationHost): {
  document: AutomationHandle;
  body: AutomationHandle;
  paragraphs: readonly AutomationHandle[];
} {
  const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
  const body = handleAt(host.execute({ operations: [{ op: 'getBody', document }] }), 0);
  const listed = host.execute({ operations: [{ op: 'getParagraphs', body }] });
  const result = listed.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'handles') {
    throw new Error('expected paragraph handles');
  }
  return { document, body, paragraphs: result.value.handles };
}

function handleAt(response: AutomationBatchResponse, index: number): AutomationHandle {
  const result = response.results[index];
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

interface Transcript {
  readonly document: AutomationHandle;
  readonly body: AutomationHandle;
  readonly paragraphs: readonly AutomationHandle[];
  readonly bodyText: string;
  readonly paragraphTexts: readonly string[];
}

/**
 * Everything a consumer can observe about a host's document, as one comparable value.
 *
 * Refs are included on purpose: their ordinal half is minted in first-seen order per kind, so
 * two hosts asked the same questions in the same order must agree about it. Comparing
 * everything EXCEPT the identifiers is where a real divergence hides.
 */
function transcript(host: AutomationHost): Transcript & Record<string, unknown> {
  const { document, body, paragraphs } = handlesOf(host);
  return {
    capabilitiesDocument: host.capabilities.document,
    capabilitiesSave: host.capabilities.save,
    revision: host.revision(),
    document,
    body,
    paragraphs,
    bodyText: textOf(host, body),
    paragraphTexts: paragraphs.map((paragraph) => textOf(host, paragraph)),
  };
}

/**
 * The same transcript with the minting host's token collapsed to a fixed marker.
 *
 * Every ref carries a per-host random token, because a ref that is portable between hosts is a
 * ref that can address a document its holder was never given — so the two hosts CANNOT agree
 * about that half, by design. Normalized here, for comparison, and nowhere else: resolution
 * matches the whole ref exactly, which is what makes a foreign one `invalid-handle`.
 */
function withoutHostToken(value: Transcript): unknown {
  const token = value.document.ref.split(':')[1];
  if (!token || token.length < 24) throw new Error('a ref no longer carries a host token');
  return JSON.parse(JSON.stringify(value).replaceAll(token, '<host>'));
}

/**
 * The same normalization for a value that carries refs without a known document handle: find
 * every host token by shape and collapse it. Used for whole-response comparisons.
 */
function normalizeTokens(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (text === undefined) return value;
  return JSON.parse(text.replace(/:[0-9a-f]{32}:/g, ':<host>:'));
}

/** Reopen saved bytes and describe them with the repository's own fidelity oracles. */
function oracles(bytes: Uint8Array): { fingerprint: string; digest: unknown } {
  const reopened = readOoxmlPackage(bytes);
  if (!reopened.ok) throw new Error(`saved bytes did not reopen: ${reopened.reason}`);
  const main = reopened.package.parts.get(reopened.package.mainDocumentPart);
  if (!main) throw new Error('saved bytes carry no main document part');
  return {
    fingerprint: canonicalOoxmlFingerprint(main),
    digest: semanticDigest(reopened.package.parts.values()),
  };
}

function savedBytes(host: AutomationHost): Uint8Array {
  const saved = host.save();
  if (!saved.ok) throw new Error(`save failed: ${saved.error.code}`);
  return saved.bytes;
}

describe('the two hosts read the same document identically', () => {
  test('initial document, body and paragraph reads are equal, ref for ref', () => {
    const hosts = bothHosts();
    const { server, browser } = onBoth(hosts, transcript);
    expect(withoutHostToken(server)).toEqual(withoutHostToken(browser));
    // The normalization is not papering over an accidental equality: the raw refs differ,
    // because each host scoped its own.
    expect(server.document.ref).not.toBe(browser.document.ref);
  });

  test('reading twice is stable in both, so neither is quietly re-minting', () => {
    const hosts = bothHosts();
    const first = onBoth(hosts, transcript);
    const second = onBoth(hosts, transcript);
    expect(second.server).toEqual(first.server);
    expect(second.browser).toEqual(first.browser);
  });

  test('a read-only batch changes nothing and publishes nothing in either host', () => {
    const hosts = bothHosts();
    const observed = onBoth(hosts, (host) => {
      const { body } = handlesOf(host);
      const events: number[] = [];
      host.subscribe((event) => events.push(event.revision));
      const response = host.execute({ operations: [{ op: 'getText', target: body }] });
      return { ok: response.ok, changed: response.changed, revision: response.revision, events };
    });
    expect(observed.server).toEqual(observed.browser);
    expect(observed.server.changed).toBe(false);
    expect(observed.server.events).toEqual([]);
  });
});

describe('revision projections use one automation contract in both hosts', () => {
  test('original-view read, search, range read, and edit agree', () => {
    const revisionDocument =
      `<w:document xmlns:w="${W}"><w:body><w:p>` +
      '<w:r><w:t xml:space="preserve">keep </w:t></w:r>' +
      '<w:del w:id="1" w:author="Ada"><w:r><w:delText>gone</w:delText></w:r></w:del>' +
      '<w:ins w:id="2" w:author="Ada"><w:r><w:t>added</w:t></w:r></w:ins>' +
      '</w:p></w:body></w:document>';
    const hosts = bothHosts(packageBytes(revisionDocument));
    const run = (host: AutomationHost): unknown => {
      const { body } = handlesOf(host);
      const reads = host.execute({
        operations: [
          { op: 'getText', target: body },
          { op: 'getText', target: body, projection: 'original' },
          {
            op: 'search',
            scope: { body },
            text: 'keep gone',
            options: { projection: 'original' },
          },
          { op: 'search', scope: { body }, text: 'added', options: { projection: 'original' } },
        ],
      });
      const hit = reads.results[2];
      if (hit?.status !== 'ok' || hit.value.kind !== 'spans' || !hit.value.spans[0]) {
        throw new Error('expected one original-view search result');
      }
      const span = hit.value.spans[0];
      const rangeRead = host.execute({
        operations: [{ op: 'getSpanText', span, projection: 'original' }],
      });
      const write = host.execute({
        operations: [{ op: 'replaceSpan', span, text: 'kept' }],
      });
      return {
        reads: reads.results,
        rangeRead: rangeRead.results,
        write: { ok: write.ok, changed: write.changed },
        final: textOf(host, body),
      };
    };
    const result = onBoth(hosts, run);
    expect(normalizeTokens(result.server)).toEqual(normalizeTokens(result.browser));
    expect(result.server).toMatchObject({
      write: { ok: true, changed: true },
      final: 'keptadded',
    });
  });
});

describe('the same write produces the same document in both hosts', () => {
  /** One ordered batch: a cell paragraph and a body paragraph, in one transaction. */
  const write = (host: AutomationHost): AutomationBatchResponse => {
    const { paragraphs } = handlesOf(host);
    return host.execute({
      operations: [
        { op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'Draft: ' },
        { op: 'insertText', at: { paragraph: paragraphs[2]!, offset: 0 }, text: '#' },
      ],
    });
  };

  test('the batch reports the same revision behaviour and the same change flag', () => {
    const hosts = bothHosts();
    const before = onBoth(hosts, (host) => host.revision());
    const responses = onBoth(hosts, write);
    const after = onBoth(hosts, (host) => host.revision());

    // Normalized only for the per-host token: the answered spans carry paragraph refs, whose
    // ordinal half must agree and whose token half must not.
    expect(
      normalizeTokens({
        ok: responses.server.ok,
        changed: responses.server.changed,
        results: responses.server.results,
      })
    ).toEqual(
      normalizeTokens({
        ok: responses.browser.ok,
        changed: responses.browser.changed,
        results: responses.browser.results,
      })
    );
    expect(responses.server.ok).toBe(true);
    // The absolute number belongs to whoever owns the document — a browser host carries a
    // remount base — so the comparable quantity is what one batch moved.
    expect(after.server - before.server).toBe(after.browser - before.browser);
    expect(after.server - before.server).toBeGreaterThan(0);
  });

  test('the reads after the write are equal, so both applied the same edit', () => {
    const hosts = bothHosts();
    onBoth(hosts, write);
    const reads = onBoth(hosts, (host) => {
      const { body, paragraphs } = handlesOf(host);
      return {
        bodyText: textOf(host, body),
        texts: paragraphs.map((paragraph) => textOf(host, paragraph)),
      };
    });
    expect(reads.server).toEqual(reads.browser);
    expect(reads.server.texts[0]).toBe('Draft: Quarterly report');
  });

  test('the saved bytes carry the same canonical fingerprint and semantic digest', () => {
    const hosts = bothHosts();
    onBoth(hosts, write);
    const saved = onBoth(hosts, savedBytes);
    const server = oracles(saved.server);
    const browser = oracles(saved.browser);
    expect(server.fingerprint).toBe(browser.fingerprint);
    expect(server.digest).toEqual(browser.digest);
  });

  test('save, reopen and save again keeps the semantic digest — in both hosts', () => {
    // The D9 round trip, run through the automation port: an edit made by script must survive
    // serialization the same way an edit made by hand does.
    const hosts = bothHosts();
    onBoth(hosts, write);
    const saved = onBoth(hosts, savedBytes);
    for (const bytes of [saved.server, saved.browser]) {
      const once = oracles(bytes);
      const again = oracles(savedBytes(serverHost(bytes)));
      expect(again.digest).toEqual(once.digest);
    }
  });
});

describe('the whole operation vocabulary answers identically in both hosts', () => {
  /**
   * Every read this slice defines, over the representative document, as one comparable value.
   *
   * A per-operation test per host would let a divergence hide in the one nobody paired. The
   * point of asking all of them at once is that the transcripts are compared WHOLE.
   */
  const readEverything = (host: AutomationHost): unknown => {
    const { body, paragraphs } = handlesOf(host);
    const first = paragraphs[0]!;
    const second = paragraphs[1]!;
    const response = host.execute({
      operations: [
        { op: 'getSpanText', span: { body } },
        {
          op: 'getSpanText',
          span: { start: { paragraph: first, offset: 4 }, end: { paragraph: second, offset: 8 } },
        },
        {
          op: 'getSpanParagraphs',
          span: { start: { paragraph: first, offset: 0 }, end: { paragraph: second, offset: 0 } },
        },
        { op: 'getParagraphId', paragraph: first },
        { op: 'search', scope: { body }, text: 'e' },
        {
          op: 'search',
          scope: { body },
          text: 'Region',
          options: { matchCase: true, matchWholeWord: true },
        },
        { op: 'search', scope: { body }, text: 'nothing here' },
      ],
    });
    return { ok: response.ok, changed: response.changed, results: response.results };
  };

  test('reads over spans, identity and search agree ref for ref', () => {
    const hosts = bothHosts();
    const { server, browser } = onBoth(hosts, readEverything);
    expect(normalizeTokens(server)).toEqual(normalizeTokens(browser));
  });

  /** Every write this slice defines, in one batch each, then the document that came out. */
  const writeEverything = (host: AutomationHost): unknown => {
    const { body, paragraphs } = handlesOf(host);
    const steps = [
      host.execute({
        operations: [
          {
            op: 'replaceSpan',
            span: {
              start: { paragraph: paragraphs[0]!, offset: 0 },
              end: { paragraph: paragraphs[0]!, offset: 9 },
            },
            text: 'Annual',
          },
        ],
      }),
      host.execute({
        operations: [
          {
            op: 'insertParagraph',
            anchor: { paragraph: paragraphs[1]! },
            where: 'before',
            text: 'Summary',
          },
        ],
      }),
      host.execute({
        operations: [
          {
            op: 'splitParagraph',
            paragraph: paragraphs[1]!,
            delimiters: ['by'],
            trimDelimiters: true,
          },
        ],
      }),
      host.execute({ operations: [{ op: 'deleteParagraph', paragraph: paragraphs[3]! }] }),
    ];
    const { body: bodyAgain, paragraphs: after } = handlesOf(host);
    return {
      steps: steps.map((step) => ({ ok: step.ok, changed: step.changed, results: step.results })),
      bodyText: textOf(host, bodyAgain),
      texts: after.map((paragraph) => textOf(host, paragraph)),
      sameBody: bodyAgain.ref === body.ref,
    };
  };

  test('writes over spans, paragraphs and splits produce the same document', () => {
    const hosts = bothHosts();
    const { server, browser } = onBoth(hosts, writeEverything);
    expect(normalizeTokens(server)).toEqual(normalizeTokens(browser));
  });

  test('and the same bytes, by fingerprint and digest', () => {
    const hosts = bothHosts();
    onBoth(hosts, writeEverything);
    const saved = onBoth(hosts, savedBytes);
    expect(oracles(saved.server).fingerprint).toBe(oracles(saved.browser).fingerprint);
    expect(oracles(saved.server).digest).toEqual(oracles(saved.browser).digest);
  });

  /** Emptying the whole story — the fixture's table, its cell paragraphs and all. */
  const replaceTheStory = (host: AutomationHost): unknown => {
    const { body } = handlesOf(host);
    const response = host.execute({
      operations: [{ op: 'replaceSpan', span: { body }, text: 'nothing but this' }],
    });
    const { paragraphs: after } = handlesOf(host);
    return {
      ok: response.ok,
      changed: response.changed,
      results: response.results,
      texts: after.map((paragraph) => textOf(host, paragraph)),
    };
  };

  test('emptying a story that holds a table is the same structural edit in both', () => {
    // The write the browser host is most likely to diverge on: it is the one that takes BLOCKS out
    // of the story, so it repaints pages and re-flows the surface rather than editing a run. Both
    // sides go through the same planner and the same one transaction, and this is what says so.
    const hosts = bothHosts();
    const { server, browser } = onBoth(hosts, replaceTheStory);
    expect(normalizeTokens(server)).toEqual(normalizeTokens(browser));
    expect((server as { texts: string[] }).texts).toEqual(['nothing but this']);
  });

  test('and the document it leaves saves to the same bytes', () => {
    const hosts = bothHosts();
    onBoth(hosts, replaceTheStory);
    const saved = onBoth(hosts, savedBytes);
    expect(oracles(saved.server).fingerprint).toBe(oracles(saved.browser).fingerprint);
    expect(oracles(saved.server).digest).toEqual(oracles(saved.browser).digest);
    // And reopening what the BROWSER saved finds the story the edit left, not the one it started
    // with: the edit reached the document rather than the picture of it on screen.
    const reopened = createServerAutomationHost(saved.browser);
    if (!reopened.ok) throw new Error(`saved bytes did not reopen: ${reopened.reason}`);
    const { body, paragraphs } = handlesOf(reopened.host);
    expect(paragraphs.map((paragraph) => textOf(reopened.host, paragraph))).toEqual([
      'nothing but this',
    ]);
    expect(textOf(reopened.host, body)).toBe('nothing but this');
  });
});

describe('selection is the one thing the two hosts differ about', () => {
  test('the browser host moves the caret and the headless host refuses to pretend', () => {
    const hosts = bothHosts();
    const outcome = onBoth(hosts, (host) => {
      const { paragraphs } = handlesOf(host);
      const response = host.execute({
        operations: [
          {
            op: 'selectSpan',
            span: {
              start: { paragraph: paragraphs[1]!, offset: 2 },
              end: { paragraph: paragraphs[1]!, offset: 7 },
            },
            mode: 'select',
          },
        ],
      });
      const first = response.results[0];
      return {
        ok: response.ok,
        // Selecting is not an edit, so neither host may report the document as having moved.
        changed: response.changed,
        code: first?.status === 'error' ? first.error.code : first?.status,
      };
    });

    expect(outcome.server).toEqual({ ok: false, changed: false, code: 'unsupported-capability' });
    expect(outcome.browser).toEqual({ ok: true, changed: false, code: 'ok' });

    // And it landed where it was asked to, in the engine's own selection vocabulary.
    const selection = hosts.editor.surface?.state().selection;
    expect(selection?.anchor.offset).toBe(2);
    expect(selection?.head.offset).toBe(7);
    expect(selection?.anchor.paragraphId).toBe(selection?.head.paragraphId);
  });

  test('collapsing to one end puts both ends of the selection there', () => {
    const hosts = bothHosts();
    const { paragraphs } = handlesOf(hosts.browser);
    for (const [mode, expected] of [
      ['start', 2],
      ['end', 7],
    ] as const) {
      const response = hosts.browser.execute({
        operations: [
          {
            op: 'selectSpan',
            span: {
              start: { paragraph: paragraphs[1]!, offset: 2 },
              end: { paragraph: paragraphs[1]!, offset: 7 },
            },
            mode,
          },
        ],
      });
      expect(response.ok).toBe(true);
      const selection = hosts.editor.surface?.state().selection;
      expect([selection?.anchor.offset, selection?.head.offset]).toEqual([expected, expected]);
    }
  });

  test('a batch that edits a paragraph the selection covers is refused, not misplaced', () => {
    const hosts = bothHosts();
    const { paragraphs } = handlesOf(hosts.browser);
    const response = hosts.browser.execute({
      operations: [
        { op: 'insertText', at: { paragraph: paragraphs[1]!, offset: 0 }, text: 'X' },
        {
          op: 'selectSpan',
          span: {
            start: { paragraph: paragraphs[1]!, offset: 2 },
            end: { paragraph: paragraphs[1]!, offset: 7 },
          },
          mode: 'select',
        },
      ],
    });
    const second = response.results[1];
    expect(second?.status === 'error' ? second.error.code : second?.status).toBe(
      'conflicting-operations'
    );
    expect(textOf(hosts.browser, paragraphs[1]!)).toBe('Prepared by the team');
  });

  // THE OTHER ORDER IS THE SAME BATCH. A selection is applied after the transaction, so it does
  // not matter which of the two the caller wrote first: if this batch both selects a paragraph and
  // changes it, the caret would be placed with offsets the edit moved — or into a paragraph the
  // edit removed. The first version of this planner only looked backwards, which meant
  // `[select, edit]` committed the edit and then moved the reader's caret to a stale position.
  describe('and it does not matter which way round the two are written', () => {
    test('selecting a paragraph and then writing into it is refused', () => {
      const hosts = bothHosts();
      const { paragraphs } = handlesOf(hosts.browser);
      const before = hosts.editor.surface?.state().selection;
      const response = hosts.browser.execute({
        operations: [
          {
            op: 'selectSpan',
            span: {
              start: { paragraph: paragraphs[1]!, offset: 2 },
              end: { paragraph: paragraphs[1]!, offset: 7 },
            },
            mode: 'select',
          },
          { op: 'insertText', at: { paragraph: paragraphs[1]!, offset: 0 }, text: 'X' },
        ],
      });
      const second = response.results[1];
      expect(second?.status === 'error' ? second.error.code : second?.status).toBe(
        'conflicting-operations'
      );
      // Neither half happened: the text is untouched AND the caret never moved.
      expect(textOf(hosts.browser, paragraphs[1]!)).toBe('Prepared by the team');
      expect(hosts.editor.surface?.state().selection).toEqual(before);
    });

    test('selecting a paragraph and then deleting it is refused', () => {
      const hosts = bothHosts();
      const { paragraphs } = handlesOf(hosts.browser);
      const response = hosts.browser.execute({
        operations: [
          { op: 'selectSpan', span: { paragraph: paragraphs[1]! }, mode: 'select' },
          { op: 'deleteParagraph', paragraph: paragraphs[1]! },
        ],
      });
      const second = response.results[1];
      expect(second?.status === 'error' ? second.error.code : second?.status).toBe(
        'conflicting-operations'
      );
      expect(textOf(hosts.browser, paragraphs[1]!)).toBe('Prepared by the team');
    });

    test('selecting a paragraph and then splitting it is refused', () => {
      const hosts = bothHosts();
      const { paragraphs } = handlesOf(hosts.browser);
      const response = hosts.browser.execute({
        operations: [
          { op: 'selectSpan', span: { paragraph: paragraphs[1]! }, mode: 'start' },
          { op: 'splitParagraph', paragraph: paragraphs[1]!, delimiters: [' '] },
        ],
      });
      const second = response.results[1];
      expect(second?.status === 'error' ? second.error.code : second?.status).toBe(
        'conflicting-operations'
      );
      expect(textOf(hosts.browser, paragraphs[1]!)).toBe('Prepared by the team');
    });

    test('selecting a paragraph and then clearing the whole story is refused', () => {
      const hosts = bothHosts();
      const { body, paragraphs } = handlesOf(hosts.browser);
      const response = hosts.browser.execute({
        operations: [
          { op: 'selectSpan', span: { paragraph: paragraphs[1]! }, mode: 'select' },
          { op: 'replaceSpan', span: { body }, text: '' },
        ],
      });
      const second = response.results[1];
      expect(second?.status === 'error' ? second.error.code : second?.status).toBe(
        'conflicting-operations'
      );
      expect(textOf(hosts.browser, paragraphs[1]!)).toBe('Prepared by the team');
    });

    test('but selecting one paragraph and editing ANOTHER is an ordinary batch', () => {
      const hosts = bothHosts();
      const { paragraphs } = handlesOf(hosts.browser);
      const response = hosts.browser.execute({
        operations: [
          {
            op: 'selectSpan',
            span: {
              start: { paragraph: paragraphs[1]!, offset: 2 },
              end: { paragraph: paragraphs[1]!, offset: 7 },
            },
            mode: 'select',
          },
          { op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'X' },
        ],
      });
      expect(response.ok).toBe(true);
      expect(textOf(hosts.browser, paragraphs[0]!)).toBe('XQuarterly report');
      const selection = hosts.editor.surface?.state().selection;
      expect([selection?.anchor.offset, selection?.head.offset]).toEqual([2, 7]);
    });
  });
});

describe('the two hosts refuse the same things the same way', () => {
  test('a mixed batch with one invalid command writes nothing in either host', () => {
    const hosts = bothHosts();
    const outcome = onBoth(hosts, (host) => {
      const { paragraphs } = handlesOf(host);
      const events: number[] = [];
      host.subscribe((event) => events.push(event.revision));
      const revisionBefore = host.revision();
      const response = host.execute({
        operations: [
          { op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'good' },
          { op: 'insertText', at: { paragraph: paragraphs[1]!, offset: 9_999 }, text: 'bad' },
        ],
      });
      return {
        ok: response.ok,
        changed: response.changed,
        results: response.results,
        movedRevision: host.revision() !== revisionBefore,
        events,
        texts: paragraphs.map((paragraph) => textOf(host, paragraph)),
      };
    });
    expect(outcome.server).toEqual(outcome.browser);
    expect(outcome.server.ok).toBe(false);
    expect(outcome.server.movedRevision).toBe(false);
    expect(outcome.server.events).toEqual([]);
    expect(outcome.server.texts[0]).toBe('Quarterly report');
  });

  test('a stale expected revision is refused identically', () => {
    const hosts = bothHosts();
    const outcome = onBoth(hosts, (host) => {
      const { paragraphs } = handlesOf(host);
      host.execute({
        operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'X' }],
      });
      const stale = host.revision() - 1;
      const response = host.execute({
        expectedRevision: stale,
        operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'Y' }],
      });
      const first = response.results[0];
      return {
        ok: response.ok,
        changed: response.changed,
        code: first?.status === 'error' ? first.error.code : first?.status,
        text: textOf(host, paragraphs[0]!),
      };
    });
    expect(outcome.server).toEqual(outcome.browser);
    expect(outcome.server.code).toBe('stale-revision');
    expect(outcome.server.text).toBe('XQuarterly report');
  });

  test("each host refuses the other's handles, in both directions", () => {
    // Comparable transcripts must not mean portable handles. Both hosts are opened on the SAME
    // bytes and asked the same questions, so the ordinal half of every ref lines up and a real
    // paragraph sits behind it — the host token is the only thing that refuses the transplant.
    const hosts = bothHosts();
    const fromBrowser = handlesOf(hosts.browser).paragraphs[0]!;
    const fromServer = handlesOf(hosts.server).paragraphs[0]!;
    const outcome = onBoth(hosts, (host) => {
      const foreign = host === hosts.server ? fromBrowser : fromServer;
      const read = host.execute({ operations: [{ op: 'getText', target: foreign }] });
      const write = host.execute({
        operations: [{ op: 'insertText', at: { paragraph: foreign, offset: 0 }, text: 'INJECTED' }],
      });
      const codeOf = (response: AutomationBatchResponse): unknown => {
        const first = response.results[0];
        return first?.status === 'error' ? first.error.code : first?.status;
      };
      return {
        readOk: read.ok,
        readCode: codeOf(read),
        writeOk: write.ok,
        writeChanged: write.changed,
        writeCode: codeOf(write),
        ownText: textOf(host, handlesOf(host).paragraphs[0]!),
      };
    });

    expect(outcome.server).toEqual(outcome.browser);
    expect(outcome.server).toEqual({
      readOk: false,
      readCode: 'invalid-handle',
      writeOk: false,
      writeChanged: false,
      writeCode: 'invalid-handle',
      ownText: 'Quarterly report',
    });
  });

  test('a paragraph the batch restructures cannot also be written to, in either host', () => {
    const hosts = bothHosts();
    const outcome = onBoth(hosts, (host) => {
      const { paragraphs } = handlesOf(host);
      const response = host.execute({
        operations: [
          {
            op: 'insertParagraph',
            anchor: { paragraph: paragraphs[0]! },
            where: 'after',
            text: 'x',
          },
          { op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'y' },
        ],
      });
      return {
        ok: response.ok,
        changed: response.changed,
        results: response.results,
        text: textOf(host, paragraphs[0]!),
      };
    });
    expect(outcome.server).toEqual(outcome.browser);
    expect(outcome.server.ok).toBe(false);
    expect(outcome.server.text).toBe('Quarterly report');
  });

  test('dispose is idempotent in both, and later operations fail with the same code', () => {
    const hosts = bothHosts();
    const outcome = onBoth(hosts, (host) => {
      const { body } = handlesOf(host);
      host.dispose();
      host.dispose();
      const response = host.execute({ operations: [{ op: 'getText', target: body }] });
      const first = response.results[0];
      const saved = host.save();
      return {
        ok: response.ok,
        code: first?.status === 'error' ? first.error.code : first?.status,
        saveOk: saved.ok,
        saveCode: saved.ok ? null : saved.error.code,
      };
    });
    expect(outcome.server).toEqual(outcome.browser);
    expect(outcome.server).toEqual({
      ok: false,
      code: 'disposed',
      saveOk: false,
      saveCode: 'disposed',
    });
    // And the editor the browser host borrowed is still alive, because dispose released a
    // lens and not a document.
    expect(hosts.editor.surface).not.toBeNull();
  });
});
