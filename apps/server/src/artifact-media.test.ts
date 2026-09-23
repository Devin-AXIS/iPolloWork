import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewArtifactMedia, reviewArtifactPreview } from "./artifact-media.js";
import { recordSessionArtifact } from "./session-artifacts.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ipw-artifact-media-")); roots.push(root);
  const workspace: WorkspaceInfo = { id: "ws", name: "Test", path: root, preset: "starter", workspaceType: "local" };
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "test", hostToken: "host", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [], workspaces: [workspace], authorizedRoots: [root],
    readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  const context = { workspaceId: "ws", sessionId: "session" };
  const sourcePath = "design/session-artifact-slides/entry.html";
  const directory = join(root, "design/session-artifact-slides");
  await mkdir(join(directory, "assets"), { recursive: true });
  await writeFile(join(directory, "entry.html"), "<h1>Autumn</h1>");
  await writeFile(join(directory, "brief.json"), JSON.stringify({ title: "Autumn" }));
  const queries: string[] = [];
  const query = async (id: string) => { queries.push(id); return { ok: true, result: { models: [] } }; };
  const review = (args: Record<string, unknown>) => reviewArtifactMedia(config, { sourcePath, ...args }, context, query);
  const needs = [{ id: "cover", purpose: "Illustrative autumn alley atmosphere, not documentary evidence", kind: "image" }];
  return { root, directory, config, workspace, context, sourcePath, queries, query, review, needs };
}

test("missing plan cannot pass the automatic delivery check", async () => {
  const f = await fixture();
  expect((await f.review({ phase: "check" })).result).toMatchObject({ fileCanBeDelivered: false, issues: ["missing_media_plan"] });
});

test("a missing planned entry returns a structured delivery failure", async () => {
  const f = await fixture();
  await f.review({ phase: "plan", needs: f.needs });
  await rm(join(f.directory, "entry.html"));
  expect((await f.review({ phase: "check" })).result).toMatchObject({ complete: false, fileCanBeDelivered: false, issues: ["missing_source"] });
});
test("planning queries actual capabilities once per kind and preserves the brief", async () => {
  const f = await fixture();
  await f.review({ phase: "plan", needs: [...f.needs, { id: "second", purpose: "Second scene", kind: "image" }] });
  expect(f.queries).toEqual(["openai-image-generation"]);
  expect(JSON.parse(await readFile(join(f.directory, "brief.json"), "utf8")).title).toBe("Autumn");
  expect((await f.review({ phase: "check" })).result).toMatchObject({ complete: false });
});
test("explicit no-generation scope needs no provider query", async () => {
  const f = await fixture();
  await f.review({ phase: "plan", needs: [], exemption: "no-generation", reason: "User requested no generated media" });
  expect(f.queries).toEqual([]);
  expect((await f.review({ phase: "check" })).result).toMatchObject({ complete: true });
  await expect((await fixture()).review({ phase: "plan", needs: [] })).rejects.toThrow("exemption");
});
test("pending imagery cannot be erased by re-planning or changing it to geometry", async () => {
  const f = await fixture();
  await f.review({ phase: "plan", needs: f.needs });
  await expect(f.review({ phase: "plan", needs: [], exemption: "diagrams-sufficient", reason: "I prefer shapes" })).rejects.toThrow("already exists");
  expect((await f.review({ phase: "check", outcomes: [{ id: "cover", status: "diagram" }] })).result).toMatchObject({ fileCanBeDelivered: false, issues: ["cover: planned_imagery_replaced_by_diagram"] });
});
test("existing assets must be nonempty and actually referenced, not just mentioned", async () => {
  const f = await fixture();
  await f.review({ phase: "plan", needs: f.needs });
  await writeFile(join(f.directory, "assets/scene.png"), "image");
  await writeFile(join(f.directory, "entry.html"), '<p>assets/scene.png</p><!-- <img src="assets/scene.png"> -->');
  const outcomes = [{ id: "cover", status: "reused", path: "assets/scene.png" }];
  expect((await f.review({ phase: "check", outcomes })).result).toMatchObject({ complete: false });
  await writeFile(join(f.directory, "entry.html"), '<img src="assets/scene.png">');
  expect((await f.review({ phase: "check", outcomes })).result).toMatchObject({ complete: true });
  await writeFile(join(f.directory, "assets/scene.png"), "");
  expect((await f.review({ phase: "check" })).result).toMatchObject({ complete: false });
});

test("accepts a workspace-relative outcome path as well as a session-relative path", async () => {
  const f = await fixture();
  await f.review({ phase: "plan", needs: f.needs });
  await writeFile(join(f.directory, "assets/scene.png"), "image");
  await writeFile(join(f.directory, "entry.html"), '<img src="assets/scene.png">');
  const workspacePath = "design/session-artifact-slides/assets/scene.png";
  expect((await f.review({ phase: "check", outcomes: [{ id: "cover", status: "reused", path: workspacePath }] })).result).toMatchObject({ complete: true });
});
test("generated copies require a real session receipt and matching bytes; check revalidates saved outcomes", async () => {
  const f = await fixture();
  await f.review({ phase: "plan", needs: f.needs });
  await writeFile(join(f.root, "generated.png"), "generated bytes");
  await writeFile(join(f.directory, "assets/scene.png"), "generated bytes");
  await writeFile(join(f.directory, "entry.html"), '<link rel="stylesheet" href="theme.css"><div class="hero"></div>');
  await writeFile(join(f.directory, "theme.css"), '.hero{background-image:url("assets/scene.png")}');
  const outcomes = [{ id: "cover", status: "generated", path: "assets/scene.png", generationPath: "generated.png" }];
  expect((await f.review({ phase: "check", outcomes })).result).toMatchObject({ issues: ["cover: missing_generation_receipt"] });
  await recordSessionArtifact(f.config, f.workspace, "session", "generated.png", undefined, { id: "gen", kind: "image", model: "test", completedAt: Date.now() });
  await f.review({ phase: "plan", needs: f.needs });
  expect((await f.review({ phase: "check", outcomes })).result).toMatchObject({ complete: true });
  expect((await f.review({ phase: "check" })).result).toMatchObject({ complete: true });
  await writeFile(join(f.directory, "assets/scene.png"), "different bytes");
  expect((await f.review({ phase: "check" })).result).toMatchObject({ issues: ["cover: generated_file_mismatch"] });
});
test("unavailable or failed media allows disclosed file delivery without claiming media completion", async () => {
  const f = await fixture();
  await f.review({ phase: "plan", needs: f.needs });
  expect((await f.review({ phase: "check", outcomes: [{ id: "cover", status: "unavailable", reason: "No authorized image model in status response" }] })).result)
    .toMatchObject({ fileCanBeDelivered: true, complete: false, reportedFallbacks: ["cover: unavailable: No authorized image model in status response"] });
});
test("query failure remains unknown and does not prevent saving a plan", async () => {
  const f = await fixture();
  const result = await reviewArtifactMedia(f.config, { sourcePath: f.sourcePath, phase: "plan", needs: f.needs }, f.context, async () => { throw new Error("offline"); });
  expect(result.result).toMatchObject({ capabilities: [{ kind: "image", status: "unknown" }] });
});
test("rejects escaping paths and symlinks, and respects read-only workspaces", async () => {
  const f = await fixture();
  await expect(reviewArtifactMedia({ ...f.config, readOnly: true }, { sourcePath: f.sourcePath, phase: "plan", needs: f.needs }, f.context, f.query)).rejects.toThrow("read-only");
  await f.review({ phase: "plan", needs: f.needs });
  await writeFile(join(f.root, "outside.png"), "outside");
  await symlink(join(f.root, "outside.png"), join(f.directory, "assets/link.png"));
  await expect(f.review({ phase: "check", outcomes: [{ id: "cover", status: "reused", path: "../../outside.png" }] })).rejects.toThrow("escapes");
  await expect(f.review({ phase: "check", outcomes: [{ id: "cover", status: "reused", path: "assets/link.png" }] })).rejects.toThrow("escapes");
});

test("explicit engine workspace id wins over the first project and stale directory", async () => {
  const first = await fixture();
  const selected = await fixture();
  first.config.workspaces = [first.workspace, { ...selected.workspace, id: "selected" }];
  const context = { sessionId: "session", workspaceId: "selected", directory: first.root };
  await reviewArtifactMedia(first.config, { phase: "plan", sourcePath: selected.sourcePath, needs: selected.needs }, context, selected.query);
  expect(JSON.parse(await readFile(join(first.directory, "brief.json"), "utf8")).mediaPlan).toBeUndefined();
  expect(JSON.parse(await readFile(join(selected.directory, "brief.json"), "utf8")).mediaPlan.needs).toEqual(selected.needs);
  await expect(reviewArtifactMedia(first.config, { phase: "check", sourcePath: selected.sourcePath }, { ...context, workspaceId: "missing" }, selected.query)).rejects.toThrow("requested workspace");
});

test("client preview review always checks the current rendered dependencies", async () => {
  const f = await fixture();
  const calls: Array<{ workspaceId: string; sourcePath: string; kind: "site" | "slides" }> = [];
  const run = async (input: { workspaceId: string; sourcePath: string; kind: "site" | "slides" }) => {
    calls.push(input);
    return { ok: true, result: { passed: true, pageCount: 1, issues: [] } };
  };
  const input: { sourcePath: string; kind: "slides" } = { sourcePath: f.sourcePath, kind: "slides" };
  expect((await reviewArtifactPreview(f.config, input, f.context, run)).result).toMatchObject({ passed: true, pageCount: 1 });
  expect((await reviewArtifactPreview(f.config, input, f.context, run)).result).toMatchObject({ passed: true, pageCount: 1 });
  expect(calls).toHaveLength(2);
  await writeFile(join(f.directory, "entry.html"), "<h1>Revised autumn</h1>");
  await reviewArtifactPreview(f.config, input, f.context, run);
  expect(calls).toHaveLength(3);
  expect(JSON.parse(await readFile(join(f.directory, "brief.json"), "utf8")).previewReview).toMatchObject({
    sourcePath: f.sourcePath,
    kind: "slides",
    result: { passed: true, pageCount: 1 },
  });
});
