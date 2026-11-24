/**
 * Hook for toolbar dropdowns that need position:fixed to escape overflow:auto/hidden ancestors.
 *
 * Returns refs and styles for a dropdown that positions itself below its trigger
 * using fixed coordinates (like MenuDropdown), so it isn't clipped by the toolbar's
 * overflow-x-auto container.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { CSSProperties, RefObject } from 'react';
import {
  hostDocumentOf,
  hostWindowOf,
  isElementNode,
  listenForOutsidePress,
} from '@docx-editor.dev/core/editor';

export interface UseFixedDropdownOptions {
  isOpen: boolean;
  onClose: () => void;
  /** 'left' aligns dropdown left edge to trigger, 'right' aligns right edge */
  align?: 'left' | 'right';
}

export interface UseFixedDropdownReturn {
  containerRef: RefObject<HTMLDivElement | null>;
  dropdownRef: RefObject<HTMLDivElement | null>;
  dropdownStyle: CSSProperties;
  handleMouseDown: (e: React.MouseEvent) => void;
}

/** Keep a fixed dropdown fully inside its own window's viewport with a small gutter. */
function clampToViewport(view: Window, top: number, left: number, width: number, height: number) {
  const gutter = 8;
  const maxLeft = Math.max(gutter, view.innerWidth - width - gutter);
  const maxTop = Math.max(gutter, view.innerHeight - height - gutter);
  return {
    top: Math.min(Math.max(gutter, top), maxTop),
    left: Math.min(Math.max(gutter, left), maxLeft),
  };
}

export function useFixedDropdown({
  isOpen,
  onClose,
  align = 'left',
}: UseFixedDropdownOptions): UseFixedDropdownReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Calculate position when opening
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (align === 'right') {
      // We need the dropdown width to right-align, but it's not rendered yet.
      // Use a rAF to measure after first paint.
      const view = hostWindowOf(containerRef.current);
      view.requestAnimationFrame(() => {
        if (dropdownRef.current) {
          const dropRect = dropdownRef.current.getBoundingClientRect();
          const next = clampToViewport(
            view,
            rect.bottom + 4,
            rect.right - dropRect.width,
            dropRect.width,
            dropRect.height
          );
          setPos(next);
        } else {
          setPos({ top: rect.bottom + 4, left: rect.left });
        }
      });
    } else {
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
  }, [isOpen, align]);

  // Close on outside click, escape, scroll
  useEffect(() => {
    if (!isOpen) return;

    // Opening often scrollIntoViews a clipped toolbar button; ignore that burst
    // so the menu doesn't immediately close.
    const ignoreScrollUntil = performance.now() + 150;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handleScroll = (e: Event) => {
      if (performance.now() < ignoreScrollUntil) return;

      // Ignore scrolls inside the dropdown's own scrollable list (e.g. the font
      // size presets). Only an ancestor/page scroll, which would detach this
      // fixed-positioned dropdown from its trigger, should close it.
      const target = e.target as Node | null;
      if (target && dropdownRef.current && dropdownRef.current.contains(target)) {
        return;
      }
      // Horizontal toolbar overflow scrolls to reveal a clipped trigger — that
      // must not dismiss the menu (table "More" sits at the right edge).
      if (
        isElementNode(target) &&
        target !== target.ownerDocument.documentElement &&
        target !== target.ownerDocument.body &&
        containerRef.current &&
        target.contains(containerRef.current)
      ) {
        return;
      }
      onClose();
    };

    // The trigger's own document and window: a pop-out window or an iframe is not the
    // script's.
    const doc = hostDocumentOf(containerRef.current);
    const win = hostWindowOf(containerRef.current);
    // A press inside the trigger or the menu keeps it open. Without both elements the
    // menu has nothing to stay open for, so the press closes it.
    const stopPress = listenForOutsidePress({
      popup: containerRef.current,
      contains: (node) =>
        !containerRef.current ||
        !dropdownRef.current ||
        containerRef.current.contains(node) ||
        dropdownRef.current.contains(node),
      close: () => onClose(),
    });
    doc.addEventListener('keydown', handleEscape);
    win.addEventListener('scroll', handleScroll, true);

    return () => {
      stopPress();
      doc.removeEventListener('keydown', handleEscape);
      win.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen, onClose]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const dropdownStyle: CSSProperties = {
    position: 'fixed',
    top: pos.top,
    left: pos.left,
    zIndex: 10000,
  };

  return { containerRef, dropdownRef, dropdownStyle, handleMouseDown };
}
