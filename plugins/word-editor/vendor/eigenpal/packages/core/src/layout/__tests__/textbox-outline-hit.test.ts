// Where a press reaches the shape a text box paints past its frame: a callout's tail, a turned
// box's corners, and the curve of a legacy oval or rounded box, never the empty corners of the
// frame around a curve.

import { expect, test } from 'bun:test';
import type { AnchoredDrawingRecord } from '../drawing-layout.ts';
import {
  textboxOutlineHit,
  textboxPaintsPastFrame,
  textboxPressReaches,
} from '../vector-shape-hit.ts';

const FRAME = { x: 100, y: 100, width: 100, height: 50 };

function textbox(story: Record<string, unknown>): AnchoredDrawingRecord {
  return {
    geometry: { contentBounds: FRAME },
    vectorShape: null,
    textboxStory: {
      fillHex: 'FFFFFF',
      strokeHex: null,
      strokeWidthPt: 0,
      // An upright text area inset 5pt in the frame.
      contentOffset: { x: 5, y: 5 },
      contentWidth: FRAME.width - 10,
      contentHeight: FRAME.height - 10,
      ...story,
    },
  } as unknown as AnchoredDrawingRecord;
}

const hit = (record: AnchoredDrawingRecord, x: number, y: number) =>
  textboxOutlineHit(record, { x, y });

test('a frame that paints nothing past itself answers null', () => {
  expect(textboxPaintsPastFrame(textbox({}))).toBe(false);
  expect(hit(textbox({}), 150, 125)).toBeNull();
  // A box that paints nothing at all paints nothing past its frame either.
  expect(textboxPaintsPastFrame(textbox({ fillHex: null, chromeRotationDegrees: 30 }))).toBe(false);
});

test('a callout tail takes a press inside it, not beside it', () => {
  const tail = textbox({
    outline: {
      kind: 'polygon',
      subpaths: [
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0.4, y: 1 },
          { x: 0.3, y: 1.4 },
          { x: 0.2, y: 1 },
          { x: 0, y: 1 },
        ],
      ],
    },
  });
  expect(textboxPaintsPastFrame(tail)).toBe(true);
  // The tail tip sits at (130, 170).
  expect(hit(tail, 130, 162)).toBe(true);
  expect(hit(tail, 180, 162)).toBe(false);
});

test('a turned box takes a press on its turned corner past the frame', () => {
  const turned = textbox({ chromeRotationDegrees: 90 });
  // Turned a quarter about (150, 125): 50 wide and 100 tall.
  expect(hit(turned, 150, 80)).toBe(true);
  expect(hit(turned, 110, 80)).toBe(false);
});

test('a legacy oval and rounded box take presses on their curve, not the frame corners', () => {
  const oval = textbox({ outline: { kind: 'ellipse' }, chromeRotationDegrees: 45 });
  expect(hit(oval, 150, 125)).toBe(true);
  // The frame corner, turned with the oval, lies outside the curve.
  const corner = { x: 150 + 50 * Math.SQRT1_2 - 25 * Math.SQRT1_2, y: 125 + 75 * Math.SQRT1_2 };
  expect(hit(oval, corner.x, corner.y)).toBe(false);
  // With only an outline, a press on the curve reaches it and one inside goes to the text.
  const ring = textbox({
    outline: { kind: 'ellipse' },
    chromeRotationDegrees: 45,
    fillHex: null,
    strokeHex: '000000',
    strokeWidthPt: 1,
  });
  expect(hit(ring, 150, 125)).toBe(false);
  // The end of the long axis, turned 45 degrees about the centre.
  expect(hit(ring, 150 + 50 * Math.SQRT1_2, 125 + 50 * Math.SQRT1_2)).toBe(true);
  const rounded = textbox({ outline: { kind: 'roundRect', arc: 0.4 }, chromeRotationDegrees: 90 });
  // Turned a quarter: the rounded corner's empty point misses, the middle edge reaches.
  expect(hit(rounded, 126, 76)).toBe(false);
  expect(hit(rounded, 150, 77)).toBe(true);
});

test('a press inside the unturned frame always takes the box, past it only the shape does', () => {
  const reaches = (record: AnchoredDrawingRecord, x: number, y: number) =>
    textboxPressReaches(record, { x, y });
  // A box that paints nothing past its frame takes every press on its painted box.
  expect(reaches(textbox({}), 90, 90)).toBe(true);
  // A quarter-turned box: its frame corner, which it does not paint, still edits the text.
  const turned = textbox({ chromeRotationDegrees: 90 });
  expect(hit(turned, 110, 110)).toBe(false);
  expect(reaches(turned, 110, 110)).toBe(true);
  // Past the frame, its turned corner takes the press and the empty page beside it does not.
  expect(reaches(turned, 150, 80)).toBe(true);
  expect(reaches(turned, 110, 80)).toBe(false);
  // With only an outline, the turned frame still takes a press on its text past the unturned
  // frame, where neither a fill nor the outline lies.
  const outlined = textbox({
    chromeRotationDegrees: 90,
    fillHex: null,
    strokeHex: '000000',
    strokeWidthPt: 1,
  });
  expect(hit(outlined, 150, 90)).toBe(false);
  expect(reaches(outlined, 150, 90)).toBe(true);
  expect(reaches(outlined, 110, 80)).toBe(false);
  // Text laid out upright in a swapped, taller area takes a press past both frames.
  const upright = textbox({
    chromeRotationDegrees: 60,
    fillHex: null,
    strokeHex: '000000',
    strokeWidthPt: 1,
    contentOffset: { x: 30, y: -20 },
    contentWidth: 40,
    contentHeight: 90,
  });
  expect(hit(upright, 135, 168)).toBe(false);
  expect(reaches(upright, 135, 168)).toBe(true);
  // A text area turned about its pivot takes a press where it turns to.
  const turnedText = textbox({
    contentOffset: { x: 0, y: 0 },
    contentWidth: 100,
    contentHeight: 50,
    contentRotation: { degrees: 90, pivot: { x: 50, y: 25 } },
    chromeRotationDegrees: 30,
    fillHex: null,
    strokeHex: '000000',
    strokeWidthPt: 1,
  });
  expect(hit(turnedText, 150, 80)).toBe(false);
  expect(reaches(turnedText, 150, 80)).toBe(true);
});
