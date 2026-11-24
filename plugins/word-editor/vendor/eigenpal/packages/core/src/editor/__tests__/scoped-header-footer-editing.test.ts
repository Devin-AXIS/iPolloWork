// Scoped header/footer editing on the paginated surface.
//
// Entering a painted furniture story binds EditorScope { kind: 'headerFooter', rId },
// routes the body input path through TreeDocxSession.applyTreeOps(..., scope), and keeps
// closed furniture inert exactly as before.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { positionFromDomPoint } from '../dom-selection.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { hitTestStoryAtLocalPoint } from '../surface-scope.ts';

const COMPREHENSIVE_FIXTURE = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const pageField =
  `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
  `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`;

interface HfDocOptions {
  readonly body?: string;
  readonly header?: string;
  readonly header2?: string;
  readonly footer?: string;
  readonly sharedHeaderAcrossSections?: boolean;
}

function docx(options: HfDocOptions): Uint8Array {
  const references: string[] = [];
  const rels: string[] = [];
  const overrides: string[] = [];
  const entries: Record<string, Uint8Array> = {};
  const addPart = (
    kind: 'header' | 'footer',
    type: string,
    relId: string,
    name: string,
    content: string
  ): void => {
    references.push(`<w:${kind}Reference w:type="${type}" r:id="${relId}"/>`);
    rels.push(`<Relationship Id="${relId}" Type="${R}/${kind}" Target="${name}"/>`);
    overrides.push(
      `<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`
    );
    const root = kind === 'header' ? 'hdr' : 'ftr';
    entries[`word/${name}`] = strToU8(`<w:${root} xmlns:w="${W}">${content}</w:${root}>`);
  };

  if (options.header) addPart('header', 'default', 'rId10', 'header1.xml', options.header);
  if (options.header2) addPart('header', 'default', 'rId11', 'header2.xml', options.header2);
  if (options.footer) addPart('footer', 'default', 'rId12', 'footer1.xml', options.footer);

  entries['[Content_Types].xml'] = strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      overrides.join('') +
      '</Types>'
  );
  entries['_rels/.rels'] = strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  if (rels.length > 0) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${rels.join('')}</Relationships>`
    );
  }

  let body = options.body ?? `${p('body A')}${p('body B')}`;
  if (options.sharedHeaderAcrossSections && options.header) {
    // Two sections sharing the same default header rId.
    body =
      `${p('sec1')}<w:p><w:pPr><w:sectPr>` +
      `<w:headerReference w:type="default" r:id="rId10"/>` +
      `</w:sectPr></w:pPr></w:p>` +
      `${p('sec2')}<w:sectPr>` +
      `<w:headerReference w:type="default" r:id="rId10"/>` +
      (options.footer ? `<w:footerReference w:type="default" r:id="rId12"/>` : '') +
      `</w:sectPr>`;
    entries['word/document.xml'] = strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    );
  } else {
    entries['word/document.xml'] = strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        body +
        `<w:sectPr>${references.join('')}</w:sectPr>` +
        '</w:body></w:document>'
    );
  }
  return zipSync(entries);
}

function mount(bytes: Uint8Array): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return { surface: result.surface, container };
}

describe('scoped header/footer editing', () => {
  test('closed furniture stays inert and unselectable', () => {
    const { container, surface } = mount(docx({ header: p('HEADER'), footer: p('FOOTER') }));
    const header = container.querySelector('[data-docx-hf="header"]') as HTMLElement;
    expect(header.getAttribute('contenteditable')).toBe('false');
    expect(header.hasAttribute('data-docx-hf-active')).toBe(false);
    const span = header.querySelector('[data-paragraph-id][data-start]')!;
    expect(positionFromDomPoint(span.firstChild!, 0, container)).toBeNull();
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    surface.destroy();
  });

  test('enterHeaderFooter opens the exact rId and enables that story', () => {
    const { container, surface } = mount(docx({ header: p('HEADER'), footer: p('FOOTER') }));
    expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rId10' });
    const active = container.querySelector('[data-docx-hf-active]') as HTMLElement;
    expect(active?.dataset.docxHf).toBe('header');
    expect(active?.dataset.docxRId).toBe('rId10');
    expect(active.getAttribute('contenteditable')).toBe('true');
    expect(container.querySelector('.docx-page-content')?.getAttribute('contenteditable')).toBe(
      'false'
    );
    const footer = container.querySelector('[data-docx-hf="footer"]') as HTMLElement;
    expect(footer.getAttribute('contenteditable')).toBe('false');
    expect(surface.headerFooterState()?.rId).toBe('rId10');
    expect(surface.headerFooterState()?.editing).toBe('header');
    surface.destroy();
  });

  test('dangling rId is refused', () => {
    const { surface } = mount(docx({ header: p('HEADER') }));
    expect(surface.enterHeaderFooter({ rId: 'rId99' })).toBe(false);
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    surface.destroy();
  });

  test('typing goes through the normal input path into the HF story', () => {
    const { surface } = mount(docx({ header: p('Hi') }));
    expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
    surface.type('X');
    expect(surface.session.storyText({ kind: 'headerFooter', rId: 'rId10' })).toBe('XHi');
    expect(surface.session.bodyText()).toContain('body');
    expect(surface.session.bodyText()).not.toContain('XHi');
    surface.destroy();
  });

  test('formatting applies to the open header story only', () => {
    const { surface } = mount(docx({ header: p('BoldMe') }));
    expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
    const ids = surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rId10' });
    const id = ids[0]!;
    surface.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 6 },
    });
    surface.toggleRunProperty('b');
    expect(surface.formatting().bold).toBe(true);
    surface.destroy();
  });

  test('one shared-part edit updates every page showing it; undo reverts once', () => {
    const { container, surface } = mount(
      docx({ header: p('SHARED'), sharedHeaderAcrossSections: true, body: p('x') })
    );
    expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
    surface.type('!');
    const headers = [...container.querySelectorAll('[data-docx-hf="header"]')];
    expect(headers.length).toBeGreaterThanOrEqual(1);
    for (const header of headers) {
      expect(header.textContent).toContain('!SHARED');
    }
    surface.undo();
    for (const header of [...container.querySelectorAll('[data-docx-hf="header"]')]) {
      expect(header.textContent).toContain('SHARED');
      expect(header.textContent).not.toContain('!');
    }
    surface.destroy();
  });

  test('Escape restores the prior body selection', () => {
    const { surface, container } = mount(docx({ header: p('H'), body: `${p('One')}${p('Two')}` }));
    const bodyIds = surface.session.paragraphIds();
    const second = bodyIds[1]!;
    surface.setSelection({
      anchor: { paragraphId: second, offset: 0 },
      head: { paragraphId: second, offset: 3 },
    });
    const saved = surface.state().selection;
    expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
    expect(surface.activeScope().kind).toBe('headerFooter');
    surface.exitHeaderFooter();
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    expect(surface.state().selection).toEqual(saved);
    expect(container.querySelector('[data-docx-hf-active]')).toBeNull();
    surface.destroy();
  });

  test('select-all stays inside the open story', () => {
    const { surface } = mount(docx({ header: `${p('A')}${p('B')}` }));
    expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
    surface.selectAll();
    const { anchor, head } = surface.state().selection;
    const hfIds = new Set(surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rId10' }));
    expect(hfIds.has(anchor.paragraphId)).toBe(true);
    expect(hfIds.has(head.paragraphId)).toBe(true);
    for (const id of surface.session.paragraphIds()) {
      expect(anchor.paragraphId === id && head.paragraphId === id).toBe(false);
    }
    surface.destroy();
  });

  test('PAGE field remains painted while the footer scope is open', () => {
    const { container, surface } = mount(
      docx({ footer: pageField, body: `${p('a')}${p('b')}${p('c')}` })
    );
    expect(surface.enterHeaderFooter({ rId: 'rId12' })).toBe(true);
    const footer = container.querySelector('[data-docx-hf="footer"]') as HTMLElement;
    expect(footer.textContent).toMatch(/\d/);
    const field = footer.querySelector('[data-docx-field]');
    // Projected digits are marked inert when present; at minimum the evaluated digit shows.
    expect(footer.textContent?.trim().length).toBeGreaterThan(0);
    if (field) {
      expect(field.getAttribute('contenteditable')).toBe('false');
    }
    surface.destroy();
  });

  test('Editor editHeaderFooter / exitHeaderFooter / snapshot.scope wire through', () => {
    const bytes = docx({ header: p('HDR') });
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createDocxEditor({ document: bytes });
    editor.attach(host);
    const opened = editor.exec({ type: 'editHeaderFooter', position: 'header' });
    expect(opened.ok).toBe(true);
    expect(editor.getActiveScope()).toEqual({ kind: 'headerFooter', rId: 'rId10' });
    expect(editor.snapshot().scope).toEqual({ kind: 'headerFooter', rId: 'rId10' });
    expect(editor.getHeaderFooterState()?.rId).toBe('rId10');
    expect(editor.exec({ type: 'exitHeaderFooter' }).ok).toBe(true);
    expect(editor.getActiveScope()).toEqual({ kind: 'body' });
    editor.destroy();
  });
});

const RIGHT_TAB_HEADER =
  `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9026"/></w:tabs></w:pPr>` +
  `<w:r><w:rPr><w:i/><w:color w:val="888888"/></w:rPr>` +
  `<w:t xml:space="preserve">Comprehensive Word Element Test v2</w:t></w:r>` +
  `<w:r><w:t xml:space="preserve">\t</w:t></w:r>` +
  `<w:r><w:rPr><w:b/><w:color w:val="CC0000"/></w:rPr>` +
  `<w:t>CONFIDENTIAL</w:t></w:r></w:p>`;

const RIGHT_TAB_FOOTER =
  `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9026"/></w:tabs></w:pPr>` +
  `<w:r><w:t xml:space="preserve">Page \t</w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
  `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
  `<w:r><w:t xml:space="preserve"> of \t</w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>NUMPAGES</w:instrText>` +
  `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`;

describe('scoped HF interaction regressions', () => {
  test('arrow right after left text steps to CONFIDENTIAL start, not into the word', () => {
    const { surface, container } = mount(
      docx({ header: RIGHT_TAB_HEADER, footer: RIGHT_TAB_FOOTER })
    );
    container.querySelector<HTMLElement>('.docx-pages')!.focus();
    expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);

    const ids = surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rId10' });
    const paragraphId = ids[0]!;
    const left = 'Comprehensive Word Element Test v2';
    // Caret after "v2", at the tab character — the visual gap before CONFIDENTIAL.
    const afterLeft = left.length;
    surface.setSelection({
      anchor: { paragraphId, offset: afterLeft },
      head: { paragraphId, offset: afterLeft },
    });

    surface.navigate('right');
    const afterTab = surface.state().selection.head;
    expect(afterTab).toEqual({ paragraphId, offset: afterLeft + 1 });

    surface.navigate('right');
    expect(surface.state().selection.head).toEqual({ paragraphId, offset: afterLeft + 2 });
    // Still at/after 'C', never jumped past the first letter in one press from after "v2".
    const text = surface.session.storyText({ kind: 'headerFooter', rId: 'rId10' }) ?? '';
    expect(text.slice(afterLeft, afterLeft + 2)).toBe('\tC');

    surface.navigate('left');
    expect(surface.state().selection.head).toEqual({ paragraphId, offset: afterLeft + 1 });
    surface.navigate('left');
    expect(surface.state().selection.head).toEqual({ paragraphId, offset: afterLeft });

    // Engine caret is parented into the active band (story-relative), not the body content box.
    const caret = container.querySelector('.docx-editor-one-surface__caret') as HTMLElement | null;
    expect(caret).not.toBeNull();
    expect(caret!.closest('[data-docx-hf-active]')?.getAttribute('data-docx-hf')).toBe('header');
    expect(
      container.querySelector('.docx-pages')?.classList.contains('docx-pages--hf-editing')
    ).toBe(true);
    surface.destroy();
  });

  test('selection before CONFIDENTIAL paints at post-tab x, not after v2', () => {
    const { surface, container } = mount(
      docx({ header: RIGHT_TAB_HEADER, footer: RIGHT_TAB_FOOTER })
    );
    container.querySelector<HTMLElement>('.docx-pages')!.focus();
    expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);

    const page = surface.layout().pages[0]!;
    const story = page.header!;
    const line = story.fragments.flatMap((block) =>
      block.kind === 'paragraph' ? block.lines : []
    )[0]!;
    const tab = line.spans.find((span) => span.text === '\t')!;
    const confidential = line.spans[line.spans.indexOf(tab) + 1]!;
    expect(confidential.text.startsWith('C')).toBe(true);

    const paragraphId = surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rId10' })[0]!;
    const beforeC = tab.range.end;
    surface.setSelection({
      anchor: { paragraphId, offset: beforeC },
      head: { paragraphId, offset: beforeC },
    });

    const caret = container.querySelector('.docx-editor-one-surface__caret') as HTMLElement;
    expect(caret).not.toBeNull();
    const caretX = Number.parseFloat(caret.style.left);
    // Story-relative: must sit at CONFIDENTIAL, not at the pre-tab edge after "v2".
    expect(caretX).toBeCloseTo(confidential.box.x, 1);
    expect(caretX).toBeGreaterThan(tab.box.x + tab.box.width * 0.5);

    const hit = hitTestStoryAtLocalPoint(surface.layout(), page.index, story, {
      x: confidential.box.x + 1,
      y: line.box.y + 2,
    })!;
    expect(hit.position.offset).toBe(beforeC);
    surface.setSelection({ anchor: hit.position, head: hit.position });
    surface.navigate('left');
    expect(surface.state().selection.head.offset).toBe(tab.range.start);
    surface.navigate('right');
    expect(surface.state().selection.head.offset).toBe(beforeC);
    expect(Number.parseFloat(caret.style.left)).toBeCloseTo(confidential.box.x, 1);

    surface.destroy();
  });

  test('footer whitespace band maps to a visible story caret', () => {
    const { surface, container } = mount(
      docx({ header: RIGHT_TAB_HEADER, footer: RIGHT_TAB_FOOTER })
    );
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    pages.focus();
    expect(surface.enterHeaderFooter({ rId: 'rId12' })).toBe(true);

    const page = surface.layout().pages[0]!;
    const footer = page.footer!;
    // Click in the band, well to the left of right-aligned content.
    const hit = hitTestStoryAtLocalPoint(surface.layout(), page.index, footer, {
      x: 4,
      y: footer.box.height / 2,
    });
    expect(hit).not.toBeNull();
    surface.setSelection({
      anchor: hit!.position,
      head: hit!.position,
    });

    const caret = container.querySelector('.docx-editor-one-surface__caret') as HTMLElement | null;
    expect(caret).not.toBeNull();
    expect(caret!.closest('[data-docx-hf-active]')?.getAttribute('data-docx-hf')).toBe('footer');
    expect(Number.parseFloat(caret!.style.left)).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(caret!.style.top)).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(caret!.style.height)).toBeGreaterThan(0);
    surface.destroy();
  });

  test('whole-band activation, body dim class, exit restores body selection', () => {
    const { surface, container } = mount(
      docx({ header: RIGHT_TAB_HEADER, footer: RIGHT_TAB_FOOTER, body: `${p('One')}${p('Two')}` })
    );
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    pages.focus();
    const bodyIds = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: bodyIds[1]!, offset: 0 },
      head: { paragraphId: bodyIds[1]!, offset: 3 },
    });
    const saved = surface.state().selection;

    const page = surface.layout().pages[0]!;
    const header = page.header!;
    // Activate from whitespace in the story box (not a glyph hit).
    expect(
      surface.enterHeaderFooter({
        rId: header.rId!,
        pageIndex: page.index,
        kind: 'header',
        position: hitTestStoryAtLocalPoint(surface.layout(), page.index, header, {
          x: header.box.width - 8,
          y: 2,
        })!.position,
      })
    ).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rId10' });
    expect(pages.classList.contains('docx-pages--hf-editing')).toBe(true);
    expect(container.classList.contains('docx-paginated-surface--hf-editing')).toBe(true);
    const active = container.querySelector('[data-docx-hf-active]') as HTMLElement;
    expect(active.dataset.docxHf).toBe('header');
    expect(active.getAttribute('contenteditable')).toBe('true');
    expect(container.querySelector('.docx-page-content')?.getAttribute('contenteditable')).toBe(
      'false'
    );
    const inactiveFooter = container.querySelector('[data-docx-hf="footer"]') as HTMLElement;
    expect(inactiveFooter.getAttribute('contenteditable')).toBe('false');
    expect(inactiveFooter.hasAttribute('data-docx-hf-active')).toBe(false);

    surface.exitHeaderFooter();
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    expect(surface.state().selection).toEqual(saved);
    expect(pages.classList.contains('docx-pages--hf-editing')).toBe(false);
    expect(container.querySelector('[data-docx-hf-active]')).toBeNull();
    expect(
      container.querySelector('[data-docx-hf="header"]')?.getAttribute('contenteditable')
    ).toBe('false');
    surface.destroy();
  });

  test('shared rId: caret occurrence follows the clicked page, not the first copy', () => {
    const { surface, container } = mount(
      docx({
        header: RIGHT_TAB_HEADER,
        sharedHeaderAcrossSections: true,
        body: p('x'),
      })
    );
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    pages.focus();

    const layoutPages = surface.layout().pages.filter((page) => page.header?.rId === 'rId10');
    expect(layoutPages.length).toBeGreaterThanOrEqual(2);
    const first = layoutPages[0]!;
    const second = layoutPages[1]!;

    expect(surface.enterHeaderFooter({ rId: 'rId10', pageIndex: first.index })).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rId10' });

    const activeOn = (pageIndex: number) =>
      container.querySelector(
        `[data-page-index="${pageIndex}"] > [data-docx-hf-active]`
      ) as HTMLElement | null;
    expect(activeOn(first.index)).not.toBeNull();
    expect(activeOn(second.index)).toBeNull();

    const paragraphId = surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rId10' })[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    let caret = container.querySelector('.docx-editor-one-surface__caret') as HTMLElement | null;
    expect(caret?.closest('[data-page-index]')?.getAttribute('data-page-index')).toBe(
      String(first.index)
    );

    // Retarget visual occurrence to the second shared copy (whitespace/click equivalent).
    const hit = hitTestStoryAtLocalPoint(surface.layout(), second.index, second.header!, {
      x: 8,
      y: 2,
    });
    expect(hit).not.toBeNull();
    expect(
      surface.enterHeaderFooter({
        rId: 'rId10',
        pageIndex: second.index,
        kind: 'header',
        position: hit!.position,
      })
    ).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rId10' });
    expect(activeOn(second.index)).not.toBeNull();
    expect(activeOn(first.index)).toBeNull();
    caret = container.querySelector('.docx-editor-one-surface__caret') as HTMLElement | null;
    expect(caret).not.toBeNull();
    expect(caret!.closest('[data-page-index]')?.getAttribute('data-page-index')).toBe(
      String(second.index)
    );
    expect(container.querySelectorAll('[data-docx-hf-active]')).toHaveLength(1);

    surface.navigate('right');
    expect(surface.state().selection.head.paragraphId).toBe(paragraphId);
    surface.type('Z');
    expect(surface.session.storyText({ kind: 'headerFooter', rId: 'rId10' })).toContain('Z');
    // Both painted copies show the shared edit.
    for (const el of container.querySelectorAll('[data-docx-hf="header"]')) {
      expect(el.textContent).toContain('Z');
    }
    surface.undo();
    expect(surface.session.storyText({ kind: 'headerFooter', rId: 'rId10' })).not.toContain('Z');

    // Click back to the first occurrence.
    expect(surface.enterHeaderFooter({ rId: 'rId10', pageIndex: first.index })).toBe(true);
    expect(activeOn(first.index)).not.toBeNull();
    expect(activeOn(second.index)).toBeNull();
    caret = container.querySelector('.docx-editor-one-surface__caret') as HTMLElement | null;
    expect(caret?.closest('[data-page-index]')?.getAttribute('data-page-index')).toBe(
      String(first.index)
    );

    // Distinct rId switches scope normally (footer when present is a different story).
    const withFooter = mount(
      docx({ header: p('H'), footer: p('F'), sharedHeaderAcrossSections: true, body: p('x') })
    );
    withFooter.container.querySelector<HTMLElement>('.docx-pages')!.focus();
    expect(withFooter.surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
    expect(withFooter.surface.enterHeaderFooter({ rId: 'rId12' })).toBe(true);
    expect(withFooter.surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rId12' });
    expect(
      withFooter.container.querySelector('[data-docx-hf-active]')?.getAttribute('data-docx-hf')
    ).toBe('footer');
    withFooter.surface.destroy();

    surface.destroy();
  });

  test('comprehensive fixture header tab navigation and closed furniture stay protected', () => {
    const bytes = new Uint8Array(readFileSync(COMPREHENSIVE_FIXTURE));
    const container = document.createElement('div');
    document.body.append(container);
    const result = mountPaginatedSurface(container, bytes, { scale: 1 });
    if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
    const { surface } = result;
    container.querySelector<HTMLElement>('.docx-pages')!.focus();

    const page = surface.layout().pages.find((sheet) => sheet.header?.rId);
    expect(page?.header?.rId).toBeTruthy();
    const header = page!.header!;

    // Closed: still inert.
    const painted = container.querySelector(
      `[data-page-index="${page!.index}"] > [data-docx-hf="header"]`
    ) as HTMLElement;
    expect(painted.getAttribute('contenteditable')).toBe('false');
    const span = painted.querySelector('[data-paragraph-id][data-start]')!;
    expect(positionFromDomPoint(span.firstChild!, 0, container)).toBeNull();

    expect(surface.enterHeaderFooter({ rId: header.rId!, pageIndex: page!.index })).toBe(true);
    const paragraphId = surface.session.paragraphIdsIn({
      kind: 'headerFooter',
      rId: header.rId!,
    })[0]!;
    const left = 'Comprehensive Word Element Test v2';
    surface.setSelection({
      anchor: { paragraphId, offset: left.length },
      head: { paragraphId, offset: left.length },
    });
    surface.navigate('right');
    expect(surface.state().selection.head.offset).toBe(left.length + 1);
    surface.navigate('right');
    expect(surface.state().selection.head.offset).toBe(left.length + 2);

    const storyText = surface.session.storyText({ kind: 'headerFooter', rId: header.rId! }) ?? '';
    expect(storyText.includes('CONFIDENTIAL')).toBe(true);
    expect(storyText[left.length]).toBe('\t');
    expect(storyText[left.length + 1]).toBe('C');

    surface.destroy();
  });
});

describe('surface-root pointer delegation for HF / notes', () => {
  function stubPagesRect(pages: HTMLElement): void {
    Object.defineProperty(pages, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 2000,
        bottom: 4000,
        width: 2000,
        height: 4000,
        x: 0,
        y: 0,
      }),
    });
  }

  function pressAt(
    pages: HTMLElement,
    target: EventTarget,
    clientX: number,
    clientY: number,
    init: PointerEventInit = {}
  ): PointerEvent {
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX,
      clientY,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  }

  test('root listener: single press in top margin places body caret without entering HF', () => {
    const { surface, container } = mount(
      docx({ header: RIGHT_TAB_HEADER, footer: RIGHT_TAB_FOOTER, body: `${p('One')}${p('Two')}` })
    );
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    stubPagesRect(pages);
    pages.focus();

    const page = surface.layout().pages[0]!;
    const header = page.header!;
    const clientX = header.box.x + 8;
    const clientY = Math.max(page.box.y + 2, header.box.y - 4);

    const event = pressAt(pages, pages, clientX, clientY);
    expect(event.defaultPrevented).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    expect(pages.classList.contains('docx-pages--hf-editing')).toBe(false);
    const bodyIds = surface.session.paragraphIds();
    const { head } = surface.state().selection;
    expect(bodyIds).toContain(head.paragraphId);
    expect(document.activeElement).toBe(pages);

    surface.destroy();
  });

  test('root listener: single press in bottom margin places body caret without entering HF', () => {
    const { surface, container } = mount(
      docx({ header: p('H'), footer: p('FOOTER'), body: `${p('One')}${p('Two')}` })
    );
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    stubPagesRect(pages);
    pages.focus();

    const page = surface.layout().pages[0]!;
    const footer = page.footer!;
    const painted = container.querySelector('[data-docx-hf="footer"]') as HTMLElement;
    const clientX = footer.box.x + 4;
    const clientY = page.box.y + page.box.height - 4;

    const event = pressAt(pages, painted, clientX, clientY);
    expect(event.defaultPrevented).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    expect(pages.classList.contains('docx-pages--hf-editing')).toBe(false);
    const bodyIds = surface.session.paragraphIds();
    const { head } = surface.state().selection;
    expect(bodyIds).toContain(head.paragraphId);
    expect(document.activeElement).toBe(pages);

    surface.destroy();
  });

  test('root listener: double press on painted header band enters HF scope and dims body', () => {
    const { surface, container } = mount(
      docx({ header: RIGHT_TAB_HEADER, footer: RIGHT_TAB_FOOTER, body: `${p('One')}${p('Two')}` })
    );
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    stubPagesRect(pages);
    pages.focus();

    const page = surface.layout().pages[0]!;
    const header = page.header!;
    expect(header.rId).toBe('rId10');

    // Margin whitespace ABOVE the flowed story box — still inside the activation band.
    const clientX = header.box.x + 8;
    const clientY = Math.max(page.box.y + 2, header.box.y - 4);
    const first = pressAt(pages, pages, clientX, clientY);
    expect(first.defaultPrevented).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    const event = pressAt(pages, pages, clientX, clientY);

    expect(event.defaultPrevented).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rId10' });
    expect(pages.classList.contains('docx-pages--hf-editing')).toBe(true);
    expect(container.querySelector('[data-docx-hf-active]')?.getAttribute('data-docx-hf')).toBe(
      'header'
    );
    expect(container.querySelector('.docx-page-content')?.getAttribute('contenteditable')).toBe(
      'false'
    );

    // Escape leaves via the surface keymap (same root listener composition).
    pages.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    expect(pages.classList.contains('docx-pages--hf-editing')).toBe(false);

    surface.destroy();
  });

  test('root listener: double press on painted footer band enters footer scope', () => {
    const { surface, container } = mount(
      docx({ header: p('H'), footer: p('FOOTER'), body: p('Body') })
    );
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    stubPagesRect(pages);
    pages.focus();

    const page = surface.layout().pages[0]!;
    const footer = page.footer!;
    const painted = container.querySelector('[data-docx-hf="footer"]') as HTMLElement;
    expect(painted).toBeTruthy();

    const first = pressAt(
      pages,
      painted,
      footer.box.x + 4,
      footer.box.y + Math.max(1, footer.box.height / 2)
    );
    expect(first.defaultPrevented).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    const event = pressAt(
      pages,
      painted,
      footer.box.x + 4,
      footer.box.y + Math.max(1, footer.box.height / 2)
    );
    expect(event.defaultPrevented).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'headerFooter', rId: footer.rId! });
    expect(container.querySelector('[data-docx-hf-active]')?.getAttribute('data-docx-hf')).toBe(
      'footer'
    );
    surface.destroy();
  });

  test('viewing mode refuses the double press, and closes a band left open by a mode switch', () => {
    // The hover invitation is hidden in viewing, but the SCOPE was still one double-click
    // away: this lane never passes the facade, which classifies `editHeaderFooter` as
    // mutating. An open band survived the switch too — a write UI over a read-only document.
    const { surface, container } = mount(
      docx({ header: p('H'), footer: p('FOOTER'), body: p('Body') })
    );
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    stubPagesRect(pages);
    pages.focus();

    const page = surface.layout().pages[0]!;
    const footer = page.footer!;
    // Re-queried on every press: each repaint replaces the band, and a press dispatched on
    // the detached node never reaches the root listener.
    const pressTwice = (): void => {
      for (let press = 0; press < 2; press += 1) {
        const painted = container.querySelector('[data-docx-hf="footer"]') as HTMLElement;
        pressAt(
          pages,
          painted,
          footer.box.x + 4,
          footer.box.y + Math.max(1, footer.box.height / 2)
        );
      }
    };

    // Left open in editing, then the mode moves under it.
    pressTwice();
    expect(surface.activeScope()).toEqual({ kind: 'headerFooter', rId: footer.rId! });
    surface.setEditingMode('view');
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    expect(container.querySelector('[data-docx-hf-active]')).toBeNull();

    // And it cannot be reopened — by the pointer, by the surface's own method, or by
    // `setActiveScope`. Gating the pointer alone left the other two opening the dimmed body
    // and the whole header options bar over a document that refuses every write.
    pressTwice();
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    expect(surface.enterHeaderFooter({ rId: footer.rId! })).toBe(false);
    expect(surface.setActiveScope({ kind: 'headerFooter', rId: footer.rId! })).toBe(false);
    expect(surface.activeScope()).toEqual({ kind: 'body' });

    // The blank band on the other page furniture stays refused too (already gated).
    surface.setEditingMode('edit');
    pressTwice();
    expect(surface.activeScope()).toEqual({ kind: 'headerFooter', rId: footer.rId! });
    surface.destroy();
  });

  test('root listener: double press in the BLANK header margin creates the header and opens it', () => {
    const { surface, container } = mount(docx({ body: `${p('One')}${p('Two')}` }));
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    stubPagesRect(pages);
    pages.focus();

    // No story, but the blank-band affordance is painted so hover can invite the press.
    expect(container.querySelector('[data-docx-hf][data-docx-r-id]')).toBeNull();
    expect(container.querySelector('.docx-hf--placeholder[data-docx-hf="header"]')).not.toBeNull();

    const page = surface.layout().pages[0]!;
    const clientX = page.contentBox.x + 8;
    const clientY = page.box.y + 2;

    // A single press stays a body gesture: margin clicks place the nearest body caret.
    const first = pressAt(pages, pages, clientX, clientY);
    expect(first.defaultPrevented).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    expect(surface.session.headerFooterResolutionBySection()[0]?.headers.size ?? 0).toBe(0);

    const second = pressAt(pages, pages, clientX, clientY);
    expect(second.defaultPrevented).toBe(true);
    // The part was created — one committed package op — and its scope opened for editing.
    const slot = surface.session.headerFooterResolutionBySection()[0]!.headers.get('default');
    expect(slot).toBeDefined();
    expect(surface.activeScope()).toEqual({ kind: 'headerFooter', rId: slot!.rId });
    expect(surface.headerFooterState()?.editing).toBe('header');
    expect(surface.session.canUndo()).toBe(true);
    surface.destroy();
  });

  test('root listener: blank-band create works on a minimal document with no sectPr and no rels', () => {
    // The shape a host's "new document" produces: one paragraph, no `w:sectPr`, no
    // `document.xml.rels`, and no `xmlns:r` on the root. The minted `w:headerReference`
    // carries `r:id`, and without a root binding the whole create refused `invalid-qname` —
    // double-clicking the blank band on a fresh document did nothing at all.
    const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
    const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t></w:t></w:r></w:p></w:body></w:document>`
      ),
    });
    const container = document.createElement('div');
    const result = mountPaginatedSurface(container, bytes, { scale: 1 });
    if (!result.ok) throw new Error(String(result.reason));
    const surface = result.surface;
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    stubPagesRect(pages);
    pages.focus();

    const page = surface.layout().pages[0]!;
    const clientX = page.contentBox.x + 8;
    const clientY = page.box.y + 2;
    pressAt(pages, pages, clientX, clientY);
    pressAt(pages, pages, clientX, clientY);

    const slot = surface.session.headerFooterResolutionBySection()[0]!.headers.get('default');
    expect(slot).toBeDefined();
    expect(surface.activeScope()).toEqual({ kind: 'headerFooter', rId: slot!.rId });
    expect(surface.headerFooterState()?.editing).toBe('header');

    // The minted root `xmlns:r` binding survives save: reopening the bytes still resolves
    // the header reference.
    const reopened = mountPaginatedSurface(document.createElement('div'), surface.session.save(), {
      scale: 1,
    });
    if (!reopened.ok) throw new Error(String(reopened.reason));
    expect(
      reopened.surface.session.headerFooterResolutionBySection()[0]!.headers.get('default')
    ).toBeDefined();
    reopened.surface.destroy();
    surface.destroy();
  });

  test('root listener: viewing mode refuses to create a header from the blank band', () => {
    const { surface, container } = mount(docx({ body: p('Body') }));
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    stubPagesRect(pages);
    pages.focus();
    surface.setEditingMode('view');

    const page = surface.layout().pages[0]!;
    const clientX = page.contentBox.x + 8;
    const clientY = page.box.y + 2;
    pressAt(pages, pages, clientX, clientY);
    pressAt(pages, pages, clientX, clientY);

    expect(surface.activeScope()).toEqual({ kind: 'body' });
    expect(surface.session.headerFooterResolutionBySection()[0]?.headers.size ?? 0).toBe(0);
    surface.destroy();
  });

  test('root listener: DOM furniture hit without layout miss still enters via data-docx-r-id', () => {
    const { surface, container } = mount(docx({ header: p('HDR'), body: p('Body') }));
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    stubPagesRect(pages);
    pages.focus();

    const painted = container.querySelector('[data-docx-hf="header"]') as HTMLElement;
    expect(painted.dataset.docxRId).toBe('rId10');

    // Dispatch on the furniture node far outside the sheet — storyHit misses, so the first
    // press falls through to body hit-testing; the second uses the DOM rId fallback.
    const first = pressAt(pages, painted, -500, -500);
    expect(first.defaultPrevented).toBe(true);
    const event = pressAt(pages, painted, -500, -500);
    expect(event.defaultPrevented).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rId10' });
    surface.destroy();
  });

  test('header hyperlink owns header rels; undo restores; no stray body relationship', () => {
    const { surface } = mount(docx({ header: p('HEADER'), body: p('Body') }));
    expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
    const paragraphId = surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rId10' })[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 6 },
    });

    const beforeBodyExternals = surface.session
      .currentPackage()
      .externalTargets.filter((entry) => entry.ownerPart === surface.session.part().name);
    expect(surface.hyperlinks.applyHyperlink({ url: 'https://example.com/hf' })).toBe(true);

    const pkg = surface.session.currentPackage();
    const headerPart = surface.session.partFor({ kind: 'headerFooter', rId: 'rId10' })!;
    const headerLinks = pkg.externalTargets.filter(
      (entry) => entry.ownerPart === headerPart.name && entry.rawTarget === 'https://example.com/hf'
    );
    expect(headerLinks).toHaveLength(1);
    expect(
      pkg.externalTargets.filter(
        (entry) =>
          entry.ownerPart === pkg.mainDocumentPart && entry.rawTarget === 'https://example.com/hf'
      )
    ).toHaveLength(0);
    expect(
      pkg.externalTargets.filter((entry) => entry.ownerPart === pkg.mainDocumentPart)
    ).toHaveLength(beforeBodyExternals.length);

    const link = surface.hyperlinks.linkAtCaret();
    expect(link?.href).toBe('https://example.com/hf');
    expect(JSON.stringify(headerPart.root)).toContain('hyperlink');
    expect(JSON.stringify(surface.session.part().root)).not.toContain('https://example.com/hf');

    surface.undo();
    expect(surface.hyperlinks.linkAtCaret()).toBeNull();
    expect(
      JSON.stringify(surface.session.partFor({ kind: 'headerFooter', rId: 'rId10' })!.root)
    ).not.toContain('"kind":"hyperlink"');
    // Relationship leftovers are intentional (Word-compatible); ownership stays on the header.
    expect(
      surface.session
        .currentPackage()
        .externalTargets.some(
          (entry) =>
            entry.ownerPart === headerPart.name && entry.rawTarget === 'https://example.com/hf'
        )
    ).toBe(true);
    expect(
      surface.session
        .currentPackage()
        .externalTargets.some(
          (entry) =>
            entry.ownerPart === pkg.mainDocumentPart && entry.rawTarget === 'https://example.com/hf'
        )
    ).toBe(false);
    surface.destroy();
  });
});
