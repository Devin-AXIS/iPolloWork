import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../../layout/fixed-measurer.ts';
import { layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import {
  applySelectionToDom,
  positionFromDomPoint,
  semanticSelectionFromDom,
} from '../dom-selection.ts';

const WML = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const field = (cache: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> MERGEFIELD example </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  `<w:r><w:rPr><w:u/><w:strike/></w:rPr><w:t>${cache}</w:t></w:r>` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const text = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`;

function painted(content: string) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${WML}"><w:body><w:p>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error('Invalid synthetic source');
  const part = parsed.part;
  const before = serializeOoxmlPart(part);
  const layout = layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer() });
  const root = document.createElement('div');
  paintSemanticLayout(root, layout, { scale: 1 });
  document.body.append(root);
  const paragraphId = root.querySelector<HTMLElement>('.docx-line')!.dataset.paragraphId!;
  return { root, part, before, paragraphId };
}

function withPainted(content: string, verify: (fixture: ReturnType<typeof painted>) => void) {
  const fixture = painted(content);
  try {
    verify(fixture);
    expect(serializeOoxmlPart(fixture.part)).toBe(fixture.before);
  } finally {
    document.getSelection()?.removeAllRanges();
    fixture.root.remove();
  }
}

function roundTrip(fixture: ReturnType<typeof painted>, anchor: number, head: number) {
  const at = (offset: number) => ({ paragraphId: fixture.paragraphId, offset });
  const range = { anchor: at(anchor), head: at(head) };
  const selection = document.getSelection()!;
  expect(applySelectionToDom(fixture.root, range, selection)).toBe(true);
  expect(semanticSelectionFromDom(fixture.root, selection)).toEqual(range);
  expect(selection.anchorNode?.parentElement?.closest('[data-docx-field]')).toBeNull();
  expect(selection.focusNode?.parentElement?.closest('[data-docx-field]')).toBeNull();
}

test('a computed field alone keeps both caret boundaries and both range directions', () => {
  withPainted(field('Cached field result'), (fixture) => {
    for (const [anchor, head] of [
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0],
    ]) {
      roundTrip(fixture, anchor!, head!);
    }
  });
});

test('consecutive computed fields retain their shared boundary', () => {
  withPainted(field('First result') + field('Second result'), (fixture) => {
    for (const [anchor, head] of [
      [0, 0],
      [1, 1],
      [2, 2],
      [0, 2],
      [2, 0],
      [1, 2],
    ]) {
      roundTrip(fixture, anchor!, head!);
    }
  });
});

test('computed fields at either paragraph edge retain their source boundaries', () => {
  for (const content of [
    field('Leading result') + text('ab'),
    text('ab') + field('Trailing result'),
  ]) {
    withPainted(content, (fixture) => {
      for (const [anchor, head] of [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [0, 3],
        [3, 0],
      ]) {
        roundTrip(fixture, anchor!, head!);
      }
    });
  }
});

test('computed field caches remain inert despite their editable source boundaries', () => {
  withPainted(field('A cache with many painted characters'), (fixture) => {
    const cache = fixture.root.querySelector<HTMLElement>('[data-docx-field]')!;
    const walker = document.createTreeWalker(cache, NodeFilter.SHOW_TEXT);
    expect(walker.nextNode()).not.toBeNull();
    expect(positionFromDomPoint(walker.currentNode, 1, fixture.root)).toBeNull();
    expect(positionFromDomPoint(cache, 0, fixture.root)).toBeNull();
    const range = document.createRange();
    range.selectNodeContents(cache);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(semanticSelectionFromDom(fixture.root, selection)).toBeNull();
    roundTrip(fixture, 0, 1);
  });
});

test('a hard-break field result keeps its end boundary on the preferred first line', () => {
  withPainted(field('One</w:t><w:br/><w:t>Two'), (fixture) => {
    const lines = [...fixture.root.querySelectorAll<HTMLElement>('.docx-line')];
    expect(lines.length).toBeGreaterThan(1);
    const firstLineId = lines[0]!.dataset.lineId!;
    const point = { paragraphId: fixture.paragraphId, offset: 1 };
    const range = { anchor: point, head: point };
    const selection = document.getSelection()!;
    expect(
      applySelectionToDom(fixture.root, range, selection, { preferredLineId: firstLineId })
    ).toBe(true);
    expect(semanticSelectionFromDom(fixture.root, selection)).toEqual(range);
    const focus = selection.focusNode!;
    const focusElement =
      focus.nodeType === Node.ELEMENT_NODE ? (focus as Element) : focus.parentElement;
    expect(focusElement?.closest<HTMLElement>('[data-line-id]')?.dataset.lineId).toBe(firstLineId);
  });
});

test('a position beyond a field-only paragraph does not fall back to its start', () => {
  withPainted(field('A long cache'), (fixture) => {
    const point = { paragraphId: fixture.paragraphId, offset: 2 };
    expect(
      applySelectionToDom(fixture.root, { anchor: point, head: point }, document.getSelection())
    ).toBe(false);
  });
});
