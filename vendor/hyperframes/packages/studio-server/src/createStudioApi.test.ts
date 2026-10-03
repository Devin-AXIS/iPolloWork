import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStudioApi } from "./createStudioApi";
import { fileContentVersion } from "./helpers/fileVersion";
import type { StudioApiAdapter } from "./types";

describe("createStudioApi project cache invalidation", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("derives recipe mount evidence from exact scene hosts and existing recipe sources, not Markdown claims", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-recipe-mount-"));
    temporaryDirectories.push(projectDir);
    mkdirSync(join(projectDir, "components"));
    writeFileSync(join(projectDir, "components", "feedback-loop.html"), '<main data-composition-id="feedback-loop"></main><script data-ipw-motion-recipe="1">/* executable recipe */</script>');
    writeFileSync(join(projectDir, "components", "legacy.html"), '<main data-composition-id="feedback-loop"></main><script data-ipw-motion-recipe="1">/* executable recipe */</script>');
    writeFileSync(join(projectDir, "components", "custom.html"), '<main data-composition-id="custom"></main>');
    const entry = `<section id="real-scene" data-ipw-scene data-ipw-registry-component="feedback-loop" data-ipw-timing-owner="host" data-composition-src="components/feedback-loop.html"></section>
<section id="missing-source" data-ipw-scene data-ipw-registry-component="feedback-loop" data-ipw-timing-owner="host" data-composition-src="components/missing.html"></section>
<section id="custom-scene" data-ipw-scene data-ipw-registry-component="custom" data-ipw-timing-owner="host" data-composition-src="components/custom.html"></section>
<section id="wrong-component" data-ipw-scene data-ipw-registry-component="definition-highlight" data-ipw-timing-owner="host" data-composition-src="components/feedback-loop.html"></section>
<section id="legacy-scene" data-ipw-scene data-ipw-registry-component="feedback-loop" data-ipw-timing-owner="host" data-composition-src="components/legacy.html"></section>`;
    writeFileSync(join(projectDir, "index.html"), entry);
    const storyboard = `# Storyboard
## Frame 1 — Mounted
- recipe: feedback-loop
- scene_id: real-scene
## Frame 2 — Missing source
- recipe: feedback-loop
- scene_id: missing-source
- status: mounted
## Frame 3 — Component mismatch
- recipe: feedback-loop
- scene_id: wrong-component
## Frame 4 — Custom source
- recipe: custom
- scene_id: custom-scene
## Frame 5 — Wrong association
- recipe: feedback-loop
- scene_id: absent-scene
- src: components/feedback-loop.html
## Frame 6 — Legacy unique source
- camera: component:custom
- src: components/custom.html
## Frame 7 — No identity
- recipe: feedback-loop
## Frame 8 — Ambiguous source
- recipe: feedback-loop
- src: components/feedback-loop.html
## Frame 9 — Legacy mounted source
- camera: component:feedback-loop
- src: components/legacy.html
`;
    writeFileSync(join(projectDir, "STORYBOARD.md"), storyboard);
    const adapter = {
      listProjects: () => [{ id: "proof", dir: projectDir }],
      resolveProject: (id: string) => id === "proof" ? { id, dir: projectDir } : null,
      bundle: async () => entry,
      lint: () => ({ findings: [] }),
      runtimeUrl: "/api/runtime.js",
      rendersDir: () => projectDir,
      startRender: () => ({ id: "render", status: "complete" as const, progress: 100, outputPath: join(projectDir, "render.mp4") }),
    } satisfies StudioApiAdapter;
    const response = await createStudioApi(adapter).request("/projects/proof/storyboard");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.frames).toHaveLength(9);
    expect(result.frames[0].recipeMount).toEqual({ componentId: "feedback-loop", source: "components/feedback-loop.html" });
    for (const frame of result.frames.slice(1, 8)) expect(frame.recipeMount).toBeUndefined();
    expect(result.frames[8].recipeMount).toEqual({ componentId: "feedback-loop", source: "components/legacy.html" });
    expect(readFileSync(join(projectDir, "index.html"), "utf8")).toBe(entry);
    expect(readFileSync(join(projectDir, "STORYBOARD.md"), "utf8")).toBe(storyboard);
  });

  it("invalidates a host-owned preview signature before a successful write returns", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-invalidation-"));
    temporaryDirectories.push(projectDir);
    const entryPath = join(projectDir, "index.html");
    const before = "<!doctype html><html><body>Before</body></html>";
    const after = "<!doctype html><html><body>After</body></html>";
    writeFileSync(entryPath, before);
    writeFileSync(join(projectDir, "avatar.webm"), "generated media");

    let signature = "old";
    let invalidations = 0;
    const adapter = {
      listProjects: () => [{ id: "proof", dir: projectDir }],
      resolveProject: (id: string) => (id === "proof" ? { id, dir: projectDir } : null),
      bundle: async () => readFileSync(entryPath, "utf8"),
      getProjectSignature: () => signature,
      invalidateProjectSignature: () => {
        invalidations += 1;
        signature = "new";
      },
      lint: () => ({ findings: [] }),
      runtimeUrl: "/api/runtime.js",
      rendersDir: () => projectDir,
      startRender: () => ({
        id: "render",
        status: "complete" as const,
        progress: 100,
        outputPath: join(projectDir, "render.mp4"),
      }),
    } satisfies StudioApiAdapter;
    const api = createStudioApi(adapter);

    const initialPreview = await api.request("/projects/proof/preview");
    expect(initialPreview.headers.get("etag")).toBe('"preview:old"');
    const media = await api.request("/projects/proof/preview/avatar.webm");
    expect(media.headers.get("cache-control")).toBe("private, no-cache");
    const mediaEtag = media.headers.get("etag");
    expect(mediaEtag).toBeTruthy();
    const cachedMedia = await api.request("/projects/proof/preview/avatar.webm", {
      headers: { "If-None-Match": mediaEtag! },
    });
    expect(cachedMedia.status).toBe(304);

    const writeResponse = await api.request("/projects/proof/files/index.html", {
      method: "PUT",
      headers: { "If-Match": fileContentVersion(before) },
      body: after,
    });
    expect(writeResponse.status).toBe(200);
    expect(invalidations).toBe(1);

    const refreshedPreview = await api.request("/projects/proof/preview", {
      headers: { "If-None-Match": '"preview:old"' },
    });
    expect(refreshedPreview.status).toBe(200);
    expect(refreshedPreview.headers.get("etag")).toBe('"preview:new"');
    expect(await refreshedPreview.text()).toContain("After");
  });
});
