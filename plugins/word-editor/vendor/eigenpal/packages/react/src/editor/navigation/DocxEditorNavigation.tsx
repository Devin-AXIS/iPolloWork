import type { DocxEditorChildren } from '../../docx-editor-children';
// The navigation pane: `DocxEditor.Navigation`.
//
// `<DocxEditor.Navigation />` on its own is the whole thing — a collapsed disc button that
// expands into a Headings/Find/Go to pane over the document's left gutter. Children replace the
// default composition part by part, and the three hooks behind it (`useNavigationPane`,
// `useDocumentOutline`, `useDocumentSearch`) are the escape hatch for a pane that shares
// none of this markup.
//
// THE PANE FLOATS; IT DOES NOT DOCK. It is absolutely positioned over the gutter to the
// left of the centred page, so opening it moves nothing as long as the gutter is wide
// enough to hold it. Only when the window is too narrow does it publish a shift, and only
// as much as it needs — see `navigation-geometry.ts`. That is the difference between the
// document sitting still and the document lurching sideways every time you open the pane.
//
// It stays MOUNTED when closed (width animates to zero, `inert` and `visibility` take it
// out of the tab order and hit testing), so a typed query and a scrolled heading list
// survive a close and reopen.
//
// WHERE IT MAY SIT. Beside `DocxEditor.Viewport` in a positioned box (the packaged frame),
// or as a direct child of the Viewport itself. The Viewport is the scroller, so a pane in it
// would scroll away with the pages; the stylesheet makes that pane sticky instead, and this
// component publishes the viewport's size for it (see `useNavigationFocus`).
//
// KEYBOARD. Ctrl/Cmd+F opens the pane on Find and Ctrl+G (Cmd+Option+G on macOS) on Go to,
// while focus is in this editor. Opening moves focus into the pane, and Escape or the close
// arrow returns it to whatever opened it. The `openGoTo` editor command opens Go to too.

import { useEffect, useMemo, useRef } from 'react';
import { useDocxEditor } from '../context';
import { NavigationGoTo } from './parts-goto';
import type { CSSProperties, ReactElement } from 'react';
import { useFormControlTranslate } from '../form-control-translate';
import { NavigationContext } from './navigation-context';
import {
  NAVIGATION_PANE_INSET,
  NAVIGATION_PANE_WIDTH,
  navigationPaneReservation,
} from './navigation-geometry';
import { useDocumentOutline } from './useDocumentOutline';
import { useDocumentSearch, type DocumentSearchHighlight } from './useDocumentSearch';
import { useNavigationFocus } from './useNavigationFocus';
import { useNavigationPane, type UseNavigationPaneOptions } from './useNavigationPane';
import type { NavigationPartProps } from './parts';
import {
  NavigationClose,
  NavigationFind,
  NavigationHeader,
  NavigationHeadings,
  NavigationTab,
  NavigationTabs,
  NavigationTitle,
  NavigationToggle,
} from './parts';
import { useChromeScopeClassName } from '../color-mode-context';
import { useChromeDir } from '../../i18n';

/** Props for `DocxEditor.Navigation`. @public */
export interface DocxEditorNavigationProps extends UseNavigationPaneOptions {
  /**
   * Label resolver. Defaults to the `translate` given to `DocxEditor.Root`, and for keys it
   * leaves unresolved, to the active `LocaleContext` catalogue (bundled English unless a
   * provider swapped it).
   */
  t?: (key: string, params?: Record<string, string | number>) => string;
  /**
   * The collapsed disc button. `false` removes it; an OBJECT is props for the packaged one,
   * so a host can give it a class without restyling the library's.
   *
   * It is a prop rather than something you compose through `children` because the disc is
   * rendered OUTSIDE the panel: the panel is `inert` while the pane is shut, which is
   * exactly when the disc has to be clickable.
   */
  toggle?: boolean | NavigationPartProps;
  /**
   * Which Find matches to highlight while the Find tab is open: `'all'` (default),
   * `'active'`, or `'none'`. The pane stops requesting highlights when it closes or leaves the
   * tab; another `useDocumentSearch` consumer can still request them.
   */
  searchHighlight?: DocumentSearchHighlight;
  /**
   * Whether Ctrl+F (Cmd+F on macOS) opens the pane on the Find tab. Defaults to `true`. The
   * shortcut applies only while focus is in this editor, so the rest of the page keeps the
   * browser's own search. Set `false` to leave the shortcut to the browser everywhere.
   */
  findShortcut?: boolean;
  /**
   * Whether Ctrl+G (Cmd+Option+G on macOS) opens the pane on the Go to tab. Defaults to
   * `true`, and applies only while focus is in this editor. The `openGoTo` editor command
   * opens the tab either way.
   */
  goToShortcut?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Replaces the default composition (header, tabs, both panels). */
  children?: DocxEditorChildren;
}

/**
 * The document navigation pane — headings and find — over the left gutter.
 *
 * @public
 */
export function DocxEditorNavigation(props: DocxEditorNavigationProps): ReactElement {
  // Skip the scope class when the packaged wrapper already carries it.
  const scopeClassName = useChromeScopeClassName();
  const chromeDir = useChromeDir();
  const {
    t: hostT,
    toggle = true,
    searchHighlight = 'all',
    findShortcut = true,
    goToShortcut = true,
    className,
    style,
    children,
    ...paneOptions
  } = props;

  const pane = useNavigationPane(paneOptions);
  const outline = useDocumentOutline();
  // Matches are marked only while the Find tab is on screen.
  const highlight = pane.open && pane.tab === 'find' ? searchHighlight : 'none';
  const search = useDocumentSearch({ highlight });

  // The host's resolver, else the one `DocxEditor.Root` was given, else the active
  // catalogue. A host that passed `translate` only to Root used to get an English pane.
  // The cast bridges the two signatures — `TFunction` is keyed by the union derived from
  // `en.json`, the prop takes a plain string so a host can supply any resolver — and every
  // key this subtree passes is a real catalogue key.
  const rootT = useFormControlTranslate();
  const t = useMemo(
    () =>
      hostT ??
      ((key: string, params?: Record<string, string | number>) =>
        rootT(key as Parameters<typeof rootT>[0], params)),
    [hostT, rootT]
  );

  const focus = useNavigationFocus(pane, findShortcut, goToShortcut);
  const value = useMemo(
    () => ({ pane, outline, search, t, intents: focus.intents, findShortcut, goToShortcut }),
    [pane, outline, search, t, focus.intents, findShortcut, goToShortcut]
  );

  // The `openGoTo` command opens this pane's Go to tab.
  const editor = useDocxEditor();
  const intentsRef = useRef(focus.intents);
  intentsRef.current = focus.intents;
  // One registration for the pane's life: a prop change must not push it back on top of a
  // host's own Go To UI, so the shortcut flag is read when the chord arrives.
  const goToShortcutRef = useRef(goToShortcut);
  goToShortcutRef.current = goToShortcut;
  useEffect(() => {
    if (!editor) return undefined;
    return editor.setGoToChrome({
      onRequest: () => intentsRef.current.openTab('goto'),
      get shortcut() {
        return goToShortcutRef.current;
      },
    });
  }, [editor]);

  const width = props.paneWidth ?? NAVIGATION_PANE_WIDTH;

  return (
    <NavigationContext.Provider value={value}>
      <div
        ref={focus.rootRef}
        className={`${scopeClassName}docx-nav${pane.open ? ' docx-nav--open' : ''}${pane.overlay ? ' docx-nav--overlay' : ''}${className ? ` ${className}` : ''}`}
        data-open={pane.open ? 'true' : 'false'}
        dir={chromeDir}
        onKeyDown={focus.onKeyDown}
        style={
          {
            // Numbers this component owns, not file data: safe as computed inline values.
            '--docx-nav-width': `${width}px`,
            '--docx-nav-inset': `${NAVIGATION_PANE_INSET}px`,
            '--docx-nav-reservation': `${navigationPaneReservation(width)}px`,
            ...style,
          } as CSSProperties
        }
      >
        {toggle !== false && !pane.open && (
          <NavigationToggle {...(typeof toggle === 'object' ? toggle : {})} />
        )}
        <aside
          className="docx-nav__panel-shell"
          aria-label={value.t('navigation.ariaLabel')}
          // Closed but mounted: `inert` removes it from tab order and hit testing without
          // unmounting, so the query and scroll position survive a close/reopen.
          inert={!pane.open}
        >
          {children ?? (
            <>
              <NavigationHeader />
              <NavigationTabs />
              <NavigationHeadings />
              <NavigationFind />
              <NavigationGoTo />
            </>
          )}
        </aside>
      </div>
    </NavigationContext.Provider>
  );
}

/**
 * `DocxEditor.Navigation` with its parts attached as statics.
 *
 * @public
 */
export interface DocxEditorNavigationNamespace {
  (props: DocxEditorNavigationProps): ReactElement;
  readonly Header: typeof NavigationHeader;
  readonly Close: typeof NavigationClose;
  readonly Title: typeof NavigationTitle;
  readonly Tabs: typeof NavigationTabs;
  readonly Tab: typeof NavigationTab;
  readonly Headings: typeof NavigationHeadings;
  readonly Find: typeof NavigationFind;
  readonly GoTo: typeof NavigationGoTo;
  readonly Toggle: typeof NavigationToggle;
}

export const Navigation: DocxEditorNavigationNamespace = Object.assign(DocxEditorNavigation, {
  Header: NavigationHeader,
  Close: NavigationClose,
  Title: NavigationTitle,
  Tabs: NavigationTabs,
  Tab: NavigationTab,
  Headings: NavigationHeadings,
  Find: NavigationFind,
  GoTo: NavigationGoTo,
  Toggle: NavigationToggle,
});
