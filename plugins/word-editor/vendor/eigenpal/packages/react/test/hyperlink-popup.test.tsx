// DocxEditor.HyperLink against the REAL engine.
//
// The popover is chrome over an engine that already decides everything that matters: which
// gestures mean "show the link UI", what a safe target is, and what a link edit does to the
// document. These tests drive it the way a user does — click a link, press Ctrl/Cmd+K, type
// a URL — and check the document, not the markup.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorHyperLink } from '../src/editor/DocxEditorHyperLink.tsx';
import { pressCancelledPages } from './cancelled-press.ts';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string, rels = ''): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${rels}</Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const EXTERNAL_REL = `<Relationship Id="rId9" Type="${R}/hyperlink" Target="https://example.com" TargetMode="External"/>`;
const LINKED = docx(
  `<w:p><w:r><w:t xml:space="preserve">Visit </w:t></w:r>` +
    `<w:hyperlink r:id="rId9"><w:r><w:t>Example</w:t></w:r></w:hyperlink>` +
    `<w:r><w:t xml:space="preserve"> today</w:t></w:r></w:p>`,
  EXTERNAL_REL
);
const PLAIN = docx('<w:p><w:r><w:t>Visit example today</w:t></w:r></w:p>');
// A HYPERLINK field, not a typed `w:hyperlink`: its link record comes from the field-link
// registry, is an atom with no caret-addressable range, and no relationship backs it.
const FIELD_LINKED = docx(
  `<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r>` +
    `<w:fldSimple w:instr=" HYPERLINK &quot;https://field.example&quot; ">` +
    `<w:r><w:t>FieldLink</w:t></w:r></w:fldSimple></w:p>`
);
const PID = '/word/document.xml#0.0.0';

interface Mounted {
  readonly view: ReturnType<typeof render>;
  editor(): DocxEditorInstance;
}

function mount(
  source: Uint8Array,
  children?: React.ReactNode,
  rootProps: { asChild?: boolean; className?: string } = {}
): Mounted {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorToolbar />
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorHyperLink {...rootProps}>{children}</DocxEditorHyperLink>
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

function caret(mounted: Mounted, offset: number): void {
  act(() => {
    mounted.editor().surface!.setSelection({
      anchor: { paragraphId: PID, offset },
      head: { paragraphId: PID, offset },
    });
  });
}

function select(mounted: Mounted, start: number, end: number): void {
  act(() => {
    mounted.editor().surface!.setSelection({
      anchor: { paragraphId: PID, offset: start },
      head: { paragraphId: PID, offset: end },
    });
  });
}

/** Click the painted anchor whose text is `text`. */
function clickLink(mounted: Mounted, text: string): void {
  const anchors = [...mounted.view.container.querySelectorAll('a.docx-hyperlink')];
  const anchor = anchors.find((element) => element.textContent === text);
  if (!anchor) throw new Error(`no painted link ${JSON.stringify(text)}`);
  act(() => {
    fireEvent.click(anchor);
  });
}

/** Press Ctrl/Cmd+K on the pages layer, the way the surface receives it. */
function pressCommandK(mounted: Mounted): void {
  const pages = mounted.view.container.querySelector('.docx-pages');
  if (!pages) throw new Error('no pages layer');
  act(() => {
    fireEvent.keyDown(pages, { key: 'k', metaKey: true });
  });
}

/**
 * Flush the store's DEFERRED notification. `useEditorState` coalesces `change` /
 * `selectionChange` into a microtask (a task under input pressure), so a caret move that
 * should re-run the popover's dismiss effect only lands after one asynchronous tick.
 */
async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const bodyText = (mounted: Mounted): string => mounted.editor().surface!.session.bodyText();

afterEach(() => {
  cleanup();
});

describe('DocxEditor.HyperLink', () => {
  test('is not rendered until a gesture opens it', () => {
    const mounted = mount(LINKED);
    expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
  });

  test('a click on a link opens the popover showing the target', () => {
    const mounted = mount(LINKED);
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    const panel = mounted.view.getByTestId('hyperlink-popup');
    expect(panel.dataset.mode).toBe('reading');
    expect(mounted.view.getByTestId('hyperlink-popup-url').textContent).toContain(
      'https://example.com'
    );
    // The Google-Docs three: copy, edit, unlink.
    expect(mounted.view.getByTestId('hyperlink-popup-copy')).toBeTruthy();
    expect(mounted.view.getByTestId('hyperlink-popup-edit')).toBeTruthy();
    expect(mounted.view.getByTestId('hyperlink-popup-unlink')).toBeTruthy();
  });

  test('the host page never navigates when a link is clicked', () => {
    const mounted = mount(LINKED);
    caret(mounted, 8);
    const anchor = [...mounted.view.container.querySelectorAll('a.docx-hyperlink')].find(
      (element) => element.textContent === 'Example'
    )!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      anchor.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  test('Escape dismisses it', () => {
    const mounted = mount(LINKED);
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    expect(mounted.view.queryByTestId('hyperlink-popup')).not.toBeNull();
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
  });

  test('an outside press dismisses it', () => {
    const mounted = mount(LINKED);
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
  });

  test('a press on the pages dismisses it, although the pages cancel the press', () => {
    const mounted = mount(LINKED);
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    const popup = mounted.view.getByTestId('hyperlink-popup');
    act(() => {
      fireEvent.pointerDown(popup);
    });
    expect(mounted.view.queryByTestId('hyperlink-popup')).not.toBeNull();
    let event: PointerEvent | undefined;
    act(() => {
      event = pressCancelledPages(mounted.view.container);
    });
    expect(event?.defaultPrevented).toBe(true);
    expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
  });

  test('unlink keeps the text and removes the link', () => {
    const mounted = mount(LINKED);
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    act(() => {
      fireEvent.click(mounted.view.getByTestId('hyperlink-popup-unlink'));
    });
    expect(bodyText(mounted)).toBe('Visit Example today');
    expect(mounted.view.container.querySelectorAll('a.docx-hyperlink')).toHaveLength(0);
    // Its own job done, the panel closes.
    expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
  });

  test('edit mode seeds from the link and applies a new target', () => {
    const mounted = mount(LINKED);
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    act(() => {
      fireEvent.click(mounted.view.getByTestId('hyperlink-popup-edit'));
    });
    const url = mounted.view.getByTestId('hyperlink-popup-url-input') as HTMLInputElement;
    const text = mounted.view.getByTestId('hyperlink-popup-text') as HTMLInputElement;
    expect(url.value).toBe('https://example.com');
    expect(text.value).toBe('Example');

    act(() => {
      fireEvent.change(url, { target: { value: 'https://example.org' } });
    });
    act(() => {
      fireEvent.click(mounted.view.getByTestId('hyperlink-popup-apply'));
    });
    caret(mounted, 8);
    expect(mounted.editor().surface!.hyperlinks.linkAtCaret()?.href).toBe('https://example.org');
    expect(bodyText(mounted)).toBe('Visit Example today');
  });

  test('the URL input is typeable and Enter applies', () => {
    const mounted = mount(PLAIN);
    select(mounted, 6, 13);
    pressCommandK(mounted);
    const url = mounted.view.getByTestId('hyperlink-popup-url-input') as HTMLInputElement;
    act(() => {
      fireEvent.change(url, { target: { value: 'https://typed.example' } });
    });
    expect(url.value).toBe('https://typed.example');
    act(() => {
      fireEvent.keyDown(url, { key: 'Enter' });
    });
    caret(mounted, 8);
    expect(mounted.editor().surface!.hyperlinks.linkAtCaret()?.href).toBe('https://typed.example');
  });

  test('a caret inside a word opens with that word, and Enter links the word', () => {
    const mounted = mount(PLAIN);
    caret(mounted, 8);
    pressCommandK(mounted);
    const text = mounted.view.getByTestId('hyperlink-popup-text') as HTMLInputElement;
    expect(text.value).toBe('example');
    const url = mounted.view.getByTestId('hyperlink-popup-url-input') as HTMLInputElement;
    act(() => {
      fireEvent.change(url, { target: { value: 'https://typed.example' } });
    });
    act(() => {
      fireEvent.keyDown(url, { key: 'Enter' });
    });
    caret(mounted, 8);
    const link = mounted.editor().surface!.hyperlinks.linkAtCaret();
    expect(link?.text).toBe('example');
    expect(bodyText(mounted)).toBe('Visit example today');
  });

  test('a caret at a word edge opens with no display text', () => {
    const mounted = mount(PLAIN);
    caret(mounted, 13);
    pressCommandK(mounted);
    const text = mounted.view.getByTestId('hyperlink-popup-text') as HTMLInputElement;
    expect(text.value).toBe('');
  });

  test('a refused scheme is not applied and the document is untouched', () => {
    const mounted = mount(PLAIN);
    select(mounted, 6, 13);
    pressCommandK(mounted);
    const url = mounted.view.getByTestId('hyperlink-popup-url-input') as HTMLInputElement;
    act(() => {
      fireEvent.change(url, { target: { value: 'javascript:alert(1)' } });
    });
    act(() => {
      fireEvent.click(mounted.view.getByTestId('hyperlink-popup-apply'));
    });
    expect(bodyText(mounted)).toBe('Visit example today');
    expect(mounted.view.container.querySelectorAll('a.docx-hyperlink')).toHaveLength(0);
    // Still open, so the user can correct the value rather than wondering what happened.
    expect(mounted.view.queryByTestId('hyperlink-popup')).not.toBeNull();
  });

  test('an inert link shows its target with nothing to press', () => {
    const mounted = mount(
      docx(
        `<w:p><w:hyperlink r:id="rId9"><w:r><w:t>Click</w:t></w:r></w:hyperlink></w:p>`,
        `<Relationship Id="rId9" Type="${R}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>`
      )
    );
    caret(mounted, 2);
    clickLink(mounted, 'Click');
    const readout = mounted.view.getByTestId('hyperlink-popup-url');
    expect(readout.hasAttribute('data-inert')).toBe(true);
    expect(readout.tagName).toBe('SPAN');
    // Copy needs a safe target; there is none.
    expect(mounted.view.queryByTestId('hyperlink-popup-copy')).toBeNull();
  });
});

// 'See ' is four characters; the field result projects as ONE atom over [4, 5). A real click
// lands the caret ON that atom, which is where these tests place it before clicking.
const FIELD_ATOM = 4;

describe('a HYPERLINK field link', () => {
  test('the panel stays open on the opening tick and closes when the caret leaves the atom', async () => {
    const mounted = mount(FIELD_LINKED);
    // Where a real click lands the caret: on the field atom.
    caret(mounted, FIELD_ATOM);
    clickLink(mounted, 'FieldLink');
    const panel = mounted.view.getByTestId('hyperlink-popup');
    expect(panel.dataset.mode).toBe('reading');
    expect(mounted.view.getByTestId('hyperlink-popup-url').textContent).toContain(
      'https://field.example'
    );
    // The opening tick must NOT self-close it: the boundary-inclusive resolver still finds the
    // field at the atom edge the click landed the caret on. A selection tick that keeps the
    // caret on the atom (its trailing edge is inclusive) leaves the panel standing.
    caret(mounted, 5);
    await tick();
    expect(mounted.view.queryByTestId('hyperlink-popup')).not.toBeNull();
    // Moving the caret OFF the atom closes it, the same rule a typed link follows.
    caret(mounted, 1);
    await tick();
    expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
  });

  test('offers open and copy, but not edit or unlink', () => {
    const mounted = mount(FIELD_LINKED);
    caret(mounted, FIELD_ATOM);
    clickLink(mounted, 'FieldLink');
    expect(mounted.view.getByTestId('hyperlink-popup-copy')).toBeTruthy();
    expect(mounted.view.getByTestId('hyperlink-popup-url')).toBeTruthy();
    // The typed editing lane can never resolve a field-link id: unlink would silently do
    // nothing and edit would insert a typed link BESIDE the field. Absent, not disabled.
    expect(mounted.view.queryByTestId('hyperlink-popup-edit')).toBeNull();
    expect(mounted.view.queryByTestId('hyperlink-popup-unlink')).toBeNull();
  });

  test('escape and an outside press still dismiss it', () => {
    const mounted = mount(FIELD_LINKED);
    caret(mounted, FIELD_ATOM);
    clickLink(mounted, 'FieldLink');
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
    caret(mounted, FIELD_ATOM);
    clickLink(mounted, 'FieldLink');
    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
  });
});

describe('Ctrl/Cmd+K', () => {
  test('opens edit mode over the selection', () => {
    const mounted = mount(PLAIN);
    select(mounted, 6, 13);
    pressCommandK(mounted);
    const panel = mounted.view.getByTestId('hyperlink-popup');
    expect(panel.dataset.mode).toBe('editing');
    // Seeded with the selected text, so the user only has to supply the URL.
    expect((mounted.view.getByTestId('hyperlink-popup-text') as HTMLInputElement).value).toBe(
      'example'
    );
  });

  test('on an existing link it opens edit pre-filled', () => {
    const mounted = mount(LINKED);
    caret(mounted, 8);
    pressCommandK(mounted);
    expect(mounted.view.getByTestId('hyperlink-popup').dataset.mode).toBe('editing');
    expect((mounted.view.getByTestId('hyperlink-popup-url-input') as HTMLInputElement).value).toBe(
      'https://example.com'
    );
    expect((mounted.view.getByTestId('hyperlink-popup-text') as HTMLInputElement).value).toBe(
      'Example'
    );
  });

  test('on a field link it opens the READING panel, not editing', () => {
    const mounted = mount(FIELD_LINKED);
    caret(mounted, FIELD_ATOM);
    pressCommandK(mounted);
    const panel = mounted.view.getByTestId('hyperlink-popup');
    // Edit and Unlink cannot apply to a field link, so Ctrl+K reaches it read-only.
    expect(panel.dataset.mode).toBe('reading');
    expect(mounted.view.getByTestId('hyperlink-popup-url').textContent).toContain(
      'https://field.example'
    );
    expect(mounted.view.queryByTestId('hyperlink-popup-copy')).not.toBeNull();
    expect(mounted.view.queryByTestId('hyperlink-popup-edit')).toBeNull();
    expect(mounted.view.queryByTestId('hyperlink-popup-unlink')).toBeNull();
  });
});

describe('the toolbar link control', () => {
  test('is enabled, and opens the popover rather than running a bare command', () => {
    const mounted = mount(PLAIN);
    select(mounted, 6, 13);
    const button = mounted.view.container.querySelector(
      '[data-slot="text.link"]'
    ) as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(false);
    act(() => {
      fireEvent.click(button);
    });
    expect(mounted.view.getByTestId('hyperlink-popup').dataset.mode).toBe('editing');
    // No link was created by the press itself — a link needs a target.
    expect(bodyText(mounted)).toBe('Visit example today');
  });
});

describe('the customization ladder', () => {
  test('a part child replaces its slot in place, and `hidden` removes it', () => {
    const mounted = mount(
      LINKED,
      <>
        <DocxEditorHyperLink.Copy className="my-copy" />
        <DocxEditorHyperLink.Unlink hidden />
      </>
    );
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    // The consumer's class landed, and there is still exactly ONE copy button.
    const copies = mounted.view.container.querySelectorAll('[data-testid="hyperlink-popup-copy"]');
    expect(copies).toHaveLength(1);
    expect(copies[0]!.className).toContain('my-copy');
    // Unlink is gone, and edit — which the consumer did not name — is untouched.
    expect(mounted.view.queryByTestId('hyperlink-popup-unlink')).toBeNull();
    expect(mounted.view.queryByTestId('hyperlink-popup-edit')).not.toBeNull();
  });

  test('asChild hands the element to the host and keeps the wiring', () => {
    const mounted = mount(
      LINKED,
      <DocxEditorHyperLink.Unlink asChild className="paired-class">
        <button className="brand-button">Remove</button>
      </DocxEditorHyperLink.Unlink>
    );
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    const unlink = mounted.view.getByTestId('hyperlink-popup-unlink');
    // The host owns the look: its own classes land, the packaged one does not.
    expect(unlink.classList.contains('brand-button')).toBe(true);
    expect(unlink.classList.contains('paired-class')).toBe(true);
    expect(unlink.classList.contains('docx-hyperlink-popup__action')).toBe(false);
    // Nothing else rides along: the element carries exactly these two classes.
    expect(unlink.className).toBe('paired-class brand-button');
    // The wiring still works.
    act(() => {
      fireEvent.click(unlink);
    });
    expect(mounted.view.container.querySelectorAll('a.docx-hyperlink')).toHaveLength(0);
  });

  test('an asChild panel keeps the class that positions it', () => {
    const mounted = mount(LINKED, <section className="brand-panel" />, { asChild: true });
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    const panel = mounted.view.getByTestId('hyperlink-popup');
    expect(panel.classList.contains('brand-panel')).toBe(true);
    // The Root's class carries position and stacking, not decoration, so it stays.
    expect(panel.classList.contains('docx-hyperlink-popup')).toBe(true);
  });

  test('a custom icon replaces the glyph without changing the wiring', () => {
    const mounted = mount(
      LINKED,
      <DocxEditorHyperLink.Unlink icon={<span data-testid="my-glyph">x</span>} />
    );
    caret(mounted, 8);
    clickLink(mounted, 'Example');
    expect(mounted.view.getByTestId('my-glyph')).toBeTruthy();
    act(() => {
      fireEvent.click(mounted.view.getByTestId('hyperlink-popup-unlink'));
    });
    expect(mounted.view.container.querySelectorAll('a.docx-hyperlink')).toHaveLength(0);
  });
});
