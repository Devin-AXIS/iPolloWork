// Keeps the menu bar's "⋯" panel inside the viewport, with the toolbar's placement rule.

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { toolbarPanelPlacement } from '@docx-editor.dev/core/editor';

/**
 * The inline style that clamps an open panel to the viewport, or undefined while it is
 * closed. The panel is positioned against the trigger's parent, so `left` is in its
 * coordinates.
 */
export function useMenuPanelPlacement(
  active: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined);
  useLayoutEffect(() => {
    if (!active) {
      setStyle(undefined);
      return undefined;
    }
    const place = (): void => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      const root = trigger?.parentElement;
      const view = trigger?.ownerDocument.defaultView;
      if (!trigger || !panel || !root || !view) return;
      const rect = trigger.getBoundingClientRect();
      const next = toolbarPanelPlacement({
        triggerLeft: rect.left,
        triggerRight: rect.right,
        panelWidth: panel.offsetWidth,
        viewportWidth: view.innerWidth,
      });
      const left = next.left - root.getBoundingClientRect().left;
      // Every resize event lands here; an unchanged placement keeps the same object.
      setStyle((current) =>
        current?.left === left && current.maxInlineSize === next.maxWidth
          ? current
          : { left, right: 'auto', maxInlineSize: next.maxWidth }
      );
    };
    place();
    const view = triggerRef.current?.ownerDocument.defaultView;
    view?.addEventListener('resize', place);
    return () => view?.removeEventListener('resize', place);
  }, [active, panelRef, triggerRef]);
  return style;
}
