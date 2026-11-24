// The freshness oracle: incremental layout equals a from-scratch layout, under RANDOM edits.
//
// Every cache gate in this repo (scope-waste, settle-bench, edit-bench, the warm-derivation
// gate) protects WARMTH: it fails when a cache misses too much. Nothing failed when a cache
// key was too NARROW — a stale-render bug passed every gate, and the hand-enumerated
// differential suite (incremental-semantic-layout.test.ts) only covers the edit shapes
// someone thought to write. This test closes that side: a seeded generator drives random
// edit sequences over a multi-section document with a table, and after EVERY step the
// incremental pass must publish byte-identical pages to a clean pass over the same input.
//
// Determinism: fixed seeds, and a pure inline PRNG (mulberry32) — no wall clock, no
// Math.random, no dependency. A failure prints the seed and the accumulated edit script,
// which replays the exact sequence.
//
// Scope: every step re-parses the document, so this exercises the STRING-KEYED half of
// incrementality — flow keys, checkpoints, convergence, section spans. The identity-keyed
// half (prepared-block memos, the paragraph key memo hit test, prepass `bodies` identity)
// needs a store-driven variant that mutates one retained tree; that is tracked follow-up
// work, not covered here.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type LayoutSession,
  type SemanticLayout,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);

const lay = (part: OoxmlPart, revision: number, session?: LayoutSession): SemanticLayout =>
  layoutSemanticDocument(part, revision, { measurer, ...(session ? { session } : {}) });

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

// ── Document model ─────────────────────────────────────────────────────────────
// Two sections; the LAST paragraph of section 0 carries the mid-body w:sectPr and is
// never deleted or joined away. Section 1 holds a constant table between its paragraphs,
// so table flow participates in every pass without being edited itself.

interface Para {
  text: string;
  keepNext: boolean;
  contextualSpacing: boolean;
}

interface Doc {
  sections: [Para[], Para[]];
  /** Section 0 closes with two columns when set — the section-affecting edit. */
  twoColumns: boolean;
}

const para = (text: string): Para => ({ text, keepNext: false, contextualSpacing: false });

function initialDoc(): Doc {
  return {
    sections: [
      Array.from({ length: 10 }, (_, i) => para(`s0p${i} ${'word '.repeat(8)}`)),
      Array.from({ length: 10 }, (_, i) => para(`s1p${i} ${'word '.repeat(8)}`)),
    ],
    twoColumns: false,
  };
}

const TABLE =
  `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
  `<w:tr><w:tc><w:p><w:r><w:t>cell a</w:t></w:r></w:p></w:tc>` +
  `<w:tc><w:p><w:r><w:t>cell b</w:t></w:r></w:p></w:tc></w:tr>` +
  `<w:tr><w:tc><w:p><w:r><w:t>cell c</w:t></w:r></w:p></w:tc>` +
  `<w:tc><w:p><w:r><w:t>cell d</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;

function renderPara(block: Para, sectPrXml = ''): string {
  const props =
    (block.keepNext ? '<w:keepNext/>' : '') +
    (block.contextualSpacing ? '<w:contextualSpacing/>' : '') +
    sectPrXml;
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${block.text}</w:t></w:r></w:p>`;
}

const PAGE =
  `<w:pgSz w:w="6000" w:h="2400"/>` +
  `<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" w:header="100" w:footer="100"/>`;

function renderDoc(doc: Doc): string {
  const [s0, s1] = doc.sections;
  const cols = doc.twoColumns ? `<w:cols w:num="2" w:space="200"/>` : '';
  const section0 = s0
    .map((block, index) =>
      renderPara(block, index === s0.length - 1 ? `<w:sectPr>${cols}${PAGE}</w:sectPr>` : '')
    )
    .join('');
  // The constant table sits after section 1's second paragraph (or first, when short).
  const tableAt = Math.min(2, s1.length);
  const section1 =
    s1
      .slice(0, tableAt)
      .map((block) => renderPara(block))
      .join('') +
    TABLE +
    s1
      .slice(tableAt)
      .map((block) => renderPara(block))
      .join('');
  return `${section0}${section1}<w:sectPr>${PAGE}</w:sectPr>`;
}

// ── Edit vocabulary ────────────────────────────────────────────────────────────

type Edit = readonly [kind: string, section: number, index: number];

/** Applies one random edit and returns its replayable description. */
function randomEdit(doc: Doc, rand: () => number, step: number): Edit {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const section = rand() < 0.5 ? 0 : 1;
  const paras = doc.sections[section]!;
  const carrier = section === 0 ? paras.length - 1 : -1;
  const index = Math.floor(rand() * paras.length);
  const kind = pick([
    'insert-text',
    'delete-text',
    'split',
    'join',
    'insert-para',
    'delete-para',
    'toggle-keep-next',
    'toggle-contextual',
    'toggle-columns',
  ] as const);

  switch (kind) {
    case 'insert-text':
      paras[index]!.text += ` step${step} extra words`;
      break;
    case 'delete-text': {
      const words = paras[index]!.text.split(' ');
      paras[index]!.text = words.slice(0, Math.max(1, Math.floor(words.length / 2))).join(' ');
      break;
    }
    case 'split': {
      if (index === carrier) return ['skip', section, index];
      const words = paras[index]!.text.split(' ');
      const at = Math.max(1, Math.floor(words.length / 2));
      const tail = { ...paras[index]!, text: words.slice(at).join(' ') || 'tail' };
      paras[index]!.text = words.slice(0, at).join(' ');
      paras.splice(index + 1, 0, tail);
      break;
    }
    case 'join': {
      if (index >= paras.length - 1 || index + 1 === carrier || index === carrier) {
        return ['skip', section, index];
      }
      paras[index]!.text += ` ${paras[index + 1]!.text}`;
      paras.splice(index + 1, 1);
      break;
    }
    case 'insert-para':
      paras.splice(Math.min(index, carrier === -1 ? paras.length : carrier), 0, {
        ...para(`inserted at step ${step} ${'word '.repeat(4)}`),
      });
      break;
    case 'delete-para':
      if (paras.length <= 2 || index === carrier) return ['skip', section, index];
      paras.splice(index, 1);
      break;
    case 'toggle-keep-next':
      paras[index]!.keepNext = !paras[index]!.keepNext;
      break;
    case 'toggle-contextual':
      paras[index]!.contextualSpacing = !paras[index]!.contextualSpacing;
      break;
    case 'toggle-columns':
      doc.twoColumns = !doc.twoColumns;
      break;
  }
  return [kind, section, index];
}

// ── The oracle ─────────────────────────────────────────────────────────────────

const SEEDS = [0xc0ffee, 42, 20260824, 7];
const STEPS = 30;

describe('incremental layout equals from-scratch layout on random edit sequences', () => {
  for (const seed of SEEDS) {
    test(`seed ${seed}: ${STEPS} random edits, differential at every step`, () => {
      const rand = mulberry32(seed);
      const doc = initialDoc();
      const session = createLayoutSession();
      const log: Edit[] = [];

      const first = lay(load(renderDoc(doc)), 1, session);
      expect(first.pages.length).toBeGreaterThan(1);

      let reusedSteps = 0;
      let partialSteps = 0;
      for (let step = 0; step < STEPS; step += 1) {
        log.push(randomEdit(doc, rand, step));
        const part = load(renderDoc(doc));
        const incremental = publishedShapeOf(lay(part, step + 2, session));
        if (session.stats.reusedPages > 0) reusedSteps += 1;
        if (session.stats.placed < session.stats.total) partialSteps += 1;
        const fresh = publishedShapeOf(lay(part, step + 2));
        if (incremental !== fresh) {
          throw new Error(
            `Incremental layout diverged from a clean pass.\n` +
              `seed: ${seed}, step: ${step}\n` +
              `replay script (kind, section, index):\n${JSON.stringify(log)}`
          );
        }
      }
      // Anti-vacuity: an oracle comparing full pass against full pass proves nothing. If
      // resume ever breaks outright, equality above still holds — these counters are what
      // fail. Floors sit well under the measured behavior (17+ reuse steps per seed).
      expect(reusedSteps).toBeGreaterThanOrEqual(8);
      expect(partialSteps).toBeGreaterThanOrEqual(8);
    });
  }
});
