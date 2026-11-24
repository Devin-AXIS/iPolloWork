// One shape inside a selected group, as a second press on the group selects it: the member under
// the pointer gets its own frame, the Format shape pane and the shape commands act on it alone,
// and Escape goes back up to the group. A member does not move, resize, or delete on its own:
// those commands refuse with a typed reason while one is selected.
//
// The member boxes come from the store, not from the paint: each `wps:wsp` child of the group
// places itself by its `a:xfrm` in the group's child space (`chOff`/`chExt`). A rotated or
// flipped group has no member boxes (`readDrawingGroupFrame` refuses it), so a press keeps the
// group. DOM-free except for the client rectangle of the pressed element.

import type { Editor, EditorCommand, ExecResult } from '../contracts/editor.ts';
import {
  findDrawingOverlayFrameInLayout,
  type DrawingOverlayFrame,
} from '../layout/semantic-hit-test.ts';
import { readDrawingGroupFrame } from '../store/package/drawing-group-frame.ts';
import { groupMemberPlacement } from '../store/package/drawing-group-transform.ts';
import { shapeRotationDegrees } from '../store/package/drawing-shape-geometry.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { schemaAttributeValue, WPS_NAMESPACE_URI } from '../store/package/ooxml-drawing-rules.ts';
import { WP_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../store/package/ooxml-tree.ts';
import type { DrawingSelectionIntent, PaginatedSurface } from './paginated-surface-contract.ts';
import { partOfNodeId } from './surface-scope.ts';
import { hostWindowOf } from './host-realm.ts';
import { MULTI_CLICK_SLOP_PX } from './surface-multi-click.ts';

/**
 * Comparable key for a drawing-selection intent, so a state guard can watch its transitions
 * — including a press on the drawing at offsets the selection already holds, and a press that
 * selects a shape inside the selected group.
 */
export function drawingSelectionIntentKey(
  intent: import('./paginated-surface-contract.ts').DrawingSelectionIntent
): string {
  return intent.kind === 'pointer'
    ? `pointer:${intent.drawingNodeId}:${intent.memberNodeId ?? ''}`
    : intent.kind;
}

/** A member of a group and its box, in fractions (0 to 1) of the group's extent. */
export interface GroupMemberBox {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Why wrap, alt text, and the other drawing properties refuse on a shape inside a group. */
export const GROUP_MEMBER_PROPERTIES_REASON =
  'a shape inside a group takes its wrap, alt text, and properties from the group; press Escape to select the group';

/** Why a move, resize, or delete refuses while a shape inside a group is selected. */
export const GROUP_MEMBER_REASON =
  'a shape inside a group does not move, resize, or delete on its own; press Escape to select the group';

const element = (node: OoxmlNode): OoxmlElement | null =>
  node.kind === 'textValue' ? null : (node as OoxmlElement);

function childNamed(parent: OoxmlElement, namespaceUri: string, localName: string) {
  for (const child of parent.children) {
    const found = element(child);
    if (found && found.namespaceUri === namespaceUri && found.localName === localName) return found;
  }
  return null;
}

/** The `wp:anchor` or `wp:inline` of a drawing, through `mc:Choice` (depth-bounded). */
function anchorOf(node: OoxmlElement, depth = 0): OoxmlElement | null {
  if (depth > 6) return null;
  for (const child of node.children) {
    const found = element(child);
    if (!found) continue;
    if (
      found.namespaceUri === WP_NAMESPACE_URI &&
      (found.localName === 'anchor' || found.localName === 'inline')
    )
      return found;
    if (found.localName === 'Fallback') continue;
    const deeper = anchorOf(found, depth + 1);
    if (deeper) return deeper;
  }
  return null;
}

const emu = (node: OoxmlElement | null, name: string): number | null => {
  const value = node ? Number(schemaAttributeValue(node.attributes, name)) : NaN;
  return Number.isFinite(value) ? value : null;
};

/**
 * The shape members of the group drawing `drawingNodeId` and their boxes, in paint order, or
 * null when the drawing is not a group whose members can be placed.
 */
export function groupMemberBoxes(
  part: OoxmlPart,
  drawingNodeId: string
): readonly GroupMemberBox[] | null {
  const drawing = findNode(part, drawingNodeId);
  const root = drawing ? element(drawing) : null;
  const anchor = root ? anchorOf(root) : null;
  const frame = anchor ? readDrawingGroupFrame(anchor) : null;
  if (!anchor || !frame) return null;
  const { cx, cy } = frame.childExtentEmu;
  if (cx <= 0 || cy <= 0) return null;
  // The group extent sets each axis's scale, which places a turned member's box.
  const extent = childNamed(anchor, WP_NAMESPACE_URI, 'extent');
  const groupCx = emu(extent, 'cx') ?? cx;
  const groupCy = emu(extent, 'cy') ?? cy;
  const scaleX = groupCx > 0 ? groupCx / cx : 1;
  const scaleY = groupCy > 0 ? groupCy / cy : 1;
  const boxes: GroupMemberBox[] = [];
  for (const child of frame.group.children) {
    const member = element(child);
    if (!member || member.namespaceUri !== WPS_NAMESPACE_URI || member.localName !== 'wsp')
      continue;
    const spPr = childNamed(member, WPS_NAMESPACE_URI, 'spPr');
    const xfrm = spPr ? childNamed(spPr, DRAWINGML_MAIN_NAMESPACE_URI, 'xfrm') : null;
    const off = xfrm ? childNamed(xfrm, DRAWINGML_MAIN_NAMESPACE_URI, 'off') : null;
    const ext = xfrm ? childNamed(xfrm, DRAWINGML_MAIN_NAMESPACE_URI, 'ext') : null;
    const [x, y, w, h] = [emu(off, 'x'), emu(off, 'y'), emu(ext, 'cx'), emu(ext, 'cy')];
    if (x === null || y === null || w === null || h === null) continue;
    // The box the member paints in before it turns, as the paint places it.
    const place = groupMemberPlacement(
      { offset: { x, y }, extent: { cx: w, cy: h } },
      frame.childOffsetEmu,
      scaleX,
      scaleY,
      shapeRotationDegrees(xfrm) ?? 0
    );
    boxes.push({
      id: member.id,
      x: place.offset.x / (cx * scaleX),
      y: place.offset.y / (cy * scaleY),
      width: (place.extent.cx * place.scaleX) / (cx * scaleX),
      height: (place.extent.cy * place.scaleY) / (cy * scaleY),
    });
  }
  return boxes.length > 0 ? boxes : null;
}

const partOf = (surface: PaginatedSurface, drawingNodeId: string) =>
  partOfNodeId(surface.session, drawingNodeId) ?? surface.session.part();

/** The member box `memberNodeId` of the group `drawingNodeId`, or null when it is gone. */
function memberBox(surface: PaginatedSurface, drawingNodeId: string, memberNodeId: string) {
  return (
    groupMemberBoxes(partOf(surface, drawingNodeId), drawingNodeId)?.find(
      (box) => box.id === memberNodeId
    ) ?? null
  );
}

/**
 * Move a pointer intent to the shape `memberNodeId` of its group, or back to the group with
 * null, through `set`. False, with nothing moved, when no drawing is selected by a press or the
 * group holds no such shape. The surface's `selectDrawingMember`.
 */
export function memberIntent(
  session: PaginatedSurface['session'],
  intent: DrawingSelectionIntent,
  memberNodeId: string | null,
  set: (next: DrawingSelectionIntent) => void
): boolean {
  if (intent.kind !== 'pointer') return false;
  if (memberNodeId !== null) {
    const part = partOfNodeId(session, intent.drawingNodeId) ?? session.part();
    if (!groupMemberBoxes(part, intent.drawingNodeId)?.some((box) => box.id === memberNodeId))
      return false;
  }
  const { memberNodeId: _previous, ...group } = intent;
  set(memberNodeId === null ? group : { ...group, memberNodeId });
  return true;
}

/**
 * The shape selected inside the selected group, or null: none was pressed, or a remote edit
 * removed it, so the selection is the group again.
 */
export function selectedGroupMember(
  surface: PaginatedSurface,
  drawingNodeId: string
): string | null {
  const intent = surface.drawingSelectionIntent();
  if (intent.kind !== 'pointer' || intent.drawingNodeId !== drawingNodeId) return null;
  const member = intent.memberNodeId;
  return member && memberBox(surface, drawingNodeId, member) ? member : null;
}

/**
 * The selected image state fields a selected member changes: its id, and nothing that moves
 * or resizes. Empty when no member is selected.
 */
export function memberImageFields(surface: PaginatedSurface, drawingNodeId: string) {
  const memberId = selectedGroupMember(surface, drawingNodeId);
  if (!memberId) return {};
  return { memberId, canResize: false, canMove: false, canChangeWrap: false, canCrop: false };
}

/**
 * The overlay frame of the selected drawing, narrowed to the selected member: its own box,
 * with no handles and no move. `frame` is the group's overlay frame, `caps` its capabilities.
 */
export function memberOverlayFields<T extends { canResize: boolean; canMove: boolean }>(
  surface: PaginatedSurface,
  drawingNodeId: string,
  frame: DrawingOverlayFrame,
  caps: T
): T | (T & { x: number; y: number; width: number; height: number; memberId: string }) {
  const memberId = selectedGroupMember(surface, drawingNodeId);
  const box = memberId ? memberBox(surface, drawingNodeId, memberId) : null;
  if (!memberId || !box) return caps;
  const content = frame.record.geometry.contentBounds;
  const paint = frame.record.paintBounds;
  return {
    ...caps,
    canResize: false,
    canMove: false,
    memberId,
    x: frame.x + content.x - paint.x + box.x * content.width,
    y: frame.y + content.y - paint.y + box.y * content.height,
    width: box.width * content.width,
    height: box.height * content.height,
  };
}

/** `setImageProperties` fields that move, resize, or crop the drawing. */
const GEOMETRY_FIELDS = [
  'widthEmu',
  'heightEmu',
  'crop',
  'resetToNaturalSize',
  'horizontalEmu',
  'verticalEmu',
  'relativeToH',
  'relativeToV',
] as const;

/**
 * The refusal of an image command on the selected group while a shape inside it is selected,
 * or null. A move, resize, or delete names `GROUP_MEMBER_REASON`; wrap, alt text, and the
 * other properties belong to the group and name `GROUP_MEMBER_PROPERTIES_REASON`. A command
 * that names another drawing is left to the other gates.
 */
export function groupMemberRefusal(
  command: EditorCommand,
  surface: PaginatedSurface
): ExecResult | null {
  const intent = surface.drawingSelectionIntent();
  if (intent.kind !== 'pointer' || !intent.memberNodeId || command.type === 'insertImage')
    return null;
  const target = (command as { drawingNodeId?: unknown }).drawingNodeId;
  if (typeof target === 'string' && target !== intent.drawingNodeId) return null;
  if (!selectedGroupMember(surface, intent.drawingNodeId)) return null;
  const properties =
    command.type === 'setImageWrapType' ||
    (command.type === 'setImageProperties' &&
      !GEOMETRY_FIELDS.some((field) => command[field] !== undefined));
  return {
    ok: false,
    code: 'unsupported',
    reason: properties ? GROUP_MEMBER_PROPERTIES_REASON : GROUP_MEMBER_REASON,
  };
}

/**
 * Select the member of the selected group under a press, as a second press on a group does.
 * `rect` is the client rectangle of the element that paints the group's frame
 * (`paintBounds`), and `frame` the group's overlay frame. A press on no member selects the
 * group again. True when a member is selected.
 */
export function selectGroupMemberAt(
  surface: PaginatedSurface,
  drawingNodeId: string,
  frame: DrawingOverlayFrame,
  rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  clientX: number,
  clientY: number
): boolean {
  // A group that paints its fallback (or a placeholder) shows no shapes of its own to pick.
  if (!frame.record.vectorShape) return false;
  const boxes = groupMemberBoxes(partOf(surface, drawingNodeId), drawingNodeId);
  if (!boxes || rect.width <= 0 || rect.height <= 0) return false;
  const content = frame.record.geometry.contentBounds;
  const paint = frame.record.paintBounds;
  if (content.width <= 0 || content.height <= 0) return false;
  const px = ((clientX - rect.left) / rect.width) * paint.width + paint.x - content.x;
  const py = ((clientY - rect.top) / rect.height) * paint.height + paint.y - content.y;
  const fx = px / content.width;
  const fy = py / content.height;
  // The last member paints on top, so it takes the press.
  const hit = [...boxes]
    .reverse()
    .find(
      (box) => fx >= box.x && fx <= box.x + box.width && fy >= box.y && fy <= box.y + box.height
    );
  return surface.selectDrawingMember(hit?.id ?? null) && hit !== undefined;
}

/**
 * Select the member under a press on the painted group `drawingNodeId` when that group is
 * already selected, as a second press does. `element` paints the group's paint bounds. Null
 * when the press does not apply (the group is not the selected drawing, or it has no member
 * boxes); otherwise whether a member is now selected.
 */
export function pressSelectsGroupMember(
  surface: PaginatedSurface,
  drawingNodeId: string,
  element: Element,
  clientX: number,
  clientY: number
): boolean | null {
  const intent = surface.drawingSelectionIntent();
  if (intent.kind !== 'pointer' || intent.drawingNodeId !== drawingNodeId) return null;
  if (!groupMemberBoxes(partOf(surface, drawingNodeId), drawingNodeId)) return null;
  const frame = groupFrame(surface, drawingNodeId);
  if (!frame) return null;
  const rect = element.getBoundingClientRect();
  return selectGroupMemberAt(surface, drawingNodeId, frame, rect, clientX, clientY);
}

const groupFrame = (surface: PaginatedSurface, drawingNodeId: string) =>
  findDrawingOverlayFrameInLayout(
    surface.layout(),
    drawingNodeId,
    surface.currentPage('caret') - 1
  );

/**
 * Arm a press on the selected group's overlay frame: when the pointer comes up where it went
 * down, with no drag between, the member under it is selected. A drag still moves the group.
 * Adapters reach this through `passDrawingFramePress`.
 */
export function armGroupMemberPress(
  surface: PaginatedSurface,
  event: PointerEvent,
  frameElement: Element
): void {
  const intent = surface.drawingSelectionIntent();
  if (event.button !== 0 || event.shiftKey || intent.kind !== 'pointer' || intent.memberNodeId)
    return;
  const drawingNodeId = intent.drawingNodeId;
  if (!groupMemberBoxes(partOf(surface, drawingNodeId), drawingNodeId)) return;
  const rect = frameElement.getBoundingClientRect();
  const view = hostWindowOf(frameElement);
  const { clientX, clientY } = event;
  const up = (release: PointerEvent): void => {
    view.removeEventListener('pointerup', up, true);
    const still =
      Math.abs(release.clientX - clientX) <= MULTI_CLICK_SLOP_PX &&
      Math.abs(release.clientY - clientY) <= MULTI_CLICK_SLOP_PX;
    if (!still) return;
    // After the overlay ends its press, so the member frame replaces the group's.
    view.setTimeout(() => {
      const now = surface.drawingSelectionIntent();
      if (now.kind !== 'pointer' || now.drawingNodeId !== drawingNodeId || now.memberNodeId) return;
      const frame = groupFrame(surface, drawingNodeId);
      if (frame) selectGroupMemberAt(surface, drawingNodeId, frame, rect, clientX, clientY);
    }, 0);
  };
  view.addEventListener('pointerup', up, true);
}

/**
 * Leave the shape selected inside a group and select the group again, as Escape does. True
 * when a shape was selected. Adapters call it for Escape on the drawing overlay. @public
 */
export function leaveGroupMember(editor: Editor): boolean {
  const surface = (editor as { surface?: PaginatedSurface | null }).surface;
  const intent = surface?.drawingSelectionIntent();
  if (!surface || intent?.kind !== 'pointer' || !intent.memberNodeId) return false;
  // A shape a remote edit removed is dropped quietly; Escape then acts on the group.
  const live = selectedGroupMember(surface, intent.drawingNodeId) !== null;
  return surface.selectDrawingMember(null) && live;
}
