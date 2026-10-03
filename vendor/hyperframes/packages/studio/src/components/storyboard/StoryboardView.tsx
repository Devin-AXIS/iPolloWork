import { useStoryboard } from "../../hooks/useStoryboard";
import { useProjectSignaturePoll } from "../../hooks/useProjectSignaturePoll";
import { useStudioI18n } from "../../i18n";
import { Button } from "../ui/Button";
import { StoryboardTable } from "./StoryboardTable";

export interface StoryboardViewProps {
  projectId: string;
}

/** The board and editable script share the same canonical project file, including creation. */
export function StoryboardView({ projectId }: StoryboardViewProps) {
  const { data, loading, error, reload } = useStoryboard(projectId);
  const { tx } = useStudioI18n();
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
  return (
    <StoryboardTable
      key={projectId}
      projectId={projectId}
      data={data}
      onSaved={reload}
    />
  );
}
