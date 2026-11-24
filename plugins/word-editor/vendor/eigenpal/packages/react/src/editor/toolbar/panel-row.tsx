import type { ReactNode } from 'react';
import { useToolbarPlacement } from './ToolbarGroup';

/**
 * True when a toolbar part draws its trigger as a "⋯" panel row: it renders in the panel and
 * shows its own default content. In the panel, a lone icon button beside a plain-text label
 * reads as disabled and leaves most of the row inert, so the whole row is the button.
 */
export function usePanelRow(asChild: boolean | undefined, children: unknown): boolean {
  return useToolbarPlacement() === 'panel' && !asChild && children === undefined;
}

/** The trigger class for a part, in the bar or as a panel row. */
export function triggerClassName(panelRow: boolean): string {
  return panelRow ? 'docx-toolbar__more-command' : 'docx-toolbar__button';
}

/** A panel row's content: the icon and label the panel's command rows show. */
export function PanelRowContent({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <>
      <span className="docx-toolbar__more-command-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="docx-toolbar__more-command-label">{label}</span>
    </>
  );
}
