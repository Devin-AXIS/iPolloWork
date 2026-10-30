import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { ComponentContentModel } from "@hyperframes/core/registry";
import type { StudioApiAdapter } from "../types";
import { registerRegistryRoutes } from "./registry";

const model: ComponentContentModel = {
  type: "mindmap", title: "Map", kind: "category-value", duration: 10,
  lookDefaults: { layout: "full", skin: "keynote", camera: "auto" }, vars: [],
  rows: { variable: "rows", field: "branches", label: "Branches", min: 2, max: 3,
    columns: [{ id: "label", required: true, maxLength: 12 }] },
  defaults: { rows: JSON.stringify({ version: 1, kind: "category-value", rows: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }] }),
    motionCueTimes: "{}", layout: "full", skin: "keynote", camera: "auto" },
};
const SOURCE = '<html><body><div id="instance" data-composition-src="compositions/map.html"></div><aside id="other">Unchanged</aside></body></html>';

describe("atomic component content API", () => {
  let dir: string, app: Hono;
  const capture = vi.fn<NonNullable<StudioApiAdapter["generateThumbnail"]>>();
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-content-")); mkdirSync(join(dir, "compositions"));
    writeFileSync(join(dir, "index.html"), SOURCE);
    writeFileSync(join(dir, "compositions/map.html"), `<html data-composition-variables='[]'><body><template><div data-component-content-model='${JSON.stringify(model)}'></div></template></body></html>`);
    capture.mockReset(); capture.mockResolvedValue({ valid: true, scope: "runtime-timing-and-layout-not-semantic-approval", sampledFrameCount: 1,
      issues: [], carrierReview: { scope: "tracked-dom-not-semantic-continuity-approval", boundaries: [] }, deterministicSeek: { checkedSceneCount: 0, valid: true } });
    const adapter: StudioApiAdapter = { listProjects: () => [], resolveProject: id => id === "test" ? { id, dir } : null,
      bundle: async () => null, lint: () => ({ findings: [] }), runtimeUrl: "/runtime.js", rendersDir: () => dir,
      startRender: ({ jobId, outputPath }) => ({ id: jobId, outputPath, status: "complete", progress: 1 }), generateThumbnail: capture };
    app = new Hono(); registerRegistryRoutes(app, adapter);
  });
  afterEach(() => rmSync(dir, { force: true, recursive: true }));
  const read = async () => (await app.request("/projects/test/components/instance")).json();
  const write = (revision: string, data: unknown) => app.request("/projects/test/components/instance", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision, data }),
  });
  it("reads the installed contract without requiring a current catalog, and saves one selected instance", async () => {
    const before = await read(); const response = await write(before.revision, { content: { branches: [{ id: "a", label: "Changed" }, { id: "b", label: "Beta" }] } });
    expect(response.status).toBe(200); expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]?.[0].componentVariables?.elementId).toBe("instance");
    expect(readFileSync(join(dir, "index.html"), "utf8").replace(/ data-hf-id="[^"]*"/g, "")).toContain('<aside id="other">Unchanged</aside>');
    expect((await read()).data.content.branches[0].label).toBe("Changed");
    expect((await write(before.revision, {})).status).toBe(409);
  });
  it("rejects invalid hierarchy before capture and keeps source bytes unchanged", async () => {
    const response = await write((await read()).revision, { content: { branches: [{ id: "a", label: "A", unknown: "lost" }, { id: "b", label: "B" }] } });
    expect(response.status).toBe(422); expect((await response.json()).issues[0].path).toContain("unknown");
    expect(capture).not.toHaveBeenCalled(); expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(SOURCE);
  });
  it("keeps source unchanged when actual font layout fails or capture is unavailable", async () => {
    capture.mockResolvedValueOnce({ valid: false, scope: "runtime-timing-and-layout-not-semantic-approval", sampledFrameCount: 1,
      issues: [{ sceneId: "instance", code: "component-layout", time: 0, detail: "Text collision" }],
      carrierReview: { scope: "tracked-dom-not-semantic-continuity-approval", boundaries: [] }, deterministicSeek: { checkedSceneCount: 0, valid: true } });
    expect((await write((await read()).revision, {})).status).toBe(422);
    capture.mockResolvedValueOnce(null); expect((await write((await read()).revision, {})).status).toBe(503);
    expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(SOURCE);
  });
  it("rejects concurrent source changes during asynchronous layout review", async () => {
    capture.mockImplementationOnce(async () => { writeFileSync(join(dir, "index.html"), SOURCE + "<!--external-->"); return {
      valid: true, scope: "runtime-timing-and-layout-not-semantic-approval", sampledFrameCount: 1, issues: [],
      carrierReview: { scope: "tracked-dom-not-semantic-continuity-approval", boundaries: [] }, deterministicSeek: { checkedSceneCount: 0, valid: true } }; });
    expect((await write((await read()).revision, {})).status).toBe(409);
    expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(SOURCE + "<!--external-->");
  });
  it("does not attach new rules to an older installed template", async () => {
    writeFileSync(join(dir, "compositions/map.html"), '<div data-composition-variables="[]"></div>');
    const response = await app.request("/projects/test/components/instance");
    expect(response.status).toBe(422); expect((await response.json()).error).toContain("installed");
  });
});
