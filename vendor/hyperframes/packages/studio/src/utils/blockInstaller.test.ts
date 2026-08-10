// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { addBlockToProject } from "./blockInstaller";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("addBlockToProject", () => {
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
      refreshFileTree: vi.fn(),
      reloadPreview: vi.fn(),
      showToast: vi.fn(),
    });

    expect(files["compositions/components/morph-text.html"]).toContain(
      "background: transparent;",
    );
    expect(files["compositions/components/morph-text.html"]).not.toContain(
      "background: #fff;",
    );
    expect(files["compositions/components/morph-text.html"]).toContain(
      "background: #e7e5e7;",
    );
    expect(writes["index.html"]?.at(-1)).toContain(
      'data-composition-src="compositions/components/morph-text.html"',
    );
  });
});
