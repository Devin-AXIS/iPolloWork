import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';

function textElement(nextId: () => string, text: string): OoxmlNode {
  return {
    id: nextId(),
    kind: 'text',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 't',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [{ id: nextId(), kind: 'textValue', value: text }],
  } as OoxmlNode;
}

function runElement(nextId: () => string, children: readonly OoxmlNode[]): OoxmlNode {
  return {
    id: nextId(),
    kind: 'run',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children,
  } as unknown as OoxmlNode;
}

/** Write a checkbox state as a Word symbol, retaining non-font run formatting. */
export function mintCheckboxRun(
  nextId: () => string,
  text: string,
  font: string,
  properties?: OoxmlNode,
  fallbackText = text
): OoxmlNode {
  const content: OoxmlNode[] = [];
  if (font) {
    content.push({
      id: nextId(),
      kind: 'runProperties',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'rPr',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [
        {
          id: nextId(),
          kind: 'generic',
          namespaceUri: WML_NAMESPACE_URI,
          localName: 'rFonts',
          prefix: 'w',
          namespaceBindings: [],
          attributes: [
            {
              namespaceUri: WML_NAMESPACE_URI,
              prefix: 'w',
              localName: 'ascii',
              value: font,
            },
            {
              namespaceUri: WML_NAMESPACE_URI,
              prefix: 'w',
              localName: 'hAnsi',
              value: font,
            },
            {
              namespaceUri: WML_NAMESPACE_URI,
              prefix: 'w',
              localName: 'eastAsia',
              value: font,
            },
          ],
          children: [],
        } as unknown as OoxmlNode,
      ],
    } as unknown as OoxmlNode);
  }
  // Word symbols hold a two-byte character code. Keep the typed applier's Unicode
  // glyph fallback for supplementary code points that cannot fit in w:sym.
  const symbolHex = /^[0-9A-Fa-f]{1,4}$/.test(text) ? text.padStart(4, '0') : null;
  if (symbolHex !== null && font) {
    content.push({
      id: nextId(),
      kind: 'generic',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'sym',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [
        { namespaceUri: WML_NAMESPACE_URI, prefix: 'w', localName: 'font', value: font },
        { namespaceUri: WML_NAMESPACE_URI, prefix: 'w', localName: 'char', value: symbolHex },
      ],
      children: [],
    } as unknown as OoxmlNode);
  } else {
    content.push(textElement(nextId, fallbackText));
  }
  if (properties && properties.kind !== 'textValue' && content[0]?.kind === 'runProperties') {
    const fonts = content[0];
    const isFonts = (child: OoxmlNode): boolean =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'rFonts';
    const existingIndex = properties.children.findIndex(isFonts);
    const children = properties.children.filter((child) => !isFonts(child));
    // rFonts follows rStyle and precedes the remaining run properties.
    const afterStyle =
      children.findIndex(
        (child) =>
          child.kind !== 'textValue' &&
          child.namespaceUri === WML_NAMESPACE_URI &&
          child.localName === 'rStyle'
      ) + 1;
    children.splice(existingIndex < 0 ? afterStyle : existingIndex, 0, fonts.children[0]!);
    content[0] = { ...properties, children } as OoxmlNode;
  }
  return runElement(nextId, content);
}
