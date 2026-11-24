import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { paragraphFragmentsOf } from '../../layout/index.ts';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>' +
  '</w:styles>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLE_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const TOC_CONTENT =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\o "1-1" \\h </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
  '<w:p><w:r><w:t>Old cached entry</w:t></w:r></w:p>' +
  '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
const HEADING =
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>';
/** A cached result whose row NAMES the heading, which is how a click resolves its target. */
const CURRENT_TOC_CONTENT = TOC_CONTENT.replace(
  '<w:p><w:r><w:t>Old cached entry</w:t></w:r></w:p>',
  '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t>Introduction</w:t></w:r>' +
    '<w:r><w:ptab w:alignment="right" w:relativeTo="margin" w:leader="dot"/></w:r>' +
    '<w:r><w:t>1</w:t></w:r></w:p>'
);
const BODY =
  '<w:sdt><w:sdtPr><w:alias w:val="Contents"/></w:sdtPr><w:sdtContent>' +
  TOC_CONTENT +
  '</w:sdtContent></w:sdt>' +
  HEADING;
const EMPTY_TOC =
  '<w:sdt><w:sdtPr><w:alias w:val="Contents"/></w:sdtPr><w:sdtContent>' +
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\o "1-1" \\h </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
  '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
  '</w:sdtContent></w:sdt>';

async function documentXml(editor: ReturnType<typeof createDocxEditor>): Promise<string> {
  const bytes = new Uint8Array(await editor.save());
  return strFromU8(unzipSync(bytes)['word/document.xml']!);
}

describe('TOC refresh editor lane', () => {
  test('inserts a populated read-only TOC through the public command', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(HEADING + '<w:p><w:r><w:t>Body</w:t></w:r></w:p>'));

    expect(editor.can({ type: 'insertToc' })).toEqual({ ok: true });
    expect(editor.exec({ type: 'insertToc' })).toEqual({ ok: true, changed: true });
    let xml = await documentXml(editor);
    expect(xml).toContain('w:docPartGallery w:val="Table of Contents"');
    expect(xml).toContain('TOC \\o &quot;1-3&quot; \\h');
    expect(xml).toContain('w:pStyle w:val="TOC1"');
    expect(xml).toContain('w:hyperlink');
    expect(xml).toContain('Introduction');

    const row = [...container.querySelectorAll<HTMLElement>('a.docx-hyperlink')]
      .find((element) => element.textContent?.includes('Introduction'))
      ?.closest<HTMLElement>('.docx-paragraph-fragment');
    expect(row?.getAttribute('contenteditable')).toBe('false');
    expect(row?.getAttribute('aria-readonly')).toBeNull();

    // Convergence had no digit to move — the heading is on page 1 either way — and a pass that
    // writes nothing is not a document change, so the insertion is a single undo step. The
    // separately undoable page-number phase is asserted where it is observable, below.
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    xml = await documentXml(editor);
    expect(xml).not.toContain('w:docPartGallery');
    expect(xml).not.toContain('w:bookmarkStart');
    editor.destroy();
  });

  test('inserted TOC first entry has no preceding blank row', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(HEADING + '<w:p><w:r><w:t>Body</w:t></w:r></w:p>'));
    expect(editor.exec({ type: 'insertToc' })).toEqual({ ok: true, changed: true });

    const entryFragment = editor
      .surface!.layout()
      .pages.flatMap((page) => paragraphFragmentsOf(page))
      .find((fragment) =>
        fragment.lines.some((line) => line.spans.some((span) => span.text.includes('Introduction')))
      );
    expect(entryFragment).toBeDefined();
    expect(entryFragment!.box.y).toBe(0);

    const painted = [...container.querySelectorAll<HTMLElement>('.docx-paragraph-fragment')].find(
      (element) => element.textContent?.includes('Introduction')
    );
    expect(painted).toBeDefined();
    const preceding = painted!
      .closest('.docx-page-content')
      ?.querySelectorAll('.docx-paragraph-fragment');
    if (preceding) {
      for (const fragment of preceding) {
        if (fragment === painted) break;
        expect(fragment.textContent?.trim()).not.toBe('');
      }
    }
    editor.destroy();
  });

  test('queries, refreshes, persists, and refuses edits inside the result', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    const errors: string[] = [];
    editor.on('error', (error) => errors.push(`${error.code}: ${error.message}`));
    editor.load(docx(BODY));
    expect(errors).toEqual([]);
    expect(editor.surface).not.toBeNull();
    expect(editor.query({ type: 'isInsideToc', pos: 0 })).toBe(false);
    expect(editor.can({ type: 'refreshToc' }).ok).toBe(true);
    editor.surface!.deleteBackward();
    expect(await documentXml(editor)).toContain('Old cached entry');
    expect(container.querySelector('.docx-content-control-boundary')).not.toBeNull();
    expect(container.querySelector('[data-docx-region-widget]')).toBeNull();
    const row = [...container.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find(
      (element) => element.textContent?.includes('Old cached entry')
    );
    const rowFragment = row!.closest<HTMLElement>('.docx-paragraph-fragment')!;
    expect(rowFragment.getAttribute('contenteditable')).toBe('false');
    expect(rowFragment.getAttribute('aria-readonly')).toBeNull();
    const rowParagraphId = rowFragment.dataset.paragraphId!;
    editor.surface!.setSelection({
      anchor: { paragraphId: rowParagraphId, offset: 0 },
      head: { paragraphId: rowParagraphId, offset: 0 },
    });
    editor.surface!.type('tamper');
    expect(await documentXml(editor)).not.toContain('tamper');
    // The engine paints no menu of its own: a right-click over a TOC publishes which one it
    // landed on and lets the event through to the host's context menu.
    const open = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 320,
      clientY: 240,
    });
    row!.dispatchEvent(open);
    expect(open.defaultPrevented).toBe(false);
    expect(container.querySelector('.docx-content-control-menu')).toBeNull();
    expect(editor.snapshot().tocContext).not.toBeNull();

    expect(editor.exec({ type: 'refreshToc', mode: 'entire' })).toEqual({
      ok: true,
      changed: true,
    });
    let xml = await documentXml(editor);
    expect(xml).toContain('Introduction');
    expect(xml).toContain('TOC1');
    expect(xml).not.toContain('Old cached entry');
    const entryLink = [...container.querySelectorAll<HTMLElement>('a.docx-hyperlink')].find(
      (anchor) => anchor.textContent?.includes('Introduction')
    );
    const jump = new MouseEvent('click', { bubbles: true, cancelable: true });
    entryLink!.dispatchEvent(jump);
    expect(jump.defaultPrevented).toBe(true);
    expect(editor.query({ type: 'isInsideToc', pos: 0 })).toBe(false);

    // Nothing left for the page-number phase to write, so it reports no change rather than
    // stacking an empty step, and one undo takes the whole refresh back.
    expect(editor.exec({ type: 'refreshToc', mode: 'pageNumbers' })).toEqual({
      ok: true,
      changed: false,
    });
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    xml = await documentXml(editor);
    expect(xml).toContain('Old cached entry');
    editor.destroy();
  });

  test('a page-number pass is its own undo step once a digit actually moves', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(
      docx(
        '<w:sdt><w:sdtPr><w:alias w:val="Contents"/></w:sdtPr><w:sdtContent>' +
          TOC_CONTENT +
          '</w:sdtContent></w:sdt>' +
          '<w:p><w:r><w:t>Filler</w:t></w:r></w:p>' +
          HEADING
      )
    );

    expect(editor.exec({ type: 'refreshToc', mode: 'entire' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(await documentXml(editor)).toContain('<w:t>1</w:t>');

    // Push the heading onto page 2, which makes the digit the refresh wrote stale. A break
    // at the start of the heading itself is covered in toc-leading-page-break.test.ts.
    const filler = [...container.querySelectorAll<HTMLElement>('.docx-paragraph-fragment')].find(
      (fragment) => fragment.textContent === 'Filler'
    )!;
    editor.surface!.setSelection({
      anchor: { paragraphId: filler.dataset.paragraphId!, offset: 6 },
      head: { paragraphId: filler.dataset.paragraphId!, offset: 6 },
    });
    expect(editor.exec({ type: 'insertBreak', kind: 'page' }).ok).toBe(true);

    expect(editor.exec({ type: 'refreshToc', mode: 'pageNumbers' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(await documentXml(editor)).toContain('<w:t>2</w:t>');

    // The digits are a step of their own: undoing them leaves the break and the entry alone.
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    const xml = await documentXml(editor);
    expect(xml).toContain('<w:t>1</w:t>');
    expect(xml).toContain('w:br');
    expect(xml).toContain('Introduction');
    editor.destroy();
  });

  test('a right-click publishes the TOC it landed on, and only that one', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(TOC_CONTENT + HEADING));

    const rightClickOn = (element: HTMLElement): void => {
      element.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
      );
    };
    const row = [...container.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find(
      (element) => element.textContent?.includes('Old cached entry')
    )!;
    const outside = [...container.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find(
      (element) => element.textContent?.includes('Introduction')
    )!;

    expect(editor.snapshot().tocContext).toBeNull();
    rightClickOn(row);
    const context = editor.snapshot().tocContext;
    expect(context).not.toBeNull();
    // The id the menu's rows will act on, so it has to name the TOC and not the row.
    expect(editor.surface!.canRefreshToc(context!.id)).toBe(true);

    // A right-click anywhere else takes it back: a stale context would leave the update rows
    // in a menu opened over ordinary text.
    rightClickOn(outside);
    expect(editor.snapshot().tocContext).toBeNull();
    editor.destroy();
  });

  test('bare TOC fields reuse the shared structured-region boundary', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(TOC_CONTENT + HEADING));

    expect(container.querySelector('.docx-content-control-boundary')).not.toBeNull();
    expect(container.querySelector('[data-docx-region-widget]')).toBeNull();
    editor.destroy();
  });

  test('empty TOC paints subtle read-only furniture that opens update actions', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(EMPTY_TOC + HEADING));

    const placeholders = container.querySelectorAll<HTMLElement>('[data-docx-toc-empty]');
    expect(placeholders).toHaveLength(1);
    const placeholder = placeholders[0]!;
    expect(placeholder.classList.contains('docx-toc-empty-placeholder')).toBe(true);
    expect(placeholder.getAttribute('contenteditable')).toBe('false');
    expect(placeholder.getAttribute('aria-readonly')).toBeNull();
    expect(placeholder.dataset.paragraphId).toBeTruthy();
    // Furniture is empty — no prompt text baked into the document or the painted node text.
    expect(placeholder.textContent?.trim() ?? '').toBe('');
    const before = await documentXml(editor);
    expect(before).not.toMatch(/docx-toc-empty|Empty TOC|Click to update/i);

    const open = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 240,
      clientY: 180,
    });
    placeholder.dispatchEvent(open);
    // Inert here, and addressable by the host's menu: the placeholder is the ONE thing an
    // empty region offers, so the right-click on it has to name the TOC behind it.
    expect(open.defaultPrevented).toBe(false);
    expect(editor.snapshot().tocContext).not.toBeNull();

    expect(editor.exec({ type: 'refreshToc', mode: 'entire' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(container.querySelector('[data-docx-toc-empty]')).toBeNull();
    expect(
      [...container.querySelectorAll<HTMLElement>('a.docx-hyperlink')].some((anchor) =>
        anchor.textContent?.includes('Introduction')
      )
    ).toBe(true);
    expect(await documentXml(editor)).toContain('Introduction');
    editor.destroy();
  });

  test('populated TOC chrome is hover-only and never sticky after click', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(TOC_CONTENT + HEADING));

    const tocChrome = container.querySelector<HTMLElement>('[data-docx-toc]');
    expect(tocChrome).not.toBeNull();
    expect(tocChrome!.hasAttribute('data-active')).toBe(false);
    expect(tocChrome!.hasAttribute('data-hover')).toBe(false);
    expect(tocChrome!.hasAttribute('data-boundary-visible')).toBe(false);

    const row = [...container.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find(
      (element) => element.textContent?.includes('Old cached entry')
    )!;
    row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 40 }));
    const hovered = container.querySelector<HTMLElement>('[data-docx-toc]');
    expect(hovered?.hasAttribute('data-hover')).toBe(true);
    expect(hovered?.hasAttribute('data-boundary-visible')).toBe(true);
    expect(hovered?.hasAttribute('data-active')).toBe(false);

    row.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }));
    const afterClick = container.querySelector<HTMLElement>('[data-docx-toc]');
    // Navigation may leave the pointer "over" the row in jsdom; sticky active must stay off.
    expect(afterClick?.hasAttribute('data-active')).toBe(false);

    container
      .querySelector('.docx-pages')!
      .dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    const atRest = container.querySelector<HTMLElement>('[data-docx-toc]');
    expect(atRest?.hasAttribute('data-hover')).toBe(false);
    expect(atRest?.hasAttribute('data-active')).toBe(false);
    expect(atRest?.hasAttribute('data-boundary-visible')).toBe(false);

    const outside = [...container.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find(
      (element) => element.textContent?.includes('Introduction')
    )!;
    outside.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }));
    const afterOutside = container.querySelector<HTMLElement>('[data-docx-toc]');
    expect(afterOutside?.hasAttribute('data-active')).toBe(false);
    expect(afterOutside?.hasAttribute('data-hover')).toBe(false);
    editor.destroy();
  });

  test('a hover-entering pointermove keeps the painted nodes, so the right-click after it lands', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(
      docx(
        '<w:sdt><w:sdtPr><w:alias w:val="Contents"/></w:sdtPr><w:sdtContent>' +
          CURRENT_TOC_CONTENT +
          '</w:sdtContent></w:sdt>' +
          HEADING
      )
    );

    const rowOf = (): HTMLElement =>
      [...container.querySelectorAll<HTMLElement>('.docx-paragraph-fragment')].find((element) =>
        element.hasAttribute('data-docx-read-only')
      )!;
    const row = rowOf();
    const page = container.querySelector<HTMLElement>('[data-page-index="0"]')!;
    const chrome = container.querySelector<HTMLElement>('[data-docx-toc]')!;

    // The pointer ARRIVING on the TOC is the gesture's own first event. Repainting here
    // detached the node the following `contextmenu` was aimed at, and the right-click
    // resolved to nothing.
    row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 40 }));
    expect(rowOf()).toBe(row);
    expect(row.isConnected).toBe(true);
    expect(container.querySelector('[data-page-index="0"]')).toBe(page);
    expect(container.querySelector('[data-docx-toc]')).toBe(chrome);
    expect(chrome.hasAttribute('data-hover')).toBe(true);
    expect(chrome.hasAttribute('data-boundary-visible')).toBe(true);

    const open = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 40,
    });
    row.dispatchEvent(open);
    expect(editor.snapshot().tocContext).not.toBeNull();

    // Same for the left-click that navigates: it arrives with the pointer entering too.
    const jump = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
    rowOf().dispatchEvent(jump);
    expect(jump.defaultPrevented).toBe(true);
    editor.destroy();
  });

  test('an empty TOC paints exactly one box, with no second boundary and no label chip', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(EMPTY_TOC + HEADING));

    expect(container.querySelectorAll('[data-docx-toc-empty]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-docx-toc]')).toHaveLength(0);
    expect(container.querySelector('.docx-content-control-boundary')).toBeNull();
    expect(container.querySelector('.docx-content-control-label')).toBeNull();

    // Populating the region hands the chrome back: hover-only boundary, nothing at rest.
    expect(editor.exec({ type: 'refreshToc', mode: 'entire' }).ok).toBe(true);
    expect(container.querySelector('[data-docx-toc-empty]')).toBeNull();
    const chrome = container.querySelector<HTMLElement>('[data-docx-toc]');
    expect(chrome).not.toBeNull();
    expect(chrome!.hasAttribute('data-boundary-visible')).toBe(false);
    expect(chrome!.hasAttribute('data-hover')).toBe(false);
    editor.destroy();
  });

  test('a plain TOC row snaps to its heading even without the hyperlink switch', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    editor.load(docx(CURRENT_TOC_CONTENT.replace(' \\h ', ' ') + HEADING));
    const row = [...container.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find(
      (element) => element.hasAttribute('data-docx-read-only')
    );
    expect(row?.querySelector('a.docx-hyperlink')).toBeNull();

    const jump = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
    row!.dispatchEvent(jump);
    expect(jump.defaultPrevented).toBe(true);
    expect(editor.query({ type: 'isInsideToc', pos: 0 })).toBe(false);
    editor.destroy();
  });

  test('page numbers follow each row to its own heading, not to its position', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });

    const row = (title: string, page: string): string =>
      '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>' +
      `<w:r><w:t>${title}</w:t></w:r>` +
      '<w:r><w:ptab w:alignment="right" w:relativeTo="margin" w:leader="dot"/></w:r>' +
      `<w:r><w:t>${page}</w:t></w:r></w:p>`;
    const heading = (text: string): string =>
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

    // The cached rows name Alpha and Beta. The document has since grown a heading, Gamma,
    // AHEAD of both, so rows and outline entries no longer share an index. Alpha is on page 2
    // and Beta on page 3; matching by position wrote Gamma's page into Alpha's row and
    // Alpha's into Beta's, one off, with nothing to say it had happened.
    editor.load(
      docx(
        '<w:sdt><w:sdtPr><w:alias w:val="Contents"/></w:sdtPr><w:sdtContent>' +
          '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\o "1-1" \\h </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
          row('Alpha', '9') +
          row('Beta', '9') +
          '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
          '</w:sdtContent></w:sdt>' +
          heading('Gamma') +
          pageBreak +
          heading('Alpha') +
          pageBreak +
          heading('Beta')
      )
    );

    expect(editor.exec({ type: 'refreshToc', mode: 'pageNumbers' })).toMatchObject({ ok: true });
    const xml = await documentXml(editor);
    const pairs = [...xml.matchAll(/<w:t>(Alpha|Beta)<\/w:t>[\s\S]*?<w:t>(\d+)<\/w:t>/g)].map(
      (match) => [match[1], match[2]]
    );
    expect(pairs).toEqual([
      ['Alpha', '2'],
      ['Beta', '3'],
    ]);
    editor.destroy();
  });

  test('the caret crosses a TOC in both directions instead of stalling at its edge', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    const lead = '<w:p><w:r><w:t>Above the contents</w:t></w:r></w:p>';
    editor.load(docx(lead + CURRENT_TOC_CONTENT + HEADING));
    const surface = editor.surface!;
    const ids = surface.session.paragraphIds();
    const above = ids[0]!;
    const below = ids[ids.length - 1]!;

    // Forwards. A read-only region the caret can neither enter nor cross makes everything
    // past it unreachable from the keyboard, which is what stepping by CHARACTER produced:
    // the first step stayed inside the row it started in and the escape gave up there.
    surface.setSelection({
      anchor: { paragraphId: above, offset: 0 },
      head: { paragraphId: above, offset: 0 },
    });
    surface.navigate('down');
    expect(surface.state().selection.head.paragraphId).toBe(below);
    expect(surface.isInsideToc(surface.state().selection.head.paragraphId)).toBe(false);

    // Backwards.
    surface.setSelection({
      anchor: { paragraphId: below, offset: 0 },
      head: { paragraphId: below, offset: 0 },
    });
    surface.navigate('up');
    expect(surface.state().selection.head.paragraphId).toBe(above);
    editor.destroy();
  });

  test('a row that names no heading this document still has does not jump anywhere', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    // `Old cached entry` matches nothing in the outline. Reading the outline entry that sits
    // at the row's index instead sent the click to `Introduction`, a heading the row never
    // named.
    editor.load(docx(TOC_CONTENT.replace(' \\h ', ' ') + HEADING));
    const before = editor.snapshot().selection;
    const row = [...container.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find(
      (element) => element.textContent?.includes('Old cached entry')
    );

    const jump = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
    row!.dispatchEvent(jump);
    expect(jump.defaultPrevented).toBe(false);
    expect(editor.snapshot().selection).toEqual(before);
    editor.destroy();
  });
});

describe('TOC hover boundary covers complete rows', () => {
  for (const wrapped of [false, true]) {
    for (const split of [false, true]) {
      test(`${wrapped ? 'content-control' : 'plain-field'} TOC on ${split ? 'two pages' : 'one page'}`, async () => {
        const row = (label: string, prefix: string, suffix: string, pageBreak = false) =>
          '<w:p><w:pPr><w:pStyle w:val="TOC1"/>' +
          '<w:ind w:left="720" w:hanging="720" w:right="1440"/>' +
          '<w:tabs><w:tab w:val="right" w:pos="9000" w:leader="dot"/></w:tabs>' +
          (pageBreak ? '<w:pageBreakBefore/>' : '') +
          '</w:pPr>' +
          prefix +
          `<w:r><w:t>1</w:t><w:tab/><w:t>${label}</w:t><w:tab/><w:t>3</w:t></w:r>` +
          suffix +
          '</w:p>';
        const field =
          row(
            'Alpha',
            '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TOC</w:instrText><w:fldChar w:fldCharType="separate"/></w:r>',
            ''
          ) + row('Beta', '', '<w:r><w:fldChar w:fldCharType="end"/></w:r>', split);
        const body = wrapped
          ? '<w:sdt><w:sdtPr/><w:sdtContent>' + field + '</w:sdtContent></w:sdt>'
          : field;
        const container = document.createElement('div');
        document.body.append(container);
        const editor = createDocxEditor({ container });
        try {
          editor.load(docx(body));
          const before = await documentXml(editor);
          for (const zoom of [1, 1.5]) {
            editor.setZoom(zoom);
            const layout = editor.surface!.layout();
            expect(layout.pages).toHaveLength(split ? 2 : 1);
            for (const page of layout.pages) {
              const sheet = container.querySelector<HTMLElement>(
                `[data-page-index="${page.index}"]`
              )!;
              const rowElement = sheet.querySelector<HTMLElement>('[data-paragraph-id]')!;
              rowElement.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
              const chrome = sheet.querySelector<HTMLElement>('[data-docx-toc]')!;
              expect(chrome.hasAttribute('data-hover')).toBe(true);
              expect(sheet.querySelectorAll('[data-docx-toc]')).toHaveLength(1);
              const box = chrome.querySelector<HTMLElement>('.docx-content-control-boundary')!;
              const scale = parseFloat(sheet.style.width) / page.box.width;
              const left = parseFloat(box.style.left) / scale - (page.contentBox.x - page.box.x);
              const right = left + parseFloat(box.style.width) / scale;
              for (const fragment of paragraphFragmentsOf(page)) {
                const spans = fragment.lines.flatMap((line) => line.spans);
                expect(spans.find((span) => span.text === '1')!.box.x).toBeCloseTo(0, 5);
                const number = spans.find((span) => span.text === '3')!;
                expect(number.box.x + number.box.width).toBeCloseTo(450, 5);
                for (const span of spans) {
                  expect(left).toBeLessThanOrEqual(span.box.x + 0.001);
                  expect(right).toBeGreaterThanOrEqual(span.box.x + span.box.width - 0.001);
                }
              }
              expect(parseFloat(box.style.top) + parseFloat(box.style.height)).toBeLessThanOrEqual(
                parseFloat(sheet.style.height)
              );
            }
          }
          expect(await documentXml(editor)).toBe(before);
        } finally {
          editor.destroy();
          container.remove();
        }
      });
    }
  }
});
