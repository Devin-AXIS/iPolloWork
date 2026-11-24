import { withHeadingSymbols } from './toc-heading-symbols.ts';
import { resolveTocSources } from '../package/toc-sources.ts';
import { tocRowOmitsPageNumber } from '../package/toc-rows.ts';
import { sliceTocParagraph } from '../package/toc-result.ts';
// TOC refresh TreeDocOps — replace result paragraphs / rewrite page-number runs.

import {
  detectBodyTocs,
  findDetectedToc,
  tocFieldRange,
  type DetectedToc,
} from '../package/toc-detect.ts';
import {
  bookmarkPairNodes,
  buildTocContentControl,
  buildTocEntryParagraph,
  type TocEntryPlan,
} from '../package/toc-build.ts';
import { parseTocInstruction, TOC_MAX_ENTRIES } from '../package/toc-instruction.ts';
import {
  createNodeIdAllocator,
  findNode,
  insertChildren,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlParagraphNode,
  OoxmlPart,
} from '../package/ooxml-tree.ts';
import { MAX_INLINE_CONTAINER_DEPTH, nextInlineContainerDepth } from '../package/ooxml-shared.ts';
import {
  cloneWithNewIds,
  effectiveContentLockAt,
  effectiveLockOf,
  fromEdit,
  isBoundAt,
  isContentControlNode,
  ok,
  parentOf,
} from './tree-op-nodes.ts';
import { isValidXmlText } from '../package/sinks.ts';
import { usedParaIds, w14PrefixInScopeAt, withFreshParaIds } from '../package/para-id.ts';
import { actorScopedSeed } from '../package/actor-scoped-ids.ts';
import { nextBookmarkId } from './tree-op-bookmark-ids.ts';
import { markerSiteAt } from './tree-op-comments.ts';
import { segmentsOf } from './tree-op-segments.ts';
import { hardBreakKind } from '../package/hard-break.ts';
import type { TreeDocOp, TreeOpEffect, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

export type ReplaceTocResultOp = Extract<TreeDocOp, { op: 'replaceTocResult' }>;
export type RewriteTocPageNumbersOp = Extract<TreeDocOp, { op: 'rewriteTocPageNumbers' }>;
export type InsertTocOp = Extract<TreeDocOp, { op: 'insertToc' }>;

function validateEntriesAndBookmarks(
  part: OoxmlPart,
  op: Pick<InsertTocOp, 'entries' | 'bookmarksToCreate'>
): TreeOpRejection | null {
  if (!Array.isArray(op.entries) || op.entries.length > TOC_MAX_ENTRIES) return 'invalidArgs';
  if (!Array.isArray(op.bookmarksToCreate) || op.bookmarksToCreate.length > TOC_MAX_ENTRIES) {
    return 'invalidArgs';
  }
  for (const entry of op.entries) {
    if (!Number.isInteger(entry.level) || entry.level < 0 || entry.level > 8) return 'invalidArgs';
    if (
      typeof entry.text !== 'string' ||
      entry.text.length > 200 ||
      !isValidXmlText(entry.text) ||
      typeof entry.headingParagraphId !== 'string' ||
      entry.headingParagraphId.length === 0 ||
      typeof entry.bookmarkName !== 'string' ||
      entry.bookmarkName.length === 0 ||
      entry.bookmarkName.length > 40 ||
      !isValidXmlText(entry.bookmarkName) ||
      typeof entry.pageNumberText !== 'string' ||
      entry.pageNumberText.length > 32 ||
      !isValidXmlText(entry.pageNumberText)
    ) {
      return 'invalidArgs';
    }
  }
  for (const bookmark of op.bookmarksToCreate) {
    if (
      typeof bookmark.paragraphId !== 'string' ||
      bookmark.paragraphId.length === 0 ||
      typeof bookmark.name !== 'string' ||
      bookmark.name.length === 0 ||
      bookmark.name.length > 40 ||
      !isValidXmlText(bookmark.name)
    ) {
      return 'invalidArgs';
    }
    const paragraph = findNode(part, bookmark.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') return 'unknown-paragraph';
    if (isBoundAt(part, bookmark.paragraphId)) return 'bound';
    if (effectiveContentLockAt(part, bookmark.paragraphId).content) return 'locked';
  }
  return null;
}

export function validateInsertToc(part: OoxmlPart, op: InsertTocOp): TreeOpRejection | null {
  if (
    typeof op.beforeParagraphId !== 'string' ||
    op.beforeParagraphId.length === 0 ||
    typeof op.alias !== 'string' ||
    op.alias.length === 0 ||
    op.alias.length > 128 ||
    !isValidXmlText(op.alias)
  ) {
    return 'invalidArgs';
  }
  if (!parseTocInstruction(op.instruction)) return 'invalidArgs';
  const paragraph = findNode(part, op.beforeParagraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return 'unknown-paragraph';
  const parent = parentOf(part, paragraph.id);
  if (!parent || parent.localName !== 'body') return 'not-a-block';
  if (isBoundAt(part, paragraph.id)) return 'bound';
  if (effectiveContentLockAt(part, paragraph.id).content) return 'locked';
  return validateEntriesAndBookmarks(part, op);
}

export function tocRestriction(part: OoxmlPart, toc: DetectedToc): TreeOpRejection | null {
  for (const nodeId of [toc.beginParagraphId, ...toc.resultParagraphIds, toc.endParagraphId]) {
    if (isBoundAt(part, nodeId)) return 'bound';
    if (effectiveContentLockAt(part, nodeId).content) return 'locked';
    const paragraph = findNode(part, nodeId);
    if (paragraph && paragraph.kind !== 'textValue' && toc.resultParagraphIds.includes(nodeId)) {
      const nested = resultControlRestriction(part, sliceTocParagraph(paragraph, toc, 'result'));
      if (nested) return nested;
    }
  }
  if (toc.contentControlId) {
    const control = findNode(part, toc.contentControlId);
    if (control && isContentControlNode(control)) {
      const lock = effectiveLockOf(part, control);
      if (lock.content) return 'locked';
      if (isBoundAt(part, toc.contentControlId)) return 'bound';
    }
  }
  return null;
}

function resultControlRestriction(
  part: OoxmlPart,
  node: OoxmlNode,
  depth = 0
): TreeOpRejection | null {
  if (node.kind === 'textValue') return null;
  if (depth >= MAX_INLINE_CONTAINER_DEPTH) return 'invalidArgs';
  if (isContentControlNode(node)) {
    if (isBoundAt(part, node.id)) return 'bound';
    if (effectiveContentLockAt(part, node.id).content) return 'locked';
  }
  const next = nextInlineContainerDepth(node, depth);
  for (const child of node.children) {
    const rejected = resultControlRestriction(part, child, next);
    if (rejected) return rejected;
  }
  return null;
}

/** A full result replacement cannot retain nested controls, including inline controls. */
function resultContainsControl(node: OoxmlNode, depth = 0): boolean {
  if (node.kind === 'textValue') return false;
  if (isContentControlNode(node)) return true;
  if (depth >= MAX_INLINE_CONTAINER_DEPTH) return true;
  const next = nextInlineContainerDepth(node, depth);
  return node.children.some((child) => resultContainsControl(child, next));
}

export function validateReplaceTocResult(
  part: OoxmlPart,
  op: ReplaceTocResultOp
): TreeOpRejection | null {
  if (typeof op.tocId !== 'string' || op.tocId.length === 0) return 'invalidArgs';
  const input = validateEntriesAndBookmarks(part, op);
  if (input) return input;
  const toc = findDetectedToc(detectBodyTocs(part), op.tocId);
  if (!toc) return 'unknown-block';
  const range = tocFieldRange(toc);
  const container = findNode(part, toc.containerId);
  if (!range || !container || container.kind === 'textValue') return 'invalidArgs';
  const start = container.children.findIndex((node) => node.id === range.separateParagraphId);
  const end = container.children.findIndex((node) => node.id === toc.endParagraphId);
  if (start < 0 || end < start) return 'invalidArgs';
  // A block replacement cannot retain tables, controls, or section boundaries inside
  // the result. Refuse these shapes before inserting bookmarks or deleting content.
  for (const node of container.children.slice(start, end + 1)) {
    if (node.kind !== 'paragraph') return 'invalidArgs';
    if (resultContainsControl(sliceTocParagraph(node, toc, 'result'))) return 'invalidArgs';
    if (node.id === toc.endParagraphId) continue;
    const properties = node.children.find((child) => child.kind === 'paragraphProperties');
    if (properties?.children.some((child) => child.localName === 'sectPr')) return 'invalidArgs';
  }
  return tocRestriction(part, toc);
}

export function validateRewriteTocPageNumbers(
  part: OoxmlPart,
  op: RewriteTocPageNumbersOp
): TreeOpRejection | null {
  if (typeof op.tocId !== 'string' || op.tocId.length === 0) return 'invalidArgs';
  if (!Array.isArray(op.updates) || op.updates.length > TOC_MAX_ENTRIES) return 'invalidArgs';
  for (const update of op.updates) {
    if (typeof update.paragraphId !== 'string' || update.paragraphId.length === 0) {
      return 'invalidArgs';
    }
    if (
      typeof update.pageNumberText !== 'string' ||
      update.pageNumberText.length > 32 ||
      !isValidXmlText(update.pageNumberText)
    ) {
      return 'invalidArgs';
    }
  }
  const toc = findDetectedToc(detectBodyTocs(part), op.tocId);
  if (!toc) return 'unknown-block';
  if (op.updates.some((update) => !toc.resultParagraphIds.includes(update.paragraphId))) {
    return 'invalidArgs';
  }
  return tocRestriction(part, toc);
}

/** A `w:br` that ends the page or the column, as opposed to a line break. */
function isPageOrColumnBreak(node: OoxmlNode): boolean {
  if (node.kind !== 'hardBreak') return false;
  const kind = hardBreakKind(node);
  return kind === 'page' || kind === 'column';
}

/**
 * The model offset after a paragraph's leading page and column breaks, or 0 when it has
 * none. A paragraph made only of breaks answers 0: its bookmark stays at the front. This
 * matches where layout starts the paragraph's text (`leadingBreakTextStarts`).
 */
function leadingBreaksEnd(paragraph: OoxmlParagraphNode): number {
  let offset = 0;
  for (const segment of segmentsOf(paragraph)) {
    if (segment.start !== offset || !isPageOrColumnBreak(segment.node)) {
      return offset;
    }
    offset = segment.end;
  }
  return 0;
}

function insertBookmarks(
  part: OoxmlPart,
  bookmarks: readonly { paragraphId: string; name: string }[],
  options?: EditOptions
): TreeOpResult {
  let current = part;
  const mint = createNodeIdAllocator(current);
  const mintBookmarkId = nextBookmarkId(current);
  const dirty: string[] = [];
  for (const bookmark of bookmarks) {
    const paragraph = findNode(current, bookmark.paragraphId);
    if (!paragraph || paragraph.kind === 'textValue') {
      return { ok: false, reason: 'unknown-paragraph' };
    }
    const bookmarkId = mintBookmarkId();
    const pair = bookmarkPairNodes(mint, bookmark.name, bookmarkId);
    // The end goes last in the paragraph. The start goes in front of the heading text, after
    // pPr and after any leading page or column break, so a PAGEREF to it, a link that follows
    // it, and an exported PDF destination all name the page where the heading text is.
    const textStart = paragraph.kind === 'paragraph' ? leadingBreaksEnd(paragraph) : 0;
    const children = [...paragraph.children];
    let insertAt = 0;
    if (children[0] && children[0].kind !== 'textValue' && children[0].localName === 'pPr') {
      insertAt = 1;
    }
    if (textStart === 0) children.splice(insertAt, 0, pair.start);
    children.push(pair.end);
    const replaced = replaceChildren(current, paragraph.id, children, options);
    if (!replaced.ok) return { ok: false, reason: 'tree-invariant', detail: 'bookmark-insert' };
    current = replaced.part;
    if (textStart > 0) {
      const reloaded = findNode(current, paragraph.id);
      if (!reloaded || reloaded.kind !== 'paragraph')
        return { ok: false, reason: 'tree-invariant' };
      const site = markerSiteAt(current, reloaded, textStart, options);
      if (!site.ok) return site;
      const placed = insertChildren(site.part, site.containerId, site.index, [pair.start], options);
      if (!placed.ok) return { ok: false, reason: 'tree-invariant', detail: 'bookmark-insert' };
      current = placed.part;
    }
    dirty.push(paragraph.id);
  }
  return ok(current, {
    dirty,
    created: [],
    deleted: [],
    dependencyKeys: dirty,
    impact: 'flow-structural',
  });
}

function replaceResultParagraphs(
  part: OoxmlPart,
  toc: DetectedToc,
  entries: readonly TocEntryPlan[],
  options?: EditOptions
): TreeOpResult {
  const container = findNode(part, toc.containerId);
  if (!container || container.kind === 'textValue') {
    return { ok: false, reason: 'unknown-block' };
  }
  const range = tocFieldRange(toc);
  if (!range) return { ok: false, reason: 'unknown-block' };
  const beginIdx = container.children.findIndex((child) => child.id === range.separateParagraphId);
  const endIdx = container.children.findIndex((child) => child.id === toc.endParagraphId);
  if (beginIdx < 0 || endIdx < 0 || endIdx < beginIdx) {
    return { ok: false, reason: 'invalidArgs' };
  }

  // Word commonly stores TOC geometry directly on each cached result paragraph even when a
  // TOC1…TOC9 style is also present. Preserve one template per level so refresh does not
  // discard document-specific tabs, indents, spacing, or bidi settings. Fresh ids are minted
  // by the builder; only the formatting shape is reused.
  const propertiesByStyle = new Map<string, OoxmlNode>();
  for (const paragraphId of toc.resultParagraphIds) {
    const paragraph = findNode(part, paragraphId);
    if (!paragraph || paragraph.kind === 'textValue') continue;
    const properties = paragraph.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'pPr'
    );
    if (!properties || properties.kind === 'textValue') continue;
    const style = properties.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'pStyle'
    );
    if (style?.kind === 'textValue') continue;
    const styleId = style?.attributes.find((attribute) => attribute.localName === 'val')?.value;
    if (styleId?.startsWith('TOC') && !propertiesByStyle.has(styleId)) {
      propertiesByStyle.set(styleId, {
        ...properties,
        children: properties.children.filter(
          (child) => child.kind === 'textValue' || child.localName !== 'sectPr'
        ),
      } as OoxmlNode);
    }
  }
  const mint = createNodeIdAllocator(part);
  // Built paragraphs carry no identity; mint one each so a refreshed TOC stays addressable.
  const paraIds = new Set(usedParaIds(part.root));
  const identity = { value: 0 };
  const hostPrefix = w14PrefixInScopeAt(part, container);
  const withIdentity = (node: OoxmlNode): OoxmlNode =>
    withFreshParaIds(
      node,
      paraIds,
      actorScopedSeed(`${toc.containerId}:toc`),
      identity,
      hostPrefix
    );
  const newEntries = entries.map((entry) => {
    const styleId = `TOC${Math.min(entry.level + 1, 9)}`;
    return withIdentity(
      buildTocEntryParagraph(mint, entry, toc.instruction, propertiesByStyle.get(styleId))
    );
  });
  const begin = container.children[beginIdx] as OoxmlElement;
  const end = container.children[endIdx] as OoxmlElement;
  let prefix = sliceTocParagraph(begin, toc, 'before');
  const suffixSlice = sliceTocParagraph(end, toc, 'after');
  // One paragraph/run may own both markers. Its two halves cannot share node ids.
  let suffix = beginIdx === endIdx ? cloneWithNewIds(suffixSlice, mint) : suffixSlice;
  if (beginIdx === endIdx && suffix.kind !== 'textValue') {
    // Paragraph identities cannot occur twice in the saved document, so the cloned half
    // takes a fresh one. The section mark belongs to the final half, just as it does after
    // an ordinary split.
    suffix = withIdentity(suffix);
    prefix = {
      ...prefix,
      children: prefix.children.map((child) =>
        child.kind === 'paragraphProperties'
          ? ({
              ...child,
              children: child.children.filter((property) => property.localName !== 'sectPr'),
            } as OoxmlNode)
          : child
      ),
    } as OoxmlElement;
  }
  // Word places the first generated entry beside the separator. Keeping a standalone
  // prefix paragraph inserts a blank line above every refreshed TOC.
  const firstEntry = newEntries.shift();
  if (firstEntry && firstEntry.kind !== 'textValue') {
    const isProperties = (node: OoxmlNode) => node.kind === 'paragraphProperties';
    prefix = {
      ...prefix,
      children: [
        ...firstEntry.children.filter(isProperties),
        ...prefix.children.filter((node) => !isProperties(node)),
        ...firstEntry.children.filter((node) => !isProperties(node)),
      ],
    } as OoxmlElement;
  }
  const nextChildren = [
    ...container.children.slice(0, beginIdx),
    prefix,
    ...newEntries,
    suffix,
    ...container.children.slice(endIdx + 1),
  ];
  const deleted = container.children.slice(beginIdx + 1, endIdx).map((node) => node.id);
  const created = [
    ...newEntries.map((node) => node.id),
    ...(beginIdx === endIdx ? [suffix.id] : []),
  ];
  const replaced = replaceChildren(part, container.id, nextChildren, options);
  if (!replaced.ok) return { ok: false, reason: 'tree-invariant' };
  const effect: TreeOpEffect = {
    dirty: [toc.beginParagraphId, range.separateParagraphId, toc.endParagraphId, ...created],
    created,
    deleted,
    dependencyKeys: [toc.containerId],
    impact: 'flow-structural',
  };
  return fromEdit(replaced, effect);
}

export function applyInsertToc(
  part: OoxmlPart,
  op: InsertTocOp,
  options?: EditOptions
): TreeOpResult {
  let current = part;
  if (op.bookmarksToCreate.length > 0) {
    const booked = insertBookmarks(current, op.bookmarksToCreate, options);
    if (!booked.ok || !booked.part) return booked;
    current = booked.part;
  }
  const instruction = parseTocInstruction(op.instruction);
  const paragraph = findNode(current, op.beforeParagraphId);
  if (!instruction || !paragraph || paragraph.kind !== 'paragraph') {
    return { ok: false, reason: 'invalidArgs' };
  }
  const parent = parentOf(current, paragraph.id);
  if (!parent || parent.localName !== 'body') return { ok: false, reason: 'not-a-block' };
  const index = parent.children.findIndex((child) => child.id === paragraph.id);
  if (index < 0) return { ok: false, reason: 'tree-invariant' };
  const mint = createNodeIdAllocator(current);
  const control = withFreshParaIds(
    buildTocContentControl(
      mint,
      op.entries.map((entry) => withHeadingSymbols(part, entry)),
      instruction,
      op.alias
    ),
    new Set(usedParaIds(current.root)),
    actorScopedSeed(`${op.beforeParagraphId}:toc`),
    { value: 0 },
    w14PrefixInScopeAt(current, parent)
  );
  const inserted = insertChildren(current, parent.id, index, [control], options);
  return fromEdit(inserted, {
    dirty: [parent.id, ...op.entries.map((entry) => entry.headingParagraphId)],
    created: [control.id],
    deleted: [],
    dependencyKeys: [parent.id],
    impact: 'flow-structural',
  });
}

export function applyReplaceTocResult(
  part: OoxmlPart,
  op: ReplaceTocResultOp,
  options?: EditOptions
): TreeOpResult {
  const toc = findDetectedToc(detectBodyTocs(part), op.tocId);
  if (!toc) return { ok: false, reason: 'unknown-block' };

  let current = part;
  if (op.bookmarksToCreate.length > 0) {
    const booked = insertBookmarks(current, op.bookmarksToCreate, options);
    if (!booked.ok || !booked.part) return booked;
    current = booked.part;
  }

  // Re-detect after bookmark inserts (ids stable for TOC chrome).
  const tocAfter = findDetectedToc(detectBodyTocs(current), op.tocId);
  if (!tocAfter) return { ok: false, reason: 'unknown-block' };

  const entries: TocEntryPlan[] = op.entries.map((entry) =>
    withHeadingSymbols(current, {
      level: entry.level,
      text: entry.text,
      headingParagraphId: entry.headingParagraphId,
      bookmarkName: entry.bookmarkName,
      pageNumberText: entry.pageNumberText,
    })
  );

  return replaceResultParagraphs(current, tocAfter, entries, options);
}

/** Walk a TOC entry paragraph and rewrite the last text run that looks like a page number. */
function rewritePageNumberInParagraph(
  paragraph: OoxmlElement,
  pageNumberText: string,
  mint: () => string,
  toc: DetectedToc,
  omitsPageNumber: boolean
): OoxmlElement | null {
  // Find text nodes inside hyperlink or direct runs; replace the last w:t.
  const texts: OoxmlNode[] = [];
  let hasPageTab = false;
  const walk = (node: OoxmlNode, depth: number): void => {
    if (depth >= MAX_INLINE_CONTAINER_DEPTH) return;
    if (node.kind === 'tab' || (node.kind !== 'textValue' && node.localName === 'ptab')) {
      hasPageTab = true;
    }
    if (node.kind === 'text' || (node.kind !== 'textValue' && node.localName === 't')) {
      texts.push(node);
      return;
    }
    if (node.kind === 'textValue') return;
    const childDepth = nextInlineContainerDepth(node, depth);
    for (const child of node.children) walk(child, childDepth);
  };
  walk(sliceTocParagraph(paragraph, toc, 'result'), 0);
  if (!hasPageTab || texts.length < 2 || omitsPageNumber) return null;
  const target = texts[texts.length - 1]!;
  if (target.kind === 'textValue') return null;
  const targetId = target.id;
  let currentText = '';
  for (const child of target.children) {
    if (child.kind === 'textValue') currentText += child.value;
  }
  if (currentText === pageNumberText) return null;
  const rewrite = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (node.id === targetId) {
      return {
        ...node,
        children: [{ id: mint(), kind: 'textValue', value: pageNumberText }],
      } as OoxmlNode;
    }
    const children = node.children.map(rewrite);
    return children.some((child, index) => child !== node.children[index])
      ? ({ ...node, children } as OoxmlNode)
      : node;
  };
  return rewrite(paragraph) as OoxmlElement;
}

export function applyRewriteTocPageNumbers(
  part: OoxmlPart,
  op: RewriteTocPageNumbersOp,
  options?: EditOptions
): TreeOpResult {
  const toc = findDetectedToc(detectBodyTocs(part), op.tocId);
  if (!toc) return { ok: false, reason: 'unknown-block' };

  const sources = resolveTocSources(part, [], toc.instruction) ?? [];
  if (toc.instruction.omitPageNumbers)
    return ok(part, {
      dirty: [],
      created: [],
      deleted: [],
      dependencyKeys: [],
      impact: 'text-local',
    });
  let current = part;
  const mint = createNodeIdAllocator(current);
  const dirty: string[] = [];

  for (const update of op.updates) {
    if (!toc.resultParagraphIds.includes(update.paragraphId)) continue;
    const paragraph = findNode(current, update.paragraphId);
    if (!paragraph || paragraph.kind === 'textValue') continue;
    const rewritten = rewritePageNumberInParagraph(
      paragraph as OoxmlElement,
      update.pageNumberText,
      mint,
      toc,
      tocRowOmitsPageNumber(current, sliceTocParagraph(paragraph, toc, 'result'), sources)
    );
    if (!rewritten) continue;
    const parent = parentOf(current, paragraph.id);
    if (!parent) return { ok: false, reason: 'unknown-block' };
    const siblings = parent.children.map((child) =>
      child.id === paragraph.id ? rewritten : child
    );
    const replaced = replaceChildren(current, parent.id, siblings, options);
    if (!replaced.ok) return { ok: false, reason: 'tree-invariant' };
    current = replaced.part;
    dirty.push(update.paragraphId);
  }

  if (dirty.length === 0) {
    return ok(current, {
      dirty: [],
      created: [],
      deleted: [],
      dependencyKeys: [],
      impact: 'text-local',
    });
  }

  return ok(current, {
    dirty,
    created: [],
    deleted: [],
    dependencyKeys: dirty,
    impact: 'text-local',
  });
}
