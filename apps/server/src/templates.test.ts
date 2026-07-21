import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEMPLATE_STYLE_LABELS, type TemplateManifestV1 } from "@ipollowork/types/templates";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { adoptLegacyVideoSession, importTemplate, listTemplates, materializeTemplate, migrateTemplateSessionSnapshots, readTemplateSession, saveTemplateFromSession, uninstallTemplate } from "./templates.js";

const previousRuntimeDb = process.env.IPOLLOWORK_RUNTIME_DB;
afterEach(() => {
  if (previousRuntimeDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
  else process.env.IPOLLOWORK_RUNTIME_DB = previousRuntimeDb;
});

function config(root: string): ServerConfig {
  return {
    host: "127.0.0.1", port: 0, token: "test", hostToken: "host", approval: { mode: "auto", timeoutMs: 1_000 }, corsOrigins: ["*"], workspaces: [], authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "env", hostTokenSource: "env", logFormat: "pretty", logRequests: false,
  };
}

function workspace(root: string, id: string): WorkspaceInfo {
  return { id, name: id, path: join(root, id), preset: "default", workspaceType: "local" };
}

function storedZip(files: Record<string, string | Buffer>): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, contents] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundledTemplatesRoot = join(serverRoot, "bundled-templates");
const pptxCompatibleTemplateIds = [
  "ipollowork.pptx-compatible-brief",
  "ipollowork.pptx-compatible-pitch",
  "ipollowork.pptx-compatible-report",
];
const flagshipVideoTemplateIds = [
  "ipollowork.hyperframes.app-device-launch",
  "ipollowork.hyperframes.feature-orbit",
  "ipollowork.hyperframes.course-journey",
  "ipollowork.hyperframes.code-explainer",
  "ipollowork.hyperframes.brand-liquid-sizzle",
  "ipollowork.hyperframes.data-proof-story",
];

function importedTemplateId(id: string) {
  return `test.${id.replace(/^ipollowork\./, "")}`;
}

async function readPackageFiles(root: string, relative = ""): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {};
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, await readPackageFiles(root, path));
    else files[path] = await readFile(join(root, path));
  }
  return files;
}

async function cloneBundledPackage(templateId: string) {
  const files = await readPackageFiles(join(bundledTemplatesRoot, templateId));
  const original = JSON.parse(files["manifest.json"].toString("utf8")) as TemplateManifestV1;
  const manifest: TemplateManifestV1 = { ...original, id: importedTemplateId(original.id) };
  files["manifest.json"] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, archive: storedZip(files) };
}

async function assertImportedTemplateCanMaterialize(input: { originalId: string; manifest: TemplateManifestV1; archive: Uint8Array }) {
  const root = await mkdtemp(join(tmpdir(), "ipw-template-package-"));
  process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const serverConfig = config(root);
  const installed = await importTemplate(serverConfig, "alpha", input.archive, input.manifest.category);
  expect(installed.manifest.id).toBe(input.manifest.id);
  expect(installed.sourceType).toBe("local");

  const ws = workspace(root, "alpha");
  const sessionId = `import_${input.originalId.replace(/[^a-z0-9]/g, "_")}`;
  const created = await materializeTemplate(serverConfig, ws, input.manifest.id, sessionId);
  const folder = input.manifest.surface === "video" ? "video" : "design";
  expect(created.state.entry).toBe(`${folder}/${sessionId}/${input.manifest.entry}`);
  const entry = await readFile(join(ws.path, created.state.entry), "utf8");
  expect(entry).toMatch(/<!doctype html>/i);
  if (input.manifest.surface === "video") expect(entry).toContain("data-composition-variables");
  else expect(entry).not.toContain("data-composition-variables");
}

function localPackage(id = "local.clean-portfolio", overrides: Record<string, unknown> = {}) {
  const manifest = {
    schemaVersion: 1, id, version: "1.0.0", kind: "design", category: "site", subcategory: "portfolio", title: "Clean Portfolio", description: "A compact local portfolio template.", cover: "cover.svg", entry: "entry.html", source: { name: "Local author", license: "MIT" }, designSystem: { tokenVersion: 1, editableGroups: ["theme", "typography"] }, applyChecklist: ["Update the portfolio content"], minimumAppVersion: "0.17.0", ...overrides,
  };
  return storedZip({ "manifest.json": JSON.stringify(manifest), "entry.html": "<!doctype html><h1>Portfolio</h1>", "cover.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>", LICENSE: "MIT" });
}

function videoPackage(id = "local.product-video", entry = "<!doctype html><html data-composition-variables='[{\"id\":\"title\",\"type\":\"string\",\"label\":\"Title\",\"default\":\"Product Reveal\"},{\"id\":\"accent\",\"type\":\"color\",\"label\":\"Accent\",\"default\":\"#7c3aed\"}]'><body><div id=\"root\" data-composition-id=\"main\" data-width=\"1920\" data-height=\"1080\" data-duration=\"6\"><h1 data-var-text=\"title\">Product Reveal</h1></div></body></html>") {
  const manifest = {
    schemaVersion: 1, id, version: "1.0.0", kind: "design", category: "video", subcategory: "product", style: "minimal", tags: ["product"], surface: "video", title: "Product Video", description: "A local HyperFrames video template.", cover: "cover.svg", entry: "index.html", source: { name: "Local author", license: "MIT" }, designSystem: { tokenVersion: 1, editableGroups: ["theme", "typography"] }, applyChecklist: ["Update the video content"], minimumAppVersion: "0.17.0",
  };
  return storedZip({ "manifest.json": JSON.stringify(manifest), "index.html": entry, "cover.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>", LICENSE: "MIT" });
}

describe("template installations", () => {
  test("claims one legacy Video Studio folder as its persisted session source", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-legacy-video-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    const sessionId = "legacy_video_session";
    const source = "<!doctype html><div data-composition-id=\"legacy\" data-duration=\"12\"></div>";
    await mkdir(join(ws.path, "video", sessionId), { recursive: true });
    await writeFile(join(ws.path, "video", sessionId, "index.html"), source, "utf8");

    const adopted = await adoptLegacyVideoSession(serverConfig, ws, sessionId);
    expect(adopted.surface).toBe("video");
    expect(adopted.state.entry).toBe(`video/${sessionId}/index.html`);
    expect(adopted.manifest.id).toBe("ipollowork.html-anything.video-hyperframes");
    expect(await readFile(join(ws.path, adopted.state.entry), "utf8")).toBe(source);
    expect(JSON.parse(await readFile(join(ws.path, adopted.state.briefPath), "utf8"))).toEqual({ source: "legacy-video-session" });

    const again = await adoptLegacyVideoSession(serverConfig, ws, sessionId);
    expect(again.state.createdAt).toBe(adopted.state.createdAt);
    expect(await readTemplateSession(serverConfig, ws, sessionId)).toEqual(adopted);
  });

  for (const templateId of [
    "ipollowork.app-calm-mobile",
    "ipollowork.app-creator-studio",
    "ipollowork.app-finance-dashboard",
    "ipollowork.saas-landing",
    "ipollowork.pitch-deck",
  ]) {
    test(`imports and materializes ${templateId}`, async () => {
      const { manifest, archive } = await cloneBundledPackage(templateId);
      await assertImportedTemplateCanMaterialize({ originalId: templateId, manifest, archive });
    });
  }

  test("ships app prototypes as ordinary editable design packages", async () => {
    for (const templateId of ["ipollowork.app-calm-mobile", "ipollowork.app-creator-studio", "ipollowork.app-finance-dashboard"]) {
      const root = join(bundledTemplatesRoot, templateId);
      const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as TemplateManifestV1;
      const entry = await readFile(join(root, manifest.entry), "utf8");
      expect(manifest.category).toBe("app");
      expect(manifest.surface).toBe("design");
      expect(manifest.cover).toBe("cover.png");
      expect(entry).not.toContain("data-composition-variables");
      expect(entry).not.toContain("data-composition-id");
    }
  });

  test("ships the reviewed HTML Anything catalog with iPolloWork categories, styles and editable variables", async () => {
    const directories = (await readdir(bundledTemplatesRoot)).filter((name) => name.startsWith("ipollowork.html-anything."));
    expect(directories).toHaveLength(60);
    const categoryCounts: Record<string, number> = {};
    for (const directory of directories) {
      const root = join(bundledTemplatesRoot, directory);
      const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as TemplateManifestV1;
      categoryCounts[manifest.category] = (categoryCounts[manifest.category] ?? 0) + 1;
      expect(TEMPLATE_STYLE_LABELS[manifest.style]).toBeTruthy();
      expect(manifest.source.license).toBe("Apache-2.0");
      expect(manifest.source.revision).toBe("d0efb1eaa3b65c731709981718cd5a0a0d4e8f71");
      const upgradedCategories = new Set(["site", "other"]);
      expect(manifest.version).toBe(upgradedCategories.has(manifest.category) ? "1.1.5" : "1.1.4");
      expect(manifest.cover).toBe("cover.png");
      expect(JSON.stringify(manifest)).not.toMatch(/[\u3000-\u30ff\u31f0-\u31ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/);
      expect(manifest.designSystem.variables.length).toBeGreaterThanOrEqual(manifest.surface === "video" ? 4 : 20);
      const entry = await readFile(join(root, manifest.entry), "utf8");
      expect(entry).toMatch(manifest.surface === "video" ? /data-var-src="logoUrl"/ : /data-ipw-brand-slot/);
      expect(entry).not.toMatch(/HTML[- ]ANYTHING|OPEN DESIGN|Open Design/i);
      expect(entry).not.toMatch(/[\u3000-\u30ff\u31f0-\u31ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/);
      for (const script of entry.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
        expect(() => new Function(script[1])).not.toThrow();
      }
      const cover = await readFile(join(root, manifest.cover));
      expect(cover.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(cover.readUInt32BE(16)).toBe(960);
      expect(cover.readUInt32BE(20)).toBe(540);
      expect(cover.byteLength).toBeGreaterThan(15_000);
      if (manifest.surface === "design") {
        const tokens = await readFile(join(root, manifest.designSystem.tokens!), "utf8");
        for (const variable of manifest.designSystem.variables) expect(tokens).toContain(variable.id);
      }
    }
    expect(categoryCounts).toEqual({ article: 4, cards: 7, other: 4, report: 4, slides: 23, video: 8, poster: 2, site: 8 });
  });

  test("ships six flagship HyperFrames video templates with local deterministic runtimes", async () => {
    const directories = (await readdir(bundledTemplatesRoot)).filter((name) => name.startsWith("ipollowork.hyperframes."));
    expect(directories).toHaveLength(flagshipVideoTemplateIds.length);
    for (const templateId of flagshipVideoTemplateIds) {
      const root = join(bundledTemplatesRoot, templateId);
      const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as TemplateManifestV1;
      const entry = await readFile(join(root, manifest.entry), "utf8");
      expect(manifest.category).toBe("video");
      expect(manifest.surface).toBe("video");
      expect(manifest.entry).toBe("index.html");
      expect(manifest.cover).toBe("cover.png");
      expect(manifest.source.license).toBe("Apache-2.0");
      expect(entry).toContain('data-composition-id="main"');
      expect(entry).toContain("data-composition-variables");
      expect(entry).toContain("gsap.timeline({ paused: true })");
      expect(entry).toContain("window.__timelines.main");
      expect(entry).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\//i);
      for (const variable of manifest.designSystem.variables) expect(entry).toContain(`"id":"${variable.id}"`);
      const cover = await readFile(join(root, manifest.cover));
      expect(cover.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(cover.readUInt32BE(16)).toBe(960);
      expect(cover.readUInt32BE(20)).toBe(540);
      expect(cover.byteLength).toBeGreaterThan(15_000);
      for (const script of entry.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
        expect(() => new Function(script[1])).not.toThrow();
      }
      expect(existsSync(join(root, "assets", "gsap.min.js"))).toBe(true);
    }
    expect(existsSync(join(bundledTemplatesRoot, flagshipVideoTemplateIds[0], "models", "iphone.glb"))).toBe(true);
    expect(existsSync(join(bundledTemplatesRoot, flagshipVideoTemplateIds[0], "models", "macbook.glb"))).toBe(true);
  });

  test("materializes every flagship video template as an independent session project", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-flagship-video-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    await listTemplates(serverConfig, ws.id);
    for (const templateId of flagshipVideoTemplateIds) {
      const sessionId = `session_${templateId.split(".").at(-1)}`;
      const created = await materializeTemplate(serverConfig, ws, templateId, sessionId);
      expect(created.state.entry).toBe(`video/${sessionId}/index.html`);
      expect(await readFile(join(ws.path, created.state.entry), "utf8")).toContain("window.__timelines.main");
      expect(existsSync(join(ws.path, "video", sessionId, "brief.json"))).toBe(true);
    }
  });

  test("ships every website template with an explicit mobile layout and accessible navigation", async () => {
    const directories = (await readdir(bundledTemplatesRoot)).filter((name) => !name.startsWith("."));
    const websites: Array<{ manifest: TemplateManifestV1; entry: string }> = [];
    for (const directory of directories) {
      const root = join(bundledTemplatesRoot, directory);
      const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as TemplateManifestV1;
      if (manifest.category !== "site") continue;
      websites.push({ manifest, entry: await readFile(join(root, manifest.entry), "utf8") });
    }
    expect(websites).toHaveLength(9);
    for (const { manifest, entry } of websites) {
      expect(entry).toContain('name="viewport"');
      expect(entry).toContain('data-ipw-mobile-ready="true"');
      expect(entry).toMatch(/@media\s*\(max-width:/);
      if (/<nav\b|<header\s+class="nav"/.test(entry)) {
        expect(entry).toContain("mobile-nav-toggle");
        expect(entry).toContain('aria-expanded="false"');
      }
      expect(manifest.minimumAppVersion).toBeTruthy();
    }
  });

  test("ships every bundled template with a real 960 by 540 PNG cover", async () => {
    const directories = (await readdir(bundledTemplatesRoot)).filter((name) => !name.startsWith("."));
    expect(directories).toHaveLength(74);
    const hashes = new Set<string>();
    for (const directory of directories) {
      const root = join(bundledTemplatesRoot, directory);
      const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as TemplateManifestV1;
      expect(manifest.cover).toBe("cover.png");
      const cover = await readFile(join(root, manifest.cover));
      expect(cover.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(cover.readUInt32BE(16)).toBe(960);
      expect(cover.readUInt32BE(20)).toBe(540);
      expect(cover.byteLength).toBeGreaterThan(15_000);
      hashes.add(Bun.hash(cover).toString());
    }
    expect(hashes.size).toBe(74);
  });

  test("ships strict PPTX-compatible slide templates with explicit editable object markers", async () => {
    for (const templateId of pptxCompatibleTemplateIds) {
      const root = join(bundledTemplatesRoot, templateId);
      const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as TemplateManifestV1;
      const entry = await readFile(join(root, manifest.entry), "utf8");
      expect(manifest.category).toBe("slides");
      expect(manifest.pptxCompatibility).toBe("native-editable");
      expect(entry).toContain("data-pptx-text");
      expect(entry).toContain("data-pptx-shape");
      expect(entry).not.toMatch(/(?:linear|radial)-gradient|\bfilter\s*:/i);
    }
  });

  test("build copies strict PPTX-compatible templates into the embedded server catalog", async () => {
    execFileSync(process.execPath, [join(serverRoot, "script", "copy-bundled-templates.mjs")], { cwd: serverRoot });
    const builtTemplatesRoot = join(serverRoot, "dist", "bundled-templates");
    for (const templateId of pptxCompatibleTemplateIds) {
      expect(existsSync(join(builtTemplatesRoot, templateId, "manifest.json"))).toBe(true);
    }
  });

  test("seeds the full personal template market and keeps its install state global", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-templates-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const first = await listTemplates(serverConfig, "alpha");
    expect(first.filter((item) => item.installed)).toHaveLength(74);
    expect(new Set(first.map((item) => item.manifest.category)).size).toBe(9);
    await uninstallTemplate(serverConfig, "alpha", "ipollowork.saas-landing");
    expect((await listTemplates(serverConfig, "alpha")).find((item) => item.manifest.id === "ipollowork.saas-landing")?.installed).toBe(false);
    expect((await listTemplates(serverConfig, "beta")).find((item) => item.manifest.id === "ipollowork.saas-landing")?.installed).toBe(false);
  });

  test("materializes a full session snapshot that survives template uninstall", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-materialize-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    await listTemplates(serverConfig, ws.id);
    const created = await materializeTemplate(serverConfig, ws, "ipollowork.saas-landing", "session_1", { name: "Demo" });
    expect(created.state.entry).toBe("design/session_1/entry.html");
    await uninstallTemplate(serverConfig, ws.id, "ipollowork.saas-landing");
    expect(await readFile(join(ws.path, created.state.entry), "utf8")).toContain("<!doctype html>");
    expect((await readTemplateSession(serverConfig, ws, "session_1")).manifest.id).toBe("ipollowork.saas-landing");
    expect(existsSync(join(ws.path, "design", "session_1", "template.json"))).toBe(false);
  });

  test("imports a valid local package and rejects traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-import-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const installed = await importTemplate(serverConfig, "alpha", localPackage(), "site");
    expect(installed.sourceType).toBe("local");
    expect(installed.verified).toBe(false);
    expect((await listTemplates(serverConfig, "beta")).some((item) => item.manifest.id === "local.clean-portfolio")).toBe(true);
    const resume = await importTemplate(serverConfig, "alpha", localPackage("local.resume", { category: "other", subcategory: "resume", title: "Resume" }), "other");
    expect(resume.manifest.category).toBe("other");
    await expect(importTemplate(serverConfig, "alpha", storedZip({ "../escape.html": "bad" }), "site")).rejects.toMatchObject({ code: "invalid_template_package" });
    await expect(importTemplate(serverConfig, "alpha", localPackage(), "slides")).rejects.toMatchObject({ code: "template_category_mismatch" });
    await expect(importTemplate(serverConfig, "alpha", localPackage("local.invalid-video", { category: "video", surface: "video" }), "video")).rejects.toMatchObject({ code: "invalid_template_manifest" });
  });

  test("requires HyperFrames variable declarations for local video templates only", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-video-import-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const installed = await importTemplate(serverConfig, "alpha", videoPackage(), "video");
    expect(installed.manifest.surface).toBe("video");
    await expect(importTemplate(serverConfig, "alpha", videoPackage("local.no-video-variables", "<!doctype html><html><body>Video</body></html>"), "video")).rejects.toMatchObject({ code: "invalid_video_template_variables" });
    await expect(importTemplate(serverConfig, "alpha", videoPackage("local.invalid-video-variable", "<!doctype html><html data-composition-variables='[{\"id\":\"title\",\"type\":\"string\",\"label\":\"Title\"}]'><body>Video</body></html>"), "video")).rejects.toMatchObject({ code: "invalid_video_template_variables" });
  });

  test("materializes video templates into the session-owned HyperFrames directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-video-template-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    await listTemplates(serverConfig, ws.id);
    const created = await materializeTemplate(serverConfig, ws, "ipollowork.html-anything.video-hyperframes", "session_video");
    expect(created.state.entry).toBe("video/session_video/index.html");
    expect(await readFile(join(ws.path, created.state.entry), "utf8")).toContain("data-composition-id");
    expect((await readTemplateSession(serverConfig, ws, "session_video")).manifest.surface).toBe("video");
  });

  test("saves a current design as a personal reusable template", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-save-template-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    await mkdir(join(ws.path, "design", "session_1"), { recursive: true });
    await writeFile(join(ws.path, "design", "session_1", "entry.html"), "<h1>Personal work</h1>");
    const saved = await saveTemplateFromSession(serverConfig, ws, { sessionId: "session_1", category: "site", title: "Personal landing" });
    expect(saved.manifest.id).toStartWith("personal.personal-landing.");
    expect((await listTemplates(serverConfig, "beta")).some((item) => item.manifest.id === saved.manifest.id)).toBe(true);
  });

  test("migrates legacy metadata once and removes the obsolete file", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-adopt-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const ws = workspace(root, "alpha");
    const serverConfig = config(root);
    const entry = "design/legacy_session/entry.html";
    await mkdir(join(ws.path, "design", "legacy_session"), { recursive: true });
    await writeFile(join(ws.path, entry), "<h1>User edited</h1>");
    const bundled = await readPackageFiles(join(bundledTemplatesRoot, "ipollowork.saas-landing"));
    const bundledManifest = JSON.parse(bundled["manifest.json"].toString("utf8")) as TemplateManifestV1;
    await writeFile(join(ws.path, "design", "legacy_session", "manifest.json"), bundled["manifest.json"]);
    await writeFile(join(ws.path, "design", "legacy_session", "template.json"), JSON.stringify({
      schemaVersion: 1,
      template: { id: bundledManifest.id, version: bundledManifest.version, sourceType: "bundled" },
      entry,
      briefPath: "design/legacy_session/brief.json",
      createdAt: 1,
    }));
    expect((await migrateTemplateSessionSnapshots(serverConfig, [ws])).migrated).toBe(1);
    expect(await readFile(join(ws.path, entry), "utf8")).toBe("<h1>User edited</h1>");
    expect((await readTemplateSession(serverConfig, ws, "legacy_session")).state.entry).toBe(entry);
    expect(existsSync(join(ws.path, "design", "legacy_session", "template.json"))).toBe(false);
  });
});
