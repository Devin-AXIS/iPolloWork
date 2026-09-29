import { ChevronDown, Music2, Sparkles } from "lucide-react";
import type { StoryboardGlobals } from "@hyperframes/core/storyboard";
import { useEffect, useMemo, useState } from "react";
import { useStudioI18n } from "../../i18n";
import { StoryboardAsset } from "./StoryboardAsset";
import { StoryboardPlanField } from "./StoryboardPlanField";

const AI_THEME = "ai-auto";

type HostTheme = { id: string; name: string; category?: string };

export function StoryboardGlobalSettings({
  projectId,
  globals,
  disabled,
  onMusicChange,
  onMusicAssetChange,
  onThemeChange,
  onVisualStyleChange,
}: {
  projectId: string;
  globals: StoryboardGlobals;
  disabled: boolean;
  onMusicChange: (value: string) => void;
  onMusicAssetChange: (value: string) => void;
  onThemeChange: (value: string) => void;
  onVisualStyleChange: (value: string) => void;
}) {
  const { tx } = useStudioI18n();
  const [hostThemes, setHostThemes] = useState<HostTheme[]>([]);
  const [manualThemeOpen, setManualThemeOpen] = useState(false);
  const [themeRequest, setThemeRequest] = useState<{ id: string; theme: string } | null>(null);
  const [themeError, setThemeError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [musicMode, setMusicMode] = useState<"auto" | "existing" | "none">(
    globals.musicPrompt?.trim().toLowerCase() === "none" ? "none" : globals.musicAsset?.trim() ? "existing" : "auto",
  );
  const themeOptions = useMemo(
    () => hostThemes.filter((theme) => theme.id && theme.name),
    [hostThemes],
  );
  const musicPrompt = globals.musicPrompt ?? "";
  const musicDisabled = musicPrompt.trim().toLowerCase() === "none";
  const musicAsset = globals.musicAsset ?? "";
  const selectedTheme = globals.theme || AI_THEME;
  const isKnownTheme = themeOptions.some((theme) => theme.id === selectedTheme);
  const hasCustomTheme = Boolean(selectedTheme && selectedTheme !== AI_THEME && !isKnownTheme);

  useEffect(() => {
    const handleHostContext = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (event.data?.type !== "ipollowork:studio-host-context") return;
      if (event.data.projectId !== projectId) return;
      const themes = event.data.designSystemThemes;
      setHostThemes(
        Array.isArray(themes)
          ? themes.filter(
              (theme): theme is HostTheme =>
                Boolean(theme) && typeof theme.id === "string" && typeof theme.name === "string",
            )
          : [],
      );
    };
    window.addEventListener("message", handleHostContext);
    if (window.parent !== window) {
      window.parent.postMessage({ type: "ipollowork:studio-host-context-request", projectId }, "*");
    }
    return () => window.removeEventListener("message", handleHostContext);
  }, [projectId]);

  useEffect(() => {
    if (!themeRequest) return;
    const receiveResult = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== "ipollowork:video-studio-theme-result") return;
      if (event.data.projectId !== projectId || event.data.requestId !== themeRequest.id || event.data.themeId !== themeRequest.theme) return;
      if (event.data.applied === true) onThemeChange(themeRequest.theme);
      else setThemeError(true);
      setThemeRequest(null);
    };
    const timeout = window.setTimeout(() => { setThemeRequest(null); setThemeError(true); }, 15_000);
    window.addEventListener("message", receiveResult);
    return () => { window.clearTimeout(timeout); window.removeEventListener("message", receiveResult); };
  }, [themeRequest, projectId, onThemeChange]);

  useEffect(() => {
    setManualThemeOpen(selectedTheme !== AI_THEME);
  }, [selectedTheme]);

  useEffect(() => {
    if (musicDisabled) setMusicMode("none");
    else if (musicAsset.trim()) setMusicMode("existing");
    else setMusicMode((mode) => mode === "none" ? "auto" : mode);
  }, [musicAsset, musicDisabled]);

  function selectTheme(value: string) {
    setThemeError(false);
    if (value === AI_THEME) {
      setManualThemeOpen(false);
      onThemeChange(AI_THEME);
      return;
    }
    setManualThemeOpen(true);
    if (!themeOptions.some((theme) => theme.id === value)) {
      onThemeChange(value);
      return;
    }
    // Do not pin a theme that the host could not actually apply.
    const requestId = crypto.randomUUID();
    setThemeRequest({ id: requestId, theme: value });
    window.parent.postMessage(
      {
        type: "ipollowork:video-studio-select-theme",
        projectId,
        themeId: value,
        requestId,
      },
      "*",
    );
  }

  function selectMusicMode(mode: "auto" | "existing" | "none") {
    setMusicMode(mode);
    if (mode === "none") {
      onMusicAssetChange("");
      onMusicChange("none");
    } else if (musicDisabled) onMusicChange("");
  }

  return (
    <section
      aria-label={tx("Whole-video settings")}
      className="hf-script-global mx-5 mb-4 min-w-0 shrink-0 overflow-hidden rounded-lg border border-[var(--hf-workspace-border)] bg-[var(--hf-panel-bg)]"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="storyboard-global-settings-body"
        onClick={() => setExpanded((value) => !value)}
        className="hf-script-global-toggle flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--hf-panel-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-studio-accent"
      >
        <span>
          <span className="block text-xs font-semibold text-[var(--hf-panel-text-1)]">{tx("Whole-video direction")}</span>
        </span>
        <span className="ml-auto truncate text-[11px] text-[var(--hf-panel-text-2)]">
          {tx(selectedTheme === AI_THEME ? "Automatic theme" : "Custom theme")} · {tx(musicDisabled ? "No music" : musicAsset ? "Choose from project assets" : "AI chooses from the script")}
        </span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && <div id="storyboard-global-settings-body" className="grid min-h-0 grid-cols-1 gap-5 border-t border-[var(--hf-workspace-hairline)] p-4 sm:grid-cols-2 lg:grid-cols-3">
      <div className="min-w-0">
        <span className="block mb-2 text-xs font-medium text-[var(--hf-panel-text-1)]">
          {tx("Video design theme")}
        </span>
        <div role="group" aria-label={tx("Theme selection mode")} className="flex flex-wrap gap-2">
          {([
            ["ai", "Let AI choose a suitable theme"],
            ["manual", "Choose a theme"],
          ] as const).map(([mode, label]) => {
            const selected = mode === "ai" ? !manualThemeOpen : manualThemeOpen;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={selected}
                disabled={disabled || themeRequest !== null}
                onClick={() => {
                  if (mode === "ai") selectTheme(AI_THEME);
                  else setManualThemeOpen(true);
                }}
                className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-studio-accent disabled:opacity-50 ${
                  selected
                    ? "border-studio-accent bg-studio-accent/10 text-[var(--hf-panel-text-0)]"
                    : "border-[var(--hf-workspace-border)] text-[var(--hf-panel-text-3)] hover:bg-[var(--hf-panel-hover)]"
                }`}
              >
                {mode === "ai" ? <Sparkles size={12} className="shrink-0" /> : null}
                {tx(label)}
              </button>
            );
          })}
        </div>
        {manualThemeOpen && (
          <select
            aria-label={tx("Choose video design theme")}
            value={themeRequest?.theme ?? (isKnownTheme || hasCustomTheme ? selectedTheme : "")}
            disabled={disabled || themeRequest !== null || themeOptions.length === 0}
            onChange={(event) => selectTheme(event.target.value)}
            className="mt-3 w-full min-w-0 rounded-lg border border-[var(--hf-workspace-border)] bg-[var(--hf-workspace-bg)] px-3 py-2 text-xs text-[var(--hf-panel-text-1)] outline-none focus:border-studio-accent disabled:opacity-60"
          >
            <option value="" disabled>{tx("Select an installed theme")}</option>
            {hasCustomTheme && (
              <option value={selectedTheme}>
                {tx("Current custom theme")}: {selectedTheme}
              </option>
            )}
            {themeOptions.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.category ? `${theme.category} · ` : ""}
                {theme.name}
              </option>
            ))}
          </select>
        )}
        {themeRequest && <p role="status" className="px-2 pt-1 text-xs">{tx("Applying")}</p>}
        {themeError && <p role="alert" className="px-2 pt-1 text-xs">{tx("Theme was not applied. Please try again in Work.")}</p>}
        {manualThemeOpen && themeOptions.length === 0 && (
          <p className="px-2 pt-1 text-[10px] text-[var(--hf-panel-text-4)]">
            {typeof window !== "undefined" && window.parent === window
              ? tx("Open in Work to choose installed themes")
              : tx("Theme choices are provided by the Work host")}
          </p>
        )}
      </div>

      <div className="min-w-0">
        <span className="block mb-2 text-xs font-medium text-[var(--hf-panel-text-1)]">
          {tx("Whole-video visual style")}
        </span>
        <StoryboardPlanField
          multiline rows={3}
          label={tx("Whole-video visual style")}
          placeholder={tx("Describe the overall visual style")}
          value={globals.visualStyle ?? ""}
          disabled={disabled}
          onChange={onVisualStyleChange}
        />
      </div>

      <div className="min-w-0">
        <span className="block mb-2 text-xs font-medium text-[var(--hf-panel-text-1)]">
          {tx("Whole-video music")}
        </span>
        <div role="group" aria-label={tx("Music direction mode")} className="flex flex-wrap gap-2">
          {(
            [
              ["auto", "AI chooses from the script"],
              ["existing", "Choose from project assets"],
              ["none", "No background music"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={musicMode === mode}
              disabled={disabled}
              onClick={() => selectMusicMode(mode)}
              className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-studio-accent disabled:opacity-50 ${
                musicMode === mode
                  ? "border-studio-accent bg-studio-accent/10 text-[var(--hf-panel-text-0)]"
                  : "border-[var(--hf-workspace-border)] text-[var(--hf-panel-text-3)] hover:bg-[var(--hf-panel-hover)]"
              }`}
            >
              {mode === "auto" ? (
                <Sparkles size={12} className="shrink-0" />
              ) : (
                <Music2 size={12} className="shrink-0" />
              )}
              {tx(label)}
            </button>
          ))}
        </div>
        {musicMode !== "none" && (
          <p className="mt-2 text-[11px] leading-5 text-[var(--hf-panel-text-3)]">
            {tx(musicAsset.trim() ? "Music selected — preview or replace below" : "Music pending — a real track must be prepared before video generation")}
          </p>
        )}
        {musicMode !== "none" && (musicMode === "existing" || Boolean(musicAsset.trim())) && (
          <StoryboardAsset
            projectId={projectId}
            index={0}
            reference={musicAsset}
            audioOnly
            disabled={disabled}
            onChange={(value) => {
              if (value && musicDisabled) onMusicChange("");
              onMusicAssetChange(value);
            }}
          />
        )}
        {musicMode !== "none" && <StoryboardPlanField
          multiline rows={2}
          label={tx("Whole-video music prompt")}
          placeholder={tx("Optional music direction for the AI")}
          value={musicPrompt}
          disabled={disabled}
          onChange={onMusicChange}
        />}
      </div>
      </div>}
    </section>
  );
}
