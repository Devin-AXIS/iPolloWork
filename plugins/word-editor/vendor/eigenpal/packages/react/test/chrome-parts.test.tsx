// The context-fed chrome parts: DocxEditor.HorizontalRuler / .VerticalRuler /
// .DocumentOutline.
//
// Against the REAL engine, like toolbar-composition.test.tsx. What these pin down: the
// ruler parts read the page setup through the provider (page geometry in the painted
// widths) and MARGIN DRAGS commit one undoable `setPageSetup` step on release (indent
// handles stay absent — the indent-drag lane is not wired); the outline part lists
// `Editor.getOutline()`'s headings and a click moves the CARET to the heading paragraph
// through the facade's semantic setSelection; and the parts are reachable as namespace
// statics.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import {
  DocxEditorHorizontalRuler,
  DocxEditorVerticalRuler,
} from '../src/editor/DocxEditorRulers.tsx';
import { DocxEditorDocumentOutline } from '../src/editor/DocxEditorOutline.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

function docx(body: string, styles?: string): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (styles
          ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (styles) {
    files['word/styles.xml'] = strToU8(styles);
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId10" Type="${STYLES_REL}" Target="styles.xml"/>` +
        '</Relationships>'
    );
  }
  return zipSync(files);
}

const heading = (styleId: string, text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const HEADING_SOURCE = docx(
  heading('H1', 'Introduction') +
    '<w:p><w:r><w:t>body text</w:t></w:r></w:p>' +
    heading('H2', 'Details'),
  `<w:styles xmlns:w="${W}">` +
    '<w:style w:type="paragraph" w:styleId="H1"><w:name w:val="heading 1"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="H2"><w:name w:val="heading 2"/></w:style>' +
    '</w:styles>'
);

const PLAIN_SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');

function mountWith(
  chrome: ReactNode,
  source: Uint8Array
): { view: ReturnType<typeof render>; editor: () => DocxEditorInstance } {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      {chrome}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

afterEach(() => {
  cleanup();
});

describe('the context-fed ruler parts', () => {
  test('HorizontalRuler paints the page width and margins from Editor.getPageSetup()', () => {
    const { view, editor } = mountWith(<DocxEditorHorizontalRuler />, PLAIN_SOURCE);
    const setup = editor().getPageSetup();
    expect(setup).not.toBeNull();
    // Letter defaults: 12240 twips wide → 816 CSS px at 96 dpi, zoom 1.
    expect(setup!.pageWidthTwips).toBe(12240);
    const ruler = view.container.querySelector('.docx-horizontal-ruler') as HTMLElement;
    expect(ruler).not.toBeNull();
    expect(ruler.style.width).toBe('816px');
    expect(ruler.style.flexShrink).toBe('0');
    // Word's four indent handles: first-line, hanging, left, right.
    expect(view.container.querySelectorAll('.docx-ruler-indent').length).toBe(4);
  });

  test('HorizontalRuler follows the document viewport horizontally', () => {
    const { view } = mountWith(<DocxEditorHorizontalRuler />, PLAIN_SOURCE);
    const viewport = view.container.querySelector('.docx-editor__scroll-container') as HTMLElement;
    const ruler = view.container.querySelector('.docx-horizontal-ruler') as HTMLElement;

    viewport.scrollLeft = 125;
    fireEvent.scroll(viewport);

    expect(ruler.style.transform).toBe('translateX(-125px)');
  });

  test('dragging the left margin zone commits ONE setPageSetup step on release', async () => {
    const { view, editor } = mountWith(<DocxEditorHorizontalRuler />, PLAIN_SOURCE);
    const ruler = view.container.querySelector('.docx-horizontal-ruler') as HTMLElement;
    // The left margin zone is the ruler's first child (the gray band).
    const leftZone = ruler.firstElementChild as HTMLElement;
    // happy-dom has no pointer capture; the component guards on its presence.
    Object.assign(leftZone, {
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
    });
    const before = editor().getDocumentHandle().revision;
    await act(async () => {
      fireEvent.pointerDown(leftZone, { pointerId: 1, clientX: 96 });
    });
    await act(async () => {
      // happy-dom reports a zero rect, so clientX IS the ruler-local x: 48px → 720 twips.
      fireEvent.pointerMove(leftZone, { pointerId: 1, clientX: 64 });
      fireEvent.pointerMove(leftZone, { pointerId: 1, clientX: 48 });
    });
    // Nothing commits while the drag previews.
    expect(editor().getDocumentHandle().revision).toBe(before);
    await act(async () => {
      fireEvent.pointerUp(leftZone, { pointerId: 1, clientX: 48 });
    });
    expect(editor().getPageSetup()!.marginsTwips.left).toBe(720);
    // One transaction: a single undo restores the original margin.
    await act(async () => {
      editor().exec({ type: 'undo' });
    });
    expect(editor().getPageSetup()!.marginsTwips.left).toBe(1440);
  });

  test('dragging the top margin marker on the vertical ruler commits on release', async () => {
    const { view, editor } = mountWith(<DocxEditorVerticalRuler />, PLAIN_SOURCE);
    const marker = view.container.querySelector('.docx-ruler-marker-topMargin') as HTMLElement;
    expect(marker).not.toBeNull();
    await act(async () => {
      fireEvent.mouseDown(marker, { clientY: 96 });
    });
    await act(async () => {
      fireEvent.mouseMove(document, { clientY: 48 });
    });
    await act(async () => {
      fireEvent.mouseUp(document);
    });
    expect(editor().getPageSetup()!.marginsTwips.top).toBe(720);
  });

  test('VerticalRuler paints the page height from Editor.getPageSetup()', () => {
    const { view, editor } = mountWith(<DocxEditorVerticalRuler />, PLAIN_SOURCE);
    // Letter defaults: 15840 twips tall → 1056 CSS px at 96 dpi, zoom 1.
    expect(editor().getPageSetup()!.pageHeightTwips).toBe(15840);
    const ruler = view.container.querySelector('.docx-vertical-ruler') as HTMLElement;
    expect(ruler).not.toBeNull();
    expect(ruler.style.height).toBe('1056px');
  });

  test('both rulers render nothing until the document arrives', async () => {
    // A ruler measures the page; before the document there is no page, and the primitive's
    // Letter-size fallback drew ticks for a page that was not there — over the host's
    // loading screen.
    const compose = (source?: Uint8Array) => (
      <DocxEditorRoot {...(source ? { document: source } : {})}>
        <DocxEditorHorizontalRuler />
        <DocxEditorVerticalRuler />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const view = render(compose());
    expect(view.container.querySelector('.docx-horizontal-ruler')).toBeNull();
    expect(view.container.querySelector('.docx-vertical-ruler')).toBeNull();

    await act(async () => {
      view.rerender(compose(PLAIN_SOURCE));
    });

    expect(view.container.querySelector('.docx-horizontal-ruler')).not.toBeNull();
    expect(view.container.querySelector('.docx-vertical-ruler')).not.toBeNull();

    // A parse failure clears `isLoading` while still leaving nothing to measure; the
    // rulers must not read the clearing as a page.
    await act(async () => {
      view.rerender(compose(strToU8('not a docx')));
    });

    expect(view.container.querySelector('.docx-horizontal-ruler')).toBeNull();
    expect(view.container.querySelector('.docx-vertical-ruler')).toBeNull();
  });
});

describe('the context-fed outline part', () => {
  test('lists the engine outline and a heading click moves the caret there', async () => {
    const { view, editor } = mountWith(<DocxEditorDocumentOutline />, HEADING_SOURCE);
    const outline = editor().getOutline();
    expect(outline.map(({ text, level }) => ({ text, level }))).toEqual([
      { text: 'Introduction', level: 0 },
      { text: 'Details', level: 1 },
    ]);

    const nav = view.container.querySelector('.docx-outline-nav')!;
    const rows = [...nav.querySelectorAll('.docx-outline-heading-btn')];
    expect(rows.map((row) => row.textContent)).toEqual(['Introduction', 'Details']);

    await act(async () => {
      (rows[1] as HTMLButtonElement).click();
    });
    // Navigation is the CARET (the engine has no scroll-into-view yet): a collapsed
    // selection at the clicked heading paragraph's start.
    const selection = editor().surface!.state().selection;
    expect(selection.anchor).toEqual({ paragraphId: outline[1]!.blockId, offset: 0 });
    expect(selection.head).toEqual({ paragraphId: outline[1]!.blockId, offset: 0 });
  });

  test('a document without headings shows the empty state, not invented rows', () => {
    const { view, editor } = mountWith(<DocxEditorDocumentOutline />, PLAIN_SOURCE);
    expect(editor().getOutline()).toEqual([]);
    const nav = view.container.querySelector('.docx-outline-nav')!;
    expect(nav.querySelectorAll('.docx-outline-heading-btn').length).toBe(0);
  });
});

describe('namespace statics', () => {
  test('the parts are reachable on DocxEditor', () => {
    expect(DocxEditor.HorizontalRuler).toBe(DocxEditorHorizontalRuler);
    expect(DocxEditor.VerticalRuler).toBe(DocxEditorVerticalRuler);
    expect(DocxEditor.DocumentOutline).toBe(DocxEditorDocumentOutline);
  });
});
