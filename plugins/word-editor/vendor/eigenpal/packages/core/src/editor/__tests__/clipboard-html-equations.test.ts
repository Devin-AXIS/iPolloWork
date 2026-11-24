// Word clipboard Office Math pastes as editable equations.
//
// fixtures/word-mac-equations.html is a Word for Mac clipboard capture of one inline
// and one display equation, with the preview pictures replaced by a 1x1 PNG.
//
// The clipboard shapes and the Mac Word equation sample come from the wordpaste
// test suite (https://github.com/smrifat1411/wordpaste, test/omml-to-latex.test.ts
// and test/word-paste-cleaner.test.ts at commit 8efd286).
// Copyright (c) 2026 Rifat Hossain. Used under the MIT License; the full license
// text is in fixtures/wordpaste-LICENSE.txt.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import {
  OFFICE_MATH_NAMESPACE_URI,
  equationExpressionToLinearMath,
  projectOmmlEquation,
  readOoxmlPackage,
  serializeOoxmlPart,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { projectExternalHtml } from '../clipboard-html-read.ts';
import { wrapInteropHtml } from '../clipboard-fragment-codec.ts';
import { mount, paragraph, putCaret } from './paginated-surface-fixtures.ts';

const PNG =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const FALLBACK = `<![if !msEquation]><span><img width=40 height=20 src="${PNG}"></span><![endif]>`;

/** The real Mac Word clipboard equation: fraction plus sub/superscripts, no `m:t`. */
const MAC_WORD_EQUATION =
  '<m:oMath>' +
  '<m:sSub><m:e><m:r>Z</m:r></m:e><m:sub><m:r>A</m:r></m:sub></m:sSub>' +
  '<m:r>-</m:r>' +
  '<m:sSub><m:e><m:r>Z</m:r></m:e><m:sub><m:r>B</m:r></m:sub></m:sSub>' +
  '<m:r>=f</m:r>' +
  '<m:f><m:num><m:r>L</m:r>' +
  '<m:sSup><m:e><m:r>V</m:r></m:e><m:sup><m:r>2</m:r></m:sup></m:sSup>' +
  '</m:num><m:den><m:r>2gD</m:r></m:den></m:f>' +
  '</m:oMath>';

function wordHtml(body: string): string {
  return (
    '<html xmlns:m="http://schemas.microsoft.com/office/2004/12/omml">' +
    '<head><meta name=ProgId content=Word.Document></head><body>' +
    `${body}</body></html>`
  );
}

function project(body: string): { xml: string; imageCount: number; equations: OoxmlNode[] } {
  const projected = projectExternalHtml(wordHtml(body));
  if (!projected.ok) throw new Error(projected.reason);
  const read = readOoxmlPackage(projected.fragmentBytes);
  if (!read.ok) throw new Error(read.reason);
  const part = read.package.parts.get(read.package.mainDocumentPart)!;
  const equations: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === OFFICE_MATH_NAMESPACE_URI && node.localName === 'oMath') {
      equations.push(node);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return { xml: serializeOoxmlPart(part), imageCount: projected.imageCount, equations };
}

function linearOf(equation: OoxmlNode): string {
  const projection = projectOmmlEquation(equation);
  if (projection === null) throw new Error('not an equation');
  return equationExpressionToLinearMath(projection.expression);
}

describe('Word clipboard equations', () => {
  test('recovers both equations from a Word for Mac capture', () => {
    const html = readFileSync(
      new URL('./fixtures/word-mac-equations.html', import.meta.url),
      'utf8'
    );
    const projected = projectExternalHtml(html);
    if (!projected.ok) throw new Error(projected.reason);
    expect(projected.imageCount).toBe(0);
    const read = readOoxmlPackage(projected.fragmentBytes);
    if (!read.ok) throw new Error(read.reason);
    const part = read.package.parts.get(read.package.mainDocumentPart)!;
    const xml = serializeOoxmlPart(part);
    const equations: OoxmlNode[] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.namespaceUri === OFFICE_MATH_NAMESPACE_URI && node.localName === 'oMath') {
        equations.push(node);
        return;
      }
      for (const child of node.children) walk(child);
    };
    walk(part.root);
    expect(equations.map(linearOf)).toEqual(['{a}/{b}+x^{2}', '√{y}=∑[i=1]^[n]{i}']);
    expect(xml).toContain('<m:degHide m:val="on"/>');
    // The display equation stays a display.
    expect(xml).toMatch(/<w:p><m:oMathPara><m:oMath><m:rad>/);
    expect(xml).toContain('Inline ');
    expect(xml).toContain('after.');
    expect(xml).toContain('End.');
    expect(xml).not.toContain('<w:drawing>');
  });

  test('reads all three run-text shapes into canonical m:t', () => {
    const shapes = [
      (text: string) => `<m:r><m:t>${text}</m:t></m:r>`,
      (text: string) => `<m:r>${text}</m:r>`,
      (text: string) => `<m:r><i>${text}</i></m:r>`,
    ];
    for (const run of shapes) {
      const { xml, equations } = project(
        `<p class=MsoNormal><m:oMath><m:sSub><m:e>${run('Z')}</m:e>` +
          `<m:sub>${run('A')}</m:sub></m:sSub></m:oMath></p>`
      );
      expect(equations).toHaveLength(1);
      expect(xml).toContain('<m:sSub><m:e><m:r><m:t xml:space="preserve">Z</m:t></m:r></m:e>');
      expect(linearOf(equations[0]!)).toBe('Z_{A}');
    }
  });

  test('keeps the structure of the Mac Word sample', () => {
    const { equations } = project(`<p class=MsoNormal>${MAC_WORD_EQUATION}${FALLBACK}</p>`);
    expect(equations).toHaveLength(1);
    expect(linearOf(equations[0]!)).toBe('Z_{A}-Z_{B}=f{LV^{2}}/{2gD}');
  });

  test('drops the paired fallback picture of a recovered equation', () => {
    const { imageCount, xml } = project(
      `<p class=MsoNormal>before ${MAC_WORD_EQUATION}${FALLBACK} after</p>`
    );
    expect(imageCount).toBe(0);
    expect(xml).not.toContain('<w:drawing>');
    expect(xml).toContain('before ');
    expect(xml).toContain(' after');
  });

  test('drops a fallback with nested VML conditionals', () => {
    const { imageCount, equations } = project(
      `<p class=MsoNormal>${MAC_WORD_EQUATION}<![if !msEquation]>` +
        `<![if !vml]><img src="${PNG}"><![endif]><![endif]></p>`
    );
    expect(equations).toHaveLength(1);
    expect(imageCount).toBe(0);
  });

  test('unwraps OMML from the msEquation conditional comment', () => {
    const { equations, imageCount } = project(
      '<p class=MsoNormal><!--[if gte msEquation 12]><m:oMathPara><m:oMath>' +
        '<m:f><m:num><m:r><i>a</i></m:r></m:num><m:den><m:r><i>b</i></m:r></m:den></m:f>' +
        `</m:oMath></m:oMathPara><![endif]-->${FALLBACK}</p>`
    );
    expect(equations).toHaveLength(1);
    expect(linearOf(equations[0]!)).toBe('{a}/{b}');
    expect(imageCount).toBe(0);
  });

  test('converts MathML from the msEquation comment and drops the picture', () => {
    const { equations, imageCount } = project(
      '<p class=MsoNormal><!--[if gte msEquation 12]><math><mi>x</mi></math><![endif]-->' +
        `${FALLBACK}</p>`
    );
    expect(equations.map(linearOf)).toEqual(['x']);
    expect(imageCount).toBe(0);
  });

  test('keeps the picture when MathML holds only annotations', () => {
    const { equations, imageCount } = project(
      '<p class=MsoNormal><!--[if gte msEquation 12]><math><semantics><annotation>x' +
        `</annotation></semantics></math><![endif]-->${FALLBACK}</p>`
    );
    expect(equations).toHaveLength(0);
    expect(imageCount).toBe(1);
  });

  test('keeps a pasted display equation and its justification', () => {
    const { xml } = project(
      '<p class=MsoNormal><m:oMathPara><m:oMathParaPr><m:jc m:val="left"/></m:oMathParaPr>' +
        '<m:oMath><m:r>x</m:r></m:oMath></m:oMathPara></p>'
    );
    expect(xml).toContain(
      '<m:oMathPara><m:oMathParaPr><m:jc m:val="left"/></m:oMathParaPr><m:oMath>'
    );
  });

  test('carries color, size, highlight, bold, and upright style from HTML wrappers', () => {
    const { xml } = project(
      "<p class=MsoNormal><m:oMath><span style='color:red;font-size:14pt'><i><m:r>x</m:r></i>" +
        "</span><b><span style='background:yellow'><m:r>y</m:r></span></b></m:oMath></p>"
    );
    expect(xml).toContain(
      '<m:r><w:rPr><w:color w:val="FF0000"/><w:sz w:val="28"/></w:rPr><m:t xml:space="preserve">x</m:t></m:r>'
    );
    expect(xml).toMatch(
      /<m:r><m:rPr><m:sty m:val="b"\/><\/m:rPr><w:rPr>.*<\/w:rPr><m:t xml:space="preserve">y/
    );
  });

  test('keeps the fallback picture when the equation is empty', () => {
    const { equations, imageCount } = project(
      `<p class=MsoNormal><m:oMath><m:r><o:p></o:p></m:r></m:oMath>${FALLBACK}</p>`
    );
    expect(equations).toHaveLength(0);
    expect(imageCount).toBe(1);
  });

  test('reads NBSP and o:p marks inside a run as math text', () => {
    const { equations } = project(
      '<p class=MsoNormal><m:oMath><m:r><m:t>x&nbsp;=&nbsp;1</m:t><o:p></o:p></m:r></m:oMath></p>'
    );
    expect(equations).toHaveLength(1);
    expect(linearOf(equations[0]!)).toBe('x = 1');
  });

  test('a paragraph with only an equation still projects as a paragraph', () => {
    const { xml, equations } = project(
      `<p class=MsoNormal>${MAC_WORD_EQUATION}</p><p class=MsoNormal>next</p>`
    );
    expect(equations).toHaveLength(1);
    expect((xml.match(/<w:p[ >]/g) ?? []).length).toBe(2);
  });

  test('escapes values and drops names outside the OMML schema', () => {
    const { xml, equations } = project(
      '<p class=MsoNormal><m:oMath><m:d><m:dPr><m:begChr m:val="&quot;&gt;&lt;x"/></m:dPr>' +
        '<m:e><m:script><m:r>y</m:r></m:script></m:e></m:d></m:oMath></p>'
    );
    expect(equations).toHaveLength(1);
    expect(xml).toContain('m:val="&quot;&gt;&lt;x"');
    expect(xml).not.toContain('m:script');
    expect(xml).toContain('<m:e><m:r><m:t xml:space="preserve">y</m:t></m:r></m:e>');
  });

  test('a nested equation flood stays bounded', () => {
    const depth = 200;
    const nested = '<m:e><m:d>'.repeat(depth) + '<m:r>x</m:r>' + '</m:d></m:e>'.repeat(depth);
    const projected = projectExternalHtml(
      wordHtml(`<p class=MsoNormal><m:oMath><m:d>${nested}</m:d></m:oMath>tail</p>`)
    );
    expect(projected.ok).toBe(true);
  });
});

describe('MathML clipboard equations', () => {
  const math = (inner: string, attributes = '') =>
    project(`<p>see <math${attributes}>${inner}</math> here</p>`);

  test('converts fractions, roots, and scripts into editable equations', () => {
    const { equations, xml } = math(
      '<mfrac><mi>a</mi><mn>2</mn></mfrac><mo>+</mo><msqrt><mi>x</mi></msqrt>' +
        '<mo>+</mo><msubsup><mi>y</mi><mn>1</mn><mn>2</mn></msubsup>'
    );
    expect(equations.map(linearOf)).toEqual(['{a}/{2}+√{x}+y_{1}^{2}']);
    expect(xml).toContain('see ');
    expect(xml).toContain(' here');
  });

  test('turns a scripted large operator and its next sibling into m:nary', () => {
    const { equations, xml } = math(
      '<munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi>' +
        '</munderover><msup><mi>i</mi><mn>2</mn></msup>'
    );
    expect(xml).toContain('<m:chr m:val="∑"/><m:limLoc m:val="undOvr"/>');
    expect(equations.map(linearOf)).toEqual(['∑[i=1]^[n]{i^{2}}']);
  });

  test('maps fences, accents, text, styles, matrices, and color', () => {
    const { xml } = math(
      '<mrow><mo>(</mo><mi>x</mi><mo>)</mo></mrow>' +
        '<mover><mi>v</mi><mo>→</mo></mover>' +
        '<mtext>if</mtext><mi>sin</mi><mi mathvariant="bold">B</mi>' +
        '<mfenced open="[" close="]"><mi>a</mi><mi>b</mi></mfenced>' +
        '<mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd></mtr></mtable>' +
        '<mi mathcolor="#f00">c</mi>'
    );
    expect(xml).toContain('<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr>');
    expect(xml).toContain('<m:acc><m:accPr><m:chr m:val="⃗"/></m:accPr>');
    expect(xml).toContain('<m:rPr><m:nor/></m:rPr><m:t xml:space="preserve">if</m:t>');
    expect(xml).toContain('<m:rPr><m:sty m:val="p"/></m:rPr><m:t xml:space="preserve">sin</m:t>');
    expect(xml).toContain('<m:rPr><m:sty m:val="b"/></m:rPr>');
    expect(xml).toContain('<m:sepChr m:val=","/>');
    expect(xml).toContain('<m:m><m:mr><m:e>');
    expect(xml).toContain('<w:color w:val="FF0000"/>');
  });

  test('a block MathML equation pastes as a display equation', () => {
    const { xml } = project('<math display="block"><mi>x</mi></math>');
    expect(xml).toContain('<m:oMathPara><m:oMath>');
  });

  test('a MathML flood stays bounded', () => {
    const nested = '<mrow>'.repeat(300) + '<mi>x</mi>' + '</mrow>'.repeat(300);
    expect(projectExternalHtml(`<p><math>${nested}</math>tail</p>`).ok).toBe(true);
  });
});

describe('pasting Word equations into the editor', () => {
  test('lands an editable equation that survives save and reopen', async () => {
    const target = mount(paragraph('ab'));
    putCaret(target.surface, 1);
    target.surface.pasteRich(
      'Z',
      wordHtml(`<p class=MsoNormal>${MAC_WORD_EQUATION}${FALLBACK}</p>`)
    );
    const markup = serializeOoxmlPart(target.surface.session.part());
    expect(markup).toContain('<m:oMath');
    expect(markup).not.toContain('<w:drawing>');
    const saved = strFromU8(unzipSync(await target.surface.save())['word/document.xml']!);
    expect(saved).toContain('<m:f>');
    const reopened = readOoxmlPackage(await target.surface.save());
    expect(reopened.ok).toBe(true);
    target.container.remove();
  });
});

describe('copying equations to other applications', () => {
  const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  const body =
    `<w:p xmlns:m="${M}"><w:r><w:t xml:space="preserve">Inline </w:t></w:r>` +
    '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b&lt;c</m:t></m:r>' +
    '</m:den></m:f><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>d</m:t></m:r></m:oMath></w:p>' +
    `<w:p xmlns:m="${M}"><m:oMathPara><m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e>` +
    '<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></m:oMathPara></w:p>';

  function copied(): string {
    const source = mount(body);
    putCaret(source.surface, 0);
    source.surface.selectAll();
    const html = source.surface.copyFlavours().html;
    source.container.remove();
    if (html === null) throw new Error('no html flavour');
    return html;
  }

  test('writes OMML for Word and MathML for other applications', () => {
    const html = copied();
    expect(
      html.startsWith('<html xmlns:m="http://schemas.microsoft.com/office/2004/12/omml">')
    ).toBe(true);
    expect(html).toContain(
      '<!--[if gte msEquation 12]><m:oMath><m:f><m:num><i><m:r>a</m:r></i></m:num>' +
        '<m:den><i><m:r>b&lt;c</m:r></i></m:den></m:f><m:r>d</m:r></m:oMath><![endif]-->'
    );
    expect(html).toContain('<![if !msEquation]><math xmlns="http://www.w3.org/1998/Math/MathML">');
    expect(html).toContain(
      '<mfrac><mrow><mi>a</mi></mrow><mrow><mi>b</mi><mo>&lt;</mo><mi>c</mi></mrow></mfrac>'
    );
    expect(html).toContain('<m:oMathPara><m:oMath><m:sSup>');
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">');
  });

  test('an n-ary without m:chr copies as the integral it draws', () => {
    const source = mount(
      `<w:p xmlns:m="${M}"><m:oMath><m:nary><m:naryPr/><m:sub><m:r><m:t>a</m:t></m:r></m:sub>` +
        '<m:sup><m:r><m:t>b</m:t></m:r></m:sup><m:e><m:r><m:t>y</m:t></m:r></m:e></m:nary>' +
        '</m:oMath></w:p>'
    );
    putCaret(source.surface, 0);
    source.surface.selectAll();
    const flavours = source.surface.copyFlavours();
    source.container.remove();
    expect(flavours.text).toBe('∫aby');
    expect(flavours.html).toContain('<munderover><mo>∫</mo>');
    expect(flavours.html).not.toContain('∑');
  });

  test('an n-ary outside the supported subset copies its operator in the text fallback', () => {
    const limits =
      '<m:sub><m:r><m:t>a</m:t></m:r></m:sub><m:sup><m:r><m:t>b</m:t></m:r></m:sup>' +
      '<m:e><m:r><m:t>y</m:t></m:r></m:e>';
    const source = mount(
      `<w:p xmlns:m="${M}"><m:oMath><m:nary><m:naryPr><m:chr m:val="∑"/>` +
        `<m:subHide m:val="1"/></m:naryPr>${limits}</m:nary></m:oMath></w:p>`
    );
    putCaret(source.surface, 0);
    source.surface.selectAll();
    const flavours = source.surface.copyFlavours();
    source.container.remove();
    expect(flavours.text).toBe('∑aby');
    expect(flavours.html).toContain('<mtext>∑aby</mtext>');
  });

  test('a delimiter copies its characters as text and as MathML fences', () => {
    const items = '<m:e><m:r><m:t>a</m:t></m:r></m:e><m:e><m:r><m:t>b</m:t></m:r></m:e>';
    const copy = (properties: string) => {
      const source = mount(
        `<w:p xmlns:m="${M}"><m:oMath><m:d>${properties}${items}</m:d></m:oMath></w:p>`
      );
      putCaret(source.surface, 0);
      source.surface.selectAll();
      const flavours = source.surface.copyFlavours();
      source.container.remove();
      return flavours;
    };
    const named = copy(
      '<m:dPr><m:begChr m:val="["/><m:sepChr m:val=";"/><m:endChr m:val="]"/></m:dPr>'
    );
    expect(named.text).toBe('[a;b]');
    expect(named.html).toContain(
      '<mrow><mo fence="true">[</mo><mrow><mi>a</mi></mrow><mo separator="true">;</mo>' +
        '<mrow><mi>b</mi></mrow><mo fence="true">]</mo></mrow>'
    );
    const fixed = copy('<m:dPr><m:grow m:val="0"/></m:dPr>');
    expect(fixed.text).toBe('(a|b)');
    expect(fixed.html).toContain('<mo fence="true" stretchy="false">(</mo>');
  });

  test('the HTML alone pastes back as the same equations without duplicates', () => {
    const html = copied();
    const visible = /<div[^>]*>([\s\S]*)<\/div>/.exec(html)![1]!;
    const { equations, xml } = project(wrapInteropHtml(visible, null));
    expect(equations.map(linearOf)).toHaveLength(2);
    expect(xml).toContain('<m:oMathPara>');
    expect(xml).not.toContain('mfrac');
  });
});
