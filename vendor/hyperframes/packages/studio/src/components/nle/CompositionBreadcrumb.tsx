import type { TimelineElement } from "../../player/store/playerStore";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { trackStudioEvent } from "../../utils/studioTelemetry";
import { useStudioI18n } from "../../i18n";

export interface CompositionLevel {
  /** Unique id — "master" or composition file path */
  id: string;
  /** Display label — "Master" or filename without extension */
  label: string;
  /** Preview URL for this composition level */
  previewUrl: string;
  /** Inline scopes share the current file and global runtime clock. */
  inlineTarget?: TimelineElement;
  /** Parent-local playhead to restore when returning from a child. */
  seekTime?: number;
  /** Child-local source time = offset + (parent time - start) * rate. */
  parentTiming?: { start: number; offset: number; rate: number };
}

interface CompositionBreadcrumbProps {
  stack: CompositionLevel[];
  onNavigate: (index: number) => void;
}

export function CompositionBreadcrumb({ stack, onNavigate }: CompositionBreadcrumbProps) {
  const { tx } = useStudioI18n();


  return (
    <nav
      aria-label={tx("Composition navigation")}
      className="hf-timeline-breadcrumb flex h-full min-w-0 flex-1 items-center gap-1 text-ui-meta"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {/* Back button — always goes to parent */}
      {stack.length > 1 && <button
        type="button"
        onClick={() => {
          trackStudioEvent("navigation", {
            action: "back",
            target: stack[stack.length - 2]?.label,
          });
          onNavigate(stack.length - 2);
        }}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-panel-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent"
        title={tx("Back (Esc, or double-click empty timeline)")}
        aria-label={tx("Back to parent composition")}
      >
        <ArrowLeft size={14} strokeWidth={2.5} />
      </button>}

      {/* Breadcrumb path */}
      {stack.map((level, i) => {
        const isLast = i === stack.length - 1;
        return (
          <span key={level.id} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight size={10} className="shrink-0 text-muted-foreground" />}
            {isLast ? (
              <span aria-current="page" className="truncate text-ui-control font-semibold text-foreground">{i === 0 ? tx("Total timeline") : `${tx("Scene editing")} · ${level.label}`}</span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  trackStudioEvent("navigation", { action: "breadcrumb", target: level.label });
                  onNavigate(i);
                }}
                className="max-w-[110px] truncate text-ui-meta text-muted-foreground transition-colors hover:text-foreground"
              >
                {i === 0 ? tx("Total timeline") : level.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
