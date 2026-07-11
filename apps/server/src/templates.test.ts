import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { adoptDesignSession, importTemplate, listTemplates, materializeTemplate, readDesignSessionTemplate, uninstallTemplate } from "./templates.js";

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

function storedZip(files: Record<string, string>): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(text);
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

function localPackage(id = "local.clean-portfolio") {
  const manifest = {
    schemaVersion: 1, id, version: "1.0.0", kind: "design", category: "site", subcategory: "portfolio", title: "Clean Portfolio", description: "A compact local portfolio template.", cover: "cover.svg", entry: "entry.html", source: { name: "Local author", license: "MIT" }, designSystem: { tokenVersion: 1, editableGroups: ["theme", "typography"] }, applyChecklist: ["Update the portfolio content"], minimumAppVersion: "0.17.0",
  };
  return storedZip({ "manifest.json": JSON.stringify(manifest), "entry.html": "<!doctype html><h1>Portfolio</h1>", "cover.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>", LICENSE: "MIT" });
}

describe("template installations", () => {
  test("seeds bundled templates once and keeps uninstall state isolated by workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-templates-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const first = await listTemplates(serverConfig, "alpha");
    expect(first.filter((item) => item.installed)).toHaveLength(2);
    await uninstallTemplate(serverConfig, "alpha", "ipollowork.saas-landing");
    expect((await listTemplates(serverConfig, "alpha")).find((item) => item.manifest.id === "ipollowork.saas-landing")?.installed).toBe(false);
    expect((await listTemplates(serverConfig, "beta")).find((item) => item.manifest.id === "ipollowork.saas-landing")?.installed).toBe(true);
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
    expect((await readDesignSessionTemplate(ws, "session_1")).manifest.id).toBe("ipollowork.saas-landing");
  });

  test("imports a valid local package and rejects traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-import-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const serverConfig = config(root);
    const installed = await importTemplate(serverConfig, "alpha", localPackage());
    expect(installed.sourceType).toBe("local");
    expect(installed.verified).toBe(false);
    await expect(importTemplate(serverConfig, "alpha", storedZip({ "../escape.html": "bad" }))).rejects.toMatchObject({ code: "invalid_template_package" });
  });

  test("adopts legacy metadata without overwriting the existing page", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-adopt-"));
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const ws = workspace(root, "alpha");
    const entry = "design/legacy.html";
    await writeFile(join(ws.path, entry), "<h1>User edited</h1>", { encoding: "utf8", flag: "wx" }).catch(async () => {
      const { mkdir } = await import("node:fs/promises"); await mkdir(join(ws.path, "design"), { recursive: true }); await writeFile(join(ws.path, entry), "<h1>User edited</h1>");
    });
    await adoptDesignSession(ws, "legacy_session", { templateId: "ipollowork.saas-landing", entry, brief: { name: "Legacy" } });
    expect(await readFile(join(ws.path, entry), "utf8")).toBe("<h1>User edited</h1>");
    expect((await readDesignSessionTemplate(ws, "legacy_session")).state.entry).toBe(entry);
  });
});
