// Project attacker-controlled HTML into a bounded WordprocessingML fragment.
// HTML is size-capped before `DOMParser` creates an inert, detached document.
// The allowlist walker has fixed node and depth limits.
// It never attaches parsed nodes, executes markup, or fetches remote resources.
// Hyperlinks pass `sanitizeHref`, and images accept bounded `data:` URIs only.
// XML emission escapes all file-derived text and attributes.
import { sanitizeHref, escapeXmlAttribute } from '../store/package/sinks.ts';
import { projectHtmlImage } from './clipboard-html-images.ts';
import {
  semanticHtmlListKind,
  semanticHtmlListStart,
  wordListDefinitionsFromStyleText,
} from './clipboard-html-numbering.ts';
import { clipboardBookmarkName, isClipboardHyperlink } from './clipboard-html-links.ts';
import { createGestureMemo } from './clipboard-html-memo.ts';
import {
  withCompleteFields,
  withCompleteNoteFields,
  wordFieldRuns,
} from './clipboard-html-fields.ts';
import { reconcileUnreachableNotes } from './clipboard-html-note-reconcile.ts';
import { allocateList, msoListNumPr } from './clipboard-html-list-alloc.ts';
import { writeProjectedHtmlPackage } from './clipboard-html-package.ts';
import {
  clipboardNoteDefinitions,
  clipboardNoteReference,
  collectReferencedNoteIds,
  isClipboardNoteList,
  stripNoteMarks,
  type ClipboardNoteKind,
} from './clipboard-html-notes.ts';
import {
  HEADING_SZ,
  appendPageBreak,
  isFurnitureOnly,
  paragraphXml,
  rPrXml,
  textRunXml,
} from './clipboard-html-run-xml.ts';
import {
  applyInlineTag,
  applyElementRunProps,
  applyParaCss,
  applyRunCss,
  applyWordParagraphAlignment,
  isElement,
  isMsoListIgnoreMarker,
  isWordClipboardHtml,
  parseInlineStyle,
  tagOf,
  wordClassAlignmentsFromDocument,
  wordParagraphStyleId,
  wordStyleTextFromDocument,
  type HtmlParaProps,
  type HtmlRunProps,
} from './clipboard-html-styles.ts';
import {
  hasWordEquationMarkup,
  isEquationPiece,
  prepareWordEquations,
} from './clipboard-html-equations.ts';
import type { FlowContext, ListState, Projection } from './clipboard-html-projection.ts';
import {
  htmlRevisionOf,
  paragraphMarkRevisionXml,
  wrapInRevisions,
  wrapRevisionPieces,
} from './clipboard-html-revisions.ts';
import {
  applyParagraphPropertyChange,
  numberProjectedRevisionIds,
  revisionContextOf,
  withMarkRevision,
} from './clipboard-html-revision-context.ts';
import { projectHtmlTable } from './clipboard-html-table-project.ts';
import { htmlPositionalTabXml, htmlTabRunContents } from './clipboard-html-tabs.ts';
import {
  CONTAINER_TAGS,
  IGNORED_TAGS,
  PARAGRAPH_TAGS,
  domDepthOf,
  hasBlockChild,
  isWordPageBreakBlock,
  isWordPageBreakSpacer,
  wordBlockSdtNodes,
} from './clipboard-html-word-structure.ts';

export interface HtmlProjectionLimits {
  /** UTF-8 size cap applied BEFORE parse. Default 4 MiB. */
  readonly maxHtmlBytes?: number;
  /** Walk cap: nodes visited past this stop contributing. Default 100,000. */
  readonly maxNodes?: number;
  /** Walk cap: children below this depth are not entered. Default 64. */
  readonly maxDepth?: number;
  /** Decoded per-image byte cap for `data:` URIs. Default 2 MiB. */
  readonly maxImageBytes?: number;
}

export type HtmlProjectionResult =
  | {
      readonly ok: true;
      /** A fragment package zip, readable by `readOoxmlPackage`. */
      readonly fragmentBytes: Uint8Array;
      /** True when the final projected paragraph carries a mapped Word style. */
      readonly lastMarkCovered: boolean;
      /** How many `data:` images the projection accepted into the fragment. */
      readonly imageCount: number;
      /** True when the node budget dropped content (body tail or starved note
       *  bodies), so callers can prefer a lossier lane over silent loss. */
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly reason: 'too-large' | 'no-content' | 'parse-unavailable' };

const DEFAULT_MAX_HTML_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_NODES = 100_000;
const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

type RunProps = HtmlRunProps;
type ParaProps = HtmlParaProps;

// --- Allocation

function allocateRel(
  p: Projection,
  type: string,
  target: string,
  external: boolean,
  rels = p.rels
): string {
  const id = `rId${rels.length + 1}`;
  rels.push({ id, type, target, external });
  return id;
}

// --- Walk

/** A piece ending in a line break, also when a revision around the break closes there. */
const LINE_BREAK_END = /<w:br\/><\/w:r>(?:<\/w:(?:ins|del)>)*$/;

function collectInline(
  node: Node,
  depth: number,
  ctx: FlowContext,
  runs: string[],
  p: Projection
): void {
  if (p.nodesLeft <= 0) {
    p.truncated = true;
    return;
  }
  if (depth > p.maxDepth) return;
  p.nodesLeft -= 1;
  if (node.nodeType === 3 /* TEXT_NODE */) {
    const raw = node.nodeValue ?? '';
    if (ctx.pre) {
      const parts = raw.replace(/\r\n?/g, '\n').split('\n');
      for (let index = 0; index < parts.length; index += 1) {
        // Every line past the first charges the walk budget: one text node full
        // of newlines must not amplify one charged unit into unbounded output.
        if (index > 0) {
          p.nodesLeft -= 1;
          if (p.nodesLeft <= 0) {
            p.truncated = true;
            return;
          }
          runs.push(`<w:r>${rPrXml(ctx.run)}<w:br/></w:r>`);
        }
        const part = parts[index]!;
        if (part.length > 0) runs.push(textRunXml(part, ctx.run));
      }
      return;
    }
    // Collapse ASCII whitespace only: an NBSP is real content Word preserves, and
    // JS `\s` would fold it into a plain breakable space.
    let collapsed = raw.replace(/[ \t\r\n\f\v]+/g, ' ');
    // A collapsed space that starts the line after a `<br>` does not render, so it is not text.
    if (collapsed.startsWith(' ') && LINE_BREAK_END.test(runs[runs.length - 1] ?? '')) {
      collapsed = collapsed.slice(1);
    }
    if (collapsed.length === 0) return;
    // Whitespace between blocks: bookmark furniture is not visible content, so a
    // standalone anchor must not turn the gap into a space paragraph — but a
    // bookmark WRAPPING real content stays visible and keeps the word gap.
    if (collapsed === ' ' && isFurnitureOnly(runs)) return;
    runs.push(textRunXml(collapsed, ctx.run));
    return;
  }
  // Word keeps a field's begin, instruction, separator and end in conditional comments.
  if (node.nodeType === 8 /* COMMENT_NODE */ && p.wordHtml) {
    for (const run of wordFieldRuns(node.nodeValue ?? '', p)) runs.push(run);
  }
  if (!isElement(node)) return;
  // A recovered Word equation lands as canonical OMML; the prepass charged its nodes.
  const equations = p.equations.get(node);
  if (equations !== undefined) {
    for (const equation of equations) runs.push(equation);
    return;
  }
  const tag = tagOf(node);
  if (IGNORED_TAGS.has(tag)) return;
  const style = parseInlineStyle(node);
  // Word's literal list marker never becomes text — but ONLY when the paragraph
  // projected `w:numPr` to replace it; otherwise the visible marker stays.
  if (isMsoListIgnoreMarker(node) && ctx.para.numPr !== undefined) return;
  const msoElement = style.get('mso-element')?.trim().toLowerCase();
  if (
    msoElement === 'comment-reference' ||
    style.get('mso-special-character')?.trim().toLowerCase() === 'comment' ||
    node.classList.contains('msocomanchor')
  ) {
    return;
  }
  // A note definition the notes pass consumed projects only there; landing it here
  // would duplicate the note text into the body. Unconsumed definitions descend
  // normally, so their text stays lossless.
  if (p.definedNoteElements.has(node)) return;
  if (tag === 'w:ptab') {
    const tab = htmlPositionalTabXml(node);
    if (tab.length > 0) runs.push(`<w:r>${rPrXml(ctx.run)}${tab}</w:r>`);
    return;
  }
  const tabContent = htmlTabRunContents(style.get('mso-tab-count'));
  if (tabContent.length > 0) {
    // Every synthesized tab past the first charges the walk budget: the repeat
    // count is clipboard-supplied, and one charged span must not amplify into
    // 64x output across a span flood.
    p.nodesLeft -= tabContent.split('<w:tab/>').length - 2;
    if (p.nodesLeft <= 0) {
      p.truncated = true;
      return;
    }
    // The tab run carries the SPAN's own formatting (an underlined leader keeps its
    // underline), not just the parent context's.
    const tabRun = applyRunCss(applyInlineTag(ctx.run, tag), style);
    runs.push(`<w:r>${rPrXml(tabRun)}${tabContent}</w:r>`);
    // Word's tab spans hold only spacer whitespace; an element with real content —
    // text OR element children like an image — keeps it after the tabs.
    if ((node.textContent ?? '').trim().length === 0 && node.children.length === 0) return;
  }
  if (tag === 'br') {
    const pageBreak =
      style.get('page-break-before')?.trim().toLowerCase() === 'always' ||
      style.get('break-before')?.trim().toLowerCase() === 'page';
    runs.push(`<w:r>${rPrXml(ctx.run)}${pageBreak ? '<w:br w:type="page"/>' : '<w:br/>'}</w:r>`);
    return;
  }
  if (tag === 'img') {
    projectHtmlImage(node, runs, p, (target) =>
      allocateRel(p, `${R_NS}/image`, target, false, ctx.rels ?? p.rels)
    );
    return;
  }
  // A tracked `<ins>` / `<del>` is a revision, not underline or strike formatting.
  const found = htmlRevisionOf(node, tag, p.wordHtml);
  // `w:del` cannot hold `w:ins`: an insertion inside a deletion is struck along with it.
  const nested = found?.kind === 'ins' && ctx.revisions?.some((open) => open.kind === 'del');
  const revision = nested ? null : found;
  let taggedRun = found === null ? applyInlineTag(ctx.run, tag) : ctx.run;
  const linkHref = tag === 'a' ? node.getAttribute('href') : null;
  const noteReference = tag === 'a' ? clipboardNoteReference(style) : null;
  if (noteReference === null && isClipboardHyperlink(linkHref)) {
    // The Hyperlink CHARACTER STYLE, not frozen direct formatting: the host's
    // theme and style definitions then control the link's look.
    taggedRun = { ...taggedRun, rStyle: 'Hyperlink' };
  }
  // Never mutate the shared context run: helpers return `base` by identity when idle.
  const nextRun = applyElementRunProps(taggedRun, node);
  const nextCtx: FlowContext = revisionContextOf(
    { ...ctx, run: nextRun, pre: ctx.pre || tag === 'pre' },
    node,
    style,
    revision
  );
  if (revision !== null) {
    const inner: string[] = [];
    for (const child of Array.from(node.childNodes)) {
      collectInline(child, depth + 1, nextCtx, inner, p);
    }
    for (const piece of wrapRevisionPieces(revision, inner)) runs.push(piece);
    return;
  }
  if (noteReference !== null) {
    // Word renders note marks superscript via a character style the fragment does
    // not carry; direct formatting keeps the number off the baseline — always.
    const markRun: RunProps = { ...nextCtx.run, vertAlign: 'superscript' };
    if (
      ctx.noteBody !== undefined &&
      ctx.noteBody.kind === noteReference.kind &&
      ctx.noteBody.id === noteReference.id
    ) {
      // The note's own number mark, inside its own body.
      const localName = noteReference.kind === 'footnote' ? 'footnoteRef' : 'endnoteRef';
      runs.push(`<w:r>${rPrXml(markRun)}<w:${localName}/></w:r>`);
      return;
    }
    // A live reference, in the body OR a cross-note citation inside another note's
    // body — the merge remaps note ids in note stories too.
    if (p.definedNotes[noteReference.kind].has(noteReference.id)) {
      const localName =
        noteReference.kind === 'footnote' ? 'footnoteReference' : 'endnoteReference';
      runs.push(`<w:r>${rPrXml(markRun)}<w:${localName} w:id="${noteReference.id}"/></w:r>`);
      // The anchor's visible number, kept as the strip fallback: if the note is
      // later dropped (budget) or moved, the mark degrades to this text instead
      // of vanishing — main pasted the literal '[1]' and so must we.
      const visible = (node.textContent ?? '').replace(/[ \t\r\n\f\v]+/g, ' ').trim();
      const markKey = `${noteReference.kind}:${noteReference.id}`;
      if (visible.length > 0 && !p.noteMarkFallbacks.has(markKey)) {
        p.noteMarkFallbacks.set(markKey, textRunXml(visible, markRun));
      }
      if (ctx.noteBody === undefined) {
        p.bodyNoteRefs[noteReference.kind].add(noteReference.id);
      } else {
        const from = `${ctx.noteBody.kind}:${ctx.noteBody.id}`;
        const edges = p.noteNoteRefs.get(from) ?? [];
        edges.push({ kind: noteReference.kind, id: noteReference.id });
        p.noteNoteRefs.set(from, edges);
      }
      return;
    }
    // A dangling reference (definition absent from the payload) keeps its visible
    // text ONLY: falling into the anchor branch would emit a hyperlink to a
    // bookmark that will never exist plus a stray `_ftnref` bookmark.
    for (const child of Array.from(node.childNodes)) {
      collectInline(child, depth + 1, nextCtx, runs, p);
    }
    return;
  }
  if (tag === 'a') {
    const href = node.getAttribute('href');
    const bookmarkName = clipboardBookmarkName(
      node.getAttribute('name') || node.getAttribute('id')
    );
    const inner: string[] = [];
    for (const child of Array.from(node.childNodes)) {
      collectInline(child, depth + 1, nextCtx, inner, p);
    }
    const anchor = href?.startsWith('#') ? clipboardBookmarkName(href.slice(1)) : null;
    let content = inner.join('');
    // A hyperlink cannot sit inside `w:ins` / `w:del`; the revisions go inside it instead.
    const linked = (): string =>
      nextCtx.revisions === undefined ? content : wrapInRevisions(nextCtx.revisions, content);
    if (anchor !== null) {
      content = `<w:hyperlink w:anchor="${escapeXmlAttribute(anchor)}">${linked()}</w:hyperlink>`;
    } else if (href !== null && !href.startsWith('#')) {
      // A fragment-only href never becomes an EXTERNAL relationship: Word treats
      // that target as a URI and the click errors. Unstorable fragment names are
      // mangled into bookmark names upstream, so this branch is URL-only.
      const sanitized = sanitizeHref(href);
      if (sanitized.ok && sanitized.href.length > 0) {
        const relId = allocateRel(p, `${R_NS}/hyperlink`, sanitized.href, true, ctx.rels ?? p.rels);
        content = `<w:hyperlink r:id="${relId}">${linked()}</w:hyperlink>`;
      }
    }
    if (bookmarkName !== null) {
      const id = String(p.nextBookmarkId++);
      content =
        `<w:bookmarkStart w:id="${id}" w:name="${escapeXmlAttribute(bookmarkName)}"/>` +
        `${content}<w:bookmarkEnd w:id="${id}"/>`;
    }
    if (content.length > 0) runs.push(content);
    return;
  }
  // An `<o:p>` inside a revision says the paragraph mark itself was inserted or deleted.
  if (tag === 'o:p' && ctx.revisions !== undefined) {
    p.markRevision = paragraphMarkRevisionXml(ctx.revisions);
  }
  for (const child of Array.from(node.childNodes)) {
    collectInline(child, depth + 1, nextCtx, runs, p);
  }
}

/** The styled flow context a paragraph-shaped element hands its children. */
function paragraphContextOf(
  element: Element,
  ctx: FlowContext,
  p: Projection,
  pageBreakBefore: boolean
): FlowContext {
  const tag = tagOf(element);
  const style = parseInlineStyle(element);
  const para: ParaProps = {};
  if (pageBreakBefore) para.pageBreakBefore = true;
  const styleId = wordParagraphStyleId(element, p.wordHtml);
  if (styleId !== undefined) para.styleId = styleId;
  if (ctx.para.numPr) para.numPr = ctx.para.numPr;
  if (ctx.para.jc) para.jc = ctx.para.jc;
  if (ctx.para.bidi) para.bidi = true;
  let run = { ...ctx.run };
  const heading = HEADING_SZ[tag];
  // `docx-outline` marks a DIRECT w:outlineLvl on otherwise plain text: the
  // writer's inline CSS already carries its real formatting, and the bold+size
  // heading fallback would mint bold the source never had.
  if (
    heading !== undefined &&
    styleId === undefined &&
    !element.classList.contains('docx-outline')
  ) {
    run.bold = true;
    run.szHalfPoints = heading;
  }
  const pre = ctx.pre || tag === 'pre';
  if (tag === 'pre') run.font = 'Courier New';
  const mso = msoListNumPr(element, style, p, ctx.noteBody);
  if (mso) para.numPr = mso;
  applyWordParagraphAlignment(para, element, p.classAlignments);
  applyParaCss(para, style);
  applyParagraphPropertyChange(para, element, style);
  // The background lands on BOTH the paragraph (w:pPr/w:shd) and its runs: the
  // single-paragraph inline paste path keeps only run content, so a run-level fill
  // is what survives a mid-paragraph paste.
  run = applyElementRunProps(run, element);
  if (element.getAttribute('dir')?.trim().toLowerCase() === 'rtl') {
    para.bidi = true;
  }
  return {
    run,
    para,
    // Only mark-defining properties (style, numbering) justify replacing the host
    // paragraph's mark on paste; incidental CSS (margins, alignment) must not force
    // the structural path for a plain single-paragraph snippet.
    paragraphMarkCovered: para.styleId !== undefined || para.numPr !== undefined,
    pre,
    list: ctx.list,
    ...(ctx.noteBody ? { noteBody: ctx.noteBody } : {}),
    ...(ctx.rels ? { rels: ctx.rels } : {}),
  };
}

function projectParagraph(
  element: Element,
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[],
  pageBreakBefore = false
): void {
  if (p.nodesLeft <= 0) {
    p.truncated = true;
    return;
  }
  if (depth > p.maxDepth) return;
  p.markRevision = null;
  const next = paragraphContextOf(element, ctx, p, pageBreakBefore);
  projectFlow(Array.from(element.childNodes), depth + 1, next, p, out, true, undefined, false);
}

function projectList(
  element: Element,
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[],
  pageBreakBefore = false
): void {
  if (p.nodesLeft <= 0) {
    p.truncated = true;
    return;
  }
  if (depth > p.maxDepth) return;
  p.nodesLeft -= 1;
  const kind = semanticHtmlListKind(element);
  // One numId per distinct top-level list; nested lists share their root's definition
  // and record their own format at their level.
  if (!ctx.list) p.semanticListCount += 1;
  const state: ListState = ctx.list
    ? { numId: ctx.list.numId, level: Math.min(ctx.list.level + 1, 8) }
    : {
        numId: allocateList(p, `sem:${p.semanticListCount}`, {
          kind,
          start: semanticHtmlListStart(element),
        }),
        level: 0,
      };
  if (ctx.list) {
    const allocation = p.listsByNumId.get(state.numId);
    if (allocation !== undefined && !allocation.levels.has(state.level)) {
      allocation.levels.set(state.level, { kind, start: semanticHtmlListStart(element) });
    }
  }
  const itemCtx: FlowContext = {
    ...ctx,
    list: state,
    para: { numPr: { numId: state.numId, ilvl: state.level } },
  };
  let pendingPageBreak = pageBreakBefore;
  for (const child of Array.from(element.childNodes)) {
    if (p.nodesLeft <= 0) {
      p.truncated = true;
      break;
    }
    if (!isElement(child)) continue;
    const childTag = tagOf(child);
    if (childTag === 'li') {
      // Each item charges the walk budget HERE (the flow loop is not involved), so
      // a flood of empty auto-closed `<li>`s cannot emit blocks at zero cost.
      p.nodesLeft -= 1;
      projectParagraph(child, depth + 1, itemCtx, p, out, pendingPageBreak);
      pendingPageBreak = false;
    } else if (childTag === 'ol' || childTag === 'ul') {
      const beforeNested = out.length;
      projectList(child, depth + 1, { ...ctx, list: state }, p, out, pendingPageBreak);
      if (out.length > beforeNested) pendingPageBreak = false;
    }
  }
}

type PageBreakState = { pending: boolean; skipSpacer: boolean };

function projectFlow(
  nodes: readonly Node[],
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[],
  forceEmit = false,
  pageBreakState?: PageBreakState,
  extractPageBreakBlocks = true
): void {
  if (depth > p.maxDepth) return;
  const before = out.length;
  const ownsPageBreakState = pageBreakState === undefined;
  let pending: string[] = [];
  // Furniture that preceded THIS flow's first block; it splices into the first
  // emitted paragraph's START after the walk, so a leading anchor targets the
  // position BEFORE the text it precedes.
  let leadingFurniture: string[] = [];
  // The context's own page-break-before is consumed by the FIRST emission only.
  let flushPara = ctx.para;
  const pageBreak = pageBreakState ?? { pending: false, skipSpacer: false };
  // A furniture-only paragraph never inherits the context's page break or list
  // item: it would double the break and mint a stray numbered ordinal.
  const furniturePara = (): ParaProps => ({
    ...flushPara,
    pageBreakBefore: undefined,
    numPr: undefined,
  });
  const flush = (): void => {
    if (pending.length === 0) return;
    if (!pending.some((piece) => piece.includes('<w:r') || isEquationPiece(piece))) {
      // Furniture-only pending (a standalone bookmark anchor): fold it into the
      // previous paragraph. Before this flow's first block it queues as LEADING
      // furniture; after a non-paragraph block (a table) it takes its own
      // paragraph NOW — queued, it would splice into the END of the next
      // paragraph, past the content.
      if (out.length === before) {
        leadingFurniture = leadingFurniture.concat(pending);
        pending = [];
        return;
      }
      const last = out[out.length - 1];
      if (last?.endsWith('</w:p>')) {
        out[out.length - 1] = `${last.slice(0, -6)}${pending.join('')}</w:p>`;
        pending = [];
      } else if (last !== undefined && pending.length > 0) {
        out.push(paragraphXml(furniturePara(), pending));
        pending = [];
        p.lastMarkCovered = false;
      }
      return;
    }
    // Bare inline text consumes a pending Word page break like a block would,
    // so the break lands BEFORE the text, not appended after it.
    const para = pageBreak.pending ? { ...flushPara, pageBreakBefore: true } : flushPara;
    out.push(paragraphXml(withMarkRevision(para, p), pending));
    if (flushPara.pageBreakBefore) flushPara = { ...flushPara, pageBreakBefore: undefined };
    pageBreak.pending = false;
    pageBreak.skipSpacer = false;
    p.lastMarkCovered = ctx.paragraphMarkCovered || p.markRevisionTaken;
    pending = [];
  };
  for (const node of nodes) {
    if (p.nodesLeft <= 0) {
      p.truncated = true;
      break;
    }
    if (isElement(node)) {
      const tag = tagOf(node);
      const blockSdtNodes = tag === 'w:sdt' ? wordBlockSdtNodes(node) : null;
      if (extractPageBreakBlocks && isWordPageBreakBlock(node)) {
        flush();
        p.nodesLeft -= 1;
        // Consecutive break blocks: materialize the earlier one so an intentionally
        // blank page survives instead of the two breaks collapsing into one.
        if (pageBreak.pending) appendPageBreak(out);
        pageBreak.pending = true;
        pageBreak.skipSpacer = true;
        continue;
      }
      // A recovered `<math>` is ignored markup only when it holds no equation.
      if (IGNORED_TAGS.has(tag) && !p.equations.has(node)) {
        p.nodesLeft -= 1;
        continue;
      }
      const elementStyle = parseInlineStyle(node);
      if (elementStyle.get('mso-element')?.trim().toLowerCase() === 'comment-list') {
        p.nodesLeft -= 1;
        continue;
      }
      // The note-list wrapper is transparent: collected definitions inside it are
      // skipped below (they re-emit through the notes pass), while definitions past
      // the collection caps project into the body — ugly but lossless.
      if (isClipboardNoteList(elementStyle)) {
        flush();
        p.nodesLeft -= 1;
        projectFlow(
          Array.from(node.childNodes),
          depth + 1,
          ctx,
          p,
          out,
          false,
          pageBreak,
          extractPageBreakBlocks
        );
        continue;
      }
      // A note definition the notes pass consumed projects only there; walking it
      // here would land the note text twice, once in the body.
      if (p.definedNoteElements.has(node)) {
        p.nodesLeft -= 1;
        continue;
      }
      if (PARAGRAPH_TAGS.has(tag)) {
        flush();
        p.nodesLeft -= 1;
        if (pageBreak.pending && pageBreak.skipSpacer && isWordPageBreakSpacer(node)) {
          pageBreak.skipSpacer = false;
          continue;
        }
        if (tag === 'div' && hasBlockChild(node)) {
          // Word's section wrapper (`WordSection1`): block flow continues through it,
          // so page-break extraction and the spacer state must survive the descent.
          // A break declared ON the wrapper carries to its first child paragraph.
          const wrapperCtx = paragraphContextOf(node, ctx, p, false);
          if (wrapperCtx.para.pageBreakBefore) pageBreak.pending = true;
          projectFlow(
            Array.from(node.childNodes),
            depth + 1,
            wrapperCtx,
            p,
            out,
            false,
            pageBreak,
            extractPageBreakBlocks
          );
          continue;
        }
        const beforeParagraph = out.length;
        projectParagraph(node, depth, ctx, p, out, pageBreak.pending);
        // The pending break is consumed only when the paragraph actually emitted;
        // a cap-truncated paragraph leaves it for the end-of-flow synthesis.
        if (out.length > beforeParagraph) {
          pageBreak.pending = false;
          pageBreak.skipSpacer = false;
        }
        continue;
      }
      if (tag === 'ol' || tag === 'ul') {
        flush();
        const beforeList = out.length;
        projectList(node, depth, ctx, p, out, pageBreak.pending);
        if (out.length > beforeList) {
          pageBreak.pending = false;
          pageBreak.skipSpacer = false;
        }
        continue;
      }
      if (tag === 'table') {
        flush();
        if (pageBreak.pending) appendPageBreak(out);
        projectTable(node, depth, ctx, p, out);
        pageBreak.pending = false;
        pageBreak.skipSpacer = false;
        continue;
      }
      // A span wrapping block children behaves as a block container (browsers do the
      // same for block-in-inline); flattened SDT wrappers rely on this transparency.
      if (
        CONTAINER_TAGS.has(tag) ||
        blockSdtNodes !== null ||
        (tag === 'span' && hasBlockChild(node))
      ) {
        flush();
        p.nodesLeft -= 1;
        projectFlow(
          blockSdtNodes ?? Array.from(node.childNodes),
          depth + 1,
          ctx,
          p,
          out,
          false,
          pageBreak,
          extractPageBreakBlocks
        );
        continue;
      }
    }
    // An inter-block text node of pure whitespace — NBSP included — is layout
    // chrome, never a paragraph of its own. NBSP INSIDE a paragraph's flow (real
    // pending runs exist) stays real content Word preserves.
    if (
      node.nodeType === 3 &&
      /^[\s\u00a0]+$/.test(node.nodeValue ?? '') &&
      isFurnitureOnly(pending)
    ) {
      p.nodesLeft -= 1;
      continue;
    }
    collectInline(node, depth, ctx, pending, p);
  }
  // An explicit paragraph holding only furniture (a bookmark in an empty <p>)
  // keeps its furniture: the fold-into-previous in flush() would land the anchor
  // one paragraph early and the forced paragraph would emit empty.
  if (
    forceEmit &&
    out.length === before &&
    pending.length > 0 &&
    !pending.some((piece) => piece.includes('<w:r') || isEquationPiece(piece))
  ) {
    out.push(paragraphXml(withMarkRevision(flushPara, p), pending));
    pending = [];
    p.lastMarkCovered = ctx.paragraphMarkCovered || p.markRevisionTaken;
  }
  flush();
  // Leading furniture splices into this flow's FIRST paragraph right after its
  // pPr, so a bookmark that preceded the content targets the position BEFORE
  // it; a non-paragraph first block gets a furniture paragraph ahead of it. This
  // runs AFTER the final flush — a bookmark-only flow moves its furniture here
  // during that flush, and resolving earlier would discard it.
  if (leadingFurniture.length > 0) {
    const first = out[before];
    if (first !== undefined && first.startsWith('<w:p>')) {
      out[before] = first.replace(
        /^(<w:p>(?:<w:pPr>(?:(?!<\/w:pPr>)[\s\S])*?<\/w:pPr>)?)/,
        `$1${leadingFurniture.join('')}`
      );
    } else if (first !== undefined) {
      out.splice(before, 0, paragraphXml(furniturePara(), leadingFurniture));
    } else {
      pending = leadingFurniture.concat(pending);
    }
    leadingFurniture = [];
  }
  // Furniture the fold could not place (previous block is a table, or nothing
  // followed) keeps its own paragraph — internal links point at these bookmarks.
  // It emits BEFORE a pending page break: the anchor preceded the break in the
  // source, and moving it past the break would land the link one page late.
  if (pending.length > 0) {
    out.push(paragraphXml(furniturePara(), pending));
    pending = [];
    p.lastMarkCovered = false;
  }
  if (ownsPageBreakState && pageBreak.pending) {
    appendPageBreak(out);
    pageBreak.pending = false;
    pageBreak.skipSpacer = false;
    p.lastMarkCovered = false;
  }
  // An explicit block emits its paragraph even when empty.
  if (forceEmit && out.length === before) {
    out.push(paragraphXml(withMarkRevision(flushPara, p), pending));
    pending = [];
    p.lastMarkCovered = ctx.paragraphMarkCovered || p.markRevisionTaken;
  }
}

// --- Tables (clipboard-html-table-project.ts owns the walk)

function projectTable(
  table: Element,
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[]
): void {
  projectHtmlTable(table, depth, ctx, p, out, projectFlow);
}

function assembleFragment(p: Projection, blocks: readonly string[]): Uint8Array {
  return writeProjectedHtmlPackage({
    blocks: withCompleteFields(blocks),
    rels: p.rels,
    lists: [...p.lists.values()],
    notes: withCompleteNoteFields(p.notes),
    noteRels: p.noteRels,
    media: p.media,
    mediaExtensions: p.mediaExtensions,
  });
}

type ProjectedBlocks =
  | { readonly ok: true; readonly projection: Projection; readonly blocks: string[] }
  | { readonly ok: false; readonly reason: 'too-large' | 'no-content' | 'parse-unavailable' };

/** The shared parse-and-walk half: everything up to (but not including) zip assembly. */
function projectBlocks(html: string, limits: HtmlProjectionLimits): ProjectedBlocks {
  const maxHtmlBytes = limits.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES;
  // UTF-16 length is a lower bound on UTF-8 bytes, so the cheap check refuses first;
  // borderline payloads get an exact byte count.
  if (html.length > maxHtmlBytes) return { ok: false, reason: 'too-large' };
  if (html.length * 3 > maxHtmlBytes) {
    const byteLength = new TextEncoder().encode(html).byteLength;
    if (byteLength > maxHtmlBytes) return { ok: false, reason: 'too-large' };
  }
  if (typeof DOMParser === 'undefined') return { ok: false, reason: 'parse-unavailable' };
  let parsed: Document;
  try {
    // The result stays detached. The bounded allowlist walker emits escaped XML only.
    // codeql[js/xss]
    parsed = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return { ok: false, reason: 'parse-unavailable' };
  }
  const body = parsed.body;
  if (!body) return { ok: false, reason: 'no-content' };
  const maxNodes = limits.maxNodes ?? DEFAULT_MAX_NODES;
  // Before any other pass: it unwraps equation comments and drops fallback pictures.
  const equations = hasWordEquationMarkup(html) ? prepareWordEquations(parsed, maxNodes) : null;

  const noteDefinitions = clipboardNoteDefinitions(parsed);
  const definedNotes: Record<ClipboardNoteKind, Set<number>> = {
    footnote: new Set(),
    endnote: new Set(),
  };
  const definedNoteElements = new Set<Element>();
  // Only definitions a body anchor actually references become notes; the rest stay
  // visible body text instead of unreachable note bodies.
  const referencedNotes: Record<ClipboardNoteKind, Set<number>> = {
    footnote: new Set(),
    endnote: new Set(),
  };
  collectReferencedNoteIds(parsed, noteDefinitions, referencedNotes);
  const projection: Projection = {
    nodesLeft: maxNodes - (equations?.visited ?? 0),
    maxDepth: limits.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxImageBytes: limits.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    wordHtml: isWordClipboardHtml(html),
    truncated: false,
    lastMarkCovered: false,
    markRevision: null,
    markRevisionTaken: false,
    rels: [],
    media: new Map(),
    mediaExtensions: new Map(),
    mediaBySrc: new Map(),
    lists: new Map(),
    listsByNumId: new Map(),
    semanticListCount: 0,
    imageCount: 0,
    docPrId: 0,
    nextBookmarkId: 1,
    classAlignments: wordClassAlignmentsFromDocument(parsed),
    listDefinitions: wordListDefinitionsFromStyleText(wordStyleTextFromDocument(parsed)),
    notes: { footnote: new Map(), endnote: new Map() },
    noteRels: { footnote: [], endnote: [] },
    definedNotes,
    bodyNoteRefs: { footnote: new Set(), endnote: new Set() },
    noteNoteRefs: new Map(),
    noteMarkFallbacks: new Map(),
    definedNoteElements,
    equations: equations?.byElement ?? new Map(),
  };
  let rootRun: RunProps = {};
  rootRun = applyElementRunProps(rootRun, parsed.documentElement);
  rootRun = applyElementRunProps(rootRun, body);
  const rootCtx: FlowContext = {
    run: rootRun,
    para: rootRun.rtl ? { bidi: true } : {},
    paragraphMarkCovered: false,
    pre: false,
    list: null,
  };
  // Claim (dedupe + reference-gate) and PRE-register the claimed elements, so an
  // outer definition's body walk skips a nested definition it does not own.
  const claimed: (typeof noteDefinitions)[number][] = [];
  for (const note of noteDefinitions) {
    if (!referencedNotes[note.kind].has(note.id)) continue;
    if (definedNotes[note.kind].has(note.id)) continue;
    definedNotes[note.kind].add(note.id);
    definedNoteElements.add(note.element);
    claimed.push(note);
  }
  // Project INNER definitions before their containers: if truncation un-claims the
  // tail, an un-claimed inner note then projects inside its outer's body (or the
  // document body) instead of being stranded by an already-projected outer.
  claimed.sort((a, b) => domDepthOf(b.element) - domDepthOf(a.element));
  // The BODY is the primary content: it walks first with the full budget. Notes
  // spend what remains; a starved note un-claims and its citations strip.
  projection.lastMarkCovered = false;
  const blocks: string[] = [];
  projectFlow(Array.from(body.childNodes), 0, rootCtx, projection, blocks);
  const bodyLastMarkCovered = projection.lastMarkCovered;
  const bodyTruncated = projection.truncated;
  let notesDropped = false;
  for (let index = 0; index < claimed.length; index += 1) {
    const note = claimed[index]!;
    projection.truncated = false;
    const budgetBeforeNote = projection.nodesLeft;
    const noteBlocks: string[] = [];
    projectFlow(
      Array.from(note.element.childNodes),
      0,
      {
        ...rootCtx,
        noteBody: { kind: note.kind, id: note.id },
        rels: projection.noteRels[note.kind],
      },
      projection,
      noteBlocks,
      true
    );
    if (projection.truncated || noteBlocks.length === 0) {
      // The leftover budget starved this walk mid-note: un-claim this and every
      // remaining definition so no live reference points at a blank note, then
      // strip every dropped citation from body and kept-note blocks.
      notesDropped = true;
      const droppedKeys = new Set<string>();
      for (let drop = index; drop < claimed.length; drop += 1) {
        const dropped = claimed[drop]!;
        definedNotes[dropped.kind].delete(dropped.id);
        definedNoteElements.delete(dropped.element);
        projection.notes[dropped.kind].delete(dropped.id);
        projection.bodyNoteRefs[dropped.kind].delete(dropped.id);
        droppedKeys.add(`${dropped.kind}:${dropped.id}`);
      }
      if (droppedKeys.size > 0) {
        for (let at = 0; at < blocks.length; at += 1) {
          blocks[at] = stripNoteMarks(blocks[at]!, droppedKeys, projection.noteMarkFallbacks);
        }
        for (const keptKind of ['footnote', 'endnote'] as const) {
          for (const [keptId, keptBlocks] of projection.notes[keptKind]) {
            projection.notes[keptKind].set(
              keptId,
              keptBlocks.map((block) =>
                stripNoteMarks(block, droppedKeys, projection.noteMarkFallbacks)
              )
            );
          }
        }
      }
      // The body walk skipped the claimed divs, so their text lives NOWHERE yet.
      // Refund exactly what the failed walk consumed and re-project the dropped
      // definitions as body flow — partial text beats none, and the refund keeps
      // the total bounded by what was already charged.
      projection.nodesLeft = budgetBeforeNote;
      for (let drop = index; drop < claimed.length && projection.nodesLeft > 0; drop += 1) {
        projectFlow(Array.from(claimed[drop]!.element.childNodes), 0, rootCtx, projection, blocks);
      }
      break;
    }
    projection.notes[note.kind].set(note.id, noteBlocks);
  }
  // A dropped note is real loss, so it keeps the truncation flag raised.
  projection.truncated = bodyTruncated || notesDropped;
  projection.lastMarkCovered = bodyLastMarkCovered;
  reconcileUnreachableNotes(projection, definedNotes, blocks, allocateRel);
  if (blocks.length === 0) return { ok: false, reason: 'no-content' };
  numberProjectedRevisionIds(blocks, projection.notes);
  return { ok: true, projection, blocks };
}

const projectionMemo = createGestureMemo<ProjectedBlocks>();

function projectBlocksMemoized(html: string, limits: HtmlProjectionLimits): ProjectedBlocks {
  const limitsKey = `${limits.maxHtmlBytes ?? ''}:${limits.maxNodes ?? ''}:${limits.maxDepth ?? ''}:${limits.maxImageBytes ?? ''}`;
  return projectionMemo(html, limitsKey, () => projectBlocks(html, limits));
}

/** Project external `text/html` into a bounded WordprocessingML fragment package. */
export function projectExternalHtml(
  html: string,
  limits: HtmlProjectionLimits = {}
): HtmlProjectionResult {
  const projected = projectBlocksMemoized(html, limits);
  if (!projected.ok) return projected;
  return {
    ok: true,
    fragmentBytes: assembleFragment(projected.projection, projected.blocks),
    lastMarkCovered: projected.projection.lastMarkCovered,
    imageCount: projected.projection.imageCount,
    truncated: projected.projection.truncated,
  };
}

/** Probe projected content without paying for zip assembly. */
export function probeExternalHtml(
  html: string,
  limits: HtmlProjectionLimits = {}
): { readonly lands: boolean; readonly imageCount: number; readonly truncated: boolean } {
  const projected = projectBlocksMemoized(html, limits);
  if (!projected.ok) return { lands: false, imageCount: 0, truncated: false };
  return {
    lands: true,
    imageCount: projected.projection.imageCount,
    truncated: projected.projection.truncated,
  };
}
