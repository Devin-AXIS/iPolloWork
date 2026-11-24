// The label bar of an open story, and the reason a text box frame gives for what it refuses.

import { expect, test } from 'bun:test';
import { storyLabelTop } from '../story-label-placement.ts';
import { textboxFrameReason } from '../textbox-overlay-frame.ts';

test('the bar sits above a story with room for it on the sheet', () => {
  expect(storyLabelTop({ top: 200, bottom: 240 }, 100, 28, 6)).toBe(166);
});

test('the bar goes below a story that starts at the paper edge', () => {
  expect(storyLabelTop({ top: 100, bottom: 240 }, 100, 28, 6)).toBe(246);
});

test('with no sheet known, the bar keeps its place above the story', () => {
  expect(storyLabelTop({ top: 10, bottom: 50 }, undefined, 28, 6)).toBe(-24);
});

test('a text box frame names why it takes no caret, or why it has no handles, when editing', () => {
  const box = { textbox: true, textEditable: true, canMove: true, canResize: true };
  expect(textboxFrameReason(box, 'edit')).toBeNull();
  expect(textboxFrameReason({ ...box, textEditable: false }, 'edit')).toBe(
    'imageOverlay.textLocked'
  );
  expect(textboxFrameReason({ ...box, canMove: false, canResize: false }, 'edit')).toBe(
    'imageOverlay.locked'
  );
  // Suggesting edits a box too, so a locked box says why.
  expect(textboxFrameReason({ ...box, canMove: false, canResize: false }, 'suggest')).toBe(
    'imageOverlay.locked'
  );
  // Viewing refuses edits itself, and a picture is not a text box.
  expect(textboxFrameReason({ ...box, canMove: false, canResize: false }, 'view')).toBeNull();
  expect(
    textboxFrameReason({ ...box, textbox: false, canMove: false, canResize: false }, 'edit')
  ).toBeNull();
});
