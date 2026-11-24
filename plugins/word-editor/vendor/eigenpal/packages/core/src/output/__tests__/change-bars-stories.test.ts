import { resolveRevisionMarkup } from '../../contracts/revision-markup.ts';
// Change bars beyond the body: one column per sheet, whatever story the change is in.
//
// Word draws the rule at half the left margin for a header line, a footnote line and a
// table cell's line exactly as for a body line (measured on Word 16). The body-only unit
// tests in revision-paint.test.ts cannot reach these stories, so they are mounted here
// through the surface, which lays out the whole package.

import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../../editor/paginated-surface.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD_REL = `${R}/officeDocument`;
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

/** An anchored text box 36pt below its paragraph, holding one paragraph. */
function textBox(inner: string): string {
  return (
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" ' +
    'relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>914400</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>457200</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="2743200" cy="914400"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    '<wp:docPr id="1" name="Text Box 1"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="914400"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent><w:p>${inner}</w:p></w:txbxContent></wps:txbx>` +
    '<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="t">' +
    '<a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const ins = (id: string, inner: string) =>
  `<w:ins w:id="${id}" w:author="QA" w:date="2026-03-26T11:00:00Z">${inner}</w:ins>`;
const sectPr =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
  '</w:sectPr>';

function docx(parts: {
  readonly body: string;
  readonly header?: string;
  readonly footnote?: string;
}): Uint8Array {
  const overrides: string[] = [];
  const rels: string[] = [];
  const files: Record<string, Uint8Array> = {};
  let sect = sectPr;
  if (parts.header !== undefined) {
    overrides.push(
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
    );
    rels.push(`<Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/>`);
    files['word/header1.xml'] = strToU8(`<w:hdr xmlns:w="${W}">${parts.header}</w:hdr>`);
    sect = sect.replace(
      '<w:sectPr>',
      '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/>'
    );
  }
  if (parts.footnote !== undefined) {
    overrides.push(
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
    );
    rels.push(`<Relationship Id="rIdF" Type="${R}/footnotes" Target="footnotes.xml"/>`);
    files['word/footnotes.xml'] = strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        `<w:footnote w:id="1">${parts.footnote}</w:footnote></w:footnotes>`
    );
  }
  files['[Content_Types].xml'] = strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      overrides.join('') +
      '</Types>'
  );
  files['_rels/.rels'] = strToU8(
    `<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
  );
  files['word/_rels/document.xml.rels'] = strToU8(
    `<Relationships xmlns="${PKG_REL}">${rels.join('')}</Relationships>`
  );
  files['word/document.xml'] = strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:wps="${WPS}" xmlns:a="${A}">` +
      `<w:body>${parts.body}${sect}</w:body></w:document>`
  );
  return zipSync(files);
}

const mounted: { surface: PaginatedSurface; container: HTMLElement }[] = [];

function mount(bytes: Uint8Array): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!opened.ok) throw new Error(opened.reason);
  const entry = { surface: opened.surface, container };
  mounted.push(entry);
  return entry;
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.surface.destroy();
    entry.container.remove();
  }
});

const bars = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.docx-change-bar')];

/** Half the left margin, in sheet coordinates — Word's change-bar column. */
function barColumn(surface: PaginatedSurface): number {
  const page = surface.layout().pages[0]!;
  return Math.round((page.contentBox.x - page.box.x) / 2);
}

describe('change bars in every story share one column', () => {
  test('a change inside a table cell draws in the margin, not beside the cell', () => {
    const cell = (inner: string) =>
      `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr><w:p>${inner}</w:p></w:tc>`;
    const { surface, container } = mount(
      docx({
        body:
          `<w:p>${run('before')}</w:p>` +
          '<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/></w:tblPr>' +
          '<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
          `<w:tr>${cell(run('A1'))}${cell(run('B1 ') + ins('1', run('changed')))}</w:tr>` +
          `<w:tr>${cell(run('A2'))}${cell(run('B2'))}</w:tr></w:tbl>` +
          `<w:p>${run('after')}</w:p>`,
      })
    );
    const rules = bars(container);
    expect(rules).toHaveLength(1);
    expect(parseFloat(rules[0]!.style.left)).toBeCloseTo(barColumn(surface), 3);
    const page = surface.layout().pages[0]!;
    const table = page.fragments.find((block) => block.kind === 'table')!;
    const row = table.rows[0]!;
    const paragraph = row.cells[1]!.blocks[0]!;
    expect(paragraph.kind).toBe('paragraph');
    // Beside the changed cell paragraph's own box, in sheet coordinates.
    expect(parseFloat(rules[0]!.style.top)).toBeCloseTo(
      page.contentBox.y - page.box.y + paragraph.box.y,
      3
    );
    expect(parseFloat(rules[0]!.style.height)).toBeCloseTo(paragraph.box.height, 3);
  });

  test('a tracked row insertion marks the whole row', () => {
    const cell = (inner: string) =>
      `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr><w:p>${inner}</w:p></w:tc>`;
    const { surface, container } = mount(
      docx({
        body:
          '<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/></w:tblPr>' +
          '<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
          `<w:tr>${cell(run('A1'))}${cell(run('B1'))}</w:tr>` +
          '<w:tr><w:trPr><w:ins w:id="7" w:author="QA" w:date="2026-03-26T11:00:00Z"/></w:trPr>' +
          `${cell(run('A2'))}${cell(run('B2'))}</w:tr></w:tbl>`,
      })
    );
    const rules = bars(container);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.className).toContain('docx-change-bar-insertion');
    const page = surface.layout().pages[0]!;
    const table = page.fragments.find((block) => block.kind === 'table')!;
    const row = table.rows[1]!;
    expect(row.revisionKind).toBe('insert');
    expect(parseFloat(rules[0]!.style.top)).toBeCloseTo(
      page.contentBox.y - page.box.y + row.box.y,
      3
    );
    expect(parseFloat(rules[0]!.style.height)).toBeCloseTo(row.box.height, 3);
  });

  test('a change in the header draws beside the header line, in the same column', () => {
    const { surface, container } = mount(
      docx({
        body: `<w:p>${run('body untouched')}</w:p>`,
        header: `<w:p>${run('Header text ')}${ins('1', run('changed in header'))}</w:p>`,
      })
    );
    const rules = bars(container);
    expect(rules).toHaveLength(1);
    expect(parseFloat(rules[0]!.style.left)).toBeCloseTo(barColumn(surface), 3);
    const page = surface.layout().pages[0]!;
    const header = page.header!;
    const paragraph = header.fragments[0]!;
    expect(paragraph.kind).toBe('paragraph');
    const top = parseFloat(rules[0]!.style.top);
    // In the header band, above the content box.
    expect(top).toBeCloseTo(header.box.y - page.box.y + paragraph.box.y, 3);
    expect(top + parseFloat(rules[0]!.style.height)).toBeLessThanOrEqual(
      page.contentBox.y - page.box.y + 0.01
    );
    // The overlay is the sheet's, not the band's: a header bar must not become editable
    // furniture when the band is activated.
    expect(rules[0]!.closest('[data-docx-hf]')).toBeNull();
  });

  test('a change in a footnote draws beside the note, in the same column', () => {
    const { surface, container } = mount(
      docx({
        body:
          `<w:p>${run('Body with a note')}` +
          '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>' +
          `${run('.')}</w:p>`,
        footnote:
          '<w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>' +
          `${run(' Footnote text ')}${ins('1', run('changed in note'))}</w:p>`,
      })
    );
    const rules = bars(container);
    expect(rules).toHaveLength(1);
    expect(parseFloat(rules[0]!.style.left)).toBeCloseTo(barColumn(surface), 3);
    const page = surface.layout().pages[0]!;
    const note = page.footnotes!.notes[0]!;
    const paragraph = note.fragments[0]!;
    expect(paragraph.kind).toBe('paragraph');
    const top = parseFloat(rules[0]!.style.top);
    expect(top).toBeCloseTo(note.box.y - page.box.y + paragraph.box.y, 3);
    // Below the body text, inside the note area at the page bottom.
    expect(top).toBeGreaterThan(page.contentBox.y - page.box.y + 20);
  });

  test('a change inside an anchored text box draws in the column, beside the box line', () => {
    const { surface, container } = mount(
      docx({
        body:
          `<w:p>${run('Body untouched with anchor.')}${textBox(run('Text box line ') + ins('1', run('changed in box')))}</w:p>` +
          `<w:p>${run('Filler.')}</w:p>`.repeat(6),
      })
    );
    const rules = bars(container);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.dataset.docxStory).toBe('body');
    expect(parseFloat(rules[0]!.style.left)).toBeCloseTo(barColumn(surface), 3);
    const page = surface.layout().pages[0]!;
    const drawing = (page.anchoredDrawings ?? [])[0]!;
    expect(drawing.textboxStory).toBeTruthy();
    // Beside the box, which hangs 36pt below its anchor paragraph — not beside the anchor.
    const top = parseFloat(rules[0]!.style.top);
    const anchorParagraph = page.fragments[0]!;
    expect(top).toBeGreaterThan(
      page.contentBox.y - page.box.y + anchorParagraph.box.y + anchorParagraph.box.height
    );
  });

  test('a change in a rotated (btLr) cell marks the cell height, not a rotated line box', () => {
    const cell = (inner: string, rotated = false) =>
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/>${rotated ? '<w:textDirection w:val="btLr"/>' : ''}</w:tcPr><w:p>${inner}</w:p></w:tc>`;
    const { surface, container } = mount(
      docx({
        body:
          '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>' +
          '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="4800"/></w:tblGrid>' +
          `<w:tr><w:trPr><w:trHeight w:val="2400" w:hRule="exact"/></w:trPr>` +
          `${cell(run('side ') + ins('1', run('changed')), true)}` +
          `<w:tc><w:tcPr><w:tcW w:w="4800" w:type="dxa"/></w:tcPr><w:p>${run('tall')}</w:p></w:tc></w:tr></w:tbl>`,
      })
    );
    const rules = bars(container);
    expect(rules).toHaveLength(1);
    const page = surface.layout().pages[0]!;
    const table = page.fragments.find((block) => block.kind === 'table')!;
    const rotated = table.rows[0]!.cells[0]!;
    expect(rotated.textDirection).toBe('btLr');
    expect(parseFloat(rules[0]!.style.top)).toBeCloseTo(
      page.contentBox.y - page.box.y + rotated.box.y,
      3
    );
    expect(parseFloat(rules[0]!.style.height)).toBeCloseTo(rotated.box.height, 3);
  });

  test('editing a header names the active band on the sheet, so other bars can dim', () => {
    const { surface, container } = mount(
      docx({
        body: `<w:p>${ins('1', run('body change'))}</w:p>`,
        header: `<w:p>${run('Header ')}${ins('2', run('header change'))}</w:p>`,
      })
    );
    const stories = bars(container).map((bar) => bar.dataset.docxStory);
    expect(stories.sort()).toEqual(['body', 'header']);
    expect(
      container.querySelector<HTMLElement>('.docx-page')!.dataset.docxHfActiveKind
    ).toBeUndefined();
    const editing = document.createElement('div');
    paintSemanticLayout(editing, surface.layout(), {
      scale: 1,
      ariaHidden: false,
      activeHeaderFooterRId: surface.layout().pages[0]!.header!.rId!,
      activeHeaderFooterPageIndex: 0,
    });
    expect(editing.querySelector<HTMLElement>('.docx-page')!.dataset.docxHfActiveKind).toBe(
      'header'
    );
  });

  test('without a review module the bars stay inert furniture, not a view toggle', () => {
    // The free engine can name no other view, so its bars take no pointer: a click lands on
    // the sheet as it always did, and nothing swaps a projection the host cannot mirror.
    const { container } = mount(docx({ body: `<w:p>${ins('1', run('added'))}</w:p>` }));
    const rule = bars(container)[0]!;
    expect(rule.dataset.docxChangeBarToggle).toBeUndefined();
    expect(rule.style.pointerEvents).toBe('none');
  });

  test('the overlay is one element per sheet, sitting on the sheet', () => {
    const { container } = mount(
      docx({
        body: `<w:p>${ins('1', run('one'))}</w:p><w:p>${run('plain')}</w:p><w:p>${ins('2', run('two'))}</w:p>`,
        header: `<w:p>${ins('3', run('header'))}</w:p>`,
      })
    );
    const overlays = container.querySelectorAll('.docx-change-bars');
    expect(overlays).toHaveLength(1);
    expect(overlays[0]!.parentElement!.classList.contains('docx-page')).toBe(true);
    expect(bars(container)).toHaveLength(3);
  });
});

test('local revision settings repaint the body, header, footnote, cell, and text box together', () => {
  const insertion = (name: string) => ins(name, run(name));
  const { surface, container } = mount(
    docx({
      body:
        `<w:p>${insertion('body')}<w:r><w:footnoteReference w:id="1"/></w:r>${textBox(insertion('textbox'))}</w:p>` +
        `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p>${insertion('cell')}</w:p></w:tc></w:tr></w:tbl>`,
      header: `<w:p>${insertion('header')}</w:p>`,
      footnote: `<w:p>${insertion('footnote')}</w:p>`,
    })
  );
  surface.setRevisionMarkup(
    resolveRevisionMarkup({
      insertions: { mark: 'doubleUnderline', color: 'violet' },
      changedLines: { mark: 'rightBorder' },
    })
  );
  const spans = [
    ...container.querySelectorAll<HTMLElement>('[data-revision-kind="insert"][data-start]'),
  ];
  for (const name of ['body', 'header', 'footnote', 'cell', 'textbox']) {
    const span = spans.find((item) => item.textContent === name);
    expect(span).toBeDefined();
    expect(span!.style.textDecorationStyle).toBe('double');
    expect(span!.style.color).toBe('var(--doc-revision-color-violet)');
  }
});
