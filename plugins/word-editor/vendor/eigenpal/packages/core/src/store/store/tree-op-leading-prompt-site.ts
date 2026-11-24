import { contentControlPropertiesOf, contentControlsIn } from '../package/content-control-nodes.ts';
import type { OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { directParentOf } from './tree-op-field-end-site.ts';
import type { InsertionSite, ParagraphOffsetIndex } from './tree-op-segments.ts';

/** The sibling site before a leading prompt, for an explicit left-biased insertion. */
export function leadingPromptSite(
  paragraph: OoxmlParagraphNode,
  offset: number,
  offsets: ParagraphOffsetIndex
): InsertionSite | null {
  const prompt = contentControlsIn(paragraph).find(
    (entry) =>
      contentControlPropertiesOf(entry.node).showingPlaceholder &&
      offsets.spanOf(entry.node)?.start === offset
  )?.node;
  const holder = prompt ? directParentOf(paragraph, prompt.id) : null;
  return holder && prompt
    ? {
        kind: 'newRun',
        holder,
        index: holder.children.findIndex((child) => child.id === prompt.id),
      }
    : null;
}

/** The node a site writes into: the run it joins, or the node a run is minted in. */
export function siteLandingNodeId(site: InsertionSite): string {
  if (site.kind === 'withinValue' || site.kind === 'atBoundary') {
    return site.segment.runId || site.segment.node.id;
  }
  return site.kind === 'newRun' ? site.holder.id : site.run.id;
}
