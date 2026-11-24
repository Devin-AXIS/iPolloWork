import type { CSSProperties } from 'react';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { RulerPageSetup, RulerTabStop } from '../ui/HorizontalRuler';
import { LocaleProvider } from '../../i18n';
import { cn } from '../../lib/utils';
import { ErrorBoundary, ErrorProvider } from '../ErrorBoundary';
import { HorizontalRuler, RULER_HEIGHT } from '../ui/HorizontalRuler';
import { VerticalRuler, RULER_WIDTH } from '../ui/VerticalRuler';
import type { ReactNode } from 'react';
import {
  DocumentOutline,
  OUTLINE_LEFT_OFFSET,
  OUTLINE_BUTTON_LEFT_OFFSET,
} from '../DocumentOutline';
import { OutlineToggleButton } from './OutlineToggleButton';
import { PageIndicator } from './PageIndicator';
import { SIDEBAR_DOCUMENT_SHIFT } from '../sidebar/constants';
import { Z_INDEX } from '../../styles/zIndex';
import { ScopedByAncestorContext } from '../../editor/scope-context';
import type { OutlineHeading } from '../DocumentOutline';

/** One tracked change as the engine reports it (`Editor.getTrackedChanges()`). */
type TrackedChangeSummary = ReturnType<Editor['getTrackedChanges']>[number];

interface ScrollPageInfo {
  currentPage: number;
  totalPages: number;
  visible: boolean;
}

interface HorizontalRulerProps {
  pageSetup: RulerPageSetup | undefined;
  zoom: number;
  unit: 'inch' | 'cm';
  editable: boolean;
  onLeftMarginChange: (marginTwips: number) => void;
  onRightMarginChange: (marginTwips: number) => void;
  tabMarks: RulerTabStop[] | null;
  onTabMarkRemove: (positionTwips: number) => void;
}

interface VerticalRulerProps {
  pageSetup: RulerPageSetup | undefined;
  zoom: number;
  unit: 'inch' | 'cm';
  editable: boolean;
  onTopMarginChange: (marginTwips: number) => void;
  onBottomMarginChange: (marginTwips: number) => void;
}

interface OutlineProps {
  headings: readonly OutlineHeading[];
  onHeadingClick: (blockId: string) => void;
  onClose: () => void;
  topOffset: number;
  scrollLeft: number;
}

/**
 * Outer chrome of the editor: i18n + error provider wrappers, the
 * scroll container with its background-click handler, horizontal and
 * vertical rulers, the floating page indicator, document outline panel
 * + toggle button, plus slots for the toolbar, paged-area body,
 * overlays, dialogs, and hidden file inputs.
 *
 * This shell renders NO review highlight of its own. Marking the active
 * comment or tracked change belongs to the engine, which paints
 * `docx-comment-band--active` and `docx-revision-band--active` for the item
 * the caret is in, or for the one an `Editor.setActiveReviewItem` pin names
 * instead. One source for which item is active, so a host sidebar and the
 * painted document cannot disagree about it.
 *
 * @deprecated Use `<DocxEditor>` from the composition layer instead.
 */
export function DocxEditorShell({
  i18n,
  isDark,
  onEditorError,
  containerRef,
  scrollContainerRef,
  editorContentRef,
  className,
  containerStyle,
  mainContentStyle,
  editorContainerStyle,
  showRuler,
  readOnlyProp,
  showOutline,
  showOutlineButton,
  sidebarOpen,
  minLayoutWidth,
  toolbarHeight,
  editorScrollLeft,
  onScrollContainerMouseDown,
  onEditorBgMouseDown,
  onEditorContextMenu,
  horizontalRulerProps,
  verticalRulerProps,
  outlineProps,
  onToggleOutline,
  scrollPageInfo,
  toolbar,
  pagedArea,
  overlays,
  dialogs,
  fileInputs,
}: {
  i18n: React.ComponentProps<typeof LocaleProvider>['i18n'];
  isDark?: boolean;
  onEditorError: (error: Error) => void;
  containerRef: React.Ref<HTMLDivElement>;
  scrollContainerRef: React.Ref<HTMLDivElement>;
  editorContentRef: React.Ref<HTMLDivElement>;
  className: string | undefined;
  containerStyle: CSSProperties;
  mainContentStyle: CSSProperties;
  editorContainerStyle: CSSProperties;
  showRuler: boolean;
  readOnlyProp: boolean | undefined;
  showOutline: boolean;
  showOutlineButton: boolean;
  sidebarOpen: boolean;
  minLayoutWidth: number;
  toolbarHeight: number;
  editorScrollLeft: number;
  /**
   * @deprecated Ignored. Mark the active comment or tracked change with
   * `Editor.setActiveReviewItem`, which paints the band the engine draws.
   */
  expandedSidebarItem?: string | null;
  /**
   * @deprecated Ignored. Read tracked changes with `Editor.getTrackedChanges`;
   * activation goes through `Editor.setActiveReviewItem`. Its keys are
   * `` `${kind}-${id}` ``, so a tracked change is `revision-<id>`, not the
   * `tc-<id>` this shell once took.
   */
  trackedChanges?: readonly TrackedChangeSummary[];
  onScrollContainerMouseDown: (e: React.MouseEvent) => void;
  onEditorBgMouseDown: (e: React.MouseEvent) => void;
  onEditorContextMenu: (e: React.MouseEvent) => void;
  horizontalRulerProps: HorizontalRulerProps;
  verticalRulerProps: VerticalRulerProps;
  outlineProps: OutlineProps;
  onToggleOutline: () => void;
  scrollPageInfo: ScrollPageInfo;
  toolbar: ReactNode;
  pagedArea: ReactNode;
  overlays: ReactNode;
  dialogs: ReactNode;
  fileInputs: ReactNode;
}) {
  // The vertical ruler renders only when editable; the outline insets must
  // gate on the same condition or they clear a ruler that is not on screen.
  const showVerticalRuler = showRuler && !readOnlyProp;
  return (
    // The container below carries the scope class, so chrome parts inside it
    // must not add their own — see editor/scope-context.ts.
    <ScopedByAncestorContext.Provider value={true}>
      <LocaleProvider i18n={i18n}>
        <ErrorProvider>
          <ErrorBoundary onError={onEditorError}>
            <div
              ref={containerRef}
              className={cn('docx-editor', isDark && 'dark', className)}
              style={containerStyle}
              data-testid="docx-editor"
            >
              <div style={mainContentStyle}>
                <div
                  style={{
                    position: 'relative',
                    flex: 1,
                    minHeight: 0,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {toolbar}

                  <div
                    ref={scrollContainerRef}
                    className="docx-editor__scroll-container"
                    style={editorContainerStyle}
                    onMouseDown={onScrollContainerMouseDown}
                  >
                    {/* Horizontal ruler — sticky-top, scrolls horizontally with
                      the doc. paddingRight biases the centered ruler so it
                      tracks the page when the comments sidebar shifts the
                      page left. Outline doesn't bias; the page stays centered
                      until minLayoutWidth forces horizontal scroll. No
                      justify-center: the ruler centers itself clamp-safely
                      (see HorizontalRuler's base style), so if it outgrows
                      minLayoutWidth it pins to the start edge like the page
                      instead of pushing its left inches out of reach. */}
                    {showRuler && (
                      <div
                        className="flex py-1 flex-shrink-0 bg-doc-bg"
                        style={{
                          position: 'sticky',
                          top: 0,
                          // Must sit above the inline HF editor so the ruler stays readable.
                          zIndex: Z_INDEX.ruler,
                          paddingLeft: 20,
                          paddingRight: 20 + (sidebarOpen ? SIDEBAR_DOCUMENT_SHIFT * 2 : 0),
                          minWidth: minLayoutWidth,
                          transition: 'padding 0.2s ease',
                        }}
                      >
                        <HorizontalRuler {...horizontalRulerProps} />
                      </div>
                    )}
                    <div
                      style={{
                        display: 'flex',
                        flex: 1,
                        minHeight: 0,
                        position: 'relative',
                        minWidth: minLayoutWidth,
                      }}
                    >
                      <div
                        ref={editorContentRef}
                        style={{
                          position: 'relative',
                          flex: 1,
                          minWidth: 0,
                        }}
                        onMouseDown={onEditorBgMouseDown}
                        onContextMenu={onEditorContextMenu}
                      >
                        {/* Vertical ruler — sits at the editor content's left
                          edge so it scrolls horizontally with the page. */}
                        {showVerticalRuler && (
                          <div
                            style={{
                              position: 'absolute',
                              left: 0,
                              top: 0,
                              // Above the inline HF editor so it stays readable on horizontal scroll.
                              zIndex: Z_INDEX.ruler,
                              // Must match the space above the first page in
                              // editor.css: `.docx-editor-one-surface__viewport`
                              // padding (24) + `.docx-paginated-surface` top
                              // margin (24).
                              paddingTop: 48,
                            }}
                          >
                            <VerticalRuler {...verticalRulerProps} />
                          </div>
                        )}
                        {pagedArea}
                      </div>
                    </div>
                  </div>

                  {scrollPageInfo.totalPages > 1 && (
                    <PageIndicator
                      currentPage={scrollPageInfo.currentPage}
                      totalPages={scrollPageInfo.totalPages}
                      visible={scrollPageInfo.visible}
                    />
                  )}

                  {/* When the vertical ruler is shown it overlays the editor's
                    left edge (left:0, width RULER_WIDTH); inset the outline
                    toggle/panel past it so they don't render on top. */}
                  {showOutline && (
                    <DocumentOutline
                      {...outlineProps}
                      leftOffset={OUTLINE_LEFT_OFFSET + (showVerticalRuler ? RULER_WIDTH : 0)}
                    />
                  )}

                  {showOutlineButton && !showOutline && (
                    <OutlineToggleButton
                      onClick={onToggleOutline}
                      // Aligns with the page top: toolbar + horizontal ruler row
                      // (RULER_HEIGHT + 8 py-1 padding) + viewport padding (24)
                      // + first-page top margin (24), per editor.css.
                      topPx={toolbarHeight + (showRuler ? RULER_HEIGHT + 8 : 0) + 48}
                      scrollLeft={editorScrollLeft}
                      leftOffset={
                        OUTLINE_BUTTON_LEFT_OFFSET + (showVerticalRuler ? RULER_WIDTH : 0)
                      }
                    />
                  )}
                </div>
              </div>

              {overlays}
              {dialogs}
              {fileInputs}
            </div>
          </ErrorBoundary>
        </ErrorProvider>
      </LocaleProvider>
    </ScopedByAncestorContext.Provider>
  );
}
