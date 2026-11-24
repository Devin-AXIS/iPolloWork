// Document-property fields (TITLE, AUTHOR, SUBJECT, KEYWORDS, LASTSAVEDBY, COMMENTS, and the
// generic DOCPROPERTY "Name") paint their value from the parsed document properties when the
// field carries no cached result of its own — exactly like Word.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  type DocumentProperties,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { piecesOfParagraph } from '../field-projection.ts';
import { docPropertyValue, parseDocPropertyInstruction } from '../field-doc-property.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const PROPS: DocumentProperties = Object.freeze({
  title: 'Sample Title',
  creator: 'A. Author',
  subject: 'Sample Subject',
  keywords: 'alpha, beta',
  lastModifiedBy: 'B. Editor',
  description: 'Sample Comments',
});

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

function project(
  body: string,
  props: DocumentProperties | undefined = PROPS,
  mode: RevisionDisplayMode = 'all-markup'
) {
  return piecesOfParagraph(
    paragraphOf(body),
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    mode,
    undefined,
    undefined,
    undefined,
    undefined,
    props
  );
}

/** A complex field: begin/instr[/separate + result]/end. `chromeRpr` styles the chrome runs. */
function complexField(instr: string, result?: string, chromeRpr = ''): string {
  const middle =
    result === undefined
      ? ''
      : `<w:r>${chromeRpr}<w:fldChar w:fldCharType="separate"/></w:r>` + result;
  return (
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r>${chromeRpr}<w:instrText>${instr}</w:instrText></w:r>` +
    middle +
    `<w:r>${chromeRpr}<w:fldChar w:fldCharType="end"/></w:r>`
  );
}

const CASES: ReadonlyArray<readonly [string, string]> = [
  ['TITLE', 'Sample Title'],
  ['AUTHOR', 'A. Author'],
  ['SUBJECT', 'Sample Subject'],
  ['KEYWORDS', 'alpha, beta'],
  ['LASTSAVEDBY', 'B. Editor'],
  ['COMMENTS', 'Sample Comments'],
];

describe('a complex document-property field with no cached result', () => {
  for (const [keyword, value] of CASES) {
    test(`${keyword} paints its property value over one atom unit`, () => {
      const pieces = project(
        `<w:p><w:r><w:t>A</w:t></w:r>${complexField(` ${keyword} `)}<w:r><w:t>B</w:t></w:r></w:p>`
      );
      expect(pieces.map((piece) => piece.text)).toEqual(['A', value, 'B']);
      expect(pieces[1]).toMatchObject({ start: 1, end: 2, projected: true });
      expect(pieces[1]!.fieldAtom).toEqual({ formField: false });
    });
  }

  test('the separate + EMPTY result shape synthesizes too', () => {
    const pieces = project(`<w:p>${complexField(' TITLE ', '')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['Sample Title']);
  });

  test('a trailing \\* Upper format switch is stripped (value painted verbatim, not re-cased)', () => {
    const pieces = project(`<w:p>${complexField(' AUTHOR \\* Upper ')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['A. Author']);
  });
});

describe('a simple document-property field', () => {
  for (const [keyword, value] of CASES) {
    test(`fldSimple ${keyword} paints its property value`, () => {
      const pieces = project(`<w:p><w:fldSimple w:instr=" ${keyword} "></w:fldSimple></w:p>`);
      expect(pieces.map((piece) => piece.text)).toEqual([value]);
      expect(pieces[0]).toMatchObject({ start: 0, end: 1, projected: true });
    });
  }
});

describe('DOCPROPERTY "Name"', () => {
  test('a known name maps to its property (complex)', () => {
    const pieces = project(`<w:p>${complexField(' DOCPROPERTY "Author" ')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['A. Author']);
  });

  test('a known name maps to its property (simple, case-insensitive)', () => {
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" DOCPROPERTY &quot;title&quot; "></w:fldSimple></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Sample Title']);
  });

  test('an unknown name stays inert (paints nothing)', () => {
    const pieces = project(
      `<w:p><w:r><w:t>A</w:t></w:r>${complexField(' DOCPROPERTY "CustomThing" ')}<w:r><w:t>B</w:t></w:r></w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'B']);
  });
});

describe('when a cached result exists', () => {
  test('the cached result wins over the property value (complex)', () => {
    const pieces = project(`<w:p>${complexField(' TITLE ', '<w:r><w:t>Cached</w:t></w:r>')}</w:p>`);
    expect(pieces.map((piece) => piece.text)).toEqual(['Cached']);
  });

  test('the cached result wins over the property value (simple)', () => {
    const pieces = project(
      '<w:p><w:fldSimple w:instr=" TITLE "><w:r><w:t>Cached</w:t></w:r></w:fldSimple></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Cached']);
  });

  test('a cached result that exists but is hidden stays hidden — no synthesis', () => {
    const pieces = project(
      `<w:p>${complexField(
        ' TITLE ',
        '<w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden</w:t></w:r>'
      )}<w:r><w:t>B</w:t></w:r></w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['B']);
  });
});

describe('suppression', () => {
  test('vanish chrome paints nothing but keeps the unit (complex)', () => {
    const pieces = project(
      '<w:p><w:r><w:t>A</w:t></w:r>' +
        complexField(' TITLE ', undefined, '<w:rPr><w:vanish/></w:rPr>') +
        '<w:r><w:t>B</w:t></w:r></w:p>'
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'B']);
    expect(pieces[1]).toMatchObject({ start: 2, end: 3 });
  });

  test('a tracked-deleted field is gone from the proposed result', () => {
    const pieces = project(
      `<w:p><w:del w:id="1" w:author="A">${complexField(' TITLE ')}</w:del></w:p>`,
      PROPS,
      'proposed'
    );
    expect(pieces.map((piece) => piece.text)).toEqual([]);
  });

  test('a missing property paints nothing (complex and simple)', () => {
    const noTitle: DocumentProperties = { creator: 'A. Author' };
    expect(
      project(
        `<w:p><w:r><w:t>A</w:t></w:r>${complexField(' TITLE ')}<w:r><w:t>B</w:t></w:r></w:p>`,
        noTitle
      ).map((piece) => piece.text)
    ).toEqual(['A', 'B']);
    expect(
      project('<w:p><w:fldSimple w:instr=" TITLE "></w:fldSimple></w:p>', noTitle).map(
        (piece) => piece.text
      )
    ).toEqual([]);
  });

  test('no documentProperties supplied paints nothing (the furniture-pass degradation)', () => {
    // The 12th argument is omitted entirely, the degradation a furniture-only pass gets.
    const pieces = piecesOfParagraph(
      paragraphOf(`<w:p>${complexField(' TITLE ')}</w:p>`),
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      'all-markup'
    );
    expect(pieces.map((piece) => piece.text)).toEqual([]);
  });
});

describe('a value with XML-special characters', () => {
  // The painted piece carries the RAW value — escaping happens at paint time via textContent,
  // never as markup — so the layout text must equal the property string exactly.
  const raw = 'Jones & Co <Legal> "Draft"';
  const hostile: DocumentProperties = { title: raw };

  test('complex TITLE carries the raw value verbatim', () => {
    const pieces = project(`<w:p>${complexField(' TITLE ')}</w:p>`, hostile);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.text).toBe(raw);
  });

  test('simple TITLE carries the raw value verbatim', () => {
    const pieces = project('<w:p><w:fldSimple w:instr=" TITLE "></w:fldSimple></w:p>', hostile);
    expect(pieces[0]!.text).toBe(raw);
  });
});

describe('parseDocPropertyInstruction / docPropertyValue', () => {
  test('bare keywords map to their property key', () => {
    expect(parseDocPropertyInstruction(' TITLE ')).toEqual({ property: 'title' });
    expect(parseDocPropertyInstruction('AUTHOR')).toEqual({ property: 'creator' });
    expect(parseDocPropertyInstruction('LastSavedBy')).toEqual({ property: 'lastModifiedBy' });
    expect(parseDocPropertyInstruction('COMMENTS')).toEqual({ property: 'description' });
  });

  test('a trailing format switch is stripped for recognition', () => {
    expect(parseDocPropertyInstruction(' TITLE \\* MERGEFORMAT ')).toEqual({ property: 'title' });
    expect(parseDocPropertyInstruction(' AUTHOR \\* Upper ')).toEqual({ property: 'creator' });
  });

  test('DOCPROPERTY maps a known quoted name, rejects an unknown one', () => {
    expect(parseDocPropertyInstruction(' DOCPROPERTY "Subject" ')).toEqual({ property: 'subject' });
    expect(parseDocPropertyInstruction(' DOCPROPERTY "Nope" ')).toBeNull();
  });

  test('a non-property keyword and a glued keyword are not matched', () => {
    expect(parseDocPropertyInstruction(' PAGE ')).toBeNull();
    expect(parseDocPropertyInstruction('TITLEX')).toBeNull();
    expect(parseDocPropertyInstruction('DOCPROPERTYX "Author"')).toBeNull();
  });

  test('docPropertyValue returns null for a missing or empty property', () => {
    expect(docPropertyValue({ property: 'title' }, undefined)).toBeNull();
    expect(docPropertyValue({ property: 'title' }, {})).toBeNull();
    expect(docPropertyValue({ property: 'title' }, { title: 'X' })).toBe('X');
  });
});
