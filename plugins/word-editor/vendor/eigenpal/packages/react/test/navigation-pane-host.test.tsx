// The navigation pane in a composed host: `DocxEditor.Root` + `DocxEditor.Viewport` with the
// pane mounted inside the Viewport, as the composition guides show it.
//
// Pinned here: the pane stays on the scrollport instead of scrolling with the pages, Ctrl/Cmd+F
// opens it on Find for THIS editor only, focus moves in on open and back out on close, a
// narrow viewport overlays the page instead of pushing it off screen, the pane speaks the
// Root's language, and the shift measures the widest page rather than the caret's section.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import deCatalog from '../../i18n/de.json';
import { resolve } from 'node:path';
import { useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorNavigation } from '../src/editor/navigation/DocxEditorNavigation.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import { inertBehindPane } from '../src/editor/navigation/navigation-keys.ts';
import type { NavigationTab } from '../src/editor/navigation/useNavigationPane.ts';
import {
  NAVIGATION_PANE_MIN_PAGE_ROOM,
  navigationPaneOverlays,
  navigationPaneReservation,
} from '../src/editor/navigation/navigation-geometry.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:styleId="H1"><w:name w:val="heading 1"/></w:style>' +
  '</w:styles>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
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

const heading = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="H1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const SOURCE = docx(
  heading('First') + '<w:p><w:r><w:t>alpha beta</w:t></w:r></w:p>' + heading('Second')
);
// A Letter portrait section followed by a Letter landscape one (11in = 1056px wide).
const MIXED = docx(
  '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
    '<w:r><w:t>portrait</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>landscape</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/></w:sectPr>'
);

// happy-dom lays nothing out; the scroll container reports chosen sizes instead.
let scrollerWidth = 1600;
const scrollerHeight = 700;
const restore: Array<() => void> = [];

function stub(property: 'clientWidth' | 'clientHeight', value: () => number) {
  let owner: object = Element.prototype;
  let original: PropertyDescriptor | undefined;
  for (const proto of [Element.prototype, HTMLElement.prototype] as object[]) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, property);
    if (descriptor) {
      owner = proto;
      original = descriptor;
      break;
    }
  }
  Object.defineProperty(owner, property, {
    configurable: true,
    get(this: Element) {
      if (this.classList?.contains('docx-editor__scroll-container')) return value();
      return original?.get ? (original.get.call(this) as number) : 0;
    },
  });
  restore.push(() => {
    if (original) Object.defineProperty(owner, property, original);
  });
}

beforeAll(() => {
  stub('clientWidth', () => scrollerWidth);
  stub('clientHeight', () => scrollerHeight);
});
afterAll(() => {
  for (const undo of restore) undo();
});
beforeEach(() => {
  scrollerWidth = 1600;
});
afterEach(cleanup);

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function ctrlF(target: Element, init: KeyboardEventInit = { ctrlKey: true }) {
  const event = new KeyboardEvent('keydown', {
    key: 'f',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function Host({
  source = SOURCE,
  translate,
  navigation = {},
  pane = true,
}: {
  pane?: boolean;
  source?: Uint8Array;
  translate?: (key: string) => string;
  navigation?: Parameters<typeof DocxEditorNavigation>[0];
}) {
  return (
    <DocxEditorRoot document={source} {...(translate ? { translate } : {})}>
      <DocxEditorViewport>
        {pane ? <DocxEditorNavigation {...navigation} /> : null}
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
}

const q = (root: ParentNode, selector: string) => root.querySelector(selector) as HTMLElement;

/** A resolver over the German catalogue source, as a host passes it to Root. */
function germanTranslate(key: string, params: Record<string, string | number> = {}): string {
  let node: unknown = deCatalog;
  for (const part of key.split('.')) {
    node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : null;
  }
  if (typeof node !== 'string') return key;
  return node.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

/** Run `body` while the browser reports an Apple platform. */
function onApplePlatform(body: () => void) {
  Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
  try {
    body();
  } finally {
    delete (navigator as unknown as { platform?: string }).platform;
  }
}

describe('the pane in the documented composition', () => {
  test('sits in the scroll container as a sticky strip sized to the viewport', async () => {
    const { container } = render(<Host />);
    await settle();
    const scroller = q(container, '.docx-editor__scroll-container');
    const nav = q(container, '.docx-nav');
    expect(nav.parentElement).toBe(scroller);
    // The adapter publishes the viewport's content height for the sticky panel.
    expect(nav.style.getPropertyValue('--docx-nav-block-size')).toBe(`${scrollerHeight}px`);
    expect(nav.style.getPropertyValue('--docx-nav-inline-size')).toBe(`${scrollerWidth}px`);

    // With the real stylesheet applied, the pane is sticky (pinned to the scrollport), not
    // absolute (which would place it in the scrolled content and carry it off with the pages).
    const css = readFileSync(resolve(import.meta.dir, '../../core/src/styles/editor.css'), 'utf8');
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    try {
      expect(getComputedStyle(nav).position).toBe('sticky');
      expect(getComputedStyle(nav).height).toBe('0px');
    } finally {
      style.remove();
    }
  });
});

describe('Ctrl/Cmd+F', () => {
  test('opens an uncontrolled pane on Find and focuses the query', async () => {
    const { container } = render(<Host />);
    await settle();
    const scroller = q(container, '.docx-editor__scroll-container');
    scroller.focus();
    const event = ctrlF(scroller);
    expect(event.defaultPrevented).toBe(true);
    expect(q(container, '.docx-nav').getAttribute('data-open')).toBe('true');
    expect(q(container, '#docx-nav-tab-find').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(
      q(container, '#docx-nav-panel-find .docx-nav__search-input')
    );
  });

  test('refocuses the query of a pane already open on Find', async () => {
    const { container } = render(<Host navigation={{ defaultOpen: true, defaultTab: 'find' }} />);
    await settle();
    const input = q(container, '#docx-nav-panel-find .docx-nav__search-input');
    const scroller = q(container, '.docx-editor__scroll-container');
    scroller.focus();
    expect(document.activeElement).toBe(scroller);
    ctrlF(scroller);
    expect(document.activeElement).toBe(input);
  });

  test('takes only the platform modifier: Cmd on macOS, Ctrl elsewhere', async () => {
    const { container } = render(<Host />);
    await settle();
    const scroller = q(container, '.docx-editor__scroll-container');
    const nav = q(container, '.docx-nav');
    // Not an Apple platform (the test environment): Meta is the system key.
    expect(ctrlF(scroller, { metaKey: true }).defaultPrevented).toBe(false);
    onApplePlatform(() => {
      // On macOS Ctrl+F moves the caret forward one character; the text keeps it.
      expect(ctrlF(scroller, { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(nav.getAttribute('data-open')).toBe('false');
      expect(ctrlF(scroller, { metaKey: true }).defaultPrevented).toBe(true);
    });
    expect(nav.getAttribute('data-open')).toBe('true');
  });

  test('drives a controlled pane through its callbacks and focuses once the host opens it', async () => {
    const seen: string[] = [];
    function Controlled() {
      const [open, setOpen] = useState(false);
      const [tab, setTab] = useState<NavigationTab>('headings');
      return (
        <Host
          navigation={{
            open,
            tab,
            onOpenChange: (next) => {
              seen.push(`open:${next}`);
              setOpen(next);
            },
            onTabChange: (next) => {
              seen.push(`tab:${next}`);
              setTab(next);
            },
          }}
        />
      );
    }
    const { container } = render(<Controlled />);
    await settle();
    ctrlF(q(container, '.docx-editor__scroll-container'));
    expect(seen).toEqual(['tab:find', 'open:true']);
    expect(document.activeElement).toBe(
      q(container, '#docx-nav-panel-find .docx-nav__search-input')
    );
  });

  test('drops a request the controlled host declined, so a later open does not steal focus', async () => {
    let setOpen: (next: boolean) => void = () => {};
    function Declining() {
      const [open, set] = useState(false);
      setOpen = set;
      // The host ignores the pane's request to open.
      return <Host navigation={{ open, onOpenChange: () => {} }} />;
    }
    const { container } = render(<Declining />);
    await settle();
    act(() => {
      q(container, '.docx-nav__toggle').click();
    });
    await settle();
    expect(q(container, '.docx-nav').getAttribute('data-open')).toBe('false');
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      outside.focus();
      // The host opens the pane later, for its own reasons: focus stays where it was.
      act(() => setOpen(true));
      expect(q(container, '.docx-nav').getAttribute('data-open')).toBe('true');
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  test('leaves the chord alone outside this editor and in another editor', async () => {
    const { container } = render(
      <>
        <button type="button" id="outside">
          outside
        </button>
        <div id="a">
          <Host />
        </div>
        <div id="b">
          <Host navigation={{ toggle: false }} />
        </div>
      </>
    );
    await settle();
    const outside = q(container, '#outside');
    outside.focus();
    expect(ctrlF(outside).defaultPrevented).toBe(false);
    const [navA, navB] = [...container.querySelectorAll('.docx-nav')] as HTMLElement[];
    expect(navA!.getAttribute('data-open')).toBe('false');
    expect(navB!.getAttribute('data-open')).toBe('false');

    ctrlF(q(container, '#b .docx-editor__scroll-container'));
    expect(navA!.getAttribute('data-open')).toBe('false');
    expect(navB!.getAttribute('data-open')).toBe('true');
  });

  test('works in the packaged editor from the pages and from the toolbar', async () => {
    const { container } = render(<DocxEditor document={SOURCE} />);
    await settle();
    const nav = q(container, '.docx-nav');
    ctrlF(q(container, '.docx-editor__scroll-container'));
    expect(nav.getAttribute('data-open')).toBe('true');
    act(() => {
      fireEvent.keyDown(q(container, '#docx-nav-panel-find .docx-nav__search-input'), {
        key: 'Escape',
      });
    });
    expect(nav.getAttribute('data-open')).toBe('false');
    const toolbarButton = q(container, '.docx-toolbar button');
    expect(toolbarButton).not.toBeNull();
    ctrlF(toolbarButton);
    expect(nav.getAttribute('data-open')).toBe('true');
  });

  test('findShortcut={false} leaves the chord to the browser and the disc does not name it', async () => {
    const { container } = render(<Host navigation={{ findShortcut: false }} />);
    await settle();
    const scroller = q(container, '.docx-editor__scroll-container');
    expect(ctrlF(scroller).defaultPrevented).toBe(false);
    expect(q(container, '.docx-nav').getAttribute('data-open')).toBe('false');
    const disc = q(container, '.docx-nav__toggle');
    expect(disc.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(disc.getAttribute('title')).toBe('Navigation');
  });

  test('is named on the disc', async () => {
    const { container } = render(<Host />);
    await settle();
    const disc = q(container, '.docx-nav__toggle');
    expect(disc.getAttribute('title')).toBe('Navigation (Ctrl+F)');
    expect(disc.getAttribute('aria-keyshortcuts')).toBe('Control+F');
  });
});

describe('the disc on macOS in another language', () => {
  test('names Cmd+F, never the translated Ctrl spelling', async () => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
    try {
      const { container } = render(<Host translate={germanTranslate} />);
      await settle();
      const disc = q(container, '.docx-nav__toggle');
      expect(disc.getAttribute('aria-label')).toBe(germanTranslate('navigation.openAriaLabel'));
      expect(disc.getAttribute('title')).toBe(`${germanTranslate('navigation.openTitle')} (⌘+F)`);
      expect(disc.getAttribute('title')).not.toContain('Strg');
      expect(disc.getAttribute('aria-keyshortcuts')).toBe('Meta+F');
    } finally {
      delete (navigator as unknown as { platform?: string }).platform;
    }
  });
});

describe('focus', () => {
  test('the disc moves focus into Headings, and the close arrow returns it to the disc', async () => {
    const { container } = render(<Host />);
    await settle();
    act(() => {
      q(container, '.docx-nav__toggle').click();
    });
    const first = q(container, '#docx-nav-panel-headings .docx-nav__heading');
    expect(first.textContent).toBe('First');
    // Heading text is isolated, so a left-to-right heading reads in order in a right-to-left pane.
    expect(first.querySelector('bdi')?.textContent).toBe('First');
    expect(document.activeElement).toBe(first);
    act(() => {
      q(container, '.docx-nav__close').click();
    });
    expect(q(container, '.docx-nav').getAttribute('data-open')).toBe('false');
    expect(document.activeElement).toBe(q(container, '.docx-nav__toggle'));
  });

  test('Escape closes the pane and returns focus to the element that opened it', async () => {
    const { container } = render(<Host />);
    await settle();
    const scroller = q(container, '.docx-editor__scroll-container');
    scroller.focus();
    ctrlF(scroller);
    const input = q(container, '#docx-nav-panel-find .docx-nav__search-input');
    expect(document.activeElement).toBe(input);
    act(() => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    expect(q(container, '.docx-nav').getAttribute('data-open')).toBe('false');
    expect(document.activeElement).toBe(scroller);
  });
});

describe('focus return without scrolling', () => {
  test('a host that unmounts the pane on close still gets focus back', async () => {
    function Unmounting() {
      const [shown, setShown] = useState(true);
      return (
        <Host pane={shown} navigation={{ onOpenChange: (next) => !next && setShown(false) }} />
      );
    }
    const { container } = render(<Unmounting />);
    await settle();
    const button = q(container, '.docx-nav__toggle');
    button.focus();
    expect(document.activeElement).toBe(button);
    act(() => {
      button.click();
    });
    act(() => {
      q(container, '.docx-nav__close').click();
    });
    await settle();
    expect(container.querySelector('.docx-nav')).toBeNull();
    // The disc went with the pane: focus returns to the document, not to the body.
    expect(document.activeElement).not.toBe(document.body);
    expect(container.contains(document.activeElement)).toBe(true);
  });

  test('Ctrl+F from the pages, then Escape, refocuses the pages without scrolling', async () => {
    const { container } = render(<Host />);
    await settle();
    const pages = q(container, '.docx-pages');
    expect(pages).not.toBeNull();
    pages.focus({ preventScroll: true });
    expect(document.activeElement).toBe(pages);
    ctrlF(pages);
    const input = q(container, '#docx-nav-panel-find .docx-nav__search-input');
    expect(document.activeElement).toBe(input);

    // Every focus call from here on, with its options. The pages layer is the whole
    // document tall: a plain focus() on it scrolls the document to page 1.
    const calls: Array<{ element: Element; options?: FocusOptions }> = [];
    const original = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      calls.push({ element: this, ...(options ? { options } : {}) });
      return original.call(this, options);
    };
    try {
      act(() => {
        fireEvent.keyDown(input, { key: 'Escape' });
      });
    } finally {
      HTMLElement.prototype.focus = original;
    }
    expect(q(container, '.docx-nav').getAttribute('data-open')).toBe('false');
    expect(document.activeElement).toBe(pages);
    const onPages = calls.filter((call) => call.element === pages);
    expect(onPages.length).toBeGreaterThan(0);
    for (const call of onPages) expect(call.options?.preventScroll).toBe(true);
  });
});

describe('narrow viewports', () => {
  test('the threshold leaves a readable page column beside the pane', () => {
    const reservation = navigationPaneReservation();
    expect(navigationPaneOverlays(390, reservation)).toBe(true);
    expect(
      navigationPaneOverlays(reservation + NAVIGATION_PANE_MIN_PAGE_ROOM - 1, reservation)
    ).toBe(true);
    expect(navigationPaneOverlays(reservation + NAVIGATION_PANE_MIN_PAGE_ROOM, reservation)).toBe(
      false
    );
    expect(navigationPaneOverlays(0, reservation)).toBe(false);
  });

  test('at 390px the pane overlays the page, shifts nothing, and closes on a pick', async () => {
    scrollerWidth = 390;
    const { container } = render(<Host navigation={{ defaultOpen: true }} />);
    await settle();
    const nav = q(container, '.docx-nav');
    expect(nav.classList.contains('docx-nav--overlay')).toBe(true);
    const scroller = q(container, '.docx-editor__scroll-container');
    expect(scroller.style.getPropertyValue('--docx-nav-shift')).toBe('0px');
    const row = q(container, '.docx-nav__heading');
    expect(row).not.toBeNull();
    act(() => {
      row.click();
    });
    await settle();
    expect(nav.getAttribute('data-open')).toBe('false');
  });

  test('the review rail counts: room the rail takes is not room beside the pane', async () => {
    scrollerWidth = 700;
    const { container } = render(<Host />);
    await settle();
    const scroller = q(container, '.docx-editor__scroll-container');
    // 700 less the 328px reservation leaves 372px, enough on its own; a 300px rail does not.
    scroller.style.setProperty('padding-inline-end', '300px');
    act(() => {
      q(container, '.docx-nav__toggle').click();
    });
    await settle();
    expect(q(container, '.docx-nav').classList.contains('docx-nav--overlay')).toBe(true);
  });

  test('without a rail the same viewport docks the pane', async () => {
    scrollerWidth = 700;
    const { container } = render(<Host navigation={{ defaultOpen: true }} />);
    await settle();
    expect(q(container, '.docx-nav').classList.contains('docx-nav--overlay')).toBe(false);
  });

  test('an overlaying pane makes the page area inert until it closes', async () => {
    scrollerWidth = 390;
    const { container } = render(<Host navigation={{ defaultOpen: true }} />);
    await settle();
    const pages = q(container, '.docx-pages');
    expect(pages.closest('[inert]')).not.toBeNull();
    expect(q(container, '.docx-nav__panel-shell').closest('[inert]')).toBeNull();
    act(() => {
      q(container, '.docx-nav__heading').click();
    });
    await settle();
    expect(q(container, '.docx-nav').getAttribute('data-open')).toBe('false');
    expect(pages.closest('[inert]')).toBeNull();
  });

  test('a docked pane leaves the page area interactive', async () => {
    const { container } = render(<Host navigation={{ defaultOpen: true }} />);
    await settle();
    expect(q(container, '.docx-pages').closest('[inert]')).toBeNull();
  });

  test('a host that keeps the pane open after a pick keeps the page inert and focus in the pane', async () => {
    scrollerWidth = 390;
    const onOpenChange = mock(() => {});
    const { container } = render(<Host navigation={{ open: true, onOpenChange }} />);
    await settle();
    const pages = q(container, '.docx-pages');
    const heading = q(container, '.docx-nav__heading');
    act(() => {
      heading.focus();
      heading.click();
    });
    await settle();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(q(container, '.docx-nav').getAttribute('data-open')).toBe('true');
    expect(pages.closest('[inert]')).not.toBeNull();
    expect(pages.contains(document.activeElement)).toBe(false);
  });

  test('a press on the page it leaves visible closes the overlaying pane', async () => {
    scrollerWidth = 390;
    const { container } = render(<Host navigation={{ defaultOpen: true }} />);
    await settle();
    const scroller = q(container, '.docx-editor__scroll-container');
    act(() => {
      scroller.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    await settle();
    expect(q(container, '.docx-nav').getAttribute('data-open')).toBe('false');
    expect(q(container, '.docx-pages').closest('[inert]')).toBeNull();
  });

  test('a pane beside the scroll container leaves the container itself scrollable', () => {
    const row = document.createElement('div');
    const pane = document.createElement('div');
    const viewport = document.createElement('div');
    const content = document.createElement('div');
    viewport.append(content);
    row.append(pane, viewport);
    const release = inertBehindPane(pane, viewport);
    expect(viewport.hasAttribute('inert')).toBe(false);
    expect(content.hasAttribute('inert')).toBe(true);
    release();
    expect(content.hasAttribute('inert')).toBe(false);
  });

  test('a wide viewport keeps the pane open after a pick', async () => {
    scrollerWidth = 1600;
    const { container } = render(<Host navigation={{ defaultOpen: true }} />);
    await settle();
    const nav = q(container, '.docx-nav');
    expect(nav.classList.contains('docx-nav--overlay')).toBe(false);
    act(() => {
      q(container, '.docx-nav__heading').click();
    });
    await settle();
    expect(nav.getAttribute('data-open')).toBe('true');
  });
});

describe('language', () => {
  test('falls back to the translate given to Root', async () => {
    const translate = (key: string) =>
      key === 'navigation.openAriaLabel' ? 'Navigation öffnen' : key;
    const { container } = render(<Host translate={translate} />);
    await settle();
    expect(q(container, '.docx-nav__toggle').getAttribute('aria-label')).toBe('Navigation öffnen');
    // Keys the Root resolver leaves unresolved still come from the catalogue.
    expect(q(container, '#docx-nav-tab-find').textContent).toBe('Find');
  });

  test('the pane’s own t still wins', async () => {
    const { container } = render(
      <Host translate={() => 'root'} navigation={{ t: (key) => `pane:${key}` }} />
    );
    await settle();
    expect(q(container, '.docx-nav__toggle').getAttribute('aria-label')).toBe(
      'pane:navigation.openAriaLabel'
    );
  });
});

describe('page width', () => {
  test('the shift clears the widest page, not only the caret section', async () => {
    // 1300px: the portrait page alone leaves a 242px gutter (shift 172), but the landscape
    // page widens the stack to 1056px and the pane needs the full 328px reservation.
    scrollerWidth = 1300;
    const { container } = render(<Host source={MIXED} navigation={{ defaultOpen: true }} />);
    await settle();
    await settle();
    const scroller = q(container, '.docx-editor__scroll-container');
    expect(scroller.style.getPropertyValue('--docx-nav-shift')).toBe(
      `${navigationPaneReservation()}px`
    );
  });
});

describe('an open toolbar popup and Ctrl/Cmd+F', () => {
  test('moving focus into the find field closes the dropdown, so Escape reaches the pane', async () => {
    const { container } = render(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorToolbar preset={false} overflow={false}>
          <DocxEditorToolbar.Alignment />
        </DocxEditorToolbar>
        <DocxEditorViewport>
          <DocxEditorNavigation />
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await settle();
    const scroller = q(container, '.docx-editor__scroll-container');
    scroller.focus();
    const trigger = q(container, '[data-slot="alignment"] [aria-haspopup]');
    act(() => {
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      trigger.click();
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    ctrlF(scroller);
    const input = q(container, '#docx-nav-panel-find .docx-nav__search-input');
    expect(document.activeElement).toBe(input);
    await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    act(() => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    expect(q(container, '.docx-nav').getAttribute('data-open')).toBe('false');
    expect(document.activeElement).toBe(scroller);
  });
});

describe('focus when the pane covers the page', () => {
  test('focus in content that turns inert moves into the pane', () => {
    const viewport = document.createElement('div');
    const pane = document.createElement('nav');
    const find = document.createElement('input');
    find.className = 'docx-nav__search-input';
    // The headings panel with no headings yet: its filter field is the entry.
    const panel = document.createElement('div');
    panel.id = 'docx-nav-panel-headings';
    panel.append(find);
    pane.append(panel);
    const rail = document.createElement('div');
    const draft = document.createElement('textarea');
    rail.append(draft);
    viewport.append(pane, rail);
    document.body.append(viewport);
    try {
      draft.focus();
      expect(document.activeElement).toBe(draft);
      const release = inertBehindPane(pane, viewport);
      expect(rail.hasAttribute('inert')).toBe(true);
      expect(document.activeElement).toBe(find);
      release();
      expect(rail.hasAttribute('inert')).toBe(false);
    } finally {
      viewport.remove();
    }
  });

  test('focus outside the covered content stays where it is', () => {
    const viewport = document.createElement('div');
    const pane = document.createElement('nav');
    pane.append(document.createElement('input'));
    viewport.append(pane, document.createElement('div'));
    const host = document.createElement('input');
    document.body.append(viewport, host);
    try {
      host.focus();
      const release = inertBehindPane(pane, viewport);
      expect(document.activeElement).toBe(host);
      release();
    } finally {
      viewport.remove();
      host.remove();
    }
  });
});

describe('the focus target when the pane covers the page', () => {
  function paneFixture(tab: 'headings' | 'find') {
    const viewport = document.createElement('div');
    const pane = document.createElement('nav');
    for (const value of ['headings', 'find']) {
      const button = document.createElement('button');
      button.setAttribute('role', 'tab');
      button.id = `docx-nav-tab-${value}`;
      button.setAttribute('aria-selected', String(value === tab));
      pane.append(button);
    }
    const headings = document.createElement('div');
    headings.id = 'docx-nav-panel-headings';
    headings.hidden = tab !== 'headings';
    const first = document.createElement('button');
    first.className = 'docx-nav__heading';
    const current = document.createElement('button');
    current.className = 'docx-nav__heading docx-nav__heading--current';
    headings.append(first, current);
    const find = document.createElement('div');
    find.id = 'docx-nav-panel-find';
    find.hidden = tab !== 'find';
    const input = document.createElement('input');
    input.className = 'docx-nav__search-input';
    find.append(input);
    pane.append(headings, find);
    const rail = document.createElement('div');
    const draft = document.createElement('textarea');
    rail.append(draft);
    viewport.append(pane, rail);
    document.body.append(viewport);
    return { viewport, pane, current, input, draft };
  }

  test('with the Find tab active, focus goes to the query, not a hidden heading', () => {
    const view = paneFixture('find');
    try {
      view.draft.focus();
      const release = inertBehindPane(view.pane, view.viewport);
      expect(document.activeElement).toBe(view.input);
      release();
    } finally {
      view.viewport.remove();
    }
  });

  test('with the Headings tab active, focus goes to the current heading', () => {
    const view = paneFixture('headings');
    try {
      view.draft.focus();
      const release = inertBehindPane(view.pane, view.viewport);
      expect(document.activeElement).toBe(view.current);
      release();
    } finally {
      view.viewport.remove();
    }
  });
});
