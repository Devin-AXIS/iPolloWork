// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addBlockToProject,
  injectRegistryVariableDeclarations,
  resolveInstalledComponentParams,
} from "./blockInstaller";
import type { RegistryItem, RegistryVariable } from "@hyperframes/core/registry";
import type { TimelineElement } from "../player";
import { applyPatchByTarget } from "./sourcePatcher";

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

  it("makes installed component document backgrounds transparent without removing inner backgrounds", async () => {
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
          visualComponent: {
            version: 1,
            category: "scene",
            surfaces: ["video"],
            themeMode: "inherit",
          },
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
    expect(files["compositions/components/morph-text.html"]).toContain(
      "data-ipw-component-theme-aliases",
    );
    expect(files["compositions/components/morph-text.html"]).toContain(
      "--component-text: var(--ipw-color-text, #15171a)",
    );
    const writtenIndex = writes["index.html"]?.at(-1);
    expect(writtenIndex).toContain(
      'style="position: absolute; left: 0px; top: 0px; width: 1920px; height: 1080px; z-index: 1; --component-accent: var(--ipw-color-primary, #20bbc0)',
    );
    expect(writtenIndex).toContain("--component-text: var(--ipw-color-text, #15171a)");
    expect(writtenIndex).toContain("--component-surface: var(--ipw-color-surface, #ffffff)");
    expect(writtenIndex).toContain("--component-muted: var(--ipw-color-muted, #68717c)");
    expect(writtenIndex).toContain("--component-border: var(--ipw-color-border, #d8dde3)");
    expect(writtenIndex).toContain(
      'data-composition-src="compositions/components/morph-text.html"',
    );
    expect(writtenIndex).toContain('data-ipw-theme-mode="inherit"');
    expect(writtenIndex).not.toContain("data-hf-edit-as-unit");
  });

  it("uses the timeline z-index snapshot without reading preview layout", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        written: ["compositions/components/route-map.html"],
        block: {
          name: "route-map",
          title: "Route Map",
          type: "hyperframes:block",
          duration: 3.2,
        },
      }),
    } as Response);

    let writtenIndex = "";
    await addBlockToProject({
      projectId: "project-1",
      blockName: "route-map",
      activeCompPath: "index.html",
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

  it("ripple-inserts a catalog animation at the playhead on an independent effect track", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        written: ["compositions/components/route-map.html"],
        block: {
          name: "route-map",
          title: "Route Map",
          type: "hyperframes:block",
          duration: 3.2,
        },
      }),
    } as Response);

    const files: Record<string, string> = {
      "index.html": [
        '<main data-composition-id="root" data-width="1920" data-height="1080" data-duration="9">',
        '  <div id="scene-a" data-start="0" data-duration="4" data-track-index="0"></div>',
        '  <div id="scene-b" data-start="4" data-duration="5" data-track-index="0"></div>',
        '  <div id="overlay" data-start="1.4" data-duration="1" data-track-index="5"></div>',
        "</main>",
      ].join("\n"),
    };
    const syncRippleGsap = vi.fn().mockResolvedValue(undefined);

    await addBlockToProject({
      projectId: "project-1",
      blockName: "route-map",
      activeCompPath: "index.html",
      currentTime: 4,
      insertionMode: "ripple",
      timelineElements: clips,
      readProjectFile: async (path) => files[path] ?? "",
      writeProjectFile: async (path, content) => {
        files[path] = content;
      },
      recordEdit: vi.fn(),
      markStudioWrite: vi.fn(),
      refreshFileTree: vi.fn(),
      reloadPreview: vi.fn(),
      showToast: vi.fn(),
      syncRippleGsap,
    });

    expect(files["index.html"]).toContain(
      'id="scene-a" data-start="0" data-duration="4" data-track-index="0"',
    );
    expect(files["index.html"]).toContain(
      'id="scene-b" data-start="7.2" data-duration="5" data-track-index="0"',
    );
    expect(files["index.html"]).toContain(
      'id="overlay" data-start="1.4" data-duration="1" data-track-index="5"',
    );
    expect(files["index.html"]).toContain('data-composition-id="route-map"');
    expect(files["index.html"]).toContain('data-start="4"');
    expect(files["index.html"]).toContain('data-duration="3.2"');
    expect(files["index.html"]).toContain('data-track-index="6"');
    expect(files["index.html"]).toContain('data-duration="12.2"');
    expect(syncRippleGsap).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [{ element: clips[1], start: 7.2 }],
        label: "Insert animation: Route Map",
      }),
    );
  });

  it("does not ripple the runtime root composition in an otherwise empty project", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        written: ["compositions/components/route-map.html"],
        block: {
          name: "route-map",
          title: "Route Map",
          type: "hyperframes:block",
          duration: 3.2,
        },
      }),
    } as Response);

    const files: Record<string, string> = {
      "index.html":
        '<main id="root" data-composition-id="main" data-width="1920" data-height="1080" data-duration="10"></main>',
    };
    const rootComposition: TimelineElement = {
      id: "main",
      tag: "main",
      start: 0,
      duration: 10,
      track: 0,
      parentCompositionId: null,
    };
    const syncRippleGsap = vi.fn().mockResolvedValue(undefined);

    await addBlockToProject({
      projectId: "project-1",
      blockName: "route-map",
      activeCompPath: "index.html",
      currentTime: 2,
      insertionMode: "ripple",
      timelineElements: [rootComposition],
      readProjectFile: async (path) => files[path] ?? "",
      writeProjectFile: async (path, content) => {
        files[path] = content;
      },
      recordEdit: vi.fn(),
      markStudioWrite: vi.fn(),
      refreshFileTree: vi.fn(),
      reloadPreview: vi.fn(),
      showToast: vi.fn(),
      syncRippleGsap,
    });

    expect(files["index.html"]).toContain('id="root" data-composition-id="main"');
    expect(files["index.html"]).not.toContain('id="root" data-start=');
    expect(files["index.html"]).toContain('data-composition-id="route-map"');
    expect(files["index.html"]).toContain('data-start="2"');
    expect(syncRippleGsap).not.toHaveBeenCalled();
  });

  it("gives each repeatedly inserted catalog animation its own effect track", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        written: ["compositions/components/route-map.html"],
        block: {
          name: "route-map",
          title: "Route Map",
          type: "hyperframes:block",
          duration: 3,
        },
      }),
    } as Response);

    const files: Record<string, string> = {
      "index.html": [
        '<main data-composition-id="root" data-width="1920" data-height="1080" data-duration="12">',
        '  <div id="background" data-start="0" data-duration="12" data-track-index="0"></div>',
        "</main>",
      ].join("\n"),
    };
    const background: TimelineElement = {
      id: "background",
      domId: "background",
      tag: "div",
      start: 0,
      duration: 12,
      track: 0,
      sourceFile: "index.html",
    };
    const install = (timelineElements: TimelineElement[], currentTime: number) =>
      addBlockToProject({
        projectId: "project-1",
        blockName: "route-map",
        activeCompPath: "index.html",
        currentTime,
        insertionMode: "ripple",
        timelineElements,
        readProjectFile: async (path) => files[path] ?? "",
        writeProjectFile: async (path, content) => {
          files[path] = content;
        },
        recordEdit: vi.fn(),
        markStudioWrite: vi.fn(),
        refreshFileTree: vi.fn(),
        reloadPreview: vi.fn(),
        showToast: vi.fn(),
      });

    await install([background], 2);
    await install([
      background,
      {
        id: "route-map",
        domId: "route-map",
        tag: "div",
        start: 2,
        duration: 3,
        track: 1,
        authoredTrack: 1,
        sourceFile: "index.html",
      },
    ], 5);

    expect(files["index.html"]).toMatch(
      /id="route-map"[\s\S]*?data-track-index="1"/,
    );
    expect(files["index.html"]).toMatch(
      /id="route-map_2"[\s\S]*?data-track-index="2"/,
    );
  });

  it("starts the preview reload before refreshing the file tree", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        written: ["compositions/components/route-map.html"],
        block: {
          name: "route-map",
          title: "Route Map",
          type: "hyperframes:block",
          duration: 3.2,
        },
      }),
    } as Response);

    const calls: string[] = [];
    await addBlockToProject({
      projectId: "project-1",
      blockName: "route-map",
      activeCompPath: "index.html",
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

describe("component instance variables", () => {
  it("rehydrates an existing component's catalog contract and instance values", () => {
    const variables: RegistryVariable[] = [
      { id: "title", label: "Title", type: "string", default: "Route", maxLength: 12 },
      { id: "speed", label: "Speed", type: "number", default: 1, min: 0.5, max: 2 },
    ];
    const catalog: RegistryItem[] = [
      {
        name: "route-map",
        title: "Route Map",
        description: "Reusable route",
        type: "hyperframes:block",
        dimensions: { width: 1920, height: 1080 },
        duration: 10,
        files: [
          {
            path: "route-map.html",
            target: "compositions/route-map.html",
            type: "hyperframes:composition",
          },
        ],
        variables,
        visualComponent: {
          version: 1,
          category: "maps",
          surfaces: ["video"],
          themeMode: "inherit",
        },
      },
    ];
    const element: TimelineElement = {
      id: "route-map-runtime",
      domId: "route-map_2",
      tag: "div",
      start: 0,
      duration: 10,
      track: 1,
      compositionSrc: "./compositions/route-map.html",
      sourceFile: "index.html",
    };
    const hostSource = [
      '<main data-composition-id="root">',
      '  <div id="route-map_2" data-variable-values=\'{"title":"A much longer route title","speed":9,"ignored":"x"}\'></div>',
      "</main>",
    ].join("\n");

    expect(
      resolveInstalledComponentParams({
        catalog,
        element,
        hostCompositionPath: "index.html",
        hostSource,
      }),
    ).toMatchObject({
      blockTitle: "Route Map",
      insertedElementId: "route-map_2",
      hostCompositionPath: "index.html",
      variableValues: { title: "A much longe", speed: 2 },
    });
  });

  it("derives composition declarations from the registry manifest once", () => {
    const source = '<!doctype html><html lang="en"><head></head><body></body></html>';
    const variables: RegistryVariable[] = [
      {
        id: "title",
        label: "Title",
        type: "string",
        default: "Founder&#39;s route",
        maxLength: 72,
        update: "live",
      },
      {
        id: "progress",
        label: "Progress",
        type: "number",
        default: 76,
        min: 0,
        max: 100,
      },
    ];

    const injected = injectRegistryVariableDeclarations(source, variables);
    const declaration = injected.match(/data-composition-variables='([^']+)'/)?.[1];

    expect(declaration).toBeTruthy();
    expect(JSON.parse(declaration?.replaceAll("&amp;", "&") ?? "[]")).toEqual([
      {
        id: "title",
        label: "Title",
        type: "string",
        default: "Founder&#39;s route",
        maxLength: 72,
      },
      {
        id: "progress",
        label: "Progress",
        type: "number",
        default: 76,
        min: 0,
        max: 100,
      },
    ]);
    expect(injectRegistryVariableDeclarations(injected, variables)).toBe(injected);
  });

  it("writes valid per-instance JSON without changing sibling instances", () => {
    const source = [
      '<main data-composition-id="root">',
      '  <div id="route-map" data-composition-src="compositions/route-map.html"></div>',
      '  <div id="route-map_2" data-composition-src="compositions/route-map.html"></div>',
      "</main>",
    ].join("\n");
    const values = JSON.stringify({ title: "Founder's route", speed: 1.2 });
    const serializedValues = values.replace("'", "&#39;");
    const patched = applyPatchByTarget(
      source,
      { id: "route-map_2" },
      {
        type: "attribute",
        property: "variable-values",
        value: values,
      },
    );

    expect(patched).toContain(
      `id="route-map_2" data-composition-src="compositions/route-map.html" data-variable-values='${serializedValues}'`,
    );
    expect(patched).not.toContain(
      'id="route-map" data-composition-src="compositions/route-map.html" data-variable-values',
    );

    const ordinaryAttribute = applyPatchByTarget(
      source,
      { id: "route-map" },
      {
        type: "attribute",
        property: "title",
        value: 'Say "hello"',
      },
    );
    expect(ordinaryAttribute).toContain('data-title="Say &quot;hello&quot;"');
  });
});
