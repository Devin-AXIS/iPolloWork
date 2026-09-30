import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  GripVertical,
  Plus,
  RefreshCw,
  Save,
  Play,
  Pencil,
  Trash2,
  X,
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
import { storyboardSettingsApplySchema, type StoryboardSettingsAsset, type StoryboardSettingsFields, type StoryboardSettingsRequest } from "@ipollowork/types/hyperframes";
import { resolveMediaPreviewUrl } from "../../player/components/thumbnailUtils";
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "../../utils/mediaTypes";
import { CAMERA_PRESETS, spatialCameraValue } from "./cameraPlan";
import { parseHostAiEditingMessage } from "../../utils/studioHelpers";
import { useFileManagerContext } from "../../contexts/FileManagerContext";
import { useViewMode } from "../../contexts/ViewModeContext";
import { useBlockCatalog } from "../../hooks/useBlockCatalog";
import type { StoryboardResponse } from "../../hooks/useStoryboard";
import { useStudioI18n } from "../../i18n";
import { Button } from "../ui/Button";
import { useDialogBehavior } from "../ui/useDialogBehavior";
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
  const { writeProjectFile, assets, uploadProjectFiles } = useFileManagerContext();
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
  const [settingsTab, setSettingsTab] = useState<"picture" | "sound">("picture");
  const [expandedShot, setExpandedShot] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [productionRequested, setProductionRequested] = useState(false);
  const [aiActive, setAiActive] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const embeddedInWork = typeof window !== "undefined" && window.parent !== window;
  const [hostVoiceSelectionAvailable, setHostVoiceSelectionAvailable] = useState<boolean | null>(
    null,
  );
  const [hostRegenerationAvailable, setHostRegenerationAvailable] = useState<boolean | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const savingRef = useRef(false);
  const hostedSettingsRef = useRef<{ request: StoryboardSettingsRequest; base: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [settingsSource, setSettingsSource] = useState("");
  const settingsBaseRef = useRef("");
  const settingsManifest = useMemo(() => parseStoryboard(settingsSource), [settingsSource]);
  const { requestClose } = useDialogBehavior({ open: expandedShot !== null, onClose: () => setExpandedShot(null), containerRef: dialogRef });
  function openSettings(index: number, tab: "picture" | "sound") {
    if (embeddedInWork && hostVoiceSelectionAvailable !== false) {
      const frame = manifest.frames.find(item => item.index === index);
      if (!frame) return;
      const request: StoryboardSettingsRequest = {
        type: "ipollowork:video-studio-settings-open", projectId, requestId: crypto.randomUUID(),
        frameIndex: index, title: frame.title ?? "", kind: tab,
        fields: { asset_source: frame.assetSource ?? "", asset_kind: frame.assetKind ?? "", asset_brief: frame.assetBrief ?? "",
          asset_reference: frame.assetReference ?? "", asset_origin: frame.assetOrigin ?? "", camera: frame.camera ?? "",
          transition_in: frame.transitionIn ?? "", sound_effects: frame.soundEffects ?? "", sound_effect_reference: frame.soundEffectReference ?? "" },
        assets: projectAssets(assets).slice(0, 2000),
        cameras: [{ value: "", label: tx("AI / basic camera movement") }, ...CAMERA_PRESETS.map(preset => ({ value: preset.id, label: tx(preset.label) })),
          ...spatialRecipes.map(recipe => ({ value: spatialCameraValue(recipe.value), label: recipe.label }))],
      };
      hostedSettingsRef.current = { request, base: draft.text };
      window.parent.postMessage(request, "*");
      return;
    }
    settingsBaseRef.current = draft.text;
    setSettingsSource(draft.text);
    setSettingsTab(tab);
    setExpandedShot(index);
  }
  function settingsField(index: number, key: string, value: string, aliases?: string[]) {
    setSettingsSource((source) => setFrameField(source, index, key, value, { aliases, quote: true }));
  }
  const dirty = draft.text !== (draft.base ?? EMPTY_PLAN);
  const pendingSettings = expandedShot !== null && settingsSource !== settingsBaseRef.current;
  const changedOnDisk = data.source !== draft.base;
  const manifest = useMemo(() => parseStoryboard(draft.text), [draft.text]);
  const total = manifest.frames.reduce((sum, frame) => sum + (frame.durationSeconds ?? 0), 0);

  function projectAssets(paths: string[]): StoryboardSettingsAsset[] {
    return paths.flatMap(path => {
      const kind = IMAGE_EXT.test(path) ? "image" : VIDEO_EXT.test(path) ? "video" : AUDIO_EXT.test(path) ? "audio" : null;
      return kind ? [{ path, kind, url: new URL(resolveMediaPreviewUrl(path, projectId), window.location.origin).href }] : [];
    });
  }
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.projectId !== projectId) return;
      const pending = hostedSettingsRef.current;
      if (!pending || event.data.requestId !== pending.request.requestId) return;
      if (event.data.type === "ipollowork:video-studio-settings-import" && event.data.file instanceof File) {
        const file = event.data.file;
        const compatible = pending.request.kind === "sound" ? AUDIO_EXT.test(file.name) : IMAGE_EXT.test(file.name) || VIDEO_EXT.test(file.name);
        const reply = (paths: string[]) => window.parent.postMessage({ type: "ipollowork:video-studio-settings-import-result", projectId,
          requestId: pending.request.requestId, assets: projectAssets(paths) }, "*");
        if (!compatible || aiActive || saving) { reply([]); return; }
        void uploadProjectFiles([file]).then(reply).catch(() => reply([]));
        return;
      }
      const parsed = storyboardSettingsApplySchema.safeParse(event.data);
      if (!parsed.success) return;
      const accepted = !saving && !aiActive && !changedOnDisk && draft.text === pending.base;
      if (accepted) {
        const keys: (keyof StoryboardSettingsFields)[] = pending.request.kind === "sound"
          ? ["sound_effects", "sound_effect_reference"]
          : ["asset_source", "asset_kind", "asset_brief", "asset_reference", "asset_origin", "camera", "transition_in"];
        edit(source => keys.reduce((text, key) => parsed.data.fields[key] === pending.request.fields[key] ? text : setFrameField(text, pending.request.frameIndex, key, parsed.data.fields[key],
          { quote: true, aliases: key === "transition_in" ? ["transition", "transitionin"] : undefined }), source));
        hostedSettingsRef.current = null;
      }
      window.parent.postMessage({ type: "ipollowork:video-studio-settings-apply-result", projectId, requestId: pending.request.requestId, accepted }, "*");
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [projectId, draft.text, changedOnDisk, saving, aiActive, uploadProjectFiles]);
  useEffect(() => {
    setDraft((previous) =>
      previous.text === (previous.base ?? EMPTY_PLAN) && !savingRef.current
        ? { base: data.source, text: data.source ?? EMPTY_PLAN }
        : previous,
    );
  }, [data.source]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const active = parseHostAiEditingMessage(event.data, projectId);
      if (active !== null) {
        setAiActive(active);
        if (active) setProductionRequested(false);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [projectId]);

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
      const frameIndex: number = event.data.frameIndex;
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
      setProductionRequested(false);
      setSaved(false);
      setError(null);
    };
    window.addEventListener("message", handleVoiceSelection);
    return () => window.removeEventListener("message", handleVoiceSelection);
  }, [projectId]);
  useEffect(
    () =>
      registerViewModeGuard(
        () => !saving && (!(dirty || pendingSettings) || window.confirm(tx("Discard unsaved script changes?"))),
      ),
    [registerViewModeGuard, dirty, pendingSettings, saving, tx],
  );
  useEffect(() => {
    if (!dirty && !pendingSettings && !saving) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, pendingSettings, saving]);

  function edit(transform: (source: string) => string) {
    setProductionRequested(false);
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
        presentation: "dialog",
        title: frame.title ?? "",
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
  function move(from: number, to: number) {
    if (saving || from === to) return;
    setExpandedShot(null);
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
    if (!embeddedInWork || hostRegenerationAvailable !== true || manifest.frames.length === 0 || aiActive || generating || productionRequested) return;
    if (!(await save())) return;
    window.parent.postMessage(
      { type: "ipollowork:video-studio-regenerate", projectId },
      "*",
    );
  }
  async function generate() {
    if (generating || productionRequested || aiActive || savingRef.current || changedOnDisk) return;
    setGenerating(true);
    if (!(await save())) { setGenerating(false); return; }
    const requestId = crypto.randomUUID();
    const result = await new Promise<boolean>((resolve) => {
      const finish = (accepted: boolean) => {
        window.clearTimeout(timeout);
        window.removeEventListener("message", receive);
        resolve(accepted);
      };
      const receive = (event: MessageEvent) => {
        if (event.source !== window.parent || event.data?.type !== "ipollowork:video-studio-generate-result"
          || event.data.projectId !== projectId || event.data.requestId !== requestId) return;
        finish(event.data.accepted === true);
      };
      const timeout = window.setTimeout(() => finish(false), 15_000);
      window.addEventListener("message", receive);
      window.parent.postMessage({ type: "ipollowork:video-studio-generate", projectId, requestId }, "*");
    });
    setProductionRequested(result);
    if (!result) setError(tx("Could not start video generation. Your script is saved; retry or continue in chat."));
    setGenerating(false);
  }
  function reset() {
    if (dirty && !window.confirm(tx("Discard unsaved script changes?"))) return;
    setDraft({ base: data.source, text: data.source ?? EMPTY_PLAN });
    setError(null);
    setSaved(false);
  }

  return (
    <section
      className="hf-script-table relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--hf-workspace-bg)] text-[var(--hf-panel-text-0)]"
      aria-label={tx("Script table")}
      data-playback-shortcuts="off"
    >
      <div className="hf-script-overview flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pb-4 pt-5">
        <div className="min-w-0 flex-1 basis-80">
          <h2 className="max-w-3xl text-sm font-semibold leading-6">
            {manifest.globals.message || tx("Plan the picture first")}
          </h2>
          <p className="mt-1.5 text-xs tabular-nums text-[var(--hf-panel-text-3)]">
            {manifest.frames.length} {tx("shots")} · {Number(total.toFixed(2))}s ·{" "}
            {tx("Visuals, voice and materials in one plan")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            className="hf-script-save text-[var(--hf-panel-text-1)]"
            icon={<Save size={14} />}
            disabled={!dirty || saving || generating || (changedOnDisk && dirty)}
            loading={saving}
            onClick={() => void save()}
          >
            {tx("Save script")}
          </Button>
          {embeddedInWork && hostRegenerationAvailable === true ? (
            <Button
              size="sm"
              variant="primary"
              icon={<RefreshCw size={14} />}
              disabled={saving || generating || productionRequested || aiActive || hostRegenerationAvailable !== true || manifest.frames.length === 0 || changedOnDisk}
              loading={saving}
              onClick={() => void regenerate()}
            >
              {tx("Save and regenerate video")}
            </Button>
          ) : embeddedInWork && <Button size="sm" variant="primary" className="hf-script-generate" icon={<Play size={14} />}
            disabled={saving || generating || productionRequested || aiActive || changedOnDisk || manifest.frames.length === 0}
            loading={generating} onClick={() => void generate()}>
            {tx(aiActive ? "Video production in progress" : productionRequested ? "Production requested" : generating ? "Starting video…" : "Confirm script & generate video")}
          </Button>}
        </div>
      </div>
      {(productionRequested || aiActive) && <p role="status" className="mx-5 mb-3 text-xs text-[var(--hf-panel-text-2)]">
        {tx("Follow production progress in this conversation.")}
      </p>}
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
      <div className="relative flex min-h-0 flex-1">
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
        <tbody className="bg-[var(--hf-panel-bg)]">
          {manifest.frames.map((frame) => {
            const diskFrame = data.frames.find((item) => item.src === frame.src && item.srcExists);
            const recipeId = frame.extra.recipe?.trim() || frame.camera?.match(/(?:^|\s)component:([a-z0-9-]+)/)?.[1] || "";
            const recipeIntent = frame.extra.recipe_intent?.trim() || "";
            const customReason = frame.extra.custom_reason?.trim() || "";
            const recipeTitle = componentSections.flatMap(section => section.items).find(item => item.name === recipeId)?.title || recipeId;
            const recipeEvidence = data.frames.find(item => frame.extra.scene_id
              ? item.extra.scene_id === frame.extra.scene_id
              : Boolean(frame.src && item.src === frame.src))?.recipeMount;
            const recipeMounted = Boolean(recipeId && recipeEvidence?.componentId === recipeId && !customReason);
            // Older drafts used `search`; surface those as the current AI-source
            // decision while preserving the original value until the user changes it.
            const assetSource = frame.assetSource === "search" || frame.assetSource === "auto"
              ? "auto"
              : frame.assetSource || "generate";
            return (
              <Fragment key={frame.index}>
                <tr
                  data-shot={frame.index}
                  className={`group ${expandedShot === frame.index ? "bg-[var(--hf-panel-hover)]" : ""} border-b border-[var(--hf-workspace-hairline)] align-top ${dropTarget === frame.index ? "bg-[var(--hf-panel-hover)] outline outline-1 outline-studio-accent" : ""}`}
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
                      className="sr-only"
                      htmlFor={`storyboard-shot-content-${frame.index}`}
                    >
                      {tx("Shot title & picture")}
                    </label>
                    <div className="[&_input]:font-semibold [&_input]:text-sm">
                      <PlanField label={`${tx("Shot title")} ${frame.index}`} value={frame.title ?? ""}
                        onChange={(value) => edit((source) => setFrameTitle(source, frame.index, value))} />
                    </div>
                    <PlanField
                      id={`storyboard-shot-content-${frame.index}`}
                      label={`${tx("Shot content")} ${frame.index}`}
                      placeholder={tx("Title first, then describe the picture")}
                      value={frame.scene ?? frame.narrative ?? ""}
                      multiline
                      rows={4}
                      onChange={(value) => field(frame.index, "scene", value, ["description", "summary", "caption"])}
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
                          aria-haspopup="dialog"
                          onClick={() => chooseFrameVoice(frame)}
                          className="inline-flex min-w-0 max-w-[72%] items-center gap-1 rounded-lg border border-[var(--hf-workspace-border)] px-2 py-1 text-[10px] text-[var(--hf-panel-text-2)] hover:bg-[var(--hf-panel-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent"
                        >
                          <AudioLines size={11} className="shrink-0" />
                          <span className="truncate">
                            {tx("Voice")}: {frame.voiceId === "auto"
                              ? tx("AI automatic")
                              : frame.voiceName ||
                                (frame.voiceId
                                  ? tx("Selected voice")
                                  : tx("Project default voice"))}
                          </span>
                          <Pencil size={11} className="shrink-0" />
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
                  </td>
                  <td className="px-3 py-3"><div className="space-y-2">
                    <div data-testid={`storyboard-recipe-${frame.index}`} className="space-y-1 rounded-lg border border-[var(--hf-workspace-border)] px-2.5 py-2 text-xs">
                      <div className="text-[10px] text-[var(--hf-panel-text-3)]">{tx("Recipe")}</div>
                      <div className="font-medium break-words">{customReason ? tx("Custom graphics") : recipeTitle || tx("Not selected")}</div>
                      {recipeId && !customReason && <><div className="break-all text-[10px] text-[var(--hf-panel-text-3)]">{recipeId}</div><div className="text-[var(--hf-panel-text-2)]">{tx(recipeMounted ? "Mounted in source" : "Planned recipe")}</div></>}
                      {recipeId && recipeIntent && !customReason && <p className="whitespace-pre-wrap break-words text-[var(--hf-panel-text-2)]"><span className="font-medium">{tx("Selection intent")}：</span>{recipeIntent}</p>}
                      {customReason && <p className="whitespace-pre-wrap break-words text-[var(--hf-panel-text-2)]">{customReason}</p>}
                    </div>
                    <button type="button" data-testid={`storyboard-picture-picker-${frame.index}`} aria-haspopup="dialog" aria-controls="storyboard-shot-settings"
                      onClick={() => openSettings(frame.index, "picture")} className="hf-script-edit inline-flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--hf-workspace-border)] px-2.5 py-2 text-left text-xs hover:bg-[var(--hf-panel-hover)] focus-visible:ring-2 focus-visible:ring-studio-accent">
                      <span>{tx(assetSource === "code" ? "No external media" : assetSource === "existing" ? "Use project media" : assetSource === "generate" ? "Generate visual media" : "AI chooses the source")}</span><Pencil size={12} className="shrink-0" />
                    </button>
                    <button type="button" data-testid={`storyboard-sound-picker-${frame.index}`} aria-haspopup="dialog"
                      onClick={() => openSettings(frame.index, "sound")} className="hf-script-edit inline-flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--hf-workspace-border)] px-2.5 py-2 text-left text-xs hover:bg-[var(--hf-panel-hover)] focus-visible:ring-2 focus-visible:ring-studio-accent">
                      <span className="truncate">{tx("Sound effects")}: {tx(frame.soundEffects?.trim() || frame.soundEffectReference?.trim() ? "Configured" : "Not set")}</span><Pencil size={12} className="shrink-0" />
                    </button>
                  </div></td>
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
                          setExpandedShot(null);
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
      {settingsManifest.frames.filter((frame) => frame.index === expandedShot).map((frame) => {
        const assetSource = frame.assetSource === "search" ? "auto" : frame.assetSource || "generate";
        return <div key={frame.index} className="hf-script-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" onClick={requestClose}>
          <div ref={dialogRef} id="storyboard-shot-settings" role="dialog" aria-modal="true" aria-labelledby="storyboard-settings-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}
            className="hf-script-settings-dialog flex max-h-[calc(100dvh-32px)] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-[var(--hf-workspace-border)] bg-[var(--hf-workspace-surface)] shadow-xl outline-none">
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--hf-workspace-border)] px-5 py-4">
              <div className="min-w-0"><p className="text-xs text-[var(--hf-panel-text-3)]">{tx("Shot")} {String(frame.index).padStart(2, "0")} · {frame.title}</p>
                <h3 id="storyboard-settings-title" className="mt-1 text-sm font-semibold">{tx(settingsTab === "picture" ? "Picture & materials" : "Sound effects")}</h3></div>
              <button type="button" aria-label={tx("Close shot settings")} onClick={requestClose} className="rounded-lg p-2 hover:bg-[var(--hf-panel-hover)]"><X size={16} /></button>
            </header>
          <fieldset disabled={saving || aiActive} id="storyboard-settings-content" className="m-0 min-h-0 min-w-0 flex-1 overflow-y-auto border-0 p-5">
            {settingsTab === "picture" && <div className="space-y-5">
                  <div className="min-w-0">
                    <h3 className="mb-2 text-xs font-medium">{tx("Material source")}</h3>
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
                          onClick={() => settingsField(frame.index, "asset_source", value)}
                          className={`rounded-lg border px-2 py-1 text-[10px] transition-colors ${
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
                        onChange={(event) => settingsField(frame.index, "asset_kind", event.target.value === "auto" ? "" : event.target.value)}
                        className="mx-2 mb-1 w-[calc(100%-1rem)] rounded-md border border-[var(--hf-workspace-border)] bg-[var(--hf-workspace-bg)] px-2 py-1.5 text-[11px] text-[var(--hf-panel-text-2)]"
                      >
                        <option value="auto">{tx("AI chooses image or video")}</option>
                        <option value="image">{tx("Image")}</option>
                        <option value="video">{tx("Video")}</option>
                      </select>
                    )}
                    {(assetSource === "auto" || assetSource === "generate") && (<div><h3 className="mb-2 mt-4 text-xs font-medium">{tx("Material brief")}</h3>
                      <PlanField
                        label={`${tx("Material brief")} ${frame.index}`}
                        placeholder={tx(assetSource === "auto" ? "Describe what to find or create" : "Describe the picture the story needs")}
                        value={frame.assetBrief ?? ""}
                        multiline
                        rows={3}
                        onChange={(value) => settingsField(frame.index, "asset_brief", value)}
                      /></div>
                    )}
                    {(assetSource === "existing" || (assetSource === "auto" && Boolean(frame.assetReference?.trim()))) && (
                      <StoryboardAsset
                        projectId={projectId}
                        index={frame.index}
                        reference={frame.assetReference ?? ""}
                        disabled={saving}
                        mediaKind={frame.assetKind === "image" || frame.assetKind === "video" ? frame.assetKind : undefined}
                        onChange={(value) => settingsField(frame.index, "asset_reference", value)}
                      />
                    )}
                    {(frame.assetOrigin || assetSource === "auto") && (<div><h3 className="mb-2 mt-4 text-xs font-medium">{tx("Source and attribution")}</h3>
                      <PlanField
                        label={`${tx("Source and attribution")} ${frame.index}`}
                        placeholder={tx("Article URL, source and date; mark illustrations")}
                        value={frame.assetOrigin ?? ""}
                        multiline
                        rows={2}
                        onChange={(value) => settingsField(frame.index, "asset_origin", value)}
                      /></div>
                    )}
                    {assetSource === "code" && (
                      <p className="px-2 text-[10px] text-[var(--hf-panel-text-4)]">
                        {tx("HTML components only")}
                      </p>
                    )}
                  </div>

              <details className="border-t border-[var(--hf-workspace-border)] pt-4"><summary className="cursor-pointer text-xs font-medium">{tx("More settings")}</summary><div className="mt-4 space-y-4">
              <div className="min-w-0">
                    <h3 className="mb-2 text-xs font-medium">{tx("Camera & animation")}</h3><StoryboardCamera
                      frameIndex={frame.index}
                      value={frame.camera ?? ""}
                      disabled={saving}
                      spatialRecipes={spatialRecipes}
                      onChange={(value) => settingsField(frame.index, "camera", value)}
                    />
                  </div>
              <div>
                <label htmlFor={`storyboard-transition-${frame.index}`} className="mb-2 block text-xs font-medium">{tx("Transition")}</label>
                <PlanField id={`storyboard-transition-${frame.index}`} label={`${tx("Transition")} ${frame.index}`}
                  placeholder={tx("For example, crossfade")} value={frame.transitionIn ?? ""}
                  onChange={(value) => settingsField(frame.index, "transition_in", value, ["transition", "transitionin"])} />
              </div>
              </div></details>
            </div>}
            {settingsTab === "sound" && <div>
              <label htmlFor={`storyboard-sound-effects-${frame.index}`} className="mb-2 block text-xs font-medium">{tx("Sound effects & cue")}</label>
              <PlanField id={`storyboard-sound-effects-${frame.index}`} label={`${tx("Sound effects & timing")} ${frame.index}`}
                placeholder={tx("Describe sound and when it plays")} value={frame.soundEffects ?? ""} multiline rows={2}
                onChange={(value) => settingsField(frame.index, "sound_effects", value)} />
              <p className="mb-2 mt-5 text-xs text-[var(--hf-panel-text-3)]">{tx("Optional exact audio from the shared project assets")}</p>
              <StoryboardAsset projectId={projectId} index={frame.index} reference={frame.soundEffectReference ?? ""}
                audioOnly disabled={saving} onChange={(value) => settingsField(frame.index, "sound_effect_reference", value)} />
            </div>}
          </fieldset>
          <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--hf-workspace-border)] px-5 py-4">
            <p className="text-[11px] text-[var(--hf-panel-text-3)]">{tx(draft.text !== settingsBaseRef.current ? "Script updated. Cancel and reopen to edit the latest version." : "Apply first, then save the script.")}</p>
            <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={requestClose}>{tx("Cancel")}</Button>
              <Button size="sm" variant="primary" disabled={saving || aiActive || changedOnDisk || draft.text !== settingsBaseRef.current} onClick={() => { edit(() => settingsSource); setExpandedShot(null); }}>{tx("Apply to script")}</Button></div>
          </footer></div></div>;
      })}
      </div>

      <div className="border-t border-[var(--hf-workspace-border)] px-5 py-3 text-xs text-[var(--hf-panel-text-3)]">
        {tx(
          hostRegenerationAvailable === true
            ? "The first script version produces the video automatically. Save and regenerate after editing this table."
            : "Save keeps your script for later. Confirm script & generate video saves it and starts production in this conversation.",
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
