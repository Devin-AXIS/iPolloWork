// Every paragraph-inline consumer uses one total depth for wrappers and content controls.

import { describe, expect, test } from 'bun:test';
import { treeToDoc } from '../../binding/tree-binding.ts';
import { collectedControlIndexOf } from '../../layout/content-control-boundary-layout.ts';
import { piecesOfParagraph } from '../../layout/field-projection.ts';
import {
  readOoxmlPart,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { MAX_INLINE_CONTAINER_DEPTH } from '../../store/package/ooxml-shared.ts';
import { paragraphOffsetIndex } from '../../store/store/tree-op-segments.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { inlineContentControlsAt } from '../content-controls.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function mixedContainers(count: number, label: string, text: string): string {
  let content = `<w:r><w:t>${text}</w:t></w:r>`;
  for (let depth = 0; depth < count; depth += 1) {
    content =
      depth % 2 === 0
        ? `<w:smartTag>${content}</w:smartTag>`
        : `<w:sdt><w:sdtPr><w:tag w:val="${label}-${depth}"/></w:sdtPr>` +
          `<w:sdtContent>${content}</w:sdtContent></w:sdt>`;
  }
  return content;
}

function inlineControl(label: string, text: string): string {
  return (
    `<w:sdt><w:sdtPr><w:tag w:val="${label}"/></w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>${text}</w:t></w:r></w:sdtContent></w:sdt>`
  );
}

function demotedControlsAround(count: number, content: string): string {
  let nested = content;
  for (let depth = 0; depth < count; depth += 1) {
    // Properties after content make each `w:sdt` canonical but generic.
    nested = `<w:sdt><w:sdtContent>${nested}</w:sdtContent><w:sdtPr/></w:sdt>`;
  }
  return nested;
}

function loadedParagraph(xml: string): { part: OoxmlPart; paragraph: OoxmlParagraphNode } {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${xml}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  const paragraph = result.part.root.children
    .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
    .find((child): child is OoxmlParagraphNode => child.kind === 'paragraph');
  if (!paragraph) throw new Error('paragraph is missing');
  return { part: result.part, paragraph };
}

function descendants(node: OoxmlNode): OoxmlNode[] {
  if (node.kind === 'textValue') return [node];
  return [node, ...node.children.flatMap(descendants)];
}

describe('inline container depth parity', () => {
  test('all paragraph consumers stop at the same mixed-container boundary', () => {
    const addressable = mixedContainers(MAX_INLINE_CONTAINER_DEPTH - 1, 'visible', 'seen');
    const capped = mixedContainers(MAX_INLINE_CONTAINER_DEPTH, 'capped', 'hidden');
    const pastCap = mixedContainers(MAX_INLINE_CONTAINER_DEPTH + 1, 'past', 'hidden-too');
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p>${addressable}${capped}${pastCap}` +
        `${inlineControl('later', 'later')}</w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const paragraph = result.part.root.children
      .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
      .find((child): child is OoxmlParagraphNode => child.kind === 'paragraph');
    if (!paragraph) throw new Error('paragraph is missing');

    const text = paragraphTextOf(result.part, paragraph.id);
    const layoutText = piecesOfParagraph(paragraph)
      .map((piece) => piece.text)
      .join('');
    const projectedText = treeToDoc(result.part).textContent;
    const offsets = paragraphOffsetIndex(paragraph);

    expect(text).toBe('seenlater');
    expect(layoutText).toBe(text);
    expect(projectedText).toBe(text);
    expect(offsets.length).toBe(text.length);
    expect(
      inlineContentControlsAt(paragraph, 1).every((control) => control.tag?.startsWith('visible'))
    ).toBe(true);
    expect(inlineContentControlsAt(paragraph, 1).length).toBeGreaterThan(0);
    expect(inlineContentControlsAt(paragraph, 4).map((control) => control.tag)).toEqual(['later']);
  });

  test('demoted content controls consume the shared container budget', () => {
    const wrapper = '<w:bdo><w:r><w:t>A</w:t></w:r></w:bdo>';
    const addressable = loadedParagraph(
      demotedControlsAround(MAX_INLINE_CONTAINER_DEPTH - 2, wrapper)
    );
    expect(
      descendants(addressable.paragraph).filter(
        (node) => node.kind === 'generic' && node.localName === 'sdt'
      )
    ).toHaveLength(MAX_INLINE_CONTAINER_DEPTH - 2);
    expect(paragraphTextOf(addressable.part, addressable.paragraph.id)).toBe('A');
    expect(
      piecesOfParagraph(addressable.paragraph)
        .map((piece) => piece.text)
        .join('')
    ).toBe('A');
    expect(treeToDoc(addressable.part).textContent).toBe('A');

    for (const count of [MAX_INLINE_CONTAINER_DEPTH - 1, MAX_INLINE_CONTAINER_DEPTH]) {
      const opaque = loadedParagraph(demotedControlsAround(count, wrapper));
      expect(paragraphTextOf(opaque.part, opaque.paragraph.id)).toBe('');
      expect(
        piecesOfParagraph(opaque.paragraph)
          .map((piece) => piece.text)
          .join('')
      ).toBe('');
      expect(treeToDoc(opaque.part).textContent).toBe('');
    }
  });

  test('a misplaced run wrapper stays opaque before a visible control', () => {
    const loaded = loadedParagraph(
      '<w:r><w:t>A</w:t><w:smartTag><w:r><w:t>hidden</w:t></w:r></w:smartTag>' +
        '<w:t>B</w:t></w:r>' +
        inlineControl('visible', 'shown')
    );
    const control = descendants(loaded.paragraph).find((node) => node.kind === 'contentControl');
    if (!control) throw new Error('content control is missing');

    const text = paragraphTextOf(loaded.part, loaded.paragraph.id);
    const layoutText = piecesOfParagraph(loaded.paragraph)
      .map((piece) => piece.text)
      .join('');
    const span = paragraphOffsetIndex(loaded.paragraph).spanOf(control);
    const collected = collectedControlIndexOf(loaded.part).controls.find(
      (entry) => entry.control.id === control.id
    );

    expect(text).toBe('ABshown');
    expect(layoutText).toBe(text);
    expect(treeToDoc(loaded.part).textContent).toBe(text);
    expect(span).toEqual({ start: 2, end: 7 });
    expect(collected?.range).toEqual(span);
    expect(inlineContentControlsAt(loaded.paragraph, 2).map((entry) => entry.tag)).toEqual([
      'visible',
    ]);
  });
});

test.each([
  MAX_INLINE_CONTAINER_DEPTH - 2,
  MAX_INLINE_CONTAINER_DEPTH - 1,
  MAX_INLINE_CONTAINER_DEPTH,
  MAX_INLINE_CONTAINER_DEPTH + 1,
])('customXml depth %s keeps shallow content addressable', (count) => {
  let nested = '<w:r><w:t>deep</w:t></w:r>';
  for (let depth = 0; depth < count; depth += 1) nested = `<w:customXml>${nested}</w:customXml>`;
  const loaded = loadedParagraph(
    `<w:customXml><w:r><w:t>Visible</w:t></w:r>${nested}${inlineControl('shallow', 'control')}</w:customXml>`
  );
  const expected = 'Visible' + (count + 1 < MAX_INLINE_CONTAINER_DEPTH ? 'deep' : '') + 'control';
  expect(paragraphTextOf(loaded.part, loaded.paragraph.id)).toBe(expected);
  expect(
    piecesOfParagraph(loaded.paragraph)
      .map((piece) => piece.text)
      .join('')
  ).toBe(expected);
  expect(treeToDoc(loaded.part).textContent).toBe(expected);
  expect(paragraphOffsetIndex(loaded.paragraph).length).toBe(expected.length);
  const controlStart = expected.indexOf('control');
  expect(
    inlineContentControlsAt(loaded.paragraph, controlStart).map((control) => control.tag)
  ).toEqual(['shallow']);
  expect(collectedControlIndexOf(loaded.part).controls[0]?.range).toEqual({
    start: controlStart,
    end: expected.length,
  });
});
