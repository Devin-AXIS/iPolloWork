// "Resize shape to fit text" turned off by a resize (`resizeDrawing` with `textFit: 'release'`).
//
// A DrawingML text box with `a:spAutoFit` takes the height of its text when laid out, whatever
// its `wp:extent` says. A resize that wrote only the extent was accepted and then painted at the
// text height again, so the box snapped back. The editor knows the painted height, so it asks for
// the release when a resize changes it; this op replaces `a:spAutoFit` with `a:noAutofit` in the
// same op, and the box keeps the height it was given. A legacy VML box is not changed here.

import { WPS_NAMESPACE_URI } from '../package/ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode } from '../package/ooxml-tree.ts';

function childNamed(node: OoxmlElement, namespaceUri: string, localName: string) {
  for (const child of node.children as readonly OoxmlNode[]) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === namespaceUri && child.localName === localName) return child;
  }
  return null;
}

/** `node` with its child `from` replaced by `to`. */
function withChild(node: OoxmlElement, from: OoxmlElement, to: OoxmlElement): OoxmlElement {
  const children = (node.children as readonly OoxmlNode[]).map((c) => (c.id === from.id ? to : c));
  return { ...node, children } as OoxmlElement;
}

/** `anchor` with its text box's `a:spAutoFit` replaced by `a:noAutofit`, or as it is. */
export function releaseTextFit(anchor: OoxmlElement, nextId: () => string): OoxmlElement {
  const graphic = childNamed(anchor, DRAWINGML_MAIN_NAMESPACE_URI, 'graphic');
  const data = graphic && childNamed(graphic, DRAWINGML_MAIN_NAMESPACE_URI, 'graphicData');
  const wsp = data && childNamed(data, WPS_NAMESPACE_URI, 'wsp');
  const bodyPr = wsp && childNamed(wsp, WPS_NAMESPACE_URI, 'bodyPr');
  const fit = bodyPr && childNamed(bodyPr, DRAWINGML_MAIN_NAMESPACE_URI, 'spAutoFit');
  if (!graphic || !data || !wsp || !bodyPr || !fit) return anchor;
  const off = {
    id: nextId(),
    kind: 'generic',
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'noAutofit',
    prefix: fit.prefix,
    namespaceBindings: [],
    attributes: [],
    children: [],
  } as unknown as OoxmlElement;
  const nextBodyPr = withChild(bodyPr, fit, off);
  const nextWsp = withChild(wsp, bodyPr, nextBodyPr);
  const nextData = withChild(data, wsp, nextWsp);
  return withChild(anchor, graphic, withChild(graphic, data, nextData));
}
