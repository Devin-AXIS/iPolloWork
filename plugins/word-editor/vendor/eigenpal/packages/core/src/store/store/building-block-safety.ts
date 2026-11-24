// A story-only transplant cannot resolve glossary-owned resources. Refuse such bodies
// atomically until a package merge can import their definitions and rewrite references.
import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import { isValidXmlText } from '../package/sinks.ts';
import { MAX_FRAGMENT_DEPTH, MAX_FRAGMENT_NODES } from './tree-op-fragment.ts';
import type { TreeOpRejection } from './tree-op-types.ts';

const MAX_TEXT_UNITS = 8 * 1024 * 1024;
const RESOURCE_ELEMENTS = new Set([
  'pStyle',
  'rStyle',
  'tblStyle',
  'numPr',
  'footnoteReference',
  'endnoteReference',
  'bookmarkStart',
  'bookmarkEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'commentReference',
  'permStart',
  'permEnd',
  'dataBinding',
  'docPart',
  'altChunk',
  'subDoc',
  'object',
  'pict',
  'drawing',
  'fldSimple',
  'fldChar',
  'instrText',
  'delInstrText',
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
]);

/** Validate before cloning, sanitizing, or inspecting any untrusted subtree recursively. */
export function buildingBlockBodyRefusal(blocks: readonly OoxmlNode[]): TreeOpRejection | null {
  let nodes = 0;
  let textUnits = 0;
  const visit = (node: OoxmlNode, depth: number): TreeOpRejection | null => {
    if (depth > MAX_FRAGMENT_DEPTH) return 'fragment-too-deep';
    if (++nodes > MAX_FRAGMENT_NODES) return 'fragment-resource-budget';
    if (!node || typeof node !== 'object') return 'fragment-invalid-block';
    const text = (value: unknown): TreeOpRejection | null => {
      if (typeof value !== 'string') return 'fragment-invalid-block';
      textUnits += value.length;
      if (textUnits > MAX_TEXT_UNITS) return 'fragment-resource-budget';
      return isValidXmlText(value) ? null : 'fragment-invalid-block';
    };
    if (node.kind === 'textValue') return text(node.value);
    if (
      typeof node.localName !== 'string' ||
      typeof node.namespaceUri !== 'string' ||
      !Array.isArray(node.children) ||
      !Array.isArray(node.attributes) ||
      !Array.isArray(node.namespaceBindings)
    )
      return 'fragment-invalid-block';
    for (const value of [node.localName, node.namespaceUri, node.prefix ?? '']) {
      const refused = text(value);
      if (refused) return refused;
    }
    // The supported subset contains ordinary WML, math and compatibility wrappers only.
    // Unknown extension content can carry hidden relationship/identity namespaces.
    if (
      ![
        WML_NAMESPACE_URI,
        'http://schemas.openxmlformats.org/officeDocument/2006/math',
        'http://schemas.openxmlformats.org/markup-compatibility/2006',
      ].includes(node.namespaceUri)
    ) {
      return 'unsupported';
    }
    if (
      node.namespaceUri === WML_NAMESPACE_URI &&
      (RESOURCE_ELEMENTS.has(node.localName) || node.localName.endsWith('Change'))
    )
      return 'unsupported';
    for (const attribute of node.attributes) {
      if (++nodes > MAX_FRAGMENT_NODES) return 'fragment-resource-budget';
      if (!attribute || typeof attribute !== 'object') return 'fragment-invalid-block';
      for (const value of [
        attribute.value,
        attribute.localName,
        attribute.namespaceUri,
        attribute.prefix ?? '',
      ]) {
        const refused = text(value);
        if (refused) return refused;
      }
      if (
        attribute.namespaceUri ===
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships' ||
        attribute.localName === 'anchor'
      )
        return 'unsupported';
    }
    for (const binding of node.namespaceBindings) {
      if (++nodes > MAX_FRAGMENT_NODES) return 'fragment-resource-budget';
      if (!binding || typeof binding !== 'object') return 'fragment-invalid-block';
      for (const value of [binding.prefix, binding.namespaceUri]) {
        const refused = text(value);
        if (refused) return refused;
      }
    }
    for (const child of node.children) {
      const refused = visit(child, depth + 1);
      if (refused) return refused;
    }
    return null;
  };
  for (const block of blocks) {
    const refused = visit(block, 1);
    if (refused) return refused;
  }
  return null;
}
