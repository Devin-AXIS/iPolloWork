// Building blocks (§17.12): the glossary part's `w:docPart` entries, read for a gallery control.
//
// A building block gallery control (`w:docPartList` in `w:sdtPr`) lists the blocks of one
// gallery and category, and a pick replaces the control's content with the block's body.
// The glossary is a side part of the package with its own tree; it is read here, never
// opened as a story. Every string is authored by the file, so names are matched, never
// interpreted, and a block whose properties are malformed is skipped rather than guessed.

import type { OoxmlPackage } from './ooxml-package.ts';
import { resolveRelationship } from './relationships.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';

const GLOSSARY_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/glossaryDocument';
const GLOSSARY_PART_NAME = '/word/glossary/document.xml';
const DEFAULT_CATEGORY = 'General';
const BLOCK_TYPES = new Set([
  'none',
  'normal',
  'autoExp',
  'toolbar',
  'speller',
  'formFld',
  'bbPlcHdr',
]);

/** Upper bound on entries read from one glossary; a hostile part cannot make the list unbounded. */
export const MAX_BUILDING_BLOCKS = 4096;

/** One `w:docPart` of the glossary, with the blocks its body holds. */
export interface BuildingBlock {
  /** `w:docPartPr/w:name`, the identity a control's placeholder and a pick refer to. */
  readonly name: string;
  /** `w:category/w:gallery`, an `ST_DocPartGallery` value such as `docParts`. */
  readonly gallery: string;
  /** `w:category/w:name`; `General` when the block declares none. */
  readonly category: string;
  /** The `w:docPartBody` children: paragraphs, tables and block controls, in order. */
  readonly blocks: readonly OoxmlNode[];
}

/** The gallery and category a `w:docPartList` control lists. */
export interface BuildingBlockGalleryFilter {
  readonly gallery: string;
  readonly category: string | null;
}

/**
 * Word writes the control's gallery as the display name of the gallery ("Quick Parts") while a
 * block records the schema value (`docParts`). Both spellings resolve to the schema value.
 */
const GALLERY_DISPLAY_NAMES: ReadonlyMap<string, string> = new Map<string, string>([
  ['quick parts', 'docParts'],
  ['cover pages', 'coverPg'],
  ['equations', 'eq'],
  ['footers', 'ftrs'],
  ['headers', 'hdrs'],
  ['page numbers', 'pgNum'],
  ['tables', 'tbls'],
  ['watermarks', 'watermarks'],
  ['autotext', 'autoTxt'],
  ['text boxes', 'txtBox'],
  ['page numbers (top of page)', 'pgNumT'],
  ['page numbers (bottom of page)', 'pgNumB'],
  ['page numbers (margins)', 'pgNumMargins'],
  ['table of contents', 'tblOfContents'],
  ['bibliographies', 'bib'],
  ['custom quick parts', 'custQuickParts'],
  ['custom cover pages', 'custCoverPg'],
  ['custom equations', 'custEq'],
  ['custom footers', 'custFtrs'],
  ['custom headers', 'custHdrs'],
  ['custom page numbers', 'custPgNum'],
  ['custom tables', 'custTbls'],
  ['custom watermarks', 'custWatermarks'],
  ['custom autotext', 'custAutoTxt'],
  ['custom text boxes', 'custTxtBox'],
  ['custom page numbers (top of page)', 'custPgNumT'],
  ['custom page numbers (bottom of page)', 'custPgNumB'],
  ['custom page numbers (margins)', 'custPgNumMargins'],
  ['custom table of contents', 'custTblOfContents'],
  ['custom bibliographies', 'custBib'],
]);

function normalizeGallery(value: string): string {
  const lower = value.trim().toLowerCase();
  return (GALLERY_DISPLAY_NAMES.get(lower) ?? lower).toLowerCase();
}

function isWml(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

function childNamed(node: OoxmlElement | undefined, localName: string): OoxmlElement | undefined {
  if (!node) return undefined;
  for (const child of node.children) {
    if (child.kind !== 'textValue' && isWml(child, localName)) return child;
  }
  return undefined;
}

function valOf(node: OoxmlElement | undefined): string | undefined {
  return node?.attributes.find((attribute) => attribute.localName === 'val')?.value;
}

/** The glossary part, through the main part's relationship or the conventional name. */
export function glossaryPartOf(pkg: OoxmlPackage): OoxmlPart | null {
  const record = (pkg.relationships.get(pkg.mainDocumentPart) ?? []).find(
    (rel) => rel.type === GLOSSARY_RELATIONSHIP_TYPE
  );
  if (record) {
    const resolved = resolveRelationship(record);
    if (resolved.mode === 'Internal' && resolved.target.ok) {
      const part = pkg.parts.get(resolved.target.partName);
      if (part) return part;
    }
  }
  return pkg.parts.get(GLOSSARY_PART_NAME) ?? null;
}

function blockOf(docPart: OoxmlElement): BuildingBlock | null {
  const properties = childNamed(docPart, 'docPartPr');
  const types = childNamed(properties, 'types');
  if (
    types?.children.some(
      (child) =>
        child.kind !== 'textValue' && isWml(child, 'type') && !BLOCK_TYPES.has(valOf(child) ?? '')
    )
  )
    return null;
  const name = valOf(childNamed(properties, 'name'))?.trim();
  if (!name || name.length > 512) return null;
  const category = childNamed(properties, 'category');
  const gallery = valOf(childNamed(category, 'gallery'))?.trim();
  if (!gallery || gallery.length > 256) return null;
  const categoryName = valOf(childNamed(category, 'name'))?.trim() || DEFAULT_CATEGORY;
  if (categoryName.length > 256) return null;
  const body = childNamed(docPart, 'docPartBody');
  if (!body || body.children.length > 4096) return null;
  const blocks = body.children.filter(
    (child) => child.kind !== 'textValue' && !isWml(child, 'sectPr')
  );
  if (blocks.length === 0) return null;
  return {
    name,
    gallery,
    category: categoryName,
    blocks,
  };
}

/** Every named building block of the glossary, in authored order. Empty without a glossary. */
export function buildingBlocksOf(pkg: OoxmlPackage): readonly BuildingBlock[] {
  const glossary = glossaryPartOf(pkg);
  if (!glossary) return [];
  const out: BuildingBlock[] = [];
  let visited = 0;
  const visit = (node: OoxmlNode, depth: number): void => {
    if (
      ++visited > MAX_BUILDING_BLOCKS * 4 ||
      node.kind === 'textValue' ||
      depth > 8 ||
      out.length >= MAX_BUILDING_BLOCKS
    )
      return;
    const element: OoxmlElement = node;
    if (isWml(element, 'docPart')) {
      const block = blockOf(element);
      if (block) out.push(block);
      return;
    }
    for (const child of element.children) {
      if (visited >= MAX_BUILDING_BLOCKS * 4 || out.length >= MAX_BUILDING_BLOCKS) break;
      visit(child, depth + 1);
    }
  };
  visit(glossary.root, 0);
  return out;
}

/** The gallery a `w:docPartList` control lists, or null for any other control. */
export function buildingBlockGalleryOf(control: OoxmlNode): BuildingBlockGalleryFilter | null {
  if (control.kind === 'textValue') return null;
  let properties: OoxmlElement | undefined;
  for (const child of control.children) {
    if (child.kind !== 'textValue' && child.localName === 'sdtPr') properties = child;
  }
  const list = childNamed(properties, 'docPartList');
  if (!list) return null;
  const gallery = valOf(childNamed(list, 'docPartGallery'))?.trim();
  const category = valOf(childNamed(list, 'docPartCategory'))?.trim();
  return { gallery: gallery || 'docParts', category: category || null };
}

/**
 * The blocks a gallery control offers: same gallery, and the control's category when it names
 * one. Sorted by category, then name, as Word groups its list.
 */
export function buildingBlocksForControl(
  pkg: OoxmlPackage,
  control: OoxmlNode
): readonly BuildingBlock[] {
  const filter = buildingBlockGalleryOf(control);
  if (!filter) return [];
  const gallery = normalizeGallery(filter.gallery);
  const category = filter.category?.toLowerCase() ?? null;
  return buildingBlocksOf(pkg)
    .filter(
      (block) =>
        normalizeGallery(block.gallery) === gallery &&
        (category === null || block.category.toLowerCase() === category)
    )
    .sort(
      (left, right) =>
        left.category.localeCompare(right.category) || left.name.localeCompare(right.name)
    );
}

/** Bounded walk for a block's text: a hostile glossary cannot make one lookup unbounded. */
const MAX_PROMPT_NODES = 4096;

/**
 * The text of a block's first paragraph, or undefined when it holds none. For an inline
 * control, the same paragraph that `materializeGlossaryPlaceholders` shows when a document
 * opens with the control empty; a block-level control shows every paragraph of the block there.
 */
function promptTextOf(block: BuildingBlock): string | undefined {
  let visited = 0;
  const textOf = (node: OoxmlNode, depth: number): string => {
    if (++visited > MAX_PROMPT_NODES || depth > 8) return '';
    if (node.kind === 'textValue') return '';
    if (isWml(node, 't')) {
      return node.children.map((child) => (child.kind === 'textValue' ? child.value : '')).join('');
    }
    return node.children.map((child) => textOf(child, depth + 1)).join('');
  };
  const first = block.blocks.find((node) => node.kind === 'paragraph' || isWml(node, 'p'));
  if (!first || first.kind === 'textValue') return undefined;
  const text = textOf(first, 0);
  return text.length > 0 ? text : undefined;
}

const promptTexts = new WeakMap<OoxmlPackage, ReadonlyMap<string, string>>();

/**
 * The prompt text a control's `w:placeholder/w:docPart` names: the text of the block's first
 * paragraph, which a control shows when the user empties it. Read once per package.
 */
export function placeholderTextOf(pkg: OoxmlPackage, docPart: string): string | undefined {
  let texts = promptTexts.get(pkg);
  if (!texts) {
    const found = new Map<string, string>();
    const named = new Set<string>();
    for (const block of buildingBlocksOf(pkg)) {
      // The first block with a name answers for it, as on open, even when it holds no text.
      if (named.has(block.name)) continue;
      named.add(block.name);
      const text = promptTextOf(block);
      if (text !== undefined) found.set(block.name, text);
    }
    texts = found;
    promptTexts.set(pkg, texts);
  }
  return texts.get(docPart);
}
