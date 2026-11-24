// SETTING A CONTROL'S VALUE THROWS ITS WHOLE CONTENT AWAY.
//
// `applySetContentControlValue` rebuilds `w:sdtContent` as a single run — or a single paragraph
// carrying the old `w:pPr` — so everything the named control held is discarded. A control NESTED
// inside it goes with it: its properties, its lock, its `w:dataBinding` and its text.
//
// The reach for this op carried no position, so `landingControls` was never consulted and only the
// named control's own chain was asked. Measured before this file existed, on an unlocked outer
// control holding `OUT` plus a nested inner one:
//
//   setValue over sdtContentLocked nested   validate=null  apply=ok   inner gone, "MID" gone
//   setValue over w:dataBinding    nested   validate=null  apply=ok   inner gone, "MID" gone
//
// A lock that is deleted rather than disobeyed was still not obeyed, and a custom-XML projection
// the caller never named was thrown away in silence.
//
// The rule this file pins: a write that REPLACES a control's whole content, or removes it and
// takes the content with it, is resolved against every control in that content — not only the one
// it names. A wrapper removal that KEEPS the content reaches none of them, because they survive.

import { describe, expect, test } from 'bun:test';
import { bodyStoryRoot, contentControlsIn, readOoxmlPart, serializeOoxmlPart } from '../index.ts';
import type { OoxmlNode, OoxmlPart } from '../index.ts';
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
const REMOVAL_LOCKED = `<w:lock w:val="sdtLocked"/>`;

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`,
    docMeta
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function controlTagged(part: OoxmlPart, tag: string): OoxmlNode {
  const root = bodyStoryRoot(part) ?? part.root;
  const found = contentControlsIn(root).find((entry) => tagOf(entry.node) === tag);
  if (!found) throw new Error(`no control tagged ${tag}`);
  return found.node;
}

function tagOf(control: OoxmlNode): string | null {
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
  /** The serialized part afterwards — identical to the input when the op was refused. */
  readonly saved: string;
  /** Whether the document still holds the markup the write would have destroyed. */
  readonly unchanged: boolean;
}

function attempt(part: OoxmlPart, op: TreeDocOp): Attempt {
  const before = serializeOoxmlPart(part);
  const result = applyTreeOp(part, op);
  const saved = serializeOoxmlPart(result.ok ? result.part : part);
  return { reason: result.ok ? null : result.reason, saved, unchanged: saved === before };
}

/** Set the outer control's whole value — the path `setValue` and `at: 'replace'` both take. */
function setOuterValue(part: OoxmlPart, text = 'REPLACED'): Attempt {
  return attempt(part, {
    op: 'setContentControlValue',
    controlId: controlTagged(part, 'outer').id,
    value: { kind: 'text', text },
  });
}

/** An inline nested control inside an inline outer one, both in one paragraph. */
const inlineOverInline = (innerProperties: string): OoxmlPart =>
  parseDoc(
    `<w:p><w:r><w:t>abc</w:t></w:r>` +
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
      `<w:r><w:t>OUT</w:t></w:r>` +
      `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${innerProperties}</w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
      `</w:sdtContent></w:sdt></w:p>`
  );

/** A block nested control inside a block outer one. */
const blockOverBlock = (innerProperties: string): OoxmlPart =>
  parseDoc(
    `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
      `<w:p><w:r><w:t>OUT</w:t></w:r></w:p>` +
      `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${innerProperties}</w:sdtPr><w:sdtContent>` +
      `<w:p><w:r><w:t>MID</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
      `</w:sdtContent></w:sdt>`
  );

describe('a value write that replaces the content is refused by what that content holds', () => {
  test('a nested inline control whose content is locked refuses the replacement', () => {
    const written = setOuterValue(inlineOverInline(CONTENT_LOCKED));
    expect(written.reason).toBe('locked');
    expect(written.unchanged).toBe(true);
    expect(written.saved).toContain('MID');
  });

  test('contentLocked refuses it too: the content is rewritten out of existence', () => {
    const written = setOuterValue(inlineOverInline(EDIT_LOCKED));
    expect(written.reason).toBe('locked');
    expect(written.unchanged).toBe(true);
  });

  // `sdtLocked` leaves the CONTENT editable and forbids removing the CONTROL. A replacement of
  // the enclosing value removes the control, so this is the half of `ST_Lock` that answers.
  test('sdtLocked refuses it, because the replacement deletes the control itself', () => {
    const written = setOuterValue(inlineOverInline(REMOVAL_LOCKED));
    expect(written.reason).toBe('locked');
    expect(written.unchanged).toBe(true);
    expect(written.saved).toContain('sdtLocked');
  });

  test('a nested bound control refuses it with bound, not with locked', () => {
    const written = setOuterValue(inlineOverInline(BINDING));
    expect(written.reason).toBe('bound');
    expect(written.unchanged).toBe(true);
    expect(written.saved).toContain('w:dataBinding');
  });

  test('a nested BLOCK control that is locked refuses it', () => {
    const written = setOuterValue(blockOverBlock(CONTENT_LOCKED));
    expect(written.reason).toBe('locked');
    expect(written.unchanged).toBe(true);
  });

  test('and a nested BLOCK control that is bound refuses it as bound', () => {
    const written = setOuterValue(blockOverBlock(BINDING));
    expect(written.reason).toBe('bound');
    expect(written.unchanged).toBe(true);
  });

  test('a locked control two levels down is reached as well', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:tag w:val="middle"/></w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${CONTENT_LOCKED}</w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>MID</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt></w:sdtContent></w:sdt>`
    );
    const written = setOuterValue(part);
    expect(written.reason).toBe('locked');
    expect(written.unchanged).toBe(true);
  });

  test('a bound control two levels down is reached as well', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:tag w:val="middle"/></w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${BINDING}</w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>MID</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt></w:sdtContent></w:sdt>`
    );
    expect(setOuterValue(part).reason).toBe('bound');
  });
});

// THE OTHER SIDE OF THE RULE. Every one of these was allowed before and must stay allowed, or the
// refusal has stopped being about protected content and started being about nesting.
describe('what a value write may still replace', () => {
  test('an unlocked, unbound nested control is replaced as it always was', () => {
    const written = setOuterValue(inlineOverInline(''));
    expect(written.reason).toBeNull();
    expect(written.saved).toContain('REPLACED');
    expect(written.saved).not.toContain('MID');
  });

  test('a leaf control with no nested content at all still takes its value', () => {
    const part = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>OUT</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    const written = setOuterValue(part);
    expect(written.reason).toBeNull();
    expect(written.saved).toContain('REPLACED');
  });

  test('a locked control OUTSIDE the named one does not refuse the replacement', () => {
    const part = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>OUT</w:t></w:r></w:sdtContent></w:sdt>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${CONTENT_LOCKED}</w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    const written = setOuterValue(part);
    expect(written.reason).toBeNull();
    expect(written.saved).toContain('MID');
  });

  test('the named control being locked is still what refuses first', () => {
    const part = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="outer"/>${CONTENT_LOCKED}</w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>OUT</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${BINDING}</w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt></w:p>`
    );
    expect(setOuterValue(part).reason).toBe('locked');
  });

  // A tag or an alias is not the content. Writing one leaves every nested control exactly where
  // it was, so nothing nested has anything to say about it.
  test('a metadata write over a locked nested control is not a destructive write', () => {
    const part = inlineOverInline(CONTENT_LOCKED);
    const written = attempt(part, {
      op: 'setContentControlProperties',
      controlId: controlTagged(part, 'outer').id,
      tag: 'renamed',
    });
    expect(written.reason).toBeNull();
    expect(written.saved).toContain('MID');
  });
});

// REMOVAL HAS THE SAME TWO SHAPES. `keepContent: false` takes everything nested with it, so it is
// the same destructive reach as a replacement. `keepContent: true` splices the content into the
// parent and every nested control survives untouched — refusing that would make a wrapper around
// a locked field permanent.
describe('removing a control reaches what the removal would take with it', () => {
  const removeOuter = (part: OoxmlPart, keepContent: boolean): Attempt =>
    attempt(part, {
      op: 'removeContentControl',
      controlId: controlTagged(part, 'outer').id,
      keepContent,
    });

  test('removing the wrapper AND its content is refused by a locked nested control', () => {
    const written = removeOuter(inlineOverInline(CONTENT_LOCKED), false);
    expect(written.reason).toBe('locked');
    expect(written.unchanged).toBe(true);
  });

  test('and by a nested control that may not itself be deleted', () => {
    const written = removeOuter(inlineOverInline(REMOVAL_LOCKED), false);
    expect(written.reason).toBe('locked');
    expect(written.unchanged).toBe(true);
  });

  test('a bound nested control refuses that removal with bound', () => {
    const written = removeOuter(inlineOverInline(BINDING), false);
    expect(written.reason).toBe('bound');
    expect(written.unchanged).toBe(true);
  });

  test('removing only the WRAPPER keeps the locked control, so it is allowed', () => {
    const written = removeOuter(inlineOverInline(CONTENT_LOCKED), true);
    expect(written.reason).toBeNull();
    expect(written.saved).toContain('MID');
    expect(written.saved).toContain('sdtContentLocked');
    expect(written.saved).not.toContain('w:val="outer"');
  });

  test('and it keeps a bound one, which is why that is not refused either', () => {
    const written = removeOuter(inlineOverInline(BINDING), true);
    expect(written.reason).toBeNull();
    expect(written.saved).toContain('w:dataBinding');
    expect(written.saved).toContain('MID');
  });

  // ROUND 3'S DECISION IS UNCHANGED: a bound control the caller NAMES may be deleted, content and
  // all. Removing it removes the claim to mirror the part; what this file adds is that a control
  // the caller did not name is not collateral.
  test('removing the bound control itself is still allowed, content and all', () => {
    const part = inlineOverInline(BINDING);
    const written = attempt(part, {
      op: 'removeContentControl',
      controlId: controlTagged(part, 'inner').id,
      keepContent: false,
    });
    expect(written.reason).toBeNull();
    expect(written.saved).not.toContain('w:dataBinding');
  });
});
