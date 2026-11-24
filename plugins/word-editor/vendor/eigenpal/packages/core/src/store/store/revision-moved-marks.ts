import { WML_NAMESPACE_URI, type OoxmlNode } from '../package/ooxml-tree.ts';

/** A revision element's author and date, as one key, or undefined when it names no author. */
function stampOf(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue') return undefined;
  const attribute = (name: string) =>
    node.attributes.find(
      (entry) => entry.namespaceUri === WML_NAMESPACE_URI && entry.localName === name
    )?.value;
  const author = attribute('author');
  return author === undefined ? undefined : `${author}\u0000${attribute('date') ?? ''}`;
}

/** One paragraph's moved-to marks, and the elements in its inline content. */
interface ParagraphMoves {
  readonly marks: readonly OoxmlNode[];
  readonly inline: readonly OoxmlNode[];
}

/**
 * Each paragraph's moved-to marks (`w:pPr/w:rPr/w:moveTo`) and inline elements, at any depth
 * of inline containers such as hyperlinks. A text box's paragraphs are paragraphs of their own.
 */
function paragraphMoves(root: OoxmlNode): ParagraphMoves[] {
  const found: ParagraphMoves[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      const marks: OoxmlNode[] = [];
      const inline: OoxmlNode[] = [];
      const collect = (child: OoxmlNode): void => {
        if (child.kind === 'textValue') return;
        // A text box belongs to the shape's own paragraphs, visited on their own.
        if (child.localName === 'txbxContent') return visit(child);
        inline.push(child);
        for (const inner of child.children) collect(inner);
      };
      for (const child of node.children) {
        if (child.localName !== 'pPr') {
          collect(child);
          continue;
        }
        for (const run of child.children)
          if (run.kind !== 'textValue' && run.localName === 'rPr')
            for (const mark of run.children)
              if (mark.kind !== 'textValue' && mark.localName === 'moveTo') marks.push(mark);
      }
      found.push({ marks, inline });
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

/**
 * Each orphan destination mark with the orphan wrappers of its paragraph that share its author
 * and date, as one group: one decision on a destination with no source resolves its text and its
 * paragraph mark together. Wrappers of another author or date in the paragraph stay apart.
 */
export function orphanDestinationGroups(root: OoxmlNode, orphans: ReadonlySet<string>): string[][] {
  const groups: string[][] = [];
  if (orphans.size === 0) return groups;
  for (const paragraph of paragraphMoves(root))
    for (const mark of paragraph.marks) {
      if (!orphans.has(mark.id)) continue;
      const stamp = stampOf(mark);
      const wrappers = paragraph.inline.filter(
        (node) => orphans.has(node.id) && stampOf(node) === stamp
      );
      if (wrappers.length > 0) groups.push([mark.id, ...wrappers.map((node) => node.id)]);
    }
  return groups;
}
