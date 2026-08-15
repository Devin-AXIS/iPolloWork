import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import test from "node:test";
import {
  VideoRuntimeManager,
  applyBundledTemplate,
  readHyperframesServerConfig,
  verifiedWritePath,
} from "../lib/runtime.js";
import {
  isVideoStudioHostMessage,
  parseHyperframesAskAiMessage,
  parseHyperframesSelectionSnapshot,
  videoStudioDocumentPrompt,
  videoStudioSelectionPrompt,
} from "../lib/contract.js";

const fakeCliSource = `
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
const [command, project, ...rest] = process.argv.slice(2);
if (command === "init") {
  const target = resolve(process.cwd(), project);
  await mkdir(target, { recursive: true });
  await writeFile(resolve(target, "index.html"), '<div data-composition-id="main"><!-- Add your clips here --></div>');
  process.exit(0);
}
if (command === "check") {
  process.stdout.write(JSON.stringify({ valid: true, project: resolve(project), issues: [] }));
  process.exit(0);
}
if (command === "preview") {
  const port = Number(rest[rest.indexOf("--port") + 1]);
  const projectDir = resolve(project);
  const server = createServer((req, res) => {
    if (req.url === "/__hyperframes_config") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ isHyperframes: true, projectDir, projectName: basename(projectDir), version: "0.7.60", pid: process.pid }));
      return;
    }
    res.end("ok");
  });
  server.on("error", () => { process.stderr.write("address already in use"); process.exit(1); });
  server.listen(port, "127.0.0.1");
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
`;

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "deepseek-ivideo-test-"));
  const cliPath = resolve(root, "fake-hyperframes.mjs");
  await writeFile(cliPath, fakeCliSource, "utf8");
  return { root, cliPath };
}

function listen(server, port) {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
}

function close(server) {
  return new Promise((resolvePromise) => server.close(resolvePromise));
}

function waitForExit(child) {
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`Child exited with ${code}.`)));
  });
}

test("coalesces concurrent starts and reclaims only its own idle preview", async () => {
  const { root, cliPath } = await fixture();
  const manager = new VideoRuntimeManager({ cliPath, idleMs: 40, startTimeoutMs: 4_000 });
  const [first, second] = await Promise.all([
    manager.start({ workspaceRoot: root, sessionId: "coalesced", viewId: "one" }),
    manager.start({ workspaceRoot: root, sessionId: "coalesced", viewId: "two" }),
  ]);
  assert.equal(first.port, second.port);
  assert.equal(manager.activePreviewCount(), 1);
  await manager.release({ workspaceRoot: root, sessionId: "coalesced", viewId: "one" });
  await manager.release({ workspaceRoot: root, sessionId: "coalesced", viewId: "two" });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 120));
  assert.equal(manager.activePreviewCount(), 0);
  assert.equal(await readHyperframesServerConfig(first.port), null);
  manager.dispose();
});

test("plugin-owned previews stop when their Harness parent exits", async () => {
  const { root, cliPath } = await fixture();
  const ownerPath = resolve(root, "owner.mjs");
  const sessionPath = resolve(root, "session.json");
  const runtimeUrl = new URL("../lib/runtime.js", import.meta.url).href;
  await writeFile(ownerPath, `
    import { writeFile } from "node:fs/promises";
    import { VideoRuntimeManager } from ${JSON.stringify(runtimeUrl)};
    const manager = new VideoRuntimeManager({ cliPath: ${JSON.stringify(cliPath)}, startTimeoutMs: 4000 });
    const session = await manager.start({ workspaceRoot: ${JSON.stringify(root)}, sessionId: "parent-exit", viewId: "view" });
    await writeFile(${JSON.stringify(sessionPath)}, JSON.stringify(session));
    process.exit(0);
  `, "utf8");
  await waitForExit(spawn(process.execPath, [ownerPath], { stdio: "ignore" }));
  const session = JSON.parse(await readFile(sessionPath, "utf8"));
  for (let attempt = 0; attempt < 40 && await readHyperframesServerConfig(session.port); attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  assert.equal(await readHyperframesServerConfig(session.port), null);
});

test("falls back from an occupied port and never stops the foreign server", async () => {
  const { root, cliPath } = await fixture();
  const probe = new VideoRuntimeManager({ cliPath, idleMs: 40, startTimeoutMs: 4_000 });
  const baseline = await probe.start({ workspaceRoot: root, sessionId: "occupied" });
  await probe.stop({ workspaceRoot: root, sessionId: "occupied" });
  const foreign = createServer((_req, res) => res.end("foreign"));
  await listen(foreign, baseline.port);
  const manager = new VideoRuntimeManager({ cliPath, idleMs: 40, startTimeoutMs: 4_000 });
  const active = await manager.start({ workspaceRoot: root, sessionId: "occupied", viewId: "view" });
  assert.notEqual(active.port, baseline.port);
  manager.dispose();
  assert.equal(foreign.listening, true);
  await close(foreign);
});

test("rejects workspace escapes and symlinked video projects", async () => {
  const { root, cliPath } = await fixture();
  await assert.rejects(() => verifiedWritePath(root, "video/../outside.txt", "video", "iVideo"));
  const outside = await mkdtemp(resolve(tmpdir(), "deepseek-ivideo-outside-"));
  await mkdir(resolve(root, "video"), { recursive: true });
  await symlink(outside, resolve(root, "video", "unsafe"));
  const manager = new VideoRuntimeManager({ cliPath, startTimeoutMs: 1_000 });
  await assert.rejects(() => manager.start({ workspaceRoot: root, sessionId: "unsafe" }), /Symbolic links outside/);
  manager.dispose();
});

test("validation is bounded to the requested video session", async () => {
  const { root, cliPath } = await fixture();
  const manager = new VideoRuntimeManager({ cliPath, startTimeoutMs: 4_000 });
  const active = await manager.start({ workspaceRoot: root, sessionId: "validated" });
  await manager.stop({ workspaceRoot: root, sessionId: "validated" });
  const result = await manager.validate({ workspaceRoot: root, sessionId: "validated" });
  assert.equal(result.ok, true);
  assert.equal(result.report.project, active.projectPath);
  assert.match(active.projectDirectory, /^video\/validated$/);
  manager.dispose();
});

test("atomic template replacement restores the original project after validation failure", async () => {
  const templatesRoot = resolve(dirname(new URL(import.meta.url).pathname), "../lib/templates");
  const names = (await import("node:fs/promises")).readdir(templatesRoot);
  const templateName = (await names)[0];
  const directory = resolve(templatesRoot, templateName);
  const manifest = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8"));
  const root = await mkdtemp(resolve(tmpdir(), "deepseek-ivideo-rollback-"));
  const projectsRoot = resolve(root, "video");
  const target = resolve(projectsRoot, "session");
  await mkdir(target, { recursive: true });
  await writeFile(resolve(target, "original.txt"), "preserve", "utf8");
  await assert.rejects(() => applyBundledTemplate({
    operations: new Map(),
    operationKey: "rollback",
    template: { directory, manifest },
    projectsRoot,
    projectId: "session",
    validateInstalled: async () => { throw new Error("validation failed"); },
  }), /validation failed/);
  assert.equal(await readFile(resolve(target, "original.txt"), "utf8"), "preserve");
});

test("ships all 27 Video templates without applying the curated Design catalog filter", async () => {
  const pluginRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const templatesRoot = resolve(pluginRoot, "lib/templates");
  const manifests = await Promise.all((await readdir(templatesRoot)).map(async (name) => (
    JSON.parse(await readFile(resolve(templatesRoot, name, "manifest.json"), "utf8"))
  )));
  assert.equal(manifests.length, 27);
  assert.equal(manifests.every((manifest) => manifest.surface === "video" && manifest.category === "video"), true);
  const pluginSource = await readFile(resolve(pluginRoot, "src/index.ts"), "utf8");
  assert.doesNotMatch(pluginSource, /isCustomerVisibleBundledTemplate/);
});

test("AI bridge accepts only validated selections and builds draft-only prompts", () => {
  const selection = parseHyperframesAskAiMessage({
    type: "ipollowork:hyperframes:ask-ai-selection",
    target: { file: "index.html", hfId: "headline" },
    tag: "h1",
    text: "Launch",
    styles: { color: "rgb(255, 255, 255)" },
  });
  assert.ok(selection);
  assert.equal(selection.locator, '[data-hf-id="headline"]');
  assert.equal(parseHyperframesAskAiMessage({ type: "ipollowork:hyperframes:ask-ai-selection", target: { file: "../secret", hfId: "x" } }), null);
  assert.equal(isVideoStudioHostMessage({ channel: "wrong", type: "ask-video-ai" }), false);
  assert.match(videoStudioDocumentPrompt("video/session"), /ipollowork_video_validate/);
  assert.match(videoStudioSelectionPrompt("video/session", selection), /Change only this element/);
});

test("HyperFrames selection snapshots are reduced to the safe element AI contract", () => {
  const selection = parseHyperframesSelectionSnapshot({
    sourceFile: "index.html",
    target: { hfId: "headline", selector: ".headline" },
    tagName: "DIV",
    textContent: "Launch faster",
    dataAttributes: { alt: "Hero artwork" },
    computedStyles: { color: "rgb(255, 255, 255)", transform: "none" },
    inlineStyles: { color: "#fff" },
  });
  assert.deepEqual(selection, {
    file: "index.html",
    locator: '[data-hf-id="headline"]',
    tag: "div",
    text: "Launch faster",
    src: "",
    alt: "Hero artwork",
    styles: { color: "#fff", transform: "none" },
  });
  assert.equal(parseHyperframesSelectionSnapshot({ sourceFile: "../secret", target: { hfId: "x" } }), null);
});

test("Harness client validates message source and fills a draft without sending it", async () => {
  const source = await readFile(resolve(dirname(new URL(import.meta.url).pathname), "../src/client.tsx"), "utf8");
  assert.match(source, /event\.origin !== window\.location\.origin/);
  assert.match(source, /event\.source !== iframeRef\.current\?\.contentWindow/);
  assert.match(source, /inputActions\.setDraft/);
  assert.doesNotMatch(source, /inputActions\.(send|submit)|sendMessage\(/);
});
