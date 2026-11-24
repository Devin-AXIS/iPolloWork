// Text boxes in headers and footers edit inside their story: entering one opens the header or
// footer on the page it is entered from, writes land in that part, and leaving the box returns
// to the open header or footer.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { selectedDrawingOverlayTargetOf } from '../drawing-overlay-target.ts';
import { findDrawingOverlayFrameInLayout } from '../../layout/semantic-hit-test.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const V = 'urn:schemas-microsoft-com:vml';

/** A page-anchored DrawingML text box with one paragraph. */
function drawingBox(text: string, id: number, topEmu: number): string {
  return (
    `<w:r><w:drawing xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}">` +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" ' +
    'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${topEmu}</wp:posOffset></wp:positionV>` +
    '<wp:extent cx="1828800" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    `<wp:wrapNone/><wp:docPr id="${id}" name="Box ${id}"/>` +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
    '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>'
  );
}

/** A page-relative VML text box, upright or with vertical text. */
function vmlBox(text: string, vertical = false): string {
  return (
    `<w:r><w:pict xmlns:v="${V}"><v:rect style="position:absolute;margin-left:72pt;` +
    'margin-top:20pt;width:200pt;height:40pt;z-index:1;mso-position-horizontal-relative:page;' +
    'mso-position-vertical-relative:page" filled="f">' +
    `<v:textbox${vertical ? ' style="layout-flow:vertical"' : ''}><w:txbxContent><w:p><w:r>` +
    `<w:t>${text}</w:t></w:r></w:p></w:txbxContent></v:textbox></v:rect></w:pict></w:r>`
  );
}

function docx(options: {
  header?: string;
  footer?: string;
  first?: string;
  pages?: number;
}): Uint8Array {
  const pages = options.pages ?? 1;
  const body = Array.from(
    { length: pages },
    (_, index) =>
      `<w:p>${index ? '<w:r><w:br w:type="page"/></w:r>' : ''}<w:r><w:t>body ${index}</w:t></w:r></w:p>`
  ).join('');
  const references =
    (options.header ? '<w:headerReference w:type="default" r:id="rHeader"/>' : '') +
    (options.footer ? '<w:footerReference w:type="default" r:id="rFooter"/>' : '') +
    (options.first ? '<w:headerReference w:type="first" r:id="rFirst"/>' : '');
  const overrides =
    (options.header
      ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
      : '') +
    (options.footer
      ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
      : '') +
    (options.first
      ? '<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
      : '');
  const rels =
    (options.header ? `<Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/>` : '') +
    (options.footer ? `<Relationship Id="rFooter" Type="${R}/footer" Target="footer1.xml"/>` : '') +
    (options.first ? `<Relationship Id="rFirst" Type="${R}/header" Target="header2.xml"/>` : '');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        `${overrides}</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${rels}</Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr>${references}` +
        (options.first ? '<w:titlePg/>' : '') +
        '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" ' +
        'w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
    ),
  };
  if (options.header)
    files['word/header1.xml'] = strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>header line</w:t></w:r>${options.header}</w:p></w:hdr>`
    );
  if (options.first)
    files['word/header2.xml'] = strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>first line</w:t></w:r>${options.first}</w:p></w:hdr>`
    );
  if (options.footer)
    files['word/footer1.xml'] = strToU8(
      `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>footer line</w:t></w:r>${options.footer}</w:p></w:ftr>`
    );
  return zipSync(files);
}

function open(document: Uint8Array) {
  const container = globalThis.document.createElement('div');
  globalThis.document.body.append(container);
  const editor = createDocxEditor({ container, document });
  return {
    editor,
    container,
    destroy() {
      editor.destroy();
      container.remove();
    },
  };
}

const frameMatch = (editor: ReturnType<typeof createDocxEditor>, text: string) => {
  const match = editor.findMatches(text).find((m) => m.scope?.kind === 'frame');
  expect(match?.scope?.kind).toBe('frame');
  return match!;
};

async function partText(editor: ReturnType<typeof createDocxEditor>, name: string) {
  const files = unzipSync(new Uint8Array(await editor.save()));
  return strFromU8(files[name]!);
}

test('a header text box edits inside its header and leaves to it', async () => {
  const { editor, destroy } = open(docx({ header: drawingBox('header box', 7, 457200) }));
  try {
    const surface = editor.surface!;
    const match = frameMatch(editor, 'header box');
    expect(match.scope?.kind === 'frame' && match.scope.owner?.kind).toBe('headerFooter');
    expect(surface.setActiveScope(match.scope!)).toBe(true);
    const active = surface.activeScope();
    expect(active.kind === 'frame' && active.owner).toEqual({
      kind: 'headerFooter',
      rId: 'rHeader',
    });
    const end = { paragraphId: match.blockId, offset: match.start + match.length };
    surface.setSelection({ anchor: end, head: end });
    expect(editor.exec({ type: 'insertText', text: ' typed' }).ok).toBe(true);
    expect(await partText(editor, 'word/header1.xml')).toContain('header box typed');
    expect(await partText(editor, 'word/document.xml')).not.toContain('typed');
    // Leaving the box returns to the header it was edited in.
    editor.surface!.setActiveScope({ kind: 'headerFooter', rId: 'rHeader' });
    expect(surface.activeScope().kind).toBe('headerFooter');
  } finally {
    destroy();
  }
});

test('typing in a header box undoes and redoes as one story edit', async () => {
  const { editor, destroy } = open(docx({ header: drawingBox('header box', 7, 457200) }));
  try {
    const match = frameMatch(editor, 'header box');
    editor.surface!.setActiveScope(match.scope!);
    const end = { paragraphId: match.blockId, offset: match.start + match.length };
    editor.surface!.setSelection({ anchor: end, head: end });
    expect(editor.exec({ type: 'insertText', text: ' once' }).ok).toBe(true);
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(await partText(editor, 'word/header1.xml')).not.toContain('once');
    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(await partText(editor, 'word/header1.xml')).toContain('header box once');
  } finally {
    destroy();
  }
});

test('a header box edit survives save and reopen', async () => {
  const { editor, destroy } = open(docx({ header: drawingBox('header box', 7, 457200) }));
  try {
    const match = frameMatch(editor, 'header box');
    editor.surface!.setActiveScope(match.scope!);
    const end = { paragraphId: match.blockId, offset: match.start + match.length };
    editor.surface!.setSelection({ anchor: end, head: end });
    editor.exec({ type: 'insertText', text: ' kept' });
    const reopened = open(new Uint8Array(await editor.save()));
    try {
      expect(frameMatch(reopened.editor, 'header box kept').scope?.kind).toBe('frame');
    } finally {
      reopened.destroy();
    }
  } finally {
    destroy();
  }
});

test('a footer text box edits inside its footer', async () => {
  const { editor, destroy } = open(docx({ footer: drawingBox('footer box', 8, 9144000) }));
  try {
    const match = frameMatch(editor, 'footer box');
    expect(editor.surface!.setActiveScope(match.scope!)).toBe(true);
    const end = { paragraphId: match.blockId, offset: match.start + match.length };
    editor.surface!.setSelection({ anchor: end, head: end });
    expect(editor.exec({ type: 'insertText', text: ' typed' }).ok).toBe(true);
    expect(await partText(editor, 'word/footer1.xml')).toContain('footer box typed');
  } finally {
    destroy();
  }
});

test('a legacy header text box with upright text edits; vertical text stays read-only', async () => {
  const upright = open(docx({ header: vmlBox('legacy box') }));
  try {
    const match = frameMatch(upright.editor, 'legacy box');
    expect(upright.editor.surface!.setActiveScope(match.scope!)).toBe(true);
    const end = { paragraphId: match.blockId, offset: match.start + match.length };
    upright.editor.surface!.setSelection({ anchor: end, head: end });
    expect(upright.editor.exec({ type: 'insertText', text: ' typed' }).ok).toBe(true);
    expect(await partText(upright.editor, 'word/header1.xml')).toContain('legacy box typed');
  } finally {
    upright.destroy();
  }
  const vertical = open(docx({ header: vmlBox('vertical box', true) }));
  try {
    const match = frameMatch(vertical.editor, 'vertical box');
    expect(vertical.editor.surface!.setActiveScope(match.scope!)).toBe(false);
  } finally {
    vertical.destroy();
  }
});

test('a header box shared by several pages edits on one of them', () => {
  const { editor, container, destroy } = open(
    docx({ header: drawingBox('shared box', 7, 457200), pages: 3 })
  );
  try {
    expect(editor.surface!.layout().pages.length).toBe(3);
    const match = frameMatch(editor, 'shared box');
    expect(editor.surface!.setActiveScope(match.scope!)).toBe(true);
    const editing = container.querySelectorAll(
      '.docx-drawing-textbox[data-docx-textbox-active="true"]'
    );
    // Only the copy on the page it is edited on binds; the others stay pictures.
    expect([...editing].map(pageOf)).toEqual(['0']);
    const bound = container.querySelectorAll(`[data-paragraph-id="${match.blockId}"]`);
    expect([...new Set([...bound].map(pageOf))]).toEqual(['0']);
    const end = { paragraphId: match.blockId, offset: match.start + match.length };
    editor.surface!.setSelection({ anchor: end, head: end });
    expect(editor.exec({ type: 'insertText', text: '!' }).ok).toBe(true);
    // The typed text shows on every page the header repeats on.
    const copies = [...container.querySelectorAll('.docx-drawing-textbox')];
    expect(copies.map((box) => box.textContent?.includes('shared box!'))).toEqual([
      true,
      true,
      true,
    ]);
  } finally {
    destroy();
  }
});

const pageOf = (element: Element) =>
  element.closest('[data-page-index]')?.getAttribute('data-page-index');

function press(target: Element): void {
  const init = { bubbles: true, cancelable: true, button: 0, clientX: 5, clientY: 5 };
  target.dispatchEvent(new PointerEvent('pointerdown', init));
  target.dispatchEvent(new PointerEvent('pointerup', init));
}

const boxText = (box: Element) =>
  box.querySelector('.docx-drawing-textbox-content span') ??
  box.querySelector('.docx-drawing-textbox-content')!;

test('closing the header from inside a header box returns the caret to the body', async () => {
  const { editor, destroy } = open(docx({ header: drawingBox('header box', 7, 457200) }));
  try {
    const surface = editor.surface!;
    const body = editor.findMatches('body 0')[0]!;
    const start = { paragraphId: body.blockId, offset: 0 };
    surface.setSelection({ anchor: start, head: start });
    expect(surface.setActiveScope(frameMatch(editor, 'header box').scope!)).toBe(true);
    expect(editor.exec({ type: 'exitHeaderFooter' }).ok).toBe(true);
    expect(surface.activeScope().kind).toBe('body');
    expect(surface.state().selection.head.paragraphId).toBe(body.blockId);
    expect(editor.exec({ type: 'insertText', text: 'Back ' }).ok).toBe(true);
    expect(await partText(editor, 'word/document.xml')).toContain('Back body 0');
  } finally {
    destroy();
  }
});

test('entering the header at a position from inside its box leaves the box', () => {
  const { editor, destroy } = open(docx({ header: drawingBox('header box', 7, 457200) }));
  try {
    const surface = editor.surface!;
    const line = editor.findMatches('header line')[0]!;
    expect(surface.setActiveScope(frameMatch(editor, 'header box').scope!)).toBe(true);
    const at = { paragraphId: line.blockId, offset: 2 };
    expect(surface.enterHeaderFooter!({ rId: 'rHeader', position: at })).toBe(true);
    expect(surface.activeScope().kind).toBe('headerFooter');
    expect(editor.exec({ type: 'insertText', text: 'Q' }).ok).toBe(true);
    expect(editor.findMatches('heQader line')).toHaveLength(1);
  } finally {
    destroy();
  }
});

test('pressing a header box copy on another page moves the open header there', () => {
  const { editor, container, destroy } = open(
    docx({ header: drawingBox('header box', 7, 457200), pages: 3 })
  );
  try {
    const surface = editor.surface!;
    expect(surface.setActiveScope({ kind: 'headerFooter', rId: 'rHeader' })).toBe(true);
    const copy = [...container.querySelectorAll('.docx-drawing-textbox')].find(
      (box) => pageOf(box) === '2'
    )!;
    press(boxText(copy));
    expect(surface.activeScope().kind).toBe('frame');
    expect([...container.querySelectorAll('[data-docx-hf-active]')].map(pageOf)).toEqual(['2']);
    expect(
      [...container.querySelectorAll('.docx-drawing-textbox[data-docx-textbox-active="true"]')].map(
        pageOf
      )
    ).toEqual(['2']);
  } finally {
    destroy();
  }
});

/** Lay every text box's text area over the sheet's top-left 200px, as a browser would. */
function withBoxGeometry<T>(run: () => T): T {
  const prototype = HTMLElement.prototype;
  const original = prototype.getBoundingClientRect;
  prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (!this.classList.contains('docx-drawing-textbox-content')) return original.call(this);
    return {
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
      x: 0,
      y: 0,
    } as DOMRect;
  };
  try {
    return run();
  } finally {
    prototype.getBoundingClientRect = original;
  }
}

function pressAt(target: Element, clientX: number, clientY: number): void {
  const init = { bubbles: true, cancelable: true, button: 0, clientX, clientY };
  target.dispatchEvent(new PointerEvent('pointerdown', init));
  target.dispatchEvent(new PointerEvent('pointerup', init));
}

for (const [name, top] of [
  ['in the header band', 457200],
  ['over the body', 4572000],
] as const) {
  test(`a double press on a closed header's box ${name} enters the box`, async () => {
    const { editor, container, destroy } = open(docx({ header: drawingBox('header box', 7, top) }));
    try {
      const surface = editor.surface!;
      const sheet = container.querySelector('.docx-page')!;
      withBoxGeometry(() => {
        // The box paints inert while its header is closed: the press lands on the sheet.
        pressAt(sheet, 50, 50);
        expect(surface.activeScope().kind).toBe('body');
        pressAt(sheet, 50, 50);
      });
      const active = surface.activeScope();
      expect(active.kind === 'frame' && active.owner?.kind).toBe('headerFooter');
      expect(editor.exec({ type: 'insertText', text: 'typed ' }).ok).toBe(true);
      expect(await partText(editor, 'word/header1.xml')).toContain('typed');
      // The press opened the existing header; it did not create a blank one.
      expect(Object.keys(unzipSync(new Uint8Array(await editor.save())))).not.toContain(
        'word/header2.xml'
      );
    } finally {
      destroy();
    }
  });
}

test('with the header open, a press on its text over a box behind the text stays in the text', () => {
  const behind = drawingBox('behind box', 7, 457200).replace('behindDoc="0"', 'behindDoc="1"');
  const { editor, container, destroy } = open(docx({ header: behind }));
  try {
    const surface = editor.surface!;
    expect(surface.setActiveScope({ kind: 'headerFooter', rId: 'rHeader' })).toBe(true);
    const line = container.querySelector('[data-docx-hf-active] [data-start]')!;
    withBoxGeometry(() => pressAt(line, 50, 50));
    expect(surface.activeScope().kind).toBe('headerFooter');
  } finally {
    destroy();
  }
});

test('a double press over a paragraph enters the closed header box under it', async () => {
  for (const [name, top, select] of [
    ['header', 457200, '[data-docx-hf] .docx-paragraph-fragment'],
    ['body', 1828800, '.docx-page-content .docx-paragraph-fragment'],
  ] as const) {
    const { editor, container, destroy } = open(docx({ header: drawingBox('header box', 7, top) }));
    try {
      // The box paints inert while its header is closed, so the paragraph takes the press.
      const fragment = container.querySelector(select)!;
      expect(fragment, name).not.toBeNull();
      withBoxGeometry(() => {
        pressAt(fragment, 50, 50);
        pressAt(fragment, 50, 50);
      });
      expect(editor.surface!.activeScope().kind, name).toBe('frame');
    } finally {
      destroy();
    }
  }
});

test('a single press on a closed header box leaves the body caret', () => {
  const { editor, container, destroy } = open(
    docx({ header: drawingBox('header box', 7, 457200) })
  );
  try {
    const sheet = container.querySelector('.docx-page')!;
    withBoxGeometry(() => pressAt(sheet, 50, 50));
    expect(editor.surface!.activeScope().kind).toBe('body');
  } finally {
    destroy();
  }
});

test('a double press in an inline header box selects a word in the box', () => {
  const inline =
    `<w:r><w:drawing xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}">` +
    '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1828800" cy="457200"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="11" name="Inline 11"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    '<wps:txbx><w:txbxContent><w:p><w:r><w:t>inline box</w:t></w:r></w:p>' +
    '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r>';
  const { editor, container, destroy } = open(docx({ header: inline }));
  try {
    const surface = editor.surface!;
    const box = container.querySelector('.docx-drawing-textbox')!;
    expect(box.closest('[data-docx-hf]')).not.toBeNull();
    press(boxText(box));
    expect(surface.activeScope().kind).toBe('frame');
    press(boxText(box));
    const { anchor, head } = surface.state().selection;
    expect(surface.activeScope().kind).toBe('frame');
    expect(anchor.paragraphId).toBe(head.paragraphId);
    expect(anchor.offset).not.toBe(head.offset);
  } finally {
    destroy();
  }
});

test('a first-page header box edits in the first-page header only', async () => {
  const { editor, container, destroy } = open(
    docx({
      header: drawingBox('default box', 7, 457200),
      first: drawingBox('first box', 9, 457200),
      pages: 2,
    })
  );
  try {
    const match = frameMatch(editor, 'first box');
    expect(match.scope?.kind === 'frame' && match.scope.owner).toEqual({
      kind: 'headerFooter',
      rId: 'rFirst',
    });
    expect(editor.surface!.setActiveScope(match.scope!)).toBe(true);
    const active = container.querySelector('[data-docx-textbox-active="true"]');
    expect(active?.closest('[data-page-index]')?.getAttribute('data-page-index')).toBe('0');
    const end = { paragraphId: match.blockId, offset: match.start + match.length };
    editor.surface!.setSelection({ anchor: end, head: end });
    expect(editor.exec({ type: 'insertText', text: ' typed' }).ok).toBe(true);
    expect(await partText(editor, 'word/header2.xml')).toContain('first box typed');
    expect(await partText(editor, 'word/header1.xml')).not.toContain('typed');
  } finally {
    destroy();
  }
});

test('a header box with a page number field keeps the field while its text is edited', async () => {
  const field =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const box = drawingBox('Page ', 7, 457200).replace(
    '</w:t></w:r></w:p>',
    `</w:t></w:r>${field}</w:p>`
  );
  const { editor, container, destroy } = open(
    docx({ header: box.replace('<w:t>Page ', '<w:t xml:space="preserve">Page '), pages: 2 })
  );
  try {
    const match = frameMatch(editor, 'Page');
    expect(editor.surface!.setActiveScope(match.scope!)).toBe(true);
    const start = { paragraphId: match.blockId, offset: match.start };
    editor.surface!.setSelection({ anchor: start, head: start });
    expect(editor.exec({ type: 'insertText', text: 'The ' }).ok).toBe(true);
    const header = await partText(editor, 'word/header1.xml');
    expect(header).toContain('The Page');
    expect(header).toContain('PAGE');
    // Each page still shows its own number in the box.
    const painted = [...container.querySelectorAll('.docx-drawing-textbox')].map((box) =>
      box.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(painted).toEqual(['The Page 1', 'The Page 2']);
  } finally {
    destroy();
  }
});

test('a header box takes text formatting and plain-text paste in its header', async () => {
  const { editor, destroy } = open(docx({ header: drawingBox('header box', 7, 457200) }));
  try {
    const surface = editor.surface!;
    const match = frameMatch(editor, 'header box');
    expect(surface.setActiveScope(match.scope!)).toBe(true);
    surface.setSelection({
      anchor: { paragraphId: match.blockId, offset: match.start },
      head: { paragraphId: match.blockId, offset: match.start + 6 },
    });
    expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toEqual({ ok: true, changed: true });
    const end = { paragraphId: match.blockId, offset: match.start + match.length };
    surface.setSelection({ anchor: end, head: end });
    expect(surface.pasteRich(' pasted', '<table><tr><td>pasted</td></tr></table>')).toBe(true);
    const header = await partText(editor, 'word/header1.xml');
    expect(header).toMatch(/<w:b\/>.*header/);
    expect(header).toContain(' pasted');
    expect(header).not.toContain('<w:tbl');
    expect(await partText(editor, 'word/document.xml')).not.toContain('<w:b/>');
  } finally {
    destroy();
  }
});

// Page-relative anchors: 914400 EMU from the page left, 457200 EMU from its top, on a page
// with one-inch margins, so the extent sits at (0, -36) in page-content points.
test('a header box being edited shows its frame where it paints, with handles', () => {
  const { editor, destroy } = open(docx({ header: drawingBox('header box', 7, 457200) }));
  try {
    const surface = editor.surface!;
    expect(surface.setActiveScope(frameMatch(editor, 'header box').scope!)).toBe(true);
    const target = selectedDrawingOverlayTargetOf(surface)!;
    expect(target).toMatchObject({ textbox: true, pageIndex: 0, kind: 'anchored' });
    expect([target.x, target.y, target.width, target.height]).toEqual([0, -36, 144, 36]);
    expect(target.canMove).toBe(true);
    expect(target.canResize).toBe(true);
  } finally {
    destroy();
  }
});

test('a legacy header box being edited shows its frame with handles', () => {
  const { editor, destroy } = open(docx({ header: vmlBox('legacy box') }));
  try {
    const surface = editor.surface!;
    expect(surface.setActiveScope(frameMatch(editor, 'legacy box').scope!)).toBe(true);
    const target = selectedDrawingOverlayTargetOf(surface)!;
    expect(target).toMatchObject({ textbox: true, pageIndex: 0, canMove: true, canResize: true });
    // The default 0.75pt outline is centred on the edge, so the frame reaches half of it out.
    expect([target.x, target.y]).toEqual([-0.375, 20 - 72 - 0.375]);
  } finally {
    destroy();
  }
});

test('a page-relative header drawing frames at its painted place', () => {
  const { editor, destroy } = open(docx({ header: drawingBox('header box', 7, 457200) }));
  try {
    const layout = editor.surface!.layout();
    const id = frameMatch(editor, 'header box').scope!;
    const frame = findDrawingOverlayFrameInLayout(
      layout,
      id.kind === 'frame' ? id.drawingNodeId : ''
    )!;
    expect([frame.pageIndex, frame.x, frame.y]).toEqual([0, 0, -36]);
  } finally {
    destroy();
  }
});

for (const [name, box, text] of [
  ['a header box', drawingBox('header box', 7, 457200), 'header box'],
  ['a legacy header box', vmlBox('legacy box'), 'legacy box'],
] as const) {
  test(`${name} selected from its frame deletes from its header, and undo restores it`, async () => {
    const { editor, destroy } = open(docx({ header: box }));
    try {
      const surface = editor.surface!;
      expect(surface.setActiveScope(frameMatch(editor, text).scope!)).toBe(true);
      const scope = surface.activeScope();
      if (scope.kind !== 'frame') throw new Error('not in the box');
      expect(surface.selectDrawing(scope.drawingNodeId, scope.hostParagraphId)).toBe(true);
      expect(editor.exec({ type: 'deleteImage' }).ok).toBe(true);
      expect(await partText(editor, 'word/header1.xml')).not.toContain(text);
      expect(await partText(editor, 'word/header1.xml')).toContain('header line');
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(await partText(editor, 'word/header1.xml')).toContain(text);
    } finally {
      destroy();
    }
  });
}

test('a header box on story-relative axes reports its offset from its own frame origin', () => {
  // 10 pt below its paragraph and 20 pt right of the column: the overlay frame minus the anchor
  // frame origin must give those offsets back, or a move or resize makes the box jump.
  const box = drawingBox('header box', 7, 127000)
    .replace('<wp:positionV relativeFrom="page">', '<wp:positionV relativeFrom="paragraph">')
    .replace(
      '<wp:positionH relativeFrom="page"><wp:posOffset>914400',
      '<wp:positionH relativeFrom="column"><wp:posOffset>254000'
    );
  const { editor, destroy } = open(docx({ header: box }));
  try {
    const surface = editor.surface!;
    expect(surface.setActiveScope(frameMatch(editor, 'header box').scope!)).toBe(true);
    const target = selectedDrawingOverlayTargetOf(surface)!;
    expect(target.position).toMatchObject({ relativeToH: 'column', relativeToV: 'paragraph' });
    expect(target.x - target.anchorFrameOrigin!.x).toBeCloseTo(20, 6);
    expect(target.y - target.anchorFrameOrigin!.y).toBeCloseTo(10, 6);
  } finally {
    destroy();
  }
});

function key(container: HTMLElement, name: string): void {
  container
    .querySelector('.docx-page')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
}

test('Escape leaves a header box with the box selected; Enter goes back into its text', async () => {
  const { editor, container, destroy } = open(
    docx({ header: drawingBox('header box', 7, 457200) })
  );
  try {
    const surface = editor.surface!;
    expect(surface.setActiveScope(frameMatch(editor, 'header box').scope!)).toBe(true);
    key(container, 'Escape');
    // The header stays open around the selected box, which Delete now acts on.
    expect(surface.activeScope().kind).toBe('headerFooter');
    const selected = selectedDrawingOverlayTargetOf(surface);
    expect(selected?.textbox).toBe(true);
    expect(selected?.textEditable).toBe(true);
    expect(selected?.canMove).toBe(true);
    key(container, 'Enter');
    expect(surface.activeScope().kind).toBe('frame');
    expect(editor.exec({ type: 'insertText', text: 'again ' }).ok).toBe(true);
    expect(await partText(editor, 'word/header1.xml')).toContain('again header box');
    key(container, 'Escape');
    key(container, 'Delete');
    expect(await partText(editor, 'word/header1.xml')).not.toContain('header box');
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    // From a selected box, Escape leaves the header or footer.
    expect(surface.setActiveScope(frameMatch(editor, 'header box').scope!)).toBe(true);
    key(container, 'Escape');
    expect(surface.activeScope().kind).toBe('headerFooter');
    key(container, 'Escape');
    expect(surface.activeScope().kind).toBe('body');
  } finally {
    destroy();
  }
});

test('a double press on a header box whose text takes no caret selects the box', () => {
  const { editor, container, destroy } = open(docx({ header: vmlBox('vertical box', true) }));
  try {
    const surface = editor.surface!;
    const sheet = container.querySelector('.docx-page')!;
    withBoxGeometry(() => {
      pressAt(sheet, 50, 50);
      pressAt(sheet, 50, 50);
    });
    // The header opened around it, with the box selected rather than a caret elsewhere.
    expect(surface.activeScope().kind).toBe('headerFooter');
    const selected = selectedDrawingOverlayTargetOf(surface);
    expect(selected?.textbox).toBe(true);
    // The frame can say why typing does not reach the box.
    expect(selected?.textEditable).toBe(false);
    expect(container.querySelector('[data-docx-hf-active]')).not.toBeNull();
  } finally {
    destroy();
  }
});

test('an entry from code opens a shared header box on the page in view', () => {
  const { editor, container, destroy } = open(
    docx({ header: drawingBox('shared box', 7, 457200), pages: 3 })
  );
  const prototype = HTMLElement.prototype;
  const original = prototype.getBoundingClientRect;
  // Only page 2 is in the window.
  prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (!this.classList.contains('docx-page')) return original.call(this);
    const inView = this.dataset.pageIndex === '2';
    return { top: inView ? 0 : -2000, bottom: inView ? 500 : -1000 } as DOMRect;
  };
  try {
    expect(editor.surface!.setActiveScope(frameMatch(editor, 'shared box').scope!)).toBe(true);
    expect([...container.querySelectorAll('[data-docx-hf-active]')].map(pageOf)).toEqual(['2']);
  } finally {
    prototype.getBoundingClientRect = original;
    destroy();
  }
});

for (const [name, change] of [
  ['vertical', (xml: string) => xml.replace('<wps:bodyPr/>', '<wps:bodyPr vert="vert"/>')],
  ['rotated', (xml: string) => xml.replace('<wps:bodyPr/>', '<wps:bodyPr rot="5400000"/>')],
] as const) {
  test(`a header box with ${name} text refuses a caret, and its frame says so`, () => {
    const { editor, destroy } = open(docx({ header: change(drawingBox('turned box', 7, 457200)) }));
    try {
      const surface = editor.surface!;
      expect(surface.setActiveScope(frameMatch(editor, 'turned box').scope!)).toBe(false);
      expect(surface.setActiveScope({ kind: 'headerFooter', rId: 'rHeader' })).toBe(true);
      const box = surface.layout().pages[0]!.header!;
      const drawing = box.anchoredDrawings![0]!;
      expect(surface.selectDrawing(drawing.drawingNodeId, drawing.paragraphId)).toBe(true);
      expect(selectedDrawingOverlayTargetOf(surface)?.textEditable).toBe(false);
    } finally {
      destroy();
    }
  });
}

test('a header box follows its header when body deletion removes its page', () => {
  const { editor, container, destroy } = open(
    docx({ header: drawingBox('header box', 7, 457200), pages: 3 })
  );
  try {
    const surface = editor.surface!;
    const removed = [editor.findMatches('body 1')[0]!, editor.findMatches('body 2')[0]!];
    expect(surface.setActiveScope({ kind: 'headerFooter', rId: 'rHeader' })).toBe(true);
    const copy = [...container.querySelectorAll('.docx-drawing-textbox')].find(
      (box) => pageOf(box) === '2'
    )!;
    press(boxText(copy));
    expect(surface.activeScope().kind).toBe('frame');
    expect(
      surface.session.applyTreeOps(
        removed.map((match) => ({
          op: 'deleteBlock' as const,
          blockId: match.blockId,
        }))
      ).committed
    ).toBe(true);
    expect(surface.layout().pages.length).toBe(1);
    expect(
      [...container.querySelectorAll('.docx-drawing-textbox[data-docx-textbox-active="true"]')].map(
        pageOf
      )
    ).toEqual(['0']);
  } finally {
    destroy();
  }
});
