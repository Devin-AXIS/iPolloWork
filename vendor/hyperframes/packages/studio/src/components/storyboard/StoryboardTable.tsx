import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  GripVertical,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import {
  appendStoryboardFrame,
  moveStoryboardFrame,
  parseStoryboard,
  removeStoryboardFrame,
  setFrameField,
  setFrameTitle,
  setFrameVoiceSelection,
  setFrameVoiceover,
  setStoryboardGlobal,
} from "@hyperframes/core/storyboard";
import { useFileManagerContext } from "../../contexts/FileManagerContext";
import { useViewMode } from "../../contexts/ViewModeContext";
import { useBlockCatalog } from "../../hooks/useBlockCatalog";
import type { StoryboardResponse } from "../../hooks/useStoryboard";
import { useStudioI18n } from "../../i18n";
import { Button } from "../ui/Button";
import { FramePoster } from "./FramePoster";
import { StoryboardTableLayout } from "./StoryboardTableLayout";
import { StoryboardAsset } from "./StoryboardAsset";
import { StoryboardGlobalSettings } from "./StoryboardGlobalSettings";
import { StoryboardCamera } from "./StoryboardCamera";
import { SPATIAL_CAMERA_COMPONENT } from "./cameraPlan";
import { StoryboardPlanField as PlanField } from "./StoryboardPlanField";

const EMPTY_PLAN = "# Video script\n\n";
/** A draft editor over STORYBOARD.md, not a second plan or timeline store. */
export function StoryboardTable({
  projectId,
  data,
  onSaved,
}: {
  projectId: string;
  data: StoryboardResponse;
  onSaved: () => void;
}) {
  const { tx, locale } = useStudioI18n();
  const { writeProjectFile } = useFileManagerContext();
  const { sections: componentSections } = useBlockCatalog();
  const spatialRecipes = useMemo(() => {
    const component = componentSections.flatMap((section) => section.items)
      .find((item) => item.name === SPATIAL_CAMERA_COMPONENT);
    const variable = component?.variables?.find((item) => item.id === "shotStyle");
    return (variable?.type === "enum" ? variable.options : []).map((option) => {
      const labels = option.label.split(" · ");
      return { value: option.value, label: locale === "zh" ? labels.at(-1)! : labels[0]! };
    });
  }, [componentSections, locale]);
  const { registerViewModeGuard } = useViewMode();
  const format = data.globals.format?.match(/(\d+)\s*[x×]\s*(\d+)/i);
  const aspectRatio =
    format && Number(format[1]) > 0 && Number(format[2]) > 0
      ? Number(format[1]) / Number(format[2])
      : 16 / 9;
  const [draft, setDraft] = useState({
    base: data.source,
    text: data.source ?? EMPTY_PLAN,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const embeddedInWork = typeof window !== "undefined" && window.parent !== window;
  const [hostVoiceSelectionAvailable, setHostVoiceSelectionAvailable] = useState<boolean | null>(
    null,
  );
  const [hostRegenerationAvailable, setHostRegenerationAvailable] = useState<boolean | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const savingRef = useRef(false);
  const dirty = draft.text !== (draft.base ?? EMPTY_PLAN);
  const changedOnDisk = data.source !== draft.base;
  const manifest = useMemo(() => parseStoryboard(draft.text), [draft.text]);
  const total = manifest.frames.reduce((sum, frame) => sum + (frame.durationSeconds ?? 0), 0);

  useEffect(() => {
    setDraft((previous) =>
      previous.text === (previous.base ?? EMPTY_PLAN) && !savingRef.current
        ? { base: data.source, text: data.source ?? EMPTY_PLAN }
        : previous,
    );
  }, [data.source]);
  useEffect(() => {
    if (!embeddedInWork) {
      setHostVoiceSelectionAvailable(false);
      setHostRegenerationAvailable(false);
      return;
    }
    const handleHostContext = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (event.data?.type !== "ipollowork:studio-host-context") return;
      if (event.data.projectId !== projectId) return;
      setHostVoiceSelectionAvailable(event.data.actions?.selectRoleVoice !== false);
      setHostRegenerationAvailable(event.data.actions?.regenerateFromStoryboard === true);
    };
    window.addEventListener("message", handleHostContext);
    return () => window.removeEventListener("message", handleHostContext);
  }, [embeddedInWork, projectId]);
  useEffect(() => {
    const handleVoiceSelection = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (event.data?.type !== "ipollowork:video-studio-voice-selected") return;
      if (event.data.projectId !== projectId) return;
      if (!Number.isInteger(event.data.frameIndex)) return;
      const frameIndex = event.data.frameIndex as number;
      const selection = {
        voiceId: typeof event.data.voiceId === "string" ? event.data.voiceId : "",
        model: typeof event.data.model === "string" ? event.data.model : "",
        name: typeof event.data.name === "string" ? event.data.name : "",
      };
      setDraft((previous) => ({
        ...previous,
        text: setFrameVoiceSelection(previous.text, frameIndex, selection),
      }));
      setVoiceNotice(null);
      setSaved(false);
      setError(null);
    };
    window.addEventListener("message", handleVoiceSelection);
    return () => window.removeEventListener("message", handleVoiceSelection);
  }, [projectId]);
  useEffect(
    () =>
      registerViewModeGuard(
        () => !saving && (!dirty || window.confirm(tx("Discard unsaved script changes?"))),
      ),
    [registerViewModeGuard, dirty, saving, tx],
  );
  useEffect(() => {
    if (!dirty && !saving) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, saving]);

  function edit(transform: (source: string) => string) {
    setDraft((previous) => ({ ...previous, text: transform(previous.text) }));
    setSaved(false);
    setError(null);
  }
  function field(index: number, key: string, value: string, aliases?: string[]) {
    edit((source) =>
      setFrameField(source, index, key, value, {
        aliases,
        quote: key !== "duration",
      }),
    );
  }
  function musicPrompt(value: string) {
    edit((source) => setStoryboardGlobal(source, "music_prompt", value));
  }
  function musicAsset(value: string) {
    edit((source) => setStoryboardGlobal(source, "music_asset", value));
  }
  function theme(value: string) {
    edit((source) => setStoryboardGlobal(source, "theme", value));
  }
  function visualStyle(value: string) {
    edit((source) => setStoryboardGlobal(source, "visual_style", value));
  }
  function chooseFrameVoice(frame: (typeof manifest.frames)[number]) {
    if (!embeddedInWork || hostVoiceSelectionAvailable === false) {
      setVoiceNotice(
        tx(
          embeddedInWork
            ? "Voice picker unavailable details"
            : "Standalone voice selection help",
        ),
      );
      return;
    }
    setVoiceNotice(null);
    window.parent.postMessage(
      {
        type: "ipollowork:video-studio-panel",
        projectId,
        panel: "voice",
        frameIndex: frame.index,
        speaker: frame.speaker?.trim() || tx("Narration"),
        voiceSelection: {
          voiceId: frame.voiceId ?? "",
          model: frame.voiceModel ?? "",
          name: frame.voiceName ?? "",
        },
      },
      "*",
    );
  }
  function shotContent(index: number, value: string) {
    const newline = value.indexOf("\n");
    const title = newline < 0 ? value : value.slice(0, newline);
    const scene = newline < 0 ? "" : value.slice(newline + 1);
    edit((source) =>
      setFrameField(setFrameTitle(source, index, title), index, "scene", scene, {
        aliases: ["description", "summary", "caption"],
      }),
    );
  }
  function move(from: number, to: number) {
    if (saving || from === to) return;
    edit((source) => moveStoryboardFrame(source, from, to));
  }
  async function save(): Promise<boolean> {
    if (savingRef.current) return false;
    if (!dirty) return true;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await writeProjectFile(data.path, draft.text, draft.base);
      setDraft({ base: draft.text, text: draft.text });
      setSaved(true);
      onSaved();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tx("Could not save script."));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function regenerate() {
    if (!embeddedInWork || hostRegenerationAvailable !== true || manifest.frames.length === 0) return;
    if (!(await save())) return;
    window.parent.postMessage(
      { type: "ipollowork:video-studio-regenerate", projectId },
      "*",
    );
  }
  function reset() {
    if (dirty && !window.confirm(tx("Discard unsaved script changes?"))) return;
    setDraft({ base: data.source, text: data.source ?? EMPTY_PLAN });
    setError(null);
    setSaved(false);
  }

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--hf-workspace-bg)] text-[var(--hf-panel-text-0)]"
      aria-label={tx("Script table")}
      data-playback-shortcuts="off"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">
            {manifest.globals.message || tx("Plan the picture first")}
          </h2>
          <p className="mt-1 text-xs text-[var(--hf-panel-text-3)]">
            {manifest.frames.length} {tx("shots")} · {Number(total.toFixed(2))}s ·{" "}
            {tx("Visuals, voice and materials in one plan")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span role="status" className="text-xs text-[var(--hf-panel-text-3)]">
            {tx(saving ? "Saving…" : dirty ? "Unsaved changes" : saved ? "Saved" : "")}
          </span>
          {(dirty || error) && (
            <Button size="sm" variant="ghost" disabled={saving} onClick={reset}>
              {tx("Reset changes")}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            icon={<Save size={14} />}
            disabled={!dirty || saving || (changedOnDisk && dirty)}
            loading={saving}
            onClick={() => void save()}
          >
            {tx("Save script")}
          </Button>
          {embeddedInWork && (
            <Button
              size="sm"
              variant="primary"
              icon={<RefreshCw size={14} />}
              disabled={saving || hostRegenerationAvailable !== true || manifest.frames.length === 0 || (changedOnDisk && dirty)}
              loading={saving}
              onClick={() => void regenerate()}
            >
              {tx("Save and regenerate video")}
            </Button>
          )}
        </div>
      </div>
      {changedOnDisk && dirty && (
        <p role="alert" className="mx-5 mb-3 rounded-md border border-amber-500/40 p-3 text-xs">
          {tx(
            "The script changed on disk. Copy your edits before resetting to the latest version; saving is paused to prevent overwriting.",
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="mx-5 mb-3 text-xs text-red-500">
          {tx("Could not save script.")} {error}
        </p>
      )}
      <StoryboardGlobalSettings
        projectId={projectId}
        globals={manifest.globals}
        disabled={saving}
        onMusicChange={musicPrompt}
        onMusicAssetChange={musicAsset}
        onThemeChange={theme}
        onVisualStyleChange={visualStyle}
      />
      {voiceNotice ? (
        <p
          role="status"
          className="mx-5 mb-2 rounded-md border border-[var(--hf-workspace-border)] px-3 py-2 text-[10px] leading-4 text-[var(--hf-panel-text-3)]"
        >
          {voiceNotice}
        </p>
      ) : null}
      <StoryboardTableLayout
        disabled={saving}
        footer={
          <>
            {manifest.frames.length === 0 && (
              <div className="px-6 py-12 text-center">
                <h3 className="text-sm font-medium">{tx("Start with the first shot")}</h3>
                <p className="mt-2 text-xs text-[var(--hf-panel-text-3)]">
                  {tx("Describe the shot, then choose existing media or ask AI to generate it.")}
                </p>
              </div>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => edit((source) => appendStoryboardFrame(source, tx("New shot")))}
              className="flex w-full items-center justify-center gap-2 border-b border-dashed border-[var(--hf-workspace-border)] py-4 text-xs text-[var(--hf-panel-text-3)] hover:bg-[var(--hf-panel-hover)] hover:text-[var(--hf-panel-text-0)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={14} />
              {tx("Add shot")}
            </button>
          </>
        }
      >
        <tbody>
          {manifest.frames.map((frame) => {
            const diskFrame = data.frames.find((item) => item.src === frame.src && item.srcExists);
            // Older drafts used `search`; surface those as the current AI-source
            // decision while preserving the original value until the user changes it.
            const assetSource = frame.assetSource === "search" || frame.assetSource === "auto"
              ? "auto"
              : frame.assetSource || "generate";
            return (
              <Fragment key={frame.index}>
                <tr
                  data-shot={frame.index}
                  className={`group border-b border-[var(--hf-workspace-hairline)] align-top ${dropTarget === frame.index ? "bg-[var(--hf-panel-hover)] outline outline-1 outline-studio-accent" : ""}`}
                  onDragOver={(event) => {
                    if (dragging !== null) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDropTarget(frame.index);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragging !== null) move(dragging, frame.index);
                    setDragging(null);
                    setDropTarget(null);
                  }}
                >
                  <td className="px-2 py-3">
                    <button
                      type="button"
                      draggable
                      aria-label={`${tx("Move shot")} ${frame.index}`}
                      title={tx("Drag to reorder. Use arrow keys to move.")}
                      onDragStart={(event) => {
                        setDragging(frame.index);
                        event.dataTransfer.setData("text/plain", String(frame.index));
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDropTarget(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp" && frame.index > 1) {
                          event.preventDefault();
                          move(frame.index, frame.index - 1);
                        }
                        if (event.key === "ArrowDown" && frame.index < manifest.frames.length) {
                          event.preventDefault();
                          move(frame.index, frame.index + 1);
                        }
                      }}
                      className="flex h-8 w-full cursor-grab items-center justify-center gap-1 rounded text-[var(--hf-panel-text-3)] hover:bg-[var(--hf-panel-hover)] focus-visible:outline-studio-accent disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <GripVertical size={12} />
                      <span className="tabular-nums">{String(frame.index).padStart(2, "0")}</span>
                    </button>
                  </td>
                  <td className="px-1 py-3">
                    <label
                      className="mb-1 block px-2 text-[10px] text-[var(--hf-panel-text-3)]"
                      htmlFor={`storyboard-shot-content-${frame.index}`}
                    >
                      {tx("Shot title & picture")}
                    </label>
                    <PlanField
                      id={`storyboard-shot-content-${frame.index}`}
                      label={`${tx("Shot content")} ${frame.index}`}
                      placeholder={tx("Title first, then describe the picture")}
                      value={
                        frame.title || frame.scene || frame.narrative
                          ? `${frame.title ?? ""}\n${frame.scene ?? frame.narrative}`
                          : ""
                      }
                      multiline
                      rows={4}
                      onChange={(value) => shotContent(frame.index, value)}
                    />
                    {diskFrame?.src && (
                      <div
                        className="mx-2 my-1 max-w-44 overflow-hidden rounded border border-[var(--hf-workspace-hairline)]"
                        style={{ aspectRatio }}
                      >
                        <FramePoster
                          projectId={projectId}
                          src={diskFrame.src}
                          seconds={diskFrame.poster ?? (diskFrame.durationSeconds ?? 3) * 0.66}
                          title={diskFrame.title ?? tx("Preview")}
                          posterVersion={data.signature}
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-1 py-3">
                    <div className="space-y-1.5 px-2">
                      <div className="flex min-w-0 items-center justify-between gap-1">
                        <label htmlFor={`storyboard-narration-${frame.index}`} className="shrink-0 text-[10px] text-[var(--hf-panel-text-3)]">
                          {tx("Narration")}
                        </label>
                        <button
                          type="button"
                          data-testid={`storyboard-voice-picker-${frame.index}`}
                          aria-label={`${tx("Choose voice for narration")} ${frame.index}`}
                          title={tx("Choose and audition a narration voice")}
                          onClick={() => chooseFrameVoice(frame)}
                          className="inline-flex min-w-0 max-w-[72%] items-center gap-1 rounded-full border border-[var(--hf-workspace-border)] px-2 py-1 text-[10px] text-[var(--hf-panel-text-2)] hover:bg-[var(--hf-panel-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent"
                        >
                          <AudioLines size={11} className="shrink-0" />
                          <span className="truncate">
                            {tx("Voice")}: {frame.voiceId === "auto"
                              ? tx("AI chooses a fitting narration voice")
                              : frame.voiceName ||
                                (frame.voiceId
                                  ? tx("Selected voice")
                                  : tx("Project default voice"))}
                          </span>
                        </button>
                      </div>
                      <PlanField
                        id={`storyboard-narration-${frame.index}`}
                        label={`${tx("Narration")} ${frame.index}`}
                        placeholder={tx("Write this shot's narration or dialogue")}
                        value={frame.voiceover ?? ""}
                        multiline
                        rows={3}
                        onChange={(value) =>
                          edit((source) => setFrameVoiceover(source, frame.index, value))
                        }
                      />
                    </div>
                  </td>
                  <td className="px-1 py-3">
                    <StoryboardCamera
                      frameIndex={frame.index}
                      value={frame.camera ?? ""}
                      disabled={saving}
                      spatialRecipes={spatialRecipes}
                      onChange={(value) => field(frame.index, "camera", value)}
                    />
                  </td>
                  <td className="px-1 py-3">
                    <div
                      role="group"
                      aria-label={`${tx("Material source")} ${frame.index}`}
                      className="mb-2 flex flex-wrap gap-1 px-2"
                    >
                      {(
                        [
                          ["auto", "AI chooses the source"],
                          ["existing", "Use project media"],
                          ["generate", "Generate visual media"],
                          ["code", "No external media"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={assetSource === value}
                          disabled={saving}
                          onClick={() => field(frame.index, "asset_source", value)}
                          className={`rounded-full border px-2 py-1 text-[10px] transition-colors ${
                            assetSource === value
                              ? "border-studio-accent bg-studio-accent/10 text-[var(--hf-panel-text-0)]"
                              : "border-[var(--hf-workspace-border)] text-[var(--hf-panel-text-3)] hover:bg-[var(--hf-panel-hover)]"
                          }`}
                        >
                          {tx(label)}
                        </button>
                      ))}
                    </div>
                    {(assetSource === "auto" || assetSource === "generate") && (
                      <select
                        aria-label={`${tx("Visual media type")} ${frame.index}`}
                        value={frame.assetKind === "image" || frame.assetKind === "video" ? frame.assetKind : "auto"}
                        disabled={saving}
                        onChange={(event) => field(frame.index, "asset_kind", event.target.value === "auto" ? "" : event.target.value)}
                        className="mx-2 mb-1 w-[calc(100%-1rem)] rounded-md border border-[var(--hf-workspace-border)] bg-[var(--hf-workspace-bg)] px-2 py-1.5 text-[11px] text-[var(--hf-panel-text-2)]"
                      >
                        <option value="auto">{tx("AI chooses image or video")}</option>
                        <option value="image">{tx("Image")}</option>
                        <option value="video">{tx("Video")}</option>
                      </select>
                    )}
                    {(assetSource === "auto" || assetSource === "generate") && (
                      <PlanField
                        label={`${tx("Material brief")} ${frame.index}`}
                        placeholder={tx(assetSource === "auto" ? "Describe what to find or create" : "Describe the picture the story needs")}
                        value={frame.assetBrief ?? ""}
                        multiline
                        rows={3}
                        onChange={(value) => field(frame.index, "asset_brief", value)}
                      />
                    )}
                    {(assetSource === "existing" || (assetSource === "auto" && Boolean(frame.assetReference?.trim()))) && (
                      <StoryboardAsset
                        projectId={projectId}
                        index={frame.index}
                        reference={frame.assetReference ?? ""}
                        disabled={saving}
                        mediaKind={frame.assetKind === "image" || frame.assetKind === "video" ? frame.assetKind : undefined}
                        onChange={(value) => field(frame.index, "asset_reference", value)}
                      />
                    )}
                    {(frame.assetOrigin || assetSource === "auto") && (
                      <PlanField
                        label={`${tx("Source and attribution")} ${frame.index}`}
                        placeholder={tx("Article URL, source and date; mark illustrations")}
                        value={frame.assetOrigin ?? ""}
                        multiline
                        rows={2}
                        onChange={(value) => field(frame.index, "asset_origin", value)}
                      />
                    )}
                    {assetSource === "code" && (
                      <p className="px-2 text-[10px] text-[var(--hf-panel-text-4)]">
                        {tx("HTML components only")}
                      </p>
                    )}
                  </td>
                  <td className="px-1 py-3">
                    <label
                      className="mb-1 block px-2 text-[10px] text-[var(--hf-panel-text-3)]"
                      htmlFor={`storyboard-sound-effects-${frame.index}`}
                    >
                      {tx("Sound effects & cue")}
                    </label>
                    <PlanField
                      id={`storyboard-sound-effects-${frame.index}`}
                      label={`${tx("Sound effects & timing")} ${frame.index}`}
                      placeholder={tx("Describe sound and when it plays")}
                      value={frame.soundEffects ?? ""}
                      multiline
                      rows={2}
                      onChange={(value) => field(frame.index, "sound_effects", value)}
                    />
                    <p className="px-2 pt-2 text-[10px] text-[var(--hf-panel-text-4)]">
                      {tx("Optional exact audio from the shared project assets")}
                    </p>
                    <StoryboardAsset
                      projectId={projectId}
                      index={frame.index}
                      reference={frame.soundEffectReference ?? ""}
                      audioOnly
                      disabled={saving}
                      onChange={(value) => field(frame.index, "sound_effect_reference", value)}
                    />
                  </td>
                  <td className="px-1 py-3">
                    <label
                      className="mb-0.5 block px-2 text-[10px] text-[var(--hf-panel-text-3)]"
                      htmlFor={`storyboard-duration-${frame.index}`}
                    >
                      {tx("Duration")}
                    </label>
                    <PlanField
                      id={`storyboard-duration-${frame.index}`}
                      label={`${tx("Duration")} ${frame.index}`}
                      placeholder={tx("For example, 5s")}
                      value={frame.duration ?? ""}
                      onChange={(value) => field(frame.index, "duration", value)}
                    />
                    <label
                      className="mb-0.5 mt-2 block px-2 text-[10px] text-[var(--hf-panel-text-3)]"
                      htmlFor={`storyboard-transition-${frame.index}`}
                    >
                      {tx("Transition")}
                    </label>
                    <PlanField
                      id={`storyboard-transition-${frame.index}`}
                      label={`${tx("Transition")} ${frame.index}`}
                      placeholder={tx("For example, crossfade")}
                      value={frame.transitionIn ?? ""}
                      onChange={(value) =>
                        field(frame.index, "transition_in", value, ["transition", "transitionin"])
                      }
                    />
                  </td>
                  <td className="px-1 py-3">
                    <button
                      type="button"
                      aria-label={`${tx("Delete shot")} ${frame.index}`}
                      title={tx("Delete shot")}
                      className="flex h-8 w-8 items-center justify-center rounded text-[var(--hf-panel-text-3)] hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30"
                      onClick={() => {
                        if (
                          window.confirm(
                            tx("Delete this shot from the plan? Media files will not be deleted."),
                          )
                        ) {
                          edit((source) => removeStoryboardFrame(source, frame.index));
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </StoryboardTableLayout>
      <div className="border-t border-[var(--hf-workspace-border)] px-5 py-3 text-xs text-[var(--hf-panel-text-3)]">
        {tx(
          "The first script version produces the video automatically. Save and regenerate after editing this table.",
        )}
        {manifest.warnings.length > 0 && (
          <details className="mt-2">
            <summary>
              {tx("Check script fields")}: {manifest.warnings.length}
            </summary>
            {manifest.warnings.map((warning, index) => (
              <p key={index}>{warning.message}</p>
            ))}
          </details>
        )}
      </div>
    </section>
  );
}
