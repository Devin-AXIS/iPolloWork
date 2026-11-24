// FORMCHECKBOX / FORMDROPDOWN legacy form fields render from their `w:ffData` state.
//
// The checkbox state is the authority — Word paints ☐/☒ from `w:checked`, never from a stale
// cached glyph. The dropdown prefers its cached result (what Word last painted) and falls back
// to the selected `w:listEntry` only when the cache is empty. Everything hostile or malformed
// falls back to the previous behavior (cached text or nothing), never a throw.

import { describe, expect, test } from 'bun:test';
import {
  paragraphTextOf,
  readOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { piecesOfParagraph, type HyperlinkProjector } from '../field-projection.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function partOf(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphOf(body: string): OoxmlNode {
  const find = (node: OoxmlNode): OoxmlNode | undefined => {
    if (node.kind === 'paragraph') return node;
    if (node.kind === 'textValue') return undefined;
    for (const child of node.children ?? []) {
      const hit = find(child);
      if (hit) return hit;
    }
    return undefined;
  };
  const paragraph = find(partOf(body).root);
  if (!paragraph) throw new Error('no paragraph');
  return paragraph;
}

function project(body: string, mode: RevisionDisplayMode = 'all-markup') {
  return piecesOfParagraph(paragraphOf(body), [], undefined, undefined, undefined, undefined, mode);
}

/** FORMCHECKBOX the way Word writes it: begin(ffData)/instr/end, NO separate. */
function checkboxField(checkBoxInner: string, chromeRpr = ''): string {
  return (
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="begin">` +
    `<w:ffData><w:name w:val="Check1"/><w:enabled/><w:calcOnExit w:val="0"/>` +
    `<w:checkBox>${checkBoxInner}</w:checkBox></w:ffData>` +
    `</w:fldChar></w:r>` +
    `<w:r>${chromeRpr}<w:instrText> FORMCHECKBOX </w:instrText></w:r>` +
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="end"/></w:r>`
  );
}

/** FORMDROPDOWN the way Word writes it: begin(ffData)/instr/separate/result/end. */
function dropdownField(ddListInner: string, result = ''): string {
  return (
    `<w:r><w:fldChar w:fldCharType="begin">` +
    `<w:ffData><w:name w:val="Dropdown1"/><w:ddList>${ddListInner}</w:ddList></w:ffData>` +
    `</w:fldChar></w:r>` +
    `<w:r><w:instrText> FORMDROPDOWN </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    result +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>`
  );
}

const ENTRIES = '<w:listEntry w:val="Red"/><w:listEntry w:val="Green"/><w:listEntry w:val="Blue"/>';

describe('a FORMCHECKBOX field', () => {
  test('the no-separate shape paints an unchecked box over one atom unit', () => {
    const pieces = project(
      `<w:p><w:r><w:t>A</w:t></w:r>${checkboxField('<w:sizeAuto/>')}<w:r><w:t>B</w:t></w:r></w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', '☐', 'B']);
    const box = pieces[1]!;
    expect(box).toMatchObject({ start: 1, end: 2, projected: true });
    // The atom also carries the control state, so paint and the surface need not read the
    // glyph back to know what a press should write.
    expect(box.fieldAtom).toEqual({
      formField: true,
      formControl: { kind: 'checkbox', checked: false, accessibleName: 'Check1' },
    });
    expect(pieces[2]).toMatchObject({ start: 2, end: 3 });
  });

  test('w:checked paints the checked box', () => {
    const pieces = project(`<w:p>${checkboxField('<w:checked/><w:sizeAuto/>')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['☒']);
  });

  test('w:default is the fallback when w:checked is absent', () => {
    const pieces = project(`<w:p>${checkboxField('<w:default w:val="1"/><w:sizeAuto/>')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['☒']);
  });

  test('an explicit w:size of 24 half-points paints at 12pt', () => {
    const pieces = project(`<w:p>${checkboxField('<w:size w:val="24"/>')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['☐']);
    expect(pieces[0]!.style.fontSizePt).toBe(12);
  });

  test('the ffData state wins over a stale cached result', () => {
    const pieces = project(
      '<w:p>' +
        `<w:r><w:fldChar w:fldCharType="begin">` +
        `<w:ffData><w:checkBox><w:checked/></w:checkBox></w:ffData>` +
        `</w:fldChar></w:r>` +
        `<w:r><w:instrText> FORMCHECKBOX </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>OLD</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        '</w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['☒']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
  });

  test('hidden chrome paints nothing but keeps the unit', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        checkboxField('<w:checked/>', '<w:rPr><w:vanish/></w:rPr>') +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'B']);
    expect(pieces[1]).toMatchObject({ start: 2, end: 3 });
  });

  test('a tracked-deleted checkbox is gone from the proposed result', () => {
    const pieces = project(
      `<w:p><w:del w:id="1" w:author="A">${checkboxField('<w:checked/>')}</w:del></w:p>`,
      'proposed'
    );
    expect(pieces.map((piece) => piece.text)).toEqual([]);
  });

  test('the instruction without ffData paints nothing (fail closed)', () => {
    const pieces = project(
      '<w:p>' +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText> FORMCHECKBOX </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['B']);
    expect(pieces[0]).toMatchObject({ start: 1, end: 2 });
  });

  test('checked=0 with default=1 paints the unchecked box — w:checked wins', () => {
    const pieces = project(
      `<w:p>${checkboxField('<w:checked w:val="0"/><w:default w:val="1"/>')}</w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['☐']);
  });

  test('a tracked-inserted checkbox glyph carries the insertion in all-markup', () => {
    const pieces = project(
      `<w:p><w:ins w:id="1" w:author="A">${checkboxField('<w:checked/>')}</w:ins></w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['☒']);
    expect(pieces[0]!.revisions?.map((revision) => revision.kind)).toEqual(['insert']);
  });

  test('a checkbox inside w:hyperlink carries the enclosing link', () => {
    const link = Object.freeze({ id: 'stub', kind: 'external' as const, href: 'https://x.test' });
    const projectLink: HyperlinkProjector = () => link;
    const pieces = piecesOfParagraph(
      paragraphOf(`<w:p><w:hyperlink>${checkboxField('<w:checked/>')}</w:hyperlink></w:p>`),
      [],
      undefined,
      undefined,
      projectLink
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['☒']);
    expect(pieces[0]!.link).toBe(link);
  });

  test("FORMTEXT instruction-phase run text keeps the store's offsets and paints", () => {
    // An editable-result field is NOT atomic, so the offset authority leaves ordinary `w:t`
    // between begin and separate addressable. Layout must paint what the store addresses.
    const body =
      '<w:p><w:r><w:fldChar w:fldCharType="begin">' +
      '<w:ffData><w:name w:val="T"/><w:textInput/></w:ffData></w:fldChar></w:r>' +
      '<w:r><w:instrText> FORMTEXT </w:instrText></w:r>' +
      '<w:r><w:t>SPILL</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>typed</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    const part = partOf(body);
    const findParagraph = (node: OoxmlNode): OoxmlNode | undefined => {
      if (node.kind === 'paragraph') return node;
      if (node.kind === 'textValue') return undefined;
      for (const child of node.children ?? []) {
        const hit = findParagraph(child);
        if (hit) return hit;
      }
      return undefined;
    };
    const paragraph = findParagraph(part.root) as OoxmlNode & { id: string };
    expect(paragraphTextOf(part, paragraph.id)).toBe('SPILLtyped');
    const pieces = piecesOfParagraph(paragraph);
    expect(
      pieces.map((piece) => ({ text: piece.text, start: piece.start, end: piece.end }))
    ).toEqual([
      { text: 'SPILL', start: 0, end: 5 },
      { text: 'typed', start: 5, end: 10 },
    ]);
    // The editable result shades as a form field; the instruction-phase spill does not.
    expect(pieces[0]!.fieldAtom).toBeUndefined();
    expect(pieces[1]!.fieldAtom).toEqual({ formField: true });
  });
});

describe('a FORMDROPDOWN field', () => {
  test('a non-empty cached result wins — it is what Word last painted', () => {
    const pieces = project(
      `<w:p>${dropdownField(`<w:result w:val="1"/>${ENTRIES}`, '<w:r><w:t>Cached</w:t></w:r>')}</w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Cached']);
    expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
    expect(pieces[0]!.fieldAtom).toEqual({
      formField: true,
      formControl: {
        kind: 'dropdown',
        entries: ['Red', 'Green', 'Blue'],
        selectedIndex: 1,
        accessibleName: 'Dropdown1',
      },
    });
  });

  test('an empty cached result synthesizes the selected entry', () => {
    const pieces = project(
      `<w:p><w:r><w:t>A</w:t></w:r>${dropdownField(`<w:result w:val="1"/>${ENTRIES}`)}</w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'Green']);
    const entry = pieces[1]!;
    expect(entry).toMatchObject({ start: 1, end: 2, projected: true });
    expect(entry.fieldAtom).toEqual({
      formField: true,
      formControl: {
        kind: 'dropdown',
        entries: ['Red', 'Green', 'Blue'],
        selectedIndex: 1,
        accessibleName: 'Dropdown1',
      },
    });
  });

  test('an out-of-range result falls back to default, then to the first entry', () => {
    const viaDefault = project(
      `<w:p>${dropdownField(`<w:result w:val="9"/><w:default w:val="2"/>${ENTRIES}`)}</w:p>`
    );
    expect(viaDefault.map((piece) => piece.text)).toEqual(['Blue']);
    const viaFirst = project(
      `<w:p>${dropdownField(`<w:result w:val="9"/><w:default w:val="8"/>${ENTRIES}`)}</w:p>`
    );
    expect(viaFirst.map((piece) => piece.text)).toEqual(['Red']);
  });

  test('an empty declared choice keeps a projected hit target without adding model text', () => {
    const pieces = project(
      `<w:p>${dropdownField('<w:result w:val="0"/><w:listEntry w:val=""/><w:listEntry w:val="Blue"/>')}</w:p>`
    );
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ text: '\u00a0', start: 0, end: 1, projected: true });
    expect(pieces[0]!.fieldAtom?.formControl).toMatchObject({
      kind: 'dropdown',
      entries: ['', 'Blue'],
    });
  });
  test('an empty w:ddList paints nothing', () => {
    const pieces = project(
      `<w:p>${dropdownField('<w:result w:val="0"/>')}<w:r><w:t>B</w:t></w:r></w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['B']);
    expect(pieces[0]).toMatchObject({ start: 1, end: 2 });
  });

  test('a cached result that exists but is hidden suppresses entry synthesis', () => {
    // The file cached a result and hid it. Synthesizing the selected entry would resurrect
    // what the document hides; only a truly EMPTY cache may synthesize.
    const pieces = project(
      `<w:p>${dropdownField(
        `<w:result w:val="1"/>${ENTRIES}`,
        '<w:r><w:rPr><w:vanish/></w:rPr><w:t>OldPick</w:t></w:r>'
      )}<w:r><w:t>B</w:t></w:r></w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['B']);
    expect(pieces[0]).toMatchObject({ start: 1, end: 2 });
  });

  test('a w:del-wrapped cached result synthesizes in the proposed view only', () => {
    // The proposed view resolves the deletion away — after accepting, Word shows the
    // selected entry there. The views that keep the deletion keep the cached pick.
    const field = dropdownField(
      `<w:result w:val="1"/>${ENTRIES}`,
      '<w:del w:id="1" w:author="A"><w:r><w:delText>OldPick</w:delText></w:r></w:del>'
    );
    expect(project(`<w:p>${field}</w:p>`, 'proposed').map((piece) => piece.text)).toEqual([
      'Green',
    ]);
    expect(project(`<w:p>${field}</w:p>`).map((piece) => piece.text)).toEqual(['OldPick']);
    expect(project(`<w:p>${field}</w:p>`, 'original').map((piece) => piece.text)).toEqual([
      'OldPick',
    ]);
  });
});
