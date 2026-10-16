// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStoryboard } from "@hyperframes/core/storyboard";
import { storyboardSettingsRequestSchema } from "@ipollowork/types/hyperframes";

const mocks = vi.hoisted(() => ({
  writeProjectFile: vi.fn(async (_path: string, _content: string, _base?: string): Promise<void> => undefined),
  assets: [] as string[],
  uploadProjectFiles: vi.fn(async (_files: File[]): Promise<string[]> => ["media/imported.png"]),
  setViewMode: vi.fn((_mode: string) => true),
}));

vi.mock("../../contexts/FileManagerContext", () => ({
  useFileManagerContext: () => ({
    writeProjectFile: mocks.writeProjectFile,
    assets: mocks.assets,
    fileTreeLoaded: true,
    uploadProjectFiles: mocks.uploadProjectFiles,
  }),
}));

vi.mock("../../contexts/ViewModeContext", () => ({
  useViewMode: () => ({ registerViewModeGuard: () => () => undefined, setViewMode: mocks.setViewMode }),
}));
vi.mock("../../hooks/useBlockCatalog", () => ({
  useBlockCatalog: () => ({ sections: [{ items: [{ name: "flowchart", title: "Flowchart", variables: [] }, {
    name: "spatial-camera-suite",
    variables: [{ id: "shotStyle", type: "enum", options: [{ value: "depth-layer-moves", label: "Depth Layer Moves · 景深层移" }] }],
  }] }] }),
}));

vi.mock("../nle/NLEContext", () => ({ useNLEContextOptional: () => null }));

import { StoryboardTable } from "./StoryboardTable";
import { usePlayerStore } from "../../player/store/playerStore";

const source = `---
message: Demo
music_prompt: ""
visual_style: "Film"
---

## Frame 1 — Opening
- duration: 5s
- speaker: "Narrator"
- voice_id: ""
- voiceover: "Welcome"
- camera: "camera.oblique-glide"
- asset_source: "existing"
- asset_reference: "media/cover.png"
- sound_effects: "Subtle hit at 1s"
`;

function response() {
  const parsed = parseStoryboard(source);
  return {
    exists: true,
    path: "STORYBOARD.md",
    globals: parsed.globals,
    source,
    frames: parsed.frames.map((frame) => ({ ...frame, srcExists: false })),
    warnings: parsed.warnings,
    signature: "test-signature",
  };
}

function setControlValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("Native value setter is unavailable");
  flushSync(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

describe("StoryboardTable interactions", () => {
  let container: HTMLDivElement;
  let root: Root;

  it("shows self-drawn graphics in the structure field without exposing production internals", async () => {
    const plan = source + '- custom_reason: "Draw the explanation directly"\n- asset_source: "code"\n';
    const parsed = parseStoryboard(plan);
    const data = { ...response(), source: plan, ...parsed, frames: parsed.frames.map(frame => ({ ...frame, srcExists: false })) };
    await act(async () => root.render(<StoryboardTable key="custom-graphics" projectId="project-1" data={data} onSaved={vi.fn()} />));
    expect(container.querySelector('[data-testid="storyboard-structure-1"]')?.textContent).toContain("Custom graphics");
    expect(container.textContent).not.toContain("Production details");
    expect(container.textContent).not.toContain("Draw the explanation directly");
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    usePlayerStore.getState().reset();
    usePlayerStore.getState().clearSeekRequest();
    mocks.setViewMode.mockReset().mockReturnValue(true);
    mocks.writeProjectFile.mockReset().mockResolvedValue(undefined);
    mocks.uploadProjectFiles.mockReset().mockResolvedValue(["media/imported.png"]);
    mocks.assets = ["media/cover.png", "media/music-bed.mp3", "media/hit.wav"];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    flushSync(() =>
      root.render(
        <StoryboardTable projectId="project-1" data={response()} onSaved={vi.fn()} />,
      ),
    );
    const settingsToggle = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Whole-video direction"),
    );
    const shotSettings = container.querySelector<HTMLButtonElement>('[aria-controls="storyboard-shot-settings"]');
    if (!shotSettings) throw new Error("Shot settings missing");
    flushSync(() => shotSettings.click());
    if (!settingsToggle) throw new Error("Whole-video settings toggle missing");
    flushSync(() => settingsToggle.click());
  });

  function click(label: string) {
    const button = [...container.querySelectorAll("button")].find(item => item.textContent === label);
    if (!button) throw new Error("Button missing: " + label);
    flushSync(() => button.click());
  }
  function clickEntry(kind: "picture" | "sound") {
    const button = container.querySelector<HTMLButtonElement>(`[data-testid="storyboard-${kind}-picker-1"]`);
    if (!button) throw new Error("Entry missing: " + kind);
    flushSync(() => button.click());
  }
  function applySettings() {
    if (container.querySelector("#storyboard-shot-settings")) click("Apply to script");
  }

  it("keeps one picture entry in compact mode and presents recipes as read-only information", async () => {
    await act(async () => root.render(<StoryboardTable projectId="project-1" data={response()} onSaved={vi.fn()} compact />));
    expect(container.textContent).not.toContain("Visuals, voice and materials in one plan");
    expect(container.querySelector('[data-testid="storyboard-picture-picker-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="storyboard-voice-picker-1"]')).toBeNull();
    expect(container.querySelector(".hf-script-recipe-action")).toBeNull();
    const recipe = container.querySelector('[data-testid="storyboard-recipe-1"]');
    expect(recipe).toBeNull();
    expect(container.querySelector('[data-testid="storyboard-structure-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="storyboard-sound-picker-1"]')).not.toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="storyboard-settings-toggle-1"]');
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    flushSync(() => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("tr[data-shot]")?.getAttribute("data-expanded")).toBe("true");
    expect(container.querySelector("#storyboard-shot-content-1")).not.toBeNull();
    const picture = container.querySelector<HTMLButtonElement>('[data-testid="storyboard-picture-picker-1"]');
    expect(picture).not.toBeNull();
    flushSync(() => picture?.click());
    expect(container.querySelector("#storyboard-settings-title")?.textContent).toBe("Picture & materials");
    click("Cancel");
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });

  it("saves picture structure through the existing recipe field and restores it on reload", async () => {
    click("Cancel");
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="storyboard-structure-1"]');
    if (!trigger) throw new Error("Picture structure prototype missing");
    flushSync(() => trigger.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === "Flowchart");
    if (!option) throw new Error("Flowchart prototype option missing");
    flushSync(() => option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    flushSync(() => option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    flushSync(() => option.click());
    expect(trigger.textContent).toContain("Flowchart");
    expect(container.textContent).not.toContain("Preview only.");
    expect(container.querySelector('label[for="storyboard-structure-1"]')?.textContent).toBe("Picture structure");
    expect(container.querySelector('[aria-label="Estimated duration 1"]')).not.toBeNull();
    expect(container.textContent).toContain("Unsaved changes");
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
    await act(async () => click("Save script"));
    const savedSource = mocks.writeProjectFile.mock.calls[0]?.[1];
    if (!savedSource) throw new Error("Saved storyboard missing");
    expect(parseStoryboard(savedSource).frames[0]?.extra.recipe).toBe("flowchart");
    expect(mocks.writeProjectFile.mock.calls[0]?.[2]).toBe(source);
    const parsed = parseStoryboard(savedSource);
    await act(async () => root.render(<StoryboardTable key="reloaded" projectId="project-1" data={{ ...response(), ...parsed, source: savedSource, frames: parsed.frames.map(frame => ({ ...frame, srcExists: false })) }} onSaved={vi.fn()} />));
    expect(container.querySelector('[data-testid="storyboard-structure-1"]')?.textContent).toContain("Flowchart");
    expect(container.textContent).not.toContain("Unsaved changes");
  });

  it("clears stale scene metadata when changing the existing recipe and keeps source media", async () => {
    const plan = source + '- recipe: "previous-structure"\n- scene_id: "old-scene"\n- recipe_intent: "Old intent"\n';
    const parsed = parseStoryboard(plan);
    await act(async () => root.render(<StoryboardTable key="existing-recipe" projectId="project-1" data={{ ...response(), ...parsed, source: plan, frames: parsed.frames.map(frame => ({ ...frame, srcExists: false })) }} onSaved={vi.fn()} />));
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="storyboard-structure-1"]');
    expect(trigger?.textContent).toContain("previous-structure");
    flushSync(() => trigger?.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === "Flowchart");
    if (!option) throw new Error("Installed recipe missing");
    flushSync(() => option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    flushSync(() => option.click());
    await act(async () => click("Save script"));
    const savedSource = mocks.writeProjectFile.mock.calls[0]?.[1];
    if (!savedSource) throw new Error("Saved storyboard missing");
    const frame = parseStoryboard(savedSource).frames[0];
    expect(frame?.extra.recipe).toBe("flowchart");
    expect(frame?.extra.scene_id).toBeUndefined();
    expect(frame?.extra.recipe_intent).toBeUndefined();
    expect(frame?.assetReference).toBe("media/cover.png");
    expect(frame?.voiceover).toBe("Welcome");
  });

  it("keeps the chosen structure as an unsaved draft after a failed save", async () => {
    click("Cancel");
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="storyboard-structure-1"]');
    flushSync(() => trigger?.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === "Flowchart");
    if (!option) throw new Error("Installed recipe missing");
    flushSync(() => option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    flushSync(() => option.click());
    mocks.writeProjectFile.mockRejectedValueOnce(new Error("Save conflict"));
    await act(async () => click("Save script"));
    expect(container.textContent).toContain("Save conflict");
    expect(container.textContent).toContain("Unsaved changes");
    expect(trigger?.textContent).toContain("Flowchart");
    await act(async () => click("Save script"));
    const savedSource = mocks.writeProjectFile.mock.calls[1]?.[1];
    if (!savedSource) throw new Error("Retried draft missing");
    expect(parseStoryboard(savedSource).frames[0]?.extra.recipe).toBe("flowchart");
  });

  it("separates picture structure, materials and sound into their own table columns", () => {
    click("Cancel");
    expect([...container.querySelectorAll("thead th")].map(cell => cell.querySelector("span")?.textContent)).toEqual([
      "#", "Picture & scene", "Narration", "Estimated duration", "Picture structure", "Materials", "Sound effects", "Actions",
    ]);
    const row = container.querySelector("tr[data-shot]");
    expect(row?.children).toHaveLength(8);
    expect(row?.children[4].querySelector('[data-testid="storyboard-structure-1"]')).not.toBeNull();
    expect(row?.children[5].querySelector('[data-testid="storyboard-picture-picker-1"]')).not.toBeNull();
    expect(row?.children[6].querySelector('[data-testid="storyboard-sound-picker-1"]')).not.toBeNull();
    expect(row?.children[7].querySelector('[aria-label="Delete shot 1"]')).not.toBeNull();
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("locates the matching visual scene without writing the script", async () => {
    click("Cancel");
    const shot = { id: "opening", domId: "opening", key: "index.html#opening", tag: "section", start: 0, duration: 5, track: 0 };
    await act(async () => usePlayerStore.setState({ isPlaying: true, elements: [shot] }));
    const locate = container.querySelector<HTMLButtonElement>('[data-testid="storyboard-locate-1"]');
    expect(locate?.disabled).toBe(false);
    expect(locate?.textContent).toBe("01");
    expect(locate?.getAttribute("draggable")).not.toBe("true");
    expect(container.querySelector('.hf-script-reorder')?.textContent).not.toContain("01");
    await act(async () => locate?.click());
    expect(usePlayerStore.getState().selectedElementId).toBe("index.html#opening");
    expect(usePlayerStore.getState().requestedSeekTime).toBe(0);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(mocks.setViewMode).toHaveBeenCalledWith("timeline");
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
    expect(container.querySelector('.hf-script-reorder')).not.toBeNull();
  });

  it("keeps the locator visible but disabled for missing clips or unsaved edits", async () => {
    click("Cancel");
    const locate = () => container.querySelector<HTMLButtonElement>('[data-testid="storyboard-locate-1"]');
    expect(locate()?.disabled).toBe(true);
    await act(async () => usePlayerStore.setState({ elements: [{ id: "opening", tag: "section", start: 0, duration: 5, track: 0 }] }));
    expect(locate()?.disabled).toBe(false);
    const narration = container.querySelector<HTMLTextAreaElement>("#storyboard-narration-1");
    setControlValue(narration!, "Revised narration");
    expect(locate()?.disabled).toBe(true);
    expect(narration?.value).toBe("Revised narration");
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });

  it("opens independent picture and sound dialogs without hidden tabs or extra rows", () => {
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(container.querySelector("#storyboard-settings-title")?.textContent).toBe("Picture & materials");
    expect(container.querySelector("#storyboard-sound-effects-1")).toBeNull();
    click("Cancel");
    clickEntry("sound");
    expect(container.querySelector("#storyboard-settings-title")?.textContent).toBe("Sound effects");
    expect(container.querySelector('[aria-label="Material source 1"]')).toBeNull();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  it("voice selections update the same draft without closing or writing automatically", async () => {
    await act(async () => window.dispatchEvent(new MessageEvent("message", {
      source: window.parent,
      data: { type: "ipollowork:video-studio-voice-selected", projectId: "project-1", frameIndex: 1, voiceId: "example-voice", model: "example-model", name: "Warm narrator" },
    })));
    expect(container.querySelector("#storyboard-shot-settings")).not.toBeNull();
    expect(container.querySelector('[data-testid="storyboard-voice-picker-1"]')?.textContent).toContain("Warm narrator");
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
    const save = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Save script"));
    if (!save) throw new Error("Save script missing");
    await act(async () => { save.click(); await Promise.resolve(); });
    const savedText = mocks.writeProjectFile.mock.calls[0]?.[1];
    expect(typeof savedText).toBe("string");
    if (typeof savedText !== "string") throw new Error("Saved script missing");
    expect(parseStoryboard(savedText).frames[0]).toMatchObject({ voiceId: "example-voice", voiceModel: "example-model", voiceName: "Warm narrator" });
  });

  it("cancel discards modal edits, apply updates only the draft, and save persists", async () => {
    click("Cancel");
    clickEntry("sound");
    const effect = container.querySelector<HTMLTextAreaElement>("#storyboard-sound-effects-1");
    if (!effect) throw new Error("Sound field missing");
    setControlValue(effect, "Discard this");
    click("Cancel");
    clickEntry("sound");
    const reopened = container.querySelector<HTMLTextAreaElement>("#storyboard-sound-effects-1");
    if (!reopened) throw new Error("Reopened sound missing");
    expect(reopened.value).toBe("Subtle hit at 1s");
    setControlValue(reopened, "A click at the reveal");
    click("Apply to script");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
    clickEntry("sound");
    expect(container.querySelector<HTMLTextAreaElement>("#storyboard-sound-effects-1")?.value).toBe("A click at the reveal");
    click("Cancel");
    await act(async () => click("Save script"));
    expect(parseStoryboard(mocks.writeProjectFile.mock.calls[0]![1]).frames[0]?.soundEffects).toBe("A click at the reveal");
  });

  it("protects a changed script from a stale dialog snapshot", async () => {
    const newer = source.replace("Welcome", "Updated on disk");
    const parsed = parseStoryboard(newer);
    await act(async () => root.render(<StoryboardTable projectId="project-1" data={{ ...response(), source: newer, ...parsed, frames: parsed.frames.map(frame => ({ ...frame, srcExists: false })) }} onSaved={vi.fn()} />));
    const apply = [...container.querySelectorAll("button")].find(button => button.textContent === "Apply to script");
    expect(apply?.disabled).toBe(true);
    click("Cancel");
    clickEntry("picture");
    const reopened = [...container.querySelectorAll("button")].find(button => button.textContent === "Apply to script");
    expect(reopened?.disabled).toBe(false);
    expect(container.querySelector<HTMLTextAreaElement>("#storyboard-narration-1")?.value).toBe("Updated on disk");
  });

  it("handles Escape only in the active dialog and restores the editing entry", () => {
    click("Cancel");
    const entry = container.querySelector<HTMLButtonElement>('[data-testid="storyboard-picture-picker-1"]');
    if (!entry) throw new Error("Picture entry missing");
    entry.focus();
    clickEntry("picture");
    const dialog = container.querySelector("#storyboard-shot-settings");
    if (!dialog) throw new Error("Settings dialog missing");
    const nested = document.createElement("div");
    nested.setAttribute("role", "dialog");
    const action = document.createElement("button");
    nested.append(action);
    dialog.append(nested);
    action.focus();
    flushSync(() => action.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector("#storyboard-shot-settings")).not.toBeNull();
    nested.remove();
    const close = container.querySelector<HTMLButtonElement>('[aria-label="Close shot settings"]');
    close?.focus();
    flushSync(() => close?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector("#storyboard-shot-settings")).toBeNull();
    expect(document.activeElement).toBe(entry);
  });

  it("keeps narration direct, omits role-name entry, and edits camera, asset, sound and timing", async () => {
    const narration = container.querySelector<HTMLTextAreaElement>("#storyboard-narration-1");
    const duration = container.querySelector<HTMLInputElement>("#storyboard-duration-1");
    const transition = container.querySelector<HTMLInputElement>("#storyboard-transition-1");
    if (!narration || !duration || !transition) {
      throw new Error("Expected labeled script controls were not rendered");
    }

    expect(container.querySelector("#storyboard-role-1")).toBeNull();
    expect(container.querySelector('[aria-label="Choose voice for narration 1"]')).not.toBeNull();
    click("Cancel");
    setControlValue(narration, "The product is ready.");
    setControlValue(duration, "6s");
    clickEntry("picture");
    const currentTransition = container.querySelector<HTMLInputElement>("#storyboard-transition-1");
    if (!currentTransition) throw new Error("Transition missing");
    setControlValue(currentTransition, "crossfade");

    const cameraGroup = container.querySelector('[aria-label="Choose camera and animation 1"]');
    const spatialGlide = [...(cameraGroup?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes("Focus push"),
    );
    if (!(spatialGlide instanceof HTMLButtonElement)) throw new Error("Camera choice missing");
    flushSync(() => spatialGlide.click());

    const aiGeneration = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Generate visual media"),
    );
    if (!(aiGeneration instanceof HTMLButtonElement)) throw new Error("Asset mode missing");
    flushSync(() => aiGeneration.click());
    const materialBrief = container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Material brief 1"]',
    );
    if (!materialBrief) throw new Error("AI material brief missing");
    setControlValue(materialBrief, "A warm studio portrait");
    applySettings();
    clickEntry("sound");
    const effects = container.querySelector<HTMLTextAreaElement>("#storyboard-sound-effects-1");
    if (!effects) throw new Error("Sound field missing");
    setControlValue(effects, "Soft impact at 2s");

    const save = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Save script"),
    );
    if (!(save instanceof HTMLButtonElement)) throw new Error("Save action missing");
    applySettings();
    flushSync(() => save.click());
    await Promise.resolve();

    expect(mocks.writeProjectFile).toHaveBeenCalledOnce();
    const [, savedText] = mocks.writeProjectFile.mock.calls[0] as unknown as [string, string, string];
    const saved = parseStoryboard(savedText);
    expect(saved.frames[0]).toMatchObject({
      speaker: "Narrator",
      voiceover: "The product is ready.",
      soundEffects: "Soft impact at 2s",
      duration: "6s",
      transitionIn: "crossfade",
      assetSource: "generate",
      assetBrief: "A warm studio portrait",
    });
    expect(saved.frames[0]?.camera).toContain("camera.push-in");
    expect(saved.frames[0]?.camera).not.toContain("camera.oblique-glide");
  });

  it("lets a selected asset be previewed and cleared without deleting the file", () => {
    const selectedAsset = container.querySelector<HTMLButtonElement>(
      '[aria-label="Select asset: cover.png"]',
    );
    if (!selectedAsset) throw new Error("Imported asset choice missing");
    flushSync(() => selectedAsset.click());

    const clear = container.querySelector<HTMLButtonElement>(
      '[aria-label="Clear selected asset 1"]',
    );
    if (!clear) throw new Error("Clear asset action missing");
    flushSync(() => clear.click());

    expect(container.querySelector('[aria-label="Clear selected asset 1"]')).toBeNull();
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });

  it("persists news sourcing and real spatial choreography while retaining the selected local visual", async () => {
    const legacy = source.replace('asset_source: "existing"', 'asset_source: "search"');
    const parsed = parseStoryboard(legacy);
    await act(async () => root.render(<StoryboardTable projectId="project-1" data={{ ...response(), source: legacy, ...parsed, frames: parsed.frames.map((frame) => ({ ...frame, srcExists: false })) }} onSaved={vi.fn()} />));
    click("Cancel");
    clickEntry("picture");
    expect(container.querySelector('[aria-label="Material source 1"] [aria-pressed="true"]')?.textContent).toBe("AI chooses the source");
    expect([...container.querySelectorAll('[aria-label="Material source 1"] button')].map((button) => button.textContent)).toEqual(["AI chooses the source", "Use project media", "Generate visual media", "No external media"]);
    const kind = container.querySelector<HTMLSelectElement>('[aria-label="Visual media type 1"]');
    const origin = container.querySelector<HTMLTextAreaElement>('[aria-label="Source and attribution 1"]');
    const brief = container.querySelector<HTMLTextAreaElement>('[aria-label="Material brief 1"]');
    const camera = container.querySelector<HTMLSelectElement>('[aria-label="Spatial camera choreography 1"]');
    if (!kind || !origin || !brief || !camera) throw new Error("Production fields missing");
    setControlValue(kind, "video");
    setControlValue(origin, "https://example.com/news — event on 2026-09-25");
    setControlValue(brief, "Find footage from this event; do not substitute a generated scene");
    setControlValue(camera, "depth-layer-moves");
    expect(container.querySelector('[aria-label="Preview: cover.png"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Choose one camera movement 1"] [aria-pressed="true"]')).toBeNull();
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Save script"));
    if (!save) throw new Error("Save action missing");
    applySettings();
    flushSync(() => save.click());
    await Promise.resolve();
    const [, savedText] = mocks.writeProjectFile.mock.calls[0] as unknown as [string, string, string];
    expect(parseStoryboard(savedText).frames[0]).toMatchObject({
      assetSource: "search",
      assetKind: "video",
      assetReference: "media/cover.png",
      assetOrigin: "https://example.com/news — event on 2026-09-25",
      camera: "component:spatial-camera-suite#depth-layer-moves",
    });
  });

  it("hides external asset controls when no media is needed", () => {
    const none = [...container.querySelectorAll('[aria-label="Material source 1"] button')].find((button) => button.textContent === "No external media");
    if (!(none instanceof HTMLButtonElement)) throw new Error("No media choice missing");
    flushSync(() => none.click());
    expect(container.textContent).toContain("HTML components only");
    expect(container.querySelector('[aria-label="Visual media type 1"]')).toBeNull();
    expect(container.querySelector('[aria-label="Material brief 1"]')).toBeNull();
    expect(container.querySelector('[aria-label="Browse visual assets 1"]')).toBeNull();
  });

  it("imports directly through the shared file manager and reports unsuccessful uploads", async () => {
    const input = container.querySelector<HTMLInputElement>('[aria-label="Import media 1"]');
    if (!input) throw new Error("Direct import missing");
    const file = new File(["image"], "imported.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(mocks.uploadProjectFiles).toHaveBeenCalledWith([file]);
    expect(container.textContent).toContain("media/imported.png");
    mocks.uploadProjectFiles.mockResolvedValueOnce([]);
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No media imported");
    click("Cancel");
    clickEntry("sound");
    const audio = container.querySelector<HTMLInputElement>('[aria-label="Import audio 1"]');
    if (!audio) throw new Error("Audio import missing");
    Object.defineProperty(audio, "files", { configurable: true, value: [file] });
    await act(async () => audio.dispatchEvent(new Event("change", { bubbles: true })));
    expect(mocks.uploadProjectFiles).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Choose a compatible media file");
    const audioFile = new File(["audio"], "effect.wav", { type: "audio/wav" });
    Object.defineProperty(audio, "files", { configurable: true, value: [audioFile] });
    mocks.uploadProjectFiles.mockResolvedValueOnce(["media/effect.wav"]);
    await act(async () => audio.dispatchEvent(new Event("change", { bubbles: true })));
    expect(mocks.uploadProjectFiles).toHaveBeenLastCalledWith([audioFile]);
    expect(container.textContent).toContain("media/effect.wav");
    expect(container.textContent).not.toContain("Choose a compatible media file");
  });

  it("keeps visual and audio browsers separate and does not preview a missing reference as ready", async () => {
    const browse = container.querySelector<HTMLButtonElement>('[aria-label="Browse visual assets 1"]');
    if (!browse) throw new Error("Visual browser missing");
    flushSync(() => browse.click());
    const group = container.querySelector('[aria-label="Choose existing visual asset 1"]');
    expect(group?.querySelector('[aria-label="Select asset: music-bed.mp3"]')).toBeNull();
    expect(container.querySelector('[aria-label="Choose existing audio asset 1"]')).toBeNull();
    const updated = response();
    const missing = updated.source.replace("media/cover.png", "https://example.com/article");
    await act(async () => root.render(<StoryboardTable projectId="project-1" data={{ ...updated, source: missing, ...parseStoryboard(missing), frames: parseStoryboard(missing).frames.map((frame) => ({ ...frame, srcExists: false })) }} onSaved={vi.fn()} />));
    click("Cancel");
    clickEntry("picture");
    expect(container.textContent).toContain("Reference only — import the media file to use it");
    expect(container.querySelector('[aria-label="Preview: https://example.com/article"]')).toBeNull();
  });

  it("adds a shot and persists it to the canonical script", async () => {
    click("Cancel");
    const add = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Add shot"),
    );
    if (!(add instanceof HTMLButtonElement)) throw new Error("Add shot action missing");
    flushSync(() => add.click());

    const save = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Save script"),
    );
    if (!(save instanceof HTMLButtonElement)) throw new Error("Save action missing");
    applySettings();
    flushSync(() => save.click());
    await Promise.resolve();

    const [, savedText] = mocks.writeProjectFile.mock.calls[0] as unknown as [string, string, string];
    const saved = parseStoryboard(savedText);
    expect(saved.frames).toHaveLength(2);
    expect(saved.frames[1]?.title).toBe("New shot");
  });

  it("uses a compact shared add-shot button in the empty script", async () => {
    const data = response();
    await act(async () => root.render(<StoryboardTable key="empty" projectId="project-1" data={{ ...data, source: source.split("## Frame")[0], frames: [] }} onSaved={vi.fn()} compact />));
    const add = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Add shot"));
    expect(add?.getAttribute("data-slot")).toBe("button");
    expect(add?.className).not.toMatch(/w-full|border-dashed|py-4|hf-panel-hover/);
    expect(container.textContent).toContain("Start with the first shot");
  });

  it("reorders shots from the keyboard and persists the new order", async () => {
    const add = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Add shot"),
    );
    if (!(add instanceof HTMLButtonElement)) throw new Error("Add shot action missing");
    flushSync(() => add.click());

    const moveFirstDown = container.querySelector<HTMLButtonElement>('[aria-label="Move shot 1"]');
    if (!moveFirstDown) throw new Error("Keyboard shot-reorder action missing");
    flushSync(() =>
      moveFirstDown.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );

    const save = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Save script"),
    );
    if (!(save instanceof HTMLButtonElement)) throw new Error("Save action missing");
    applySettings();
    flushSync(() => save.click());
    await Promise.resolve();

    const [, savedText] = mocks.writeProjectFile.mock.calls[0] as unknown as [string, string, string];
    const saved = parseStoryboard(savedText);
    expect(saved.frames.map((frame) => frame.title)).toEqual(["New shot", "Opening"]);
  });

  it("deletes a shot only after confirmation", () => {
    const originalConfirm = Object.getOwnPropertyDescriptor(window, "confirm");
    const confirm = vi.fn(() => true);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    const remove = container.querySelector<HTMLButtonElement>('[aria-label="Delete shot 1"]');
    if (!remove) throw new Error("Delete shot action missing");
    flushSync(() => remove.click());

    expect(container.querySelectorAll("tbody tr[data-shot]")).toHaveLength(0);
    expect(confirm).toHaveBeenCalledOnce();
    if (originalConfirm) Object.defineProperty(window, "confirm", originalConfirm);
    else Reflect.deleteProperty(window, "confirm");
  });

  it("disables adding a shot while the script save is in flight", async () => {
    click("Cancel");
    let finishSave: (() => void) | undefined;
    mocks.writeProjectFile.mockImplementation(
      () => new Promise<void>((resolve) => { finishSave = resolve; }),
    );
    const narration = container.querySelector<HTMLTextAreaElement>("#storyboard-narration-1");
    if (!narration) throw new Error("Narration field missing");
    setControlValue(narration, "The product is ready.");

    const save = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Save script"),
    );
    if (!(save instanceof HTMLButtonElement)) throw new Error("Save action missing");
    applySettings();
    flushSync(() => save.click());

    const add = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Add shot"),
    );
    expect(add).toBeInstanceOf(HTMLButtonElement);
    expect((add as HTMLButtonElement).disabled).toBe(true);
    finishSave?.();
    await Promise.resolve();
  });

  it("saves the edited script before requesting production from its host", async () => {
    const iframe = document.createElement("iframe");
    container.append(iframe);
    const parent = iframe.contentWindow;
    if (!parent) throw new Error("Parent window missing");
    const postMessage = vi.spyOn(parent, "postMessage").mockImplementation(() => undefined);
    mocks.writeProjectFile.mockResolvedValue(undefined);
    vi.spyOn(window, "parent", "get").mockReturnValue(parent);
    flushSync(() => {
      root.unmount();
      root = createRoot(container);
      root.render(<StoryboardTable projectId="project-1" data={response()} onSaved={vi.fn()} />);
    });
    const narration = container.querySelector<HTMLTextAreaElement>("#storyboard-narration-1");
    if (!narration) throw new Error("Narration missing");
    setControlValue(narration, "Approved narration");
    const generate = [...container.querySelectorAll("button")].find(button =>
      button.textContent?.includes("Confirm script & generate video"));
    if (!generate) throw new Error("Generate action missing");
    await act(async () => { generate.click(); await Promise.resolve(); });
    expect(mocks.writeProjectFile).toHaveBeenCalledWith("STORYBOARD.md",
      expect.stringContaining("Approved narration"), source);
    const call = postMessage.mock.calls.find(([message]) =>
      message.type === "ipollowork:video-studio-generate");
    if (!call) throw new Error("Production request missing");
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { source: window.parent,
        data: { type: "ipollowork:video-studio-generate-result", projectId: "project-1",
          requestId: call[0].requestId, accepted: true } }));
    });
    expect(container.textContent).not.toContain("Could not start video generation");
  });

  it("does not request production when saving fails", async () => {
    const iframe = document.createElement("iframe");
    container.append(iframe);
    const parent = iframe.contentWindow;
    if (!parent) throw new Error("Parent window missing");
    const postMessage = vi.spyOn(parent, "postMessage").mockImplementation(() => undefined);
    mocks.writeProjectFile.mockResolvedValue(undefined);
    vi.spyOn(window, "parent", "get").mockReturnValue(parent);
    mocks.writeProjectFile.mockRejectedValueOnce(new Error("Disk write failed"));
    flushSync(() => {
      root.unmount();
      root = createRoot(container);
      root.render(<StoryboardTable projectId="project-1" data={response()} onSaved={vi.fn()} />);
    });
    const narration = container.querySelector<HTMLTextAreaElement>("#storyboard-narration-1");
    if (!narration) throw new Error("Narration missing");
    setControlValue(narration, "Unwritten narration");
    const generate = [...container.querySelectorAll("button")].find(button =>
      button.textContent?.includes("Confirm script & generate video"));
    if (!generate) throw new Error("Generate action missing");
    await act(async () => { generate.click(); await Promise.resolve(); });
    expect(postMessage.mock.calls.some(([message]) =>
      message.type === "ipollowork:video-studio-generate")).toBe(false);
    expect(container.textContent).toContain("Disk write failed");
  });

  it("explains why voice selection cannot open in a standalone preview", () => {
    const picker = container.querySelector<HTMLButtonElement>(
      '[data-testid="storyboard-voice-picker-1"]',
    );
    if (!picker) throw new Error("Voice picker action missing");
    flushSync(() => picker.click());

    expect(container.textContent).toContain("Standalone voice selection help");
  });

  it("saves exact music and per-shot sound files from the same project asset library", async () => {
    const chooseMusic = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Choose from project assets"),
    );
    if (!(chooseMusic instanceof HTMLButtonElement)) throw new Error("Music asset choice missing");
    flushSync(() => chooseMusic.click());

    click("Cancel");
    clickEntry("sound");
    for (const index of [0, 1]) {
      const browse = container.querySelector<HTMLButtonElement>(`[aria-label="Browse audio assets ${index}"]`);
      if (!browse) throw new Error("Audio browser missing");
      flushSync(() => browse.click());
    }

    const music = container
      .querySelector('[aria-label="Choose existing audio asset 0"]')
      ?.querySelector<HTMLButtonElement>('[aria-label="Select asset: music-bed.mp3"]');
    const effect = container
      .querySelector('[aria-label="Choose existing audio asset 1"]')
      ?.querySelector<HTMLButtonElement>('[aria-label="Select asset: hit.wav"]');
    if (!music || !effect) {
      throw new Error(
        `Expected shared audio assets were not rendered (music=${Boolean(music)}, effect=${Boolean(effect)}, groups=${[...container.querySelectorAll('[role="group"]')].map((item) => item.getAttribute("aria-label")).join(",")})`,
      );
    }
    flushSync(() => effect.click());
    applySettings();
    flushSync(() => music.click());

    const save = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Save script"),
    );
    if (!(save instanceof HTMLButtonElement)) throw new Error("Save action missing");
    applySettings();
    flushSync(() => save.click());
    await Promise.resolve();

    const [, savedText] = mocks.writeProjectFile.mock.calls[0] as unknown as [string, string, string];
    const saved = parseStoryboard(savedText);
    expect(saved.globals.musicAsset).toBe("media/music-bed.mp3");
    expect(saved.frames[0]?.soundEffectReference).toBe("media/hit.wav");
  });

  it("opens the Work voice chooser for the selected role and applies its result", async () => {
    const originalParent = Object.getOwnPropertyDescriptor(window, "parent");
    const host = { postMessage: vi.fn() } as unknown as Window;
    try {
      flushSync(() => root.unmount());
      Object.defineProperty(window, "parent", { configurable: true, value: host });
      root = createRoot(container);
      flushSync(() =>
        root.render(
          <StoryboardTable projectId="project-1" data={response()} onSaved={vi.fn()} />,
        ),
      );
      flushSync(() =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: host,
            data: {
              type: "ipollowork:studio-host-context",
              projectId: "project-1",
              actions: { selectRoleVoice: true },
            },
          }),
        ),
      );

      const materialPicker = container.querySelector<HTMLButtonElement>('[data-testid="storyboard-picture-picker-1"]');
      if (!materialPicker) throw new Error("Material picker action missing");
      flushSync(() => materialPicker.click());
      const request = storyboardSettingsRequestSchema.parse(vi.mocked(host.postMessage).mock.calls.at(-1)?.[0]);
      expect(request.kind).toBe("picture");
      expect(request.fields.asset_reference).toBe("media/cover.png");
      expect(document.querySelector("#storyboard-shot-settings")).toBeNull();
      flushSync(() => window.dispatchEvent(new MessageEvent("message", {
        source: host,
        data: {
          type: "ipollowork:video-studio-settings-apply", projectId: "wrong-project", requestId: request.requestId,
          fields: { ...request.fields, asset_brief: "Must not apply" },
        },
      })));
      expect(mocks.writeProjectFile).not.toHaveBeenCalled();
      flushSync(() => window.dispatchEvent(new MessageEvent("message", {
        source: host,
        data: {
          type: "ipollowork:video-studio-settings-apply", projectId: request.projectId, requestId: request.requestId,
          fields: { ...request.fields, asset_brief: "Approved visual brief" },
        },
      })));
      expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: "ipollowork:video-studio-settings-apply-result", requestId: request.requestId, accepted: true,
      }), "*");
      expect(mocks.writeProjectFile).not.toHaveBeenCalled();

      const picker = container.querySelector<HTMLButtonElement>(
        '[data-testid="storyboard-voice-picker-1"]',
      );
      if (!picker) throw new Error("Voice picker action missing");
      flushSync(() => picker.click());
      expect(host.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ipollowork:video-studio-panel",
          projectId: "project-1",
          panel: "voice",
          frameIndex: 1,
          speaker: "Narrator",
        }),
        "*",
      );

      flushSync(() =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: host,
            data: {
              type: "ipollowork:video-studio-voice-selected",
              projectId: "project-1",
              frameIndex: 1,
              voiceId: "warm-voice",
              model: "cosyvoice-v3-flash",
              name: "Warm voice",
            },
          }),
        ),
      );
      expect(picker.textContent).toContain("Warm voice");

      const save = [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Save script"),
      );
      if (!(save instanceof HTMLButtonElement)) throw new Error("Save action missing");
      applySettings();
    flushSync(() => save.click());
      await Promise.resolve();
      const [, savedText] = mocks.writeProjectFile.mock.calls[0] as unknown as [
        string,
        string,
        string,
      ];
      expect(parseStoryboard(savedText).frames[0]).toMatchObject({
        assetBrief: "Approved visual brief",
        assetReference: "media/cover.png",
        voiceId: "warm-voice",
        voiceModel: "cosyvoice-v3-flash",
        voiceName: "Warm voice",
      });
    } finally {
      if (originalParent) Object.defineProperty(window, "parent", originalParent);
      else Reflect.deleteProperty(window, "parent");
    }
  });

  it("saves edits and asks the Work host to regenerate from the canonical script", async () => {
    const originalParent = Object.getOwnPropertyDescriptor(window, "parent");
    const host = { postMessage: vi.fn() } as unknown as Window;
    try {
      flushSync(() => root.unmount());
      Object.defineProperty(window, "parent", { configurable: true, value: host });
      root = createRoot(container);
      flushSync(() =>
        root.render(
          <StoryboardTable projectId="project-1" data={response()} onSaved={vi.fn()} />,
        ),
      );
      flushSync(() =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: host,
            data: {
              type: "ipollowork:studio-host-context",
              projectId: "project-1",
              actions: { regenerateFromStoryboard: true },
            },
          }),
        ),
      );
      const narration = container.querySelector<HTMLTextAreaElement>("#storyboard-narration-1");
      if (!narration) throw new Error("Narration field missing");
      setControlValue(narration, "Use the revised narration.");
      const regenerate = [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Save and regenerate video"),
      );
      if (!(regenerate instanceof HTMLButtonElement)) throw new Error("Regenerate action missing");
      await act(async () => {
        regenerate.click();
        await Promise.resolve();
      });
      expect(mocks.writeProjectFile).toHaveBeenCalledOnce();
      await vi.waitFor(() => {
        expect(host.postMessage).toHaveBeenCalledWith(
          { type: "ipollowork:video-studio-regenerate", projectId: "project-1" },
          "*",
        );
      });
    } finally {
      if (originalParent) Object.defineProperty(window, "parent", originalParent);
      else Reflect.deleteProperty(window, "parent");
    }
  });
});
