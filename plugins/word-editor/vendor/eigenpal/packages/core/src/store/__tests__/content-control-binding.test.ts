// A bound control is preserved and refused — from every write, not from one of them.
//
// `w:dataBinding` says the control's content MIRRORS a node in a custom XML part. This engine
// does not evaluate the binding, so it cannot keep the two sides in step; the only honest answer
// is to refuse the write and leave both sides as the file wrote them. `setContentControlValue`
// already answered `bound`. Ordinary typing, formatting and deleting inside the same control did
// not, so the value could be changed by the path a keystroke takes while the part kept the old
// one — precisely the silent desync the refusal exists to prevent.

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
import { applyTreeOp } from '../store/tree-op-apply.ts';
import type { TreeDocOp, TreeOpRejection } from '../store/tree-op-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const docMeta = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

const BINDING = `<w:dataBinding w:xpath="/root/customer" w:storeItemID="{FEED}"/>`;

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`,
    docMeta
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function refusal(part: OoxmlPart, op: TreeDocOp): TreeOpRejection | null {
  const result = applyTreeOp(part, op);
  return result.ok ? null : result.reason;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.part;
}

function paragraphs(part: OoxmlPart): readonly OoxmlNode[] {
  const body = bodyStoryRoot(part);
  return body ? storyParagraphs(body) : [];
}

function firstParagraph(part: OoxmlPart): OoxmlParagraphNode {
  const found = paragraphs(part)[0];
  if (!found || found.kind !== 'paragraph') throw new Error('no paragraph');
  return found;
}

/** A BLOCK bound control: the paragraph carrying the value sits inside it. */
function boundBlock(): OoxmlPart {
  return parseDoc(
    `<w:sdt><w:sdtPr><w:tag w:val="customer"/>${BINDING}<w:text/></w:sdtPr>` +
      `<w:sdtContent><w:p><w:r><w:t>Acme</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
      `<w:p><w:r><w:t>outside</w:t></w:r></w:p>`
  );
}

/** An INLINE bound control: the value is a stretch of a paragraph that is not inside it. */
function boundInline(before = 'a', held = 'Acme', after = 'z'): OoxmlPart {
  return parseDoc(
    `<w:p><w:r><w:t>${before}</w:t></w:r>` +
      `<w:sdt><w:sdtPr><w:tag w:val="customer"/>${BINDING}<w:text/></w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>${held}</w:t></w:r></w:sdtContent></w:sdt>` +
      `<w:r><w:t>${after}</w:t></w:r></w:p>`
  );
}

describe('ordinary editing inside a bound block control is refused', () => {
  test('typing is refused with bound, not with locked', () => {
    const part = boundBlock();
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: 0,
        text: 'x',
      })
    ).toBe('bound');
  });

  test('deleting is refused', () => {
    const part = boundBlock();
    expect(
      refusal(part, { op: 'deleteText', paragraphId: firstParagraph(part).id, start: 0, end: 2 })
    ).toBe('bound');
  });

  test('formatting is refused, because a run property is content too', () => {
    const part = boundBlock();
    expect(
      refusal(part, {
        op: 'setRunProperties',
        paragraphId: firstParagraph(part).id,
        start: 0,
        end: 4,
        properties: [{ localName: 'b', namespaceUri: W, attributes: [] }],
      })
    ).toBe('bound');
  });

  test('splitting the bound paragraph is refused', () => {
    const part = boundBlock();
    expect(
      refusal(part, { op: 'splitParagraph', paragraphId: firstParagraph(part).id, offset: 2 })
    ).toBe('bound');
  });

  test('the file is unchanged after every one of those refusals', () => {
    const part = boundBlock();
    const before = serializeOoxmlPart(part);
    refusal(part, { op: 'insertText', paragraphId: firstParagraph(part).id, offset: 0, text: 'x' });
    refusal(part, { op: 'deleteText', paragraphId: firstParagraph(part).id, start: 0, end: 2 });
    expect(serializeOoxmlPart(part)).toBe(before);
    expect(before).toContain('w:dataBinding');
  });

  test('content outside the bound control is still editable', () => {
    const part = boundBlock();
    const outside = paragraphs(part)[1]!;
    expect(
      refusal(part, { op: 'insertText', paragraphId: outside.id, offset: 0, text: 'x' })
    ).toBeNull();
  });
});

describe('ordinary editing inside a bound inline control is refused', () => {
  test('typing inside its characters is refused', () => {
    const part = boundInline();
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: 3,
        text: 'x',
      })
    ).toBe('bound');
  });

  test('typing beside it is allowed', () => {
    const part = boundInline();
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: 0,
        text: 'x',
      })
    ).toBeNull();
  });

  test('a deletion crossing its boundary is refused whole', () => {
    const part = boundInline('abc');
    expect(
      refusal(part, { op: 'deleteText', paragraphId: firstParagraph(part).id, start: 1, end: 5 })
    ).toBe('bound');
  });

  test('formatting its characters is refused', () => {
    const part = boundInline();
    const control = contentControlsIn(part.root)[0]!;
    const span = paragraphOffsetIndex(firstParagraph(part)).spanOf(control.node)!;
    expect(
      refusal(part, {
        op: 'setRunProperties',
        paragraphId: firstParagraph(part).id,
        start: span.start,
        end: span.end,
        properties: [{ localName: 'b', namespaceUri: W, attributes: [] }],
      })
    ).toBe('bound');
  });
});

describe('a bound control is refused by every mutating path, not just the text ones', () => {
  test('accepting a tracked change inside it is refused', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="c"/>${BINDING}</w:sdtPr><w:sdtContent>` +
        `<w:p><w:ins w:id="1" w:author="QA" w:date="2026-03-26T11:00:00Z">` +
        `<w:r><w:t>added</w:t></w:r></w:ins></w:p></w:sdtContent></w:sdt>`
    );
    expect(refusal(part, { op: 'acceptRevision', revision: { id: '1', author: 'QA' } })).toBe(
      'bound'
    );
  });

  test('deleting the block that holds its value is refused', () => {
    const part = boundBlock();
    expect(refusal(part, { op: 'deleteBlock', blockId: firstParagraph(part).id })).toBe('bound');
  });

  test('a value write is refused as it always was', () => {
    const part = boundBlock();
    const control = contentControlsIn(part.root)[0]!;
    expect(
      refusal(part, {
        op: 'setContentControlValue',
        controlId: control.node.id,
        value: { kind: 'text', text: 'other' },
      })
    ).toBe('bound');
  });

  test('a metadata write is allowed: a tag is not the bound value', () => {
    const part = boundBlock();
    const control = contentControlsIn(part.root)[0]!;
    const written = apply(part, {
      op: 'setContentControlProperties',
      controlId: control.node.id,
      tag: 'renamed',
    });
    const xml = serializeOoxmlPart(written);
    expect(xml).toContain('w:val="renamed"');
    expect(xml).toContain('w:dataBinding');
  });
});

// WRAPPER REMOVAL IS ALLOWED, AND THIS IS THE DECISION.
//
// The desync the `bound` refusal prevents is content changing while a control still claims to
// mirror a part. Removing the control removes the claim: afterwards nothing in the document says
// the text is a projection of anything, and the custom XML part is exactly as the file wrote it.
// Refusing removal instead would make a bound control indelible — Word removes it, and a template
// author who wants their content back would have no way to get it.
describe('removing a bound control is allowed, and takes the binding with it', () => {
  test('keeping the content leaves the characters and drops the binding', () => {
    const part = boundBlock();
    const control = contentControlsIn(part.root)[0]!;
    const written = apply(part, {
      op: 'removeContentControl',
      controlId: control.node.id,
      keepContent: true,
    });
    const xml = serializeOoxmlPart(written);
    expect(xml).toContain('Acme');
    expect(xml).not.toContain('w:dataBinding');
    expect(contentControlsIn(written.root)).toHaveLength(0);
  });

  test('taking the content takes the binding with it', () => {
    const part = boundBlock();
    const control = contentControlsIn(part.root)[0]!;
    const written = apply(part, {
      op: 'removeContentControl',
      controlId: control.node.id,
      keepContent: false,
    });
    const xml = serializeOoxmlPart(written);
    expect(xml).not.toContain('Acme');
    expect(xml).not.toContain('w:dataBinding');
  });

  test('but a lock still refuses the removal, binding or not', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="c"/><w:lock w:val="sdtLocked"/>${BINDING}</w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>Acme</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    const control = contentControlsIn(part.root)[0]!;
    expect(
      refusal(part, { op: 'removeContentControl', controlId: control.node.id, keepContent: true })
    ).toBe('locked');
  });
});

describe('nesting: a binding on either side is enough to refuse', () => {
  test('an unbound control inside a bound one is still refused', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/>${BINDING}</w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>deep</w:t></w:r></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>`
    );
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: 0,
        text: 'x',
      })
    ).toBe('bound');
  });

  test('a bound control inside an unbound one refuses its own content', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${BINDING}</w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>deep</w:t></w:r></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>`
    );
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: 0,
        text: 'x',
      })
    ).toBe('bound');
  });

  test('a bound sibling does not refuse an edit to the unbound one', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="bound"/>${BINDING}</w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>Acme</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `<w:sdt><w:sdtPr><w:tag w:val="free"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>free</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    const free = paragraphs(part)[1]!;
    expect(
      refusal(part, { op: 'insertText', paragraphId: free.id, offset: 0, text: 'x' })
    ).toBeNull();
  });
});

// A CALLER THAT NAMES THE CONTROL IT WRITES INTO IS STILL WRITING INTO IT. `insertText.inside`
// classifies the operation as a value write addressed AT a control, which is exactly the write a
// binding refuses — the name changes where the text goes, not whether the document may hold it.
describe('naming the control does not get around its binding', () => {
  const boundInline = () =>
    parseDoc(
      `<w:p><w:r><w:t>abc</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="f"/>` +
        `<w:dataBinding w:xpath="/a/b" w:storeItemID="{2C0E8B1A-1111-2222-3333-444455556666}"/>` +
        `</w:sdtPr><w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
        `<w:r><w:t>xyz</w:t></w:r></w:p>`
    );

  test('an insertion naming a bound control is refused at its trailing edge', () => {
    const part = boundInline();
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: paragraphs(part)[0]!.id,
        offset: 6,
        text: 'PWNED',
        inside: contentControlsIn(part.root)[0]!.node.id,
      })
    ).toBe('bound');
  });

  test('and at its leading edge', () => {
    const part = boundInline();
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: paragraphs(part)[0]!.id,
        offset: 3,
        text: 'PWNED',
        inside: contentControlsIn(part.root)[0]!.node.id,
      })
    ).toBe('bound');
  });

  test('and the content the file wrote is still the content it holds', () => {
    const part = boundInline();
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: paragraphs(part)[0]!.id,
      offset: 6,
      text: 'PWNED',
      inside: contentControlsIn(part.root)[0]!.node.id,
    });
    expect(result.ok).toBe(false);
    expect(serializeOoxmlPart(part)).not.toContain('PWNED');
  });

  test('a bound BLOCK control refuses a named insertion too', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="b"/>` +
        `<w:dataBinding w:xpath="/a/b" w:storeItemID="{2C0E8B1A-1111-2222-3333-444455556666}"/>` +
        `</w:sdtPr><w:sdtContent><w:p><w:r><w:t>MID</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: paragraphs(part)[0]!.id,
        offset: 3,
        text: 'PWNED',
        inside: contentControlsIn(part.root)[0]!.node.id,
      })
    ).toBe('bound');
  });
});
