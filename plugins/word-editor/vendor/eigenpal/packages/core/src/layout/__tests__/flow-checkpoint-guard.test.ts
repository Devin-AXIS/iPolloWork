// Behavioral coverage of every declared checkpoint role. A compared field must reject
// a changed state, while page and line counts remain outside in-page convergence.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type PageGeometry,
} from '../index.ts';
import {
  FLOW_CHECKPOINT_GUARDS,
  unguardedCheckpointFields,
  type FlowCheckpointGuard,
} from '../flow-checkpoint-guards.ts';

import { FlowCheckpointOwner, flowCheckpointsMatch } from '../flow-checkpoint.ts';
import type { FlowCheckpoint } from '../layout-session.ts';
import type { AnchoredDrawingRecord } from '../drawing-layout.ts';
import { ParagraphFrameFlow } from '../paragraph-frame-flow.ts';
import { readParagraphFrame } from '../paragraph-frame.ts';
import {
  positionedTableFlow,
  type PositionedTableAnchor,
  type PositionedTableAnchorSignal,
} from '../table-float-position.ts';
import { TextTableCarry } from '../table-text-carry.ts';

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
const GEOMETRY: PageGeometry = {
  width: 300,
  height: 120,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const DOCUMENT = Array.from({ length: 24 }, (_, index) =>
  paragraph(`paragraph ${index} ${'word '.repeat(6)}`)
).join('');

describe('every checkpoint field is classified', () => {
  test('a real multi-page pass records checkpoints with no unguarded field', () => {
    const session = createLayoutSession();
    layoutSemanticDocument(load(DOCUMENT), 1, { measurer, geometry: GEOMETRY, session });
    expect(session.checkpoints.length).toBeGreaterThan(0);
    for (const checkpoint of session.checkpoints) {
      expect(unguardedCheckpointFields(checkpoint)).toEqual([]);
    }
  });
});

function populatedCheckpoint() {
  const session = createLayoutSession();
  layoutSemanticDocument(load(DOCUMENT), 1, { measurer, geometry: GEOMETRY, session });
  const source = session.checkpoints.find((checkpoint) => checkpoint.pageFragments.length > 0)!;
  const fragment = source.pageFragments[0]!;
  if (fragment.kind !== 'paragraph') throw new Error('Expected paragraph fixture');
  const paragraphFrames = new ParagraphFrameFlow();
  const frame = readParagraphFrame([
    { localName: 'framePr', attributes: { x: '400', y: '600', w: '2000' } },
  ])!;
  paragraphFrames.add(frame, fragment);
  // Only the immutable table ID is consumed by this flow owner, as in positioned-table-flow.test.
  const anchors = [
    { table: { id: 'table' }, sourceIndex: 0, anchorId: 'anchor' },
  ] as PositionedTableAnchor[];
  const positionedFlow = positionedTableFlow(anchors, ['table-key']);
  const pendingFloatIds = new Set<string>();
  const floatSignals: PositionedTableAnchorSignal[] = [];
  positionedFlow.add(pendingFloatIds, 'table');
  positionedFlow.note(floatSignals, 'anchor', 0, 0, 12);
  const anchorPageDeferCounts = new Map([['drawing', 1]]);
  // The carry reads only its held pages here.
  const textCarry = new TextTableCarry({} as ConstructorParameters<typeof TextTableCarry>[0]);
  textCarry.restore([[fragment]]);
  const owner = new FlowCheckpointOwner({
    textCarry,
    paragraphFrames,
    positionedFlow,
    pendingFloatIds,
    floatSignals,
    anchorPageDeferCounts,
  });
  // Drawing convergence is identity-only; the checkpoint owner never reads record contents.
  const drawing = { kind: 'anchoredDrawing' } as AnchoredDrawingRecord;
  const state = {
    ...source,
    pageFragments: [...source.pageFragments],
    pendingAnchoredDrawings: [drawing],
    deferredAnchoredDrawings: [drawing],
  };
  const checkpoint = owner.capture(state);
  return {
    owner,
    state,
    checkpoint,
    paragraphFrames,
    positionedFlow,
    pendingFloatIds,
    floatSignals,
    anchorPageDeferCounts,
  };
}

const changes = {
  pageCount: (c) => ({ ...c, pageCount: c.pageCount + 1 }),
  pageFragments: (c) => ({ ...c, pageFragments: [] }),
  pendingParagraphFrames: (c) => ({ ...c, pendingParagraphFrames: undefined }),
  pendingAnchoredDrawings: (c) => ({
    ...c,
    pendingAnchoredDrawings: [{ ...c.pendingAnchoredDrawings[0]! }],
  }),
  deferredAnchoredDrawings: (c) => ({ ...c, deferredAnchoredDrawings: [] }),
  anchorPageDeferCounts: (c) => ({ ...c, anchorPageDeferCounts: new Map([['drawing', 2]]) }),
  pendingPositionedTableTokens: (c) => ({ ...c, pendingPositionedTableTokens: undefined }),
  heldTablePages: (c) => ({ ...c, heldTablePages: undefined }),
  positionedTableAnchorSignals: (c) => ({
    ...c,
    positionedTableAnchorSignals: [{ ...c.positionedTableAnchorSignals![0]!, anchorY: 99 }],
  }),
  cursorY: (c) => ({ ...c, cursorY: c.cursorY + 1 }),
  lineCounter: (c) => ({ ...c, lineCounter: c.lineCounter + 1 }),
  previousSpaceAfter: (c) => ({ ...c, previousSpaceAfter: c.previousSpaceAfter + 1 }),
  flowColumnIndex: (c) => ({ ...c, flowColumnIndex: c.flowColumnIndex + 1 }),
} satisfies Record<keyof FlowCheckpoint, (checkpoint: FlowCheckpoint) => FlowCheckpoint>;

describe('the convergence comparison agrees with the map', () => {
  const { checkpoint } = populatedCheckpoint();
  test('equivalent snapshots match', () => {
    expect(flowCheckpointsMatch(checkpoint, checkpoint)).toBe(true);
    expect(
      flowCheckpointsMatch(checkpoint, {
        ...checkpoint,
        pageFragments: checkpoint.pageFragments.map((fragment) => ({ ...fragment })),
        anchorPageDeferCounts: new Map(checkpoint.anchorPageDeferCounts),
        pendingParagraphFrames: { ...checkpoint.pendingParagraphFrames! },
        pendingPositionedTableTokens: { ...checkpoint.pendingPositionedTableTokens! },
        positionedTableAnchorSignals: checkpoint.positionedTableAnchorSignals!.map((signal) => ({
          ...signal,
        })),
      })
    ).toBe(true);
  });
  for (const field of Object.keys(changes) as (keyof FlowCheckpoint)[]) {
    const guard: FlowCheckpointGuard = FLOW_CHECKPOINT_GUARDS[field];
    test(`${field}: ${guard}`, () => {
      const changed = changes[field](checkpoint);
      expect(flowCheckpointsMatch(checkpoint, changed)).toBe(guard !== 'compared');
      expect(flowCheckpointsMatch(changed, checkpoint)).toBe(guard !== 'compared');
    });
  }
});

test('capture and restore isolate mutable collections but preserve immutable records and prefixes', () => {
  const fixture = populatedCheckpoint();
  const {
    owner,
    checkpoint,
    state,
    paragraphFrames,
    pendingFloatIds,
    floatSignals,
    anchorPageDeferCounts,
  } = fixture;
  const before = structuredClone(checkpoint);
  state.pageFragments.length = 0;
  state.pendingAnchoredDrawings.length = 0;
  state.deferredAnchoredDrawings.length = 0;
  paragraphFrames.restore(undefined);
  pendingFloatIds.clear();
  floatSignals.length = 0;
  anchorPageDeferCounts.clear();
  expect(checkpoint).toEqual(before);

  const restored = owner.restore(checkpoint);
  expect(owner.capture(restored)).toEqual(checkpoint);
  expect(restored.pageFragments).not.toBe(checkpoint.pageFragments);
  expect(restored.pageFragments[0]).toBe(checkpoint.pageFragments[0]);
  expect(restored.pendingAnchoredDrawings[0]).toBe(checkpoint.pendingAnchoredDrawings[0]);
  expect(paragraphFrames.checkpoint()).toBe(checkpoint.pendingParagraphFrames);
  expect(
    fixture.positionedFlow.checkpoint(pendingFloatIds, floatSignals).pendingPositionedTableTokens
  ).toBe(checkpoint.pendingPositionedTableTokens);
  expect([...pendingFloatIds]).toEqual(['table']);

  restored.pageFragments.length = 0;
  restored.pendingAnchoredDrawings.length = 0;
  restored.deferredAnchoredDrawings.length = 0;
  floatSignals.push({ anchorId: 'other', column: 1, fragmentIndex: 3, anchorY: 42 });
  anchorPageDeferCounts.set('drawing', 9);
  expect(checkpoint).toEqual(before);
});

test('restoring an empty checkpoint clears pending owners and keeps shared empty snapshots safe', () => {
  const {
    owner,
    checkpoint,
    paragraphFrames,
    pendingFloatIds,
    floatSignals,
    anchorPageDeferCounts,
  } = populatedCheckpoint();
  const empty = {
    ...checkpoint,
    pendingParagraphFrames: undefined,
    pendingPositionedTableTokens: undefined,
    positionedTableAnchorSignals: undefined,
    deferredAnchoredDrawings: [],
    anchorPageDeferCounts: new Map<string, number>(),
  };
  const state = owner.restore(empty);
  expect(paragraphFrames.checkpoint()).toBeUndefined();
  expect(pendingFloatIds.size).toBe(0);
  expect(floatSignals).toEqual([]);
  expect(anchorPageDeferCounts.size).toBe(0);
  const captured = owner.capture(state);
  const restored = owner.restore(captured);
  restored.deferredAnchoredDrawings.push(checkpoint.pendingAnchoredDrawings[0]!);
  anchorPageDeferCounts.set('new', 1);
  expect(captured.deferredAnchoredDrawings).toEqual([]);
  expect(captured.anchorPageDeferCounts.size).toBe(0);
});
