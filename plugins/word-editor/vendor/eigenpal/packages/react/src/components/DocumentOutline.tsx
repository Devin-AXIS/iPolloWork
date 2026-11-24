import React, { useEffect, useRef, useState } from 'react';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { MaterialSymbol } from './ui/Icons';
import { useTranslation } from '../i18n';
import { hostWindowOf } from '@docx-editor.dev/core/editor';

/**
 * One heading of the engine's outline (`Editor.getOutline()`): text, level,
 * and the block id `Editor.scrollToBlock` accepts. Derived from the contract.
 */
export type OutlineHeading = ReturnType<Editor['getOutline']>[number];

// Outline panel geometry (px). Only the *_RESERVED_SPACE values leak out —
// the editor uses them to size the layout so the centered page never sits
// under the panel or the toggle button. The anchor matches the collapsed
// toggle's left offset so the back arrow lands where the toggle was (the
// panel reads as the toggle expanding in place).
export const OUTLINE_LEFT_OFFSET = 12;
const OUTLINE_WIDTH = 240;
const OUTLINE_PAGE_GAP = 16;
// Matches PagedEditor's VIEWPORT_PADDING_TOP so the panel header lines up
// with the page's top edge.
const OUTLINE_TOP_PADDING = 24;
export const OUTLINE_RESERVED_SPACE = OUTLINE_LEFT_OFFSET + OUTLINE_WIDTH + OUTLINE_PAGE_GAP;

// Toggle-button geometry (when the panel is collapsed): button anchor + disc
// box (36px) + gap before the page. The anchor sits in the left gutter roughly
// under the title-bar logo (Google-Docs placement), not pushed toward the page.
export const OUTLINE_BUTTON_LEFT_OFFSET = 12;
const OUTLINE_BUTTON_BOX = 36;
export const OUTLINE_BUTTON_RESERVED_SPACE =
  OUTLINE_BUTTON_LEFT_OFFSET + OUTLINE_BUTTON_BOX + OUTLINE_PAGE_GAP;

interface DocumentOutlineProps {
  headings: readonly OutlineHeading[];
  /** Called with the heading's block id — feed it to `Editor.scrollToBlock`. */
  onHeadingClick: (blockId: string) => void;
  onClose: () => void;
  topOffset?: number;
  /** Horizontal scroll offset of the editor — outline slides left with the doc. */
  scrollLeft?: number;
  /**
   * Left anchor (px) from the editor area's left edge. Defaults to
   * OUTLINE_LEFT_OFFSET; the host bumps it past the vertical ruler when one
   * is shown so the panel doesn't render on top of it.
   */
  leftOffset?: number;
}

export const DocumentOutline = React.memo(function DocumentOutline({
  headings,
  onHeadingClick,
  onClose,
  topOffset = 0,
  scrollLeft = 0,
  leftOffset = OUTLINE_LEFT_OFFSET,
}: DocumentOutlineProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);

  // Indent relative to the shallowest heading present, not the absolute level.
  // A doc whose top sections are Heading 2 (level 1, e.g. a memo with no H1)
  // should still left-align them at the base instead of carrying a phantom
  // first-level indent.
  const minLevel = headings.length ? Math.min(...headings.map((h) => h.level)) : 0;

  useEffect(() => {
    // Trigger slide-in on next frame
    hostWindowOf(navRef.current).requestAnimationFrame(() => setOpen(true));
  }, []);

  return (
    <nav
      ref={navRef}
      className="docx-outline-nav"
      role="navigation"
      aria-label={t('documentOutline.ariaLabel')}
      style={{
        position: 'absolute',
        top: topOffset,
        // Anchor to leftOffset, then slide left by the editor's horizontal
        // scroll so the panel tracks the doc instead of staying pinned to
        // the viewport.
        left: leftOffset - scrollLeft,
        bottom: 0,
        width: OUTLINE_WIDTH,
        paddingTop: OUTLINE_TOP_PADDING,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
        zIndex: 40,
        // Slide-in animation — translate fully off-screen left of its anchor.
        // Only `transform` transitions; horizontal-scroll tracking via `left`
        // is intentionally untransitioned so the panel keeps up with the doc.
        transform: open ? 'translateX(0)' : `translateX(-${leftOffset + OUTLINE_WIDTH}px)`,
        transition: 'transform 0.15s ease-out',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header — back arrow + title. No left padding so the back arrow sits
          at the nav anchor (= the collapsed toggle's position). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '16px 16px 12px 0',
        }}
      >
        <button
          onClick={onClose}
          aria-label={t('documentOutline.closeAriaLabel')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            color: 'var(--doc-text-muted)',
          }}
          title={t('documentOutline.closeTitle')}
        >
          <MaterialSymbol name="arrow_back" size={20} />
        </button>
        <span
          style={{
            fontWeight: 400,
            fontSize: 14,
            color: 'var(--doc-text)',
            letterSpacing: '0.01em',
          }}
        >
          {t('documentOutline.title')}
        </span>
      </div>

      {/* Heading list. Small left padding so items sit close to the left
          gutter (under the back arrow), not in a wide indent band. Per-level
          indent (level is 0-based: Heading 1 = 0) nests sub-headings. */}
      <div style={{ overflowY: 'auto', flex: 1, paddingLeft: 4 }}>
        {headings.length === 0 ? (
          <div
            style={{
              padding: '8px 16px',
              color: 'var(--doc-text-subtle)',
              fontSize: 13,
              lineHeight: '20px',
            }}
          >
            {t('documentOutline.noHeadings')}
          </div>
        ) : (
          headings.map((heading, index) => (
            <div
              key={`${heading.blockId}-${index}`}
              style={{
                marginLeft: (heading.level - minLevel) * 16,
              }}
            >
              <button
                className="docx-outline-heading-btn"
                onClick={() => onHeadingClick(heading.blockId)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '5px 8px',
                  fontSize: 13,
                  fontWeight: 400,
                  color: 'var(--doc-text)',
                  lineHeight: '18px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  borderRadius: 0,
                  letterSpacing: '0.01em',
                }}
                title={heading.text}
              >
                {heading.text}
              </button>
            </div>
          ))
        )}
      </div>
    </nav>
  );
});
