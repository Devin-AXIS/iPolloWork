// The surface's hyperlink lane (paginated-surface seam).
//
// Insert, retarget, unlink and "what link is the caret in" — every one expressed as ONE
// `transact` so it is one undo step, which is what makes editing a URL feel like editing a
// word rather than like a script that ran.
//
// The trust boundary stays where it was. A URL arriving here is HOST-supplied (a popover
// input, an agent call) and is written to the package only through
// `session.ensureHyperlinkRelationship`, which refuses anything `sanitizeHref` refuses. What
// comes BACK — for the popover to show, for a click to open — is always the sanitized
// projection layout already resolved, never the authored string.

import {
  fromHyphenGlyphs,
  inlineCharacterTextOf,
  withHyphenGlyphs,
} from '../store/package/hyphen-text.ts';
import { relationshipTargetIn, storyParagraphs, storyRootsOf } from '@docx-editor.dev/core/store';
import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import {
  hardBreakText,
  hyperlinkTargetOf,
  isInstrText,
  paragraphOffsetIndex,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
  type StoryScope,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import {
  isInlineRunContainer,
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
} from '../store/package/ooxml-shared.ts';
import {
  fragmentsOfParagraph,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core/layout';

import { paragraphDeletedRanges } from '../layout/paragraph-lines.ts';
import { caretWordSelection } from '../layout/caret-word.ts';
import { hyperlinkStyleFor } from '../store/package/hyperlink-style-edit.ts';

/** WordprocessingML, for the demoted controls the reader preserves as generic nodes. */
const WML = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * A content control, typed or DEMOTED.
 *
 * A `w:sdt` the reader could not type — properties after `w:sdtContent`, say — is preserved
 * as a generic node, and the shared offset walk still counts its text. Matching only the
 * typed kind here reported a link with the right span and an EMPTY label, because the walk
 * that gathers the text stopped at the wrapper the offsets had already descended.
 */
function isContentControl(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  if ((node as { kind: string }).kind === 'contentControl') return true;
  return node.kind === 'generic' && node.localName === 'sdt' && node.namespaceUri === WML;
}

function isContentControlContent(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  if ((node as { kind: string }).kind === 'contentControlContent') return true;
  return node.kind === 'generic' && node.localName === 'sdtContent' && node.namespaceUri === WML;
}

/**
 * A hyperlink as the surface reports it: its identity, where it sits, and the SANITIZED
 * target. `href: null` is an inert link — a refused scheme or a dangling relationship — which
 * a UI shows and offers to edit but must never offer to open.
 */
export interface SurfaceHyperlink {
  /** Canonical node id of the `w:hyperlink`. */
  readonly id: string;
  readonly paragraphId: string;
  /** UTF-16 range of the link's display text within its paragraph. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly kind: 'external' | 'internal' | 'unresolved';
  /** Sanitized projection: an absolute URL, `#anchor`, or null when inert. */
  readonly href: string | null;
  /** The authored target, for an editor to seed its input with. */
  readonly authored: string;
  readonly anchor?: string;
  readonly tooltip?: string;
}

function elementChildren(node: OoxmlNode): readonly OoxmlNode[] {
  return node.kind === 'textValue' ? [] : node.children;
}

/**
 * The LIVE display text under a link: what survives once pending deletions resolve.
 *
 * A raw offset slice spans struck runs too, so retargeting a link in suggesting mode made
 * the popover prefill with the struck old text glued to its replacement. Instruction text
 * is code, not content, on the same terms `review-reads` states — `isInstrText` covers the
 * typed kind, the parse-demoted generic, and `w:delInstrText`.
 */
function liveTextUnder(node: OoxmlNode, depth = 0): string {
  if (node.kind === 'textValue') return node.value;
  if (depth >= MAX_INLINE_CONTAINER_DEPTH) return '';
  if (node.kind === 'deletedText' || isContentRevisionDeletion(node.kind)) return '';
  if (isInstrText(node) || node.kind === 'runProperties') return '';
  // A demoted content control is transparent to the offset walk, so it must be transparent
  // here too, or the link's label comes back empty for a span the offsets say has text.
  const hyphen = inlineCharacterTextOf(node);
  if (hyphen !== null) return hyphen;
  if (node.kind === 'generic' && !isInlineRunContainer(node) && !isContentControl(node)) return '';
  if (node.kind === 'tab') return '\t';
  if (node.kind === 'hardBreak') return hardBreakText(node);
  const next = nextInlineContainerDepth(node, depth);
  let text = '';
  for (const child of node.children) text += liveTextUnder(child, next);
  return text;
}

/** The two content revision kinds whose content is on its way OUT. */
function isContentRevisionDeletion(kind: string): boolean {
  return kind === 'revisionDelete' || kind === 'revisionMoveFrom';
}

/** Walk inline children in order, recursing through links and typed inline controls. */
function walkInlineChildren(
  children: readonly OoxmlNode[],
  depth: number,
  visit: (child: OoxmlNode, depth: number) => void
): void {
  if (depth >= MAX_INLINE_CONTAINER_DEPTH) return;
  for (const child of children) {
    if (child.kind === 'hyperlink') {
      if (nextInlineContainerDepth(child, depth) < MAX_INLINE_CONTAINER_DEPTH) {
        visit(child, depth);
      }
      continue;
    }
    // Transparent, so a link a tracked edit wraps is still found and reported in order.
    // Depth-counted like every descent here: wrapper nesting is file-derived.
    if (isInlineRunContainer(child)) {
      walkInlineChildren(elementChildren(child), nextInlineContainerDepth(child, depth), visit);
      continue;
    }
    if (isContentControl(child)) {
      for (const inner of elementChildren(child)) {
        if (!isContentControlContent(inner)) continue;
        walkInlineChildren(elementChildren(inner), nextInlineContainerDepth(child, depth), visit);
      }
      continue;
    }
    visit(child, depth);
  }
}

/**
 * Every typed hyperlink in one paragraph, with the offsets it covers.
 *
 * Offsets come from `segmentsOf` — THE offset authority — never from a private length walk.
 * The lane used to keep its own accumulator, and it disagreed with the model on exactly the
 * shapes suggesting mode writes: a complex field counted its instruction characters instead
 * of one atom unit, so every link after a tracked page field read back misplaced, and the
 * popover opened on the wrong words.
 */
export function hyperlinksInParagraph(
  part: OoxmlPart,
  paragraphId: string,
  resolve: (relationshipId: string) => { target: string; external: boolean } | null
): SurfaceHyperlink[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  // Memoized on paragraph identity, with a span per node — links included — so this read
  // costs one lookup per child instead of a subtree scan against every segment.
  const offsets = paragraphOffsetIndex(paragraph as OoxmlParagraphNode);
  const found: SurfaceHyperlink[] = [];
  // The walk position so far: it is only read for a link whose content owns no offsets.
  let cursor = 0;
  walkInlineChildren(paragraph.children, 0, (child, depth) => {
    const span = offsets.spanOf(child);
    if (span) cursor = Math.max(cursor, span.end);
    if (child.kind !== 'hyperlink') return;
    // An authored EMPTY link still needs an address, or the popover cannot open on it and
    // `removeHyperlink` cannot take it out: it reports zero-length at the walk position.
    const start = span ? span.start : cursor;
    const end = span ? span.end : cursor;
    const target = hyperlinkTargetOf(child, resolve);
    found.push({
      id: child.id,
      paragraphId,
      start,
      end,
      // The label a person edits: visible hyphens, never the model's control characters.
      text: withHyphenGlyphs(liveTextUnder(child, depth)),
      kind: target.kind,
      href: target.href,
      authored: target.authored,
      ...(target.anchor !== undefined ? { anchor: target.anchor } : {}),
      ...(target.tooltip !== undefined ? { tooltip: target.tooltip } : {}),
    });
  });
  return found;
}

/** A node by id, without importing the store's private walk. */
function findNode(part: OoxmlPart, nodeId: string): OoxmlNode | null {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return node.id === nodeId ? node : null;
    if (node.id === nodeId) return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(part.root);
}

/**
 * The link a position sits in, or null.
 *
 * INCLUSIVE OF BOTH EDGES, deliberately. A caret at the very end of a link is still "in" it
 * for the purposes of Ctrl+K and the popover, because that is where the caret lands after
 * clicking the last character — and Word treats it the same way. It is NOT inclusive for
 * typing (that is the ops' business, and they append outside the link, as Word does).
 */
export function hyperlinkAtPosition(
  links: readonly SurfaceHyperlink[],
  position: SemanticPosition
): SurfaceHyperlink | null {
  for (const link of links) {
    if (link.paragraphId !== position.paragraphId) continue;
    if (position.offset >= link.start && position.offset <= link.end) return link;
  }
  return null;
}

/**
 * The painted field link whose atom the position sits on, or null.
 *
 * A `HYPERLINK` field has no `w:hyperlink` node, so the typed lane above can never resolve it.
 * It paints as ONE atom span over `[start, start + 1)` carrying `fieldAtom` and `link`. This
 * walks the caret paragraph's laid-out fragments for that span and returns its link id.
 *
 * INCLUSIVE OF BOTH EDGES (`start <= offset <= end`), the same rule field shading uses: a field
 * is one model unit, and the click that opens the reading panel lands the caret on a boundary.
 * An exclusive test would report "the caret left the field" on the very tick after the opening
 * click and self-close the panel.
 *
 * Two known edges, both narrow and left unhandled on purpose: at a boundary shared by two
 * adjacent field atoms the first span in line order wins (left-biased), and the walk covers
 * only body fragments — a field link inside a header/footer or note story does not resolve here
 * (headers/footers never open the panel anyway; note-story links share the typed lane's own
 * body-caret limitation).
 */
export function fieldLinkAtomIdAtPosition(
  layout: SemanticLayout,
  position: SemanticPosition
): string | null {
  for (const fragment of fragmentsOfParagraph(layout, position.paragraphId)) {
    for (const line of fragment.lines) {
      for (const span of line.spans) {
        if (!span.fieldAtom || !span.link) continue;
        if (position.offset >= span.range.start && position.offset <= span.range.end) {
          return span.link.id;
        }
      }
    }
  }
  return null;
}

export interface HyperlinkOpsDeps {
  readonly session: TreeDocxSessionView;
  /** In a collaboration session, a new link never creates the styles part. */
  readonly collaborative?: boolean;
  /** The current layout projection, for resolving a field link at the caret. */
  readonly layout: () => SemanticLayout;
  /** Resolve a field-link id minted by the field-link registry back to its record. */
  readonly fieldLinkById: (linkId: string) => SurfaceHyperlink | null;
  /**
   * Whether a write would be refused right now — viewing, or suggesting with no author.
   *
   * The session this lane holds is already gated, so the OPS cannot slip through. The relationship
   * can: it is minted on the package before the transaction, outside the undo stack, and a refused
   * commit does not take it back. Asking first is what keeps a read-only document byte-identical.
   */
  readonly refusesWrite: () => boolean;
  /**
   * Bind the collaboration actor around the relationship mint below.
   *
   * The mint runs OUTSIDE the store transaction, so the actor a transaction would have bound
   * for it is not set. Without one, two collaborators inserting a link at the same moment both
   * take `rId${max + 1}` and share a single relationship id — a collision no CRDT can see,
   * because the tree converges and only the id namespace is wrong. Absent (solo editing), the
   * mint keeps Word's dense sequence.
   */
  readonly withMintActor?: <T>(mint: () => T) => T;
  /** Active story for reads/writes — body, header/footer, or notes part. */
  storyScope(): StoryScope;
  /**
   * Where a replacement for `[start, end)` of one paragraph lands in SUGGESTING mode, or
   * null outside it.
   *
   * Non-null switches link creation over a selection to a tracked replace: the covered
   * words are struck in place, a fresh copy of the display text is inserted after them as
   * this author's proposal, and the `w:hyperlink` wraps only that copy. A plain wrap wrote
   * an unattributed edit — a link Accept/Reject could not act on — into a document whose
   * author believed everything they did was a proposal.
   */
  readonly replacementLanding?: (paragraphId: string, start: number, end: number) => number | null;
  /**
   * Where an insertion aimed at `offset` actually lands, in EVERY mode: past the deletion
   * the caret rests in. Both insert appliers relocate beside a `w:del` rather than into
   * it, so a link wrap built on the raw caret offset sliced the deletion its display text
   * had landed beyond.
   */
  readonly insertionLanding?: (paragraphId: string, offset: number) => number;
  readonly selection: () => SemanticSelection;
  readonly orderedRange: () => { from: SemanticPosition; to: SemanticPosition };
  readonly selectionMark: () => { paragraphId: string; start: number; end: number } | null;
  readonly textOf: (paragraphId: string) => string;
  readonly commit: (
    run: () => TreeApplyResult | boolean,
    selectionAfter?: () => SemanticSelection | null
  ) => void;
}

/**
 * Reading and writing hyperlinks on the surface.
 *
 * Every href that leaves here has already been through `sanitizeHref` — targets come from files,
 * so `javascript:`, `data:` and `vbscript:` are dropped at the parse boundary rather than trusted
 * to be filtered by whoever renders them.
 */
export interface HyperlinkOps {
  /** Every link in the paragraph the caret is in. */
  linksInCaretParagraph(): SurfaceHyperlink[];
  /** The link the caret sits in, or null. */
  linkAtCaret(): SurfaceHyperlink | null;
  /**
   * The FIELD link whose painted atom the caret sits on, or null.
   *
   * Separate from {@link linkAtCaret} on purpose: a `HYPERLINK` field is not a tree node, so
   * the typed lane never returns one, and link-create must not mistake a field atom for an
   * editable link. Resolved from the layout projection, boundary-inclusive.
   */
  fieldLinkAtCaret(): SurfaceHyperlink | null;
  /** The link with this node id, or null. */
  linkById(linkId: string): SurfaceHyperlink | null;
  /**
   * Whether every character the selection covers is a pending tracked deletion.
   *
   * A link panel opened over live words reads this to learn that a peer struck those words in
   * suggesting mode: the selected text is unchanged, but it is about to leave the document.
   *
   * Reads the laid-out deletions, so it is true in All Markup and Original views. In Simple
   * Markup and No Markup the struck text is hidden and the selection holds none of it, so it
   * returns false; there the selected text itself changes, and a text comparison catches the
   * strike instead. False for a caret and for a selection that spans paragraphs.
   */
  selectionIsPendingDeletion(): boolean;
  /**
   * The word a new link takes when the caret is collapsed inside it, or null.
   *
   * A link panel opened at such a caret selects this word first, so the word becomes the
   * display text and the linked text. Null at a word edge, in a link, inside tracked deleted
   * text, and for a range selection. Inside means the same as for formatting at the caret.
   */
  wordAtCaret(): { readonly from: SemanticPosition; readonly to: SemanticPosition } | null;
  /**
   * Apply a link to the selection, or retarget the one the caret is already in.
   *
   * `text` replaces the display text when supplied. Returns whether anything committed;
   * a refusal leaves the document exactly as it was.
   */
  applyHyperlink(input: {
    readonly url?: string;
    readonly anchor?: string;
    readonly text?: string;
    readonly tooltip?: string;
  }): boolean;
  /** Take the link off the one at the caret (or a named one). Returns whether it committed. */
  removeHyperlink(linkId?: string): boolean;
}

export function createHyperlinkOps(deps: HyperlinkOpsDeps): HyperlinkOps {
  const scope = () => deps.storyScope();
  const storyPart = (): OoxmlPart | null => deps.session.partFor(scope());
  const resolve = (relationshipId: string) =>
    deps.session.relationshipTarget(relationshipId, scope());
  const applyOps = (
    ops: Parameters<TreeDocxSessionView['applyTreeOps']>[0],
    before?: Parameters<TreeDocxSessionView['applyTreeOps']>[1],
    after?: Parameters<TreeDocxSessionView['applyTreeOps']>[2],
    packageEdits?: NonNullable<Parameters<TreeDocxSessionView['applyTreeOps']>[4]>['packageEdits']
  ) =>
    deps.session.applyTreeOps(
      ops,
      before,
      after,
      scope(),
      packageEdits?.length ? { packageEdits } : undefined
    );

  const linksIn = (paragraphId: string): SurfaceHyperlink[] => {
    const part = storyPart();
    if (!part) return [];
    return hyperlinksInParagraph(part, paragraphId, resolve);
  };

  const linkAtCaret = (): SurfaceHyperlink | null =>
    hyperlinkAtPosition(linksIn(deps.selection().head.paragraphId), deps.selection().head);

  const fieldLinkAtCaret = (): SurfaceHyperlink | null => {
    const head = deps.selection().head;
    const id = fieldLinkAtomIdAtPosition(deps.layout(), head);
    return id === null ? null : deps.fieldLinkById(id);
  };

  const linkById = (linkId: string): SurfaceHyperlink | null => {
    // The link's own paragraph is the one holding it; walking the caret's paragraph first
    // covers every real caller in one lookup, and the full scan is the fallback.
    const caretParagraph = deps.selection().head.paragraphId;
    const near = linksIn(caretParagraph).find((link) => link.id === linkId);
    if (near) return near;

    // EVERY STORY, each read through its OWN part. The fallback used to scan the paragraphs of
    // whatever story was open, so a reader in the body who clicked a link painted in a header
    // got null — and the popover that lets you follow or edit the link never opened. The link
    // is in the story it is in, not in the one the reader happens to be standing in.
    for (const part of deps.session.storyParts()) {
      // Resolved against the part the link is IN, not the open story's. The relationship a
      // header link names lives in `header1.xml.rels`, so resolving it through the reader's
      // story found the link and then handed back a null `href` — the popover would have
      // opened on a link with nowhere to go.
      const resolveHere = (relationshipId: string) =>
        relationshipTargetIn(deps.session.currentPackage(), part.name, relationshipId);
      for (const story of storyRootsOf(part)) {
        for (const paragraph of storyParagraphs(story.root)) {
          const paragraphId = paragraph.id;
          const found = hyperlinksInParagraph(part, paragraphId, resolveHere).find(
            (link) => link.id === linkId
          );
          if (found) return found;
        }
      }
    }
    return null;
  };

  // A positional read from the layout's deleted ranges; it settles nothing, so it is safe on
  // every editor update. Adjacent deletions are merged, so struck words by two authors count.
  const selectionIsPendingDeletion = (): boolean => {
    const { anchor, head } = deps.selection();
    if (anchor.paragraphId !== head.paragraphId || anchor.offset === head.offset) return false;
    const start = Math.min(anchor.offset, head.offset);
    const end = Math.max(anchor.offset, head.offset);
    return paragraphDeletedRanges(deps.layout(), head.paragraphId).some(
      (range) => range.start <= start && end <= range.end
    );
  };

  return {
    linksInCaretParagraph: () => linksIn(deps.selection().head.paragraphId),
    linkAtCaret,
    fieldLinkAtCaret,
    linkById,
    selectionIsPendingDeletion,

    wordAtCaret() {
      if (linkAtCaret() || fieldLinkAtCaret()) return null;
      return caretWordSelection(deps.layout(), deps.selection());
    },

    applyHyperlink(requested) {
      // Labels are shown and selected with visible hyphens; they write the hyphen elements.
      const input =
        requested.text === undefined
          ? requested
          : { ...requested, text: fromHyphenGlyphs(requested.text) };
      const wantsExternal = input.url !== undefined && input.url.length > 0;
      const wantsInternal = input.anchor !== undefined && input.anchor.length > 0;
      // Exactly one target, matching the op's own rule — a caller that supplies both does
      // not know which it wants, and picking one for it writes a link nobody chose.
      if (wantsExternal === wantsInternal) return false;

      // Refuse before minting when the active story cannot be resolved: a scoped insert that
      // fell back to the body would leave a stray main-document relationship behind. And refuse
      // before minting when the MODE would refuse the edit, for the same reason: the relationship
      // outlives the refusal that the ops do not survive.
      const active = scope();
      if (!storyPart() || deps.refusesWrite()) return false;

      // The relationship is minted BEFORE the transaction: it lives on the package, outside
      // the undo stack, and a refused URL must not leave a half-applied edit behind.
      let relationshipId: string | undefined;
      if (wantsExternal) {
        const mint = (): string | null =>
          deps.session.ensureHyperlinkRelationship(input.url!, active);
        const minted = deps.withMintActor ? deps.withMintActor(mint) : mint();
        if (!minted) return false;
        relationshipId = minted;
      }
      const target = {
        ...(relationshipId !== undefined ? { relationshipId } : {}),
        ...(wantsInternal ? { anchor: input.anchor! } : {}),
        ...(input.tooltip !== undefined ? { tooltip: input.tooltip } : {}),
      };

      const existing = linkAtCaret();
      const range = deps.orderedRange();
      const collapsed =
        range.from.paragraphId === range.to.paragraphId && range.from.offset === range.to.offset;

      // RETARGET when the caret is inside a link and the selection adds nothing: this is
      // Ctrl+K on an existing link, and replacing the element would throw away its authored
      // `w:history` / `w:tgtFrame` and its identity.
      if (existing && (collapsed || withinLink(existing, range))) {
        const ops: TreeDocOp[] = [];
        let retargetEdits: Parameters<typeof applyOps>[3];
        // Replacing the display text is a delete plus an insert over the link's own range;
        // both land inside the link because the range is strictly inside it.
        if (input.text !== undefined && input.text !== fromHyphenGlyphs(existing.text)) {
          if (input.text.length === 0) return false;
          const landing = deps.replacementLanding?.(
            existing.paragraphId,
            existing.start,
            existing.end
          );
          // The interior aim must not split a surrogate pair: a link whose display text
          // begins with an astral character made `start + 1` an illegal offset, the store
          // refused the transaction, and the rename silently did nothing.
          const head = deps.textOf(existing.paragraphId).slice(existing.start, existing.start + 2);
          const interiorAim =
            existing.start +
            (head.length === 2 &&
            head.charCodeAt(0) >= 0xd800 &&
            head.charCodeAt(0) <= 0xdbff &&
            head.charCodeAt(1) >= 0xdc00 &&
            head.charCodeAt(1) <= 0xdfff
              ? 2
              : 1);
          if (
            landing !== null &&
            landing !== undefined &&
            landing > existing.start &&
            interiorAim < existing.end
          ) {
            // SUGGESTING strikes first and lands the replacement after the struck words,
            // INSIDE the link. The insert aims at an INTERIOR offset of the struck text:
            // the store's interior rule places it after the deletion inside the container
            // that holds it, deterministically. Aiming at the link's end boundary relied
            // on adjacent-deletion adoption, and a pre-existing strike abutting the link's
            // closing edge joined that adoption, put the copy past the link, and accepting
            // swept the emptied link — the renamed text came out silently unlinked.
            ops.push(
              { op: 'setHyperlinkTarget', linkId: existing.id, ...target },
              {
                op: 'deleteText',
                paragraphId: existing.paragraphId,
                start: existing.start,
                end: existing.end,
              },
              {
                op: 'insertText',
                paragraphId: existing.paragraphId,
                offset: interiorAim,
                text: input.text,
              }
            );
          } else if (landing !== null && landing !== undefined) {
            // No interior offset to aim at: the whole display text is this author's own
            // pending insertion (the strike retracts it physically and the emptied link is
            // swept mid-transaction — nothing left to retarget), or it is a single unit.
            // A copy left bare comes out unlinked once the strikes are accepted — so
            // propose a FRESH link over the copy, and still retarget the old one in case
            // a zero-length marker keeps it alive.
            const style = hyperlinkStyleFor(deps.session.currentPackage(), {
              createPart: !deps.collaborative,
            });
            if (style.edit) retargetEdits = [style.edit];
            ops.push(
              { op: 'setHyperlinkTarget', linkId: existing.id, ...target },
              ...suggestReplaceOps(existing, landing, input.text),
              {
                op: 'insertHyperlink',
                paragraphId: existing.paragraphId,
                start: landing,
                end: landing + input.text.length,
                ...target,
                ...(style.styleId ? { styleId: style.styleId } : {}),
              }
            );
          } else {
            const replaced = replaceTextOps(
              existing.paragraphId,
              existing.start,
              existing.end,
              input.text
            );
            if (!replaced) return false;
            ops.push({ op: 'setHyperlinkTarget', linkId: existing.id, ...target }, ...replaced);
          }
        } else {
          // A target-only retarget stays untracked in every mode: OOXML has no revision
          // element for a hyperlink's target, and Word applies the same edit directly even
          // with tracking on. The display text is what review can carry.
          ops.push({ op: 'setHyperlinkTarget', linkId: existing.id, ...target });
        }
        let committed = false;
        deps.commit(
          () => {
            const result = applyOps(ops, deps.selectionMark(), undefined, retargetEdits);
            committed = result.committed;
            return result;
          },
          () => null
        );
        return committed;
      }

      // INSERT. A collapsed caret has no text to wrap, so the display text — the URL itself
      // when the caller supplied none — is inserted first and then wrapped, in one
      // transaction. That is Word's behaviour and it is what makes Ctrl+K on an empty caret
      // produce a usable link rather than nothing at all.
      const paragraphId = range.from.paragraphId;
      if (range.to.paragraphId !== paragraphId) return false; // a link cannot span paragraphs
      const ops: TreeDocOp[] = [];
      let start = range.from.offset;
      let end = range.to.offset;

      if (collapsed) {
        const display = input.text ?? input.url ?? input.anchor ?? '';
        if (display.length === 0) return false;
        // A caret resting in struck words relocates past the deletion before it inserts —
        // the rule BOTH insert appliers follow, tracked and untracked — so the wrap must
        // cover the SAME landing. Raw offsets committed a link that sliced the deletion
        // the display text had actually landed beyond.
        start = deps.insertionLanding?.(paragraphId, start) ?? start;
        ops.push({ op: 'insertText', paragraphId, offset: start, text: display });
        end = start + display.length;
      } else {
        const landing = deps.replacementLanding?.(paragraphId, start, end);
        if (landing !== null && landing !== undefined) {
          // SUGGESTING proposes the link as a replacement, because a bare wrap of somebody
          // else's words is an edit no review card can carry. The selection is struck in
          // place (it stays, as every suggested deletion does), a copy of the display text
          // lands after it as this author's tracked insertion — Word's struck-then-
          // replacement reading order — and the `w:hyperlink` wraps only that copy.
          // Rejecting the pair restores the original words and sweeps the emptied link.
          // The attribution itself rides in on the surface's op interception, the same
          // lane every keystroke takes.
          const display = input.text ?? deps.textOf(paragraphId).slice(start, end);
          if (display.length === 0) return false;
          ops.push(...suggestReplaceOps({ paragraphId, start, end }, landing, display));
          start = landing;
          end = landing + display.length;
        } else if (
          input.text !== undefined &&
          input.text !== deps.textOf(paragraphId).slice(start, end)
        ) {
          const replaced = replaceTextOps(paragraphId, start, end, input.text);
          if (!replaced) return false;
          ops.push(...replaced);
          end = start + input.text.length;
        }
      }
      if (end <= start) return false;
      // A new link's text takes the `Hyperlink` CHARACTER STYLE; without it the link looks
      // like the words around it and nothing shows that the command worked. The op carries
      // the style, so wrapping and marking are one step and one undo. A document that does
      // not define the style gets the built-in definition in the same transaction, so the
      // reference never dangles. The definition is document setup: in a collaboration
      // session it commits outside shared undo (see `surface-journaled-apply.ts`).
      const { styleId, edit } = hyperlinkStyleFor(deps.session.currentPackage(), {
        createPart: !deps.collaborative,
      });
      const packageEdits = edit ? [edit] : undefined;
      ops.push({
        op: 'insertHyperlink',
        paragraphId,
        start,
        end,
        ...target,
        ...(styleId ? { styleId } : {}),
      });

      let committed = false;
      const after = { paragraphId, offset: end };
      deps.commit(
        () => {
          const result = applyOps(
            ops,
            deps.selectionMark(),
            { paragraphId, start: end, end },
            packageEdits
          );
          committed = result.committed;
          return result;
        },
        () => ({ anchor: after, head: after })
      );
      return committed;
    },

    removeHyperlink(linkId) {
      if (!storyPart()) return false;
      const link = linkId ? linkById(linkId) : linkAtCaret();
      if (!link) return false;
      let committed = false;
      // The caret stays where the text is: unlinking must not move it, because the user's
      // next keystroke is aimed at the word they were just looking at.
      const after = { paragraphId: link.paragraphId, offset: link.end };
      deps.commit(
        () => {
          const result = applyOps(
            [{ op: 'removeHyperlink', linkId: link.id }],
            deps.selectionMark()
          );
          committed = result.committed;
          return result;
        },
        () => ({ anchor: after, head: after })
      );
      return committed;
    },
  };
}

/** Whether a selection lies entirely within one link's display text. */
function withinLink(
  link: SurfaceHyperlink,
  range: { from: SemanticPosition; to: SemanticPosition }
): boolean {
  return (
    range.from.paragraphId === link.paragraphId &&
    range.to.paragraphId === link.paragraphId &&
    range.from.offset >= link.start &&
    range.to.offset <= link.end
  );
}

/**
 * The suggesting-mode lowering of "replace `[start, end)` with `text`", spelled ONCE.
 *
 * Strike first — the struck words stay in place, as every suggested deletion does — then
 * land the copy at the landing `replacementLanding` computed, where the tracked-insert
 * core adopts the fresh deletion and follows it into the link that holds it. The reverse
 * order put the copy at the range start, which the core places beside a link's boundary.
 */
function suggestReplaceOps(
  at: { readonly paragraphId: string; readonly start: number; readonly end: number },
  landing: number,
  text: string
): TreeDocOp[] {
  return [
    { op: 'deleteText', paragraphId: at.paragraphId, start: at.start, end: at.end },
    { op: 'insertText', paragraphId: at.paragraphId, offset: landing, text },
  ];
}

/**
 * Replace one range's text, INSERT FIRST.
 *
 * Delete-then-insert reads more naturally and destroys a link. Deleting a link's whole
 * display text empties every run inside it, the delete's own cleanup then removes the
 * emptied `w:hyperlink`, and the insert that follows lands in a plain run — so editing the
 * display text of an existing link silently unlinked it while reporting success. That is
 * the ordinary Ctrl+K-then-change-the-text flow.
 *
 * Inserting at `start` first puts the new text inside the link, and the old text — now
 * shifted right by the inserted length — is deleted after. The link is never empty at any
 * point, so nothing sweeps it away.
 *
 * `bias: 'right'` is what keeps the insert INSIDE the link. A boundary insert otherwise joins
 * the run to its LEFT (Word's typing rule, see `applyInsertContent`), which at a link's start
 * is whatever plain text precedes it. This caller is not typing — it is rewriting the link's
 * own display text, so it names the run it means.
 */
function replaceTextOps(
  paragraphId: string,
  start: number,
  end: number,
  text: string
): TreeDocOp[] | null {
  if (text.length === 0) return null;
  const ops: TreeDocOp[] = [{ op: 'insertText', paragraphId, offset: start, text, bias: 'right' }];
  if (end > start) {
    ops.push({
      op: 'deleteText',
      paragraphId,
      start: start + text.length,
      end: end + text.length,
    });
  }
  return ops;
}
