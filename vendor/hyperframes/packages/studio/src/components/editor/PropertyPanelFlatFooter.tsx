import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { useStudioI18n } from "../../i18n";

export function PropertyPanelFlatFooter({
  recordingState,
  recordingDuration,
  onToggleRecording,
}: {
  recordingState?: "idle" | "recording" | "preview";
  recordingDuration?: number;
  onToggleRecording?: () => void;
}) {
  const track = useTrackDesignInput();
  const { tx } = useStudioI18n();
  const recording = recordingState === "recording";
  const recordTitle = tx(recording
    ? `Stop recording ${(recordingDuration ?? 0).toFixed(1)}s`
    : "Record gesture (R)");

  if (!onToggleRecording) return null;

  return (
    // No border-t here: every possible element immediately above this footer
    // in the new fixed-headers + scrollable-open-section layout (a collapsed
    // FlatGroupHeader, or the open group's scrollable body wrapper) already
    // draws its own border-b in normal document flow — nothing here is
    // `position: sticky` anymore, so there's no rounding seam to seal (see
    // p11-scrollable-open-section-report.md).
    <div className="flex items-center justify-end bg-panel-bg px-4 py-[11px]">
      <button
        type="button"
        data-flat-footer-record="true"
        aria-label={recordTitle}
        title={recordTitle}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          track("button", "Gesture recording");
          onToggleRecording();
        }}
        className={recording ? "text-panel-danger animate-pulse" : "text-panel-danger"}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          {recording ? (
            <rect x="2" y="2" width="10" height="10" rx="1.5" />
          ) : (
            <circle cx="7" cy="7" r="6" />
          )}
        </svg>
      </button>
    </div>
  );
}
