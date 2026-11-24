import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import { propertiesOfRunContainer } from './field-run-text.ts';
import { resolveRunStyle } from './run-style.ts';
import {
  cascadeParagraphFormatting,
  cascadeRunProperties,
  type StyleCascadeTable,
} from './style-cascade.ts';

const memos = new WeakMap<OoxmlElement, { styles?: StyleCascadeTable; visible: boolean }>();

/** Ordinary visible text admits a hidden-mark join; empty-mark removal stays separate. */
export function hasVisibleSeparatorText(
  paragraph: OoxmlElement,
  styles?: StyleCascadeTable
): boolean {
  const cached = memos.get(paragraph);
  if (cached && cached.styles === styles) return cached.visible;
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  const inherited = styles ? cascadeParagraphFormatting(styles, pPr).runProperties : [];
  let count = 0;
  let exceeded = false;
  const visit = (node: OoxmlNode, depth: number): boolean => {
    if (++count > 10000 || depth > 64) {
      exceeded = true;
      return false;
    }
    if (node.kind === 'textValue') return false;
    if (node.kind === 'run') {
      const direct = propertiesOfRunContainer(
        node.children.find((child) => child.kind === 'runProperties')
      );
      if (resolveRunStyle(cascadeRunProperties(inherited, direct, styles)).hidden) return false;
      return node.children.some(
        (child) =>
          child.namespaceUri === WML_NAMESPACE_URI &&
          child.localName === 't' &&
          child.children.some((value) => value.kind === 'textValue' && /\S/u.test(value.value))
      );
    }
    // Do not admit text from another story, a drawing, or a tracked wrapper.
    if (
      node !== paragraph &&
      !['hyperlink', 'fldSimple', 'smartTag', 'customXml'].includes(node.localName)
    )
      return false;
    for (const child of node.children) if (visit(child, depth + 1)) return true;
    return false;
  };
  const visible = visit(paragraph, 0) && !exceeded;
  memos.set(paragraph, { styles, visible });
  return visible;
}
