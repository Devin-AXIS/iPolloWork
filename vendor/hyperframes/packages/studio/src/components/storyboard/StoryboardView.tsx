import { FileText, Sparkle } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useStoryboard } from "../../hooks/useStoryboard";
import { useProjectSignaturePoll } from "../../hooks/useProjectSignaturePoll";
import { Button } from "../ui/Button";
import { StoryboardLoaded } from "./StoryboardLoaded";
import { useStudioI18n } from "../../i18n";

export interface StoryboardViewProps {
  projectId: string;
  /** Select a composition in the timeline (used by the frame focus "Open in Preview"). */
  onSelectComposition: (path: string) => void;
}

/**
 * Top-level storyboard stage. Replaces the timeline/preview when the view mode
 * is `storyboard`. Handles the load states here; once a storyboard exists,
 * {@link StoryboardLoaded} owns the Board ↔ Source experience.
 */
// fallow-ignore-next-line complexity
export function StoryboardView({ projectId, onSelectComposition }: StoryboardViewProps) {
  const { data, loading, error, reload } = useStoryboard(projectId);
  // Keep the board current while an agent writes to the project: when the
  // project signature moves past the one `data` was loaded with, refetch. Also
  // upgrades the empty state the moment STORYBOARD.md lands on disk.
  useProjectSignaturePoll(projectId, data?.signature, reload);

  if (loading) return <StoryboardFrame>{<Message>Loading storyboard…</Message>}</StoryboardFrame>;
  if (error) {
    return (
      <StoryboardFrame>
        <Message tone="error">Couldn’t load the storyboard: {error}</Message>
        <div className="flex justify-center">
          <Button size="sm" variant="secondary" onClick={reload}>
            Retry
          </Button>
        </div>
      </StoryboardFrame>
    );
  }
  if (!data) return <StoryboardFrame>{null}</StoryboardFrame>;
  if (!data.exists) {
    return (
      <StoryboardFrame>
        <EmptyState path={data.path} />
      </StoryboardFrame>
    );
  }

  return (
    <StoryboardLoaded
      projectId={projectId}
      data={data}
      reload={reload}
      onSelectComposition={onSelectComposition}
    />
  );
}

function StoryboardFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-studio-bg text-studio-text">
      <div className="mx-auto max-w-[1400px] px-8 py-8">{children}</div>
    </div>
  );
}

function Message({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return (
    <div
      className={`px-6 py-12 text-center text-sm ${
        tone === "error" ? "text-red-400" : "text-studio-muted"
      }`}
    >
      {children}
    </div>
  );
}

function EmptyState({ path }: { path: string }) {
  const { tx } = useStudioI18n();

  return (
    <div className="mx-auto flex min-h-[420px] max-w-lg flex-col items-center justify-center text-center">
      <div className="relative grid size-14 place-items-center rounded-2xl border border-studio-border bg-studio-surface text-studio-muted shadow-lg">
        <FileText size={24} weight="duotone" />
        <Sparkle className="absolute -right-1 -top-1 text-studio-text" size={15} weight="fill" />
      </div>
      <h2 className="mt-5 text-base font-semibold tracking-[-0.01em] text-studio-text">{tx("Script is not ready yet")}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-studio-muted">
        {tx("AI first structures the brief and references, then writes the editable scene table here. Video generation starts only after you confirm it.")}
      </p>
      <code className="mt-4 rounded-md border border-studio-border bg-studio-surface px-2 py-1 text-[11px] text-studio-muted">{path}</code>
    </div>
  );
}
