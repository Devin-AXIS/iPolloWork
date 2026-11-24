// A name says WHICH control a write belongs to. It does not say what the write lands in.
//
// `insertText.inside` names an outer control and the store resolves that control's lock and
// `w:dataBinding`. But the offset still decides where the characters go, and inside an unlocked,
// unbound outer control the offset can land in a NESTED control that is locked or bound. Round 4
// validated the name; the reach it resolved was still the named control and its ANCESTORS, so a
// nested `sdtContentLocked` or `w:dataBinding` inner control was never asked.
//
// Measured before this file existed, at the offsets the shipped `insertContentControlText`
// command computes for `start` and `end`:
//
//   inline outer / inline inner   start  WROTE  inner="PWNEDMID"
//   inline outer / inline inner   end    WROTE  inner="MIDPWNED"
//   block  outer / inline inner   end    WROTE  inner="MIDPWNED"
//   block  outer / block  inner   start  WROTE  inner="PWNEDMID"
//   block  outer / block  inner   end    WROTE  inner="MIDPWNED"
//
// — for a locked inner and for a bound one alike. The lock was decoration and the binding
// desynced in silence, which is the whole of what both refusals exist to prevent.
//
// The rule this file pins: a value write addressed at a POSITION is resolved against every
// control between the part root and the run the content would actually join, under the same
// asymmetric edge semantics the un-named path already uses.

import { describe, expect, test } from 'bun:test';
import {
  bodyStoryRoot,
  contentControlsIn,
  paragraphOffsetIndex,
  readOoxmlPart,
  serializeOoxmlPart,
  storyParagraphs,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlParagraphNode,
} from '../index.ts';
import { contentControlTextOf } from '../package/content-control-nodes.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import type { TreeDocOp, TreeOpRejection } from '../store/tree-op-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const docMeta = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

const BINDING = `<w:dataBinding w:xpath="/root/customer" w:storeItemID="{FEED}"/>`;
const CONTENT_LOCKED = `<w:lock w:val="sdtContentLocked"/>`;
const EDIT_LOCKED = `<w:lock w:val="contentLocked"/>`;

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`,
    docMeta
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphs(part: OoxmlPart): readonly OoxmlNode[] {
  const body = bodyStoryRoot(part);
  return body ? storyParagraphs(body) : [];
}

function paragraphAt(part: OoxmlPart, index: number): OoxmlParagraphNode {
  const found = paragraphs(part)[index];
  if (!found || found.kind !== 'paragraph') throw new Error(`no paragraph ${index}`);
  return found;
}

/** The outermost control — the one an honest script names. */
function outerOf(part: OoxmlPart): OoxmlNode {
  const found = contentControlsIn(part.root).find((entry) => entry.ancestors.length === 0);
  if (!found) throw new Error('no outer control');
  return found.node;
}

/** The control tagged `inner`, read without the bounded walk so a deep one is still found. */
function innerOf(root: OoxmlNode): OoxmlNode {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'contentControl' && contentControlTag(node) === 'inner') return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(root);
  if (!found) throw new Error('no inner control');
  return found;
}

function contentControlTag(control: OoxmlNode): string | null {
  if (control.kind === 'textValue') return null;
  for (const child of control.children) {
    if (child.kind !== 'contentControlProperties') continue;
    for (const property of child.children) {
      if (property.kind === 'textValue' || property.localName !== 'tag') continue;
      return property.attributes.find((entry) => entry.localName === 'val')?.value ?? null;
    }
  }
  return null;
}

interface Attempt {
  readonly reason: TreeOpRejection | null;
  readonly innerText: string;
  readonly fileHoldsWrite: boolean;
}

/** A named insertion, and what the document holds afterwards either way. */
function nameAndWrite(part: OoxmlPart, offset: number, paragraphIndex = 0): Attempt {
  const op: TreeDocOp = {
    op: 'insertText',
    paragraphId: paragraphAt(part, paragraphIndex).id,
    offset,
    text: 'PWNED',
    inside: outerOf(part).id,
  };
  const result = applyTreeOp(part, op);
  const after = result.ok ? result.part : part;
  return {
    reason: result.ok ? null : result.reason,
    innerText: contentControlTextOf(innerOf(after.root)),
    fileHoldsWrite: serializeOoxmlPart(after).includes('PWNED'),
  };
}

/** The offsets the shipped command computes for `start` and `end` on the outer control. */
function commandEdges(part: OoxmlPart): { readonly start: number; readonly end: number } {
  const outer = outerOf(part);
  const held = contentControlsIn(part.root).find((entry) => entry.node.id === outer.id);
  void held;
  const index = paragraphOffsetIndex(paragraphAt(part, 0));
  const span = index.spanOf(outer);
  // Inline: the control's own span. Block: the first paragraph's start to the last one's end,
  // which for these one-paragraph fixtures is the paragraph itself.
  if (span) return { start: span.start, end: span.end };
  return { start: 0, end: index.length };
}

// An INLINE outer control whose content is one nested inline control.
const inlineOverInline = (innerProperties: string): OoxmlPart =>
  parseDoc(
    `<w:p><w:r><w:t>abc</w:t></w:r>` +
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
      `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${innerProperties}</w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
      `</w:sdtContent></w:sdt>` +
      `<w:r><w:t>xyz</w:t></w:r></w:p>`
  );

// A BLOCK outer control over a paragraph that ends with a nested inline control.
const blockOverInline = (innerProperties: string): OoxmlPart =>
  parseDoc(
    `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
      `<w:p><w:r><w:t>abc</w:t></w:r>` +
      `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${innerProperties}</w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt></w:p>` +
      `</w:sdtContent></w:sdt>`
  );

// A BLOCK outer control over a BLOCK inner one: the addressed paragraph is inside both.
const blockOverBlock = (innerProperties: string): OoxmlPart =>
  parseDoc(
    `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
      `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${innerProperties}</w:sdtPr>` +
      `<w:sdtContent><w:p><w:r><w:t>MID</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
      `</w:sdtContent></w:sdt>`
  );

describe('an inline control nested in the named one is asked before the write lands', () => {
  test('the leading edge of the outer is the leading edge of the locked inner', () => {
    const part = inlineOverInline(CONTENT_LOCKED);
    const attempt = nameAndWrite(part, commandEdges(part).start);
    expect(attempt.reason).toBe('locked');
    expect(attempt.innerText).toBe('MID');
    expect(attempt.fileHoldsWrite).toBe(false);
  });

  test('and its trailing edge is where the named write appends, so it is refused too', () => {
    const part = inlineOverInline(CONTENT_LOCKED);
    const attempt = nameAndWrite(part, commandEdges(part).end);
    expect(attempt.reason).toBe('locked');
    expect(attempt.innerText).toBe('MID');
    expect(attempt.fileHoldsWrite).toBe(false);
  });

  test('an offset in the middle of the inner control is refused as well', () => {
    const part = inlineOverInline(CONTENT_LOCKED);
    const attempt = nameAndWrite(part, commandEdges(part).start + 1);
    expect(attempt.reason).toBe('locked');
    expect(attempt.innerText).toBe('MID');
  });

  test('contentLocked refuses the same three, because it is the content half', () => {
    const edges = commandEdges(inlineOverInline(EDIT_LOCKED));
    for (const offset of [edges.start, edges.start + 1, edges.end]) {
      const attempt = nameAndWrite(inlineOverInline(EDIT_LOCKED), offset);
      expect(attempt.reason).toBe('locked');
      expect(attempt.innerText).toBe('MID');
    }
  });

  test('a bound inner control refuses with bound, not with locked', () => {
    const edges = commandEdges(inlineOverInline(BINDING));
    for (const offset of [edges.start, edges.end]) {
      const attempt = nameAndWrite(inlineOverInline(BINDING), offset);
      expect(attempt.reason).toBe('bound');
      expect(attempt.innerText).toBe('MID');
      expect(attempt.fileHoldsWrite).toBe(false);
    }
  });
});

describe('a block outer control does not launder a write into what it holds', () => {
  test('the end of its paragraph is inside the locked inline control there', () => {
    const part = blockOverInline(CONTENT_LOCKED);
    const attempt = nameAndWrite(part, commandEdges(part).end);
    expect(attempt.reason).toBe('locked');
    expect(attempt.innerText).toBe('MID');
    expect(attempt.fileHoldsWrite).toBe(false);
  });

  test('and bound is answered there too', () => {
    const part = blockOverInline(BINDING);
    const attempt = nameAndWrite(part, commandEdges(part).end);
    expect(attempt.reason).toBe('bound');
    expect(attempt.innerText).toBe('MID');
  });

  test('a nested BLOCK control holding the addressed paragraph is refused at both edges', () => {
    const part = blockOverBlock(CONTENT_LOCKED);
    const edges = commandEdges(part);
    for (const offset of [edges.start, edges.end]) {
      const attempt = nameAndWrite(blockOverBlock(CONTENT_LOCKED), offset);
      expect(attempt.reason).toBe('locked');
      expect(attempt.innerText).toBe('MID');
    }
    expect(edges.end).toBeGreaterThan(edges.start);
  });

  test('a nested BLOCK control that is bound is refused at both edges', () => {
    const edges = commandEdges(blockOverBlock(BINDING));
    for (const offset of [edges.start, edges.end]) {
      const attempt = nameAndWrite(blockOverBlock(BINDING), offset);
      expect(attempt.reason).toBe('bound');
      expect(attempt.innerText).toBe('MID');
    }
  });

  test('an offset outside the addressed paragraph is out of range, not a write', () => {
    const part = blockOverBlock(CONTENT_LOCKED);
    const attempt = nameAndWrite(part, commandEdges(part).end + 40);
    expect(attempt.reason).toBe('offset-out-of-range');
    expect(attempt.innerText).toBe('MID');
  });
});

// THE OTHER SIDE OF THE RULE. A refusal that fires whenever a control is nested anywhere would
// be as wrong as one that never fires: the point is where the write LANDS.
describe('what the named write may still do is unchanged', () => {
  test('an unlocked, unbound inner control takes the text', () => {
    const part = inlineOverInline('');
    const attempt = nameAndWrite(part, commandEdges(part).end);
    expect(attempt.reason).toBeNull();
    expect(attempt.innerText).toBe('MIDPWNED');
  });

  test('a named write with no nesting at all still lands where it did', () => {
    const part = parseDoc(
      `<w:p><w:r><w:t>abc</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
        `<w:r><w:t>xyz</w:t></w:r></w:p>`
    );
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: paragraphAt(part, 0).id,
      offset: 6,
      text: '#',
      inside: outerOf(part).id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(contentControlTextOf(outerOf(result.part))).toBe('MID#');
  });

  test('the start of a block control lands in its own text, before the nested field', () => {
    const part = blockOverInline(CONTENT_LOCKED);
    const attempt = nameAndWrite(part, commandEdges(part).start);
    expect(attempt.reason).toBeNull();
    expect(attempt.innerText).toBe('MID');
    expect(contentControlTextOf(outerOf(part)).startsWith('abc')).toBe(true);
  });

  test('a locked SIBLING of the named control does not refuse the write', () => {
    const part = parseDoc(
      `<w:p><w:r><w:t>abc</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${CONTENT_LOCKED}</w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>LOCKED</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    const attempt = nameAndWrite(part, 6);
    expect(attempt.reason).toBeNull();
    expect(attempt.innerText).toBe('LOCKED');
  });

  test('the outer control being locked is still what refuses first', () => {
    const part = parseDoc(
      `<w:p><w:r><w:t>abc</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="outer"/>${CONTENT_LOCKED}</w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt></w:p>`
    );
    expect(nameAndWrite(part, 3).reason).toBe('locked');
  });
});

// CROSSING. A range that reaches from the outer control's own characters into a nested one is
// refused WHOLE — clipping it to the editable side would silently do something else.
describe('a range crossing into a nested control is refused whole', () => {
  const crossing = (innerProperties: string): OoxmlPart =>
    parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>abc</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${innerProperties}</w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
        `<w:r><w:t>xyz</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );

  test('a deletion from the outer text into the locked inner is refused', () => {
    const part = crossing(CONTENT_LOCKED);
    const result = applyTreeOp(part, {
      op: 'deleteText',
      paragraphId: paragraphAt(part, 0).id,
      start: 1,
      end: 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('locked');
  });

  test('a deletion out the far side of the bound inner is refused too', () => {
    const part = crossing(BINDING);
    const result = applyTreeOp(part, {
      op: 'deleteText',
      paragraphId: paragraphAt(part, 0).id,
      start: 4,
      end: 8,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('bound');
  });

  test('a deletion that stays in the outer control is allowed', () => {
    const part = crossing(CONTENT_LOCKED);
    const result = applyTreeOp(part, {
      op: 'deleteText',
      paragraphId: paragraphAt(part, 0).id,
      start: 0,
      end: 2,
    });
    expect(result.ok).toBe(true);
  });

  test('formatting the whole paragraph crosses the nested control and is refused', () => {
    const part = crossing(CONTENT_LOCKED);
    const result = applyTreeOp(part, {
      op: 'setRunProperties',
      paragraphId: paragraphAt(part, 0).id,
      start: 0,
      end: 9,
      properties: [{ localName: 'b', namespaceUri: W, attributes: [] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('locked');
  });
});

// MINTING A RUN IS A LANDING TOO.
//
// When the offset finds no run to join — an empty or run-less paragraph — the applier mints one.
// A named BLOCK owner mints it into the ADDRESSED PARAGRAPH, and that paragraph can sit inside a
// nested block control the owner merely encloses. The validation asked no control at all in this
// case, because it resolved the landing through the run id and there was no run.
//
// The command's `start` and `end` both resolve to offset 0 of such a paragraph, so both locations
// wrote into a locked or bound inner control and answered `ok`.
describe('a write with no run to join is resolved against where the run is minted', () => {
  /** A block outer over a block inner whose only paragraph is empty. */
  const overEmptyBlock = (innerProperties: string): OoxmlPart =>
    parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${innerProperties}</w:sdtPr>` +
        `<w:sdtContent><w:p/></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt>`
    );

  /** The outer's own text first, then a nested control holding a BLANK paragraph: `end` lands there. */
  const overBlankLastBlock = (innerProperties: string): OoxmlPart =>
    parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>abc</w:t></w:r></w:p>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${innerProperties}</w:sdtPr>` +
        `<w:sdtContent><w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt>`
    );

  test('the empty only paragraph is inside the locked inner, at both command locations', () => {
    const part = overEmptyBlock(CONTENT_LOCKED);
    // An empty paragraph is one offset wide, so the command's `start` and `end` are one place.
    expect(commandEdges(part)).toEqual({ start: 0, end: 0 });
    const attempt = nameAndWrite(part, 0);
    expect(attempt.reason).toBe('locked');
    expect(attempt.fileHoldsWrite).toBe(false);
  });

  test('contentLocked answers there too', () => {
    const attempt = nameAndWrite(overEmptyBlock(EDIT_LOCKED), 0);
    expect(attempt.reason).toBe('locked');
    expect(attempt.fileHoldsWrite).toBe(false);
  });

  test('a bound empty inner control refuses with bound', () => {
    const attempt = nameAndWrite(overEmptyBlock(BINDING), 0);
    expect(attempt.reason).toBe('bound');
    expect(attempt.fileHoldsWrite).toBe(false);
  });

  test('the blank LAST paragraph is where the trailing location lands, and it is locked', () => {
    const attempt = nameAndWrite(overBlankLastBlock(CONTENT_LOCKED), 0, 1);
    expect(attempt.reason).toBe('locked');
    expect(attempt.fileHoldsWrite).toBe(false);
  });

  test('and a bound one refuses it as bound', () => {
    const attempt = nameAndWrite(overBlankLastBlock(BINDING), 0, 1);
    expect(attempt.reason).toBe('bound');
    expect(attempt.fileHoldsWrite).toBe(false);
  });

  test('the leading location, which is the outer control own text, still writes', () => {
    const part = overBlankLastBlock(CONTENT_LOCKED);
    const attempt = nameAndWrite(part, 0, 0);
    expect(attempt.reason).toBeNull();
    expect(attempt.fileHoldsWrite).toBe(true);
  });

  test('an unlocked, unbound empty inner control still takes the text', () => {
    const part = overEmptyBlock('');
    const attempt = nameAndWrite(part, 0);
    expect(attempt.reason).toBeNull();
    expect(attempt.innerText).toBe('PWNED');
  });

  test('an empty paragraph the named control holds itself is written to', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent><w:p/></w:sdtContent></w:sdt>` +
        `<w:p><w:sdt><w:sdtPr><w:tag w:val="inner"/>${CONTENT_LOCKED}</w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    const attempt = nameAndWrite(part, 0, 0);
    expect(attempt.reason).toBeNull();
    expect(attempt.innerText).toBe('MID');
  });

  // THE INLINE OWNER MINTS INTO ITS OWN CONTENT, not into anything nested there: the run becomes
  // the last child of the owner's `w:sdtContent`, AFTER the nested control rather than in it.
  test('an inline owner with nothing to join writes beside the nested control, not into it', () => {
    const part = parseDoc(
      `<w:p><w:r><w:t>abc</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${CONTENT_LOCKED}</w:sdtPr>` +
        `<w:sdtContent/></w:sdt></w:sdtContent></w:sdt></w:p>`
    );
    const attempt = nameAndWrite(part, 3);
    expect(attempt.reason).toBeNull();
    expect(attempt.innerText).toBe('');
  });
});

// NESTING DEPTH. Two bounded walks decide where a named write goes: the offset model, which
// stops descending at the shared nesting cap, and the run walk the append path uses. They must
// not disagree about a run — a run one walk can reach and the other cannot is a run a write can
// land in at an offset nobody can address, and here that run is inside a locked control.
describe('the nesting bound is the same bound for the refusal and for the write', () => {
  /** `depth` inline controls one inside the next, the innermost locked and holding `MID`. */
  function nested(depth: number): OoxmlPart {
    let markup = `<w:r><w:t>MID</w:t></w:r>`;
    for (let level = depth - 1; level >= 0; level -= 1) {
      const properties =
        level === depth - 1
          ? `<w:tag w:val="inner"/>${CONTENT_LOCKED}`
          : `<w:tag w:val="l${level}"/>`;
      markup = `<w:sdt><w:sdtPr>${properties}</w:sdtPr><w:sdtContent>${markup}</w:sdtContent></w:sdt>`;
    }
    return parseDoc(`<w:p><w:r><w:t>abc</w:t></w:r>${markup}<w:r><w:t>xyz</w:t></w:r></w:p>`);
  }

  test('a locked control well inside the bound refuses the named write', () => {
    const part = nested(8);
    const attempt = nameAndWrite(part, commandEdges(part).end);
    expect(attempt.reason).toBe('locked');
    expect(attempt.innerText).toBe('MID');
  });

  test('the last addressable locked control before the bound refuses it', () => {
    const part = nested(31);
    const attempt = nameAndWrite(part, commandEdges(part).end);
    expect(attempt.reason).toBe('locked');
    expect(attempt.innerText).toBe('MID');
  });

  test('at and past the bound the write does not reach the locked content', () => {
    for (const depth of [32, 40]) {
      const part = nested(depth);
      const attempt = nameAndWrite(part, commandEdges(part).end);
      // Nothing at the cap is addressable, so the characters go in the NAMED control's own
      // content rather than into a control no walk reports.
      expect(attempt.reason).toBeNull();
      expect(attempt.innerText).toBe('MID');
    }
  });
});
