import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { TEMPLATE_STYLE_LABELS, type TemplateManifestV1 } from "@ipollowork/types/templates";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { adoptLegacyVideoSession, importTemplate, listTemplates, materializeTemplate, migrateTemplateSessionSnapshots, parseTemplateLibraryScope, readTemplateSession, resolveBundledTemplatesRoot, saveTemplateFromSession, uninstallTemplate } from "./templates.js";

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
  "ipollowork.hyperframes.remote-worker-connect",
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
    expect(currentLogo).toContain('viewBox="-150 -150 776 800"');
    expect(currentLogo).not.toContain('viewBox="0 0 476 500"');
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
        expect(entry).toContain("assets/ipollowork-logo.svg?v=20260724");
      } else {
        expect(entry).not.toContain('src="assets/ipollowork-logo.svg"');
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
    expect(directories).toHaveLength(58);
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
      expect(manifest.version).toBe(upgradedCategories.has(manifest.category) || upgradedSlides ? "1.1.5" : "1.1.4");
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
        expect(entry).toContain("assets/ipollowork-logo.svg?v=20260724");
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
    expect(categoryCounts).toEqual({ article: 4, cards: 6, other: 4, report: 4, slides: 22, video: 8, poster: 2, site: 8 });
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
      expect(manifest.version).toBe("1.0.1");
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
      expect(entry).toContain("assets/ipollowork-logo.svg?v=20260724");
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
      "assets/ipollowork-logo.svg?v=20260724",
      "assets/missing-custom-logo.svg",
    ));

    await readTemplateSession(serverConfig, ws, "session_logo");

    const refreshedLogo = await readFile(logoPath, "utf8");
    expect(refreshedLogo).toContain('viewBox="-150 -150 776 800"');
    expect(refreshedLogo).not.toContain('fill="white"');
    const repairedEntry = await readFile(entryPath, "utf8");
    expect(repairedEntry).toContain('src="assets/missing-custom-logo.svg"');
    expect(repairedEntry).toContain('data-ipw-logo-fallback="current"');
    expect(repairedEntry).toContain("this.src='assets/ipollowork-logo.svg?v=20260724'");
  });

  test("refreshes the current iPolloWork logo when an existing design session opens", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-design-logo-refresh-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const ws = workspace(root, "alpha");
    await listTemplates(serverConfig, ws.id);
    await materializeTemplate(serverConfig, ws, "ipollowork.html-anything.saas-landing", "session_logo");
    const logoPath = join(ws.path, "design", "session_logo", "assets", "ipollowork-logo.svg");
    await writeFile(logoPath, '<svg viewBox="0 0 476 500"><rect fill="white"/></svg>');
    const entryPath = join(ws.path, "design", "session_logo", "entry.html");
    const entry = await readFile(entryPath, "utf8");
    await writeFile(entryPath, entry.replaceAll(
      "assets/ipollowork-logo.svg?v=20260724",
      "assets/ipollowork-logo.svg",
    ));

    await readTemplateSession(serverConfig, ws, "session_logo");

    const refreshedLogo = await readFile(logoPath, "utf8");
    expect(refreshedLogo).toContain('viewBox="-150 -150 776 800"');
    expect(refreshedLogo).not.toContain('viewBox="0 0 476 500"');
    expect(refreshedLogo).not.toContain('fill="white"');
    const repairedEntry = await readFile(entryPath, "utf8");
    expect(repairedEntry).toContain('src="assets/ipollowork-logo.svg?v=20260724"');
    expect(repairedEntry).toContain('data-ipw-logo-fallback="current"');
    expect(repairedEntry).toContain("this.src='assets/ipollowork-logo.svg?v=20260724'");
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
    expect(directories).toHaveLength(85);
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
    expect(hashes.size).toBe(85);
  });

  test("seeds the full personal template market and keeps its install state global", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-templates-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const first = await listTemplates(serverConfig, "alpha");
    expect(first.filter((item) => item.installed)).toHaveLength(85);
    expect(first.some((item) => item.manifest.id === "ipollowork.saas-landing")).toBe(true);
    expect(new Set(first.map((item) => item.manifest.category)).size).toBe(9);
    await uninstallTemplate(serverConfig, "alpha", "ipollowork.saas-landing");
    expect((await listTemplates(serverConfig, "alpha")).find((item) => item.manifest.id === "ipollowork.saas-landing")?.installed).toBe(false);
    expect((await listTemplates(serverConfig, "beta")).find((item) => item.manifest.id === "ipollowork.saas-landing")?.installed).toBe(false);
  });

  test("seeds only the remaining bundled templates into personal and Enterprise libraries", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-enterprise-bundled-templates-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const scope = parseTemplateLibraryScope("enterprise:ent_medical");
    const personal = await listTemplates(serverConfig, "alpha");
    const enterprise = await listTemplates(serverConfig, "alpha", scope);

    expect(personal).toHaveLength(85);
    expect(enterprise).toHaveLength(85);
    expect(personal.every((item) => item.manifest.pptxCompatibility !== "native-editable")).toBe(true);
    expect(enterprise.every((item) => item.manifest.pptxCompatibility !== "native-editable")).toBe(true);
  }, 15_000);

  test("purges persisted bundled packages that are no longer shipped", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-withdrawn-bundled-template-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    await listTemplates(serverConfig, "alpha");
    const templateId = "test.withdrawn-bundled-template";
    const packagePath = join(root, "templates", "__ipollowork_personal__", templateId, "1.0.0");
    await mkdir(packagePath, { recursive: true });
    await writeFile(join(packagePath, "manifest.json"), JSON.stringify({ id: templateId }), "utf8");
    const { Database } = await import("bun:sqlite");
    const sqlite = new Database(join(root, "runtime.sqlite"));
    try {
      sqlite.query("INSERT INTO template_installations (workspace_id, template_id, version, source_type, package_path, package_hash, status, manifest_json, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        "__ipollowork_personal__", templateId, "1.0.0", "bundled", packagePath, "stale", "installed", JSON.stringify({ id: templateId }), Date.now(), Date.now(),
      );
    } finally {
      sqlite.close();
    }

    await listTemplates(serverConfig, "alpha");

    expect(existsSync(packagePath)).toBe(false);
    const verification = new Database(join(root, "runtime.sqlite"));
    try {
      expect(verification.query("SELECT COUNT(*) AS count FROM template_installations WHERE template_id = ?").get(templateId)).toEqual({ count: 0 });
    } finally {
      verification.close();
    }
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
    expect((await listTemplates(serverConfig, "alpha", scope)).every((item) => item.sourceType === "bundled")).toBe(true);
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
    const created = await materializeTemplate(serverConfig, ws, "ipollowork.saas-landing", "session_1", { name: "Demo" });
    expect(created.state.entry).toBe("design/session_1/entry.html");
    await uninstallTemplate(serverConfig, ws.id, "ipollowork.saas-landing");
    expect(await readFile(join(ws.path, created.state.entry), "utf8")).toContain("<!doctype html>");
    expect((await readTemplateSession(serverConfig, ws, "session_1")).manifest.id).toBe("ipollowork.saas-landing");
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
