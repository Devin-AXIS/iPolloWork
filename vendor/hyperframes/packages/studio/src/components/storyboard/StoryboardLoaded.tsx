import { CheckCircle, FloppyDisk, Sparkle } from "@phosphor-icons/react";
import {
  ASSET_ALIASES,
  ASSET_TASK_ALIASES,
  CONTENT_ALIASES,
  MEDIA_ALIASES,
  parseStoryboard,
  setFrameField,
  VISUAL_ALIASES,
  VOICEOVER_ALIASES,
  type StoryboardFrame,
  type StoryboardMediaMode,
} from "@hyperframes/core/storyboard";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFileManagerContext } from "../../contexts/FileManagerContext";
import { useViewMode } from "../../contexts/ViewModeContext";
import type { StoryboardResponse } from "../../hooks/useStoryboard";
import { useStudioI18n } from "../../i18n";
import { Button } from "../ui/Button";

export interface StoryboardLoadedProps {
  projectId: string;
  data: StoryboardResponse;
  reload: () => void;
  onSelectComposition: (path: string) => void;
}

type ScriptRow = {
  index: number;
  title: string;
  content: string;
  voiceover: string;
  duration: string;
  visual: string;
  mediaMode: StoryboardMediaMode;
  assets: string;
  assetTask: string;
};

function rowFromFrame(frame: StoryboardFrame): ScriptRow {
  return {
    index: frame.index,
    title: frame.title || `Scene ${frame.index}`,
    content: frame.scene || frame.narrative,
    voiceover: frame.voiceover || "",
    duration: frame.duration || (frame.durationSeconds ? `${frame.durationSeconds}s` : ""),
    visual: frame.visual || "",
    mediaMode: frame.mediaMode || "html",
    assets: frame.assets || "",
    assetTask: frame.assetTask || "",
  };
}

function rowsFromData(data: StoryboardResponse) {
  return data.frames.map(rowFromFrame);
}

function rowsFingerprint(rows: ScriptRow[]) {
  return JSON.stringify(rows);
}

function durationSeconds(value: string) {
  const match = value.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function updateStoryboardSource(source: string, rows: ScriptRow[]) {
  const latest = parseStoryboard(source);
  if (latest.frames.length !== rows.length) {
    throw new Error("The script changed in the background. Reload it before saving your edits.");
  }
  return rows.reduce((next, row) => {
    const fields: Array<[string, string, readonly string[], boolean?]> = [
      ["content", row.content, CONTENT_ALIASES, true],
      ["voiceover", row.voiceover || "none", VOICEOVER_ALIASES, true],
      ["duration", row.duration, ["duration"]],
      ["visual", row.visual, VISUAL_ALIASES, true],
      ["media", row.mediaMode, MEDIA_ALIASES],
      ["assets", row.assets || "none", ASSET_ALIASES, true],
      ["asset_task", row.assetTask || "none", ASSET_TASK_ALIASES, true],
    ];
    return fields.reduce(
      (current, [key, value, aliases, quote]) => setFrameField(current, row.index, key, value, { aliases, quote }),
      next,
    );
  }, source);
}

const inputClass = "w-full resize-none rounded-md border border-transparent bg-transparent px-2 py-1.5 text-xs leading-5 text-panel-text-1 outline-none transition-colors placeholder:text-panel-text-4 hover:border-panel-border-input hover:bg-panel-input focus:border-panel-accent/50 focus:bg-panel-input";
const fieldLabelClass = "px-2 text-[9px] font-semibold uppercase tracking-[0.08em] text-panel-text-4";

/** One canonical, editable script table. The existing timeline remains the only media/HTML editor. */
export function StoryboardLoaded({ projectId, data, reload }: StoryboardLoadedProps) {
  const { readProjectFile, writeProjectFile } = useFileManagerContext();
  const { registerViewModeGuard } = useViewMode();
  const { tx } = useStudioI18n();
  const initialRows = useMemo(() => rowsFromData(data), [data]);
  const [rows, setRows] = useState(initialRows);
  const [savedFingerprint, setSavedFingerprint] = useState(() => rowsFingerprint(initialRows));
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = rowsFingerprint(rows) !== savedFingerprint;
  const dirtyRef = useRef(dirty);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (dirtyRef.current) return;
    const nextRows = rowsFromData(data);
    setRows(nextRows);
    setSavedFingerprint(rowsFingerprint(nextRows));
    setBuilding(false);
  }, [data.signature]);

  useEffect(() => registerViewModeGuard((nextMode) => (
    nextMode === "storyboard"
    || !dirtyRef.current
    || window.confirm(tx("Discard unsaved script changes?"))
  )), [registerViewModeGuard, tx]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const handleBuildResult = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (event.data?.type !== "ipollowork:studio-host-action-result") return;
      if (event.data.projectId !== projectId || event.data.action !== "build-from-script") return;
      if (event.data.accepted === true) return;
      setBuilding(false);
      setError(tx("The AI request could not be started."));
    };
    window.addEventListener("message", handleBuildResult);
    return () => window.removeEventListener("message", handleBuildResult);
  }, [projectId, tx]);

  const updateRow = <K extends keyof ScriptRow>(index: number, key: K, value: ScriptRow[K]) => {
    setRows((current) => current.map((row) => row.index === index ? { ...row, [key]: value } : row));
    setBuilding(false);
    setError(null);
  };

  const save = async () => {
    if (!dirty) return true;
    setSaving(true);
    setError(null);
    try {
      const currentSource = await readProjectFile(data.path);
      const nextSource = updateStoryboardSource(currentSource, rows);
      await writeProjectFile(data.path, nextSource);
      const fingerprint = rowsFingerprint(rows);
      dirtyRef.current = false;
      setSavedFingerprint(fingerprint);
      reload();
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : tx("The script could not be saved."));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const confirmAndBuild = async () => {
    if (!(await save())) return;
    if (window.parent === window) {
      setError(tx("Open this Studio inside iPolloWork to generate the video."));
      return;
    }
    setBuilding(true);
    window.parent.postMessage({
      type: "ipollowork:studio-host-action",
      projectId,
      action: "build-from-script",
    }, "*");
  };

  const totalDuration = rows.reduce((total, row) => total + durationSeconds(row.duration), 0);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-studio-bg text-studio-text">
      <div className="flex shrink-0 items-center gap-4 border-b border-studio-border bg-studio-surface/95 px-5 py-3 backdrop-blur-xl">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold tracking-[-0.01em] text-studio-text">
              {data.globals.message || tx("Video script")}
            </h1>
            <span className="rounded-full border border-studio-border bg-panel-input px-2 py-0.5 text-[10px] font-medium text-studio-muted">
              {rows.length} {tx("scenes")}
            </span>
            <span className="text-[11px] text-studio-muted">{totalDuration || 0}s</span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-studio-muted">
            {data.globals.audience || tx("Review content, narration, timing, and media choices before generation.")}
          </p>
        </div>
        {error ? <p className="max-w-72 truncate text-[11px] text-red-400" title={error}>{tx(error)}</p> : null}
        <Button
          size="sm"
          variant="secondary"
          icon={<FloppyDisk size={14} />}
          disabled={!dirty || saving}
          loading={saving}
          onClick={() => void save()}
        >
          {dirty ? tx("Save script") : tx("Saved")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={building ? <CheckCircle size={14} weight="fill" /> : <Sparkle size={14} weight="fill" />}
          disabled={rows.length === 0 || saving || building}
          onClick={() => void confirmAndBuild()}
        >
          {building ? tx("Sent to AI") : tx("Confirm & generate")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1040px] table-fixed border-separate border-spacing-0">
          <colgroup>
            <col className="w-14" />
            <col className="w-[25%]" />
            <col className="w-[23%]" />
            <col className="w-24" />
            <col />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-studio-surface/95 text-left backdrop-blur-xl">
            <tr className="text-[10px] font-semibold uppercase tracking-[0.08em] text-studio-muted">
              <th className="border-b border-r border-studio-border px-3 py-2.5">#</th>
              <th className="border-b border-r border-studio-border px-3 py-2.5">{tx("Content")}</th>
              <th className="border-b border-r border-studio-border px-3 py-2.5">{tx("Narration")}</th>
              <th className="border-b border-r border-studio-border px-3 py-2.5">{tx("Duration")}</th>
              <th className="border-b border-studio-border px-3 py-2.5">{tx("Scene plan")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.index} className="group align-top transition-colors hover:bg-panel-hover/30">
                <td className="border-b border-r border-studio-border px-3 py-3 text-center text-[11px] font-semibold tabular-nums text-studio-muted">
                  {String(row.index).padStart(2, "0")}
                </td>
                <td className="border-b border-r border-studio-border p-2">
                  <div className="truncate px-2 pt-1 text-[11px] font-semibold text-panel-text-2">{row.title}</div>
                  <textarea
                    rows={4}
                    className={inputClass}
                    value={row.content}
                    placeholder={tx("What this scene communicates")}
                    onChange={(event) => updateRow(row.index, "content", event.currentTarget.value)}
                  />
                </td>
                <td className="border-b border-r border-studio-border p-2">
                  <textarea
                    rows={5}
                    className={inputClass}
                    value={row.voiceover}
                    placeholder={tx("Final narration, or none")}
                    onChange={(event) => updateRow(row.index, "voiceover", event.currentTarget.value)}
                  />
                </td>
                <td className="border-b border-r border-studio-border p-2">
                  <input
                    className={`${inputClass} h-8 text-center tabular-nums`}
                    value={row.duration}
                    placeholder="5s"
                    onChange={(event) => updateRow(row.index, "duration", event.currentTarget.value)}
                  />
                </td>
                <td className="border-b border-studio-border p-2">
                  <label className="block">
                    <span className={fieldLabelClass}>{tx("What appears")}</span>
                    <textarea
                      rows={2}
                      className={inputClass}
                      value={row.visual}
                      placeholder={tx("Describe the picture, layout, and movement")}
                      onChange={(event) => updateRow(row.index, "visual", event.currentTarget.value)}
                    />
                  </label>
                  <div className="mt-1 grid grid-cols-2 gap-1 border-t border-studio-border pt-1">
                    <label className="block pt-1">
                      <span className={fieldLabelClass}>{tx("Use these materials")}</span>
                      <textarea
                        rows={2}
                        className={inputClass}
                        value={row.assets}
                        placeholder={tx("Images, video, screenshots, or source files to show")}
                        onChange={(event) => updateRow(row.index, "assets", event.currentTarget.value)}
                      />
                    </label>
                    <label className="block pt-1">
                      <span className={fieldLabelClass}>{tx("Prepare materials")}</span>
                      <textarea
                        rows={2}
                        className={inputClass}
                        value={row.assetTask}
                        placeholder={tx("What AI should find or generate, if anything")}
                        onChange={(event) => updateRow(row.index, "assetTask", event.currentTarget.value)}
                      />
                    </label>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
