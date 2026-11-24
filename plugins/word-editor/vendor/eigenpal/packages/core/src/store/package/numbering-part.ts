// Creating a list definition, and the `numbering.xml` part to hold it.
//
// Toggling a bullet or numbered list is not a property edit: `w:numPr` names a `w:num`,
// which names a `w:abstractNum`, which is where the nine levels and their formats live.
// A document Word has never numbered has no `numbering.xml` at all, so the part, its
// relationship and its content-type override all have to be created before the first
// bullet can exist.
//
// Everything here is ENGINE-AUTHORED — none of it is file-derived — so the XML is built
// from literals and validated ids rather than interpolated from anything an attacker
// controls.

import { strFromU8, strToU8 } from 'fflate';
import { createNodeIdAllocator, insertChildren } from './ooxml-edit.ts';
import { readOoxmlPart } from './ooxml-tree.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { withPart, type OoxmlPackage } from './ooxml-package.ts';
import { partNameKey } from './opc-names.ts';
import type { RelationshipRecord } from './relationships.ts';
import { readXml, type XmlNode } from './xml-reader.ts';
import {
  MAX_RELATIONSHIP_NUMBER,
  freePackageRelationshipId,
  nextStripedDecimalId,
  resolveAllocationActor,
} from './actor-scoped-ids.ts';
import {
  recordPutContentTypeOverride,
  recordPutRelationship,
  runWithoutJournalCapture,
} from './canonical-primitive-capture.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NUMBERING_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const NUMBERING_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const CONTENT_TYPES_PART = '/[Content_Types].xml';
const NUMBERING_PART = '/word/numbering.xml';

/** The two list kinds a toolbar offers. */
export type ListKind = 'bullet' | 'ordered';

/**
 * Word's own bullet glyphs and fonts, by level, cycling every three.
 *
 * The codepoints are the SYMBOL-FONT ones Word writes, not their Unicode lookalikes:
 * U+F0B7 in Symbol and U+F0A7 in Wingdings, both in the private-use range those legacy
 * fonts map through. Writing `•` (U+2022) and `§` (U+00A7) instead produced a file whose
 * glyphs differ from Word's the moment the named font is present, because the font maps
 * F0xx, not the Unicode character with the same picture.
 */
const BULLETS = [
  { text: '\uF0B7', font: 'Symbol' },
  { text: 'o', font: 'Courier New' },
  { text: '\uF0A7', font: 'Wingdings' },
] as const;

/** Word's own numbering formats, by level, cycling every three. */
const NUMBER_FORMATS = ['decimal', 'lowerLetter', 'lowerRoman'] as const;

/** Nine levels, the count `w:ilvl` allows (ECMA-376 17.9.24). */
const LEVEL_COUNT = 9;

/** `ST_SignedTwipsMeasure` bound the layout index also clamps level indents to (22"). */
const MAX_LEVEL_INDENT_TWIPS = 31_680;

/**
 * Where one level puts its marker and text, in twips, as the list being converted resolved it.
 *
 * Switching a list item between bullets and numbers changes what the marker SAYS, never
 * where the item sits. A field left out is one the old level did not state, so the new level
 * does not state it either and the paragraph style's value keeps applying.
 */
export interface ListLevelGeometry {
  /** `w:left`: the leading indent of the text, in either paragraph direction. */
  readonly left?: number;
  /** `w:right`: the trailing indent. */
  readonly right?: number;
  /** `w:hanging`; exclusive with {@link firstLine}, and preferred when both are given. */
  readonly hanging?: number;
  /** `w:firstLine`: how far the first line starts past the leading indent. */
  readonly firstLine?: number;
  /** `w:suff`: what separates the marker from the text. Omitted means a tab. */
  readonly suffix?: 'tab' | 'space' | 'nothing';
  /** `w:lvlJc`: how the marker aligns at its position. */
  readonly align?: 'left' | 'center' | 'right';
  /**
   * The old level's own `w:pPr`, carried for everything it states besides the indent above:
   * direction (`w:bidi`), tab stops, spacing and alignment move the item as surely as `w:ind`.
   * Must be a node of this package's numbering part; it is copied, never shared.
   */
  readonly paragraphProperties?: OoxmlElement;
}

/**
 * Geometry for each of the nine levels, indexed by `w:ilvl`. A missing entry takes the stock
 * geometry, which is what a level the old list never declared would have been given anyway.
 */
export type ListDefinitionGeometry = readonly (ListLevelGeometry | undefined)[];

const indentValue = (value: number | undefined, min: number): number | undefined =>
  value !== undefined && Number.isInteger(value) && value >= min && value <= MAX_LEVEL_INDENT_TWIPS
    ? value
    : undefined;

/** The `w:pPr` a level authors for `geometry`, or '' when it states no indent at all. */
function geometryPPrXml(geometry: ListLevelGeometry): string {
  const left = indentValue(geometry.left, -MAX_LEVEL_INDENT_TWIPS);
  const right = indentValue(geometry.right, -MAX_LEVEL_INDENT_TWIPS);
  const hanging = indentValue(geometry.hanging, 0);
  const firstLine = hanging === undefined ? indentValue(geometry.firstLine, 0) : undefined;
  const attributes = [
    left !== undefined ? ` w:left="${left}"` : '',
    right !== undefined ? ` w:right="${right}"` : '',
    hanging !== undefined ? ` w:hanging="${hanging}"` : '',
    firstLine !== undefined ? ` w:firstLine="${firstLine}"` : '',
  ].join('');
  // A carried `w:pPr` needs its container even without an indent; an empty one is dropped
  // once the carried children are in (`withCarriedParagraphProperties`).
  if (!attributes) return geometry.paragraphProperties ? '<w:pPr></w:pPr>' : '';
  return `<w:pPr><w:ind${attributes}/></w:pPr>`;
}

/**
 * `CT_PPrBase` children that precede `w:ind` (ECMA-376 17.3.1.26), where a carried property
 * list takes the authored indent. ORDER IS LOAD-BEARING: it is a strict `xsd:sequence`.
 */
const PPR_BEFORE_IND = new Set([
  'pStyle',
  'keepNext',
  'keepLines',
  'pageBreakBefore',
  'framePr',
  'widowControl',
  'numPr',
  'suppressLineNumbers',
  'pBdr',
  'shd',
  'tabs',
  'suppressAutoHyphens',
  'kinsoku',
  'wordWrap',
  'overflowPunct',
  'topLinePunct',
  'autoSpaceDE',
  'autoSpaceDN',
  'bidi',
  'adjustRightInd',
  'snapToGrid',
  'spacing',
]);

/**
 * Carried `w:pPr` children a minted level must not take: the indent is authored from the
 * geometry, and the rest name a style, a list, a section or a revision that belong to the
 * old definition, not to a level.
 */
const PPR_NOT_CARRIED = new Set(['ind', 'pStyle', 'numPr', 'rPr', 'sectPr', 'pPrChange']);

/**
 * Fill each authored level's `w:pPr` with the carried children of its old level, around the
 * authored `w:ind`. Levels without carried properties are returned as authored.
 */
function withCarriedParagraphProperties(
  abstract: OoxmlElement,
  geometry: ListDefinitionGeometry | undefined
): OoxmlElement {
  if (!geometry?.some((level) => level?.paragraphProperties)) return abstract;
  const children = abstract.children.map((child) => {
    if (child.kind === 'textValue' || child.localName !== 'lvl') return child;
    const level = child as OoxmlElement;
    const carried = geometry[parsedIlvl(level) ?? -1]?.paragraphProperties;
    if (!carried) return level;
    return {
      ...level,
      children: level.children.flatMap((part) => {
        if (part.kind === 'textValue' || part.localName !== 'pPr') return [part];
        const authored = part as OoxmlElement;
        const kept = carried.children.filter(
          (node) =>
            node.kind !== 'textValue' &&
            node.namespaceUri === W &&
            !PPR_NOT_CARRIED.has(node.localName)
        );
        const at = kept.reduce(
          (index, node, position) =>
            PPR_BEFORE_IND.has((node as OoxmlElement).localName) ? position + 1 : index,
          0
        );
        const merged = [...kept.slice(0, at), ...authored.children, ...kept.slice(at)];
        return merged.length === 0 ? [] : [{ ...authored, children: merged } as OoxmlNode];
      }),
    } as OoxmlElement;
  });
  return { ...abstract, children } as OoxmlElement;
}

const SUFFIXES = new Set(['space', 'nothing']);
const ALIGNMENTS = new Set(['left', 'center', 'right']);

/**
 * One `w:lvl`, with its children in `CT_Lvl` order.
 *
 * ORDER IS LOAD-BEARING — do not "tidy" it. `CT_Lvl` (ECMA-376 17.9.6) is a strict
 * `xsd:sequence`: `start, numFmt, lvlRestart, pStyle, isLgl, suff, lvlText,
 * lvlPicBulletId, lvlJc, pPr, rPr`. This used to emit `numFmt, lvlText, start, lvlJc, pPr`,
 * which puts `w:start` two slots late and `w:lvlText` ahead of its own predecessors — so
 * every list this engine created was schema-invalid. Word calls such a `numbering.xml`
 * unreadable content, repairs the file, and drops the part and every list with it.
 *
 * `w:lvlJc="left"` and `w:ind w:left=` are the TRANSITIONAL spellings Word writes. The
 * schema copy under `reference/` is ISO 29500 Strict, where those same slots read
 * `start`/`end`; that is a namespace difference, not a defect here.
 *
 * `geometry` replaces the stock indent, suffix and marker alignment: the marker format
 * comes from `kind`, the position from the list the item is leaving.
 */
function levelXml(kind: ListKind, ilvl: number, geometry?: ListLevelGeometry): string {
  // 0.5" per level, with the marker in a 0.25" hanging slot.
  const left = 720 * (ilvl + 1);
  const start = '<w:start w:val="1"/>';
  const suffix =
    geometry?.suffix && SUFFIXES.has(geometry.suffix) ? `<w:suff w:val="${geometry.suffix}"/>` : '';
  const align = geometry?.align && ALIGNMENTS.has(geometry.align) ? geometry.align : undefined;
  if (kind === 'bullet') {
    const bullet = BULLETS[ilvl % BULLETS.length]!;
    return (
      `<w:lvl w:ilvl="${ilvl}">${start}<w:numFmt w:val="bullet"/>${suffix}` +
      `<w:lvlText w:val="${bullet.text}"/><w:lvlJc w:val="${align ?? 'left'}"/>` +
      (geometry
        ? geometryPPrXml(geometry)
        : `<w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr>`) +
      `<w:rPr><w:rFonts w:ascii="${bullet.font}" w:hAnsi="${bullet.font}" w:hint="default"/></w:rPr>` +
      '</w:lvl>'
    );
  }
  const format = NUMBER_FORMATS[ilvl % NUMBER_FORMATS.length]!;
  // Word's stock template right-aligns its roman levels in a narrower 180-twip hanging
  // slot (a "viii." grows leftward from the marker edge); the other formats are
  // left-aligned in the ordinary 360-twip slot.
  const roman = format === 'lowerRoman';
  // `%N` is the placeholder for level N+1's counter; each level shows only its own.
  return (
    `<w:lvl w:ilvl="${ilvl}">${start}<w:numFmt w:val="${format}"/>${suffix}` +
    `<w:lvlText w:val="%${ilvl + 1}."/><w:lvlJc w:val="${align ?? (roman ? 'right' : 'left')}"/>` +
    (geometry
      ? geometryPPrXml(geometry)
      : `<w:pPr><w:ind w:left="${left}" w:hanging="${roman ? 180 : 360}"/></w:pPr>`) +
    '</w:lvl>'
  );
}

function abstractNumXml(
  kind: ListKind,
  abstractNumId: number,
  geometry?: ListDefinitionGeometry
): string {
  const levels = Array.from({ length: LEVEL_COUNT }, (_, ilvl) =>
    levelXml(kind, ilvl, geometry?.[ilvl])
  ).join('');
  return (
    `<w:abstractNum w:abstractNumId="${abstractNumId}">` +
    `<w:multiLevelType w:val="${kind === 'bullet' ? 'hybridMultilevel' : 'multilevel'}"/>` +
    `${levels}</w:abstractNum>`
  );
}

/** An empty `numbering.xml`, for a document that has never carried a list. */
function emptyNumberingPart(): OoxmlPart | null {
  const read = readOoxmlPart(`<w:numbering xmlns:w="${W}"></w:numbering>`, {
    name: NUMBERING_PART,
    contentType: NUMBERING_CONTENT_TYPE,
  });
  return read.ok ? read.part : null;
}

const childrenNamed = (node: OoxmlElement, localName: string): OoxmlElement[] => {
  const found: OoxmlElement[] = [];
  for (const child of node.children) {
    if (child.kind === 'textValue' || child.localName !== localName) continue;
    // Namespace-checked like the layout index's reader: these bytes come out of an
    // attacker-supplied `.docx`, and a foreign-namespace `<x:lvl>` matched by local name
    // alone made this module and layout disagree about what is declared — the write path
    // "saw" a level the index resolves to nothing.
    if (child.namespaceUri !== W) continue;
    found.push(child as OoxmlElement);
  }
  return found;
};

const attribute = (node: OoxmlElement, localName: string): string | undefined =>
  node.attributes.find((entry) => entry.localName === localName)?.value;

/** What one grafted element must look like, verified AFTER the authored XML is parsed. */
interface AuthoredShape {
  readonly localName: string;
  /** An attribute whose value must match exactly, pinning the element to its id. */
  readonly attribute?: { readonly localName: string; readonly value: string };
}

/**
 * Parse engine-authored numbering XML and verify it is EXACTLY the elements the template
 * meant to produce — same philosophy as `withNumberingContentType`'s post-condition.
 *
 * The templates above interpolate only validated integers and engine constants, so this
 * can never fire today; it exists so a future edit that lets anything else into an
 * interpolation grafts NOTHING instead of grafting a surprise. Returns the elements in
 * shape order, or null when the parse or the shape check refuses.
 */
function authoredElements(
  xml: string,
  shapes: readonly AuthoredShape[]
): readonly OoxmlElement[] | null {
  const read = readOoxmlPart(`<w:numbering xmlns:w="${W}">${xml}</w:numbering>`, {
    name: NUMBERING_PART,
    contentType: NUMBERING_CONTENT_TYPE,
  });
  if (!read.ok) return null;
  const elements: OoxmlElement[] = [];
  for (const node of read.part.root.children) {
    if (node.kind !== 'textValue') elements.push(node as OoxmlElement);
  }
  if (elements.length !== shapes.length) return null;
  for (let index = 0; index < shapes.length; index += 1) {
    const element = elements[index]!;
    const shape = shapes[index]!;
    if (element.namespaceUri !== W || element.localName !== shape.localName) return null;
    if (
      shape.attribute &&
      attribute(element, shape.attribute.localName) !== shape.attribute.value
    ) {
      return null;
    }
  }
  return elements;
}

/**
 * `CT_Numbering`'s child sequence (ECMA-376 17.9.16). ORDER IS LOAD-BEARING.
 *
 * `numPicBullet*, abstractNum*, num*, numIdMacAtCleanup?` is a strict `xsd:sequence`, so a
 * new child's position is fixed by the SEQUENCE, not by where its own kind happens to end.
 */
const CT_NUMBERING_SEQUENCE = ['numPicBullet', 'abstractNum', 'num', 'numIdMacAtCleanup'];

/**
 * Where a new child of `localName` belongs among `children`, per a strict `xsd:sequence`.
 *
 * "After the last sibling of my own kind, or 0" is the rule this replaces, and it is wrong
 * twice over: on a part holding a `w:numPicBullet` the fallback put the first
 * `w:abstractNum` at index 0 — ahead of the picture bullet — and appending at the end put
 * `w:num` after `w:numIdMacAtCleanup`. Both make Word repair the file.
 *
 * The rule here is "after the last sibling whose slot is at or before mine". Whitespace and
 * elements the sequence does not model are TRANSPARENT: they neither move the insert nor
 * get reordered, because their position is not ours to decide. This is the same class of
 * fix `store/tree-op-properties.ts` made for `CT_PPr`; that module's rank/order helpers are
 * private to it and specific to a property container, so this is a local, four-name twin
 * rather than a shared abstraction.
 */
function sequenceInsertIndex(
  children: readonly OoxmlNode[],
  sequence: readonly string[],
  localName: string
): number {
  const rank = sequence.indexOf(localName);
  if (rank === -1) return children.length;
  let at = 0;
  children.forEach((child, index) => {
    if (child.kind === 'textValue') return;
    const childRank = sequence.indexOf(child.localName);
    if (childRank !== -1 && childRank <= rank) at = index + 1;
  });
  return at;
}

/**
 * Next unused `w:numId` / `w:abstractNumId`.
 *
 * No actor: one past the highest, the sequence this file minted before striping. `w:numId`
 * 0 is Word's "no numbering" sentinel, so even a stripe that lands on 0 advances one class.
 * An attached actor takes the next unused id in its residue, so two peers creating lists
 * from the same snapshot cannot weld `numbering.xml` onto one shared `numId`.
 */
function nextFreeId(nodes: readonly OoxmlElement[], attributeName: string): number {
  const used = new Set<string>(['0']);
  let max = 0;
  for (const node of nodes) {
    const raw = attribute(node, attributeName);
    if (!raw || !/^\d{1,9}$/.test(raw)) continue;
    const value = Number(raw);
    used.add(String(value));
    max = Math.max(max, value);
  }
  const actor = resolveAllocationActor();
  if (!actor) return max + 1;
  return Number(nextStripedDecimalId(used, actor, MAX_RELATIONSHIP_NUMBER));
}

/**
 * One `w:lvlOverride`/`w:startOverride` per level of a reused `w:abstractNum`, each at that
 * level's own `w:start`.
 *
 * Every `w:num` over one abstract definition counts on one shared counter, so a new list on a
 * reused template would otherwise continue the earlier list. Bullet and `none` levels get the
 * override too: a bullet list can become numbered later (a level format change replaces the
 * level inside this same `w:num`), and it must still start on its own. The start comes from the
 * file, so it is bounded the way the layout index reads it.
 */
function restartOverridesXml(abstract: OoxmlElement): string {
  const starts = new Map<number, number>();
  for (const level of childrenNamed(abstract, 'lvl')) {
    const ilvlRaw = attribute(level, 'ilvl') ?? '0';
    if (!/^[0-8]$/.test(ilvlRaw) || starts.has(Number(ilvlRaw))) continue;
    const start = childrenNamed(level, 'start')[0];
    const startRaw = (start && attribute(start, 'val')) ?? '';
    starts.set(Number(ilvlRaw), /^\d{1,9}$/.test(startRaw) ? Math.min(Number(startRaw), 9999) : 1);
  }
  return [...starts]
    .sort(([left], [right]) => left - right)
    .map(
      ([ilvl, start]) =>
        `<w:lvlOverride w:ilvl="${ilvl}"><w:startOverride w:val="${start}"/></w:lvlOverride>`
    )
    .join('');
}

/** Element equality without node ids: names, attributes, then element children in order. */
function sameElement(left: OoxmlElement, right: OoxmlElement): boolean {
  if (left.namespaceUri !== right.namespaceUri || left.localName !== right.localName) return false;
  if (left.attributes.length !== right.attributes.length) return false;
  for (const entry of left.attributes) {
    const match = right.attributes.find(
      (other) => other.namespaceUri === entry.namespaceUri && other.localName === entry.localName
    );
    if (match?.value !== entry.value) return false;
  }
  const leftChildren = left.children.filter((child) => child.kind !== 'textValue');
  const rightChildren = right.children.filter((child) => child.kind !== 'textValue');
  return (
    leftChildren.length === rightChildren.length &&
    leftChildren.every((child, index) =>
      sameElement(child as OoxmlElement, rightChildren[index] as OoxmlElement)
    )
  );
}

/**
 * An existing definition whose levels are exactly the ones this module would author for
 * `kind` and `geometry`.
 *
 * Pressing a list button again, or switching an item back and forth, then reuses one
 * definition per kind and geometry instead of adding definitions on every press. Any other
 * definition the document holds is never borrowed: a heading numbering such as "01" with its
 * own marker formatting is decimal too, and a new list must not take its look. A document
 * whose lists another program authored gains one definition of this module's own on the first
 * press; later presses reuse it.
 */
function sameLevelsAbstract(
  abstractNums: readonly OoxmlElement[],
  kind: ListKind,
  geometry: ListDefinitionGeometry | undefined
): OoxmlElement | undefined {
  const authored = authoredElements(abstractNumXml(kind, 0, geometry), [
    { localName: 'abstractNum' },
  ])?.[0];
  if (!authored) return undefined;
  const candidate = withCarriedParagraphProperties(authored, geometry);
  const wanted = childrenNamed(candidate, 'lvl');
  return abstractNums.find((abstract) => {
    if (childrenNamed(abstract, 'numStyleLink').length > 0) return false;
    const levels = childrenNamed(abstract, 'lvl');
    return (
      levels.length === wanted.length &&
      levels.every((level, index) => sameElement(level, wanted[index]!))
    );
  });
}

export interface EnsuredListDefinition {
  readonly pkg: OoxmlPackage;
  /** The `w:numId` a paragraph's `w:numPr` should name. */
  readonly numId: string;
}

/**
 * Find or create a list definition of `kind`, returning the package that holds it.
 *
 * Only a definition with exactly the levels this module authors for `kind` is reused, so a
 * new list looks the same in every document; a definition the document authored itself, such
 * as a heading numbering, is left to the paragraphs that use it. Every disconnected list gets
 * a fresh `w:num` instance. Counters belong to the abstract definition, shared by every
 * `w:num` over it, so the fresh instance restarts each level with a
 * `w:startOverride` (see {@link restartOverridesXml}). Returns null only when the part cannot
 * be built at all.
 *
 * With `geometry`, the definition is the one a list item SWITCHING kind needs: `kind`'s
 * markers at the positions its old list gave each level, so the item does not move. Only a
 * definition with exactly those levels is reused; any other one is created.
 */
export function ensureListDefinition(
  pkg: OoxmlPackage,
  kind: ListKind,
  geometry?: ListDefinitionGeometry
): EnsuredListDefinition | null {
  const existingPart = pkg.parts.get(NUMBERING_PART);
  const numbering = existingPart ?? emptyNumberingPart();
  if (!numbering) return null;
  const root = numbering.root;

  const abstractNums = childrenNamed(root, 'abstractNum').filter((abstract) =>
    /^\d{1,9}$/.test(attribute(abstract, 'abstractNumId') ?? '')
  );
  const nums = childrenNamed(root, 'num');

  // Reuse the first matching TEMPLATE, not its counter instance. Two disconnected lists
  // can share one `w:abstractNum`, but each needs its own `w:num` with restart overrides to
  // start at the authored level baseline. Without them a new list after 39 items began at 40.
  const matchingAbstract = sameLevelsAbstract(abstractNums, kind, geometry);

  const matchingAbstractId = matchingAbstract
    ? Number(attribute(matchingAbstract, 'abstractNumId'))
    : null;
  const abstractNumId = matchingAbstractId ?? nextFreeId(abstractNums, 'abstractNumId');
  const numId = nextFreeId(nums, 'numId');
  // New elements are authored as their own document, shape-verified, then GRAFTED under
  // fresh node ids. A matching template needs only a new counter instance.
  const createsAbstract = matchingAbstract === undefined;
  const authored = authoredElements(
    (createsAbstract ? abstractNumXml(kind, abstractNumId, geometry) : '') +
      `<w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractNumId}"/>` +
      `${matchingAbstract ? restartOverridesXml(matchingAbstract) : ''}</w:num>`,
    createsAbstract
      ? [
          {
            localName: 'abstractNum',
            attribute: { localName: 'abstractNumId', value: String(abstractNumId) },
          },
          { localName: 'num', attribute: { localName: 'numId', value: String(numId) } },
        ]
      : [{ localName: 'num', attribute: { localName: 'numId', value: String(numId) } }]
  );
  if (!authored) return null;
  const nextId = createNodeIdAllocator(numbering);
  const fresh = authored.map((node, index) =>
    withFreshIds(
      createsAbstract && index === 0 ? withCarriedParagraphProperties(node, geometry) : node,
      nextId
    )
  );
  const newAbstract = createsAbstract ? fresh[0] : undefined;
  const newNum = fresh[createsAbstract ? 1 : 0];
  if ((createsAbstract && !newAbstract) || !newNum) return null;

  // A new `w:abstractNum` must precede every `w:num` (17.9.1). Each element lands at its
  // CT_NUMBERING_SEQUENCE slot, while a reused template leaves existing children untouched.
  const build = (): OoxmlPart | null => {
    let partWithAbstract = numbering;
    if (newAbstract) {
      const inserted = insertChildren(
        numbering,
        root.id,
        sequenceInsertIndex(root.children, CT_NUMBERING_SEQUENCE, 'abstractNum'),
        [newAbstract]
      );
      if (!inserted.ok) return null;
      partWithAbstract = inserted.part;
    }
    const withNum = insertChildren(
      partWithAbstract,
      root.id,
      sequenceInsertIndex(partWithAbstract.root.children, CT_NUMBERING_SEQUENCE, 'num'),
      [newNum]
    );
    return withNum.ok ? withNum.part : null;
  };

  // A FIRST list creates the part, and a splice into a root no peer has yet cannot replay:
  // the journal has to carry the part itself. So the build is suppressed in that case and
  // `withPart` records the finished root; an existing part keeps the narrow splices.
  const built = existingPart ? build() : runWithoutJournalCapture(build);
  if (!built) return null;

  let next: OoxmlPackage = withPart(pkg, built);
  if (!existingPart) {
    // FAIL CLOSED, both of them: a package that gained `/word/numbering.xml` without the
    // matching relationship or content-type override is not a package worth returning.
    const related = withNumberingRelationship(next);
    if (!related) return null;
    const declared = withNumberingContentType(related);
    if (!declared) return null;
    next = declared;
  }
  return { pkg: next, numId: String(numId) };
}

/**
 * `CT_AbstractNum`'s child sequence (ECMA-376 17.9.1). ORDER IS LOAD-BEARING.
 *
 * `nsid?, multiLevelType?, tmpl?, name?, styleLink?, numStyleLink?, lvl*` is a strict
 * `xsd:sequence`, so a grafted `w:lvl` must land after every header element. Among the
 * `w:lvl` siblings themselves the schema imposes no order, but Word writes them by `ilvl`
 * and this keeps that shape.
 */
const CT_ABSTRACT_NUM_SEQUENCE = [
  'nsid',
  'multiLevelType',
  'tmpl',
  'name',
  'styleLink',
  'numStyleLink',
  'lvl',
];

/**
 * A `w:ilvl` attribute parsed with the SAME rule the layout index uses (`integerAttr`), so
 * "declared" here can never mean something the index refuses to resolve. Null for absent,
 * non-decimal, or lenient spellings the index rejects (`+1`, `1e0`).
 */
function parsedIlvl(node: OoxmlElement): number | null {
  const raw = attribute(node, 'ilvl');
  if (raw === undefined || !/^\d{1,9}$/.test(raw)) return null;
  return Number(raw);
}

/** Where a new `w:lvl` of `ilvl` belongs among an abstractNum's children. */
function levelInsertIndex(children: readonly OoxmlNode[], ilvl: number): number {
  let at = 0;
  children.forEach((child, index) => {
    if (child.kind === 'textValue') return;
    if (child.localName === 'lvl' && (child as OoxmlElement).namespaceUri === W) {
      if ((parsedIlvl(child as OoxmlElement) ?? 0) < ilvl) at = index + 1;
      return;
    }
    if (CT_ABSTRACT_NUM_SEQUENCE.includes(child.localName)) at = index + 1;
  });
  return at;
}

/**
 * Declare `level` in the definition `numId` names, with Word's default format for that
 * level, or refuse.
 *
 * Word never greys Increase Indent out on a list item: demoting past the deepest level a
 * `w:abstractNum` declares makes Word DEFINE the level, cycling its stock bullets
 * (Symbol •, Courier `o`, Wingdings ▪) or number formats (decimal, lowerLetter,
 * lowerRoman) by depth. This is that write. An already-declared level returns the package
 * unchanged, so callers may ask first and act second without a second lookup.
 *
 * A delegating definition (`w:numStyleLink`, 17.9.21) is refused: its levels live on the
 * linked style's definition, and a `w:lvl` grafted here would be shadowed the moment the
 * link resolves.
 */
export function ensureNumberingLevel(
  pkg: OoxmlPackage,
  numId: string,
  level: number,
  kind: ListKind
): OoxmlPackage | null {
  if (!Number.isInteger(level) || level < 0 || level >= LEVEL_COUNT) return null;
  // `numId` is FILE-DERIVED (a paragraph's `w:numPr`), used here only as a comparison
  // key — bounded like the layout index bounds ids, so a pathological id cannot make the
  // lookups below churn through megabyte string comparisons.
  if (numId.length === 0 || numId.length > 64) return null;
  const numbering = pkg.parts.get(NUMBERING_PART);
  if (!numbering) return null;
  const root = numbering.root;

  const num = childrenNamed(root, 'num').find((node) => attribute(node, 'numId') === numId);
  const abstractRef = num ? childrenNamed(num, 'abstractNumId')[0] : undefined;
  const abstractId = abstractRef ? attribute(abstractRef, 'val') : undefined;
  if (!abstractId) return null;
  const abstract = childrenNamed(root, 'abstractNum').find(
    (node) => attribute(node, 'abstractNumId') === abstractId
  );
  if (!abstract) return null;
  if (childrenNamed(abstract, 'numStyleLink').length > 0) return null;

  const levels = childrenNamed(abstract, 'lvl');
  if (levels.some((node) => parsedIlvl(node) === level)) return pkg;
  // `CT_AbstractNum` caps `lvl` at nine (17.9.1). An abstract already at the cap whose
  // levels do not include this one is authored junk (duplicate ilvls); a tenth would make
  // the part schema-invalid, which Word repairs by dropping it.
  if (levels.length >= LEVEL_COUNT) return null;

  const authored = authoredElements(levelXml(kind, level), [
    { localName: 'lvl', attribute: { localName: 'ilvl', value: String(level) } },
  ]);
  if (!authored) return null;
  const nextId = createNodeIdAllocator(numbering);
  const inserted = insertChildren(
    numbering,
    abstract.id,
    levelInsertIndex(abstract.children, level),
    [withFreshIds(authored[0]!, nextId)]
  );
  if (!inserted.ok) return null;

  return withPart(pkg, inserted.part);
}

/** Re-key a grafted subtree so it cannot collide with the part it is joining. */
function withFreshIds(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { ...node, id: nextId() } as OoxmlNode;
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => withFreshIds(child, nextId)),
  } as OoxmlNode;
}

/**
 * Point the main document at the numbering part.
 *
 * The rels part is a TREE like any other, so the relationship is a node insert. A document
 * with no rels part at all gets one — and it must then be declared in `[Content_Types].xml`
 * too, which `withNumberingContentType` handles by extension default.
 *
 * `pkg.relationships` is updated ALONGSIDE the tree. Writing only the tree left the
 * in-memory map one record short, so `freeRelationshipId` — which reads the map, not the
 * tree — handed the same `rIdN` to a second relationship minted in the same session, and
 * anything resolving a part by relationship (rather than by literal path) could not see the
 * numbering part at all.
 */
function withNumberingRelationship(pkg: OoxmlPackage): OoxmlPackage | null {
  const owner = pkg.mainDocumentPart;
  const relsName = relsPartNameFor(owner);
  const existing = pkg.parts.get(relsName);
  const id = freeRelationshipId(pkg);
  const authored = readOoxmlPart(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="${id}" Type="${NUMBERING_REL_TYPE}" Target="numbering.xml"/>` +
      '</Relationships>',
    { name: relsName, contentType: RELS_CONTENT_TYPE }
  );
  if (!authored.ok) return null;

  const owned = pkg.relationships.get(owner) ?? [];
  const record: RelationshipRecord = {
    ownerPart: owner,
    id,
    type: NUMBERING_REL_TYPE,
    rawTarget: 'numbering.xml',
    targetMode: 'Internal',
    order: owned.reduce((max, entry) => Math.max(max, entry.order), -1) + 1,
  };
  const relationships = new Map([...pkg.relationships, [owner, [...owned, record]]]);

  // The relationship travels as ONE first-class effect, the way `withRelationship` does it: a
  // peer rebuilds the `.rels` entry from the record, so the tree splice under it is suppressed
  // rather than journaled twice. Recording nothing at all is what left a replicated first list
  // pointing at a numbering part the peer had no relationship for.
  if (!existing) {
    const next = Object.freeze({ ...withPart(pkg, authored.part), relationships });
    recordPutRelationship(owner, record);
    return next;
  }
  const nextId = createNodeIdAllocator(existing);
  const node = authored.part.root.children[0];
  if (!node) return null;
  const inserted = runWithoutJournalCapture(() =>
    insertChildren(existing, existing.root.id, existing.root.children.length, [
      withFreshIds(node, nextId),
    ])
  );
  if (!inserted.ok) return null;
  const next = Object.freeze({
    ...pkg,
    parts: new Map([...pkg.parts, [relsName, inserted.part]]),
    relationships,
  });
  recordPutRelationship(owner, record);
  return next;
}

/** `/word/document.xml` -> `/word/_rels/document.xml.rels`. */
function relsPartNameFor(partName: string): string {
  const slash = partName.lastIndexOf('/');
  return `${partName.slice(0, slash)}/_rels/${partName.slice(slash + 1)}.rels`;
}

/** An `rIdN` no owner in the package already uses. */
function freeRelationshipId(pkg: OoxmlPackage): string {
  return freePackageRelationshipId(pkg);
}

const NUMBERING_OVERRIDE = `<Override PartName="${NUMBERING_PART}" ContentType="${NUMBERING_CONTENT_TYPE}"/>`;

/**
 * Declare the numbering part in `[Content_Types].xml`, or REFUSE.
 *
 * `readOoxmlPackage` keeps this part as bytes rather than a canonical tree (nothing else
 * reads it as one, and `writeOoxmlPackage` re-emits only the parts held as trees), so a
 * tree edit is not reachable here — promoting it to `pkg.parts` would change what the
 * package writes back and what the D9 oracles walk. The bytes are still PARSED before they
 * are touched, and the patched bytes are parsed again to prove the edit landed:
 *
 *   * The root is identified by PARSING, never by matching `</Types>`. These bytes come out
 *     of an attacker-supplied `.docx`, and a legally prefixed root (`<ct:Types
 *     xmlns:ct="...">`) is not a defect — it just is not the string the old code looked
 *     for, so the override was silently skipped.
 *   * The post-condition is structural: after patching, the root's direct children must be
 *     exactly what they were plus our one `Override`, last. That rejects a splice that
 *     landed inside a comment, a CDATA section, or a nested element.
 *   * Every failure returns null and `ensureListDefinition` refuses the whole operation.
 *     Returning `pkg` unchanged was silent corruption: `/word/numbering.xml` was already in
 *     `parts`, so `writeOoxmlPackage` emitted a part with no content-type override — invalid
 *     OPC, which Word repairs by dropping it. No oracle sees content types, so nothing
 *     caught it.
 *
 * The inserted markup is an ENGINE LITERAL — no file-derived value is interpolated — so
 * there is nothing here to escape.
 */
function withNumberingContentType(pkg: OoxmlPackage): OoxmlPackage | null {
  const declared = pkg.contentTypes.overrides.get(partNameKey(NUMBERING_PART));
  if (declared === NUMBERING_CONTENT_TYPE) return pkg;
  // An override claiming a DIFFERENT type for this part cannot be joined by a second one:
  // duplicate overrides fail closed on the next read, so refuse rather than corrupt.
  if (declared !== undefined) return null;

  const bytes = pkg.partBytes.get(CONTENT_TYPES_PART);
  if (!bytes) return null;
  const xml = strFromU8(bytes);
  const before = contentTypesShape(xml);
  if (!before) return null;

  const close = xml.lastIndexOf(`</${before.rootName}>`);
  if (close === -1) return null;
  const patched = xml.slice(0, close) + NUMBERING_OVERRIDE + xml.slice(close);

  const after = contentTypesShape(patched);
  if (!after || after.rootName !== before.rootName) return null;
  const expected = [
    ...before.children,
    childSignature('Override', { PartName: NUMBERING_PART, ContentType: NUMBERING_CONTENT_TYPE }),
  ];
  if (after.children.length !== expected.length) return null;
  if (after.children.some((child, index) => child !== expected[index])) return null;

  const next = Object.freeze({
    ...pkg,
    partBytes: new Map([...pkg.partBytes, [CONTENT_TYPES_PART, strToU8(patched)]]),
    contentTypes: Object.freeze({
      defaults: pkg.contentTypes.defaults,
      overrides: new Map([
        ...pkg.contentTypes.overrides,
        [partNameKey(NUMBERING_PART), NUMBERING_CONTENT_TYPE],
      ]),
    }),
  });
  recordPutContentTypeOverride(NUMBERING_PART, NUMBERING_CONTENT_TYPE);
  return next;
}

interface ContentTypesShape {
  /** The root's AUTHORED QName, so a prefixed root closes with its own tag. */
  readonly rootName: string;
  /** A signature per direct child, enough to notice any change to any of them. */
  readonly children: readonly string[];
}

/**
 * Parse `[Content_Types].xml` far enough to know its root and its direct children.
 *
 * Returns null unless there is exactly one root element, its local name is `Types`, and the
 * prefix it is written under is bound ON THAT ROOT to the OPC content-types namespace — a
 * root that is not a content-types root is not one this may patch.
 */
function contentTypesShape(xml: string): ContentTypesShape | null {
  const parsed = readXml(xml);
  if (!parsed.ok) return null;
  const roots = parsed.nodes.filter(
    (node): node is Extract<XmlNode, { type: 'element' }> => node.type === 'element'
  );
  if (roots.length !== 1) return null;
  const root = roots[0]!;
  const colon = root.name.indexOf(':');
  const prefix = colon === -1 ? '' : root.name.slice(0, colon);
  if (root.name.slice(colon + 1) !== 'Types') return null;
  if (root.attributes[prefix ? `xmlns:${prefix}` : 'xmlns'] !== CONTENT_TYPES_NS) return null;
  const children: string[] = [];
  for (const child of root.children) {
    if (child.type !== 'element') continue;
    children.push(childSignature(child.name, child.attributes));
  }
  return { rootName: root.name, children };
}

/**
 * One direct child of the types root, reduced to a comparable string.
 *
 * Attribute ORDER carries no meaning here, so it is sorted away; the separator is a
 * character no XML name or attribute value may contain, so two different children cannot
 * collide on one signature.
 */
function childSignature(name: string, attributes: Readonly<Record<string, string>>): string {
  const pairs = Object.entries(attributes)
    .map(([attribute, value]) => `${attribute}=${value}`)
    .sort();
  return [name, ...pairs].join('\u0001');
}
