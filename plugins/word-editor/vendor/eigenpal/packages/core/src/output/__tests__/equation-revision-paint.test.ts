import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import { DEFAULT_REVISION_MARKUP, resolveRevisionMarkup } from '../../contracts/revision-markup.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const equation = '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>';
const wrapped = (kind: string) =>
  `<w:p><w:r><w:t>a</w:t></w:r><w:${kind} w:id="1" w:author="Reviewer">${equation}</w:${kind}></w:p>`;

function paint(body: string, markup: boolean): HTMLElement {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const revisionMarkup = markup ? resolveRevisionMarkup(DEFAULT_REVISION_MARKUP) : undefined;
  const layout = layoutSemanticDocument(parsed.part, 1, {
    displayMode: 'all-markup',
    measurer: createFixedMeasurer(6, 14),
  });
  const root = document.createElement('div');
  paintSemanticLayout(root, layout, { scale: 1, ...(revisionMarkup ? { revisionMarkup } : {}) });
  return root;
}

for (const markup of [false, true]) {
  test(`a deleted equation strikes its glyphs and an inserted one is underlined (markup ${markup})`, () => {
    const deleted = paint(wrapped('del'), markup).querySelector('.docx-equation');
    expect(deleted?.querySelector('.docx-equation-revision-strike')).not.toBeNull();
    expect(deleted?.querySelector('.docx-equation-revision-underline')).toBeNull();

    const inserted = paint(wrapped('ins'), markup).querySelector('.docx-equation');
    expect(inserted?.querySelector('.docx-equation-revision-underline')).not.toBeNull();
    expect(inserted?.querySelector('.docx-equation-revision-strike')).toBeNull();
  });
}

test('an equation outside any revision draws no revision bar', () => {
  const plain = paint(`<w:p>${equation}</w:p>`, false).querySelector('.docx-equation');
  expect(plain).not.toBeNull();
  expect(plain?.querySelector('[class^="docx-equation-revision"]')).toBeNull();
});

test('a host revision markup with no line mark draws no equation bar', () => {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body>${wrapped('del')}${wrapped('ins')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const revisionMarkup = resolveRevisionMarkup({
    insertions: { mark: 'none' },
    deletions: { mark: 'colorOnly' },
  });
  const layout = layoutSemanticDocument(parsed.part, 1, {
    displayMode: 'all-markup',
    measurer: createFixedMeasurer(6, 14),
  });
  const root = document.createElement('div');
  paintSemanticLayout(root, layout, { scale: 1, revisionMarkup });
  expect(root.querySelectorAll('.docx-equation')).toHaveLength(2);
  expect(root.querySelector('[class^="docx-equation-revision"]')).toBeNull();
});

test('a deleted fraction strikes its numerator and denominator, not the fraction bar', () => {
  const fraction =
    '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>';
  const root = paint(
    `<w:p><w:r><w:t>a</w:t></w:r><w:del w:id="1" w:author="Reviewer">${fraction}</w:del></w:p>`,
    false
  );
  const glyphs = [...root.querySelectorAll<HTMLElement>('.docx-equation .docx-equation-text')];
  expect(glyphs).toHaveLength(2);
  for (const glyph of glyphs) {
    expect(glyph.classList.contains('docx-equation-revision-strike')).toBe(true);
    expect(glyph.style.textDecorationLine).toBe('line-through');
  }
});
