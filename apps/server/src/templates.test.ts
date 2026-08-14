import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { IPOLLOWORK_PACKAGE_EXTENSION, MAX_TEMPLATE_PACKAGE_BYTES, TEMPLATE_AUTHORING_ID_PREFIX, TEMPLATE_STYLE_LABELS, type TemplateCategory, type TemplateManifestV1 } from "@ipollowork/types/templates";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { isCustomerVisibleBundledTemplate, adoptLegacyVideoSession, createTemplateAuthoringSession, exportLocalTemplatePackage, exportTemplateFromSession, importTemplate, installBundledTemplate, listTemplates, materializeTemplate, migrateTemplateSessionSnapshots, parseTemplateLibraryScope, readTemplateSession, resolveBundledTemplatesRoot, saveTemplateFromSession, uninstallTemplate, validateTemplateFromSession, validateTemplatePackageDirectory } from "./templates.js";

const previousRuntimeDb = process.env.IPOLLOWORK_RUNTIME_DB;
const previousBundledTemplatesDir = process.env.IPOLLOWORK_BUNDLED_TEMPLATES_DIR;
const crc32Table = Uint32Array.from({ length: 256 }, (_, value) => {
  let entry = value;
  for (let bit = 0; bit < 8; bit += 1) entry = entry & 1 ? 0xedb88320 ^ (entry >>> 1) : entry >>> 1;
  return entry >>> 0;
});

function crc32(data: Uint8Array): number {
  let checksum = 0xffffffff;
  for (const byte of data) checksum = crc32Table[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
}

afterEach(() => {
  if (previousRuntimeDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
  else process.env.IPOLLOWORK_RUNTIME_DB = previousRuntimeDb;
  if (previousBundledTemplatesDir === undefined) delete process.env.IPOLLOWORK_BUNDLED_TEMPLATES_DIR;
  else process.env.IPOLLOWORK_BUNDLED_TEMPLATES_DIR = previousBundledTemplatesDir;
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
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(data), 16);
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

const bundledTemplatesRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "bundled-templates");
const pptxCompatibleTemplateIds = [
  "ipollowork.pptx-exhibition-curation",
  "ipollowork.pptx-film-treatment",
  "ipollowork.pptx-impact-report",
  "ipollowork.pptx-learning-journey",
  "ipollowork.pptx-merger-integration",
  "ipollowork.pptx-restaurant-opening",
  "ipollowork.pptx-supply-continuity",
  "ipollowork.pptx-urban-mobility",
  "ipollowork.pptx-annual-review",
  "ipollowork.pptx-brand-narrative",
  "ipollowork.pptx-product-launch",
  "ipollowork.pptx-research-signals",
  "ipollowork.pptx-venture-blueprint",
  "ipollowork.pptx-northstar-strategy",
];
const flagshipVideoTemplateIds = [
  "ipollowork.hyperframes.app-device-launch",
  "ipollowork.hyperframes.automation-day-planner",
  "ipollowork.hyperframes.agent-command-center",
  "ipollowork.hyperframes.cost-saving-waterfall",
  "ipollowork.hyperframes.connector-pulse",
  "ipollowork.hyperframes.feature-orbit",
  "ipollowork.hyperframes.course-journey",
  "ipollowork.hyperframes.code-explainer",
  "ipollowork.hyperframes.brand-liquid-sizzle",
  "ipollowork.hyperframes.data-proof-story",
  "ipollowork.hyperframes.human-approval-branch",
  "ipollowork.hyperframes.local-file-cascade",
  "ipollowork.hyperframes.meeting-action-conveyor",
  "ipollowork.hyperframes.multilingual-type-stage",
  "ipollowork.hyperframes.multi-agent-relay",
  "ipollowork.hyperframes.permission-vault",
  "ipollowork.hyperframes.plugin-exploded-blueprint",
  "ipollowork.hyperframes.prompt-ab-laboratory",
  "ipollowork.hyperframes.release-spotlight",
  "ipollowork.hyperframes.research-evidence-wall",
];
const novelVideoTemplates = [
  { id: "ipollowork.hyperframes.meeting-action-conveyor", composition: "meeting-action-conveyor", duration: "11", scenes: 4 },
  { id: "ipollowork.hyperframes.research-evidence-wall", composition: "research-evidence-wall", duration: "14", scenes: 5 },
  { id: "ipollowork.hyperframes.permission-vault", composition: "permission-vault", duration: "10", scenes: 3 },
  { id: "ipollowork.hyperframes.local-file-cascade", composition: "local-file-cascade", duration: "13", scenes: 4 },
  { id: "ipollowork.hyperframes.prompt-ab-laboratory", composition: "prompt-ab-laboratory", duration: "15", scenes: 3 },
  { id: "ipollowork.hyperframes.automation-day-planner", composition: "automation-day-planner", duration: "16", scenes: 5 },
  { id: "ipollowork.hyperframes.multilingual-type-stage", composition: "multilingual-type-stage", duration: "9", scenes: 3 },
  { id: "ipollowork.hyperframes.cost-saving-waterfall", composition: "cost-saving-waterfall", duration: "18", scenes: 6 },
  { id: "ipollowork.hyperframes.plugin-exploded-blueprint", composition: "plugin-exploded-blueprint", duration: "12", scenes: 4 },
  { id: "ipollowork.hyperframes.human-approval-branch", composition: "human-approval-branch", duration: "17", scenes: 5 },
];

function importedTemplateId(id: string) {
  return `test.${id.replace(/^ipollowork\./, "")}`;
}

function deflatedZip(name: string, contents: string, declaredSize: number): Uint8Array {
  const nameBuffer = Buffer.from(name);
  const data = Buffer.from(contents);
  const compressed = deflateRawSync(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(declaredSize, 22);
  local.writeUInt16LE(nameBuffer.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(nameBuffer.length, 28);
  const centralOffset = local.length + nameBuffer.length + compressed.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuffer.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBuffer, compressed, central, nameBuffer, eocd]);
}

function htmlAttribute(tag: string, name: string) {
  return tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1]?.trim() ?? "";
}

function websiteInteractionProblems(entry: string) {
  const ids = new Set(Array.from(entry.matchAll(/\sid=["']([^"']+)["']/gi), (match) => match[1]));
  const buttons = Array.from(entry.matchAll(/<button\b[^>]*>/gi), (match) => match[0]);
  const links = Array.from(entry.matchAll(/<a\b[^>]*>/gi), (match) => match[0]);
  const scripts = Array.from(
    entry.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
    (match) => match[1],
  );
  const inertButtons = buttons.filter((tag) => {
    const type = htmlAttribute(tag, "type");
    return !(
      tag.includes("mobile-nav-toggle")
      || type === "submit"
      || htmlAttribute(tag, "data-ipw-action-message")
      || htmlAttribute(tag, "data-ipw-toggle")
    );
  });
  const badLinks = links.filter((tag) => {
    const href = htmlAttribute(tag, "href");
    return !href || href === "#" || (href.startsWith("#") && !ids.has(href.slice(1)));
  });
  const fallbackButtons = buttons.filter((tag) => htmlAttribute(tag, "data-ipw-action-message"));
  const scriptIsIsolated = (script: string) => /^\s*\(\(\)\s*=>\s*\{[\s\S]*\}\)\(\);?\s*$/.test(script);
  return {
    inertButtons,
    badLinks,
    hasFallbackStatus: fallbackButtons.length === 0 || /<(?:p|div)\b[^>]*(?:role=["']status["']|aria-live=["']polite["'])/i.test(entry),
    scriptsParseTogether: (() => {
      try { new Function(scripts.join("\n")); return true; } catch { return false; }
    })(),
    scriptsAreIsolated: scripts.every(scriptIsIsolated),
  };
}

function interactiveButton(dataset: Record<string, string>) {
  const attributes = new Map<string, string>();
  const listeners = new Map<string, () => void>();
  return {
    dataset,
    attributes,
    listeners,
    classList: { toggle: (_name: string, _active: boolean) => undefined },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
  };
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

function slidesPackage(id = "local.native-deck", entry = "<!doctype html><section data-ipw-slide><h1 data-pptx-text>Deck</h1></section>", overrides: Record<string, unknown> = {}) {
  const manifest = {
    schemaVersion: 1, id, version: "1.0.0", kind: "design", category: "slides", subcategory: "pitch", style: "minimal", tags: ["pitch"], pptxCompatibility: "native-editable", surface: "design", title: "Native Deck", description: "A local editable presentation template.", cover: "cover.svg", entry: "entry.html", source: { name: "Local author", license: "MIT" }, designSystem: { tokenVersion: 1, editableGroups: ["theme", "typography"] }, applyChecklist: ["Update the presentation content"], minimumAppVersion: "0.17.0", ...overrides,
  };
  return storedZip({ "manifest.json": JSON.stringify(manifest), "entry.html": entry, "cover.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>", LICENSE: "MIT" });
}

function videoPackage(id = "local.product-video", entry = "<!doctype html><html data-composition-variables='[{\"id\":\"title\",\"type\":\"string\",\"label\":\"Title\",\"default\":\"Product Reveal\"},{\"id\":\"accent\",\"type\":\"color\",\"label\":\"Accent\",\"default\":\"#7c3aed\"}]'><body><div id=\"root\" data-composition-id=\"main\" data-width=\"1920\" data-height=\"1080\" data-duration=\"6\"><h1 data-var-text=\"title\">Product Reveal</h1></div></body></html>") {
  const manifest = {
    schemaVersion: 1, id, version: "1.0.0", kind: "design", category: "video", subcategory: "product", style: "minimal", tags: ["product"], surface: "video", title: "Product Video", description: "A local HyperFrames video template.", cover: "cover.svg", entry: "index.html", source: { name: "Local author", license: "MIT" }, designSystem: { tokenVersion: 1, editableGroups: ["theme", "typography"] }, applyChecklist: ["Update the video content"], minimumAppVersion: "0.17.0",
  };
  return storedZip({ "manifest.json": JSON.stringify(manifest), "index.html": entry, "cover.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>", LICENSE: "MIT" });
}

describe("template installations", () => {
  test("ships every built-in design, presentation, and video with the shared theme contract", async () => {
    const currentLogo = await readFile(join(bundledTemplatesRoot, "ipollowork.hyperframes.course-journey", "assets", "ipollowork-logo.svg"), "utf8");
    expect(currentLogo).toContain('viewBox="0 0 281 298"');
    expect(currentLogo).not.toContain('viewBox="-150 -150 776 800"');
    for (const directory of await readdir(bundledTemplatesRoot)) {
      const root = join(bundledTemplatesRoot, directory);
      const manifestPath = join(root, "manifest.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as TemplateManifestV1;
      if (manifest.kind !== "design") continue;
      expect(manifest.designSystem.tokens).toBe("design-tokens.css");
      const tokens = await readFile(join(root, manifest.designSystem.tokens!), "utf8");
      const entry = await readFile(join(root, manifest.entry), "utf8");
      expect(tokens).toContain("--ipw-color-bg");
      expect(tokens).toContain("--ipw-color-primary");
      expect(entry).toMatch(/<link\b[^>]*href=["']design-tokens\.css["'][^>]*>/i);
      expect(entry.lastIndexOf("design-tokens.css")).toBeGreaterThan(entry.lastIndexOf("</style>"));
      const logoPath = join(root, "assets", "ipollowork-logo.svg");
      if (existsSync(logoPath)) {
        expect(await readFile(logoPath, "utf8")).toBe(currentLogo);
        expect(entry).not.toContain("assets/ipollowork-logo.svg?v=20260721");
      }
      if (manifest.surface === "video") {
        expect(tokens).toContain("--accent: var(--ipw-color-primary) !important");
        expect(entry).toContain("assets/ipollowork-logo.svg?v=20260729");
      } else {
        expect(entry).not.toContain('src="assets/ipollowork-logo.svg"');
      }
      if (manifest.id === "ipollowork.html-anything.web-proto-soft") {
        expect(entry).toContain("data-ipw-brand-critical");
        expect(entry).toContain(".ipw-brand-slot img{display:block;width:18px;height:18px");
      }
    }
  });

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
    expect(adopted.manifest.id).toBe("ipollowork.html-anything.motion-frames");
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
    expect(directories).toHaveLength(52);
    const categoryCounts: Record<string, number> = {};
    for (const directory of directories) {
      const root = join(bundledTemplatesRoot, directory);
      const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as TemplateManifestV1;
      categoryCounts[manifest.category] = (categoryCounts[manifest.category] ?? 0) + 1;
      expect(TEMPLATE_STYLE_LABELS[manifest.style]).toBeTruthy();
      expect(manifest.source.license).toBe("Apache-2.0");
      expect(manifest.source.revision).toBe("d0efb1eaa3b65c731709981718cd5a0a0d4e8f71");
      const upgradedCategories = new Set(["site", "other", "video"]);
      const upgradedSlides = manifest.category === "slides" && manifest.id !== "ipollowork.html-anything.weekly-update";
      const recategorizedTemplates = new Set(["ipollowork.html-anything.wireframe-sketch"]);
      expect(manifest.version).toBe(upgradedCategories.has(manifest.category) || upgradedSlides || recategorizedTemplates.has(manifest.id) ? "1.1.5" : "1.1.4");
      expect(manifest.cover).toBe("cover.png");
      expect(JSON.stringify(manifest)).not.toMatch(/[\u3000-\u30ff\u31f0-\u31ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/);
      expect(manifest.designSystem.variables.length).toBeGreaterThanOrEqual(manifest.surface === "video" ? 4 : 20);
      const entry = await readFile(join(root, manifest.entry), "utf8");
      expect(entry).toMatch(manifest.surface === "video" ? /(data-var-src="logoUrl"|data-var-text="brandName")/ : /data-ipw-brand-slot/);
      expect(entry).not.toMatch(/HTML[- ]ANYTHING|OPEN DESIGN|Open Design/i);
      if (manifest.surface !== "video") {
        expect(entry).not.toMatch(/[\u3000-\u30ff\u31f0-\u31ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/);
      }
      if (manifest.surface === "video") {
        const currentLogo = await readFile(join(
          bundledTemplatesRoot,
          "ipollowork.hyperframes.course-journey",
          "assets",
          "ipollowork-logo.svg",
        ), "utf8");
        expect(entry).toContain("assets/ipollowork-logo.svg?v=20260729");
        expect(entry).not.toContain("assets/ipollowork-logo.svg?v=20260721");
        const bundledLogo = await readFile(join(root, "assets", "ipollowork-logo.svg"), "utf8");
        expect(bundledLogo).toBe(currentLogo);
        expect(bundledLogo).not.toMatch(/<rect[^>]+fill=["'](?:white|#fff(?:fff)?)["']/i);
        expect(bundledLogo).not.toMatch(/<image\b/i);
        expect(entry).toMatch(/(?:left|right):\s*\d+px[^}]*?(?:top|bottom):\s*\d+px|(?:top|bottom):\s*\d+px[^}]*?(?:left|right):\s*\d+px/i);
      }
      if (manifest.category === "slides") {
        const visualTemplateId = manifest.id.replace("ipollowork.html-anything.", "");
        expect(entry).toContain(`data-ipw-template="${visualTemplateId}"`);
      }
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
    expect(categoryCounts).toEqual({ article: 4, cards: 4, other: 4, report: 4, slides: 19, video: 7, poster: 3, site: 7 });
  });

  test("ships flagship HyperFrames video templates with local deterministic runtimes", async () => {
    const directories = (await readdir(bundledTemplatesRoot)).filter((name) => name.startsWith("ipollowork.hyperframes."));
    expect(directories).toHaveLength(flagshipVideoTemplateIds.length);
    const currentLogo = await readFile(join(
      bundledTemplatesRoot,
      "ipollowork.hyperframes.course-journey",
      "assets",
      "ipollowork-logo.svg",
    ), "utf8");
    for (const templateId of flagshipVideoTemplateIds) {
      const root = join(bundledTemplatesRoot, templateId);
      const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as TemplateManifestV1;
      const entry = await readFile(join(root, manifest.entry), "utf8");
      expect(manifest.designSystem.tokens).toBe("design-tokens.css");
      expect(entry).toMatch(/<link\b[^>]*href=["']design-tokens\.css["'][^>]*>/i);
      expect(manifest.category).toBe("video");
      expect(manifest.surface).toBe("video");
      expect(manifest.version).toBe(templateId === "ipollowork.hyperframes.course-journey" ? "1.0.2" : "1.0.1");
      expect(manifest.entry).toBe("index.html");
      expect(manifest.designSystem.tokens).toBe("design-tokens.css");
      expect(entry).toMatch(/<link\b[^>]*href=["']design-tokens\.css["'][^>]*>/i);
      expect(manifest.cover).toBe("cover.png");
      expect(manifest.source.license).toBe("Apache-2.0");
      const compositionId = entry.match(/\bdata-composition-id=["']([^"']+)["']/i)?.[1];
      expect(compositionId).toBeTruthy();
      expect(entry).toContain("data-composition-variables");
      expect(entry).toContain("gsap.timeline({ paused: true })");
      expect(entry).toContain(
        compositionId === "main"
          ? "window.__timelines.main"
          : `window.__timelines["${compositionId}"]`,
      );
      expect(entry).toContain("assets/ipollowork-logo.svg?v=20260729");
      expect(entry).not.toContain("assets/ipollowork-logo.svg?v=20260721");
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
      const bundledLogo = await readFile(join(root, "assets", "ipollowork-logo.svg"), "utf8");
      expect(bundledLogo).toBe(currentLogo);
      expect(bundledLogo).not.toMatch(/<rect[^>]+fill=["'](?:white|#fff(?:fff)?)["']/i);
      expect(bundledLogo).not.toMatch(/<image\b/i);
      expect(entry).toMatch(/(?:left|right):\s*\d+px[^}]*?(?:top|bottom):\s*\d+px|(?:top|bottom):\s*\d+px[^}]*?(?:left|right):\s*\d+px/i);
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
      const entry = await readFile(join(ws.path, created.state.entry), "utf8");
      const compositionId = entry.match(/\bdata-composition-id=["']([^"']+)["']/i)?.[1];
      expect(compositionId).toBeTruthy();
      expect(entry).toContain(
        compositionId === "main"
          ? "window.__timelines.main"
          : `window.__timelines["${compositionId}"]`,
      );
      expect(existsSync(join(ws.path, "video", sessionId, "brief.json"))).toBe(true);
    }
  }, 20_000);

  test("keeps the ten new HyperFrames compositions structurally distinct", async () => {
    const durations = new Set<string>();
    const compositions = new Set<string>();
    for (const template of novelVideoTemplates) {
      const root = join(bundledTemplatesRoot, template.id);
      const entry = await readFile(join(root, "index.html"), "utf8");
      expect(entry).toContain(`data-composition-id="${template.composition}"`);
      expect(entry).toContain(`data-duration="${template.duration}"`);
      expect(Array.from(entry.matchAll(/\bdata-ipw-scene(?:\s|>)/g))).toHaveLength(template.scenes);
      expect(entry).not.toContain('data-composition-id="main"');
      for (const file of ["manifest.json", "index.html", "design-tokens.css", "cover.svg", "cover.png", "NOTICE", "assets/gsap.min.js", "assets/ipollowork-logo.svg"]) {
        expect(existsSync(join(root, file))).toBe(true);
      }
      durations.add(template.duration);
      compositions.add(template.composition);
    }
    expect(durations.size).toBe(novelVideoTemplates.length);
    expect(compositions.size).toBe(novelVideoTemplates.length);
  });

  test("refreshes the current iPolloWork logo when an existing video session opens", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-video-logo-refresh-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    await listTemplates(serverConfig, ws.id);
    await materializeTemplate(serverConfig, ws, flagshipVideoTemplateIds[0]!, "session_logo");
    const logoPath = join(ws.path, "video", "session_logo", "assets", "ipollowork-logo.svg");
    await writeFile(logoPath, '<svg viewBox="-3 0 106 106"><rect fill="white"/></svg>');
    const entryPath = join(ws.path, "video", "session_logo", "index.html");
    const entry = await readFile(entryPath, "utf8");
    await writeFile(entryPath, entry.replaceAll(
      "assets/ipollowork-logo.svg?v=20260729",
      "assets/missing-custom-logo.svg",
    ));

    await readTemplateSession(serverConfig, ws, "session_logo");

    const refreshedLogo = await readFile(logoPath, "utf8");
    expect(refreshedLogo).toContain('viewBox="0 0 281 298"');
    expect(refreshedLogo).not.toContain('fill="white"');
    const repairedEntry = await readFile(entryPath, "utf8");
    expect(repairedEntry).toContain('src="assets/missing-custom-logo.svg"');
    expect(repairedEntry).toContain('data-ipw-logo-fallback="current"');
    expect(repairedEntry).toContain("this.src='assets/ipollowork-logo.svg?v=20260729'");
  });

  test("refreshes the current iPolloWork logo when an existing design session opens", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-design-logo-refresh-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    await listTemplates(serverConfig, ws.id);
    await materializeTemplate(serverConfig, ws, "ipollowork.html-anything.prototype-web", "session_logo");
    const logoPath = join(ws.path, "design", "session_logo", "assets", "ipollowork-logo.svg");
    await writeFile(logoPath, '<svg viewBox="0 0 476 500"><rect fill="white"/></svg>');
    const entryPath = join(ws.path, "design", "session_logo", "entry.html");
    const entry = await readFile(entryPath, "utf8");
    await writeFile(entryPath, entry.replaceAll(
      "assets/ipollowork-logo.svg?v=20260729",
      "assets/ipollowork-logo.svg",
    ));

    await readTemplateSession(serverConfig, ws, "session_logo");

    const refreshedLogo = await readFile(logoPath, "utf8");
    expect(refreshedLogo).toContain('viewBox="0 0 281 298"');
    expect(refreshedLogo).not.toContain('viewBox="0 0 476 500"');
    expect(refreshedLogo).not.toContain('fill="white"');
    const repairedEntry = await readFile(entryPath, "utf8");
    expect(repairedEntry).toContain('src="assets/ipollowork-logo.svg?v=20260729"');
    expect(repairedEntry).toContain('data-ipw-logo-fallback="current"');
    expect(repairedEntry).toContain("this.src='assets/ipollowork-logo.svg?v=20260729'");
  });

  test("ships every website template with accessible navigation and observable actions", async () => {
    const directories = (await readdir(bundledTemplatesRoot)).filter((name) => !name.startsWith("."));
    const websites: Array<{ manifest: TemplateManifestV1; entry: string }> = [];
    for (const directory of directories) {
      const root = join(bundledTemplatesRoot, directory);
      const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as TemplateManifestV1;
      if (manifest.category !== "site") continue;
      websites.push({ manifest, entry: await readFile(join(root, manifest.entry), "utf8") });
    }
    expect(websites).toHaveLength(22);
    for (const { manifest, entry } of websites) {
      expect(entry).toContain('name="viewport"');
      expect(entry).toContain('data-ipw-mobile-ready="true"');
      expect(entry).toMatch(/@media\s*\(max-width:/);
      if (/<nav\b|<header\s+class="nav"/.test(entry)) {
        expect(entry).toContain("mobile-nav-toggle");
        expect(entry).toContain('aria-expanded="false"');
      }
      expect(manifest.minimumAppVersion).toBeTruthy();
      const problems = websiteInteractionProblems(entry);
      expect(problems.inertButtons).toEqual([]);
      expect(problems.badLinks).toEqual([]);
      expect(problems.hasFallbackStatus).toBe(true);
      expect(problems.scriptsParseTogether).toBe(true);
      expect(problems.scriptsAreIsolated).toBe(true);
      if (manifest.id === "ipollowork.html-anything.prototype-web") {
        expect(entry).toContain('data-ipw-action-message="Demo only — no video is connected yet. Add your product video before publishing."');
      }
      if (manifest.id === "ipollowork.html-anything.waitlist-page") {
        expect(entry).not.toContain("You're on the list!");
        expect(entry).toContain("Demo only — no information was sent. Connect this form to your signup service before publishing.");
      }
    }
  });

  test("keeps the scenario template batch structurally distinct", async () => {
    const signatures = new Map([
      ["ipollowork.pptx-exhibition-curation", 'class="curator-wall"'],
      ["ipollowork.pptx-film-treatment", 'class="film-strip"'],
      ["ipollowork.pptx-impact-report", 'class="impact-river"'],
      ["ipollowork.pptx-learning-journey", 'class="lesson-path"'],
      ["ipollowork.pptx-merger-integration", 'class="integration-rail"'],
      ["ipollowork.pptx-restaurant-opening", 'class="service-book"'],
      ["ipollowork.pptx-supply-continuity", 'class="continuity-board"'],
      ["ipollowork.pptx-urban-mobility", 'class="civic-grid"'],
      ["ipollowork.pptx-product-launch", 'class="launch-deck"'],
      ["ipollowork.pptx-annual-review", 'class="review-deck"'],
      ["ipollowork.pptx-research-signals", 'class="research-deck"'],
      ["ipollowork.pptx-brand-narrative", 'class="brand-book"'],
      ["ipollowork.pptx-venture-blueprint", 'class="venture-deck"'],
      ["ipollowork.site-atelier-architecture", 'class="project-index"'],
      ["ipollowork.site-orbit-data", 'class="query-window"'],
      ["ipollowork.site-forma-portfolio", 'class="project-grid"'],
      ["ipollowork.site-kindred-care", 'class="pathways"'],
      ["ipollowork.site-afterglow-festival", 'class="lineup-marquee"'],
      ["ipollowork.site-archive-museum", 'class="exhibit-index"'],
      ["ipollowork.site-commonform-careers", 'class="role-board"'],
      ["ipollowork.site-ember-table", 'class="menu-counter"'],
      ["ipollowork.site-fieldstone-realty", 'class="property-ledger"'],
      ["ipollowork.site-northstar-clinic", 'class="care-router"'],
      ["ipollowork.site-openhands-foundation", 'class="giving-story"'],
      ["ipollowork.site-relay-developer", 'class="api-console"'],
      ["ipollowork.site-tidehouse-hotel", 'class="stay-journal"'],
      ["ipollowork.site-vector-freight", 'class="shipment-map"'],
    ]);
    const entries: string[] = [];
    for (const [templateId, signature] of signatures) {
      const entry = await readFile(join(bundledTemplatesRoot, templateId, "entry.html"), "utf8");
      expect(entry).toContain(signature);
      const slideCount = (entry.match(/<section\b[^>]*\bdata-ipw-slide\b/g) ?? []).length;
      const pptxMarkerCount = (entry.match(/\bdata-pptx-(?:text|shape|image)\b/g) ?? []).length;
      const sectionOrder = Array.from(entry.matchAll(/<section\b[^>]*(?:id|class)="([^"]+)"/g), (match) => match[1]);
      if (templateId.startsWith("ipollowork.pptx-")) {
        expect(slideCount).toBe(6);
        expect(pptxMarkerCount).toBeGreaterThanOrEqual(60);
      } else {
        expect(sectionOrder.length).toBeGreaterThanOrEqual(3);
        expect(entry).toMatch(/<header\b/);
        expect(entry).toMatch(/<main\b/);
      }
      entries.push(entry);
    }
    expect(new Set(signatures.values()).size).toBe(signatures.size);
    expect(entries.every((entry) => !entry.includes('class="visual-grid"'))).toBe(true);
  });

  test("runs website toggle and fallback interactions without leaking globals", async () => {
    const entry = await readFile(join(bundledTemplatesRoot, "ipollowork.html-anything.pricing-page", "entry.html"), "utf8");
    const scripts = Array.from(
      entry.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
      (match) => match[1],
    );
    const script = scripts.at(-1);
    if (!script) throw new Error("Pricing interaction script is missing");

    const monthly = interactiveButton({ ipwToggle: "monthly" });
    const yearly = interactiveButton({ ipwToggle: "yearly" });
    const team = interactiveButton({ ipwActionMessage: "Team plan selected. Connect this button to your checkout flow." });
    const status = { textContent: "" };
    const soloSuffix = { textContent: "/ month" };
    const teamSuffix = { textContent: "/ seat / month" };
    const soloPrice = { dataset: { monthly: "$8", yearly: "$80" }, firstChild: { textContent: "$8 " }, querySelector: () => soloSuffix };
    const teamPrice = { dataset: { monthly: "$14", yearly: "$140" }, firstChild: { textContent: "$14 " }, querySelector: () => teamSuffix };
    const documentFixture = {
      querySelector: (selector: string) => selector === "[data-ipw-action-status]" ? status : null,
      querySelectorAll: (selector: string) => {
        if (selector === "[data-ipw-toggle]") return [monthly, yearly];
        if (selector === ".price[data-monthly][data-yearly]") return [soloPrice, teamPrice];
        if (selector === "[data-ipw-action-message]") return [team];
        return [];
      },
    };

    new Function("document", script)(documentFixture);
    yearly.listeners.get("click")?.();
    team.listeners.get("click")?.();

    expect(yearly.attributes.get("aria-pressed")).toBe("true");
    expect(monthly.attributes.get("aria-pressed")).toBe("false");
    expect(soloPrice.firstChild.textContent).toBe("$80 ");
    expect(soloSuffix.textContent).toBe("/ year");
    expect(status.textContent).toBe("Team plan selected. Connect this button to your checkout flow.");
  });

  test("submits the waitlist form with visible success feedback", async () => {
    const entry = await readFile(join(bundledTemplatesRoot, "ipollowork.html-anything.waitlist-page", "entry.html"), "utf8");
    const script = Array.from(
      entry.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
      (match) => match[1],
    ).at(-1);
    if (!script) throw new Error("Waitlist interaction script is missing");

    let submit: ((event: { preventDefault: () => void }) => void) | undefined;
    let prevented = false;
    let visible = false;
    const form = {
      style: { display: "block" },
      checkValidity: () => true,
      reportValidity: () => undefined,
      addEventListener: (_type: string, listener: typeof submit) => { submit = listener; },
    };
    const success = { classList: { add: (name: string) => { visible = name === "visible"; } } };
    const documentFixture = {
      getElementById: (id: string) => id === "waitlist-form" ? form : id === "success-msg" ? success : null,
    };

    new Function("document", script)(documentFixture);
    submit?.call(form, { preventDefault: () => { prevented = true; } });

    expect(prevented).toBe(true);
    expect(form.style.display).toBe("none");
    expect(visible).toBe(true);
  });

  test("ships every bundled template with a real 960 by 540 PNG cover", async () => {
    const directories = (await readdir(bundledTemplatesRoot)).filter((name) => !name.startsWith("."));
    expect(directories).toHaveLength(107);
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
    expect(hashes.size).toBe(directories.length);
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
    const root = await mkdtemp(join(tmpdir(), "ipw-built-templates-"));
    const builtTemplatesRoot = join(root, "bundled-templates");
    try {
      execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "..", "script", "copy-bundled-templates.mjs"), builtTemplatesRoot]);
      for (const templateId of pptxCompatibleTemplateIds) {
        expect(existsSync(join(builtTemplatesRoot, templateId, "manifest.json"))).toBe(true);
        expect(existsSync(join(builtTemplatesRoot, `${templateId}${IPOLLOWORK_PACKAGE_EXTENSION}`))).toBe(true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("publishes curated site, video and slide templates while keeping the other non-deleted categories", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-templates-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const first = await listTemplates(serverConfig, "alpha");
    const expected = (await readdir(bundledTemplatesRoot))
      .filter((name) => !name.startsWith("."))
      .map((directory) => JSON.parse(readFileSync(join(bundledTemplatesRoot, directory, "manifest.json"), "utf8")) as TemplateManifestV1)
      .filter(isCustomerVisibleBundledTemplate)
      .map((manifest) => manifest.id)
      .sort();
    expect(first.map((item) => item.manifest.id).sort()).toEqual(expected);
    expect(first.filter((item) => item.installed)).toHaveLength(expected.length);
    expect(first.some((item) => item.manifest.id === "ipollowork.saas-landing")).toBe(false);
    expect(first.some((item) => item.manifest.id === "ipollowork.pptx-northstar-strategy")).toBe(false);
    expect(first.some((item) => item.manifest.id === "ipollowork.app-calm-mobile")).toBe(true);
    expect(first.some((item) => item.manifest.id === "ipollowork.html-anything.social-carousel")).toBe(true);
    expect(first.some((item) => item.manifest.id === "ipollowork.html-anything.data-report")).toBe(true);
    expect(first.some((item) => item.manifest.id === "ipollowork.html-anything.deck-open-slide-canvas")).toBe(false);
    expect(first.find((item) => item.manifest.id === "ipollowork.html-anything.wireframe-sketch")?.manifest.category).toBe("poster");
    expect(first.find((item) => item.manifest.id === "ipollowork.site-atelier-architecture")?.manifest.category).toBe("article");
    await uninstallTemplate(serverConfig, "alpha", "ipollowork.html-anything.prototype-web");
    expect((await listTemplates(serverConfig, "alpha")).find((item) => item.manifest.id === "ipollowork.html-anything.prototype-web")?.installed).toBe(false);
    expect((await listTemplates(serverConfig, "beta")).find((item) => item.manifest.id === "ipollowork.html-anything.prototype-web")?.installed).toBe(false);
  });

  test("upgrades an installed bundled template before materializing it", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-template-upgrade-"));
    const runtimeDb = join(root, "runtime.sqlite");
    process.env.IPOLLOWORK_RUNTIME_DB = runtimeDb;
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    const templateId = "ipollowork.site-atelier-architecture";

    await listTemplates(serverConfig, ws.id);
    const sqlite = new Database(runtimeDb);
    const current = sqlite.query<{ packagePath: string }, [string, string]>(
      "SELECT package_path AS packagePath FROM template_installations WHERE workspace_id = ? AND template_id = ?",
    ).get("__ipollowork_personal__", templateId);
    if (!current) throw new Error("Expected the bundled template to be installed");
    const legacyPackagePath = join(dirname(current.packagePath), "1.0.0");
    await mkdir(legacyPackagePath, { recursive: true });
    await writeFile(join(legacyPackagePath, "entry.html"), '<main class="legacy-template"></main>');
    sqlite.run(
      "UPDATE template_installations SET version = ?, package_path = ?, package_hash = ? WHERE workspace_id = ? AND template_id = ?",
      ["1.0.0", legacyPackagePath, "legacy-package-hash", "__ipollowork_personal__", templateId],
    );
    sqlite.close();

    const refreshed = await listTemplates(serverConfig, ws.id);
    expect(refreshed.find((item) => item.manifest.id === templateId)).toMatchObject({ installedVersion: "1.0.0", updateAvailable: true });
    await installBundledTemplate(serverConfig, ws.id, templateId);
    expect((await listTemplates(serverConfig, ws.id)).find((item) => item.manifest.id === templateId)).toMatchObject({ installedVersion: "1.1.0", updateAvailable: false });
    expect(existsSync(legacyPackagePath)).toBe(false);
    const created = await materializeTemplate(serverConfig, ws, templateId, "session_upgraded");
    expect(await readFile(join(ws.path, created.state.entry), "utf8")).toContain('class="project-index"');
  });

  test("does not ship removed templates into the personal template market", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-templates-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const first = await listTemplates(serverConfig, "alpha");
    const removedIds = ["ipollowork.html-anything.deck-xhs-post", "ipollowork.html-anything.social-x-post-card"];
    for (const templateId of removedIds) {
      expect(existsSync(join(bundledTemplatesRoot, templateId))).toBe(false);
      expect(first.some((item) => item.manifest.id === templateId)).toBe(false);
    }
  });

  test("keeps Enterprise-imported templates isolated from the personal library", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-enterprise-templates-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const scope = parseTemplateLibraryScope("enterprise:ent_medical");
    expect((await listTemplates(serverConfig, "alpha", scope)).filter((item) => item.sourceType === "bundled")).toHaveLength(107);
    const installed = await importTemplate(serverConfig, "alpha", localPackage(), "site", scope);
    expect((await listTemplates(serverConfig, "beta", scope)).map((item) => item.manifest.id)).toContain(installed.manifest.id);
    expect((await listTemplates(serverConfig, "beta", "personal")).map((item) => item.manifest.id)).not.toContain(installed.manifest.id);
    const ws = workspace(root, "alpha");
    await expect(materializeTemplate(serverConfig, ws, installed.manifest.id, "enterprise_session", undefined, scope)).resolves.toMatchObject({ manifest: { id: installed.manifest.id } });
    await expect(materializeTemplate(serverConfig, ws, installed.manifest.id, "personal_session")).rejects.toMatchObject({ code: "template_not_installed" });
    expect(() => parseTemplateLibraryScope("enterprise:medical")).toThrow("Template scope must be personal");
  }, 15_000);

  test("materializes a full session snapshot that survives template uninstall", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-materialize-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    await listTemplates(serverConfig, ws.id);
    const created = await materializeTemplate(serverConfig, ws, "ipollowork.html-anything.prototype-web", "session_1", { name: "Demo" });
    expect(created.state.entry).toBe("design/session_1/entry.html");
    await uninstallTemplate(serverConfig, ws.id, "ipollowork.html-anything.prototype-web");
    expect(await readFile(join(ws.path, created.state.entry), "utf8")).toMatch(/<!doctype html>/i);
    expect((await readTemplateSession(serverConfig, ws, "session_1")).manifest.id).toBe("ipollowork.html-anything.prototype-web");
    expect(existsSync(join(ws.path, "design", "session_1", "template.json"))).toBe(false);
  });

  test("resolves an explicit bundled template directory for headless runtimes", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-bundled-templates-"));
    try {
      process.env.IPOLLOWORK_BUNDLED_TEMPLATES_DIR = root;
      expect(resolveBundledTemplatesRoot()).toBe(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
    await expect(importTemplate(serverConfig, "alpha", localPackage("local.future-package", { schemaVersion: 2 }), "site")).rejects.toMatchObject({ code: "unsupported_template_schema" });
  });

  test("reimports equivalent .ipwp and legacy .ipwt content without a false version conflict", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-import-identity-"));
    const runtimeDb = join(root, "runtime.sqlite");
    process.env.IPOLLOWORK_RUNTIME_DB = runtimeDb;
    const serverConfig = config(root);
    const archive = localPackage("local.compatible-package");
    await importTemplate(serverConfig, "alpha", archive, "site");

    const legacyArchiveHash = createHash("sha256").update(archive).digest("hex");
    const sqlite = new Database(runtimeDb);
    sqlite.query("UPDATE template_installations SET package_hash = ? WHERE workspace_id = ? AND template_id = ?")
      .run(legacyArchiveHash, "__ipollowork_personal__", "local.compatible-package");
    sqlite.close();

    await expect(importTemplate(serverConfig, "alpha", archive, "site")).resolves.toMatchObject({ manifest: { id: "local.compatible-package" } });
    const migrated = new Database(runtimeDb, { readonly: true });
    const row = migrated.query<{ packageHash: string }, [string, string]>(
      "SELECT package_hash AS packageHash FROM template_installations WHERE workspace_id = ? AND template_id = ?",
    ).get("__ipollowork_personal__", "local.compatible-package");
    migrated.close();
    expect(row?.packageHash).not.toBe(legacyArchiveHash);
    await rm(root, { recursive: true, force: true });
  });

  test("auto-detects imported categories while preserving scoped import checks", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-import-category-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const detected = await importTemplate(serverConfig, "alpha", localPackage("local.detected-site"));
    expect(detected.manifest.category).toBe("site");
    await expect(importTemplate(serverConfig, "alpha", localPackage("local.scoped-site"), "slides")).rejects.toMatchObject({ code: "template_category_mismatch" });
  });

  test("requires slideshow structure and honest PPTX compatibility markers", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-import-slides-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const installed = await importTemplate(serverConfig, "alpha", slidesPackage());
    expect(installed.manifest.category).toBe("slides");
    expect(installed.manifest.pptxCompatibility).toBe("native-editable");
    await expect(importTemplate(serverConfig, "alpha", slidesPackage("local.not-a-deck", "<!doctype html><main>Not a deck</main>", { pptxCompatibility: undefined }))).rejects.toMatchObject({ code: "invalid_slides_template" });
    await expect(importTemplate(serverConfig, "alpha", slidesPackage("local.false-pptx", "<!doctype html><section data-ipw-slide>Visual only</section>"))).rejects.toMatchObject({ code: "invalid_pptx_template" });
  });

  test("bounds decompression using the declared entry size", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-import-inflate-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    await expect(importTemplate(config(root), "alpha", deflatedZip("manifest.json", "x".repeat(1024), 1))).rejects.toMatchObject({ code: "invalid_template_package" });
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
    const created = await materializeTemplate(serverConfig, ws, "ipollowork.html-anything.motion-frames", "session_video");
    expect(created.state.entry).toBe("video/session_video/index.html");
    expect(await readFile(join(ws.path, created.state.entry), "utf8")).toContain("data-composition-id");
    expect((await readTemplateSession(serverConfig, ws, "session_video")).manifest.surface).toBe("video");
  });

  test("initializes every authoring category on its canonical Design or Video surface", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-authoring-categories-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    const categories: TemplateCategory[] = ["site", "video", "app", "slides", "poster", "cards", "report", "article", "other"];
    for (const category of categories) {
      const sessionId = `author_${category}`;
      const created = await createTemplateAuthoringSession(serverConfig, ws, { sessionId, category });
      expect(created.authoring).toBe(true);
      expect(created.manifest.id).toBe(`${TEMPLATE_AUTHORING_ID_PREFIX}${category}`);
      expect(created.surface).toBe(category === "video" ? "video" : "design");
      expect(existsSync(join(ws.path, created.state.entry))).toBe(true);
      expect(await validateTemplateFromSession(serverConfig, ws, sessionId)).toMatchObject({ ready: true, surface: created.surface });
    }
  });

  test("initializes native PPT and HyperFrames authoring contracts without changing session paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-authoring-surfaces-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    const ppt = await createTemplateAuthoringSession(serverConfig, ws, { sessionId: "author_ppt", category: "slides", pptxCompatibility: "native-editable" });
    const pptHtml = await readFile(join(ws.path, ppt.state.entry), "utf8");
    expect(ppt.state.entry).toBe("design/author_ppt/entry.html");
    expect(pptHtml).toContain("data-ipw-slide");
    expect(pptHtml).toContain("data-pptx-text");
    expect(pptHtml).toContain("data-pptx-shape");
    expect(pptHtml).toContain("data-pptx-image");

    const video = await createTemplateAuthoringSession(serverConfig, ws, { sessionId: "author_video", category: "video" });
    const videoHtml = await readFile(join(ws.path, video.state.entry), "utf8");
    expect(video.state.entry).toBe("video/author_video/index.html");
    expect(videoHtml).toContain("data-composition-variables");
    expect(videoHtml).toContain("data-composition-id");
    expect(videoHtml).toContain("data-track");
    expect(video.manifest.designSystem.variables.map((variable) => variable.id)).toEqual(["title", "accent"]);
    const studioSerializedVideo = videoHtml.replace(
      /data-composition-variables='([^']+)'/,
      (_attribute, json: string) => `data-composition-variables="${json.replace(/&/g, "&amp;").replace(/\"/g, "&quot;")}"`,
    );
    await writeFile(join(ws.path, video.state.entry), studioSerializedVideo);
    expect(await validateTemplatePackageDirectory(join(ws.path, "video", "author_video"))).toMatchObject({ ready: true, surface: "video" });
    await expect(createTemplateAuthoringSession(serverConfig, ws, { sessionId: "../escape", category: "site" })).rejects.toMatchObject({ code: "invalid_session_id" });
  });

  test("returns structured validation issues and never mutates the source project", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-authoring-validation-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    const created = await createTemplateAuthoringSession(serverConfig, ws, { sessionId: "author_invalid", category: "site" });
    const manifestBefore = await readFile(join(ws.path, "design", "author_invalid", "manifest.json"), "utf8");
    await writeFile(join(ws.path, "design", "author_invalid", "design-tokens.css"), ":root { --ipw-color-bg: #fff; }\n");
    const report = await validateTemplateFromSession(serverConfig, ws, "author_invalid");
    expect(report.ready).toBe(false);
    expect(report.surface).toBe("design");
    expect(report.issues[0]).toMatchObject({ code: "invalid_template_manifest", severity: "error" });
    expect(await readFile(join(ws.path, "design", "author_invalid", "manifest.json"), "utf8")).toBe(manifestBefore);
    expect((await readTemplateSession(serverConfig, ws, created.sessionId)).authoring).toBe(true);
  });

  test("uses the shared package validator for missing tokens, false PPT markers and invalid Video variables", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-package-validation-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");

    await createTemplateAuthoringSession(serverConfig, ws, { sessionId: "missing_token", category: "site" });
    const designRoot = join(ws.path, "design", "missing_token");
    await writeFile(join(designRoot, "design-tokens.css"), ":root { --ipw-color-bg: #fff; }\n");
    expect(await validateTemplatePackageDirectory(designRoot)).toMatchObject({
      ready: false,
      issues: [{ code: "invalid_template_manifest", severity: "error" }],
    });

    await createTemplateAuthoringSession(serverConfig, ws, { sessionId: "false_ppt", category: "slides", pptxCompatibility: "native-editable" });
    const pptRoot = join(ws.path, "design", "false_ppt");
    await writeFile(join(pptRoot, "entry.html"), "<!doctype html><section data-ipw-slide>Visual only</section>\n");
    expect(await validateTemplatePackageDirectory(pptRoot)).toMatchObject({
      ready: false,
      issues: [{ code: "invalid_pptx_template", severity: "error" }],
    });

    await createTemplateAuthoringSession(serverConfig, ws, { sessionId: "invalid_video", category: "video" });
    const videoRoot = join(ws.path, "video", "invalid_video");
    await writeFile(join(videoRoot, "index.html"), "<!doctype html><html data-composition-variables='[{\"id\":\"title\",\"type\":\"string\",\"label\":\"Title\"}]'><body><div data-composition-id=\"main\" data-duration=\"6\"></div></body></html>\n");
    expect(await validateTemplatePackageDirectory(videoRoot)).toMatchObject({
      ready: false,
      issues: [{ code: "invalid_video_template_variables", severity: "error" }],
    });
  });

  test("saves authoring work as new independent templates and preserves the source snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-authoring-save-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    const source = await createTemplateAuthoringSession(serverConfig, ws, { sessionId: "author_save", category: "site" });
    const sourceEntry = await readFile(join(ws.path, source.state.entry), "utf8");
    const first = await saveTemplateFromSession(serverConfig, ws, { sessionId: "author_save", category: "site", title: "Reusable site" });
    const second = await saveTemplateFromSession(serverConfig, ws, { sessionId: "author_save", category: "site", title: "Reusable site" });
    expect(first.manifest.id).not.toBe(second.manifest.id);
    expect(first.manifest.id).toStartWith("personal.reusable-site.");
    expect(first.manifest.designSystem.variables).toEqual(source.manifest.designSystem.variables);
    expect((await readTemplateSession(serverConfig, ws, "author_save")).manifest.id).toBe(source.manifest.id);
    expect(await readFile(join(ws.path, source.state.entry), "utf8")).toBe(sourceEntry);
    const instantiated = await materializeTemplate(serverConfig, ws, first.manifest.id, "saved_copy");
    expect(await readFile(join(ws.path, instantiated.state.entry), "utf8")).toBe(sourceEntry);
  });

  test("exports a current video session without installing it in My templates", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-video-session-export-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    await createTemplateAuthoringSession(serverConfig, ws, { sessionId: "video_export_only", category: "video" });
    const videoRoot = join(ws.path, "video", "video_export_only");
    const bgm = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
    await mkdir(join(videoRoot, "assets"), { recursive: true });
    await writeFile(join(videoRoot, "assets", "bgm.mp3"), bgm);
    await writeFile(
      join(videoRoot, "index.html"),
      (await readFile(join(videoRoot, "index.html"), "utf8")).replace(
        "</body>",
        '  <audio src="assets/bgm.mp3" data-track="audio" data-clip="bgm" data-start="0" data-duration="8"></audio>\n</body>',
      ),
    );
    const before = (await listTemplates(serverConfig, ws.id)).filter((item) => item.sourceType === "local");

    const exported = await exportTemplateFromSession(serverConfig, ws, {
      sessionId: "video_export_only",
      category: "video",
      title: "Exported video",
    });

    expect(exported.archive.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(exported.archive.includes(Buffer.from("assets/bgm.mp3"))).toBe(true);
    expect(exported.manifest).toMatchObject({ title: "Exported video", surface: "video", version: "1.0.0" });
    expect((await listTemplates(serverConfig, ws.id)).filter((item) => item.sourceType === "local")).toEqual(before);
    const imported = await importTemplate(serverConfig, ws.id, exported.archive, "video");
    expect(imported).toMatchObject({ sourceType: "local", manifest: { id: exported.manifest.id, surface: "video" } });
    const materialized = await materializeTemplate(serverConfig, ws, imported.manifest.id, "video_export_only_roundtrip");
    expect(await readFile(join(ws.path, "video", "video_export_only_roundtrip", "assets", "bgm.mp3"))).toEqual(bgm);
    expect(await readFile(join(ws.path, materialized.state.entry), "utf8")).toContain('src="assets/bgm.mp3"');
    await rm(root, { recursive: true, force: true });
  });

  test("exports a saved video deterministically and imports the canonical package again", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-video-export-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    await createTemplateAuthoringSession(serverConfig, ws, { sessionId: "video_export", category: "video" });
    const backupDirectory = join(ws.path, "video", "video_export", ".hyperframes", "backup");
    const backupFile = join(backupDirectory, "2026-08-05T09-41-42-645Z-aW5kZXguaHRtbA");
    await mkdir(backupDirectory, { recursive: true });
    await writeFile(backupFile, "session-only backup");
    const saved = await saveTemplateFromSession(serverConfig, ws, { sessionId: "video_export", category: "video", title: "Reusable video" });

    const first = await exportLocalTemplatePackage(serverConfig, ws.id, saved.manifest.id);
    const second = await exportLocalTemplatePackage(serverConfig, ws.id, saved.manifest.id);
    expect(first.archive.equals(second.archive)).toBe(true);
    expect(first.archive.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(first.digest).toBe(createHash("sha256").update(first.archive).digest("hex"));
    expect(first.manifest).toEqual(saved.manifest);
    expect(first.archive.includes(Buffer.from(".hyperframes/backup/"))).toBe(false);
    expect(existsSync(backupFile)).toBe(true);

    const imported = await importTemplate(serverConfig, ws.id, first.archive, "video");
    expect(imported).toMatchObject({ sourceType: "local", manifest: { id: saved.manifest.id, surface: "video" } });
    const materialized = await materializeTemplate(serverConfig, ws, imported.manifest.id, "video_roundtrip");
    const entry = await readFile(join(ws.path, materialized.state.entry), "utf8");
    expect(entry).toContain("data-composition-variables");
    expect(entry).toContain("data-composition-id");
    expect(entry).toContain("data-track");
    expect(existsSync(join(ws.path, "video", "video_roundtrip", ".hyperframes", "backup"))).toBe(false);
    await rm(root, { recursive: true, force: true });
  });

  test("rejects missing, non-personal, symbolic-link, non-static and oversized template exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-export-boundaries-"));
    const runtimeDb = join(root, "runtime.sqlite");
    process.env.IPOLLOWORK_RUNTIME_DB = runtimeDb;
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    await expect(exportLocalTemplatePackage(serverConfig, ws.id, "personal.missing")).rejects.toMatchObject({ code: "local_template_not_found" });
    await expect(exportLocalTemplatePackage(serverConfig, ws.id, "personal.missing", parseTemplateLibraryScope("enterprise:ent_export"))).rejects.toMatchObject({ code: "personal_template_export_required" });

    const installed = await importTemplate(serverConfig, ws.id, localPackage(), "site");
    const sqlite = new Database(runtimeDb);
    const row = sqlite.query<{ packagePath: string }, [string, string]>(
      "SELECT package_path AS packagePath FROM template_installations WHERE workspace_id = ? AND template_id = ?",
    ).get("__ipollowork_personal__", installed.manifest.id);
    sqlite.close();
    if (!row) throw new Error("Expected the local template to be installed");

    await writeFile(join(row.packagePath, "source.ts"), "export {}\n");
    await expect(exportLocalTemplatePackage(serverConfig, ws.id, installed.manifest.id)).rejects.toMatchObject({ code: "invalid_template_package" });
    await rm(join(row.packagePath, "source.ts"));

    await symlink("manifest.json", join(row.packagePath, "linked.json"));
    await expect(exportLocalTemplatePackage(serverConfig, ws.id, installed.manifest.id)).rejects.toMatchObject({ code: "invalid_template_package" });
    await rm(join(row.packagePath, "linked.json"));

    const maximumFileBytes = MAX_TEMPLATE_PACKAGE_BYTES / 2;
    await writeFile(join(row.packagePath, "oversized.bin"), Buffer.alloc(maximumFileBytes + 1));
    await expect(exportLocalTemplatePackage(serverConfig, ws.id, installed.manifest.id)).rejects.toMatchObject({ code: "template_package_too_large" });
    await rm(join(row.packagePath, "oversized.bin"));

    const maximumFile = Buffer.alloc(maximumFileBytes);
    await writeFile(join(row.packagePath, "first.bin"), maximumFile);
    await writeFile(join(row.packagePath, "second.bin"), maximumFile);
    await expect(exportLocalTemplatePackage(serverConfig, ws.id, installed.manifest.id)).rejects.toMatchObject({ code: "template_package_too_large" });
    await rm(join(row.packagePath, "first.bin"));
    await rm(join(row.packagePath, "second.bin"));

    const existingFiles = Object.keys(await readPackageFiles(row.packagePath)).length;
    for (let start = 0; start < 1_001 - existingFiles; start += 100) {
      const count = Math.min(100, (1_001 - existingFiles) - start);
      await Promise.all(Array.from({ length: count }, (_, index) => writeFile(join(row.packagePath, `extra-${start + index}.txt`), "")));
    }
    await expect(exportLocalTemplatePackage(serverConfig, ws.id, installed.manifest.id)).rejects.toMatchObject({ code: "template_package_too_large" });
    await rm(root, { recursive: true, force: true });
  }, 30_000);

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
