// Shared random-edit harness for the memo-freshness differentials
// (`derivation-memo-freshness.test.ts`, `note-scan-memo-freshness.test.ts`).
//
// Each suite supplies its own fixture, oracle and op distribution; this module owns the
// deterministic machinery they must not let drift apart: the PRNG, the op generator that
// reads the CURRENT tree, and the transact/log/replay driver. A failure in either suite
// prints the seed and the accumulated op script, which replays the exact sequence.

import {
  paragraphTextOf,
  TreeDocumentStore,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type TreeDocOp,
} from '../index.ts';
import { readOoxmlPart } from '../package/index.ts';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

export function loadPart(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** Deterministic PRNG. Same seed, same sequence, every run, every machine. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Reading the retained tree ──────────────────────────────────────────────────

function* walk(node: OoxmlNode): Generator<OoxmlNode> {
  yield node;
  if (node.kind === 'textValue') return;
  for (const child of node.children ?? []) yield* walk(child);
}

function paragraphSitesOf(part: OoxmlPart): { id: string; length: number }[] {
  const sites: { id: string; length: number }[] = [];
  for (const node of walk(part.root)) {
    if (node.kind !== 'paragraph') continue;
    sites.push({ id: node.id, length: paragraphTextOf(part, node.id)?.length ?? 0 });
  }
  return sites;
}

/** Adjacent (first, second) paragraph pairs among the body's direct children. */
function adjacentBodyParagraphPairs(part: OoxmlPart): [string, string][] {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  );
  const pairs: [string, string][] = [];
  const children = body?.children ?? [];
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
// Generated against the CURRENT tree, so ids and offsets are usually valid; the store
// may still refuse (a delete crossing tracked content, a join it will not perform). A
// refusal is logged and skipped, and each suite's applied-op floor keeps its test from
// passing by refusing everything.

export type RandomOpKind = 'insert-text' | 'delete-text' | 'split' | 'join' | 'tracked-insert';

export const PLAIN_RANDOM_OPS: readonly RandomOpKind[] = [
  'insert-text',
  'insert-text',
  'delete-text',
  'split',
  'split',
  'join',
];
export const TRACKED_RANDOM_OPS: readonly RandomOpKind[] = [
  ...PLAIN_RANDOM_OPS,
  'tracked-insert',
  'tracked-insert',
];

export function randomOp(
  part: OoxmlPart,
  rand: () => number,
  step: number,
  ops: readonly RandomOpKind[]
): TreeDocOp | null {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const sites = paragraphSitesOf(part);
  if (sites.length === 0) return null;
  const site = pick(sites);
  switch (pick(ops)) {
    case 'insert-text':
      return {
        op: 'insertText',
        paragraphId: site.id,
        offset: Math.floor(rand() * (site.length + 1)),
        text: ` step${step} extra`,
      };
    case 'tracked-insert':
      return {
        op: 'insertText',
        paragraphId: site.id,
        offset: Math.floor(rand() * (site.length + 1)),
        text: ` step${step} proposal`,
        revision: { author: 'QA Reviewer', date: '2026-01-03T00:00:00Z' },
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
      const pairs = adjacentBodyParagraphPairs(part);
      if (pairs.length === 0) return null;
      const [firstId, secondId] = pick(pairs);
      return { op: 'joinParagraphs', firstId, secondId };
    }
  }
}

// ── The driver ─────────────────────────────────────────────────────────────────

export interface RandomEditDriveResult {
  /** Ops the store accepted. Suites assert a floor so refusals cannot vacuously pass. */
  readonly applied: number;
  /** Applied splitParagraph ops, for suites whose oracle needs fresh spines minted. */
  readonly splitsApplied: number;
  /** The replayable op script (also handed to `onApplied` for failure messages). */
  readonly log: unknown[];
}

/**
 * Drive `steps` random ops through the store, logging skips and refusals, and call
 * `onApplied` after every accepted op — that is where each suite runs its differential.
 */
export function driveRandomEdits(
  store: TreeDocumentStore,
  options: {
    readonly rand: () => number;
    readonly steps: number;
    readonly ops: readonly RandomOpKind[];
    readonly onApplied: (step: number, op: TreeDocOp, log: unknown[]) => void;
  }
): RandomEditDriveResult {
  const log: unknown[] = [];
  let applied = 0;
  let splitsApplied = 0;
  for (let step = 0; step < options.steps; step += 1) {
    const op = randomOp(store.part, options.rand, step, options.ops);
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
    if (op.op === 'splitParagraph') splitsApplied += 1;
    options.onApplied(step, op, log);
  }
  return { applied, splitsApplied, log };
}
