// Reading a native browser selection back as MODEL positions.
//
// The paginated surface paints layout records, so every interaction it does not implement
// by hand simply does not exist: no drag, no double-click word, no triple-click paragraph,
// no shift-extend. Hand-writing those is how an editor spends years catching up with
// behaviour the browser already ships — including the parts nobody remembers, like
// double-click selecting a word differently per locale.
//
// So the browser owns the GESTURE and layout keeps owning the GEOMETRY. The painter already
// stamps every span with the source range it came from, which is enough to turn a DOM
// anchor/focus into a paragraph id and a UTF-16 offset:
//
//   span[data-paragraph-id="p3"][data-start="12"] + 4 characters into its text -> (p3, 16)
//
// This reads DOM IDENTITY and text offsets — never `getBoundingClientRect`, never a computed
// style. Nothing here derives geometry, so the layout records remain the only answer to
// where anything is; this only decides WHICH characters the user gestured over.

import { PARAGRAPH_BOUNDARY_CLASS } from '../output/semantic-paragraph-boundary.ts';
import type { SemanticPosition, SemanticSelection } from '@docx-editor.dev/core/layout';

/** A painted span carries the source range it was laid out from. */
interface SpanIdentity {
  readonly paragraphId: string;
  readonly start: number;
  /**
   * The span's model END, which is NOT `start + textContent.length` for every span.
   *
   * A field is one model unit however many characters its result paints — "Scope of the
   * discussions" is 24 glyphs over a range of 1. Deriving the endpoint from the painted text
   * therefore handed back an offset the paragraph does not have, and the edit built from it
   * was refused: a caret placed just after such a field could not type at all.
   */
  readonly end: number;
}

/**
 * The furthest model offset a gesture inside `identity` can mean.
 *
 * Clamped to the span's own RANGE, not to its text. Where the two agree — ordinary runs, which
 * is nearly everything — this changes nothing.
 */
function offsetWithin(identity: SpanIdentity, within: number): number {
  const span = Math.max(0, identity.end - identity.start);
  return identity.start + Math.max(0, Math.min(within, span));
}

/** Node ids are `part#path`, and the part name comes from the document. */
const PARAGRAPH_ID = /^[^\s]{1,512}$/;
const CSS_STRING_UNSAFE = /["\\\u0000-\u001f\u007f]/;

/**
 * A paragraph id and a start offset read back from the DOM, or null when either is not one.
 *
 * BOTH values are re-validated. They round-trip through the DOM, where anything on the page
 * could have rewritten them, and the id then flows into a tree op as the paragraph to mutate.
 * `__proto__` as an id is refused here rather than relied on being refused later.
 */
function validatedPosition(
  paragraphId: string | undefined,
  rawStart: string | undefined
): SemanticPosition | null {
  if (!paragraphId || rawStart === undefined || !/^\d{1,9}$/.test(rawStart)) return null;
  if (!PARAGRAPH_ID.test(paragraphId) || paragraphId === '__proto__') return null;
  return { paragraphId, offset: Number(rawStart) };
}

function identityOf(element: Element): SpanIdentity | null {
  const position = validatedPosition(
    (element as HTMLElement).dataset?.paragraphId,
    (element as HTMLElement).dataset?.start
  );
  if (!position) return null;
  const { paragraphId, offset: start } = position;
  // `data-end` is written with `data-start` by the same painter branch, and validated the same
  // way for the same reason. A span missing or misreporting it falls back to the painted
  // length, which is the pre-existing behaviour and correct for every 1:1 span.
  const rawEnd = (element as HTMLElement).dataset?.end;
  const end =
    rawEnd !== undefined && /^\d{1,9}$/.test(rawEnd) && Number(rawEnd) >= start
      ? Number(rawEnd)
      : start + ((element as HTMLElement).textContent?.length ?? 0);
  return { paragraphId, start, end };
}

/**
 * The model position of the inline picture an advance spacer reserves, or null.
 *
 * The spacer is inert furniture, but it sits in the line exactly where the picture does, so
 * the child index before it is the position before the picture and the index after it is the
 * position after. Validated like a span identity.
 */
function drawingSpacerIdentity(node: Node | undefined): SemanticPosition | null {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as HTMLElement;
  if (!element.classList.contains('docx-inline-drawing-advance')) return null;
  // A spacer sits directly in its line. A line whose paragraph binding is stripped is inert,
  // like a text box that is not being edited, and so is every picture position in it.
  if ((element.parentElement as HTMLElement | null)?.dataset.paragraphId === undefined) return null;
  return validatedPosition(element.dataset.drawingParagraphId, element.dataset.drawingStart);
}

/**
 * A paragraph's painted spans and its inline pictures' advance spacers, from ONE walk of the
 * search root: selection writes run on every keystroke, and two queries walked it twice.
 */
function paragraphSpansAndSpacers(
  searchRoot: Element,
  paragraphId: string
): { readonly spans: readonly Element[]; readonly spacers: readonly Element[] } {
  // The id is narrowed the same way `paragraphElements` does, and only when it is CSS-safe.
  const selector = CSS_STRING_UNSAFE.test(paragraphId)
    ? '[data-paragraph-id][data-start], .docx-inline-drawing-advance'
    : `[data-paragraph-id="${paragraphId}"][data-start], ` +
      `.docx-inline-drawing-advance[data-drawing-paragraph-id="${paragraphId}"]`;
  const spans: Element[] = [];
  const spacers: Element[] = [];
  for (const element of searchRoot.querySelectorAll(selector)) {
    if (!element.classList.contains('docx-inline-drawing-advance')) spans.push(element);
    else if (drawingSpacerIdentity(element)?.paragraphId === paragraphId) spacers.push(element);
  }
  return { spans, spacers };
}

export function paragraphElements(
  root: Element,
  paragraphId: string,
  suffix: string
): NodeListOf<Element> {
  // The id came from the model but still crosses a CSS parser here. Ordinary node ids have
  // no string delimiters or controls and can use the browser's indexed attribute lookup;
  // an unusual/forged id falls back to the validated scan rather than being interpolated.
  if (CSS_STRING_UNSAFE.test(paragraphId)) {
    return root.querySelectorAll(`[data-paragraph-id]${suffix}`);
  }
  return root.querySelectorAll(`[data-paragraph-id="${paragraphId}"]${suffix}`);
}

/** The nearest ancestor (or self) that is a painted span. */
function spanFor(node: Node): { element: Element; identity: SpanIdentity } | null {
  let current: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const identity = identityOf(current as Element);
    if (identity) return { element: current as Element, identity };
    current = current.parentNode;
  }
  return null;
}

/** The model range of the painted text span a node is in, or null. */
export function paintedSpanRange(
  node: Node
): { readonly paragraphId: string; readonly start: number; readonly end: number } | null {
  return spanFor(node)?.identity ?? null;
}

/** The header/footer container open for editing, when any. */
function activeHeaderFooterRoot(root: Element): Element | null {
  return root.querySelector('[data-docx-hf-active]');
}

/**
 * The page a painted node sits on, or undefined when it is not inside a sheet.
 *
 * Repeated table header rows share one paragraph id on every page they appear. The write
 * path uses this to prefer the copy on the sheet the user is looking at.
 */
export function pageIndexOfNode(node: Node | null | undefined, root?: Element): number | undefined {
  if (!node) return undefined;
  if (root && !root.contains(node)) return undefined;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const page = element?.closest('[data-page-index]');
  const raw = (page as HTMLElement | null | undefined)?.dataset?.pageIndex;
  if (raw === undefined || !/^\d{1,9}$/.test(raw)) return undefined;
  return Number(raw);
}

/** The painted sheet for a page index, or null when that sheet is not in this tree. */
function pageRoot(root: Element, pageIndex: number | undefined): Element | null {
  if (pageIndex === undefined || !Number.isInteger(pageIndex) || pageIndex < 0) return null;
  return root.querySelector(`[data-page-index="${pageIndex}"]`);
}

/**
 * Search roots for painted spans, preferring the active header/footer when one is open.
 *
 * Shared header/footer parts paint the same paragraph ids on every page; the active
 * container is the caret target the user entered. A preferred page does the same job for
 * body copies that share an id — a `w:tblHeader` row that repeats on later sheets.
 */
export function spanSearchRoots(root: Element, preferredPageIndex?: number): readonly Element[] {
  const active = activeHeaderFooterRoot(root);
  // A page-anchored header or footer drawing paints on the sheet, outside the band: its sheet
  // comes before the whole document.
  const sheet = active?.closest('.docx-page');
  if (active) return sheet && sheet !== root ? [active, sheet, root] : [active, root];
  const page = pageRoot(root, preferredPageIndex);
  return page && page !== root ? [page, root] : [root];
}

/**
 * The first (or, with `last`, the final) model boundary at, above, or inside a node, in DOM
 * order: a painted span's start (or end), or an inline picture's position before (or after)
 * it. The picture's advance spacer stands where the picture does in the line, so a line or a
 * whole fragment holding a picture resolves through it rather than past it.
 */
function boundaryAtOrInside(node: Node, last: boolean): SemanticPosition | null {
  const boundary = (identity: SpanIdentity): SemanticPosition => ({
    paragraphId: identity.paragraphId,
    offset: last ? identity.end : identity.start,
  });
  const beside = (picture: SemanticPosition): SemanticPosition =>
    last ? { ...picture, offset: picture.offset + 1 } : picture;
  const own = spanFor(node);
  if (own) return boundary(own.identity);
  const ownPicture = drawingSpacerIdentity(node);
  if (ownPicture) return beside(ownPicture);
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const found = (node as Element).querySelectorAll(
    '[data-paragraph-id][data-start], .docx-inline-drawing-advance'
  );
  const ordered = last ? [...found].reverse() : [...found];
  for (const element of ordered) {
    const picture = drawingSpacerIdentity(element);
    if (picture) return beside(picture);
    const identity = identityOf(element);
    if (identity) return boundary(identity);
  }
  return null;
}

/**
 * Resolve an endpoint expressed as a child index into a model position.
 *
 * A selection endpoint can land on a line or fragment element rather than on text —
 * triple-clicking a paragraph, or dragging past the end of a line, does exactly that. The
 * offset is then a CHILD INDEX, not a character offset.
 *
 * The children are not all model text. A paragraph fragment holds a shading band, a list
 * marker, tab leaders and border rules alongside its lines, and the RULES ARE PAINTED LAST —
 * so "after the last child" landed on a border rather than on the final run, and any index
 * that happened to hit furniture resolved to nothing. Both cases then fell through to the
 * empty-line answer, offset zero, silently moving the endpoint to the paragraph start.
 *
 * So scan outward from the index instead of clamping to one child: forward for the next
 * painted text (its START, the position the index points AT), then backward for the previous
 * (its END, the position the index points AFTER).
 */
function positionFromChildIndex(
  container: Element,
  index: number,
  upstream = false
): SemanticPosition | null {
  const children = [...container.childNodes];
  if (children.length === 0) return null;
  // Written for the position after a picture, and so read back as exactly that, even when
  // what follows paints nothing (a hidden run) and the next span starts further on.
  const justAfter = drawingSpacerIdentity(children[index - 1]);
  if (justAfter) return { paragraphId: justAfter.paragraphId, offset: justAfter.offset + 1 };
  for (let at = Math.max(0, index); !upstream && at < children.length; at += 1) {
    const found = boundaryAtOrInside(children[at]!, false);
    if (found) return found;
  }
  for (let at = Math.min(index, children.length) - 1; at >= 0; at -= 1) {
    const found = boundaryAtOrInside(children[at]!, true);
    if (found) return found;
  }
  return null;
}

/**
 * Turn one DOM endpoint into a model position.
 *
 * Returns null when the endpoint is not inside painted content at all, which is how a
 * selection living in the offscreen input host is told from one the user made on the page.
 */
export function positionFromDomPoint(
  node: Node,
  offset: number,
  root: Element
): SemanticPosition | null {
  if (!root.contains(node)) return null;

  const nearestElement =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;

  // Live-projected and computed fields are inert furniture: their painted cache has no
  // independently editable model text. Literal FORMTEXT results are not marked this way.
  if (nearestElement?.closest('[data-docx-field]')) return null;

  // Header/footer furniture is painted, not editable, unless this copy is the active scope.
  const headerFooter = nearestElement?.closest('[data-docx-hf]');
  if (headerFooter && !headerFooter.hasAttribute('data-docx-hf-active')) return null;

  // While a header/footer is open, the body content box is inert — the user is editing
  // furniture, not the story.
  if (activeHeaderFooterRoot(root) && nearestElement?.closest('.docx-page-content')) return null;

  // A LIST MARKER is furniture with one honest answer. It carries no source range, so it
  // cannot be mapped through a child index — but it is painted at the paragraph's own start,
  // inside the hanging indent, which is exactly the position Word gives a click on a bullet.
  //
  // Returning nothing instead is what made this worth changing: a double-click on the first
  // word of a list item can anchor in the marker, the whole selection then failed to map,
  // and the caller kept the PREVIOUS model selection while the browser showed the new one —
  // so the next toolbar command formatted a range the user could no longer see.
  //
  // The engine's painted caret shares this attribute but hangs off the page content box, so
  // it has no owning paragraph and still resolves to nothing, which is what it should do.
  const marker = nearestElement?.closest('[data-docx-marker]');
  // A picture's advance spacer shares the attribute, but it is not at the paragraph start:
  // it is the picture's own place in the line.
  const picture = drawingSpacerIdentity(marker ?? undefined);
  if (picture) return offset > 0 ? { ...picture, offset: picture.offset + 1 } : picture;
  // A float's wrap jump spacer is mid-line as well: it is the gap between the content before
  // and after it, so it resolves as the line's child index on that side of it. A terminator
  // mark's seat stands after the line's content, so it resolves as the line's end.
  // The paragraph-end line break painted for the browser's text services stands where the
  // terminator does, so it resolves the same way.
  const seat = nearestElement?.closest<HTMLElement>(
    `.docx-terminator-seat, .${PARAGRAPH_BOUNDARY_CLASS}`
  );
  if (seat?.querySelector('.docx-line-break-mark') && seat.parentElement) {
    // The line's logical last run, in the paragraph its last run paints (a join line paints
    // two), and not a run of a text box drawn in it. The break's own run starts at the
    // break, and any other run ends there.
    const line = seat.parentElement;
    const runs = [...line.querySelectorAll('.layout-run[data-start]')]
      .filter((run) => run.closest('.docx-line') === line)
      .flatMap((run) => {
        const identity = identityOf(run);
        return identity ? [{ run, identity }] : [];
      });
    const paragraphId = runs.at(-1)?.identity.paragraphId;
    let last: (typeof runs)[number] | undefined;
    for (const entry of runs) {
      if (entry.identity.paragraphId !== paragraphId) continue;
      if (!last || entry.identity.start > last.identity.start) last = entry;
    }
    if (last) {
      const isBreak = last.run.textContent === '\n';
      const { start, end } = last.identity;
      return { paragraphId: last.identity.paragraphId, offset: isBreak ? start : end };
    }
  }
  const flowMarker = seat ?? (marker?.classList.contains('docx-wrap-advance') ? marker : null);
  if (flowMarker?.parentElement) {
    const children = [...flowMarker.parentElement.childNodes];
    // Inline drawings paint after the line's flow, and a text box among them holds runs of
    // its own story, so a seat stands just after the line's last piece of flow.
    let index = children.indexOf(flowMarker);
    if (seat) {
      const flow = '[data-start], a, br, .docx-inline-drawing-advance, .docx-wrap-advance';
      while (index > 0 && !(children[index - 1] as Element).matches?.(flow)) index -= 1;
    }
    const past = !seat && offset > 0 ? 1 : 0;
    const resolved = positionFromChildIndex(flowMarker.parentElement, index + past, !!seat);
    if (resolved) return resolved;
  }
  if (marker) return marker.parentElement ? paragraphStartAt(marker.parentElement) : null;

  // A TAB LEADER has no such answer: it is drawn across the advance of a tab in the MIDDLE
  // of a paragraph, so the paragraph start would be a lie and its repeated glyphs are not
  // model characters. It is `pointer-events: none` and `user-select: none`, so a real
  // endpoint should never land in one; refusing explicitly keeps that a property rather than
  // an accident of how the ancestors happen to be attributed.
  if (nearestElement?.closest('[data-docx-tab-leader]')) return null;

  // An ELEMENT endpoint carries a child index, never a character offset — including when the
  // element is a painted span. Runs are inline-blocks, so a shift-click or a drag across one
  // is exactly when a browser reports the span itself as the endpoint; reading that index as
  // a character offset silently moved the selection to near the start of the run.
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    const identity = identityOf(element);
    if (identity) {
      return {
        paragraphId: identity.paragraphId,
        offset: offset > 0 ? identity.end : identity.start,
      };
    }
    const resolved = positionFromChildIndex(element, offset);
    if (resolved) return resolved;
    // An EMPTY line still has a caret position: the paragraph it belongs to, at its start.
    return emptyLinePosition(element);
  }

  const found = spanFor(node);
  if (!found) return null;

  // Clamp to the span's own RANGE: a browser may report an offset past the end for an endpoint
  // that sits at a boundary between elements, and a field's painted result is wider than the
  // one offset it occupies.
  return {
    paragraphId: found.identity.paragraphId,
    offset: offsetWithin(found.identity, offset),
  };
}

/**
 * The current native selection expressed in model coordinates.
 *
 * Null when there is no selection, or when it is not inside the painted content — the
 * caller must not mistake the caret sitting in the offscreen input host for the user having
 * selected nothing.
 */
export function semanticSelectionFromDom(
  root: Element,
  domSelection: Selection | null
): SemanticSelection | null {
  if (!domSelection || domSelection.rangeCount === 0) return null;
  const { anchorNode, anchorOffset, focusNode, focusOffset } = domSelection;
  if (!anchorNode || !focusNode) return null;

  const anchor = positionFromDomPoint(anchorNode, anchorOffset, root);
  const head = positionFromDomPoint(focusNode, focusOffset, root);
  // ONE resolvable end is still an answer. A drag that starts in the body and ends in the
  // header, or the reverse, has an end the model can address; collapsing to it costs the
  // user a range they could not have edited anyway, whereas returning nothing left the model
  // on whatever it held BEFORE the gesture — and the next command ran on that.
  if (!anchor || !head) {
    const only = anchor ?? head;
    return only ? { anchor: only, head: only } : null;
  }
  // Anchor and head are kept in the order the USER dragged them, not sorted: which end is
  // moving is what shift-arrow has to extend from.
  return { anchor, head };
}

/**
 * Whether a native selection is inside the painted pages at all.
 *
 * Tells "the user gestured here and it did not map" from "the selection belongs to something
 * else on the page" — the first must never leave a stale model selection behind, the second
 * must never disturb one.
 */
export function domSelectionTouchesPages(root: Element, domSelection: Selection | null): boolean {
  if (!domSelection || domSelection.rangeCount === 0) return false;
  const { anchorNode, focusNode } = domSelection;
  return (!!anchorNode && root.contains(anchorNode)) || (!!focusNode && root.contains(focusNode));
}

/**
 * The DOM point for a model position.
 *
 * The inverse of `positionFromDomPoint`, and just as necessary: arrow keys, undo and
 * programmatic selection move the MODEL, and the browser only draws a caret and a highlight
 * for its OWN selection. Without writing the position back, pressing Right would move the
 * model and leave the visible caret where it was.
 */
function domPointFromPosition(
  root: Element,
  position: SemanticPosition,
  preferredPageIndex?: number,
  preferredLineId?: string
): { node: Node; offset: number } | null {
  if (preferredLineId !== undefined) {
    for (const searchRoot of spanSearchRoots(root, preferredPageIndex)) {
      const selector: string = CSS_STRING_UNSAFE.test(preferredLineId)
        ? '[data-line-id]'
        : `[data-line-id="${preferredLineId}"]`;
      for (const line of searchRoot.querySelectorAll<HTMLElement>(selector)) {
        if (line.dataset.lineId !== preferredLineId) continue;
        const point = domPointFromPositionIn(line, position);
        if (point) return point;
      }
    }
  }
  for (const searchRoot of spanSearchRoots(root, preferredPageIndex)) {
    const point = domPointFromPositionIn(searchRoot, position);
    if (point) return point;
  }
  return null;
}

/** Keep field endpoints outside their inert cache, including a field-only paragraph. */
function fieldBoundaryPoint(
  spans: readonly Element[],
  position: SemanticPosition
): { node: Node; offset: number } | null {
  let ending: Element | null = null;
  for (const span of spans) {
    if (!span.hasAttribute('data-docx-field') || !span.parentNode) continue;
    const identity = identityOf(span);
    if (identity?.paragraphId !== position.paragraphId) continue;
    if (identity.start === position.offset) {
      return { node: span.parentNode, offset: [...span.parentNode.childNodes].indexOf(span) };
    }
    if (identity.end === position.offset) ending = span;
  }
  if (ending) {
    // Projected hard breaks share the field's atomic range but lack its paint marker.
    // End after the last such span, so a clicked line keeps both its line and model offset.
    const range = identityOf(ending)!;
    for (const span of spans) {
      const identity = identityOf(span);
      if (
        identity?.paragraphId === position.paragraphId &&
        identity.start === range.start &&
        identity.end === range.end
      )
        ending = span;
    }
  }
  return ending?.parentNode
    ? { node: ending.parentNode, offset: [...ending.parentNode.childNodes].indexOf(ending) + 1 }
    : null;
}

function domPointFromPositionIn(
  searchRoot: Element,
  position: SemanticPosition
): { node: Node; offset: number } | null {
  const { spans, spacers } = paragraphSpansAndSpacers(searchRoot, position.paragraphId);
  const fieldBoundary = fieldBoundaryPoint(spans, position);
  if (fieldBoundary) return fieldBoundary;
  let fallback: { node: Node; offset: number } | null = null;
  let painted = false;
  for (const span of spans) {
    const identity = identityOf(span);
    if (!identity || identity.paragraphId !== position.paragraphId) continue;
    const text = textNodeOf(span);
    const length = span.textContent?.length ?? 0;
    const end = identity.end;
    if (!text) continue;
    // Exact field boundaries resolved above. Cache text has no editable positions.
    // A field-only paragraph is not empty: an offset beyond its source range must fail,
    // rather than falling back to the paragraph start.
    if ((span as HTMLElement).closest?.('[data-docx-field]')) {
      painted = true;
      continue;
    }
    painted = true;
    if (position.offset >= identity.start && position.offset <= end) {
      // A position on a boundary belongs to the span that STARTS there, so a caret between
      // two words sits before the second rather than after the first. The first match wins
      // for the interior; the boundary case keeps looking so the later span is preferred.
      //
      // The DOM offset is clamped to the painted text, which is a different length from the
      // model range wherever a field is: one model unit can be 24 glyphs, and asking a text
      // node for character 1 of 24 would put the native selection inside a word the model
      // has no position inside.
      const point = {
        node: text,
        offset: Math.min(position.offset - identity.start, length),
      };
      if (position.offset < end) return point;
      fallback = point;
    }
  }
  const spacerAt = (start: number) =>
    spacers.find((spacer) => drawingSpacerIdentity(spacer)?.offset === start) ?? null;
  const opening = spacerAt(position.offset);
  if (fallback && opening?.parentNode && !opening.parentNode.contains(fallback.node)) {
    return {
      node: opening.parentNode,
      offset: [...opening.parentNode.childNodes].indexOf(opening),
    };
  }
  if (fallback) return fallback;

  // Beside an inline picture that no text holds: just before one that opens a line, or else
  // just after one that ends a line or stands alone. The line's child index past (or at) the
  // picture's advance spacer is that position, and `positionFromChildIndex` reads it back.
  const before = opening;
  const after = before ? null : spacerAt(position.offset - 1);
  const spacer = before ?? after;
  if (spacer?.parentNode) {
    return {
      node: spacer.parentNode,
      offset: [...spacer.parentNode.childNodes].indexOf(spacer) + (after ? 1 : 0),
    };
  }

  // A paragraph that DID paint text and still has no place for this offset is a position
  // this DOM cannot express — an offset inside a hidden run (`w:vanish` advances offsets and
  // paints nothing), a caret past what the current paint covers, a span whose text node the
  // paint has not built yet. Answering the line at child index 0 is not a near miss: it is
  // the paragraph START, a legal position the readback cannot tell from a real one. The
  // browser caret went home, the next reader took that as the truth, and every character
  // typed after the first landed in front of the one before it. Say "cannot", and the caller
  // keeps the model — which the engine's own painted caret draws from anyway.
  // A picture paints a place for its paragraph's content as text does.
  painted ||= spacers.length > 0;
  if (painted) return null;

  // An EMPTY paragraph paints a line with no spans, so there is no text node to point at —
  // yet it still has exactly one caret position. Without this the caret vanished after every
  // Enter, and Select All drew no highlight at all on a document ending in a blank
  // paragraph, which is nearly every document Word writes.
  const emptyLine = lineOfParagraph(searchRoot, position.paragraphId);
  return emptyLine ? { node: emptyLine, offset: 0 } : null;
}

/**
 * The text node a span's characters actually live in.
 *
 * A run that is BOTH underlined and struck mounts its text under nested decoration spans, so
 * the run element's first child is an element rather than the text. Handing that to
 * `setBaseAndExtent` with a character offset turns the offset into a CHILD INDEX, and the
 * browser rejects the whole write — no caret and no highlight anywhere inside such a run.
 */
function textNodeOf(span: Element): Node | null {
  let node: Node | null = span.firstChild;
  while (node && node.nodeType === Node.ELEMENT_NODE) node = node.firstChild;
  return node && node.nodeType === Node.TEXT_NODE ? node : null;
}

/** The painted line belonging to a paragraph, whether or not it holds any runs. */
function lineOfParagraph(root: Element, paragraphId: string): Element | null {
  let fragment: Element | null = null;
  for (const line of paragraphElements(root, paragraphId, '')) {
    if ((line as HTMLElement).dataset?.paragraphId !== paragraphId) continue;
    if ((line as HTMLElement).dataset?.start !== undefined) continue;
    // The paragraph FRAGMENT carries the same identity as its line. The line is the caret
    // target: the fragment's in-flow content box is empty (its children are absolutely
    // positioned), which browsers refuse as a caret position and canonicalize away from.
    if ((line as HTMLElement).dataset?.lineId !== undefined) return line;
    fragment ??= line;
  }
  return fragment;
}

/** The start of the paragraph an element was painted for, whatever the element is. */
function paragraphStartAt(element: Element): SemanticPosition | null {
  // Resolved via `closest`, not the element's own dataset: the endpoint may be the caret
  // anchor <br> INSIDE the line rather than the line itself.
  const container = element.closest('[data-paragraph-id]') as HTMLElement | null;
  // A span hit (`data-start`) is not a container — refusing keeps a future inline
  // element from silently snapping the caret to the paragraph start.
  if (!container || container.dataset.start !== undefined) return null;
  const paragraphId = container.dataset.paragraphId;
  if (!paragraphId || !PARAGRAPH_ID.test(paragraphId) || paragraphId === '__proto__') return null;
  return { paragraphId, offset: 0 };
}

/** The caret position for an empty painted line: the start of the paragraph it belongs to. */
function emptyLinePosition(element: Element): SemanticPosition | null {
  const start = paragraphStartAt(element);
  if (!start) return null;
  // A container that HOLDS painted text is not an empty line, and an endpoint that reached
  // here through one arrived on FURNITURE — a border rule, a shading band, a tab leader.
  // Answering "offset 0" for those silently dragged the endpoint to the paragraph start,
  // which on a bordered or shaded paragraph turned a click near its edge into a selection
  // running back to the beginning.
  const container = element.closest('[data-paragraph-id]')!;
  if (container.querySelector('[data-paragraph-id][data-start]')) return null;
  return start;
}

/**
 * Write a model selection into the browser's own selection.
 *
 * Returns false when either endpoint is not painted — a position inside a page that is not
 * currently rendered, once virtualization lands. `preferredPageIndex` picks among painted
 * copies of the same paragraph — a repeating `w:tblHeader` row — when the model cannot.
 */
export function applySelectionToDom(
  root: Element,
  selection: SemanticSelection,
  domSelection: Selection | null,
  options?: { readonly preferredPageIndex?: number; readonly preferredLineId?: string }
): boolean {
  if (!domSelection) return false;
  const preferredPageIndex =
    options?.preferredPageIndex ?? pageIndexOfNode(domSelection.anchorNode, root);
  const collapsed = selectionsEqual(selection, { anchor: selection.head, head: selection.head });
  const preferredLineId = collapsed ? options?.preferredLineId : undefined;
  const anchor = domPointFromPosition(root, selection.anchor, preferredPageIndex, preferredLineId);
  const head = domPointFromPosition(root, selection.head, preferredPageIndex, preferredLineId);
  if (!anchor || !head) return false;
  const current = semanticSelectionFromDom(root, domSelection);
  // Already correct: re-setting it would collapse an in-progress drag and fight the user.
  // Same model offsets on a DIFFERENT sheet are not correct — a repeating header paints
  // those offsets on every page, and leaving the native range on page 0 is the bug.
  if (current && selectionsEqual(current, selection)) {
    const currentPage = pageIndexOfNode(domSelection.anchorNode, root);
    const focusElement =
      domSelection.focusNode?.nodeType === Node.ELEMENT_NODE
        ? (domSelection.focusNode as Element)
        : domSelection.focusNode?.parentElement;
    const currentLine = (focusElement?.closest('[data-line-id]') as HTMLElement | null)?.dataset
      .lineId;
    if (
      (preferredPageIndex === undefined || currentPage === preferredPageIndex) &&
      (preferredLineId === undefined || currentLine === preferredLineId)
    )
      return true;
  }
  try {
    // `setBaseAndExtent` keeps the anchor/head ORDER, which is what shift-arrow extends
    // from; collapsing and extending would lose the direction.
    domSelection.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
    return true;
  } catch {
    // A detached or replaced node between paint and sync: the next paint re-syncs.
    return false;
  }
}

/** Whether two selections address the same range, so a no-op event can be ignored. */
export function selectionsEqual(a: SemanticSelection, b: SemanticSelection): boolean {
  return (
    a.anchor.paragraphId === b.anchor.paragraphId &&
    a.anchor.offset === b.anchor.offset &&
    a.head.paragraphId === b.head.paragraphId &&
    a.head.offset === b.head.offset
  );
}
