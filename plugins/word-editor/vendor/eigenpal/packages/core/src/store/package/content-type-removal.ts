import type { OoxmlPackage } from './ooxml-package.ts';
import { readOoxmlPart } from './ooxml-tree.ts';
import { partNameKey } from './opc-names.ts';
import { contentTypesPartBytes } from './package-edit.ts';

/** XML whitespace excludes Unicode spacing characters that carry unknown content. */
export function isXmlWhitespace(value: string): boolean {
  return /^[\u0009\u000A\u000D\u0020]*$/.test(value);
}

/** Removing targeted declarations must preserve unrelated extension attributes and children. */
export function canRemoveContentTypeOverrides(
  pkg: OoxmlPackage,
  selected: ReadonlySet<string>
): boolean {
  const contentTypes = contentTypesPartBytes(pkg);
  if (!contentTypes) return false;
  const parsed = readOoxmlPart(new TextDecoder().decode(contentTypes.bytes), {
    name: '/[Content_Types].xml',
    contentType: 'application/xml',
  });
  const namespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
  if (
    !parsed.ok ||
    parsed.part.root.namespaceUri !== namespace ||
    parsed.part.root.localName !== 'Types'
  )
    return false;
  for (const node of parsed.part.root.children) {
    if (
      node.kind === 'textValue' ||
      node.namespaceUri !== namespace ||
      node.localName !== 'Override'
    )
      continue;
    const name = node.attributes.find(
      (a) => a.namespaceUri === '' && a.localName === 'PartName'
    )?.value;
    if (name === undefined || !selected.has(partNameKey(name))) continue;
    if (
      node.attributes.some(
        (a) => a.namespaceUri !== '' || !['PartName', 'ContentType'].includes(a.localName)
      ) ||
      node.children.some((child) => child.kind !== 'textValue' || !isXmlWhitespace(child.value))
    )
      return false;
  }
  return true;
}
