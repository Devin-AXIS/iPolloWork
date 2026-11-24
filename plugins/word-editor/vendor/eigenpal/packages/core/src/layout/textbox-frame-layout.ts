// Where a text box story lays out inside its shape, and how it turns.
//
// An upright rectangle keeps its story in the box minus the insets. A legacy VML shape can
// move the text area inside its outline, turn, and run its text vertically:
//
// - Upright text (the default) stays horizontal in a turned box. Between 45° and 135°, and
//   between 225° and 315°, the text area keeps its centre and swaps its width and height.
// - Text that turns with the shape turns with the whole box, insets included.
// - Vertical text lays out in a frame with the width and height swapped and turns a quarter:
//   clockwise for top-to-bottom lines, counterclockwise for bottom-to-top ones.

import type { TextboxLegacyFrame } from '../store/package/drawing-shape-projection.ts';
import { textAreaOf } from '../store/package/legacy-vml-textbox-geometry.ts';

/** The content frame of a text box story, in drawing-extent points. */
export interface TextboxContentFrame {
  /** Top-left of the frame before it turns. */
  readonly x: number;
  readonly y: number;
  /** Frame size the story flows in: line width and stacking height. */
  readonly width: number;
  readonly height: number;
  /** Clockwise turn of the frame about `pivot`; 0 when the story is upright. */
  readonly rotationDegrees: number;
  readonly pivot: Readonly<{ x: number; y: number }>;
}

/** A box sized to its text: the new frame and the extent side the text set. */
export interface FittedTextboxFrame {
  readonly frame: TextboxContentFrame;
  readonly extentWidth?: number;
  readonly extentHeight?: number;
}

type Edges = Readonly<{ top: number; right: number; bottom: number; left: number }>;

/**
 * The frame of a box that fits its text, `flowHeight` points of it. Vertical text sets the
 * box width, from the left edge; other text sets the height, from the top edge.
 *
 * The new height keeps the text area the authored box gave (`insets` holds it). A text area
 * that follows the box size (`textAreaRule`) then lays the text out at the new size's area, so
 * a grown oval moves its text down and a shrunk one moves it up. `area` holds the text area
 * part of `insets`, in points.
 */
export function fitTextboxFrame(
  flowHeight: number,
  extentWidth: number,
  extentHeight: number,
  insets: Edges,
  area: Edges,
  frame: TextboxLegacyFrame | undefined
): FittedTextboxFrame {
  if (frame && frame.flow !== 'horizontal') {
    const width = flowHeight + insets.left + insets.right;
    return { frame: textboxContentFrame(width, extentHeight, insets, frame), extentWidth: width };
  }
  const height = flowHeight + insets.top + insets.bottom;
  const rule = frame?.textAreaRule;
  const fitted = rule ? textAreaOf(rule, extentWidth, height) : area;
  const sized = {
    top: insets.top - area.top + fitted.top,
    right: insets.right - area.right + fitted.right,
    bottom: insets.bottom - area.bottom + fitted.bottom,
    left: insets.left - area.left + fitted.left,
  };
  return { frame: textboxContentFrame(extentWidth, height, sized, frame), extentHeight: height };
}

const turned = (degrees: number) =>
  (degrees >= 45 && degrees < 135) || (degrees >= 225 && degrees < 315);

/**
 * The frame a story lays out in. `insets` hold the story insets, the outline's inner half and
 * the shape's text area. Without a legacy frame this is the plain inset box, unturned.
 */
export function textboxContentFrame(
  extentWidth: number,
  extentHeight: number,
  insets: Readonly<{ top: number; right: number; bottom: number; left: number }>,
  frame: TextboxLegacyFrame | undefined
): TextboxContentFrame {
  let width = Math.max(1, extentWidth - insets.left - insets.right);
  let height = Math.max(0, extentHeight - insets.top - insets.bottom);
  let cx = insets.left + width / 2,
    cy = insets.top + height / 2;
  // The plain box keeps its exact inset origin.
  if (!frame)
    return Object.freeze({
      x: insets.left,
      y: insets.top,
      width,
      height,
      rotationDegrees: 0,
      pivot: Object.freeze({ x: cx, y: cy }),
    });
  const theta = frame.rotationDegrees;
  if (!frame.textTurnsWithShape && turned(theta)) [width, height] = [height, width];
  const flowTurn = frame.flow === 'vertical' ? 90 : frame.flow === 'verticalBottomToTop' ? 270 : 0;
  if (flowTurn) [width, height] = [height, width];
  let rotationDegrees = flowTurn;
  if (frame.textTurnsWithShape && theta !== 0) {
    // The text area's centre turns about the box centre with the shape.
    const ex = extentWidth / 2,
      ey = extentHeight / 2;
    const radians = (theta * Math.PI) / 180;
    const dx = cx - ex,
      dy = cy - ey;
    cx = ex + dx * Math.cos(radians) - dy * Math.sin(radians);
    cy = ey + dx * Math.sin(radians) + dy * Math.cos(radians);
    rotationDegrees = (flowTurn + theta) % 360;
  }
  return Object.freeze({
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
    rotationDegrees,
    pivot: Object.freeze({ x: cx, y: cy }),
  });
}
