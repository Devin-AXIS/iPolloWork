// Journal coverage for PACKAGE-LEVEL write intents — one level up from
// `canonical-primitive-journal-coverage.test.ts`.
//
// That test freezes `TREE_DOC_OP_KINDS` and proves every op kind replays. It cannot see the
// bug this file exists for: an intent that composes ops WITH package writes (media bytes, a
// relationship, a content-type override, a new part) and commits them on a story store that
// never entered `runObservedStoreTransaction`. Capture is armed per transaction, so such an
// intent moves the local document and emits no journal at all. The author sees the edit and
// every peer keeps the old document, with no error anywhere. It has happened three times:
// comments, clipboard paste, image insert.
//
// Two halves, both derived rather than asserted against a golden list:
//
//  1. BEHAVIOUR — run each intent through its real entry point with a journal observer
//     attached, then replay what was captured onto a replica opened from the same bytes and
//     require the two packages to be equivalent. A missing wrapper produces no journal; a
//     wrapper over an incomplete set of effects produces a journal that replays to a
//     DIFFERENT package. Both fail here, with the reason spelled out.
//  2. STRUCTURE — scan the lane sources for the four calls that move a package outside
//     `TreePackageStore.transact` and require the file making one to arm capture. This is
//     what catches an intent nobody registered above: all three historical bugs are files
//     that called one of those four and never mentioned `runObservedStoreTransaction`.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  observeCanonicalPrimitiveJournal,
  flushPendingCanonicalJournals,
} from '../../collaboration/primitive-journal.ts';
import type { CanonicalPrimitiveJournal } from '../package/canonical-primitive-journal.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { contentControlsIn } from '../package/content-control-nodes.ts';
import type { ImageDecodePort } from '../package/image-resources.ts';
import { addPackageComment, deletePackageComments } from '../store/comment-package-write.ts';
import type { TreePackageStore } from '../store/tree-package-store.ts';
import { openTreeSession, type TreeDocxSession } from '../../binding/tree-session.ts';
import {
  assertPackagesEquivalent,
  findKind,
  firstParagraphId,
  openStore,
  plainDoc,
  PNG,
  R,
  W,
  zipDoc,
} from './canonical-primitive-journal-coverage-support.ts';
import {
  blobsForJournal,
  replayCanonicalPrimitiveJournal,
} from './canonical-primitive-replayer.ts';

const BODY = { kind: 'body' } as const;

const decodePort: ImageDecodePort = {
  decode: async () => ({ pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 }),
};

const PIC_XML =
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId14"/>' +
  '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="152400" cy="152400"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';

const DRAWING_BODY =
  '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="152400" cy="152400"/><wp:docPr id="1" name="pic"/>' +
  '<wp:cNvGraphicFramePr/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  `${PIC_XML}</a:graphicData></a:graphic>` +
  '</wp:inline></w:drawing></w:r><w:r><w:t>x</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>y</w:t></w:r></w:p><w:sectPr/>';

const NUMBERING_XML =
  `<w:numbering xmlns:w="${W}">` +
  '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
  '<w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

const PAYLOAD = {
  namespaceUri: 'urn:docx-editor-test:payload',
  rootLocalName: 'root',
  nodeId: 'n1',
  label: 'Label',
  data: '{"a":1}',
} as const;

function drawingDoc(): Uint8Array {
  return zipDoc({
    body: DRAWING_BODY,
    rels: `<Relationship Id="rId14" Type="${R}/image" Target="media/image1.png"/>`,
    extraBytes: { 'word/media/image1.png': PNG },
  });
}

function listDoc(): Uint8Array {
  return zipDoc({
    body:
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
      '<w:r><w:t>Item</w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p><w:sectPr/>',
    rels: `<Relationship Id="rIdN" Type="${R}/numbering" Target="numbering.xml"/>`,
    overrides:
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
    extraXml: { 'word/numbering.xml': NUMBERING_XML },
  });
}

/** A header part that keeps its own `.rels` part (a hyperlink) or has none. */
function headerDoc(withHeaderRels: boolean): Uint8Array {
  const header = withHeaderRels
    ? `<w:hdr xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      '<w:p><w:hyperlink r:id="rIdL"><w:r><w:t>Link</w:t></w:r></w:hyperlink></w:p></w:hdr>'
    : `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Link</w:t></w:r></w:p></w:hdr>`;
  const extraXml: Record<string, string> = { 'word/header1.xml': header };
  if (withHeaderRels)
    extraXml['word/_rels/header1.xml.rels'] =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rIdL" Type="${R}/hyperlink" Target="https://example.com" TargetMode="External"/>` +
      '</Relationships>';
  return zipDoc({
    body:
      '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
      '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>',
    rels: `<Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/>`,
    overrides:
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    extraXml,
  });
}

function fragmentDoc(): Uint8Array {
  return zipDoc({ body: '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>BoldPaste</w:t></w:r></w:p>' });
}

/**
 * One authorable package-level write intent, addressed the way its host addresses it.
 *
 * `store` intents call `TreePackageStore` directly, the way the surface and the automation
 * host do. `session` intents go through `TreeDocxSession`, because that is where the
 * package-preparing writes live (`ensureListDefinition`, `ensureHyperlinkRelationship`,
 * the payload sweep) and a wrapper is only proven by calling the method that owns it.
 */
type PackageWriteIntent =
  | {
      readonly name: string;
      readonly host: 'store';
      readonly bytes: () => Uint8Array;
      readonly run: (store: TreePackageStore) => Promise<string | null>;
    }
  | {
      readonly name: string;
      readonly host: 'session';
      readonly bytes: () => Uint8Array;
      readonly run: (session: TreeDocxSession) => Promise<string | null>;
    };

function firstDrawingId(store: TreePackageStore): string {
  return findKind(store.bodyStore().part, 'drawing').id;
}

function sessionParagraphId(session: TreeDocxSession): string {
  const id = session.paragraphIds()[0];
  if (!id) throw new Error('fixture has no paragraph');
  return id;
}

const IMAGE_INSERT = {
  bytes: PNG,
  mime: 'image/png',
  widthPoints: 10,
  heightPoints: 10,
  decodePort,
} as const;

/**
 * Every package-level write intent this engine offers an author.
 *
 * Adding an intent means adding an entry. The structural half below is what notices when
 * somebody does not.
 */
const PACKAGE_WRITE_INTENTS: readonly PackageWriteIntent[] = [
  {
    name: 'insertImage',
    host: 'store',
    bytes: plainDoc,
    async run(store) {
      const result = await store.insertImage(BODY, {
        paragraphId: firstParagraphId(store),
        offset: 0,
        ...IMAGE_INSERT,
        expectedPackageRevision: store.packageRevision,
      });
      return result.ok ? null : result.reason;
    },
  },
  {
    name: 'insertImage with a hyperlink',
    host: 'store',
    bytes: plainDoc,
    async run(store) {
      const result = await store.insertImage(BODY, {
        paragraphId: firstParagraphId(store),
        offset: 0,
        ...IMAGE_INSERT,
        expectedPackageRevision: store.packageRevision,
        hyperlink: 'https://example.com/picture',
      });
      return result.ok ? null : result.reason;
    },
  },
  {
    name: 'replaceImage',
    host: 'store',
    bytes: drawingDoc,
    async run(store) {
      const result = await store.replaceImage(
        BODY,
        firstDrawingId(store),
        PNG,
        'image/png',
        decodePort,
        { expectedPackageRevision: store.packageRevision }
      );
      return result.ok ? null : result.reason;
    },
  },
  {
    name: 'deleteImage',
    host: 'store',
    bytes: drawingDoc,
    async run(store) {
      const result = store.deleteImage(BODY, firstDrawingId(store));
      return result.ok ? null : result.reason;
    },
  },
  {
    name: 'setDrawingMetadataWithHyperlink',
    host: 'store',
    bytes: drawingDoc,
    async run(store) {
      const result = store.setDrawingMetadataWithHyperlink(
        BODY,
        firstDrawingId(store),
        'Title',
        'Description',
        'https://example.com/alt'
      );
      return result.ok ? null : result.reason;
    },
  },
  {
    name: 'applyImageProperties',
    host: 'store',
    bytes: drawingDoc,
    async run(store) {
      const drawingNodeId = firstDrawingId(store);
      const result = store.applyImageProperties(BODY, {
        drawingNodeId,
        ops: [{ op: 'resizeDrawing', drawingNodeId, extentEmu: { cx: 200000, cy: 200000 } }],
        hyperlink: 'https://example.org/resized',
      });
      return result.ok ? null : result.reason;
    },
  },
  {
    name: 'applyFragmentPaste',
    host: 'store',
    bytes: plainDoc,
    async run(store) {
      const result = store.applyFragmentPaste(BODY, {
        paragraphId: firstParagraphId(store),
        offset: 0,
        fragmentBytes: fragmentDoc(),
        lastMarkCovered: true,
      });
      return result.ok ? null : result.reason;
    },
  },
  {
    name: 'addPackageComment',
    host: 'store',
    bytes: plainDoc,
    async run(store) {
      const result = addPackageComment(store, {
        anchor: { paragraphId: firstParagraphId(store), start: 0, end: 2 },
        author: 'QA',
        text: 'a comment',
        date: '2020-01-01T00:00:00Z',
      });
      return result.ok ? null : result.reason;
    },
  },
  {
    name: 'deletePackageComments',
    host: 'store',
    bytes: plainDoc,
    async run(store) {
      const added = addPackageComment(store, {
        anchor: { paragraphId: firstParagraphId(store), start: 0, end: 2 },
        author: 'QA',
        text: 'a comment',
        date: '2020-01-01T00:00:00Z',
      });
      if (!added.ok) return added.reason;
      return deletePackageComments(store, [{ commentId: added.commentId }]) ? null : 'refused';
    },
  },
  {
    name: 'applyLifecycleOp (createHeaderFooter)',
    host: 'store',
    bytes: plainDoc,
    async run(store) {
      const result = store.applyLifecycleOp({
        op: 'createHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'default',
      });
      return result.ok ? null : result.reason;
    },
  },
  {
    name: 'session.insertCustomNode',
    host: 'session',
    bytes: plainDoc,
    async run(session) {
      const result = session.insertCustomNode({
        paragraphId: sessionParagraphId(session),
        offset: 0,
        tag: 'tag-1',
        text: 'Label',
        alias: 'Alias',
        payload: PAYLOAD,
      });
      return result.ok ? null : result.reason;
    },
  },
  {
    name: 'session.removeCustomNode',
    host: 'session',
    bytes: plainDoc,
    async run(session) {
      const inserted = session.insertCustomNode({
        paragraphId: sessionParagraphId(session),
        offset: 0,
        tag: 'tag-1',
        text: 'Label',
        alias: 'Alias',
        payload: PAYLOAD,
      });
      if (!inserted.ok) return inserted.reason;
      const controlId = contentControlsIn(session.part().root)[0]?.node.id;
      if (!controlId) return 'no-control';
      const removed = session.removeCustomNode(controlId);
      return removed.ok ? null : removed.reason;
    },
  },
  {
    name: 'session.sweepCustomNodePayloads',
    host: 'session',
    bytes: plainDoc,
    async run(session) {
      const inserted = session.insertCustomNode({
        paragraphId: sessionParagraphId(session),
        offset: 0,
        tag: 'tag-1',
        text: 'Label',
        alias: 'Alias',
        payload: PAYLOAD,
      });
      if (!inserted.ok) return inserted.reason;
      const controlId = contentControlsIn(session.part().root)[0]?.node.id;
      if (!controlId) return 'no-control';
      // Drop the control WITHOUT its payload, which is the state a sweep exists to collect.
      const dropped = session.applyTreeOps([{ op: 'removeContentControl', controlId }]);
      if (!dropped.committed) return dropped.reason ?? 'remove-refused';
      const swept = session.sweepCustomNodePayloads([PAYLOAD.namespaceUri]);
      if (!swept.ok) return swept.reason;
      return swept.removed.length > 0 ? null : 'nothing-swept';
    },
  },
  {
    name: 'session.ensureListDefinition (creates numbering.xml)',
    host: 'session',
    bytes: plainDoc,
    async run(session) {
      const numId = session.ensureListDefinition('bullet');
      if (numId === null) return 'ensure-refused';
      const applied = session.applyTreeOps([
        { op: 'setListNumbering', paragraphId: sessionParagraphId(session), numId, level: 0 },
      ]);
      return applied.committed ? null : (applied.reason ?? 'refused');
    },
  },
  {
    name: 'session.ensureNumberingLevel',
    host: 'session',
    bytes: listDoc,
    async run(session) {
      if (!session.ensureNumberingLevel('1', 1, 'ordered')) return 'ensure-refused';
      const applied = session.applyTreeOps([
        { op: 'setListLevel', paragraphId: sessionParagraphId(session), level: 1 },
      ]);
      return applied.committed ? null : (applied.reason ?? 'refused');
    },
  },
  {
    name: 'session.ensureHyperlinkRelationship',
    host: 'session',
    bytes: plainDoc,
    async run(session) {
      const relationshipId = session.ensureHyperlinkRelationship('https://example.com/link');
      if (relationshipId === null) return 'ensure-refused';
      const applied = session.applyTreeOps([
        {
          op: 'insertHyperlink',
          paragraphId: sessionParagraphId(session),
          start: 0,
          end: 3,
          relationshipId,
        },
      ]);
      return applied.committed ? null : (applied.reason ?? 'refused');
    },
  },
  {
    name: 'session.insertImage',
    host: 'session',
    bytes: plainDoc,
    async run(session) {
      const result = await session.insertImage(BODY, {
        paragraphId: sessionParagraphId(session),
        offset: 0,
        ...IMAGE_INSERT,
        expectedPackageRevision: session.packageRevision(),
      });
      return result.ok ? null : result.reason;
    },
  },
  {
    name: 'session.applyPackageUpdate (adds an image, its relationship, and a rels part)',
    host: 'session',
    bytes: plainDoc,
    async run(session) {
      const opened = openTreeSession(drawingDoc());
      if (!opened.ok) return opened.reason;
      const result = session.applyPackageUpdate(opened.session.currentPackage());
      return result.ok ? null : result.reason;
    },
  },
  {
    name: 'session.applyPackageUpdate (removes an image and adds a list part)',
    host: 'session',
    bytes: drawingDoc,
    async run(session) {
      const opened = openTreeSession(listDoc());
      if (!opened.ok) return opened.reason;
      const result = session.applyPackageUpdate(opened.session.currentPackage());
      return result.ok ? null : result.reason;
    },
  },
  {
    name: 'session.applyPackageUpdate (removes a header rels part and keeps the header)',
    host: 'session',
    bytes: () => headerDoc(true),
    async run(session) {
      const opened = openTreeSession(headerDoc(false));
      if (!opened.ok) return opened.reason;
      const result = session.applyPackageUpdate(opened.session.currentPackage());
      return result.ok ? null : result.reason;
    },
  },
  {
    name: 'session.applyPackageUpdate (adds a rels part to a kept header)',
    host: 'session',
    bytes: () => headerDoc(false),
    async run(session) {
      const opened = openTreeSession(headerDoc(true));
      if (!opened.ok) return opened.reason;
      const result = session.applyPackageUpdate(opened.session.currentPackage());
      return result.ok ? null : result.reason;
    },
  },
];

interface IntentRun {
  readonly journals: readonly CanonicalPrimitiveJournal[];
  readonly source: OoxmlPackage;
  readonly refusal: string | null;
}

function openReplica(intent: PackageWriteIntent): OoxmlPackage {
  if (intent.host === 'store') return openStore(intent.bytes()).currentPackage();
  const opened = openTreeSession(intent.bytes());
  if (!opened.ok) throw new Error(`replica did not open: ${opened.reason}`);
  return opened.session.currentPackage();
}

async function runIntent(intent: PackageWriteIntent): Promise<IntentRun> {
  const journals: CanonicalPrimitiveJournal[] = [];
  if (intent.host === 'store') {
    const store = openStore(intent.bytes());
    const stop = observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
    const refusal = await intent.run(store);
    flushPendingCanonicalJournals(store);
    stop();
    return { journals, source: store.currentPackage(), refusal };
  }
  const opened = openTreeSession(intent.bytes());
  if (!opened.ok) throw new Error(`fixture did not open: ${opened.reason}`);
  const session = opened.session;
  const port = session.collaborationPort('package-write-intent-gate');
  const stop = port.observePrimitiveJournal((journal) => journals.push(journal));
  const refusal = await intent.run(session);
  port.flushPendingJournals();
  stop();
  return { journals, source: session.currentPackage(), refusal };
}

describe('every package-level write intent replicates', () => {
  for (const intent of PACKAGE_WRITE_INTENTS) {
    test(`${intent.name} journals its package write`, async () => {
      const { journals, source, refusal } = await runIntent(intent);
      expect(refusal).toBeNull();

      if (journals.length === 0) {
        throw new Error(
          `\`${intent.name}\` committed without producing a primitive journal.\n\n` +
            'The local document moved and nothing was recorded, so every peer keeps the old\n' +
            'document with no error and no warning. Journal capture is armed per transaction:\n' +
            'wrap the commit in `runObservedStoreTransaction(packageStore, run, committed)`\n' +
            '(see `comment-package-write.ts` for the worked example). A write that reaches\n' +
            '`storyStore.transact`, `replacePackageShell` or `installPackageSnapshot` without\n' +
            'that wrapper cannot replicate.'
        );
      }

      // The replica opens the SAME WAY the source did. A session normalizes on open (paragraph
      // identity, repairs), so a replica opened as a bare store would differ before the intent
      // ran and report that as divergence.
      let replica = openReplica(intent);
      for (const journal of journals) {
        replica = replayCanonicalPrimitiveJournal(
          replica,
          journal,
          blobsForJournal(source, journal)
        );
      }
      try {
        assertPackagesEquivalent(replica, source);
      } catch (error) {
        throw new Error(
          `\`${intent.name}\` produced a journal that replays to a DIFFERENT package: ` +
            `${(error as Error).message}\n\n` +
            'Arming capture is necessary but not sufficient. Each package write needs its own\n' +
            'first-class effect, or the peer receives a partial edit:\n' +
            '  - media bytes -> `recordPutBinary` (and the session publishes the payload into\n' +
            '    the shared blob map from the same journal, or materialize fails `missing-blob`)\n' +
            '  - relationships -> `recordPutRelationship` / `recordDeleteRelationship`\n' +
            '  - content types -> `recordPutContentTypeOverride`\n' +
            '  - a new XML part -> `withPart`, which records `putXmlPart` for the whole root\n' +
            '  - namespace prefixes -> `recordSetNamespaceBinding`, or the peer refuses the\n' +
            '    part as `invalid-qname`\n' +
            'See the paste fix in `tree-package-fragment.ts` for all four failures in one write.'
        );
      }
    });
  }
});

/**
 * The four ways to move a package that do NOT go through `TreePackageStore.transact`.
 *
 * `transact` and `applyLifecycleOp` arm capture themselves, so an ordinary op-based write is
 * safe by construction. These four are the escapes: a story-store commit promoted into a
 * package undo unit, and the three direct package installs. Each historical instance of this
 * bug is a file that called one of them and never mentioned capture.
 */
const PACKAGE_SHELL_WRITES = [
  'replacePackageShell(',
  'installPackageSnapshot(',
  'promoteStoryTransactionToPackageUnit(',
  'adoptPackageUnit(',
] as const;

const CAPTURE_MARKER = 'runObservedStoreTransaction';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Files allowed to move the package without arming capture, each with the reason.
 *
 * Keep it short. An entry here is a documented silent-divergence risk, so it needs the same
 * justification a refusal would: say why the write cannot replicate and why refusing it is
 * worse.
 */
const CAPTURE_EXEMPT_FILES: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'store/store/tree-package-replace.ts',
    why:
      'A document compare rebuilds every part at once, which no journal intent replays. It ' +
      'never reaches a peer: the editor command (`COMPARE_COLLABORATION_REASON` in ' +
      '`editor/compare-documents-state.ts`) and the automation runtime both refuse compare ' +
      'while a collaboration session is attached.',
  },
];

function* laneSources(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      yield* laneSources(path);
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) yield path;
  }
}

describe('no package write path bypasses journal capture', () => {
  test('every file that installs a package outside a story transaction arms capture', () => {
    const exempt = new Set(CAPTURE_EXEMPT_FILES.map((entry) => entry.file));
    const bypassing: string[] = [];
    for (const path of laneSources(SRC)) {
      const source = readFileSync(path, 'utf8');
      const used = PACKAGE_SHELL_WRITES.filter((marker) => source.includes(marker));
      if (used.length === 0) continue;
      if (source.includes(CAPTURE_MARKER)) continue;
      const file = relative(SRC, path).split(sep).join('/');
      if (exempt.has(file)) continue;
      bypassing.push(`${file} -> ${used.join(', ')}`);
    }
    if (bypassing.length > 0) {
      throw new Error(
        'These files move the package without arming journal capture, so the edits they\n' +
          'make reach nobody:\n\n' +
          bypassing.map((entry) => `  ${entry}`).join('\n') +
          '\n\nWrap the write in `runObservedStoreTransaction(packageStore, run, committed)`\n' +
          'and add the intent to `PACKAGE_WRITE_INTENTS` in this file, which proves the\n' +
          'journal replays to an equivalent package on a peer. If the write genuinely cannot\n' +
          'replicate, make it REFUSE (see `REPLICABLE_REVIEW_WRITES` in `paginated-surface.ts`)\n' +
          'rather than diverge — a refused edit can be reconciled, a silent one cannot.'
      );
    }
  });

  test('every exemption still names a file that takes the escape', () => {
    for (const entry of CAPTURE_EXEMPT_FILES) {
      const source = readFileSync(join(SRC, entry.file), 'utf8');
      expect(PACKAGE_SHELL_WRITES.some((marker) => source.includes(marker))).toBe(true);
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });
});
