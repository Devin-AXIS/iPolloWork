// Synthetic packages and full-body coverage for clipboard fragment tests.
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import type { FragmentCoverage } from '../store/clipboard-fragment-extract.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import { paragraphLength } from '../store/tree-op-segments.ts';

/** Fixed rich document with clipboard-supported content; independent of the demo showcase. */
export const RICH_CLIPBOARD_FIXTURE = `${import.meta.dir}/fixtures/clipboard-rich.docx`;

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

export function loadPackage(bytes: Uint8Array): OoxmlPackage {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(`package: ${result.reason}`);
  return result.package;
}

export function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

export function bodyOf(part: OoxmlPart): OoxmlElement {
  const body =
    part.root.kind === 'document'
      ? part.root.children.find((child) => child.kind === 'body')
      : null;
  if (!body || !isElement(body)) throw new Error('no body');
  return body;
}

export function paragraphIdsUnder(node: OoxmlNode, out: string[] = []): string[] {
  if (node.kind === 'textValue') return out;
  if (node.kind === 'paragraph') out.push(node.id);
  for (const child of node.children) paragraphIdsUnder(child, out);
  return out;
}

export function lastParagraphOf(part: OoxmlPart, id: string): OoxmlElement {
  let found: OoxmlElement | null = null;
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph' && node.id === id) found = node;
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  if (!found) throw new Error(`no paragraph ${id}`);
  return found;
}

/** Full-body coverage built straight from the part tree — no layout needed. */
export function fullBodyCoverage(pkg: OoxmlPackage): FragmentCoverage {
  const part = pkg.parts.get(pkg.mainDocumentPart)!;
  const ids = paragraphIdsUnder(bodyOf(part));
  const last = lastParagraphOf(part, ids[ids.length - 1]!);
  const fullBlocks: string[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'table' || node.kind === 'contentControl') {
      const inside = paragraphIdsUnder(node);
      if (inside.length > 0) {
        fullBlocks.push(node.id);
        return;
      }
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return {
    partName: part.name,
    paragraphIds: ids,
    startOffset: 0,
    endOffset: paragraphLength(last as never),
    coveredParagraphIds: ids,
    fullyCoveredBlockIds: fullBlocks,
    lastMarkCovered: true,
  };
}

export function buildPackage(bodyXml: string, extra?: Record<string, string>): OoxmlPackage {
  const overrides = Object.keys(extra ?? {})
    .map((name) => {
      const type = name.includes('styles')
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'
        : 'application/xml';
      return `<Override PartName="/${name}" ContentType="${type}"/>`;
    })
    .join('');
  const relsRows = Object.keys(extra ?? {})
    .filter((name) => name.includes('styles'))
    .map(
      (name, index) => `<Relationship Id="rIdS${index}" Type="${R}/styles" Target="styles.xml"/>`
    )
    .join('');
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        overrides +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${relsRows}</Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${bodyXml}</w:body></w:document>`
    ),
  };
  for (const [name, xml] of Object.entries(extra ?? {})) entries[name] = strToU8(xml);
  return loadPackage(zipSync(entries));
}

export function openStore(pkg: OoxmlPackage): TreePackageStore {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) throw new Error('no main');
  return new TreePackageStore(pkg, main);
}
