// Forms protection is the OTHER half of "the document says no".
//
// A control's own `w:lock` protects the control. `w:documentProtection w:edit="forms"` inverts
// the question for the whole document: nothing is editable EXCEPT what sits inside a control,
// so the same op that a lock refuses inside is refused outside. The two are resolved in one
// place because a caller only ever sees one refusal.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  contentControlsIn,
  paragraphOffsetIndex,
  readOoxmlPackage,
  type OoxmlPackage,
  type OoxmlParagraphNode,
} from '../index.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { formsProtectionRefusal } from '../store/tree-op-content-controls.ts';
import type { TreeDocOp, TreeOpRejection } from '../store/tree-op-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

function build(body: string, settingsInner: string): OoxmlPackage {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdSet" Type="${R}/settings" Target="settings.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    'word/settings.xml': strToU8(`<w:settings xmlns:w="${W}">${settingsInner}</w:settings>`),
  });
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

/** Paragraph ids in document order, flattening the control wrapper. */
function paragraphIds(pkg: OoxmlPackage): string[] {
  const ids: string[] = [];
  const walk = (node: { kind: string; children: readonly never[]; id: string }): void => {
    if (node.kind === 'paragraph') {
      ids.push(node.id);
      return;
    }
    for (const child of node.children) walk(child);
  };
  const main = pkg.parts.get(pkg.mainDocumentPart)!;
  walk(main.root as never);
  return ids;
}

const BODY =
  `<w:sdt><w:sdtPr><w:tag w:val="field"/></w:sdtPr><w:sdtContent>` +
  `<w:p><w:r><w:t>inside</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
  `<w:p><w:r><w:t>outside</w:t></w:r></w:p>` +
  `<w:sectPr/>`;

const FORMS = '<w:documentProtection w:edit="forms" w:enforcement="1"/>';

function refusal(pkg: OoxmlPackage, op: TreeDocOp): TreeOpRejection | null {
  const store = new TreeDocumentStore(pkg, pkg.mainDocumentPart);
  const result = store.transact((ctx) => {
    ctx.apply(op);
  });
  return result.ok ? null : result.reason;
}

describe('forms protection inverts what is editable', () => {
  test('content outside every control is refused', () => {
    const pkg = build(BODY, FORMS);
    const outside = paragraphIds(pkg)[1]!;
    expect(refusal(pkg, { op: 'insertText', paragraphId: outside, offset: 0, text: 'x' })).toBe(
      'locked'
    );
  });

  test('content inside an unlocked control is still editable', () => {
    const pkg = build(BODY, FORMS);
    const inside = paragraphIds(pkg)[0]!;
    expect(
      refusal(pkg, { op: 'insertText', paragraphId: inside, offset: 0, text: 'x' })
    ).toBeNull();
  });

  test('the control itself cannot be removed while forms protection holds', () => {
    const pkg = build(BODY, FORMS);
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const control = findControlId(main.root as never);
    expect(
      refusal(pkg, { op: 'removeContentControl', controlId: control, keepContent: true })
    ).toBe('locked');
  });

  test('a tracked deletion of exactly a contentLocked inline field is refused', () => {
    const inline =
      `<w:p><w:r><w:t>ab</w:t></w:r><w:sdt><w:sdtPr><w:tag w:val="f"/>` +
      `<w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:r><w:t>REF</w:t></w:r>` +
      `</w:sdtContent></w:sdt><w:r><w:t>cd</w:t></w:r></w:p><w:sectPr/>`;
    const pkg = build(inline, FORMS);
    const paragraphId = paragraphIds(pkg)[0]!;
    expect(
      refusal(pkg, {
        op: 'deleteText',
        paragraphId,
        start: 2,
        end: 5,
        revision: { author: 'A', date: '2026-01-01T00:00:00Z' },
      })
    ).toBe('locked');
  });

  test('enforcement="0" is a stored preference, not a protection', () => {
    const pkg = build(BODY, '<w:documentProtection w:edit="forms" w:enforcement="0"/>');
    const outside = paragraphIds(pkg)[1]!;
    expect(
      refusal(pkg, { op: 'insertText', paragraphId: outside, offset: 0, text: 'x' })
    ).toBeNull();
  });

  // Read-only and comments-only are document-wide, not inverted: nothing is editable, not
  // even inside a control. The tracked-changes mode is answered by the editing-mode gate.
  for (const mode of ['readOnly', 'comments'] as const) {
    test(`enforced ${mode} protection refuses every content edit, inside a control too`, () => {
      const pkg = build(BODY, `<w:documentProtection w:edit="${mode}" w:enforcement="1"/>`);
      const [inside, outside] = paragraphIds(pkg);
      for (const paragraphId of [inside!, outside!]) {
        expect(refusal(pkg, { op: 'insertText', paragraphId, offset: 0, text: 'x' })).toBe(
          'locked'
        );
      }
    });
  }

  test('enforced tracked-changes protection leaves the store editable', () => {
    const pkg = build(BODY, '<w:documentProtection w:edit="trackedChanges" w:enforcement="1"/>');
    const outside = paragraphIds(pkg)[1]!;
    expect(
      refusal(pkg, { op: 'insertText', paragraphId: outside, offset: 0, text: 'x' })
    ).toBeNull();
  });

  test('a section that turns form protection off is editable outside controls', () => {
    const pkg = build(
      `<w:p><w:r><w:t>outside</w:t></w:r></w:p>` +
        `<w:sectPr><w:formProt w:val="false"/></w:sectPr>`,
      FORMS
    );
    const outside = paragraphIds(pkg)[0]!;
    expect(
      refusal(pkg, { op: 'insertText', paragraphId: outside, offset: 0, text: 'x' })
    ).toBeNull();
  });
});

// AN INLINE CONTROL IS THE FORM FIELD Word protects, and the paragraph around it is not.
//
// Resolving the exemption from the node an op NAMES answers "not inside a control" for every
// inline field in every protected document — the paragraph is outside the control, so the whole
// paragraph reads as protected and the field cannot be filled in. That is the failure a forms
// document exists to avoid. The exemption is resolved from the RANGE the op addresses, with the
// same edge rule the lock uses: the leading edge is inside, the trailing edge is not.
describe('forms protection over an inline field', () => {
  /** `before` + an inline control holding `held` + `after`, in one protected paragraph. */
  const inlineBody = (lock = '', before = 'abc', held = 'MID', after = 'xyz') =>
    `<w:p><w:r><w:t>${before}</w:t></w:r>` +
    `<w:sdt><w:sdtPr><w:tag w:val="field"/>${lock ? `<w:lock w:val="${lock}"/>` : ''}</w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>${held}</w:t></w:r></w:sdtContent></w:sdt>` +
    `<w:r><w:t>${after}</w:t></w:r></w:p>` +
    `<w:sectPr/>`;

  /** Where the one inline control's characters are, in the paragraph's own offsets. */
  function span(pkg: OoxmlPackage): { readonly start: number; readonly end: number } {
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const control = contentControlsIn(main.root)[0];
    if (!control) throw new Error('no control');
    const paragraph = firstParagraph(main.root as never);
    const found = paragraphOffsetIndex(paragraph).spanOf(control.node);
    if (!found) throw new Error('the control has no span');
    return found;
  }

  const typeAt = (pkg: OoxmlPackage, offset: number): TreeOpRejection | null =>
    refusal(pkg, { op: 'insertText', paragraphId: paragraphIds(pkg)[0]!, offset, text: 'x' });

  test('typing inside the field is allowed', () => {
    const pkg = build(inlineBody(), FORMS);
    expect(typeAt(pkg, span(pkg).start + 1)).toBeNull();
  });

  test('a trailing smart tag resolves as content of the form field', () => {
    const pkg = build(
      '<w:p><w:sdt><w:sdtPr><w:tag w:val="field"/></w:sdtPr><w:sdtContent>' +
        '<w:smartTag><w:r><w:t>MID</w:t></w:r></w:smartTag>' +
        '</w:sdtContent></w:sdt></w:p><w:sectPr/>',
      FORMS
    );
    expect(typeAt(pkg, span(pkg).end)).toBeNull();
  });

  test('every terminal point insertion uses its applier placement under forms protection', () => {
    const body =
      '<w:p><w:sdt><w:sdtPr><w:tag w:val="field"/></w:sdtPr><w:sdtContent>' +
      '<w:smartTag><w:r><w:t>MID</w:t></w:r></w:smartTag>' +
      '</w:sdtContent></w:sdt></w:p><w:sectPr/>';
    const fragmentSource = build('<w:p><w:r><w:t>rich</w:t></w:r></w:p><w:sectPr/>', '');
    const fragmentPart = fragmentSource.parts.get(fragmentSource.mainDocumentPart)!;
    const fragment = firstParagraph(fragmentPart.root as never);
    const pkg = build(body, FORMS);
    const paragraphId = paragraphIds(pkg)[0]!;
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const settings = pkg.parts.get('/word/settings.xml')!;
    const field = contentControlsIn(main.root)[0]!.node;
    const allowed: readonly TreeDocOp[] = [
      { op: 'insertText', paragraphId, offset: 3, text: 'X' },
      { op: 'insertTab', paragraphId, offset: 3 },
      { op: 'insertHardBreak', paragraphId, offset: 3 },
      { op: 'insertPageBreak', paragraphId, offset: 3 },
      { op: 'insertPageField', paragraphId, offset: 3, field: 'PAGE' },
    ];
    for (const op of allowed) {
      expect(formsProtectionRefusal(main, settings, op)).toBeNull();
      const store = new TreeDocumentStore(pkg, pkg.mainDocumentPart);
      const result = store.transact((ctx) => ctx.apply(op));
      expect(result.ok).toBe(true);
      const paragraph = firstParagraph(store.part.root as never);
      expect(paragraphOffsetIndex(paragraph).spanOf(field)?.end).toBe(4);
    }
    expect(
      formsProtectionRefusal(main, settings, {
        op: 'insertNote',
        paragraphId,
        offset: 3,
        noteKind: 'footnote',
        revision: { author: 'Reviewer' },
      })
    ).toBeNull();

    const refused: readonly TreeDocOp[] = [
      { op: 'insertInlineContentControl', paragraphId, offset: 3, tag: 'new', text: 'X' },
      { op: 'insertFragment', paragraphId, offset: 3, blocks: [fragment] },
      { op: 'insertCommentMarker', paragraphId, offset: 3, commentId: '1', marker: 'start' },
      { op: 'insertNote', paragraphId, offset: 3, noteKind: 'footnote' },
    ];
    for (const op of refused) {
      expect(formsProtectionRefusal(main, settings, op)).toBe('locked');
    }
    expect(refusal(pkg, refused[0]!)).toBe('locked');
    expect(refusal(pkg, refused[1]!)).toBe('locked');
    expect(refusal(pkg, refused[2]!)).toBe('locked');

    for (const makeOp of [
      (id: string): TreeDocOp => ({
        op: 'insertInlineContentControl',
        paragraphId: id,
        offset: 3,
        tag: 'new',
        text: 'X',
      }),
      (id: string): TreeDocOp => ({
        op: 'insertFragment',
        paragraphId: id,
        offset: 3,
        blocks: [fragment],
      }),
    ]) {
      const editable = build(body, '');
      const editableMain = editable.parts.get(editable.mainDocumentPart)!;
      const originalControl = contentControlsIn(editableMain.root)[0]!.node;
      const editableParagraph = paragraphIds(editable)[0]!;
      const store = new TreeDocumentStore(editable, editable.mainDocumentPart);
      const result = store.transact((ctx) => ctx.apply(makeOp(editableParagraph)));
      expect(result.ok).toBe(true);
      const paragraph = firstParagraph(store.part.root as never);
      expect(paragraphOffsetIndex(paragraph).spanOf(originalControl)?.end).toBe(3);
      expect(paragraphOffsetIndex(paragraph).length).toBeGreaterThan(3);
    }
  });

  test('typing at the leading edge is allowed, because the text lands inside', () => {
    const pkg = build(inlineBody(), FORMS);
    expect(typeAt(pkg, span(pkg).start)).toBeNull();
  });

  test('typing at the trailing edge is refused, because the text lands outside', () => {
    const pkg = build(inlineBody(), FORMS);
    expect(typeAt(pkg, span(pkg).end)).toBe('locked');
  });

  test('typing in the text beside the field is refused', () => {
    const pkg = build(inlineBody(), FORMS);
    expect(typeAt(pkg, 1)).toBe('locked');
  });

  test('a deletion wholly inside the field is allowed', () => {
    const pkg = build(inlineBody(), FORMS);
    const extent = span(pkg);
    expect(
      refusal(pkg, {
        op: 'deleteText',
        paragraphId: paragraphIds(pkg)[0]!,
        start: extent.start,
        end: extent.end,
      })
    ).toBeNull();
  });

  test('a deletion crossing out of the field is refused', () => {
    const pkg = build(inlineBody(), FORMS);
    const extent = span(pkg);
    expect(
      refusal(pkg, {
        op: 'deleteText',
        paragraphId: paragraphIds(pkg)[0]!,
        start: extent.start,
        end: extent.end + 1,
      })
    ).toBe('locked');
  });

  test('formatting the field’s own characters is allowed', () => {
    const pkg = build(inlineBody(), FORMS);
    const extent = span(pkg);
    expect(
      refusal(pkg, {
        op: 'setRunProperties',
        paragraphId: paragraphIds(pkg)[0]!,
        start: extent.start,
        end: extent.end,
        properties: [{ localName: 'b', namespaceUri: W, attributes: [] }],
      })
    ).toBeNull();
  });

  test('the field’s own lock still refuses, protection or not', () => {
    const pkg = build(inlineBody('contentLocked'), FORMS);
    expect(typeAt(pkg, span(pkg).start + 1)).toBe('locked');
  });

  test('a field nested inside a block control is reachable through both', () => {
    const pkg = build(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>abc</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
        `</w:p></w:sdtContent></w:sdt><w:sectPr/>`,
      FORMS
    );
    expect(typeAt(pkg, 1)).toBeNull();
    expect(typeAt(pkg, 4)).toBeNull();
  });

  // A WRITE THAT CLAIMS TO BE FILLING IN A FIELD HAS TO BE. `insertText.inside` classifies the
  // operation as addressed at a control, which is the one reach forms protection exempts, so a
  // name nobody checked is a way to write anywhere in a protected document by asserting that the
  // write was a field. The exemption holds only for a name that resolves to a real control which
  // really encloses the write.
  describe('a forged owner does not buy the exemption', () => {
    test('naming the paragraph itself is refused', () => {
      const pkg = build(inlineBody(), FORMS);
      const paragraph = paragraphIds(pkg)[0]!;
      expect(
        refusal(pkg, {
          op: 'insertText',
          paragraphId: paragraph,
          offset: 0,
          text: 'X',
          inside: paragraph,
        })
      ).not.toBeNull();
    });

    test('naming a control in another paragraph is refused', () => {
      const pkg = build(
        `<w:p><w:r><w:t>read only</w:t></w:r></w:p>` +
          `<w:p><w:sdt><w:sdtPr><w:tag w:val="f"/></w:sdtPr>` +
          `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt></w:p><w:sectPr/>`,
        FORMS
      );
      const main = pkg.parts.get(pkg.mainDocumentPart)!;
      const far = contentControlsIn(main.root)[0]!.node;
      expect(
        refusal(pkg, {
          op: 'insertText',
          paragraphId: paragraphIds(pkg)[0]!,
          offset: 0,
          text: 'X',
          inside: far.id,
        })
      ).not.toBeNull();
    });

    test('and naming the field a write really is in still fills it in', () => {
      const pkg = build(inlineBody(), FORMS);
      const main = pkg.parts.get(pkg.mainDocumentPart)!;
      const control = contentControlsIn(main.root)[0]!.node;
      expect(
        refusal(pkg, {
          op: 'insertText',
          paragraphId: paragraphIds(pkg)[0]!,
          offset: span(pkg).end,
          text: 'X',
          inside: control.id,
        })
      ).toBeNull();
    });

    test('but not when that field is locked', () => {
      const pkg = build(inlineBody('contentLocked'), FORMS);
      const main = pkg.parts.get(pkg.mainDocumentPart)!;
      const control = contentControlsIn(main.root)[0]!.node;
      expect(
        refusal(pkg, {
          op: 'insertText',
          paragraphId: paragraphIds(pkg)[0]!,
          offset: span(pkg).end,
          text: 'X',
          inside: control.id,
        })
      ).toBe('locked');
    });

    // NOR WHEN THE FIELD NAMED IS NOT THE FIELD WRITTEN INTO. An unlocked outer control is a
    // legitimate name for the exemption; the characters still land wherever the offset puts
    // them, and a nested lock is not lifted by the protection question being asked of an
    // enclosing control.
    const nestedBody = (innerProperties: string) =>
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
      `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${innerProperties}</w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
      `</w:sdtContent></w:sdt>`;

    const typeNaming = (pkg: OoxmlPackage, offset: number): TreeOpRejection | null => {
      const main = pkg.parts.get(pkg.mainDocumentPart)!;
      const outer = contentControlsIn(main.root)[0]!.node;
      return refusal(pkg, {
        op: 'insertText',
        paragraphId: paragraphIds(pkg)[0]!,
        offset,
        text: 'X',
        inside: outer.id,
      });
    };

    test('a locked control nested in the named one refuses the write it would receive', () => {
      const pkg = build(
        `<w:p><w:r><w:t>abc</w:t></w:r>${nestedBody('<w:lock w:val="sdtContentLocked"/>')}` +
          `<w:r><w:t>xyz</w:t></w:r></w:p><w:sectPr/>`,
        FORMS
      );
      expect(typeNaming(pkg, span(pkg).start)).toBe('locked');
      expect(typeNaming(pkg, span(pkg).end)).toBe('locked');
    });

    test('a bound one refuses it as bound', () => {
      const pkg = build(
        `<w:p><w:r><w:t>abc</w:t></w:r>` +
          nestedBody('<w:dataBinding w:xpath="/a/b" w:storeItemID="{FEED}"/>') +
          `<w:r><w:t>xyz</w:t></w:r></w:p><w:sectPr/>`,
        FORMS
      );
      expect(typeNaming(pkg, span(pkg).end)).toBe('bound');
    });

    test('and an unlocked nested control is still fillable under protection', () => {
      const pkg = build(
        `<w:p><w:r><w:t>abc</w:t></w:r>${nestedBody('')}<w:r><w:t>xyz</w:t></w:r></w:p>` +
          `<w:sectPr/>`,
        FORMS
      );
      expect(typeNaming(pkg, span(pkg).end)).toBeNull();
    });

    // AND WHEN THE WRITE HAS NO RUN TO JOIN. The forms exemption is resolved at the package gate,
    // before validation, so the empty-paragraph landing has to be resolved there as well or a
    // protected document hands the nested lock the same exemption the outer name bought.
    const emptyNestedBody = (innerProperties: string) =>
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
      `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${innerProperties}</w:sdtPr>` +
      `<w:sdtContent><w:p/></w:sdtContent></w:sdt>` +
      `</w:sdtContent></w:sdt>`;

    test('a locked control holding the empty paragraph refuses the minted run', () => {
      const pkg = build(
        `${emptyNestedBody('<w:lock w:val="sdtContentLocked"/>')}<w:sectPr/>`,
        FORMS
      );
      expect(typeNaming(pkg, 0)).toBe('locked');
    });

    test('a bound one holding it refuses as bound', () => {
      const pkg = build(
        `${emptyNestedBody('<w:dataBinding w:xpath="/a/b" w:storeItemID="{FEED}"/>')}<w:sectPr/>`,
        FORMS
      );
      expect(typeNaming(pkg, 0)).toBe('bound');
    });

    test('an unlocked one holding it is still fillable under protection', () => {
      const pkg = build(`${emptyNestedBody('')}<w:sectPr/>`, FORMS);
      expect(typeNaming(pkg, 0)).toBeNull();
    });
  });

  test('a paragraph-wide property write is still refused: that is not filling in a field', () => {
    const pkg = build(inlineBody(), FORMS);
    expect(
      refusal(pkg, {
        op: 'setParagraphProperties',
        paragraphId: paragraphIds(pkg)[0]!,
        properties: [],
      })
    ).toBe('locked');
  });
});

function firstParagraph(node: { kind: string; children: readonly never[] }): OoxmlParagraphNode {
  if (node.kind === 'paragraph') return node as unknown as OoxmlParagraphNode;
  for (const child of node.children) {
    const found = firstParagraph(child);
    if (found) return found;
  }
  return undefined as unknown as OoxmlParagraphNode;
}

function findControlId(node: { kind: string; id: string; children: readonly never[] }): string {
  if (node.kind === 'contentControl') return node.id;
  for (const child of node.children) {
    const found = findControlId(child);
    if (found) return found;
  }
  return '';
}
