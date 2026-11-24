// Direction wrappers around run content: `w:dir` (a directional embedding) and `w:bdo` (a
// directional override), ECMA-376 Part 1 §17.3.2.8 and §17.3.2.3.
//
// Layout resolves each wrapper as the matching Unicode explicit formatting character
// (UAX #9 X2-X6): LRE/RLE for an embedding, LRO/RLO for an override, closed by PDF. The
// characters exist only in the string handed to the bidi algorithm; their slots are removed
// again, so every level stays indexed by the paragraph's own UTF-16 offsets.
//
// The wrapper attribute is file-derived. Only the exact values `ltr` and `rtl` count; any
// other value leaves the content as plain runs.
import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import { bidiAlgorithm, type BidiEmbeddingLevels } from './bidi.ts';
import type { BidiDirective, FieldAwarePiece } from './field-pieces.ts';

export const NO_DIRECTIVES: readonly BidiDirective[] = Object.freeze([]);

/** The directive a `w:dir` or `w:bdo` element states, or `undefined`. */
export function bidiDirectiveOf(element: OoxmlElement): BidiDirective | undefined {
  if (element.namespaceUri !== WML_NAMESPACE_URI) return undefined;
  const kind =
    element.localName === 'bdo' ? 'override' : element.localName === 'dir' ? 'embedding' : null;
  if (!kind) return undefined;
  const values = element.attributes.filter(
    (attribute) => attribute.localName === 'val' && attribute.namespaceUri === WML_NAMESPACE_URI
  );
  const value = values.length === 1 ? values[0]!.value : undefined;
  return value === 'ltr' || value === 'rtl' ? { kind, direction: value } : undefined;
}

/** The pieces' stack of `w:dir` and `w:bdo` wrappers in a synchronous depth-first walk. */
export interface BidiDirectiveStack {
  /** The piece fields for the wrappers around the current position, outermost first. */
  fields(): { readonly bidiDirectives?: readonly BidiDirective[] };
  /** The current wrappers as a capture, or `undefined` outside every wrapper. */
  captured(): { readonly bidiDirectives: readonly BidiDirective[] } | undefined;
  /** Enters an inline wrapper; the returned function restores the enclosing stack. */
  enter(element: OoxmlElement): () => void;
}

export function createBidiDirectiveStack(): BidiDirectiveStack {
  let current = NO_DIRECTIVES;
  return {
    fields: () => (current.length > 0 ? { bidiDirectives: current } : {}),
    captured: () => (current.length > 0 ? { bidiDirectives: current } : undefined),
    enter(element) {
      const enclosing = current;
      const directive = bidiDirectiveOf(element);
      if (directive) current = [...enclosing, directive];
      return () => {
        current = enclosing;
      };
    },
  };
}

// Authored wrapper nesting is bounded by `MAX_INLINE_CONTAINER_DEPTH` (32), and wrappers left
// open past their end are capped at the same depth, so the deepest level stays well under the
// 125 explicit levels UAX #9 allows and a piece's stack stays small.
const MAX_OPEN_WRAPPERS = 32;

// Bidi class B: a paragraph separator ends every embedding and override (UAX #9 X8).
const PARAGRAPH_SEPARATOR = /[\n\r\u001c-\u001e\u0085\u2029]/;

const OPEN: Readonly<Record<BidiDirective['kind'], Readonly<Record<'ltr' | 'rtl', string>>>> = {
  embedding: { ltr: '\u202A', rtl: '\u202B' },
  override: { ltr: '\u202D', rtl: '\u202E' },
};
const POP = '\u202C';
const PDI = '\u2069';
// Authored embedding and override openers (LRE, RLE, LRO, RLO), and isolate openers.
const AUTHORED_EMBEDDING = /[\u202A\u202B\u202D\u202E]/;
const AUTHORED_ISOLATE = /[\u2066-\u2068]/;

/**
 * Authored explicit controls still open, innermost last, each with the wrapper depth it was
 * written at (0 outside every wrapper). A wrapper closes the controls opened inside it before
 * it closes itself, so they cannot capture its pop, and an authored pop cannot close a wrapper.
 * Every control is pushed and popped once, so a paragraph costs linear time.
 */
class AuthoredControls {
  private readonly open: { readonly kind: 'embedding' | 'isolate'; readonly depth: number }[] = [];
  private isolates = 0;

  /**
   * Follow one authored unit at wrapper `depth`. Returns how many wrappers stay open after a
   * control that closed wrappers (the rest must open again), or `undefined` when none closed.
   */
  track(unit: string, depth: number): number | undefined {
    if (AUTHORED_EMBEDDING.test(unit)) this.open.push({ kind: 'embedding', depth });
    else if (AUTHORED_ISOLATE.test(unit)) {
      this.open.push({ kind: 'isolate', depth });
      this.isolates++;
    } else if (unit === PDI) {
      // A PDI closes everything back to its isolate, wrappers opened since included (UAX #9
      // X6a); one with no isolate open does nothing.
      if (this.isolates === 0) return undefined;
      let closed = this.open.pop()!;
      while (closed.kind !== 'isolate') closed = this.open.pop()!;
      this.isolates--;
      return closed.depth < depth ? closed.depth : undefined;
    } else if (unit === POP) {
      // A PDF closes the innermost embedding unless an isolate is innermost (UAX #9 X7). An
      // authored one closes nothing it did not open; past them it would close the wrapper.
      const top = this.open.at(-1);
      if (top?.depth === depth) {
        if (top.kind === 'embedding') this.open.pop();
      } else if (depth > 0) return depth - 1;
    }
    return undefined;
  }

  /** The closers for the controls opened inside wrapper `depth` or deeper, innermost first. */
  close(depth: number, push: (character: string) => void): void {
    while ((this.open.at(-1)?.depth ?? -1) >= depth) {
      const closed = this.open.pop()!;
      if (closed.kind === 'isolate') this.isolates--;
      push(closed.kind === 'isolate' ? PDI : POP);
    }
  }

  /** A paragraph separator ends every control (UAX #9 X8). */
  reset(): void {
    this.open.length = 0;
    this.isolates = 0;
  }
}

function sameDirective(a: BidiDirective, b: BidiDirective): boolean {
  return a.kind === b.kind && a.direction === b.direction;
}

/** Whether any piece sits inside a `w:dir` or `w:bdo` wrapper. */
export function hasBidiDirectives(pieces: readonly FieldAwarePiece[]): boolean {
  return pieces.some((piece) => (piece.bidiDirectives?.length ?? 0) > 0);
}

/**
 * The wrappers each piece reads in. A wrapper whose next run is a right-to-left run (`w:rtl`)
 * does not close there: it stays open to the end of the paragraph, over plain runs too. A
 * wrapper that closes later before any other run closes the innermost one still open, as a
 * pop does. A wrapper's text reads in the run-direction group of the run before it (its own
 * run's at the paragraph start), and a wrapper left open takes the rest of the paragraph
 * into that group. Pieces with no wrapper return unchanged.
 */
export function withCarriedBidiDirectives(
  pieces: readonly FieldAwarePiece[],
  isRtlRun: (piece: FieldAwarePiece) => boolean
): readonly FieldAwarePiece[] {
  if (!hasBidiDirectives(pieces)) return pieces;
  let authored: readonly BidiDirective[] = NO_DIRECTIVES;
  let effective: readonly BidiDirective[] = NO_DIRECTIVES;
  // Where each open wrapper started, and the earliest start of a wrapper left open.
  const starts = new Map<BidiDirective, number>();
  // Wrappers opened past the depth cap: they add no level, so their close pops nothing.
  const skipped = new Set<BidiDirective>();
  let groupStart = pieces.length;
  const stacks = pieces.map((piece, index) => {
    const wanted = piece.bidiDirectives ?? NO_DIRECTIVES;
    // Sibling wrappers with equal values are distinct elements, so compare by identity.
    let shared = 0;
    while (
      shared < authored.length &&
      shared < wanted.length &&
      authored[shared] === wanted[shared]
    )
      shared++;
    const closed = authored.length - shared;
    if (closed > 0 && isRtlRun(piece)) {
      for (const directive of authored.slice(shared))
        groupStart = Math.min(groupStart, starts.get(directive) ?? index);
    } else if (closed > 0) {
      const pops = authored.slice(shared).filter((directive) => !skipped.has(directive)).length;
      effective = effective.slice(0, effective.length - pops);
    }
    const opened: BidiDirective[] = [];
    for (const directive of wanted.slice(shared)) {
      starts.set(directive, index);
      if (effective.length + opened.length < MAX_OPEN_WRAPPERS) opened.push(directive);
      else skipped.add(directive);
    }
    if (opened.length > 0) effective = [...effective, ...opened];
    authored = wanted;
    return effective;
  });
  // A wrapper reads in the run-direction group of the run before it; one left open takes
  // every run after it into that group too.
  // Every piece in a wrapper names its group, so a picture whose direction is rewritten from
  // its neighbours stays in it.
  const groups: ('ltr' | 'rtl' | undefined)[] = [];
  let wrapperGroup: 'ltr' | 'rtl' | undefined;
  pieces.forEach((piece, index) => {
    const own = isRtlRun(piece) ? 'rtl' : 'ltr';
    if (stacks[index]!.length === 0 && index < groupStart) wrapperGroup = undefined;
    else
      wrapperGroup ??=
        index > 0 ? (groups[index - 1] ?? (isRtlRun(pieces[index - 1]!) ? 'rtl' : 'ltr')) : own;
    groups.push(wrapperGroup);
  });
  return pieces.map((piece, index) => {
    const { bidiDirectives: authoredStack, bidiRunGroup: _group, ...rest } = piece;
    const stack = stacks[index]!;
    const group = groups[index];
    // Wrappers this piece reads in past their own end.
    const carried = stack.length > (authoredStack?.length ?? 0);
    return {
      ...rest,
      ...(stack.length > 0 ? { bidiDirectives: stack } : {}),
      ...(group ? { bidiRunGroup: group } : {}),
      ...(carried ? { bidiCarried: true as const } : {}),
    };
  });
}

/** Whether any piece sits inside a right-to-left `w:dir` or `w:bdo` wrapper. */
export function hasRtlBidiDirective(pieces: readonly FieldAwarePiece[]): boolean {
  return pieces.some((piece) =>
    piece.bidiDirectives?.some((directive) => directive.direction === 'rtl')
  );
}

/** The direction an innermost override forces on its characters, or `undefined`. */
export function overrideDirection(piece: FieldAwarePiece): 'ltr' | 'rtl' | undefined {
  const innermost = piece.bidiDirectives?.at(-1);
  return innermost?.kind === 'override' ? innermost.direction : undefined;
}

/**
 * Embedding levels of `text`, which is the pieces' text joined (or a same-length stand-in for
 * it), with each piece's wrappers applied as explicit formatting characters. Pieces stay
 * whole: a wrapper boundary only falls between pieces.
 */
export function directedEmbeddingLevels(
  pieces: readonly FieldAwarePiece[],
  text: string,
  direction: 'ltr' | 'rtl',
  options: {
    /** The pieces are one `w:rtl` run-direction group, resolved in their own context. */
    readonly rtlRunGroup?: boolean;
    /** The innermost wrapper of the last piece goes on past these pieces. */
    readonly continues?: boolean;
  } = {}
): BidiEmbeddingLevels {
  const parts: string[] = [];
  const slots: number[] = [];
  let length = 0;
  let open: readonly BidiDirective[] = [];
  let offset = 0;
  const authored = new AuthoredControls();
  const push = (character: string) => {
    parts.push(character);
    length++;
  };
  for (const piece of pieces) {
    let wanted = piece.bidiDirectives ?? NO_DIRECTIVES;
    // A right-to-left run resolved in its own right-to-left context is already inside an
    // outermost right-to-left embedding that reaches it past the wrapper's end.
    if (
      options.rtlRunGroup &&
      piece.bidiCarried &&
      wanted[0]?.kind === 'embedding' &&
      wanted[0].direction === 'rtl'
    )
      wanted = wanted.slice(1);
    let shared = 0;
    while (
      shared < open.length &&
      shared < wanted.length &&
      sameDirective(open[shared]!, wanted[shared]!)
    )
      shared++;
    for (let close = open.length; close > shared; close--) {
      authored.close(close, push);
      push(POP);
    }
    for (const directive of wanted.slice(shared)) push(OPEN[directive.kind][directive.direction]);
    open = wanted;
    const own = text.slice(offset, offset + piece.text.length);
    for (const unit of own) {
      for (let index = 0; index < unit.length; index++) slots.push(length + index);
      parts.push(unit);
      length += unit.length;
      // An authored control that closed wrappers opens them again at once.
      const kept = authored.track(unit, wanted.length);
      if (kept !== undefined)
        for (const directive of wanted.slice(kept)) push(OPEN[directive.kind][directive.direction]);
      // A line break inside a wrapper keeps the wrapper: open it again on the far side.
      if (!PARAGRAPH_SEPARATOR.test(unit)) continue;
      authored.reset();
      for (const directive of wanted) push(OPEN[directive.kind][directive.direction]);
    }
    offset += piece.text.length;
  }
  // Spaces that end the text inside a wrapper are not the end of a line (UAX #9 L1): the
  // wrapper's text goes on, so a neutral stand-in follows them before the wrapper closes.
  if (open.length > 0 && options.continues) push('\uFFFC');
  // Text past the pieces (none when `text` is their join) keeps the outer context.
  for (let close = open.length; close > 0; close--) {
    authored.close(close, push);
    push(POP);
  }
  const tail = text.slice(offset);
  const tailStart = length;
  for (let index = 0; index < tail.length; index++) slots.push(tailStart + index);
  parts.push(tail);
  const resolved = bidiAlgorithm.getEmbeddingLevels(parts.join(''), direction);
  const levels = new Uint8Array(slots.length);
  for (let index = 0; index < slots.length; index++)
    levels[index] = resolved.levels[slots[index]!]!;
  const base = direction === 'rtl' ? 1 : 0;
  return { levels, paragraphs: [{ start: 0, end: slots.length, level: base }] };
}
