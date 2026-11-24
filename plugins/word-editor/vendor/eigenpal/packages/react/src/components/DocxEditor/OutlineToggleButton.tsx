import { useTranslation } from '../../i18n';
import { Z_INDEX } from '../../styles/zIndex';
import { OUTLINE_BUTTON_LEFT_OFFSET } from '../DocumentOutline';
import { MaterialSymbol } from '../ui/Icons';

/**
 * Outline toggle — same reason as `CommentsSidebarToggle`: needs to render
 * inside `<LocaleProvider>` to see the user's `i18n` prop.
 */
export function OutlineToggleButton({
  onClick,
  topPx,
  scrollLeft = 0,
  leftOffset = OUTLINE_BUTTON_LEFT_OFFSET,
}: {
  onClick: () => void;
  topPx: number;
  /** Horizontal scroll offset of the editor — button slides with the doc. */
  scrollLeft?: number;
  /**
   * Left anchor (px) from the editor area's left edge. Defaults to
   * OUTLINE_BUTTON_LEFT_OFFSET; the host bumps it past the vertical ruler
   * when one is shown so the button doesn't render on top of it.
   */
  leftOffset?: number;
}) {
  const { t } = useTranslation();
  return (
    <button
      className="docx-outline-toggle"
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={t('editor.showDocumentOutline')}
      aria-label={t('editor.showDocumentOutline')}
      style={{
        position: 'absolute',
        // Anchor in the left gutter and track horizontal scroll so the
        // button doesn't pin to the viewport and overlay the doc. Visuals
        // (disc, ring, hover) live in editor.css `.docx-outline-toggle`.
        left: leftOffset - scrollLeft,
        top: topPx,
        zIndex: Z_INDEX.outline,
      }}
    >
      {/* Icon inherits the button's `color` (fill: currentColor). */}
      <MaterialSymbol name="format_list_bulleted" size={20} />
    </button>
  );
}
