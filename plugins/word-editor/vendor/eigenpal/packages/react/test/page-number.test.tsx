import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorPageNumber } from '../src/editor/DocxEditorPageNumber.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { useEditorState } from '../src/editor/useEditorState.ts';
import {
  InsideViewportContext,
  useViewportOverlayHost,
  type ViewportOverlayHost,
} from '../src/editor/viewport-context.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const ONE_PAGE = docx(paragraph('one'));
const THREE_PAGES = docx(
  paragraph('one') + pageBreak + paragraph('two') + pageBreak + paragraph('three')
);

/**
 * A document with `body` that is past the open-yield threshold through an ordinary filler part,
 * so the open lays out in slices without laying out hundreds of pages.
 */
function pastOpenThreshold(body: string): Uint8Array {
  const lines: string[] = [];
  for (let line = 1, total = 0; total < 700 * 1024; line += 1) {
    const text = `<l>filler line ${line} carrying a little ordinary sentence text.</l>`;
    lines.push(text);
    total += text.length;
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    'customXml/item1.xml': strToU8(`<filler>${lines.join('')}</filler>`),
  });
}

/** Three pages past the open-yield threshold. */
function largeThreePages(): Uint8Array {
  return pastOpenThreshold(
    paragraph('one') + pageBreak + paragraph('two') + pageBreak + paragraph('three')
  );
}

/**
 * Pages of real text past the open-yield threshold, so the open lays out in slices. The body is
 * well past the blocks a sliced open lays out at mount, and small enough to finish quickly on a
 * slow runner.
 */
function manyPages(): Uint8Array {
  const body: string[] = [];
  for (let index = 0; index < 600; index += 1) {
    body.push(paragraph(`Paragraph ${index} of a long document with ordinary sentence text.`));
  }
  return pastOpenThreshold(body.join(''));
}

/** Every total a page counter renders, from the published page total. */
const rendered: number[] = [];
function PageTotal() {
  const total = useEditorState((snapshot) => snapshot.page.total);
  rendered.push(total);
  return <span data-testid="page-total">{total}</span>;
}

afterEach(cleanup);

describe('DocxEditor.PageNumber', () => {
  test('renders nothing for a one-page document', () => {
    const view = render(
      <DocxEditorRoot document={ONE_PAGE}>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <DocxEditorPageNumber />
      </DocxEditorRoot>
    );

    expect(view.queryByRole('status')).toBeNull();
  });

  test('reports the viewport page while scrolling, then fades after 600ms idle', async () => {
    let editor: Editor | null = null;
    const view = render(
      <DocxEditorRoot document={THREE_PAGES} onReady={(instance) => (editor = instance)}>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <DocxEditorPageNumber className="host-page-number" style={{ right: 32 }} />
      </DocxEditorRoot>
    );
    const viewport = view.getByTestId('docx-editor-scroll');
    const surface = view.container.querySelector<HTMLElement>('.docx-paginated-surface')!;
    Object.defineProperty(viewport, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(surface, 'offsetTop', { value: 0, configurable: true });
    const second = editor!.getPageGeometry()[1]!;
    viewport.scrollTop = second.box.y + second.box.height / 2 - viewport.clientHeight / 2;

    act(() => viewport.dispatchEvent(new Event('scroll')));

    const status = view.getByRole('status');
    expect(status.textContent).toBe('2 of 3');
    expect(status.getAttribute('data-visible')).toBe('true');
    expect(status.classList.contains('docx-editor')).toBe(true);
    expect(status.classList.contains('host-page-number')).toBe(true);
    expect((status as HTMLElement).style.right).toBe('32px');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 650));
    });
    expect(status.getAttribute('data-visible')).toBe('false');
  });

  test('is included in the batteries-included editor', () => {
    const view = render(
      <DocxEditor
        document={THREE_PAGES}
        t={(key) => (key === 'viewer.pageIndicator' ? 'Page {current} / {total}' : key)}
      />
    );
    expect(view.getByRole('status').textContent).toBe('Page 1 / 3');
  });

  test('returns to hidden when the editor document changes', () => {
    const tree = (document: Uint8Array) => (
      <DocxEditorRoot document={document}>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <DocxEditorPageNumber />
      </DocxEditorRoot>
    );
    const view = render(tree(THREE_PAGES));
    const viewport = view.getByTestId('docx-editor-scroll');
    Object.defineProperty(viewport, 'clientHeight', { value: 300, configurable: true });
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(view.getByRole('status').getAttribute('data-visible')).toBe('true');

    view.rerender(tree(ONE_PAGE));
    expect(view.queryByRole('status')).toBeNull();
    view.rerender(tree(THREE_PAGES));
    expect(view.getByRole('status').getAttribute('data-visible')).toBe('false');
  });

  for (const inside of [false, true]) {
    test(`stays outside the scroll container when placed ${inside ? 'inside' : 'beside'} the viewport`, () => {
      const view = render(
        <DocxEditorRoot document={THREE_PAGES}>
          <div className="host-workspace" style={{ position: 'relative' }}>
            <DocxEditorViewport>
              <DocxEditorContent />
              {inside ? <DocxEditorPageNumber /> : null}
            </DocxEditorViewport>
            {inside ? null : <DocxEditorPageNumber />}
          </div>
        </DocxEditorRoot>
      );
      const viewport = view.getByTestId('docx-editor-scroll');
      const workspace = view.container.querySelector<HTMLElement>('.host-workspace')!;
      const status = view.getByRole('status');
      // A direct child of the positioned wrapper, so scrolling the pages never moves it.
      expect(status.parentElement).toBe(workspace);
      expect(viewport.contains(status)).toBe(false);
      // The wrapper is not scoped, so the indicator scopes itself.
      expect(status.classList.contains('docx-editor')).toBe(true);

      Object.defineProperty(viewport, 'clientHeight', { value: 300, configurable: true });
      viewport.scrollTop = 400;
      act(() => viewport.dispatchEvent(new Event('scroll')));
      expect(status.getAttribute('data-visible')).toBe('true');
      expect(status.textContent).toContain('of 3');
    });
  }

  test('does not scope itself again under a scoped wrapper', () => {
    const view = render(
      <DocxEditorRoot document={THREE_PAGES}>
        <div className="docx-editor host-workspace">
          <DocxEditorViewport>
            <DocxEditorContent />
            <DocxEditorPageNumber />
          </DocxEditorViewport>
        </div>
      </DocxEditorRoot>
    );
    const status = view.getByRole('status');
    expect(status.parentElement?.classList.contains('host-workspace')).toBe(true);
    expect(status.classList.contains('docx-editor')).toBe(false);
  });

  test('has no host inside a viewport that is not mounted yet, so it renders nothing', () => {
    const seen: ViewportOverlayHost[] = [];
    function Probe({ viewport }: { viewport: HTMLElement | null }) {
      seen.push(useViewportOverlayHost(viewport));
      return null;
    }
    const detached = document.createElement('div');
    render(
      <InsideViewportContext.Provider value={true}>
        <Probe viewport={null} />
        <Probe viewport={detached} />
      </InsideViewportContext.Provider>
    );
    expect(seen.length).toBeGreaterThan(0);
    for (const answer of seen) {
      expect(answer.inside).toBe(true);
      expect(answer.host).toBeNull();
    }
  });

  test('inside the packaged editor viewport it joins the workspace row under one scope', () => {
    const view = render(
      <DocxEditor document={THREE_PAGES}>
        <DocxEditorPageNumber className="host-chip" />
      </DocxEditor>
    );
    const viewport = view.getByTestId('docx-editor-scroll');
    const chip = view.container.querySelector<HTMLElement>('.host-chip')!;
    expect(chip).not.toBeNull();
    // The workspace row: the viewport's parent, beside the packaged indicator.
    expect(chip.parentElement).toBe(viewport.parentElement);
    expect(viewport.contains(chip)).toBe(false);
    // One `.docx-editor` scope: the packaged wrapper, not a second one on the chip.
    expect(chip.classList.contains('docx-editor')).toBe(false);
    const scope = chip.closest('.docx-editor');
    expect(scope).not.toBeNull();
    expect(scope!.parentElement?.closest('.docx-editor') ?? null).toBeNull();
  });

  test('shows no count while a document opens, then the full count', async () => {
    let editor: Editor | null = null;
    const view = render(
      <DocxEditorRoot
        document={THREE_PAGES}
        onReady={(ready) => {
          editor = ready;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <DocxEditorPageNumber />
      </DocxEditorRoot>
    );
    await waitFor(() => expect(editor).not.toBeNull());
    expect(view.container.querySelector('.docx-editor__page-number')).not.toBeNull();

    act(() => {
      (editor as unknown as { load(bytes: Uint8Array): void }).load(largeThreePages());
    });
    await act(async () => {});
    // A partial layout's total would be wrong, so no count shows during the open.
    expect(editor!.snapshot().isOpening).toBe(true);
    expect(view.container.querySelector('.docx-editor__page-number')).toBeNull();

    await waitFor(() => expect(editor!.snapshot().isOpening).toBe(false));
    await waitFor(() =>
      expect(view.container.querySelector('.docx-editor__page-number')).not.toBeNull()
    );
  });

  test('a counter shows the final page total once the last page is laid out', async () => {
    rendered.length = 0;
    // The open ends at the mount with a partial layout. The pages laid out after it move no
    // revision and no caret; the counter must still hear the final total.
    let editor: (Editor & { surface: object | null }) | null = null;
    const view = render(
      <DocxEditorRoot
        document={manyPages()}
        onReady={(ready) => {
          editor = ready as typeof editor;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <PageTotal />
      </DocxEditorRoot>
    );
    await waitFor(
      () => {
        const opening = view.container.querySelector('[data-docx-opening-preview]') !== null;
        // `snapshot()` reads the live total without forcing the remaining pages.
        const final = editor!.snapshot().page.total;
        expect(editor?.surface).toBeTruthy();
        expect(opening).toBe(false);
        expect(rendered.at(-1)).toBe(final);
      },
      { timeout: 20_000 }
    );
    // The first total rendered with a document mounted is the partial one.
    expect(rendered.find((total) => total > 0)).toBeLessThan(editor!.snapshot().page.total);
  }, 60_000);
});
