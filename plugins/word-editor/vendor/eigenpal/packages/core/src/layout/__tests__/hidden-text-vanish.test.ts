// Hidden text (`w:vanish`, ECMA-376 §17.3.2.45).
//
// Word neither draws hidden text nor gives it space, so the fidelity bar is stronger than
// "invisible": a hidden run must not reach the measurer, must not widen a line, and must not
// push a page break. What it must NOT do is move the model offsets around it, or delete the
// paragraph that holds it.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { piecesOfParagraph } from '../field-projection.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { resolveRunStyle, runStylesEqual } from '../run-style.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type PageGeometry } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const measurer = createFixedMeasurer(6, 14);

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstParagraph(body: string): OoxmlNode {
  const part = load(body);
  const paragraph = part.root.children[0]!.children.find((child) => child.kind === 'paragraph');
  if (!paragraph) throw new Error('no paragraph');
  return paragraph;
}

const run = (text: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

const resolve = (localName: string, attributes?: Record<string, string>) =>
  resolveRunStyle([attributes ? { localName, attributes } : { localName }]);

describe('w:vanish resolves as a toggle', () => {
  test('a bare w:vanish hides the run', () => {
    expect(resolve('vanish').hidden).toBe(true);
    expect(resolve('b').hidden).toBe(false);
  });

  test('an explicit off value leaves the run visible', () => {
    expect(resolve('vanish', { val: '0' }).hidden).toBe(false);
    expect(resolve('vanish', { val: 'false' }).hidden).toBe(false);
    expect(resolve('vanish', { val: 'off' }).hidden).toBe(false);
    expect(resolve('vanish', { val: '1' }).hidden).toBe(true);
  });

  test('a later entry wins, so direct formatting can un-hide inherited vanish', () => {
    const style = resolveRunStyle([
      { localName: 'vanish' },
      { localName: 'vanish', attributes: { val: '0' } },
    ]);
    expect(style.hidden).toBe(false);
  });

  test('w:specVanish is a different property and does not hide the run', () => {
    // §17.3.2.36 is an always-hidden paragraph MARK, not hidden run content.
    expect(resolve('specVanish').hidden).toBe(false);
  });

  test('hidden participates in style equality', () => {
    expect(runStylesEqual(resolve('vanish'), resolve('vanish'))).toBe(true);
    expect(runStylesEqual(resolve('vanish'), resolve('vanish', { val: '0' }))).toBe(false);
  });
});

describe('hidden runs are not laid out', () => {
  test('a hidden run contributes no piece', () => {
    const pieces = piecesOfParagraph(
      firstParagraph(`<w:p>${run('visible')}${run('secret', '<w:vanish/>')}</w:p>`)
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['visible']);
  });

  test('suppressed hidden text still advances model offsets', () => {
    // The characters remain in the tree and in `paragraphTextOf`, so a following run whose
    // offsets shifted would put the caret and every tree op on the wrong character.
    const pieces = piecesOfParagraph(
      firstParagraph(
        `<w:p>${run('AB')}${run('hidden', '<w:vanish/>')}${run('CD')}</w:p>` // 2 + 6 + 2
      )
    );
    expect(pieces.map((piece) => [piece.text, piece.start, piece.end])).toEqual([
      ['AB', 0, 2],
      ['CD', 8, 10],
    ]);
  });

  test('an explicit w:vanish="0" run is still shown', () => {
    const pieces = piecesOfParagraph(
      firstParagraph(`<w:p>${run('shown', '<w:vanish w:val="0"/>')}</w:p>`)
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['shown']);
  });

  test('hidden text does not consume line width', () => {
    // 10 characters at 6pt fill the 60pt measure exactly; if the hidden run were measured it
    // would wrap onto further lines.
    const paragraph = firstParagraph(
      `<w:p>${run('0123456789')}${run('x'.repeat(200), '<w:vanish/>')}</w:p>`
    );
    const lines = breakParagraph(paragraph, 'p', 0, 60, measurer, undefined, null);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.spans.map((span) => span.text)).toEqual(['0123456789']);
  });

  test('a fully hidden paragraph keeps exactly one line, so it keeps its caret target', () => {
    const paragraph = firstParagraph(`<w:p>${run('all of this is hidden', '<w:vanish/>')}</w:p>`);
    expect(piecesOfParagraph(paragraph)).toEqual([]);
    const lines = breakParagraph(paragraph, 'p', 0, 60, measurer, undefined, null);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.spans).toEqual([]);
    expect(lines[0]!.height).toBeGreaterThan(0);
  });
});

describe('hidden text does not paginate', () => {
  /** Small enough that a few lines fill a page. */
  const SMALL: PageGeometry = {
    width: 200,
    height: 100,
    margin: { top: 10, right: 10, bottom: 10, left: 10 },
  };

  test('hidden runs do not push following text onto a later page', () => {
    // Each paragraph carries a long hidden comment. Laid out, those would wrap to several
    // lines each and spill the document over more pages than Word produces.
    const body = (hidden: boolean) =>
      Array.from(
        { length: 5 },
        (_unused, index) =>
          `<w:p>${run(`line ${index}`)}` +
          (hidden ? run('hidden reviewer comment '.repeat(4), '<w:vanish/>') : '') +
          `</w:p>`
      ).join('');

    const withHidden = layoutSemanticDocument(load(body(true)), 1, { measurer, geometry: SMALL });
    const withoutHidden = layoutSemanticDocument(load(body(false)), 1, {
      measurer,
      geometry: SMALL,
    });

    expect(linesOf(withHidden).map((line) => line.spans.map((span) => span.text).join(''))).toEqual(
      linesOf(withoutHidden).map((line) => line.spans.map((span) => span.text).join(''))
    );
    expect(withHidden.pages).toHaveLength(withoutHidden.pages.length);
  });
});
