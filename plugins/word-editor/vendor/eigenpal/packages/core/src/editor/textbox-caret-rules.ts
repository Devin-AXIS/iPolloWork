// Whether a text box's story takes a caret: the one rule that both entering a box and its
// selection frame read, so the frame never says a box is editable that entry refuses.
//
// Turned text has no upright caret geometry; upright text in a turned box keeps it. A story
// holding a table is not edited in place either.

import type { InlineDrawingRecord, AnchoredDrawingRecord } from '../layout/drawing-layout.ts';
import { parentNodeOf } from '../store/package/ooxml-edit.ts';
import { findDirectChild } from '../store/package/drawing-shape-projection.ts';
import { schemaAttributeValue, WPS_NAMESPACE_URI } from '../store/package/ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlPart } from '../store/package/ooxml-tree.ts';

/**
 * Whether the shape around the story rooted at `storyRootId` turns its text: a rotated shape
 * transform, rotated body text, or vertical body text. Shape transforms are separate from the
 * picture transform the layout record carries.
 */
function shapeTurnsText(part: OoxmlPart, storyRootId: string): boolean {
  const textbox = parentNodeOf(part, storyRootId);
  const shape = textbox && parentNodeOf(part, textbox.id);
  if (!shape) return false;
  const shapeProperties = findDirectChild(shape.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'spPr',
  });
  const transform =
    shapeProperties &&
    findDirectChild(shapeProperties.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'xfrm',
    });
  const bodyProperties = findDirectChild(shape.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'bodyPr',
  });
  const rotation = transform && schemaAttributeValue(transform.attributes, 'rot');
  const textRotation = bodyProperties && schemaAttributeValue(bodyProperties.attributes, 'rot');
  const vertical = bodyProperties && schemaAttributeValue(bodyProperties.attributes, 'vert');
  return (
    (!!rotation && Number(rotation) !== 0) ||
    (!!textRotation && Number(textRotation) !== 0) ||
    (!!vertical && vertical !== 'horz')
  );
}

/** Whether the laid-out text box `drawing`, whose story is rooted at `storyRootId`, takes a caret. */
export function textboxTakesCaret(
  part: OoxmlPart,
  storyRootId: string,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord
): boolean {
  const story = drawing.textboxStory;
  return (
    !!story &&
    !shapeTurnsText(part, storyRootId) &&
    drawing.transform.rotationDegrees === 0 &&
    story.contentRotation === undefined &&
    story.fragments.length > 0 &&
    story.fragments.every((fragment) => fragment.kind === 'paragraph')
  );
}
