// An inline control's lock, and the ops that address its characters by offset.
//
// A BLOCK CONTROL IS AN ANCESTOR OF WHAT IT PROTECTS; AN INLINE ONE IS A DESCENDANT. A lock
// resolved by walking a paragraph's ancestors therefore answers "unlocked" for every inline
// control in the document — the paragraph is outside the control, so nothing about the paragraph
// is locked — while the characters the op names sit inside it. The offsets are the only place the
// two meet, so the lock has to be resolved against the RANGE an op addresses and not only against
// the node it names.

import { describe, expect, test } from 'bun:test';
import {
  contentControlPropertiesOf,
  contentControlTextOf,
  contentControlsIn,
  paragraphOffsetIndex,
  readOoxmlPart,
  serializeOoxmlPart,
  storyParagraphs,
  bodyStoryRoot,
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

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`,
    docMeta
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstParagraph(part: OoxmlPart): OoxmlParagraphNode {
  const body = bodyStoryRoot(part);
  const found = body ? storyParagraphs(body)[0] : undefined;
  if (!found || found.kind !== 'paragraph') throw new Error('no paragraph');
  return found;
}

function refusal(part: OoxmlPart, op: TreeDocOp): TreeOpRejection | null {
  const result = applyTreeOp(part, op);
  return result.ok ? null : result.reason;
}

function applied(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.part;
}

/** The characters the one control encloses — where an edge insertion actually went. */
function controlTextOf(part: OoxmlPart): string {
  const control = contentControlsIn(part.root)[0];
  if (!control) throw new Error('no control');
  return contentControlTextOf(control.node);
}

function textOf(part: OoxmlPart): string {
  const collect = (node: OoxmlNode): string => {
    if (node.kind === 'textValue') return node.value;
    return node.children.map(collect).join('');
  };
  return collect(part.root);
}

/** `before` + a locked inline control holding `held` + `after`, all in one paragraph. */
function inlineLocked(lock: string, before = 'a', held = 'LOCKED', after = 'z'): OoxmlPart {
  return parseDoc(
    `<w:p><w:r><w:t>${before}</w:t></w:r>` +
      `<w:sdt><w:sdtPr><w:tag w:val="field"/><w:lock w:val="${lock}"/></w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>${held}</w:t></w:r></w:sdtContent></w:sdt>` +
      `<w:r><w:t>${after}</w:t></w:r></w:p>`
  );
}

/** Where the one inline control's characters are, in the paragraph's own offsets. */
function controlSpan(part: OoxmlPart): { readonly start: number; readonly end: number } {
  const control = contentControlsIn(part.root)[0];
  if (!control) throw new Error('no control');
  const span = paragraphOffsetIndex(firstParagraph(part)).spanOf(control.node);
  if (!span) throw new Error('the control has no span');
  return span;
}

describe('an inline control refuses the ops that address its characters', () => {
  test('an insertion inside the control is refused', () => {
    const part = inlineLocked('sdtContentLocked');
    const paragraph = firstParagraph(part);
    expect(
      refusal(part, { op: 'insertText', paragraphId: paragraph.id, offset: 3, text: 'x' })
    ).toBe('locked');
  });

  test('a deletion inside the control is refused', () => {
    const part = inlineLocked('sdtContentLocked');
    const paragraph = firstParagraph(part);
    expect(refusal(part, { op: 'deleteText', paragraphId: paragraph.id, start: 2, end: 4 })).toBe(
      'locked'
    );
  });

  test('formatting the characters inside the control is refused', () => {
    const part = inlineLocked('sdtContentLocked');
    const paragraph = firstParagraph(part);
    expect(
      refusal(part, {
        op: 'setRunProperties',
        paragraphId: paragraph.id,
        start: 1,
        end: 7,
        properties: [{ localName: 'b', namespaceUri: W, attributes: [] }],
      })
    ).toBe('locked');
  });

  test('contentLocked refuses the same three, because it is the content half', () => {
    const paragraph = (part: OoxmlPart) => firstParagraph(part).id;
    const insert = inlineLocked('contentLocked');
    const remove = inlineLocked('contentLocked');
    const format = inlineLocked('contentLocked');
    expect(
      refusal(insert, { op: 'insertText', paragraphId: paragraph(insert), offset: 3, text: 'x' })
    ).toBe('locked');
    expect(
      refusal(remove, { op: 'deleteText', paragraphId: paragraph(remove), start: 2, end: 4 })
    ).toBe('locked');
    expect(
      refusal(format, {
        op: 'setRunProperties',
        paragraphId: paragraph(format),
        start: 2,
        end: 4,
        properties: [{ localName: 'i', namespaceUri: W, attributes: [] }],
      })
    ).toBe('locked');
  });

  // `sdtLocked` protects the control, not its characters — the same asymmetry the block case
  // already pins. An inline control must not be stricter than a block one about the same lock.
  test('sdtLocked leaves the characters inside it editable', () => {
    const part = inlineLocked('sdtLocked');
    const paragraph = firstParagraph(part);
    expect(
      refusal(part, { op: 'insertText', paragraphId: paragraph.id, offset: 3, text: 'x' })
    ).toBeNull();
  });

  test('an explicitly unlocked inline control is editable', () => {
    const part = inlineLocked('unlocked');
    const paragraph = firstParagraph(part);
    expect(
      refusal(part, { op: 'insertText', paragraphId: paragraph.id, offset: 3, text: 'x' })
    ).toBeNull();
  });
});

describe('the boundary is where the refusal starts and stops', () => {
  test('an edit entirely before the control is allowed', () => {
    const part = inlineLocked('sdtContentLocked', 'abc');
    const paragraph = firstParagraph(part);
    // 'abc' occupies [0,3); the control starts at 3.
    expect(
      refusal(part, { op: 'deleteText', paragraphId: paragraph.id, start: 0, end: 3 })
    ).toBeNull();
  });

  test('an edit entirely after the control is allowed', () => {
    const part = inlineLocked('sdtContentLocked', 'a', 'LOCKED', 'xyz');
    const paragraph = firstParagraph(part);
    const span = controlSpan(part);
    expect(
      refusal(part, {
        op: 'deleteText',
        paragraphId: paragraph.id,
        start: span.end,
        end: span.end + 3,
      })
    ).toBeNull();
  });

  test('a deletion crossing into the control is refused whole, not clipped', () => {
    const part = inlineLocked('sdtContentLocked', 'abc');
    const paragraph = firstParagraph(part);
    const before = textOf(part);
    // Starts in ordinary text and ends inside the control.
    expect(refusal(part, { op: 'deleteText', paragraphId: paragraph.id, start: 1, end: 5 })).toBe(
      'locked'
    );
    expect(textOf(part)).toBe(before);
  });

  test('a deletion crossing out of the control is refused too', () => {
    const part = inlineLocked('sdtContentLocked', 'abc', 'LOCKED', 'xyz');
    const paragraph = firstParagraph(part);
    const span = controlSpan(part);
    expect(
      refusal(part, {
        op: 'deleteText',
        paragraphId: paragraph.id,
        start: span.end - 2,
        end: span.end + 2,
      })
    ).toBe('locked');
  });

  test('a deletion spanning the whole control from outside on both sides is refused', () => {
    const part = inlineLocked('sdtContentLocked', 'abc', 'LOCKED', 'xyz');
    const paragraph = firstParagraph(part);
    expect(refusal(part, { op: 'deleteText', paragraphId: paragraph.id, start: 0, end: 12 })).toBe(
      'locked'
    );
  });

  // THE TWO EDGES ARE NOT THE SAME PLACE for a control that takes typing. The applier owns a
  // boundary offset by the run that STARTS there, so content inserted at an unlocked control's
  // leading edge lands in its first run, and content inserted at the trailing edge lands in
  // whatever follows. A control that typing can never enter (content lock, data binding,
  // checkbox, picture) is left at BOTH edges, because its first run is a place no keystroke can
  // land. Validation reads the same landing, or a locked field could be typed into from the front.
  describe('which side of a control edge an insertion lands on', () => {
    test('unlocked: text typed at the leading edge lands inside', () => {
      const part = inlineLocked('unlocked', 'abc', 'MID', 'xyz');
      const span = controlSpan(part);
      const written = applied(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: span.start,
        text: '#',
      });
      expect(controlTextOf(written)).toBe('#MID');
    });

    test('unlocked: text typed at the trailing edge lands outside', () => {
      const part = inlineLocked('unlocked', 'abc', 'MID', 'xyz');
      const span = controlSpan(part);
      const written = applied(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: span.end,
        text: '#',
      });
      expect(controlTextOf(written)).toBe('MID');
      expect(textOf(written)).toContain('MID#xyz');
    });

    test('locked: text typed at the leading edge lands beside the control', () => {
      const part = inlineLocked('sdtContentLocked', 'abc', 'MID', 'xyz');
      const span = controlSpan(part);
      const written = applied(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: span.start,
        text: '#',
      });
      expect(controlTextOf(written)).toBe('MID');
      expect(textOf(written)).toContain('abc#MID');
    });

    test('locked: text typed one character inside the control is refused', () => {
      const part = inlineLocked('sdtContentLocked', 'abc', 'MID', 'xyz');
      const span = controlSpan(part);
      expect(
        refusal(part, {
          op: 'insertText',
          paragraphId: firstParagraph(part).id,
          offset: span.start + 1,
          text: '#',
        })
      ).toBe('locked');
    });

    test('locked: the trailing edge is allowed, and the control is unchanged', () => {
      const part = inlineLocked('sdtContentLocked', 'abc', 'MID', 'xyz');
      const span = controlSpan(part);
      const written = applied(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: span.end,
        text: '#',
      });
      expect(controlTextOf(written)).toBe('MID');
    });

    // Every op that writes content at an offset lands in the same place, so every one of them
    // meets the same edge rule.
    test('a tab, a line break and a page break at the leading edge land beside it too', () => {
      for (const build of [
        (paragraphId: string, offset: number): TreeDocOp => ({
          op: 'insertTab',
          paragraphId,
          offset,
        }),
        (paragraphId: string, offset: number): TreeDocOp => ({
          op: 'insertHardBreak',
          paragraphId,
          offset,
        }),
        (paragraphId: string, offset: number): TreeDocOp => ({
          op: 'insertPageBreak',
          paragraphId,
          offset,
        }),
      ]) {
        const part = inlineLocked('sdtContentLocked', 'abc', 'MID', 'xyz');
        const span = controlSpan(part);
        const paragraphId = firstParagraph(part).id;
        expect(controlTextOf(applied(part, build(paragraphId, span.start)))).toBe('MID');
        expect(refusal(part, build(paragraphId, span.start + 1))).toBe('locked');
      }
    });

    // The other side of the rule: an op that writes NOTHING into the control at that offset must
    // not be refused for standing next to it. A comment marker and a paragraph split both leave
    // the control's content exactly as it was, at either edge.
    test('a comment marker and a split at the leading edge are allowed', () => {
      const marked = inlineLocked('sdtContentLocked', 'abc');
      const split = inlineLocked('sdtContentLocked', 'abc');
      const span = controlSpan(marked);
      expect(
        refusal(marked, {
          op: 'insertCommentMarker',
          paragraphId: firstParagraph(marked).id,
          offset: span.start,
          commentId: '1',
          marker: 'start',
        })
      ).toBeNull();
      expect(
        refusal(split, {
          op: 'splitParagraph',
          paragraphId: firstParagraph(split).id,
          offset: span.start,
        })
      ).toBeNull();
    });

    test('a nested control’s leading edge lands beside the locked outer control', () => {
      const part = parseDoc(
        `<w:p><w:r><w:t>a</w:t></w:r>` +
          `<w:sdt><w:sdtPr><w:tag w:val="outer"/><w:lock w:val="contentLocked"/></w:sdtPr>` +
          `<w:sdtContent><w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr>` +
          `<w:sdtContent><w:r><w:t>deep</w:t></w:r></w:sdtContent></w:sdt></w:sdtContent></w:sdt>` +
          `<w:r><w:t>z</w:t></w:r></w:p>`
      );
      // Both controls start at offset 1. The outer lock covers the inner control, so the text
      // leaves both of them; one character further in, the outer lock refuses it.
      const paragraphId = firstParagraph(part).id;
      const written = applied(part, { op: 'insertText', paragraphId, offset: 1, text: '#' });
      expect(textOf(written)).toBe('a#deepz');
      expect(controlTextOf(written)).toBe('deep');
      expect(refusal(part, { op: 'insertText', paragraphId, offset: 2, text: '#' })).toBe('locked');
    });
  });

  // An empty range was already refused as a range before any lock was consulted, and it stays
  // that way: the lock must not be the thing that answers, or the reason a caller reads for a
  // malformed op would depend on whether some control happened to be nearby.
  test('a zero-width deletion is refused as a range, not as a lock', () => {
    const part = inlineLocked('sdtContentLocked', 'abc');
    const span = controlSpan(part);
    expect(
      refusal(part, {
        op: 'deleteText',
        paragraphId: firstParagraph(part).id,
        start: span.start,
        end: span.start,
      })
    ).toBe('invalid-range');
  });
});

describe('nesting and siblings resolve the same way inline as they do for blocks', () => {
  test('an unlocked inline control inside a locked one is still locked', () => {
    const part = parseDoc(
      `<w:p><w:r><w:t>a</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="outer"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:sdt><w:sdtPr><w:tag w:val="inner"/><w:lock w:val="unlocked"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>deep</w:t></w:r></w:sdtContent></w:sdt></w:sdtContent></w:sdt>` +
        `<w:r><w:t>z</w:t></w:r></w:p>`
    );
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: 3,
        text: 'x',
      })
    ).toBe('locked');
  });

  test('one locked control does not lock its unlocked sibling', () => {
    const part = parseDoc(
      `<w:p>` +
        `<w:sdt><w:sdtPr><w:tag w:val="one"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>AAA</w:t></w:r></w:sdtContent></w:sdt>` +
        `<w:sdt><w:sdtPr><w:tag w:val="two"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>BBB</w:t></w:r></w:sdtContent></w:sdt>` +
        `</w:p>`
    );
    const paragraph = firstParagraph(part).id;
    // 'AAA' is [0,3) inside the locked one; 'BBB' is [3,6) inside the unlocked one.
    expect(refusal(part, { op: 'insertText', paragraphId: paragraph, offset: 1, text: 'x' })).toBe(
      'locked'
    );
    expect(
      refusal(part, { op: 'insertText', paragraphId: paragraph, offset: 4, text: 'x' })
    ).toBeNull();
  });

  test('a block control holding a paragraph that holds a locked inline control', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="block"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>a</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inline"/><w:lock w:val="contentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>LOCKED</w:t></w:r></w:sdtContent></w:sdt>` +
        `</w:p></w:sdtContent></w:sdt>`
    );
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: 3,
        text: 'x',
      })
    ).toBe('locked');
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: 0,
        text: 'x',
      })
    ).toBeNull();
  });
});

describe('the paragraph an inline control sits in is still structural', () => {
  test('splitting the paragraph inside a locked control is refused', () => {
    const part = inlineLocked('sdtContentLocked', 'abc');
    expect(
      refusal(part, { op: 'splitParagraph', paragraphId: firstParagraph(part).id, offset: 5 })
    ).toBe('locked');
  });

  test('deleting the paragraph that holds a locked inline control is refused', () => {
    const part = inlineLocked('sdtContentLocked');
    expect(refusal(part, { op: 'deleteBlock', blockId: firstParagraph(part).id })).toBe('locked');
  });

  test('joining two paragraphs moves a locked inline control whole', () => {
    // The join edits neither control: each one moves intact and keeps what it holds.
    for (const lock of ['contentLocked', 'sdtLocked', 'sdtContentLocked']) {
      const control = (tag: string) =>
        `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/><w:lock w:val="${lock}"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>LOCKED</w:t></w:r></w:sdtContent></w:sdt>`;
      const part = parseDoc(
        `<w:p><w:r><w:t>first</w:t></w:r>${control('a')}</w:p>` + `<w:p>${control('b')}</w:p>`
      );
      const body = bodyStoryRoot(part);
      const found = body ? storyParagraphs(body) : [];
      const op: TreeDocOp = { op: 'joinParagraphs', firstId: found[0]!.id, secondId: found[1]!.id };
      expect(refusal(part, op)).toBeNull();
      const result = applyTreeOp(part, op);
      expect(result.ok).toBe(true);
    }
  });

  test('joining paragraphs inside a contentLocked block control is still refused', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="block"/><w:lock w:val="contentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>a</w:t></w:r></w:p><w:p><w:r><w:t>b</w:t></w:r></w:p>` +
        `</w:sdtContent></w:sdt>`
    );
    const body = bodyStoryRoot(part);
    const found = body ? storyParagraphs(body) : [];
    expect(
      refusal(part, { op: 'joinParagraphs', firstId: found[0]!.id, secondId: found[1]!.id })
    ).toBe('locked');
  });
});

describe('removing a control nested in another', () => {
  const sdt = (tag: string, lock: string, inner: string) =>
    `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/>${lock === 'none' ? '' : `<w:lock w:val="${lock}"/>`}</w:sdtPr>` +
    `<w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
  const text = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`;
  const controlId = (part: OoxmlPart, tag: string) =>
    contentControlsIn(part.root).find(
      (entry) => contentControlPropertiesOf(entry.node).tag === tag
    )!.node.id;

  for (const [name, lock] of [
    ['an unlocked', 'none'],
    ['a contentLocked', 'contentLocked'],
  ] as const) {
    test(`${name} control inside an inline contentLocked control is refused`, () => {
      const part = parseDoc(
        `<w:p>${text('pre')}${sdt('outer', 'contentLocked', text('a') + sdt('inner', lock, text('b')))}</w:p>`
      );
      for (const keepContent of [false, true, undefined]) {
        expect(
          refusal(part, {
            op: 'removeContentControl',
            controlId: controlId(part, 'inner'),
            keepContent,
          })
        ).toBe('locked');
      }
    });

    test(`${name} control inside a block contentLocked control is refused`, () => {
      const part = parseDoc(
        sdt('outer', 'contentLocked', `<w:p>${text('a')}${sdt('inner', lock, text('b'))}</w:p>`)
      );
      expect(
        refusal(part, {
          op: 'removeContentControl',
          controlId: controlId(part, 'inner'),
          keepContent: false,
        })
      ).toBe('locked');
    });
  }

  test('a contentLocked control that holds another contentLocked control can be removed', () => {
    const part = parseDoc(
      `<w:p>${text('pre')}${sdt('outer', 'contentLocked', text('a') + sdt('inner', 'contentLocked', text('b')))}</w:p>`
    );
    const after = applied(part, {
      op: 'removeContentControl',
      controlId: controlId(part, 'outer'),
      keepContent: false,
    });
    expect(contentControlsIn(after.root)).toHaveLength(0);
  });

  test('a contentLocked control that holds an sdtLocked control is refused', () => {
    const part = parseDoc(
      `<w:p>${sdt('outer', 'contentLocked', sdt('inner', 'sdtLocked', text('b')))}</w:p>`
    );
    expect(
      refusal(part, {
        op: 'removeContentControl',
        controlId: controlId(part, 'outer'),
        keepContent: false,
      })
    ).toBe('locked');
  });
});

describe('a review decision that removes a whole locked control', () => {
  const inserted = (lock: string) =>
    parseDoc(
      `<w:p><w:r><w:t>a</w:t></w:r>` +
        `<w:ins w:id="1" w:author="X" w:date="2026-01-01T00:00:00Z">` +
        `<w:sdt><w:sdtPr><w:tag w:val="f"/><w:lock w:val="${lock}"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>LOCKED</w:t></w:r></w:sdtContent></w:sdt></w:ins></w:p>`
    );
  const reject: TreeDocOp = {
    op: 'rejectRevision',
    revision: { id: '1', author: 'X', date: '2026-01-01T00:00:00Z' },
  };

  test('rejecting an insertion that wraps a contentLocked control removes it', () => {
    const after = applied(inserted('contentLocked'), reject);
    expect(contentControlsIn(after.root)).toHaveLength(0);
  });

  // A control that cannot be removed stays as an empty shell; one whose content is locked too
  // keeps the insertion pending.
  test('rejecting an insertion that wraps an sdtLocked control keeps the control empty', () => {
    const after = applied(inserted('sdtLocked'), reject);
    expect(contentControlsIn(after.root)).toHaveLength(1);
    expect(serializeOoxmlPart(after)).not.toContain('LOCKED');
    expect(refusal(inserted('sdtContentLocked'), reject)).toBe('locked');
  });

  test('rejecting an insertion inside a contentLocked control is still refused', () => {
    const part = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="f"/><w:lock w:val="contentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>a</w:t></w:r>` +
        `<w:ins w:id="1" w:author="X" w:date="2026-01-01T00:00:00Z"><w:r><w:t>b</w:t></w:r></w:ins>` +
        `</w:sdtContent></w:sdt></w:p>`
    );
    expect(refusal(part, reject)).toBe('locked');
  });
});
