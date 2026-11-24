// Lowered DrawingML shape text keeps every line: a body taller than its text box overflows it
// on the side its anchor leaves open, while an ordinary text box still clips at its box.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer } from '../index.ts';
import { layoutTextboxStory } from '../textbox-story-layout.ts';
import {
  projectDrawingsInPackage,
  type DrawingProjection,
} from '../../store/package/drawing-projection.ts';
import { simpleTextBody, smartArtPackage } from '../../store/__tests__/smartart-fixture.ts';

const measurer = createFixedMeasurer(6, 14);

function memberLayout(anchor: 't' | 'ctr' | 'b', drawingText = true) {
  const paragraphs = Array.from(
    { length: 6 },
    (_, index) => `<a:p><a:r><a:rPr lang="en-US" sz="1200"/><a:t>Line ${index}</a:t></a:r></a:p>`
  ).join('');
  const txBody = simpleTextBody(
    'unused',
    1200,
    `anchor="${anchor}" lIns="0" tIns="0" rIns="0" bIns="0"`
  ).replace(/<a:p>.*<\/a:p>/s, paragraphs);
  const pkg = smartArtPackage({
    shapes: [{ preset: 'rect', off: [0, 0], ext: [1270000, 254000], txBody }],
  });
  const [projection] = projectDrawingsInPackage(pkg);
  const member = projection!.groupTextboxes![0]!;
  const story = drawingText ? member.story : { ...member.story, drawingText: undefined };
  const memberProjection: DrawingProjection = {
    ...projection!,
    drawingNodeId: member.memberNodeId,
    extentEmu: { cx: member.frameEmu.cx, cy: member.frameEmu.cy },
    textboxStory: story,
    groupTextboxes: undefined,
  };
  return layoutTextboxStory(memberProjection, { measurer, producer: 'test' })!;
}

describe('DrawingML text overflow', () => {
  test('every line lays out and a centred body overflows on both sides', () => {
    const layout = memberLayout('ctr');
    expect(layout.fragments.length).toBe(6);
    expect(layout.fallbackReason).toBeUndefined();
    expect(layout.flowHeight).toBeGreaterThan(20);
    expect(layout.contentOffset.y).toBeCloseTo((20 - layout.flowHeight) / 2, 6);
    expect(layout.contentHeight).toBeCloseTo(layout.flowHeight, 6);
    expect(layout.overflowVisible).toBe(true);
  });

  test('a bottom-anchored body overflows upward and a top-anchored one downward', () => {
    const bottom = memberLayout('b');
    expect(bottom.contentOffset.y).toBeCloseTo(20 - bottom.flowHeight, 6);
    const top = memberLayout('t');
    expect(top.contentOffset.y).toBe(0);
    expect(top.fragments.length).toBe(6);
  });

  test('an ordinary text box story still clips at its box', () => {
    const layout = memberLayout('ctr', false);
    expect(layout.fragments.length).toBeLessThan(6);
    expect(layout.fallbackReason).toBe('textbox-height-clip');
    expect(layout.contentHeight).toBeCloseTo(20, 6);
    expect(layout.overflowVisible).toBeUndefined();
  });
});
