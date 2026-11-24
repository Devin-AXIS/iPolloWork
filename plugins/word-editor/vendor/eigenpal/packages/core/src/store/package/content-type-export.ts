// A package rebuilt from a collaboration room has an up-to-date content type index, but the
// [Content_Types].xml bytes it was seeded with. Export writes back only the Overrides that
// differ from the index, updating a declaration in place under its authored spelling.
// Records the index ignores, and extension content, stay as authored.
import {
  buildTolerantContentTypeIndex,
  isValidMime,
  overrideKeyOf,
  type OverrideRecord,
} from './content-types.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { contentTypesPartBytes, withContentTypeOverrides } from './package-edit.ts';
import { partNameKey } from './opc-names.ts';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlNode } from './ooxml-tree.ts';
import { runWithoutJournalCapture } from './canonical-primitive-capture.ts';

const NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

function attribute(node: OoxmlNode, name: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find((a) => a.namespaceUri === '' && a.localName === name)?.value;
}

/** Export projection only: never write repairs back into a store or its primitive journal. */
export function contentTypeExportPackage(pkg: OoxmlPackage): OoxmlPackage {
  const entry = contentTypesPartBytes(pkg);
  if (!entry) return pkg;
  const parsed = readOoxmlPart(new TextDecoder().decode(entry.bytes), {
    name: '/[Content_Types].xml',
    contentType: 'application/xml',
  });
  if (!parsed.ok) return pkg;
  const records: OverrideRecord[] = [];
  const collect = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === NS && node.localName === 'Override') {
      const partName = attribute(node, 'PartName');
      const contentType = attribute(node, 'ContentType');
      if (partName !== undefined && contentType !== undefined) {
        records.push({ partName, contentType, order: records.length });
      }
    }
    for (const child of node.children) collect(child);
  };
  collect(parsed.part.root);
  const authored = buildTolerantContentTypeIndex({ defaults: [], overrides: records });
  if (!authored.ok) return pkg;
  const removed = new Set<string>();
  for (const key of authored.index.overrides.keys()) {
    if (!pkg.contentTypes.overrides.has(key)) removed.add(key);
  }
  const names = new Map<string, string>();
  for (const name of pkg.partBytes.keys()) names.set(partNameKey(name), name);
  for (const name of pkg.parts.keys()) names.set(partNameKey(name), name);
  // A shared type a peer wrote with invalid syntax is never saved: the reader drops it, and a
  // dropped record on a required part refuses the whole file.
  const wanted = new Map<string, string>();
  for (const [key, type] of pkg.contentTypes.overrides) {
    if (isValidMime(type)) wanted.set(key, type);
  }
  // Index keys, sorted: shared index order differs between peers, and every peer must save
  // the same bytes.
  const changed = [...wanted.keys()]
    .filter((key) => authored.index.overrides.get(key) !== wanted.get(key))
    .sort();
  if (removed.size === 0 && changed.length === 0) return pkg;
  // Match both the normalized name and the type the authored index kept. Ignored records
  // stay inert; update recognized declarations in place to keep their authored spelling.
  const recognizedKey = (node: OoxmlNode): string | null => {
    if (node.kind === 'textValue' || node.namespaceUri !== NS || node.localName !== 'Override')
      return null;
    const name = attribute(node, 'PartName');
    const type = attribute(node, 'ContentType');
    const key = name === undefined ? null : overrideKeyOf(name);
    return key !== null && type !== undefined && authored.index.overrides.get(key) === type
      ? key
      : null;
  };
  const reconcile = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    const key = recognizedKey(node);
    const type = key === null ? undefined : wanted.get(key);
    const children = node.children
      .filter((child) => {
        const key = recognizedKey(child);
        return key === null || !removed.has(key);
      })
      .map(reconcile);
    const attributes =
      type === undefined
        ? node.attributes
        : node.attributes.map((a) =>
            a.namespaceUri === '' && a.localName === 'ContentType' ? { ...a, value: type } : a
          );
    return { ...node, attributes, children } as OoxmlNode;
  };
  const root = reconcile(parsed.part.root);
  if (root.kind === 'textValue') return pkg;
  const partBytes = new Map(pkg.partBytes);
  partBytes.set(
    entry.storageKey,
    new TextEncoder().encode(serializeOoxmlPart({ ...parsed.part, root }))
  );
  const next = { ...pkg, partBytes };
  return runWithoutJournalCapture(() =>
    withContentTypeOverrides(
      next,
      changed
        .filter((key) => !authored.index.overrides.has(key))
        .map((key) => [names.get(key) ?? key, wanted.get(key)!] as const)
    )
  );
}
