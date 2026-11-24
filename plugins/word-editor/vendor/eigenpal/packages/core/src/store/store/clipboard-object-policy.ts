import { isMcAlternateContent } from '../package/drawing-projection-walk.ts';
import { choiceChartDrawing, holdsChartGraphic } from '../package/mc-fallback-projection.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';

const OFFICE = 'urn:schemas-microsoft-com:office:office';

/** An embedded object: a `w:object`, or a `w:pict` whose picture is an `o:OLEObject` preview. */
function isEmbeddedObject(node: OoxmlElement): boolean {
  if (node.namespaceUri !== WML_NAMESPACE_URI) return false;
  if (node.localName === 'object') return true;
  return (
    node.localName === 'pict' &&
    node.children.some(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === OFFICE &&
        child.localName === 'OLEObject'
    )
  );
}

/**
 * A chart: a bare `w:drawing` that holds a chart graphic (classic or chartex), or a run-level
 * `mc:AlternateContent` whose Choice holds one. A chart's parts cannot travel in a clipboard
 * fragment, and its fallback alone is not the chart, so the whole transfer refuses.
 */
export function isClipboardChart(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  if (isMcAlternateContent(node)) return choiceChartDrawing(node) !== null;
  // Widened again: the guard above narrows away every generic node, but a `w:drawing` inside
  // generic content (such as an `mc:Choice`) can itself be generic.
  const element = node as OoxmlElement;
  const drawing =
    element.kind === 'drawing' ||
    (element.namespaceUri === WML_NAMESPACE_URI && element.localName === 'drawing');
  return drawing && holdsChartGraphic(element);
}

/** Content whose parts cannot travel in a clipboard fragment: an embedded object or a chart. */
export function isClipboardObject(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  return isEmbeddedObject(node) || isClipboardChart(node);
}

function containsMatching(
  nodes: readonly OoxmlNode[],
  matches: (node: OoxmlNode) => boolean
): boolean {
  const pending = [...nodes];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === 'textValue') continue;
    if (matches(node)) return true;
    for (const child of node.children) pending.push(child);
  }
  return false;
}

/** Embedded object and chart payloads cannot travel in clipboard fragments. Refuse the whole transfer. */
export function containsClipboardObject(nodes: readonly OoxmlNode[]): boolean {
  return containsMatching(nodes, isClipboardObject);
}

/** Whether `nodes` hold a chart, for the chart's own refusal reason. */
export function containsClipboardChart(nodes: readonly OoxmlNode[]): boolean {
  return containsMatching(nodes, isClipboardChart);
}
