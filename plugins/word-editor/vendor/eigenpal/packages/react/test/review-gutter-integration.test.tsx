// The review gutter's React wiring, against the real engine: the rail registry gating,
// the snapshot-fed geometry, the viewport measurement, and the CSS custom properties the
// Viewport publishes. The pure `reviewGutter` rule is pinned in review-gutter.test.ts;
// none of that file touches the wiring, which is where the registry timing and the
// measurement fallbacks live.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

// React's `act` refuses to run outside an act-configured environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { useContext, useEffect } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance, EditorModule } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorLoading } from '../src/editor/DocxEditorLoading.tsx';
import { ReviewRailContext } from '../src/editor/context.ts';
import { useNavigationLayoutStore } from '../src/editor/navigation/navigation-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
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
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');
const REVIEW_MODULE: EditorModule = {
  id: 'review',
  review: {
    displayModes: ['all-markup', 'proposed', 'original'],
    collectReviewItems: () => [],
    revisionItemsOfParagraph: () => [],
  },
};

/** A rail with no UI: claims the gutter exactly the way `DocxEditor.Review` does. */
function RailStub() {
  const registry = useContext(ReviewRailContext);
  useEffect(() => registry?.register(), [registry]);
  return null;
}

function ShiftWriter() {
  const store = useNavigationLayoutStore();
  useEffect(() => store?.setShift(128), [store]);
  return null;
}

// happy-dom lays nothing out, so every element reports `clientWidth` 0 — which the hook
// correctly treats as "unmeasured" and answers with the full-column fallback. To exercise
// the measured path, the scroll container reports a chosen width instead. Restored after
// the suite; other files run in their own process (the sharded runner), so nothing leaks.
let scrollerWidth = 0;
let originalClientWidth: PropertyDescriptor | undefined;
let clientWidthOwner: object | null = null;

beforeAll(() => {
  for (const proto of [Element.prototype, HTMLElement.prototype] as object[]) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'clientWidth');
    if (descriptor) {
      originalClientWidth = descriptor;
      clientWidthOwner = proto;
      break;
    }
  }
  const target = clientWidthOwner ?? Element.prototype;
  Object.defineProperty(target, 'clientWidth', {
    configurable: true,
    get(this: Element) {
      if (this.classList?.contains('docx-editor__scroll-container')) return scrollerWidth;
      return originalClientWidth?.get ? (originalClientWidth.get.call(this) as number) : 0;
    },
  });
  if (!clientWidthOwner) clientWidthOwner = target;
});

afterAll(() => {
  if (clientWidthOwner && originalClientWidth) {
    Object.defineProperty(clientWidthOwner, 'clientWidth', originalClientWidth);
  }
});

afterEach(cleanup);

/** Effects (registration, measurement) plus the engine's open tick. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe('the viewport’s review gutter', () => {
  test('no rail composed: no reservation attribute and no custom properties', async () => {
    scrollerWidth = 1000;
    const { container } = render(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await settle();
    const scroller = container.querySelector('.docx-editor__scroll-container')!;
    expect(scroller.hasAttribute('data-review-pane')).toBe(false);
    expect((scroller as HTMLElement).style.getPropertyValue('--docx-review-gutter')).toBe('');
  });

  test('a rail on a viewport too narrow for the column settles on the mirrored strip', async () => {
    // Letter page (816px at 100%) in a 1000px scroller: 184px leftover against the 364
    // the column and the clearance need together, so the strip mirrors onto both edges.
    scrollerWidth = 1000;
    let editor: DocxEditorInstance | null = null;
    const { container } = render(
      <DocxEditorRoot
        document={SOURCE}
        modules={[REVIEW_MODULE]}
        onReady={(ready) => {
          editor = ready as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <RailStub />
        <ShiftWriter />
        <DocxEditorLoading when overlay />
      </DocxEditorRoot>
    );
    await settle();
    act(() => {
      editor!.exec({ type: 'toggleReviewPane' });
    });
    await settle();
    const scroller = container.querySelector('.docx-editor__scroll-container') as HTMLElement;
    expect(scroller.getAttribute('data-review-pane')).toBe('open');
    expect(scroller.style.getPropertyValue('--docx-review-gutter')).toBe('44px');
    expect(scroller.style.getPropertyValue('--docx-review-gutter-start')).toBe('44px');
    const loading = container.querySelector('.docx-editor__loading') as HTMLElement;
    expect(
      loading.querySelector('.docx-paginated-surface > .docx-pages > .docx-page')
    ).not.toBeNull();
  });

  test("overflow: 'scroll' keeps the full column on a narrow viewport, switchable live", async () => {
    scrollerWidth = 1000;
    let editor: DocxEditorInstance | null = null;
    const { container } = render(
      <DocxEditorRoot
        document={SOURCE}
        modules={[REVIEW_MODULE]}
        onReady={(ready) => {
          editor = ready as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <RailStub />
      </DocxEditorRoot>
    );
    await settle();
    act(() => {
      editor!.setReviewPaneOptions({ overflow: 'scroll' });
      editor!.exec({ type: 'toggleReviewPane' });
    });
    await settle();
    const scroller = container.querySelector('.docx-editor__scroll-container') as HTMLElement;
    expect(scroller.style.getPropertyValue('--docx-review-gutter')).toBe('316px');
    expect(scroller.style.getPropertyValue('--docx-review-gutter-start')).toBe('24px');
    act(() => {
      editor!.setReviewPaneOptions({ overflow: 'float' });
    });
    await settle();
    expect(scroller.style.getPropertyValue('--docx-review-gutter')).toBe('44px');
    expect(scroller.style.getPropertyValue('--docx-review-gutter-start')).toBe('44px');
  });

  test("overflow: 'scroll' fits inside the marker strip and keeps one size when toggled", async () => {
    // The stylesheet's padding rule, which the fit measures; this file loads no CSS.
    const style = document.createElement('style');
    style.textContent =
      '.docx-editor__scroll-container { padding-right: var(--docx-review-gutter); ' +
      'padding-left: var(--docx-review-gutter-start); }';
    document.head.append(style);
    scrollerWidth = 800;
    let editor: DocxEditorInstance | null = null;
    try {
      render(
        <DocxEditorRoot
          document={SOURCE}
          modules={[REVIEW_MODULE]}
          onReady={(ready) => {
            editor = ready as DocxEditorInstance;
          }}
        >
          <DocxEditorViewport>
            <DocxEditorContent />
          </DocxEditorViewport>
          <RailStub />
        </DocxEditorRoot>
      );
      await settle();
      act(() => {
        editor!.setReviewPaneOptions({ overflow: 'scroll' });
        if (editor!.snapshot().reviewPaneOpen) editor!.exec({ type: 'toggleReviewPane' });
      });
      await settle();
      // Leave the fit and come back, so it measures the settled paddings now.
      act(() => {
        editor!.setZoomMode({ type: 'fixed' });
      });
      act(() => {
        editor!.setZoomMode('auto');
      });
      await settle();
      expect(editor!.snapshot().reviewPaneOpen).toBe(false);
      expect(editor!.getZoom() * 816).toBeLessThanOrEqual(800 - 88);
      // One page size: opening and closing the pane leaves the fit where it was.
      const closed = editor!.getZoom();
      for (let toggle = 0; toggle < 2; toggle += 1) {
        act(() => {
          editor!.exec({ type: 'toggleReviewPane' });
        });
        await settle();
        act(() => {
          editor!.setZoomMode({ type: 'fixed' });
        });
        act(() => {
          editor!.setZoomMode('auto');
        });
        await settle();
        expect(editor!.getZoom()).toBe(closed);
      }
    } finally {
      style.remove();
    }
  });

  test('a rail on a wide viewport keeps the full column, with nothing at the start', async () => {
    scrollerWidth = 1728;
    let editor: DocxEditorInstance | null = null;
    const { container } = render(
      <DocxEditorRoot
        document={SOURCE}
        modules={[REVIEW_MODULE]}
        onReady={(ready) => {
          editor = ready as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <RailStub />
        <DocxEditorLoading when overlay />
      </DocxEditorRoot>
    );
    await settle();
    act(() => {
      editor!.exec({ type: 'toggleReviewPane' });
    });
    await settle();
    const scroller = container.querySelector('.docx-editor__scroll-container') as HTMLElement;
    expect(scroller.getAttribute('data-review-pane')).toBe('open');
    expect(scroller.style.getPropertyValue('--docx-review-gutter')).toBe('316px');
    expect(scroller.style.getPropertyValue('--docx-review-gutter-start')).toBe('0px');
    const loading = container.querySelector('.docx-editor__loading') as HTMLElement;
    expect(
      loading.querySelector('.docx-paginated-surface > .docx-pages > .docx-page')
    ).not.toBeNull();
  });

  test("overflow 'shrinkPage' keeps the full column on a narrow viewport, and switches live", async () => {
    // The same 1000px scroller that mirrors the strip under a capped fit. With the setting,
    // the page may shrink to its 35% floor, so the full column stands.
    scrollerWidth = 1000;
    let editor: DocxEditorInstance | null = null;
    const { container } = render(
      <DocxEditorRoot
        document={SOURCE}
        modules={[
          {
            ...REVIEW_MODULE,
            review: { ...REVIEW_MODULE.review!, pane: { overflow: 'shrinkPage' } },
          },
        ]}
        zoomMode={{ type: 'fit', fit: 'pageWidth', minZoom: 0.35, maxZoom: 1 }}
        onReady={(ready) => {
          editor = ready as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <RailStub />
        <DocxEditorLoading when overlay />
      </DocxEditorRoot>
    );
    await settle();
    act(() => {
      editor!.exec({ type: 'toggleReviewPane' });
    });
    await settle();
    const scroller = container.querySelector('.docx-editor__scroll-container') as HTMLElement;
    expect(scroller.getAttribute('data-review-pane')).toBe('open');
    expect(scroller.style.getPropertyValue('--docx-review-gutter')).toBe('316px');
    expect(scroller.style.getPropertyValue('--docx-review-gutter-start')).toBe('0px');
    // Back to 'float' at runtime: the page keeps its cap and the strip mirrors.
    act(() => {
      editor!.setReviewPaneOptions({ overflow: 'float' });
    });
    await settle();
    expect(editor!.snapshot().reviewPane).toMatchObject({ opening: 'auto', overflow: 'float' });
    expect(scroller.style.getPropertyValue('--docx-review-gutter')).toBe('44px');
    expect(scroller.style.getPropertyValue('--docx-review-gutter-start')).toBe('44px');
  });
});
