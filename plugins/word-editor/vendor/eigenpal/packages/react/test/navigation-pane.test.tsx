// The navigation pane — `DocxEditor.Navigation` and the three hooks behind it.
//
// The load-bearing claim here is the LAYOUT one: an open pane must not move the document
// while the left gutter already has room for it, and when the gutter is too narrow it must
// move the page by exactly enough to clear the pane and no further. `navigationShift` is
// that rule as a pure function, and the numbers below are the ones measured against the
// real painted surface: a left padding P moves the centred page by P/2 until the padded
// box is narrower than the page, after which the page pins at P.
//
// The rest pins the composition down: the pane renders both tabs, stays mounted (and
// inert) when closed so a typed query survives a close/reopen, and the parts refuse to
// render outside their compound root rather than silently doing nothing.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

// React's `act` refuses to run outside an act-configured environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorNavigation } from '../src/editor/navigation/DocxEditorNavigation.tsx';
import { NavigationHeadings } from '../src/editor/navigation/parts.tsx';
import {
  NAVIGATION_PANE_GAP,
  NAVIGATION_PANE_INSET,
  NAVIGATION_PANE_WIDTH,
  navigationPaneReservation,
  navigationShift,
} from '../src/editor/navigation/navigation-geometry.ts';
import { RULER_WIDTH } from '../src/components/ui/VerticalRuler.tsx';

afterEach(cleanup);

// Letter at 100%: 8.5in x 96dpi.
const PAGE = 816;
const RESERVATION = navigationPaneReservation();

describe('navigationShift', () => {
  test('the reservation is the pane plus its inset and its clearance', () => {
    expect(RESERVATION).toBe(NAVIGATION_PANE_INSET + NAVIGATION_PANE_WIDTH + NAVIGATION_PANE_GAP);
  });

  test('does not move the document when the gutter already has room', () => {
    // 1728px viewport, 816px page: 456px of empty gutter on each side, and the pane needs
    // 328. This is the case the whole feature exists for — the page holds still.
    expect(RESERVATION).toBe(328);
    expect(
      navigationShift({ viewportWidth: 1728, pageWidthPx: PAGE, reservation: RESERVATION })
    ).toBe(0);
  });

  test('the panel clears a vertical ruler pinned at the viewport edge', () => {
    // The ruler is pinned at left: 0. An inset under its width puts the panel and its
    // collapsed disc on top of the tick marks.
    expect(NAVIGATION_PANE_INSET).toBeGreaterThanOrEqual(RULER_WIDTH);
  });

  test('does not move the document at the exact break-even gutter', () => {
    // Gutter === reservation: the pane fits with nothing to spare, and still nothing moves.
    const viewportWidth = PAGE + 2 * RESERVATION;
    expect(navigationShift({ viewportWidth, pageWidthPx: PAGE, reservation: RESERVATION })).toBe(0);
  });

  test('moves the page by exactly the deficit while it is still centred', () => {
    // 1200px viewport: 192px gutter against a 328px reservation. A centred page moves by
    // HALF the padding, so the padding is twice the 136px deficit, and the page lands on
    // the reservation exactly.
    const shift = navigationShift({
      viewportWidth: 1200,
      pageWidthPx: PAGE,
      reservation: RESERVATION,
    });
    expect(shift).toBe(272);
    const gutter = (1200 - PAGE) / 2;
    expect(gutter + shift / 2).toBe(RESERVATION);
  });

  test('pins the page at the reservation once the padded box is narrower than a page', () => {
    // Below `reservation <= 2 * gutter` the auto margins collapse to zero and the padding
    // IS the offset. Doubling it here would push the page twice as far as it needs.
    const viewportWidth = 900;
    const gutter = (viewportWidth - PAGE) / 2;
    expect(RESERVATION).toBeGreaterThan(2 * gutter);
    expect(navigationShift({ viewportWidth, pageWidthPx: PAGE, reservation: RESERVATION })).toBe(
      RESERVATION
    );
  });

  test('accounts for an open review rail and overflows instead of covering the page', () => {
    // The review rail reserves 316px on the right. Ignoring that padding returns 272px,
    // leaving the page 40px underneath the navigation pane. With both panes included the
    // page pins immediately after navigation and the combined layout overflows horizontally.
    const viewportWidth = 1200;
    const reviewReservation = 316;
    const shift = navigationShift({
      viewportWidth,
      pageWidthPx: PAGE,
      reservation: RESERVATION,
      inlineEndReservation: reviewReservation,
    });
    expect(shift).toBe(RESERVATION);
    expect(shift + PAGE + reviewReservation).toBeGreaterThan(viewportWidth);
  });

  test('never moves the page further than it must, at any width', () => {
    for (let viewportWidth = 500; viewportWidth <= 2400; viewportWidth += 17) {
      const shift = navigationShift({ viewportWidth, pageWidthPx: PAGE, reservation: RESERVATION });
      const gutter = (viewportWidth - PAGE) / 2;
      // Where the page ends up, in the two regimes the painted surface actually has.
      const pageLeft = viewportWidth - shift >= PAGE ? gutter + shift / 2 : shift;
      // Always clears the pane...
      expect(pageLeft).toBeGreaterThanOrEqual(RESERVATION - 1);
      // ...and never overshoots it by more than the rounding to a whole pixel.
      expect(pageLeft).toBeLessThanOrEqual(Math.max(gutter, RESERVATION) + 1);
    }
  });

  test('padding already standing at the inline start comes off the shift', () => {
    // The review gutter's mirrored 44px strip moves the page exactly as the shift does.
    // Solving for the shift alone and adding it ON TOP of the strip landed the page 22px
    // (proportional) to 44px (docked) past the reservation.
    const strip = 44;
    // Proportional: 1200px viewport, 192px gutter. The TOTAL start padding the page needs
    // is 272 (see the test above); the strip supplies 44 of it.
    const shift = navigationShift({
      viewportWidth: 1200,
      pageWidthPx: PAGE,
      reservation: RESERVATION,
      inlineStartReservation: strip,
    });
    expect(shift).toBe(272 - strip);
    // The page still lands exactly on the reservation: total padding over two, plus gutter.
    expect((shift + strip) / 2 + (1200 - PAGE) / 2).toBe(RESERVATION);
    // Docked: the page pins at the total padding, so the shift is the remainder.
    expect(
      navigationShift({
        viewportWidth: 900,
        pageWidthPx: PAGE,
        reservation: RESERVATION,
        inlineStartReservation: strip,
        docked: true,
      })
    ).toBe(RESERVATION - strip);
    // A strip that already clears the whole deficit asks for no shift at all.
    expect(
      navigationShift({
        viewportWidth: 1200,
        pageWidthPx: PAGE,
        reservation: RESERVATION,
        inlineStartReservation: 300,
      })
    ).toBe(0);
  });

  test('answers zero for a measurement it does not have yet', () => {
    // A viewport that has not been laid out, or a document with no page setup. Shifting on
    // a zero measurement would make the pane jump on the first frame and settle on the
    // second, which is worse than not shifting at all.
    expect(navigationShift({ viewportWidth: 0, pageWidthPx: PAGE, reservation: RESERVATION })).toBe(
      0
    );
    expect(navigationShift({ viewportWidth: 1200, pageWidthPx: 0, reservation: RESERVATION })).toBe(
      0
    );
    expect(
      navigationShift({ viewportWidth: Number.NaN, pageWidthPx: PAGE, reservation: RESERVATION })
    ).toBe(0);
  });
});

describe('DocxEditor.Navigation', () => {
  test('renders the toggle when closed and the pane when open', () => {
    const closed = render(
      <DocxEditorRoot>
        <DocxEditorNavigation />
      </DocxEditorRoot>
    );
    expect(closed.container.querySelector('.docx-nav__toggle')).not.toBeNull();
    expect(closed.container.querySelector('.docx-nav')?.getAttribute('data-open')).toBe('false');
    cleanup();

    const open = render(
      <DocxEditorRoot>
        <DocxEditorNavigation defaultOpen />
      </DocxEditorRoot>
    );
    expect(open.container.querySelector('.docx-nav')?.getAttribute('data-open')).toBe('true');
    // The toggle gives way to the pane's own close arrow.
    expect(open.container.querySelector('.docx-nav__toggle')).toBeNull();
    expect(open.container.querySelector('.docx-nav__close')).not.toBeNull();
  });

  test('renders the three tabs, with headings selected first', () => {
    const { container } = render(
      <DocxEditorRoot>
        <DocxEditorNavigation defaultOpen />
      </DocxEditorRoot>
    );
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Headings', 'Find', 'Bookmarks']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('false');
  });

  test('stays mounted and inert when closed, so a typed query survives a reopen', () => {
    const { container } = render(
      <DocxEditorRoot>
        <DocxEditorNavigation />
      </DocxEditorRoot>
    );
    const shell = container.querySelector('.docx-nav__panel-shell');
    // Present in the DOM (state survives) but out of the tab order and hit testing.
    expect(shell).not.toBeNull();
    expect(shell!.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('#docx-nav-panel-find')).not.toBeNull();
  });

  test('publishes no shift while it is closed', () => {
    const { container } = render(
      <DocxEditorRoot>
        <DocxEditorNavigation />
        <div className="docx-editor__scroll-container" />
      </DocxEditorRoot>
    );
    expect(container.querySelector('.docx-nav')?.getAttribute('data-open')).toBe('false');
  });

  test('a controlled pane reports its open state to the host', () => {
    const seen: boolean[] = [];
    const { container } = render(
      <DocxEditorRoot>
        <DocxEditorNavigation open={false} onOpenChange={(next) => seen.push(next)} />
      </DocxEditorRoot>
    );
    (container.querySelector('.docx-nav__toggle') as HTMLButtonElement).click();
    expect(seen).toEqual([true]);
    // Controlled: the pane does not move itself.
    expect(container.querySelector('.docx-nav')?.getAttribute('data-open')).toBe('false');
  });

  test('`<DocxEditor navigation={{...}}>` forwards pane props instead of forcing navigation={false}', () => {
    const seen: boolean[] = [];
    const { container } = render(
      <DocxEditor
        navigation={{ open: false, onOpenChange: (next) => seen.push(next), tab: 'find' }}
      />
    );
    expect(container.querySelector('.docx-nav')).not.toBeNull();
    expect(container.querySelector('.docx-nav')?.getAttribute('data-open')).toBe('false');
    expect(container.querySelector('#docx-nav-tab-find')?.getAttribute('aria-selected')).toBe(
      'true'
    );
    (container.querySelector('.docx-nav__toggle') as HTMLButtonElement).click();
    expect(seen).toEqual([true]);
    expect(container.querySelector('.docx-nav')?.getAttribute('data-open')).toBe('false');
  });

  test('navigation={false} removes the packaged pane', () => {
    const { container } = render(<DocxEditor navigation={false} />);
    expect(container.querySelector('.docx-nav')).toBeNull();
  });

  test('the find input is focused when the find tab is shown', () => {
    const { container } = render(
      <DocxEditorRoot>
        <DocxEditorNavigation open tab="find" />
      </DocxEditorRoot>
    );
    expect(document.activeElement).toBe(
      container.querySelector('#docx-nav-panel-find .docx-nav__search-input')
    );
  });

  test('switching to the find tab focuses the query input', () => {
    const { container } = render(
      <DocxEditorRoot>
        <DocxEditorNavigation defaultOpen />
      </DocxEditorRoot>
    );
    const input = container.querySelector('#docx-nav-panel-find .docx-nav__search-input');
    expect(document.activeElement).not.toBe(input);
    act(() => {
      fireEvent.click(container.querySelector('#docx-nav-tab-find')!);
    });
    expect(document.activeElement).toBe(input);
  });

  test('a part outside its compound root fails loudly rather than rendering nothing', () => {
    expect(() => render(<NavigationHeadings />)).toThrow(/DocxEditor.Navigation/);
  });
});
