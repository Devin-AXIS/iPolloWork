import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { propertiesOfRunContainer } from './field-run-text.ts';
import { resolveRunStyle } from './run-style.ts';
import {
  cascadeParagraphFormatting,
  cascadeRunProperties,
  type StyleCascadeTable,
} from './style-cascade.ts';

const memos = new WeakMap<OoxmlElement, { styles?: StyleCascadeTable; shown: boolean }>();

/** Wrappers whose runs the default display does not lay out: deletions and move sources. */
const REMOVED_WRAPPERS = new Set(['del', 'moveFrom']);

/** Run children that put something on the line. */
const LINE_CONTENT = new Set(['t', 'tab', 'ptab', 'sym', 'drawing', 'pict', 'object']);

/**
 * Does the paragraph hold a run that lays out? A `w:vanish` run and deleted text lay out
 * nothing, so a paragraph holding only those is as empty as a bare mark. The walk is bounded
 * and memoized by node identity, so each tree revision asks it once per paragraph.
 */
export function hasShownRunContent(paragraph: OoxmlElement, styles?: StyleCascadeTable): boolean {
  const cached = memos.get(paragraph);
  if (cached && cached.styles === styles) return cached.shown;
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  const inherited = styles ? cascadeParagraphFormatting(styles, pPr).runProperties : [];
  let count = 0;
  const visit = (node: OoxmlNode, depth: number): boolean => {
    // Past the bound the answer is "content", which is the answer before this check existed.
    if (++count > 10000 || depth > 64) return true;
    if (node.kind === 'textValue' || node.kind === 'paragraphProperties') return false;
    if (REMOVED_WRAPPERS.has(node.localName)) return false;
    if (node.kind === 'run') {
      if (!node.children.some((child) => LINE_CONTENT.has(child.localName))) return false;
      const direct = propertiesOfRunContainer(
        node.children.find((child) => child.kind === 'runProperties')
      );
      return !resolveRunStyle(cascadeRunProperties(inherited, direct, styles)).hidden;
    }
    for (const child of node.children) if (visit(child, depth + 1)) return true;
    return false;
  };
  const shown = visit(paragraph, 0);
  memos.set(paragraph, { styles, shown });
  return shown;
}
