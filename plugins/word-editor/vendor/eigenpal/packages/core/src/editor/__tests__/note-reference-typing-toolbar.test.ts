// The toolbar at a caret right after a note reference shows the face that typing writes:
// the text before the reference, else the text after it, else the paragraph mark. Never
// the reference's own superscript, bold, or color. Presses there, and beside a locked
// content control, toggle that same face.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const STYLES =
  `<w:styles xmlns:w="${W}"><w:style w:type="character" w:styleId="FootnoteReference">` +
  '<w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>' +
  '</w:style><w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/>' +
  '<w:rPr><w:b/></w:rPr></w:style></w:styles>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${R}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId8" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r>` +
        '<w:r><w:t>Note</w:t></w:r></w:p></w:footnote></w:footnotes>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  });
}

const reference = (rPr: string) =>
  `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/>${rPr}</w:rPr>` +
  '<w:footnoteReference w:id="1"/></w:r>';
const text = (value: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${value}</w:t></w:r>`;
const BOLD_RED = '<w:b/><w:color w:val="FF0000"/>';

function withSurface(body: string, run: (surface: PaginatedSurface) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(`<w:p>${body}</w:p>`));
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

function caretAt(surface: PaginatedSurface, offset: number): void {
  const id = surface.session.paragraphIds()[0]!;
  surface.setSelection({ anchor: { paragraphId: id, offset }, head: { paragraphId: id, offset } });
}

/** The run that holds `typed`, as its run properties, `name` or `name=val`. */
function faceOfTyped(surface: PaginatedSurface, typed: string): string[] | undefined {
  let found: string[] | undefined;
  const walk = (node: OoxmlNode): void => {
    if (found || node.kind === 'textValue') return;
    if (node.kind === 'run') {
      const holds = node.children.some(
        (child) =>
          child.kind === 'text' &&
          child.children.some((value) => value.kind === 'textValue' && value.value === typed)
      );
      if (holds) {
        const rPr = node.children.find((child) => child.kind === 'runProperties');
        found =
          rPr && rPr.kind !== 'textValue'
            ? rPr.children.flatMap((p) => {
                if (p.kind === 'textValue') return [];
                const val = p.attributes.find((entry) => entry.localName === 'val')?.value;
                return [val === undefined ? p.localName : `${p.localName}=${val}`];
              })
            : [];
      }
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(surface.session.part().root);
  return found;
}

interface ToolbarCase {
  readonly name: string;
  readonly body: string;
  readonly offset: number;
  readonly italic: boolean;
  readonly bold: boolean;
  readonly underline: boolean;
  readonly face: readonly string[];
}

const CASES: readonly ToolbarCase[] = [
  {
    name: 'italic text, bold red reference',
    body: text('Alpha', '<w:i/>') + reference(BOLD_RED),
    offset: 6,
    italic: true,
    bold: false,
    underline: false,
    face: ['i'],
  },
  {
    name: 'bold text, bold reference, bold text',
    body: text('India', '<w:b/>') + reference('<w:b/>') + text(' rest', '<w:b/>'),
    offset: 6,
    italic: false,
    bold: true,
    underline: false,
    face: ['b'],
  },
  {
    name: 'reference first, underlined text after it',
    body: reference('<w:b/>') + text('Charl', '<w:u w:val="single"/>'),
    offset: 1,
    italic: false,
    bold: false,
    underline: true,
    face: ['u=single'],
  },
  {
    name: 'reference alone, italic paragraph mark',
    body: '<w:pPr><w:rPr><w:i/></w:rPr></w:pPr>' + reference('<w:b/>'),
    offset: 1,
    italic: true,
    bold: false,
    underline: false,
    face: ['i'],
  },
  {
    name: 'plain text, bold red reference',
    body: text('Bravo') + reference(BOLD_RED),
    offset: 6,
    italic: false,
    bold: false,
    underline: false,
    face: [],
  },
];

for (const { name, body, offset, italic, bold, underline, face } of CASES) {
  test(`after a note reference the toolbar matches what typing writes: ${name}`, () => {
    withSurface(body, (surface) => {
      caretAt(surface, offset);
      const before = surface.formatting();
      expect(before.italic).toBe(italic);
      expect(before.bold).toBe(bold);
      expect(before.underline).toBe(underline);
      expect(before.superscript).toBe(false);
      surface.type('x');
      expect(faceOfTyped(surface, 'x')).toEqual([...face]);
      const after = surface.formatting();
      expect(after.italic).toBe(italic);
      expect(after.bold).toBe(bold);
      expect(after.underline).toBe(underline);
      surface.undo();
      expect(faceOfTyped(surface, 'x')).toBeUndefined();
    });
  });
}

const PRESSES = [
  {
    name: 'italic text before the reference',
    body: text('Alpha', '<w:i/>') + reference(BOLD_RED),
    offset: 6,
  },
  {
    name: 'italic paragraph mark, reference alone',
    body: '<w:pPr><w:rPr><w:i/></w:rPr></w:pPr>' + reference('<w:b/>'),
    offset: 1,
  },
] as const;

for (const { name, body, offset } of PRESSES) {
  test(`after a note reference a press turns off the face typing takes: ${name}`, () => {
    withSurface(body, (surface) => {
      caretAt(surface, offset);
      expect(surface.formatting().italic).toBe(true);
      surface.toggleRunProperty('i');
      expect(surface.formatting().italic).toBe(false);
      surface.type('x');
      expect(faceOfTyped(surface, 'x')).toEqual(['i=0']);
      expect(surface.formatting().italic).toBe(false);
    });
  });
}

test('after a note reference a press turns on a property the face lacks', () => {
  withSurface(text('Alpha', '<w:i/>') + reference(BOLD_RED), (surface) => {
    caretAt(surface, 6);
    expect(surface.formatting().bold).toBe(false);
    surface.toggleRunProperty('b');
    expect(surface.formatting().bold).toBe(true);
    surface.type('x');
    expect(faceOfTyped(surface, 'x')?.sort()).toEqual(['b', 'i']);
  });
});

test('after a note reference alone the toolbar reads the mark character style', () => {
  withSurface(
    '<w:pPr><w:rPr><w:rStyle w:val="Strong"/></w:rPr></w:pPr>' + reference('<w:i/>'),
    (surface) => {
      caretAt(surface, 1);
      expect(surface.formatting().bold).toBe(true);
      expect(surface.formatting().italic).toBe(false);
      surface.type('x');
      expect(faceOfTyped(surface, 'x')).toEqual(['rStyle=Strong']);
    }
  );
});

test('after a note reference alone a press turns off the bold of the mark style', () => {
  withSurface(
    '<w:pPr><w:rPr><w:rStyle w:val="Strong"/></w:rPr></w:pPr>' + reference(''),
    (surface) => {
      caretAt(surface, 1);
      surface.toggleRunProperty('b');
      expect(surface.formatting().bold).toBe(false);
      surface.type('x');
      expect(faceOfTyped(surface, 'x')).toEqual(['rStyle=Strong', 'b=0']);
    }
  );
});

test('after a reference that ends a hyperlink the toolbar reads no face', () => {
  withSurface(
    text('Alpha', '<w:i/>') + `<w:hyperlink w:anchor="target">${reference(BOLD_RED)}</w:hyperlink>`,
    (surface) => {
      caretAt(surface, 6);
      expect(surface.formatting().italic).toBe(false);
      expect(surface.formatting().bold).toBe(false);
      surface.type('x');
      expect(faceOfTyped(surface, 'x')).toEqual([]);
    }
  );
});

const LOCKED =
  '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
  '<w:r><w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr><w:t>[1]</w:t></w:r></w:sdtContent></w:sdt>';

test('after a bold locked control a Bold press turns on bold over the text face', () => {
  withSurface(text('see ', '<w:i/>') + LOCKED, (surface) => {
    caretAt(surface, 7);
    expect(surface.formatting().bold).toBe(false);
    surface.toggleRunProperty('b');
    expect(surface.formatting().bold).toBe(true);
    surface.type('x');
    expect(faceOfTyped(surface, 'x')?.sort()).toEqual(['b', 'i']);
  });
});

test('after a bold locked control an Italic press turns off the text face', () => {
  withSurface(text('see ', '<w:i/>') + LOCKED, (surface) => {
    caretAt(surface, 7);
    expect(surface.formatting().italic).toBe(true);
    surface.toggleRunProperty('i');
    expect(surface.formatting().italic).toBe(false);
    surface.type('x');
    expect(faceOfTyped(surface, 'x')).toEqual(['i=0']);
  });
});
