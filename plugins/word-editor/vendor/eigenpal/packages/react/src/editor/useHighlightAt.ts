// The text highlight under the pointer, for hover cards such as glossary definitions.
//
// One document-level pointer listener, read at most once per frame, plus scroll and document
// changes, which move marks under a pointer that stays still.

import { useEffect, useState } from 'react';
import type { HighlightHit, HighlightRange } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useNavigationViewportElement } from './navigation/navigation-layout';
import { hostDocumentOf, hostWindowOf, isElementNode } from '@docx-editor.dev/core/editor';

function sameHit(a: HighlightHit | null, b: HighlightHit | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.name === b.name &&
    a.index === b.index &&
    a.range === b.range &&
    a.active === b.active &&
    a.rect.left === b.rect.left &&
    a.rect.top === b.rect.top &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height
  );
}

/**
 * The topmost text highlight under the pointer, or `null`. Pass a set name to watch one set.
 * `R` is your range type, so fields you added to your ranges come back typed on `range`.
 *
 * @example
 * ```tsx
 * const hit = useHighlightAt<GlossaryRange>('glossary');
 * return hit ? <Tooltip anchor={hit.rect}>{hit.range.definition}</Tooltip> : null;
 * ```
 * @public
 */
export function useHighlightAt<R extends HighlightRange = HighlightRange>(
  name?: string
): HighlightHit<R> | null {
  const editor = useDocxEditor();
  const viewport = useNavigationViewportElement();
  const [hit, setHit] = useState<HighlightHit<R> | null>(null);

  useEffect(() => {
    if (!editor) {
      setHit(null);
      return undefined;
    }
    // The editor's own document and window: a pop-out window or an iframe is not the
    // script's, and a hidden opener stops its animation frames.
    const doc = hostDocumentOf(viewport);
    const view = hostWindowOf(viewport);
    let frame = 0;
    let point: { readonly x: number; readonly y: number } | null = null;
    const read = () => {
      frame = 0;
      const found = point
        ? (editor
            .getHighlightsAt<R>(point.x, point.y)
            .find((candidate) => name === undefined || candidate.name === name) ?? null)
        : null;
      setHit((previous) => (sameHit(previous, found) ? previous : found));
    };
    const schedule = () => {
      if (frame === 0) frame = view.requestAnimationFrame(read);
    };
    const onMove = (event: PointerEvent) => {
      // Only a pointer on a page: a menu, dialog, or tooltip over the text hides the mark.
      const target = event.target;
      const onPage = isElementNode(target) && target.closest('[data-page-index]') !== null;
      point = onPage ? { x: event.clientX, y: event.clientY } : null;
      schedule();
    };
    const onLeave = (event: PointerEvent) => {
      if (event.relatedTarget) return;
      point = null;
      schedule();
    };
    doc.addEventListener('pointermove', onMove, { passive: true });
    doc.addEventListener('pointerout', onLeave, { passive: true });
    doc.addEventListener('scroll', schedule, { passive: true, capture: true });
    const off = editor.on('change', schedule);
    return () => {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerout', onLeave);
      doc.removeEventListener('scroll', schedule, { capture: true });
      off();
      if (frame !== 0) view.cancelAnimationFrame(frame);
    };
  }, [editor, name, viewport]);

  return hit;
}
