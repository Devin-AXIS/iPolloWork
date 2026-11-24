// A lock is enforced by the STORE, not by the widget.
//
// The proof that matters is a refusal from a path that never touches a surface: every keyboard
// gesture, every toolbar command and every automation call funnels into the same ops, so a lock
// checked in validation is a lock every caller meets. A lock checked in a React component is a
// lock a script walks straight past.

import { describe, expect, test } from 'bun:test';
import {
  bodyStoryRoot,
  contentControlsIn,
  readOoxmlPart,
  resolveContentControlLock,
  storyParagraphs,
  type OoxmlNode,
  type OoxmlPart,
} from '../index.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import { contentLockPolicyOf } from '../store/content-lock-policy.ts';
import { formsProtectionCommandRefusal } from '../store/forms-protection-command.ts';
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

function paragraphs(part: OoxmlPart): readonly OoxmlNode[] {
  const body = bodyStoryRoot(part);
  return body ? storyParagraphs(body) : [];
}

function refusal(part: OoxmlPart, op: TreeDocOp): TreeOpRejection | null {
  const result = applyTreeOp(part, op);
  return result.ok ? null : result.reason;
}

function locked(lock: string, inner = `<w:p><w:r><w:t>text</w:t></w:r></w:p>`): OoxmlPart {
  return parseDoc(
    `<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="${lock}"/></w:sdtPr>` +
      `<w:sdtContent>${inner}</w:sdtContent></w:sdt>` +
      `<w:p><w:r><w:t>outside</w:t></w:r></w:p>`
  );
}

describe('ST_Lock is resolved for every value the schema declares', () => {
  test('contentLocked and sdtContentLocked refuse an edit inside the control', () => {
    for (const lock of ['contentLocked', 'sdtContentLocked']) {
      const part = locked(lock);
      const inside = paragraphs(part)[0]!;
      expect(
        refusal(part, { op: 'insertText', paragraphId: inside.id, offset: 0, text: 'x' })
      ).toBe('locked');
      expect(refusal(part, { op: 'deleteText', paragraphId: inside.id, start: 0, end: 1 })).toBe(
        'locked'
      );
      expect(
        refusal(part, {
          op: 'setRunProperties',
          paragraphId: inside.id,
          start: 0,
          end: 1,
          properties: [{ localName: 'b' }],
        })
      ).toBe('locked');
    }
  });

  test('sdtLocked leaves the content editable and refuses removal', () => {
    const part = locked('sdtLocked');
    const inside = paragraphs(part)[0]!;
    expect(refusal(part, { op: 'insertText', paragraphId: inside.id, offset: 0, text: 'x' })).toBe(
      null
    );
    expect(
      refusal(part, {
        op: 'removeContentControl',
        controlId: contentControlsIn(part.root)[0]!.node.id,
        keepContent: true,
      })
    ).toBe('locked');
  });

  test('contentLocked leaves the control removable', () => {
    const part = locked('contentLocked');
    expect(
      refusal(part, {
        op: 'removeContentControl',
        controlId: contentControlsIn(part.root)[0]!.node.id,
        keepContent: true,
      })
    ).toBe(null);
  });

  test('an explicit unlocked control is editable', () => {
    const part = locked('unlocked');
    const inside = paragraphs(part)[0]!;
    expect(refusal(part, { op: 'insertText', paragraphId: inside.id, offset: 0, text: 'x' })).toBe(
      null
    );
  });

  test('content outside the control is untouched by its lock', () => {
    const part = locked('sdtContentLocked');
    const outside = paragraphs(part)[1]!;
    expect(refusal(part, { op: 'insertText', paragraphId: outside.id, offset: 0, text: 'x' })).toBe(
      null
    );
  });
});

describe('nesting resolves conservatively', () => {
  test('an unlocked control inside a locked one is still locked', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:lock w:val="unlocked"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>inner</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt>`
    );
    const inside = paragraphs(part)[0]!;
    expect(refusal(part, { op: 'insertText', paragraphId: inside.id, offset: 0, text: 'x' })).toBe(
      'locked'
    );
  });

  test('the two halves of the lock combine rather than override', () => {
    expect(resolveContentControlLock(['sdtLocked', 'contentLocked'])).toBe('sdtContentLocked');
    expect(resolveContentControlLock(['unlocked', 'sdtLocked'])).toBe('sdtLocked');
    expect(resolveContentControlLock([])).toBe('unlocked');
  });

  test('removing an unlocked control whose ancestor forbids removal is refused', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:lock w:val="sdtLocked"/></w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>inner</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt>`
    );
    const inner = contentControlsIn(part.root)[1]!.node.id;
    expect(refusal(part, { op: 'removeContentControl', controlId: inner, keepContent: true })).toBe(
      'locked'
    );
  });
});

describe('a refusal is atomic', () => {
  test('a block delete that would take a locked control with it is refused whole', () => {
    const part = parseDoc(
      `<w:tbl><w:tr><w:tc>` +
        `<w:sdt><w:sdtPr><w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>inside</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `</w:tc></w:tr></w:tbl>`
    );
    const inside = paragraphs(part)[0]!;
    const before = JSON.stringify(part.root);
    expect(refusal(part, { op: 'deleteBlock', blockId: inside.id })).toBe('locked');
    expect(JSON.stringify(part.root)).toBe(before);
  });

  test('a value write on a locked control is refused and changes nothing', () => {
    const part = locked('sdtContentLocked');
    const control = contentControlsIn(part.root)[0]!.node.id;
    const before = JSON.stringify(part.root);
    expect(
      refusal(part, {
        op: 'setContentControlValue',
        controlId: control,
        value: { kind: 'text', text: 'x' },
      })
    ).toBe('locked');
    expect(JSON.stringify(part.root)).toBe(before);
  });

  test('a locked control refuses a metadata write as well as a value one', () => {
    const part = locked('sdtContentLocked');
    const control = contentControlsIn(part.root)[0]!.node.id;
    expect(refusal(part, { op: 'setContentControlProperties', controlId: control, tag: 't' })).toBe(
      'locked'
    );
  });
});

describe('contentLockPolicy: formatting passes the content half of a lock (opt-in)', () => {
  const policy = { allowFormattingInLockedContent: true } as const;

  function refusalWith(part: OoxmlPart, op: TreeDocOp): TreeOpRejection | null {
    const result = applyTreeOp(part, op, { contentLockPolicy: policy });
    return result.ok ? null : result.reason;
  }

  /** `ABC[TOKEN]DEF` in one paragraph; TOKEN is an inline control with the given lock. */
  function token(lock: string, extra = ''): OoxmlPart {
    return parseDoc(
      `<w:p><w:r><w:t>ABC</w:t></w:r><w:sdt><w:sdtPr><w:tag w:val="t"/>` +
        `<w:lock w:val="${lock}"/>${extra}</w:sdtPr><w:sdtContent><w:r><w:t>TOKEN</w:t></w:r>` +
        `</w:sdtContent></w:sdt><w:r><w:t>DEF</w:t></w:r></w:p>`
    );
  }
  const bold = (paragraphId: string, start: number, end: number): TreeDocOp => ({
    op: 'setRunProperties',
    paragraphId,
    start,
    end,
    properties: [{ localName: 'b' }],
  });

  test('without the policy formatting is refused like every other write', () => {
    for (const lock of ['contentLocked', 'sdtContentLocked']) {
      const part = token(lock);
      const id = paragraphs(part)[0]!.id;
      expect(refusal(part, bold(id, 3, 8))).toBe('locked');
      expect(refusal(part, bold(id, 0, 11))).toBe('locked');
    }
  });

  test('with the policy formatting passes over the control and over text around it', () => {
    for (const lock of ['contentLocked', 'sdtContentLocked', 'sdtLocked', 'unlocked']) {
      const part = token(lock);
      const id = paragraphs(part)[0]!.id;
      expect(refusalWith(part, bold(id, 3, 8))).toBe(null);
      expect(refusalWith(part, bold(id, 0, 11))).toBe(null);
    }
    const part = token('sdtContentLocked');
    const result = applyTreeOp(part, bold(paragraphs(part)[0]!.id, 3, 8), {
      contentLockPolicy: policy,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(JSON.stringify(result.part.root).includes('"localName":"b"')).toBe(true);
    // the lock itself is untouched
    expect(JSON.stringify(result.part.root).includes('sdtContentLocked')).toBe(true);
  });

  test('with the policy text edits, deletion and wrapper removal are still refused', () => {
    for (const lock of ['contentLocked', 'sdtContentLocked']) {
      const part = token(lock);
      const id = paragraphs(part)[0]!.id;
      expect(refusalWith(part, { op: 'insertText', paragraphId: id, offset: 5, text: 'x' })).toBe(
        'locked'
      );
      expect(refusalWith(part, { op: 'deleteText', paragraphId: id, start: 3, end: 8 })).toBe(
        'locked'
      );
      expect(refusalWith(part, { op: 'deleteText', paragraphId: id, start: 2, end: 9 })).toBe(
        'locked'
      );
    }
    const wrapper = token('sdtContentLocked');
    expect(
      refusalWith(wrapper, {
        op: 'removeContentControl',
        controlId: contentControlsIn(wrapper.root)[0]!.node.id,
        keepContent: true,
      })
    ).toBe('locked');
  });

  test('with the policy a data-bound control still refuses formatting', () => {
    const part = token(
      'sdtContentLocked',
      `<w:dataBinding w:xpath="/a/b" w:storeItemID="{11111111-1111-1111-1111-111111111111}"/>`
    );
    const id = paragraphs(part)[0]!.id;
    expect(refusalWith(part, bold(id, 3, 8))).toBe('bound');
  });
  test('with the policy a paragraph mark in a content-locked block control can be restyled', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>TOKEN</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    const id = paragraphs(part)[0]!.id;
    const mark: TreeDocOp = {
      op: 'setParagraphMarkProperties',
      paragraphId: id,
      properties: [{ localName: 'b' }],
    };
    expect(refusal(part, mark)).toBe('locked');
    expect(refusalWith(part, mark)).toBe(null);
    expect(refusalWith(part, bold(id, 0, 5))).toBe(null);
    expect(
      refusalWith(part, {
        op: 'setParagraphProperties',
        paragraphId: id,
        properties: [{ localName: 'jc', attributes: { val: 'center' } }],
      })
    ).toBe(null);
  });

  test('with the policy a write that hides text is still refused', () => {
    for (const localName of ['vanish', 'specVanish', 'webHidden']) {
      const part = token('sdtContentLocked');
      const id = paragraphs(part)[0]!.id;
      const hide: TreeDocOp = {
        op: 'setRunProperties',
        paragraphId: id,
        start: 3,
        end: 8,
        properties: [{ localName: 'b' }, { localName }],
      };
      expect(refusalWith(part, hide)).toBe('locked');
    }
    const block = parseDoc(
      `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>TOKEN</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    expect(
      refusalWith(block, {
        op: 'setParagraphMarkProperties',
        paragraphId: paragraphs(block)[0]!.id,
        properties: [{ localName: 'vanish' }],
      })
    ).toBe('locked');
  });

  test('with the policy a tracked restyle is still refused', () => {
    // Its format revision would sit inside the lock, where accept and reject are refused.
    const revision = { author: 'A', date: '2026-01-01T00:00:00Z' };
    const part = token('sdtContentLocked');
    const id = paragraphs(part)[0]!.id;
    expect(refusalWith(part, { ...bold(id, 3, 8), revision } as TreeDocOp)).toBe('locked');
    expect(refusalWith(part, { ...bold(id, 0, 3), revision } as TreeDocOp)).toBe(null);
    const block = parseDoc(
      `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>TOKEN</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    expect(
      refusalWith(block, {
        op: 'setParagraphMarkProperties',
        paragraphId: paragraphs(block)[0]!.id,
        properties: [{ localName: 'b' }],
        revision,
      })
    ).toBe('locked');
  });

  test('the store keeps a frozen copy of the flags set to true', () => {
    expect(contentLockPolicyOf(undefined)).toBeUndefined();
    expect(contentLockPolicyOf({})).toBeUndefined();
    expect(contentLockPolicyOf({ allowFormattingInLockedContent: false })).toBeUndefined();
    const host = { allowFormattingInLockedContent: true };
    const kept = contentLockPolicyOf(host)!;
    expect(kept).toEqual({ allowFormattingInLockedContent: true });
    expect(Object.isFrozen(kept)).toBe(true);
    host.allowFormattingInLockedContent = false;
    expect(kept.allowFormattingInLockedContent).toBe(true);
  });

  test('under forms protection the preflight answers as the commit does', () => {
    const settingsResult = readOoxmlPart(
      `<w:settings xmlns:w="${W}"><w:documentProtection w:edit="forms" w:enforcement="1"/></w:settings>`,
      {
        name: '/word/settings.xml',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
      }
    );
    if (!settingsResult.ok) throw new Error(settingsResult.reason);
    const settings = settingsResult.part;
    const part = token('sdtContentLocked');
    const id = paragraphs(part)[0]!.id;
    const selection = {
      anchor: { paragraphId: id, offset: 4 },
      head: { paragraphId: id, offset: 7 },
    };
    const format = { selection, intent: 'runFormat' } as const;
    expect(formsProtectionCommandRefusal(part, settings, format)).toBe('locked');
    expect(
      formsProtectionCommandRefusal(part, settings, { ...format, contentLockPolicy: policy })
    ).toBe(null);
    expect(
      formsProtectionCommandRefusal(part, settings, {
        selection,
        intent: 'text',
        text: 'x',
        contentLockPolicy: policy,
      })
    ).toBe('locked');
  });
});
