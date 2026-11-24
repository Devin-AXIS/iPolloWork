// The store-driven freshness oracle: incremental layout over ONE retained tree equals a
// from-scratch layout, under random `TreeDocOp` edits.
//
// The sibling oracle (randomized-incremental-layout.test.ts) re-parses the document each
// step, so it exercises only the STRING-KEYED half of incrementality — flow keys,
// checkpoints, convergence, section spans — because every step hands layout a freshly
// parsed tree. The IDENTITY-KEYED half never crosses an edit there: the prepared-block
// memo, the paragraph key memo and the prepass `bodies` identity comparison all key on
// node OBJECTS, and a re-parse mints new objects for everything.
//
// This test closes that side. One `TreeDocumentStore` is retained for the whole sequence;
// each step applies one random op through `store.transact`, and the store's persistent tree
// keeps every untouched node object-identical across revisions — so the identity-keyed
// memos carry real weight, exactly as they do under live editing.
//
// The differential is deliberately NOT "same tree, no session": the identity-keyed memos
// live in module-level WeakMaps keyed on node objects, so a fresh pass over the SAME nodes
// would read the same memo entries and inherit a poisoned one. The clean pass instead lays
// out a structuredClone of the part — same ids, same content, all-new node objects — which
// can share nothing identity-keyed with the incremental pass. A memo whose validator is too
// narrow now diverges from the clone instead of agreeing with itself.
//
// Sensitivity was verified by mutation: dropping the prepass `bodies.every` identity
// comparison fails every seed at step 0, and making the prepared-block memo unconditional
// fails every seed once a side-margin op moves the content width. The vocabulary includes
// that op for exactly that reason — without a width change, an unconditionally-served
// prepared entry is masked, because placement re-reads list markers from the current pass.
//
// Determinism: fixed seeds and a pure inline PRNG (mulberry32). A failure prints the seed
// and the accumulated op script, which replays the exact sequence.
//
// Not covered here (issue follow-up): tracked-change decisions, header/footer story edits,
// footnotes, and the scheduler's change-evidence lane into list-resolve.

import { describe, expect, test } from 'bun:test';
import {
  paragraphTextOf,
  readOoxmlPart,
  TreeDocumentStore,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import {
  buildNumberingIndex,
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type LayoutSession,
  type NumberingIndex,
  type PageFurniture,
  type SemanticLayout,
} from '../index.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function loadPart(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);

/** Every published field of every page, so a stale value anywhere fails the comparison. */
const publishedShapeOf = (layout: SemanticLayout): string => JSON.stringify(layout.pages);

/** Deterministic PRNG. Same seed, same sequence, every run, every machine. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Document ───────────────────────────────────────────────────────────────────
// Two sections; the last paragraph of section 0 carries the mid-body w:sectPr and is never
// joined or deleted. Section 1 holds a table between its paragraphs, so table flow
// participates in every pass. A few paragraphs start numbered so list resolve is live from
// step 0; ops churn membership both ways after that.

const PAGE =
  `<w:pgSz w:w="6000" w:h="2400"/>` +
  `<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" w:header="100" w:footer="100"/>`;

const NUM_PR = `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`;

const para = (text: string, pPr = ''): string =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const TABLE =
  `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
  `<w:tr><w:tc><w:p><w:r><w:t>cell a</w:t></w:r></w:p></w:tc>` +
  `<w:tc><w:p><w:r><w:t>cell b</w:t></w:r></w:p></w:tc></w:tr>` +
  `<w:tr><w:tc><w:p><w:r><w:t>cell c</w:t></w:r></w:p></w:tc>` +
  `<w:tc><w:p><w:r><w:t>cell d</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;

// A STATIC default header carrying PAGE and NUMPAGES rides every page of both sections. The
// random edits never target it — it exists so the per-page field finalize (and its memo on
// reused page records) sits inside the differential: page-count moves must re-project the
// header on every reused sheet, and `publishedShapeOf` serializes the furniture too.
const HEADER_PART_XML = (() => {
  const field = (instr: string) =>
    `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>${instr}</w:instrText>` +
    `<w:fldChar w:fldCharType="separate"/><w:t>0</w:t><w:fldChar w:fldCharType="end"/></w:r>`;
  return (
    `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>${field('PAGE')}` +
    `<w:r><w:t xml:space="preserve"> of </w:t></w:r>${field('NUMPAGES')}</w:p></w:hdr>`
  );
})();

/** Section content width in points: 6000 − 200 − 200 twips. */
const HEADER_CONTENT_WIDTH = 280;

/**
 * Fresh furniture from a header part. The incremental pass retains ONE furniture object (as a
 * live session would); each clean pass builds its own from a `structuredClone` of the same part
 * — same ids and content, all-new objects — so no story-keyed cache can be shared either.
 */
function headerFurnitureOf(headerPart: OoxmlPart): PageFurniture {
  return {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map([
      ['default', layoutHeaderFooterStory(headerPart, HEADER_CONTENT_WIDTH, measurer, 'test')],
    ]),
    footers: new Map(),
  };
}

/** The projected header text of one page, for the anti-vacuity check below. */
function headerTextOf(layout: SemanticLayout, pageIndex: number): string {
  const story = layout.pages[pageIndex]?.header;
  if (!story) return '';
  return story.fragments
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    )
    .join('');
}

function initialDocumentPart(): OoxmlPart {
  const words = 'word '.repeat(8);
  const section0 =
    Array.from({ length: 9 }, (_, i) =>
      para(`s0p${i} ${words}`, i >= 2 && i <= 4 ? NUM_PR : '')
    ).join('') + para(`s0p9 ${words}`, `<w:sectPr>${PAGE}</w:sectPr>`);
  const section1 =
    para(`s1p0 ${words}`) +
    para(`s1p1 ${words}`, NUM_PR) +
    TABLE +
    Array.from({ length: 8 }, (_, i) => para(`s1p${i + 2} ${words}`, i === 0 ? NUM_PR : '')).join(
      ''
    );
  return loadPart(
    `<w:document xmlns:w="${W}"><w:body>${section0}${section1}<w:sectPr>${PAGE}</w:sectPr></w:body></w:document>`,
    '/word/document.xml'
  );
}

/** A constant one-list numbering part; the index is built once and retained. */
function numberingIndexForTest(): NumberingIndex {
  const levels = Array.from(
    { length: 3 },
    (_, level) =>
      `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="decimal"/>` +
      `<w:lvlText w:val="%${level + 1}."/><w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="${720 * (level + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
  ).join('');
  const part = loadPart(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">${levels}</w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    '/word/numbering.xml'
  );
  return buildNumberingIndex(part.root);
}

// ── Reading the retained tree ──────────────────────────────────────────────────

function* walk(node: OoxmlNode): Generator<OoxmlNode> {
  yield node;
  if (node.kind === 'textValue') return;
  for (const child of node.children ?? []) yield* walk(child);
}

interface ParagraphSite {
  readonly id: string;
  readonly length: number;
  /** Whether the paragraph's own `w:pPr` holds the mid-body `w:sectPr`. */
  readonly carriesSectionMark: boolean;
}

function paragraphSitesOf(part: OoxmlPart): ParagraphSite[] {
  const sites: ParagraphSite[] = [];
  for (const node of walk(part.root)) {
    if (node.kind !== 'paragraph') continue;
    const props = node.children.find((child) => child.kind === 'paragraphProperties');
    const carriesSectionMark =
      props !== undefined &&
      props.kind !== 'textValue' &&
      props.children.some((child) => child.kind !== 'textValue' && child.localName === 'sectPr');
    sites.push({
      id: node.id,
      length: paragraphTextOf(part, node.id)?.length ?? 0,
      carriesSectionMark,
    });
  }
  return sites;
}

/** Adjacent (first, second) paragraph pairs among the body's direct children. */
function adjacentBodyParagraphPairs(part: OoxmlPart): [string, string][] {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  );
  const pairs: [string, string][] = [];
  if (!body) return pairs;
  const children = body.children;
  for (let index = 0; index + 1 < children.length; index += 1) {
    const first = children[index]!;
    const second = children[index + 1]!;
    if (first.kind === 'paragraph' && second.kind === 'paragraph') {
      pairs.push([first.id, second.id]);
    }
  }
  return pairs;
}

// ── Op vocabulary ──────────────────────────────────────────────────────────────
// Everything here is generated against the CURRENT tree, so ids and offsets are usually
// valid; the store may still refuse (a join into the section carrier, a zero-length
// delete). A refusal is logged and the step is skipped — and the applied-op floor below
// keeps the test from passing by refusing everything.

type OpKind =
  | 'insert-text'
  | 'delete-text'
  | 'split'
  | 'join'
  | 'paragraph-props'
  | 'list-on'
  | 'list-off'
  | 'list-level'
  | 'section-margins';

const OP_KINDS: readonly OpKind[] = [
  'insert-text',
  'insert-text',
  'delete-text',
  'delete-text',
  'split',
  'join',
  'paragraph-props',
  'list-on',
  'list-off',
  'list-level',
  'section-margins',
];

function randomOp(part: OoxmlPart, rand: () => number, step: number): TreeDocOp | null {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const sites = paragraphSitesOf(part);
  if (sites.length === 0) return null;
  const site = pick(sites);
  const kind = pick(OP_KINDS);
  switch (kind) {
    case 'insert-text':
      return {
        op: 'insertText',
        paragraphId: site.id,
        offset: Math.floor(rand() * (site.length + 1)),
        text: ` step${step} extra words`,
      };
    case 'delete-text': {
      if (site.length < 2) return null;
      const start = Math.floor(rand() * (site.length - 1));
      const end = start + 1 + Math.floor(rand() * (site.length - start - 1));
      return { op: 'deleteText', paragraphId: site.id, start, end };
    }
    case 'split':
      return {
        op: 'splitParagraph',
        paragraphId: site.id,
        offset: Math.floor(rand() * (site.length + 1)),
      };
    case 'join': {
      const pairs = adjacentBodyParagraphPairs(part).filter(
        ([firstId, secondId]) =>
          !sites.find((s) => s.id === firstId)?.carriesSectionMark &&
          !sites.find((s) => s.id === secondId)?.carriesSectionMark
      );
      if (pairs.length === 0) return null;
      const [firstId, secondId] = pick(pairs);
      return { op: 'joinParagraphs', firstId, secondId };
    }
    case 'paragraph-props':
      // `setParagraphProperties` REPLACES the authorable set, so an unnamed `w:numPr` is
      // dropped — deliberate churn: the oracle needs list membership to move both ways.
      return {
        op: 'setParagraphProperties',
        paragraphId: site.id,
        properties: pick([
          [{ localName: 'keepNext' }],
          [{ localName: 'contextualSpacing' }],
          [{ localName: 'jc', attributes: { val: pick(['center', 'right', 'both']) } }],
          [{ localName: 'spacing', attributes: { after: '240' } }],
          [],
        ]),
      };
    case 'list-on':
      return {
        op: 'setListNumbering',
        paragraphId: site.id,
        numId: '1',
        level: Math.floor(rand() * 3),
      };
    case 'list-off':
      return { op: 'setListNumbering', paragraphId: site.id, numId: null };
    case 'list-level':
      return { op: 'setListLevel', paragraphId: site.id, level: Math.floor(rand() * 3) };
    case 'section-margins': {
      // Left/right margins move the CONTENT WIDTH, which is what gives the width validator
      // of the prepared-block memo real weight: every retained node must re-prepare at the
      // new width, and a memo that ignores width serves breaks taken under the old one.
      const margin = pick([150, 200, 300]);
      return { op: 'setSectionProperties', marginLeftTwips: margin, marginRightTwips: margin };
    }
  }
}

// ── Observing the identity-keyed caches ────────────────────────────────────────
// `LayoutSession.prepass` is opaque by contract; this test reads two fields of the shape
// `semantic-layout.ts` stores there, through a narrow structural view. If the shape ever
// changes, the counters read zero and the floors below fail LOUDLY — the observation can
// rot into a failure, never into silence.

interface PrepassView {
  readonly prepared?: readonly unknown[];
}

const sectionSessionsOf = (session: LayoutSession): readonly LayoutSession[] =>
  session.multi ? session.multi.sections : [session];

function preparedEntriesOf(session: LayoutSession): unknown[] {
  const entries: unknown[] = [];
  for (const sectionSession of sectionSessionsOf(session)) {
    const prepass = sectionSession.prepass as PrepassView | null;
    if (prepass && Array.isArray(prepass.prepared)) entries.push(...prepass.prepared);
  }
  return entries;
}

// ── The oracle ─────────────────────────────────────────────────────────────────

const SEEDS = [0xc0ffee, 42, 20260824, 7];
const STEPS = 30;

const NUMBERING = numberingIndexForTest();

const lay = (
  part: OoxmlPart,
  revision: number,
  furniture: PageFurniture,
  session?: LayoutSession
): SemanticLayout =>
  layoutSemanticDocument(part, revision, {
    measurer,
    numberingIndex: NUMBERING,
    // Both sections wear the same default header; the section count is pinned at two (the
    // section carrier is never joined or deleted), so the array stays index-aligned.
    sectionFurniture: [furniture, furniture],
    ...(session ? { session } : {}),
  });

describe('store-driven incremental layout equals from-scratch layout on random op sequences', () => {
  for (const seed of SEEDS) {
    test(`seed ${seed}: ${STEPS} random ops over one retained store`, () => {
      const rand = mulberry32(seed);
      const store = new TreeDocumentStore(initialDocumentPart());
      const session = createLayoutSession();
      const log: unknown[] = [];

      const headerPart = loadPart(HEADER_PART_XML, '/word/header1.xml');
      const retainedFurniture = headerFurnitureOf(headerPart);

      let revision = 1;
      const first = lay(store.part, revision, retainedFurniture, session);
      expect(first.pages.length).toBeGreaterThan(1);
      // The header really carries live page fields, or the finalize memo is invisible here.
      expect(headerTextOf(first, 0)).toBe(`Page 1 of ${first.pages.length}`);
      expect(headerTextOf(first, first.pages.length - 1)).toBe(
        `Page ${first.pages.length} of ${first.pages.length}`
      );
      // The observation contract: the prepass shape must be visible from step 0, or every
      // identity floor below would be measuring nothing.
      let previousPrepasses = sectionSessionsOf(session).map((s) => s.prepass);
      let previousEntries = new Set(preparedEntriesOf(session));
      expect(previousEntries.size).toBeGreaterThan(0);

      let applied = 0;
      let reusedSteps = 0;
      let partialSteps = 0;
      let prepassCarriedSteps = 0;
      let rebuiltPreparedHits = 0;
      for (let step = 0; step < STEPS; step += 1) {
        const op = randomOp(store.part, rand, step);
        if (op === null) {
          log.push(['skip', step]);
          continue;
        }
        const result = store.transact((tx) => {
          tx.apply(op);
        });
        if (!result.ok) {
          log.push(['refused', step, result.reason, op]);
          continue;
        }
        log.push([step, op]);
        applied += 1;
        revision += 1;

        const incremental = publishedShapeOf(lay(store.part, revision, retainedFurniture, session));
        if (session.stats.reusedPages > 0) reusedSteps += 1;
        if (session.stats.placed < session.stats.total) partialSteps += 1;

        // Identity evidence, taken between the two passes: which sections carried their
        // whole prepass (the `bodies` identity comparison), and how many prepared-block
        // memo entries survived into a REBUILT prepass (the per-node WeakMap hits).
        const prepasses = sectionSessionsOf(session).map((s) => s.prepass);
        const entries = preparedEntriesOf(session);
        if (prepasses.some((p, i) => p !== null && p === previousPrepasses[i])) {
          prepassCarriedSteps += 1;
        }
        prepasses.forEach((prepass, index) => {
          if (prepass === null || prepass === previousPrepasses[index]) return;
          const view = prepass as PrepassView;
          if (!Array.isArray(view.prepared)) return;
          for (const entry of view.prepared) {
            if (previousEntries.has(entry)) rebuiltPreparedHits += 1;
          }
        });
        previousPrepasses = prepasses;
        previousEntries = new Set(entries);

        // The clean pass: same ids, same content, all-new node objects — nothing
        // identity-keyed can be shared with the incremental pass. Furniture too: a fresh
        // story from a cloned header part, so the finalize memo (keyed on the incremental
        // pass's page records) cannot answer for any clean page.
        const fresh = publishedShapeOf(
          lay(structuredClone(store.part), revision, headerFurnitureOf(structuredClone(headerPart)))
        );
        if (incremental !== fresh) {
          throw new Error(
            `Store-driven incremental layout diverged from a clean pass.\n` +
              `seed: ${seed}, step: ${step}\n` +
              `replay script:\n${JSON.stringify(log)}`
          );
        }
      }

      // Anti-vacuity. An oracle comparing full pass against full pass proves nothing, and a
      // generator that only produces refused ops proves less. Floors sit well under the
      // measured behavior across the pinned seeds: applied 25+, reused 21+, partial 24+,
      // prepass carried 15+, rebuilt prepared hits 270+.
      expect(applied).toBeGreaterThanOrEqual(20);
      expect(reusedSteps).toBeGreaterThanOrEqual(10);
      expect(partialSteps).toBeGreaterThanOrEqual(10);
      expect(prepassCarriedSteps).toBeGreaterThanOrEqual(8);
      expect(rebuiltPreparedHits).toBeGreaterThanOrEqual(120);
    });
  }
});
