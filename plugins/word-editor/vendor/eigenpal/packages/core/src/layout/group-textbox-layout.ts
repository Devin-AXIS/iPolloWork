// Text box members of a drawing group, laid out inside the group's extent.
//
// Each member story lays out through the same `layoutTextboxStory` a standalone text box
// uses, at the member's scaled box. The stories render and export read-only: they carry no
// editing bindings, and the editor never enters them.

import {
  drawingAccessibility,
  type DrawingProjection,
} from '../store/package/drawing-projection.ts';
import type { GroupTextboxProjection } from '../store/package/group-textbox-projection.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from './drawing-layout.ts';
import type { TextboxStoryLayouter } from './inline-textbox-flow.ts';
import { framedTokenJoin } from './layout-cache.ts';
import type { LayoutBox } from './semantic-records.ts';
import { textboxLayoutToken } from './textbox-layout-token.ts';
import type { TextboxStoryLayout } from './textbox-story-layout.ts';

const EMU_PER_POINT = 12_700;

/** One laid-out group member story. */
export interface GroupTextboxStoryRecord {
  /** Canonical node id of the member `wps:wsp`. */
  readonly memberNodeId: string;
  /** The member box in points, relative to the drawing extent's top-left corner. */
  readonly box: LayoutBox;
  /** The member's story, in content-box coordinates inside {@link box}. */
  readonly story: TextboxStoryLayout;
  /**
   * Clockwise turn of the painted member about the center of {@link box}, in degrees. The
   * story lays out upright; paint and export turn it. Hit testing never maps into it.
   */
  readonly rotationDegrees: number;
}

/**
 * The projection a member story lays out from: the member's box as the extent, its story as
 * the drawing's story, and its node id so line ids and cache producers stay per member. The
 * group's frame is fixed, so the member is never placed or resized from its story.
 */
function memberProjection(
  projection: DrawingProjection,
  member: GroupTextboxProjection
): DrawingProjection {
  return Object.freeze({
    ...projection,
    drawingNodeId: member.memberNodeId,
    extentEmu: Object.freeze({ cx: member.frameEmu.cx, cy: member.frameEmu.cy }),
    textboxStory: member.story,
    groupTextboxes: undefined,
    // A member floats in the group frame; an inline group still lays unwrapped text unwrapped.
    wrap: 'inFront' as const,
  });
}

/** Lay out every text box member of a group drawing; undefined when none has a story. */
export function layoutGroupTextboxStories(
  projection: DrawingProjection,
  layout: TextboxStoryLayouter | undefined
): readonly GroupTextboxStoryRecord[] | undefined {
  const members = projection.groupTextboxes;
  // A hidden drawing or a wrap footprint paints nothing, so its member text is never laid out.
  if (!members || !layout || drawingAccessibility(projection).hidden) return undefined;
  const records: GroupTextboxStoryRecord[] = [];
  for (const member of members) {
    const story = layout(memberProjection(projection, member));
    if (!story) continue;
    records.push(
      Object.freeze({
        memberNodeId: member.memberNodeId,
        box: Object.freeze({
          x: member.frameEmu.x / EMU_PER_POINT,
          y: member.frameEmu.y / EMU_PER_POINT,
          width: member.frameEmu.cx / EMU_PER_POINT,
          height: member.frameEmu.cy / EMU_PER_POINT,
        }),
        story,
        rotationDegrees: member.rotationDegrees,
      })
    );
  }
  return records.length > 0 ? Object.freeze(records) : undefined;
}

/** The record with its group member stories, or the record itself when it has none. */
export function withGroupTextboxStories<T extends InlineDrawingRecord | AnchoredDrawingRecord>(
  record: T,
  projection: DrawingProjection,
  layout: TextboxStoryLayouter | undefined
): T {
  const groupTextboxStories = layoutGroupTextboxStories(projection, layout);
  if (!groupTextboxStories) return record;
  const withStories: T = { ...record, groupTextboxStories };
  Object.freeze(withStories);
  return withStories;
}

/** Layout token of a projection's group text box members; empty when it has none. */
export function groupTextboxesLayoutToken(
  members: DrawingProjection['groupTextboxes'] | undefined
): string {
  if (!members) return '';
  return framedTokenJoin(
    members.map((member) =>
      framedTokenJoin([
        member.memberNodeId,
        String(member.frameEmu.x),
        String(member.frameEmu.y),
        String(member.frameEmu.cx),
        String(member.frameEmu.cy),
        String(member.rotationDegrees),
        textboxLayoutToken(member.story),
      ])
    )
  );
}
