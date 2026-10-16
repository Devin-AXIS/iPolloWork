import { useEffect } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useStoryboard } from "../../hooks/useStoryboard";
import { useProjectSignaturePoll } from "../../hooks/useProjectSignaturePoll";
import { useStudioI18n } from "../../i18n";
import { usePanelLayoutContext } from "../../contexts/PanelLayoutContext";
import { Button, IconButton } from "../ui/Button";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@ipollowork/ui/tooltip";
import { StoryboardTable } from "./StoryboardTable";

export interface StoryboardViewProps {
  projectId: string;
  compact?: boolean;
}

/** The board and editable script share the same canonical project file, including creation. */
export function StoryboardView({ projectId, compact = false }: StoryboardViewProps) {
  const { data, loading, error, reload } = useStoryboard(projectId);
  const { tx } = useStudioI18n();
  const { scriptExpanded: expanded, setScriptExpanded: setExpanded } = usePanelLayoutContext();
  useEffect(() => () => setExpanded(false), [projectId, setExpanded]);
  useProjectSignaturePoll(projectId, data?.signature, reload);

  if (loading || error || !data) {
    return (
      <div className="flex-1 overflow-auto bg-[var(--hf-workspace-bg)] p-12 text-center text-sm text-[var(--hf-panel-text-3)]">
        <p role={error ? "alert" : "status"}>
          {error
            ? `${tx("Could not load storyboard.")} ${error}`
            : tx("Loading storyboard…")}
        </p>
        {error && (
          <Button
            className="mt-4"
            size="sm"
            variant="secondary"
            onClick={reload}
          >
            {tx("Retry")}
          </Button>
        )}
      </div>
    );
  }
  if (compact) return (
    <TooltipProvider delay={400}><section className="hf-script-sidebar flex h-full min-h-0 flex-col" data-expanded={expanded} aria-label={tx("Script table")}>
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <h2 className="text-ui-section-title">{tx("Script table")}</h2>
        <Tooltip>
          <TooltipTrigger render={<IconButton size="sm" data-testid="script-expand-table" icon={expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />} aria-label={tx(expanded ? "Collapse table" : "Expand table")} onClick={() => setExpanded(value => !value)} />} />
          <TooltipContent>{tx(expanded ? "Collapse table" : "Expand table")}</TooltipContent>
        </Tooltip>
      </div>
      <StoryboardTable key={projectId} projectId={projectId} data={data} onSaved={reload} compact={!expanded} />
    </section></TooltipProvider>
  );
  return (
    <StoryboardTable
      key={projectId}
      projectId={projectId}
      data={data}
      onSaved={reload}
    />
  );
}
