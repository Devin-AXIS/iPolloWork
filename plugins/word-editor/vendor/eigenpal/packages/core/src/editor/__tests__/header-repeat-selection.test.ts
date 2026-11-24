// A repeating table header shares one paragraph id on every page it appears.
//
// The read accepts any copy. The write used to take the first copy in document order, so a
// caret on page 3 landed on page 0 — and with page 0 dematerialized, on the first built
// sheet. Clipboard and beforeinput follow the native range, so they acted on the wrong page.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { caretAt } from '../../layout/semantic-interaction.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import type { SemanticLayout } from '../../layout/semantic-records.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { applySelectionToDom, pageIndexOfNode, positionFromDomPoint } from '../dom-selection.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const TYPES =
  `<Types xmlns="${CT}">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const ROOT_RELS = `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`;

const headerCell = (text: string, repeats: boolean) =>
  '<w:tr>' +
  (repeats ? '<w:trPr><w:tblHeader/></w:trPr>' : '') +
  '<w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
  `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc></w:tr>`;

function repeatingHeaderXml(): string {
  const rows = [headerCell('HEAD', true)];
  // 134 body rows at 12.73pt fill three pages, so page 2 carries a repeat of the header.
  for (let index = 0; index < 134; index += 1) rows.push(headerCell(`row ${index}`, false));
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
    rows.join('') +
    '</w:tbl>'
  );
}

function repeatingHeaderDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${repeatingHeaderXml()}</w:body></w:document>`
    ),
  });
}

function paintRepeatingHeader(materialize?: ReadonlySet<number>): {
  readonly root: HTMLElement;
  readonly layout: SemanticLayout;
} {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${repeatingHeaderXml()}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 1, {
    measurer: createFixedMeasurer(6, 14),
  });
  const root = document.createElement('div');
  paintSemanticLayout(root, layout, {
    scale: 1,
    ariaHidden: false,
    ...(materialize ? { materialize } : {}),
  });
  return { root, layout };
}

function copiesOf(root: Element, paragraphId: string): HTMLElement[] {
  return [...root.querySelectorAll('[data-paragraph-id][data-start]')].filter(
    (element) => (element as HTMLElement).dataset.paragraphId === paragraphId
  ) as HTMLElement[];
}

function pageOf(node: Node | null | undefined, root?: Element): string | undefined {
  const page = pageIndexOfNode(node, root);
  return page === undefined ? undefined : String(page);
}

function headerParagraphId(root: Element): string {
  const span = root.querySelector('[data-header-repeat] [data-paragraph-id][data-start]');
  const id = (span as HTMLElement | null)?.dataset.paragraphId;
  if (!id) throw new Error('expected a repeating header paragraph');
  return id;
}

function textNodeIn(element: Element): Node {
  let node: Node = element;
  while (node.firstChild) node = node.firstChild;
  return node;
}

describe('a repeating w:tblHeader row is written to the copy on the named page', () => {
  test('a read from a later copy is accepted', () => {
    const { root } = paintRepeatingHeader();
    const id = headerParagraphId(root);
    const copies = copiesOf(root, id);
    expect(root.querySelectorAll('[data-page-index]').length).toBeGreaterThan(1);
    expect(copies.length).toBeGreaterThan(1);
    const later = copies.find((copy) => pageOf(copy, root) !== '0');
    expect(later).toBeDefined();
    const position = { paragraphId: id, offset: 3 };
    expect(positionFromDomPoint(textNodeIn(later!), 3, root)).toEqual(position);
  });

  test('a write without a page hint lands on the first built copy', () => {
    const { root } = paintRepeatingHeader();
    document.body.append(root);
    const id = headerParagraphId(root);
    const position = { paragraphId: id, offset: 3 };
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    expect(applySelectionToDom(root, { anchor: position, head: position }, selection)).toBe(true);
    expect(pageOf(selection.anchorNode, root)).toBe('0');
    root.remove();
  });

  test('a write moves a same-model caret off the first copy onto the named page', () => {
    const { root } = paintRepeatingHeader();
    document.body.append(root);
    const id = headerParagraphId(root);
    const later = copiesOf(root, id).find((copy) => pageOf(copy, root) !== '0')!;
    const preferredPageIndex = pageIndexOfNode(later, root)!;
    const position = { paragraphId: id, offset: 3 };
    const selection = document.getSelection()!;
    expect(applySelectionToDom(root, { anchor: position, head: position }, selection)).toBe(true);
    expect(pageOf(selection.anchorNode, root)).toBe('0');
    expect(
      applySelectionToDom(root, { anchor: position, head: position }, selection, {
        preferredPageIndex,
      })
    ).toBe(true);
    expect(pageOf(selection.anchorNode, root)).toBe(String(preferredPageIndex));
    root.remove();
  });

  test('a write prefers the copy on the named page', () => {
    const { root } = paintRepeatingHeader();
    document.body.append(root);
    const id = headerParagraphId(root);
    const later = copiesOf(root, id).find((copy) => pageOf(copy, root) !== '0')!;
    const preferredPageIndex = pageIndexOfNode(later, root)!;
    expect(preferredPageIndex).toBeGreaterThan(0);
    const position = { paragraphId: id, offset: 3 };
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    expect(
      applySelectionToDom(root, { anchor: position, head: position }, selection, {
        preferredPageIndex,
      })
    ).toBe(true);
    expect(pageOf(selection.anchorNode, root)).toBe(String(preferredPageIndex));
    root.remove();
  });

  test('caretAt without a page hint names the authored sheet', () => {
    const { root, layout } = paintRepeatingHeader();
    const id = headerParagraphId(root);
    const later = copiesOf(root, id).find((copy) => pageOf(copy, root) !== '0')!;
    const preferredPageIndex = pageIndexOfNode(later, root)!;
    const position = { paragraphId: id, offset: 3 };
    expect(caretAt(layout, position)?.pageIndex).toBe(0);
    expect(caretAt(layout, position, { preferredPageIndex })?.pageIndex).toBe(preferredPageIndex);
  });

  test('with page 0 dematerialized, a named later page still wins', () => {
    const { root } = paintRepeatingHeader(new Set([2]));
    document.body.append(root);
    const pages = [...root.querySelectorAll('[data-page-index]')] as HTMLElement[];
    expect(
      pages.some((page) => page.dataset.pageIndex === '0' && page.dataset.materialized === 'false')
    ).toBe(true);
    const id = headerParagraphId(root);
    const onPageTwo = copiesOf(root, id).find((copy) => pageOf(copy, root) === '2');
    expect(onPageTwo).toBeDefined();
    const position = { paragraphId: id, offset: 3 };
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    expect(applySelectionToDom(root, { anchor: position, head: position }, selection)).toBe(true);
    expect(pageOf(selection.anchorNode, root)).toBe('2');
    selection.removeAllRanges();
    expect(
      applySelectionToDom(root, { anchor: position, head: position }, selection, {
        preferredPageIndex: 2,
      })
    ).toBe(true);
    expect(pageOf(selection.anchorNode, root)).toBe('2');
    root.remove();
  });
});

function mount(bytes: Uint8Array): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  return { surface: opened.surface, container };
}

function armGesture(target: Element): void {
  target.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true }));
}

async function gesture(anchor: [Node, number], head: [Node, number]): Promise<void> {
  await Promise.resolve();
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  const range = document.createRange();
  range.setStart(anchor[0], anchor[1]);
  range.setEnd(head[0], head[1]);
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

describe('the surface remirrors a repeating header onto the copy the user clicked', () => {
  test('a later write stays on the sheet the gesture mapped', async () => {
    const { surface, container } = mount(repeatingHeaderDocx());
    const pages = container.querySelector('.docx-pages')!;
    const id = headerParagraphId(pages);
    const later = copiesOf(pages, id).find((copy) => pageOf(copy, pages) !== '0');
    expect(later).toBeDefined();
    const preferredPageIndex = pageIndexOfNode(later!, pages)!;
    const text = textNodeIn(later!);
    armGesture(later!);
    await gesture([text, 3], [text, 3]);
    expect(surface.state().selection.head).toEqual({ paragraphId: id, offset: 3 });
    document.getSelection()?.removeAllRanges();
    surface.setSelection(surface.state().selection);
    expect(pageOf(document.getSelection()?.anchorNode, pages)).toBe(String(preferredPageIndex));
    surface.destroy();
    container.remove();
  });

  test('the painted caret sits on the sheet the gesture mapped', async () => {
    const { surface, container } = mount(repeatingHeaderDocx());
    const pages = container.querySelector('.docx-pages')!;
    surface.focus();
    const id = headerParagraphId(pages);
    const later = copiesOf(pages, id).find((copy) => pageOf(copy, pages) !== '0');
    expect(later).toBeDefined();
    const preferredPageIndex = pageIndexOfNode(later!, pages)!;
    const text = textNodeIn(later!);
    armGesture(later!);
    await gesture([text, 3], [text, 3]);
    surface.setSelection(surface.state().selection);
    const caret = container.querySelector('[data-docx-caret]');
    expect(caret).not.toBeNull();
    expect(pageOf(caret, pages)).toBe(String(preferredPageIndex));
    expect(caretAt(surface.layout(), { paragraphId: id, offset: 3 })?.pageIndex).toBe(0);
    expect(
      caretAt(surface.layout(), { paragraphId: id, offset: 3 }, { preferredPageIndex })?.pageIndex
    ).toBe(preferredPageIndex);
    surface.destroy();
    container.remove();
  });
});
