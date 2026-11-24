import { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useTranslation } from '../i18n';
import { useDocxEditor } from './context';
import { useNavigationViewportElement } from './navigation/navigation-layout';
import { useEditorState } from './useEditorState';
import { useChromeDark, useChromeScopeClassName } from './color-mode-context';
import { useViewportOverlayHost } from './viewport-context';
import { hostWindowOf } from '@docx-editor.dev/core/editor';

const HIDE_DELAY_MS = 600;
// No count while a document opens: its layout is still partial, so a total would be wrong.
const selectTotalPages = (snapshot: EditorSnapshot): number =>
  snapshot.isOpening === true ? 0 : snapshot.page.total;

/** Internal bridge from the batteries-included editor's `t` prop to this composition part. */
export const PageNumberTranslationContext = createContext<((key: string) => string) | null>(null);

/** Props for `DocxEditor.PageNumber`. @public */
export interface DocxEditorPageNumberProps {
  /** Appended after the default page-number classes. */
  className?: string;
  /** Inline presentation overrides for the indicator element. */
  style?: CSSProperties;
}

/**
 * Floating localized page readout for the active `DocxEditor.Viewport`.
 *
 * It appears while a multi-page document scrolls and fades after 600 ms of inactivity. It is
 * positioned `absolute` against the nearest positioned ancestor, so give the element that holds
 * the viewport `position: relative`.
 *
 * Place it as a sibling of the viewport or inside it. Inside the viewport, it renders into the
 * viewport's parent element, so it stays in view while the pages scroll.
 *
 * @example
 * ```tsx
 * <div style={{ position: 'relative', height: '100%' }}>
 *   <DocxEditor.Viewport>
 *     <DocxEditor.Content />
 *   </DocxEditor.Viewport>
 *   <DocxEditor.PageNumber />
 * </div>
 * ```
 *
 * @public
 */
export function DocxEditorPageNumber({ className, style }: DocxEditorPageNumberProps) {
  const ancestorScope = useChromeScopeClassName();
  const dark = useChromeDark();
  const editor = useDocxEditor();
  const viewport = useNavigationViewportElement();
  // Inside the scroll container, an absolute overlay scrolls away with the pages.
  const { inside, host, hostScoped } = useViewportOverlayHost(viewport);
  const total = useEditorState(selectTotalPages);
  const { t } = useTranslation();
  const translate = useContext(PageNumberTranslationContext);
  const [current, setCurrent] = useState(1);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    if (!editor || !viewport || total <= 1) return undefined;
    setCurrent(editor.getCurrentPage('viewport'));
    // The viewport's own window: a hidden opener throttles its timers.
    const win = hostWindowOf(viewport);
    let hideTimer: number | null = null;
    const onScroll = () => {
      setCurrent(editor.getCurrentPage('viewport'));
      setVisible(true);
      if (hideTimer !== null) win.clearTimeout(hideTimer);
      hideTimer = win.setTimeout(() => setVisible(false), HIDE_DELAY_MS);
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      if (hideTimer !== null) win.clearTimeout(hideTimer);
    };
  }, [editor, total, viewport]);

  if (total <= 1) return null;
  // The viewport scoped everything inside it; its parent may not be scoped.
  const scopeClassName = host
    ? hostScoped
      ? ''
      : `docx-editor ${dark ? 'dark ' : ''}`
    : ancestorScope;
  const label = translate
    ? translate('viewer.pageIndicator')
        .replace(/\{current\}/g, String(current))
        .replace(/\{total\}/g, String(total))
    : t('viewer.pageIndicator', { current, total });
  const chip = (
    <div
      className={`${scopeClassName}docx-editor-shell__page-indicator-chip docx-editor__page-number${
        className ? ` ${className}` : ''
      }`}
      style={style}
      data-visible={visible ? 'true' : 'false'}
      role="status"
      aria-live="polite"
    >
      {label}
    </div>
  );
  if (!inside) return chip;
  // Before the viewport mounts its parent is unknown; render nothing until it is.
  return host ? createPortal(chip, host) : null;
}
