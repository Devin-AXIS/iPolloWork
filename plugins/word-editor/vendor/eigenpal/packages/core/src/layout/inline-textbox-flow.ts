// Inline text-box wiring for paragraph flows.
//
// An inline text box (`wps:wsp` with `wps:txbx` inside `wp:inline`) takes its extent on the
// line like a picture, and its story is laid out inside that extent by the same function
// that lays out anchored text boxes. A flow renders inline stories only when it also renders
// anchored ones, so both capabilities travel together here.

import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { ParagraphFlowOptions } from './paragraph-flow.ts';
import type { HostedStoryFlowDeps } from './semantic-table-layout.ts';
import type { TextboxStoryLayout } from './textbox-story-layout.ts';

/** Lays out one drawing's text-box story inside its extent. */
export type TextboxStoryLayouter = (projection: DrawingProjection) => TextboxStoryLayout | null;

type InlineDrawingFlow = Pick<ParagraphFlowOptions, 'inlineDrawingLayout' | 'layoutTextboxStory'>;

const NO_INLINE_DRAWING_FLOW: InlineDrawingFlow = Object.freeze({});

/**
 * The drawing fields of one paragraph flow.
 *
 * Without a hosted-story capability, the flow keeps its drawing context and an inline text
 * box paints a placeholder. A text-box story's own flow passes none, so a box inside a box
 * stops at one level.
 */
export function inlineDrawingFlow(
  inlineDrawingLayout: InlineDrawingLayoutContext | undefined,
  hostedStory: HostedStoryFlowDeps | undefined
): InlineDrawingFlow {
  if (!inlineDrawingLayout) return NO_INLINE_DRAWING_FLOW;
  return hostedStory
    ? { inlineDrawingLayout, layoutTextboxStory: hostedStory.layoutTextboxStoryFor }
    : { inlineDrawingLayout };
}
