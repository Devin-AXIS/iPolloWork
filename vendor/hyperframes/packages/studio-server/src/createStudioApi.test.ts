import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("invalidates a host-owned preview signature before a successful write returns", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-invalidation-"));
    temporaryDirectories.push(projectDir);
    const entryPath = join(projectDir, "index.html");
    const before = "<!doctype html><html><body>Before</body></html>";
    const after = "<!doctype html><html><body>After</body></html>";
    writeFileSync(entryPath, before);

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
