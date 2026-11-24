import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '../store/package/ooxml-tree.ts';
import { allowlistedPageField } from './field-instruction.ts';

const isElement = (node: OoxmlNode): node is OoxmlElement => node.kind !== 'textValue';
const isW = (node: OoxmlNode, name: string): boolean =>
  isElement(node) && node.namespaceUri === WML_NAMESPACE_URI && node.localName === name;
const elements = (node: OoxmlElement): OoxmlElement[] =>
  (node.children as readonly OoxmlNode[]).filter(isElement);
const attr = (node: OoxmlElement, name: string): string | undefined => {
  const matches = node.attributes.filter((item) => item.localName === name);
  return matches.length === 1 && matches[0]!.namespaceUri === WML_NAMESPACE_URI
    ? matches[0]!.value
    : undefined;
};

/**
 * Recognize one supported PAGE field in an already bounded footer paragraph.
 * Both frame lanes use the live page-field allowlist and the same instruction parser.
 * Optional surrounding decoration is content, never a deduplication key.
 */
export function readLegacyPageField(
  paragraph: OoxmlElement,
  {
    leadingTab = false,
    allowDecoration = false,
  }: {
    readonly leadingTab?: boolean;
    readonly allowDecoration?: boolean | 'text';
  } = {}
): string | undefined {
  let state = 0,
    instruction = '',
    prefix = '',
    suffix = '',
    tabs = 0;
  for (const run of elements(paragraph)) {
    if (isW(run, 'pPr')) continue;
    if (allowDecoration === 'text' && isW(run, 'fldSimple') && state === 0) {
      if (
        allowlistedPageField(attr(run, 'instr') ?? '') !== 'PAGE' ||
        elements(run).some(
          (item) =>
            !isW(item, 'r') ||
            elements(item).some(
              (child) =>
                !isW(child, 'rPr') &&
                (!isW(child, 't') ||
                  child.children.some(isElement) ||
                  child.children.some(
                    (value) => value.kind === 'textValue' && !/^\d*$/.test(value.value)
                  ))
            )
        )
      )
        return undefined;
      instruction = attr(run, 'instr')!;
      state = 3;
      continue;
    }
    if (!isW(run, 'r')) return undefined;
    for (const node of elements(run)) {
      if (isW(node, 'rPr')) continue;
      if (
        isW(node, 'tab') &&
        state === 0 &&
        !prefix &&
        !tabs &&
        leadingTab &&
        !node.children.length
      ) {
        tabs++;
        continue;
      }
      if (isW(node, 'fldChar') && !node.children.length) {
        const type = attr(node, 'fldCharType');
        if (state === 0 && type === 'begin') state = 1;
        else if (state === 1 && type === 'separate' && allowlistedPageField(instruction) === 'PAGE')
          state = 2;
        else if (state === 2 && type === 'end') state = 3;
        else return undefined;
        continue;
      }
      if (node.children.some(isElement)) return undefined;
      const value = node.children
        .map((child) => (child.kind === 'textValue' ? child.value : ''))
        .join('');
      if (isW(node, 'instrText') && state === 1) instruction += value;
      else if (allowDecoration && isW(node, 't') && state === 0) prefix += value;
      else if (allowDecoration && isW(node, 't') && state === 3) suffix += value;
      else if (!(isW(node, 't') && state === 2 && /^\d*$/.test(value))) return undefined;
    }
  }
  return state === 3 &&
    allowlistedPageField(instruction) === 'PAGE' &&
    tabs === Number(leadingTab) &&
    (allowDecoration === 'text' || (!prefix && !suffix) || (prefix === '- ' && suffix === ' -'))
    ? prefix + suffix
    : undefined;
}
