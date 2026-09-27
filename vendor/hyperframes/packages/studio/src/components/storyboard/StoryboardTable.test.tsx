// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStoryboard } from "@hyperframes/core/storyboard";

const mocks = vi.hoisted(() => ({
  writeProjectFile: vi.fn(async (): Promise<void> => undefined),
  assets: [] as string[],
  uploadProjectFiles: vi.fn(async (_files: File[]): Promise<string[]> => ["media/imported.png"]),
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
  useViewMode: () => ({ registerViewModeGuard: () => () => undefined }),
}));
vi.mock("../../hooks/useBlockCatalog", () => ({
  useBlockCatalog: () => ({ sections: [{ items: [{
    name: "spatial-camera-suite",
    variables: [{ id: "shotStyle", type: "enum", options: [{ value: "depth-layer-moves", label: "Depth Layer Moves · 景深层移" }] }],
  }] }] }),
}));

import { StoryboardTable } from "./StoryboardTable";

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

  beforeEach(() => {
    mocks.writeProjectFile.mockClear();
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
    if (!settingsToggle) throw new Error("Whole-video settings toggle missing");
    flushSync(() => settingsToggle.click());
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("keeps narration direct, omits role-name entry, and edits camera, asset, sound and timing", async () => {
    const narration = container.querySelector<HTMLTextAreaElement>("#storyboard-narration-1");
    const effects = container.querySelector<HTMLTextAreaElement>("#storyboard-sound-effects-1");
    const duration = container.querySelector<HTMLInputElement>("#storyboard-duration-1");
    const transition = container.querySelector<HTMLInputElement>("#storyboard-transition-1");
    if (!narration || !effects || !duration || !transition) {
      throw new Error("Expected labeled script controls were not rendered");
    }

    expect(container.querySelector("#storyboard-role-1")).toBeNull();
    expect(container.querySelector('[aria-label="Choose voice for narration 1"]')).not.toBeNull();
    setControlValue(narration, "The product is ready.");
    setControlValue(effects, "Soft impact at 2s");
    setControlValue(duration, "6s");
    setControlValue(transition, "crossfade");

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

    const save = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Save script"),
    );
    if (!(save instanceof HTMLButtonElement)) throw new Error("Save action missing");
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
    expect(container.textContent).toContain("Reference only — import the media file to use it");
    expect(container.querySelector('[aria-label="Preview: https://example.com/article"]')).toBeNull();
  });

  it("adds a shot and persists it to the canonical script", async () => {
    const add = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Add shot"),
    );
    if (!(add instanceof HTMLButtonElement)) throw new Error("Add shot action missing");
    flushSync(() => add.click());

    const save = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Save script"),
    );
    if (!(save instanceof HTMLButtonElement)) throw new Error("Save action missing");
    flushSync(() => save.click());
    await Promise.resolve();

    const [, savedText] = mocks.writeProjectFile.mock.calls[0] as unknown as [string, string, string];
    const saved = parseStoryboard(savedText);
    expect(saved.frames).toHaveLength(2);
    expect(saved.frames[1]?.title).toBe("New shot");
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
    flushSync(() => save.click());

    const add = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Add shot"),
    );
    expect(add).toBeInstanceOf(HTMLButtonElement);
    expect((add as HTMLButtonElement).disabled).toBe(true);
    finishSave?.();
    await Promise.resolve();
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
    flushSync(() => {
      music.click();
      effect.click();
    });

    const save = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Save script"),
    );
    if (!(save instanceof HTMLButtonElement)) throw new Error("Save action missing");
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
      flushSync(() => save.click());
      await Promise.resolve();
      const [, savedText] = mocks.writeProjectFile.mock.calls[0] as unknown as [
        string,
        string,
        string,
      ];
      expect(parseStoryboard(savedText).frames[0]).toMatchObject({
        voiceId: "warm-voice",
        voiceModel: "cosyvoice-v3-flash",
        voiceName: "Warm voice",
      });
    } finally {
      if (originalParent) Object.defineProperty(window, "parent", originalParent);
      else Reflect.deleteProperty(window, "parent");
    }
  });
});
