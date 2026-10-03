// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryboardGlobals } from "@hyperframes/core/storyboard";
import { StoryboardGlobalSettings } from "./StoryboardGlobalSettings";

vi.mock("../../contexts/FileManagerContext", () => ({
  useFileManagerContext: () => ({ assets: ["media/music-bed.mp3"], fileTreeLoaded: true }),
}));

describe("StoryboardGlobalSettings interactions", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onMusicChange = vi.fn();
  const onMusicAssetChange = vi.fn();
  const onThemeChange = vi.fn();
  const onVisualStyleChange = vi.fn();

  beforeEach(() => {
    onMusicChange.mockClear();
    onMusicAssetChange.mockClear();
    onThemeChange.mockClear();
    onVisualStyleChange.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    flushSync(() =>
      root.render(
        <StoryboardGlobalSettings
          projectId="project-1"
          globals={{ extra: {} } as StoryboardGlobals}
          disabled={false}
          onMusicChange={onMusicChange}
          onMusicAssetChange={onMusicAssetChange}
          onThemeChange={onThemeChange}
          onVisualStyleChange={onVisualStyleChange}
        />,
      ),
    );
    const settingsToggle = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Whole-video direction"),
    );
    if (!settingsToggle) throw new Error("Whole-video settings toggle missing");
    flushSync(() => settingsToggle.click());
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("offers AI or manual theme modes and applies a manually selected Work theme", () => {
    const postMessage = vi.spyOn(window, "postMessage");
    flushSync(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: {
            type: "ipollowork:studio-host-context",
            projectId: "project-1",
            designSystemThemes: [{ id: "editorial", name: "Editorial", category: "Story" }],
            designSystem: null,
          },
        }),
      ),
    );

    const manualMode = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Choose a theme"),
    );
    if (!(manualMode instanceof HTMLButtonElement)) throw new Error("Manual theme mode missing");
    flushSync(() => manualMode.click());
    const theme = container.querySelector<HTMLSelectElement>(
      '[aria-label="Choose video design theme"]',
    );
    if (!theme) throw new Error("Theme selector missing");
    expect(theme.options).toHaveLength(2);
    theme.value = "editorial";
    flushSync(() => theme.dispatchEvent(new Event("change", { bubbles: true })));

    expect(onThemeChange).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ipollowork:video-studio-select-theme",
        projectId: "project-1",
        themeId: "editorial",
        requestId: expect.any(String),
      }),
      "*",
    );
    const request = postMessage.mock.calls.find(([data]) => data.type === "ipollowork:video-studio-select-theme")?.[0];
    expect(theme.disabled).toBe(true);
    flushSync(() => window.dispatchEvent(new MessageEvent("message", { source: window, data: {
      type: "ipollowork:video-studio-theme-result", projectId: "project-1", requestId: "stale-request", themeId: "editorial", applied: true,
    } })));
    expect(onThemeChange).not.toHaveBeenCalled();
    flushSync(() => window.dispatchEvent(new MessageEvent("message", { source: window, data: {
      type: "ipollowork:video-studio-theme-result", projectId: "project-1", requestId: request.requestId, themeId: "editorial", applied: true,
    } })));
    expect(onThemeChange).toHaveBeenCalledWith("editorial");
  });

  it("keeps AI theme selection usable in a standalone Studio preview", () => {
    const automatic = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Let AI choose a suitable theme"),
    );
    if (!(automatic instanceof HTMLButtonElement)) throw new Error("AI theme mode missing");
    expect(automatic.disabled).toBe(false);
    flushSync(() => automatic.click());
    expect(onThemeChange).toHaveBeenCalledWith("ai-auto");
    expect(automatic.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps an optional music direction editable while AI chooses the track", () => {
    const prompt = container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Whole-video music prompt"]',
    );
    if (!prompt) throw new Error("Music prompt missing");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) throw new Error("Native input setter is unavailable");
    flushSync(() => {
      setter.call(prompt, "Quiet strings and a restrained pulse");
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onMusicChange).toHaveBeenCalledWith("Quiet strings and a restrained pulse");

    const automatic = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("AI chooses from the script"),
    );
    if (!(automatic instanceof HTMLButtonElement)) throw new Error("AI music control missing");
    flushSync(() => automatic.click());
    expect(onMusicChange).toHaveBeenCalledWith("Quiet strings and a restrained pulse");
    expect(onMusicAssetChange).not.toHaveBeenCalled();
  });

  it("pins an exact audio asset from the shared project media library", () => {
    const existing = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Choose from project assets"),
    );
    if (!(existing instanceof HTMLButtonElement)) throw new Error("Project music picker missing");
    flushSync(() => existing.click());

    const browse = container.querySelector<HTMLButtonElement>('[aria-label="Browse audio assets 0"]');
    if (!browse) throw new Error("Audio browser missing");
    flushSync(() => browse.click());

    const music = container.querySelector<HTMLButtonElement>(
      '[aria-label="Select asset: music-bed.mp3"]',
    );
    if (!music) throw new Error("Shared audio asset missing");
    flushSync(() => music.click());
    expect(onMusicAssetChange).toHaveBeenCalledWith("media/music-bed.mp3");
  });

  it("distinguishes pending music from an explicit no-music choice", () => {
    expect(container.textContent).toContain("Music pending");
    const none = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("No background music"));
    if (!none) throw new Error("No-music control missing");
    flushSync(() => none.click());
    expect(onMusicChange).toHaveBeenCalledWith("none");
    expect(onMusicAssetChange).toHaveBeenCalledWith("");
    expect(container.querySelector('[aria-label="Whole-video music prompt"]')).toBeNull();
  });

  it("loads no-music intent and clears it when returning to AI", async () => {
    await act(async () => root.render(<StoryboardGlobalSettings projectId="project-1" globals={{ extra: {}, musicPrompt: "none" }} disabled={false} onMusicChange={onMusicChange} onMusicAssetChange={onMusicAssetChange} onThemeChange={onThemeChange} onVisualStyleChange={onVisualStyleChange} />));
    const none = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("No background music"));
    expect(none?.getAttribute("aria-pressed")).toBe("true");
    const automatic = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("AI chooses from the script"));
    if (!automatic) throw new Error("AI music control missing");
    flushSync(() => automatic.click());
    expect(onMusicChange).toHaveBeenCalledWith("");
    expect(onMusicAssetChange).not.toHaveBeenCalled();
  });

  it("keeps the actual audio visible when AI direction is selected", () => {
    flushSync(() => root.render(<StoryboardGlobalSettings projectId="project-1" globals={{ extra: {}, musicPrompt: "Warm pulse", musicAsset: "media/music-bed.mp3" }} disabled={false} onMusicChange={onMusicChange} onMusicAssetChange={onMusicAssetChange} onThemeChange={onThemeChange} onVisualStyleChange={onVisualStyleChange} />));
    const automatic = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("AI chooses from the script"));
    if (!automatic) throw new Error("AI music control missing");
    flushSync(() => automatic.click());
    expect(container.textContent).toContain("Music selected");
    expect(container.querySelector('[aria-label="Browse audio assets 0"]')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('[aria-label="Whole-video music prompt"]')?.value).toBe("Warm pulse");
    expect(onMusicChange).not.toHaveBeenCalled();
    expect(onMusicAssetChange).not.toHaveBeenCalled();
  });
});
