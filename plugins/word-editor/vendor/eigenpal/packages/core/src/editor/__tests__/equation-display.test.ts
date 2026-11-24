// Display equations (`m:oMathPara`) render, edit, and save.
//
// The display is one atom in the paragraph offset space. Its `m:oMath` keeps its own id
// for the equation popover, and `m:oMathParaPr/m:jc` justifies the display line.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { resolveParagraphLayoutInputs } from '@docx-editor.dev/core/layout';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const X = '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>';
const Y = '<m:oMath><m:r><m:t>y</m:t></m:r></m:oMath>';

function docx(paragraphs: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}"/>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body>${paragraphs}</w:body></w:document>`
    ),
  });
}

function mounted(paragraphs: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(paragraphs) });
  if (!editor.surface) throw new Error('surface failed to mount');
  const paragraphId = '/word/document.xml#0.0.0';
  const caret = (offset: number) =>
    editor.surface!.setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
  caret(0);
  return { editor, surface: editor.surface, caret, container };
}

function paragraphOf(xml: string): OoxmlElement {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body>${xml}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const body = read.part.root.children[0] as OoxmlElement;
  return body.children[0] as OoxmlElement;
}

describe('display equations', () => {
  test('are one atom with an editable equation', () => {
    const { surface, container } = mounted(`<w:p><m:oMathPara>${X}</m:oMathPara></w:p>`);
    expect(surface.session.bodyText()).toBe('￼');
    const equations = surface.equations.equationsInCaretParagraph();
    expect(equations).toHaveLength(1);
    expect(equations[0]).toMatchObject({ start: 0, end: 1, linear: 'x' });
    expect(container.querySelector('[data-docx-equation]')).not.toBeNull();
    container.remove();
  });

  test('replace keeps the display wrapper, and remove drops it', async () => {
    const { surface, container } = mounted(
      `<w:p><m:oMathPara><m:oMathParaPr><m:jc m:val="left"/></m:oMathParaPr>${X}</m:oMathPara></w:p>`
    );
    const equation = surface.equations.equationAtCaret()!;
    expect(surface.equations.applyEquation(equation.id, '{a}/{b}')).toBe(true);
    let xml = serializeOoxmlPart(surface.session.part());
    expect(xml).toContain('<m:oMathPara><m:oMathParaPr><m:jc m:val="left"/></m:oMathParaPr>');
    expect(xml).toContain('<m:f>');
    expect(surface.equations.removeEquation(equation.id)).toBe(true);
    xml = serializeOoxmlPart(surface.session.part());
    expect(xml).not.toContain('oMathPara');
    const saved = strFromU8(unzipSync(await surface.save())['word/document.xml']!);
    expect(saved).not.toContain('oMathPara');
    container.remove();
  });

  test('a display with two equations lists both and keeps the second after removing one', () => {
    const { surface, container } = mounted(`<w:p><m:oMathPara>${X}${Y}</m:oMathPara></w:p>`);
    const equations = surface.equations.equationsInCaretParagraph();
    expect(equations.map((equation) => equation.linear)).toEqual(['x', 'y']);
    expect(surface.equations.removeEquation(equations[0]!.id)).toBe(true);
    const xml = serializeOoxmlPart(surface.session.part());
    expect(xml).toContain('<m:oMathPara><m:oMath><m:r><m:t>y</m:t></m:r></m:oMath></m:oMathPara>');
    container.remove();
  });

  test('typing beside the display creates sibling runs, and the display saves intact', async () => {
    const { editor, surface, caret, container } = mounted(
      `<w:p><m:oMathPara>${X}</m:oMathPara></w:p>`
    );
    caret(1);
    editor.exec({ type: 'insertText', text: '!' });
    caret(0);
    editor.exec({ type: 'insertText', text: 'A' });
    expect(surface.session.bodyText()).toBe('A￼!');
    const saved = strFromU8(unzipSync(await surface.save())['word/document.xml']!);
    expect(saved).toMatch(/<w:r>.*A.*<\/w:r><m:oMathPara>.*<\/m:oMathPara><w:r>.*!.*<\/w:r>/);
    container.remove();
  });

  test('justify from m:oMathParaPr and center by default', () => {
    const inputs = (xml: string) => resolveParagraphLayoutInputs(paragraphOf(xml), 400, undefined);
    expect(inputs(`<w:p><m:oMathPara>${X}</m:oMathPara></w:p>`).alignment).toBe('center');
    expect(
      inputs(
        `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><m:oMathPara><m:oMathParaPr>` +
          `<m:jc m:val="left"/></m:oMathParaPr>${X}</m:oMathPara></w:p>`
      ).alignment
    ).toBe('left');
    // Text beside the display keeps the paragraph justification.
    expect(
      inputs(`<w:p><w:r><w:t>see</w:t></w:r><m:oMathPara>${X}</m:oMathPara></w:p>`).alignment
    ).toBe('left');
  });
});
