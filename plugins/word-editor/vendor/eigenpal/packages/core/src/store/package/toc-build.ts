import { resolveTocSources } from './toc-sources.ts';
import { TOC_SYMBOL_MARK, tocSymbolNode, type TocSymbol } from './toc-symbol-text.ts';
// Build TOC result paragraphs and ensure heading bookmarks.

import {
  MAX_DECIMAL_ID,
  nextStripedDecimalId,
  resolveAllocationActor,
} from './actor-scoped-ids.ts';
import { WML_NAMESPACE_URI, XML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { buildBookmarkIndex, type BookmarkIndex } from './bookmarks.ts';
import { twips, type Twips } from '../units.ts';
/** Outline heading shape consumed by TOC planning (mirrors DocumentOutlineEntry). */
export interface TocOutlineHeading {
  readonly text: string;
  readonly level: number;
  readonly blockId: string;
}
import type { TocInstruction } from './toc-instruction.ts';
import { TOC_MAX_BOOKMARKS_PER_REFRESH, TOC_MAX_ENTRIES } from './toc-instruction.ts';

/** Left-indent step between TOC levels, in twips (matches `scripts/demo-doc/toc-block.xml`). */
export const TOC_LEVEL_INDENT_TWIPS: Twips = twips(240);

/** Bounded left-indent twips for a TOC entry level (0-based heading depth). */
export function tocLeftIndentTwips(level: number): Twips {
  if (!Number.isFinite(level)) return twips(0);
  const bounded = Math.max(0, Math.min(8, Math.trunc(level)));
  return twips(bounded * TOC_LEVEL_INDENT_TWIPS);
}

/** One planned TOC entry: its level, its text, and the heading it points at. */
export interface TocEntryPlan {
  readonly level: number;
  readonly text: string;
  readonly headingParagraphId: string;
  readonly bookmarkName: string;
  readonly pageNumberText: string;
  /** The heading's symbols, one per {@link TOC_SYMBOL_MARK} in `text`, in order. */
  readonly symbols?: readonly TocSymbol[];
}

function wAttr(localName: string, value: string) {
  return {
    kind: 'genericExtension' as const,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    value,
  };
}

function textNode(mint: () => string, text: string): OoxmlNode {
  return {
    id: mint(),
    kind: 'text',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 't',
    prefix: 'w',
    namespaceBindings: [],
    attributes: /^\s|\s$/.test(text)
      ? [
          {
            kind: 'xmlSpace',
            namespaceUri: XML_NAMESPACE_URI,
            localName: 'space',
            prefix: 'xml',
            value: 'preserve',
          },
        ]
      : [],
    children: [{ id: mint(), kind: 'textValue', value: text }],
  } as unknown as OoxmlNode;
}

/**
 * Entry text from the outline shows a heading's non-breaking hyphen as U+2011. The row writes
 * it back as a `w:noBreakHyphen`, as the heading has it.
 */
function textWithNonBreakingHyphens(mint: () => string, text: string): OoxmlNode[] {
  if (!text.includes('\u2011')) return [textNode(mint, text)];
  return text.split('\u2011').flatMap((piece, index) => [
    ...(index > 0
      ? [
          {
            id: mint(),
            kind: 'generic',
            namespaceUri: WML_NAMESPACE_URI,
            localName: 'noBreakHyphen',
            prefix: 'w',
            namespaceBindings: [],
            attributes: [],
            children: [],
          } as OoxmlNode,
        ]
      : []),
    ...(piece.length > 0 ? [textNode(mint, piece)] : []),
  ]);
}

/** Text pieces between symbol marks, each mark written back as its `w:sym`. */
function textWithSymbols(
  mint: () => string,
  text: string,
  symbols: readonly TocSymbol[] | undefined
): OoxmlNode[] {
  if (!symbols || !text.includes(TOC_SYMBOL_MARK)) return textWithNonBreakingHyphens(mint, text);
  return text.split(TOC_SYMBOL_MARK).flatMap((piece, index) => {
    const symbol = index > 0 ? symbols[index - 1] : undefined;
    return [
      ...(symbol ? [tocSymbolNode(mint, symbol)] : []),
      ...(piece.length > 0 ? textWithNonBreakingHyphens(mint, piece) : []),
    ];
  });
}

function runWithText(mint: () => string, text: string, symbols?: readonly TocSymbol[]): OoxmlNode {
  return {
    id: mint(),
    kind: 'run',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: text.split('\t').flatMap((piece, index) => [
      ...(index > 0
        ? [
            {
              id: mint(),
              kind: 'tab',
              namespaceUri: WML_NAMESPACE_URI,
              localName: 'tab',
              prefix: 'w',
              namespaceBindings: [],
              attributes: [],
              children: [],
            } as OoxmlNode,
          ]
        : []),
      ...textWithSymbols(mint, piece, symbols),
    ]),
  } as unknown as OoxmlNode;
}

function ptabRun(mint: () => string): OoxmlNode {
  return {
    id: mint(),
    kind: 'run',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [
      {
        id: mint(),
        kind: 'generic',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'ptab',
        prefix: 'w',
        namespaceBindings: [],
        attributes: [
          wAttr('alignment', 'right'),
          wAttr('relativeTo', 'margin'),
          wAttr('leader', 'dot'),
        ],
        children: [],
      },
    ],
  } as unknown as OoxmlNode;
}

function fieldChar(mint: () => string, type: 'begin' | 'separate' | 'end'): OoxmlNode {
  return {
    id: mint(),
    kind: 'fldChar',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'fldChar',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [wAttr('fldCharType', type)],
    children: [],
  } as unknown as OoxmlNode;
}

function instructionText(mint: () => string, instruction: string): OoxmlNode {
  return {
    id: mint(),
    kind: 'instrText',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'instrText',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [
      {
        kind: 'xmlSpace',
        namespaceUri: XML_NAMESPACE_URI,
        localName: 'space',
        prefix: 'xml',
        value: 'preserve',
      },
    ],
    children: [{ id: mint(), kind: 'textValue', value: ` ${instruction} ` }],
  } as unknown as OoxmlNode;
}

function runWithChildren(mint: () => string, children: readonly OoxmlNode[]): OoxmlNode {
  return {
    id: mint(),
    kind: 'run',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [...children],
  } as unknown as OoxmlNode;
}

function paragraphWithChildren(mint: () => string, children: readonly OoxmlNode[]): OoxmlNode {
  return {
    id: mint(),
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [...children],
  } as unknown as OoxmlNode;
}

function indentNode(mint: () => string, leftTwips: number): OoxmlNode {
  return {
    id: mint(),
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'ind',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [wAttr('left', String(leftTwips))],
    children: [],
  } as unknown as OoxmlNode;
}

function hasIndentChild(properties: OoxmlNode): boolean {
  if (properties.kind === 'textValue') return false;
  return properties.children.some(
    (child) => child.kind !== 'textValue' && child.localName === 'ind'
  );
}

function insertIndentAfterStyle(properties: OoxmlNode, indent: OoxmlNode): OoxmlNode {
  if (properties.kind === 'textValue') return properties;
  const children = [...properties.children];
  const styleIndex = children.findIndex(
    (child) => child.kind !== 'textValue' && child.localName === 'pStyle'
  );
  if (styleIndex >= 0) {
    children.splice(styleIndex + 1, 0, indent);
  } else {
    children.push(indent);
  }
  return { ...properties, children } as OoxmlNode;
}

/** Add a default level indent when a preserved template omits direct `w:ind`. */
function ensureTocIndent(properties: OoxmlNode, mint: () => string, level: number): OoxmlNode {
  if (hasIndentChild(properties)) return properties;
  const left = tocLeftIndentTwips(level);
  if (left === 0) return properties;
  return insertIndentAfterStyle(properties, indentNode(mint, left));
}

function paragraphProperties(mint: () => string, styleId: string, level: number): OoxmlNode {
  const children: OoxmlNode[] = [
    {
      id: mint(),
      kind: 'generic',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'pStyle',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [wAttr('val', styleId)],
      children: [],
    } as unknown as OoxmlNode,
  ];
  const left = tocLeftIndentTwips(level);
  if (left > 0) {
    children.push(indentNode(mint, left));
  }
  return {
    id: mint(),
    kind: 'paragraphProperties',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'pPr',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children,
  } as unknown as OoxmlNode;
}

function withFreshIds(node: OoxmlNode, mint: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { ...node, id: mint() };
  return {
    ...node,
    id: mint(),
    children: node.children.map((child) => withFreshIds(child, mint)),
  } as OoxmlNode;
}

/** Build one TOC entry paragraph node. */
export function buildTocEntryParagraph(
  mint: () => string,
  entry: TocEntryPlan,
  instruction: TocInstruction,
  paragraphPropertiesTemplate?: OoxmlNode
): OoxmlNode {
  const styleId = `TOC${Math.min(entry.level + 1, 9)}`;
  const runs: OoxmlNode[] = [runWithText(mint, entry.text, entry.symbols)];
  if (!instruction.omitPageNumbers && entry.pageNumberText !== '') {
    runs.push(ptabRun(mint));
    runs.push(runWithText(mint, entry.pageNumberText));
  }

  const content: OoxmlNode[] = instruction.hyperlink
    ? [
        {
          id: mint(),
          kind: 'hyperlink',
          namespaceUri: WML_NAMESPACE_URI,
          localName: 'hyperlink',
          prefix: 'w',
          namespaceBindings: [],
          attributes: [wAttr('anchor', entry.bookmarkName)],
          children: runs,
        } as unknown as OoxmlNode,
      ]
    : runs;

  const properties = paragraphPropertiesTemplate
    ? ensureTocIndent(withFreshIds(paragraphPropertiesTemplate, mint), mint, entry.level)
    : paragraphProperties(mint, styleId, entry.level);

  return {
    id: mint(),
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [properties, ...content],
  } as unknown as OoxmlNode;
}

/** Splice the field opening in after a paragraph's properties, where Word puts it. */
function withOpeningRun(paragraph: OoxmlNode, opening: OoxmlNode): OoxmlNode {
  const children = (paragraph as unknown as { children: readonly OoxmlNode[] }).children;
  const at = children[0]?.kind === 'paragraphProperties' ? 1 : 0;
  return {
    ...paragraph,
    children: [...children.slice(0, at), opening, ...children.slice(at)],
  } as unknown as OoxmlNode;
}

/** Build an SDT-wrapped complex TOC field with an already planned cached result. */
export function buildTocContentControl(
  mint: () => string,
  entries: readonly TocEntryPlan[],
  instruction: TocInstruction,
  alias: string
): OoxmlNode {
  // Word opens the field INSIDE the first entry's paragraph, not in one of its own: begin,
  // the instruction and the separator are followed by that entry's hyperlink in the same
  // `w:p`. A paragraph holding only the opening has an empty field result, and its mark
  // still occupies a line, so emitting one put a blank row above every inserted TOC.
  // An empty TOC has no entry to open inside and keeps the standalone paragraph.
  const opening = runWithChildren(mint, [
    fieldChar(mint, 'begin'),
    instructionText(mint, instruction.raw),
    fieldChar(mint, 'separate'),
  ]);
  const entryParagraphs = entries.map((entry) => buildTocEntryParagraph(mint, entry, instruction));
  const first = entryParagraphs[0];
  const opened: readonly OoxmlNode[] =
    first === undefined
      ? [paragraphWithChildren(mint, [opening])]
      : [withOpeningRun(first, opening), ...entryParagraphs.slice(1)];
  const end = paragraphWithChildren(mint, [runWithChildren(mint, [fieldChar(mint, 'end')])]);
  const properties: OoxmlNode = {
    id: mint(),
    kind: 'contentControlProperties',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'sdtPr',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [
      {
        id: mint(),
        kind: 'generic',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'alias',
        prefix: 'w',
        namespaceBindings: [],
        attributes: [wAttr('val', alias)],
        children: [],
      } as unknown as OoxmlNode,
      {
        id: mint(),
        kind: 'generic',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'docPartObj',
        prefix: 'w',
        namespaceBindings: [],
        attributes: [],
        children: [
          {
            id: mint(),
            kind: 'generic',
            namespaceUri: WML_NAMESPACE_URI,
            localName: 'docPartGallery',
            prefix: 'w',
            namespaceBindings: [],
            attributes: [wAttr('val', 'Table of Contents')],
            children: [],
          } as unknown as OoxmlNode,
          {
            id: mint(),
            kind: 'generic',
            namespaceUri: WML_NAMESPACE_URI,
            localName: 'docPartUnique',
            prefix: 'w',
            namespaceBindings: [],
            attributes: [],
            children: [],
          } as unknown as OoxmlNode,
        ],
      } as unknown as OoxmlNode,
    ],
  } as unknown as OoxmlNode;
  const content: OoxmlNode = {
    id: mint(),
    kind: 'contentControlContent',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'sdtContent',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [...opened, end],
  } as unknown as OoxmlNode;
  return {
    id: mint(),
    kind: 'contentControl',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'sdt',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [properties, content],
  } as unknown as OoxmlNode;
}

function bookmarkNameOk(name: string): boolean {
  return name.length > 0 && name.length <= 40 && !/[\u0000-\u001F\u007F-\u009F]/.test(name);
}

const TOC_NAME_PREFIX = '_Toc';
/** Word's own `_Toc` seed. Solo documents must keep minting from this exact formula. */
const TOC_SOLO_BASE = 1_600_000_000;
const TOC_SOLO_SPREAD = 10_000;

/** The decimal suffix of a `_TocN` name, when N is a seed we may stripe past. */
function tocNumberOf(name: string): string | null {
  if (!name.startsWith(TOC_NAME_PREFIX)) return null;
  const suffix = name.slice(TOC_NAME_PREFIX.length);
  if (!/^\d{1,10}$/.test(suffix)) return null;
  const value = Number(suffix);
  if (value > MAX_DECIMAL_ID) return null;
  return String(value);
}

function usedTocNumbers(index: BookmarkIndex): Set<string> {
  const used = new Set<string>();
  for (const name of index.keys()) {
    const number = tocNumberOf(name);
    if (number) used.add(number);
  }
  return used;
}

/**
 * Next `_Toc` number for a planned heading bookmark.
 *
 * No actor: `1_600_000_000 + (bookmarkCount % 10_000)`, then +1 — byte-identical to the
 * previous local-count seed. An actor takes the next unused value in its stripe instead.
 * Two peers whose documents hold the same bookmark count otherwise compute the SAME name,
 * and after the CRDT merges both TOCs the shared name jumps to the first heading in
 * document order — the other TOC then links to the wrong heading.
 */
function nextTocBookmarkNumber(index: BookmarkIndex, actorId?: string): () => number {
  const actor = resolveAllocationActor(actorId);
  if (actor) {
    const used = usedTocNumbers(index);
    return () => {
      const id = nextStripedDecimalId(used, actor, MAX_DECIMAL_ID);
      used.add(id);
      return Number(id);
    };
  }
  let next = TOC_SOLO_BASE + (index.size % TOC_SOLO_SPREAD);
  return () => next++;
}

/**
 * Word flattens manual line/tab breaks from a heading into spaces in its TOC cache.
 * Carrying them verbatim makes a short title wrap even when the row has ample room, and the
 * same normalization is what lets a cached row be matched back to the heading it came from.
 */
export function tocEntryText(text: string): string {
  return text
    .replace(/[\t\n\r]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * Plan TOC entries from the outline and existing bookmarks.
 *
 * `actorId` is explicit because this planner runs BEFORE the store transaction, so the
 * ambient transaction actor is not bound. Callers that already have the collaboration
 * identity pass it here. `resolveAllocationActor` still honours a
 * `runWithTransactionActor` wrap when the caller prefers that seam.
 */
export function planTocEntries(
  part: OoxmlPart,
  outline: readonly TocOutlineHeading[],
  instruction: TocInstruction,
  pageNumberByParagraphId: ReadonlyMap<string, string>,
  excludeParagraphIds: ReadonlySet<string>,
  actorId?: string
): {
  readonly entries: readonly TocEntryPlan[];
  readonly bookmarksToCreate: readonly { paragraphId: string; name: string }[];
} {
  const index = buildBookmarkIndex(part);
  const nameByParagraph = new Map<string, string>();
  for (const [name, anchor] of index) {
    if (name.startsWith('_Toc') && !nameByParagraph.has(anchor.paragraphId)) {
      nameByParagraph.set(anchor.paragraphId, name);
    }
  }

  const entries: TocEntryPlan[] = [];
  const bookmarksToCreate: { paragraphId: string; name: string }[] = [];
  let bookmarkAlloc = 0;
  const nextTocId = nextTocBookmarkNumber(index, actorId);

  for (const heading of resolveTocSources(part, outline, instruction) ?? []) {
    if (entries.length >= TOC_MAX_ENTRIES) break;
    if (excludeParagraphIds.has(heading.blockId)) continue;

    let bookmarkName = nameByParagraph.get(heading.blockId);
    if (!bookmarkName && instruction.hyperlink) {
      if (bookmarkAlloc >= TOC_MAX_BOOKMARKS_PER_REFRESH) continue;
      bookmarkName = `${TOC_NAME_PREFIX}${nextTocId()}`;
      if (!bookmarkNameOk(bookmarkName)) continue;
      bookmarksToCreate.push({ paragraphId: heading.blockId, name: bookmarkName });
      bookmarkAlloc += 1;
      nameByParagraph.set(heading.blockId, bookmarkName);
    }
    if (!bookmarkName) {
      bookmarkName = `_Toc${heading.blockId.replace(/[^A-Za-z0-9]/g, '').slice(-12) || '0'}`;
    }

    entries.push({
      level: heading.level,
      text: heading.tcEntry ? heading.text.trim() : tocEntryText(heading.text),
      headingParagraphId: heading.blockId,
      bookmarkName,
      pageNumberText: heading.omitPageNumber
        ? ''
        : (pageNumberByParagraphId.get(heading.blockId) ?? '1'),
    });
  }

  return { entries, bookmarksToCreate };
}

/** Create bookmarkStart/End pair nodes for insertion at the start of a paragraph. */
export function bookmarkPairNodes(
  mint: () => string,
  name: string,
  id: string
): { readonly start: OoxmlNode; readonly end: OoxmlNode } {
  return {
    start: {
      id: mint(),
      kind: 'bookmarkStart',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'bookmarkStart',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [wAttr('id', id), wAttr('name', name)],
      children: [],
    } as unknown as OoxmlNode,
    end: {
      id: mint(),
      kind: 'bookmarkEnd',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'bookmarkEnd',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [wAttr('id', id)],
      children: [],
    } as unknown as OoxmlNode,
  };
}
