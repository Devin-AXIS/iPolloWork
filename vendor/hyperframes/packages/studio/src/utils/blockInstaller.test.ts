// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addBlockToProject,
  resolveEffectPlacement,
  shiftTimelineContentInSource,
} from "./blockInstaller";
import type { TimelineElement } from "../player";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("addBlockToProject", () => {
  const clips: TimelineElement[] = [
    {
      id: "scene-a",
      domId: "scene-a",
      tag: "div",
      start: 0,
      duration: 4,
      track: 0,
      sourceFile: "index.html",
    },
    {
      id: "scene-b",
      domId: "scene-b",
      tag: "div",
      start: 4,
      duration: 5,
      track: 0,
      sourceFile: "index.html",
    },
    {
      id: "overlay",
      domId: "overlay",
      tag: "div",
      start: 1.4,
      duration: 1,
      track: 5,
      zIndex: 12,
      sourceFile: "index.html",
    },
  ];

  it("resolves opening, ending, and transition effect placement semantics", () => {
    expect(
      resolveEffectPlacement({
        intent: "opening",
        duration: 3,
        currentTime: 2,
        rootDuration: 9,
        targetPath: "index.html",
        timelineElements: clips,
      }),
    ).toEqual({ start: 0, track: 0, shiftExistingBy: 3 });
    expect(
      resolveEffectPlacement({
        intent: "ending",
        duration: 3,
        currentTime: 2,
        rootDuration: 9,
        targetPath: "index.html",
        timelineElements: clips,
      }),
    ).toEqual({ start: 9, track: 0, shiftExistingBy: 0 });
    expect(
      resolveEffectPlacement({
        intent: "transition",
        duration: 1,
        currentTime: 0,
        rootDuration: 9,
        targetPath: "index.html",
        timelineElements: clips,
        selectedElementId: "scene-a",
      }),
    ).toEqual({ start: 3.5, track: 6, shiftExistingBy: 0 });
  });

  it("shifts authored clips when an opening effect is inserted", () => {
    const source =
      '<main data-composition-id="root" data-duration="9"><div id="scene-a" data-start="0" data-duration="4"></div><div id="scene-b" data-start="4" data-duration="5"></div></main>';
    const shifted = shiftTimelineContentInSource(source, clips, "index.html", 3);
    expect(shifted).toContain('id="scene-a" data-start="3"');
    expect(shifted).toContain('id="scene-b" data-start="7"');
  });

  it("makes installed component document backgrounds transparent without removing inner effect backgrounds", async () => {
    const files: Record<string, string> = {
      "index.html": [
        '<div id="root" data-composition-id="root" data-width="1920" data-height="1080" data-duration="6">',
        '  <div id="title" data-start="0" data-duration="6" data-track-index="0">Hello</div>',
        "</div>",
      ].join("\n"),
      "compositions/components/morph-text.html": [
        "<style>",
        "html,",
        "body {",
        "  margin: 0;",
        "  background: #fff;",
        "}",
        ".highlight {",
        "  background: #e7e5e7;",
        "}",
        "</style>",
        '<div id="morph-text"><span class="highlight">Text</span></div>',
      ].join("\n"),
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        written: ["compositions/components/morph-text.html"],
        block: {
          name: "morph-text",
          title: "Morph Text",
          type: "hyperframes:component",
        },
      }),
    } as Response);

    const writes: Record<string, string[]> = {};

    await addBlockToProject({
      projectId: "project-1",
      blockName: "morph-text",
      activeCompPath: "index.html",
      timelineElements: [],
      readProjectFile: async (path) => files[path] ?? "",
      writeProjectFile: async (path, content) => {
        files[path] = content;
        writes[path] = [...(writes[path] ?? []), content];
      },
      recordEdit: vi.fn(),
      markStudioWrite: vi.fn(),
      refreshFileTree: vi.fn(),
      reloadPreview: vi.fn(),
      showToast: vi.fn(),
    });

    expect(files["compositions/components/morph-text.html"]).toContain("background: transparent;");
    expect(files["compositions/components/morph-text.html"]).not.toContain("background: #fff;");
    expect(files["compositions/components/morph-text.html"]).toContain("background: #e7e5e7;");
    const writtenIndex = writes["index.html"]?.at(-1);
    expect(writtenIndex).toContain(
      'style="position: absolute; left: 0px; top: 0px; width: 1920px; height: 1080px; z-index: 1"',
    );
    expect(writtenIndex).toContain(
      'data-composition-src="compositions/components/morph-text.html"',
    );
    expect(writtenIndex).not.toContain("data-hf-edit-as-unit");
  });

  it("uses the timeline z-index snapshot without reading preview layout", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        written: ["compositions/effects/focus-title.html"],
        block: {
          name: "focus-title",
          title: "Focus Title",
          type: "hyperframes:block",
          duration: 3.2,
        },
      }),
    } as Response);

    let writtenIndex = "";
    await addBlockToProject({
      projectId: "project-1",
      blockName: "focus-title",
      activeCompPath: "index.html",
      effectIntent: "ending",
      timelineElements: clips,
      readProjectFile: async () =>
        '<main data-composition-id="root" data-width="1920" data-height="1080" data-duration="9"></main>',
      writeProjectFile: async (_path, content) => {
        writtenIndex = content;
      },
      recordEdit: vi.fn(),
      markStudioWrite: vi.fn(),
      refreshFileTree: vi.fn(),
      reloadPreview: vi.fn(),
      showToast: vi.fn(),
    });

    expect(writtenIndex).toContain("z-index: 13");
  });

  it("fits a landscape ending effect into a portrait composition without changing its aspect", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        written: ["compositions/effects/effect-ending-douyin-follow.html"],
        block: {
          name: "effect-ending-douyin-follow",
          title: "Douyin Follow",
          type: "hyperframes:block",
          librarySection: "ending-effect",
          dimensions: { width: 1920, height: 1080 },
          duration: 3.2,
        },
      }),
    } as Response);

    let writtenIndex = "";
    await addBlockToProject({
      projectId: "project-1",
      blockName: "effect-ending-douyin-follow",
      activeCompPath: "index.html",
      effectIntent: "ending",
      timelineElements: [],
      readProjectFile: async () =>
        '<main data-composition-id="root" data-width="1080" data-height="1920" data-duration="6"></main>',
      writeProjectFile: async (_path, content) => {
        writtenIndex = content;
      },
      recordEdit: vi.fn(),
      markStudioWrite: vi.fn(),
      refreshFileTree: vi.fn(),
      reloadPreview: vi.fn(),
      showToast: vi.fn(),
    });

    expect(writtenIndex).toContain('data-width="1080"');
    expect(writtenIndex).toContain('data-height="608"');
    expect(writtenIndex).toContain('data-hf-edit-as-unit=""');
    expect(writtenIndex).toContain('data-hf-content-fit="contain"');
    expect(writtenIndex).toContain(
      "left: 0px; top: 656px; width: 1080px; height: 608px",
    );
  });

  it("starts the preview reload before refreshing the file tree", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        written: ["compositions/effects/focus-title.html"],
        block: {
          name: "focus-title",
          title: "Focus Title",
          type: "hyperframes:block",
          duration: 3.2,
        },
      }),
    } as Response);

    const calls: string[] = [];
    await addBlockToProject({
      projectId: "project-1",
      blockName: "focus-title",
      activeCompPath: "index.html",
      effectIntent: "opening",
      timelineElements: [],
      readProjectFile: async () =>
        '<main data-composition-id="root" data-width="1920" data-height="1080" data-duration="6"></main>',
      writeProjectFile: vi.fn(),
      recordEdit: vi.fn(),
      markStudioWrite: () => {
        calls.push("mark-write");
      },
      refreshFileTree: async () => {
        calls.push("file-tree");
      },
      reloadPreview: () => {
        calls.push("preview");
      },
      showToast: vi.fn(),
    });

    expect(calls).toEqual(["mark-write", "mark-write", "preview", "file-tree"]);
  });
});
