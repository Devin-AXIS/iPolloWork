import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { templateManifestV1Schema } from "@ipollowork/types/templates";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { importTemplate, materializeTemplate } from "./templates.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "template-fixtures", "creative-studio");

async function text(path: string) {
  return readFile(join(root, path), "utf8");
}

function zipNames(buffer: Buffer) {
  const names: string[] = [];
  for (let offset = 0; offset <= buffer.length - 46; offset += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = buffer.readUInt16LE(offset + 28);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
  }
  return names;
}

describe("Creative Studio local Design template", () => {
  test("uses the local template manifest contract", async () => {
    const manifest = templateManifestV1Schema.parse(JSON.parse(await text("manifest.json")));

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      id: "startbootstrap.creative-studio",
      version: "1.0.0",
      kind: "design",
      category: "site",
      subcategory: "creative-agency",
      cover: "cover.svg",
      entry: "entry.html",
      source: {
        name: "Start Bootstrap Creative",
        repository: "https://github.com/StartBootstrap/startbootstrap-creative",
        license: "MIT",
      },
      designSystem: {
        tokenVersion: 1,
        tokens: "design-tokens.css",
        editableGroups: ["theme", "background", "typography", "components"],
      },
      minimumAppVersion: "0.17.20",
    });
  });

  test("ships an editable page with local portfolio artwork", async () => {
    const html = await text("entry.html");
    const files = await readdir(root);

    expect(files).toEqual(expect.arrayContaining(["manifest.json", "entry.html", "design-tokens.css", "cover.svg", "LICENSE", "assets"]));
    expect(html.toLowerCase()).toContain("<!doctype html>");
    expect(html).toContain('href="design-tokens.css"');
    for (const landmark of ["site-header", "hero", "services", "portfolio", "call-to-action", "contact", "site-footer"]) {
      expect(html).toContain(`data-template-section="${landmark}"`);
    }
    for (let index = 1; index <= 6; index += 1) {
      const number = String(index).padStart(2, "0");
      expect(html).toMatch(new RegExp(`<img[^>]+src="assets/portfolio-${number}\\.svg"[^>]+alt="[^"]+"`));
    }
  });

  test("has no runtime network or framework dependency", async () => {
    const runtime = `${await text("entry.html")}\n${await text("design-tokens.css")}`;

    expect(runtime).not.toMatch(/https?:\/\//i);
    expect(runtime).not.toMatch(/(?:src|href)=["']\/\//i);
    expect(runtime).not.toMatch(/@import\s/i);
    expect(runtime).not.toMatch(/bootstrap/i);
  });

  test("retains the complete upstream MIT notice", async () => {
    const license = await text("LICENSE");

    expect(license).toContain("The MIT License (MIT)");
    expect(license).toContain("Start Bootstrap LLC");
    expect(license).toContain("Permission is hereby granted, free of charge");
    expect(license).toContain("THE SOFTWARE IS PROVIDED \"AS IS\"");
  });

  test("packages at the archive root and imports into a Design session", async () => {
    const temp = await mkdtemp(join(tmpdir(), "creative-studio-ipwt-"));
    const archivePath = join(temp, "creative-studio.ipwt");
    const script = join(dirname(fileURLToPath(import.meta.url)), "..", "script", "package-template.mjs");
    const packageResult = Bun.spawnSync([process.execPath, script, root, archivePath], { stderr: "pipe" });
    expect(packageResult.exitCode).toBe(0);

    const archive = Buffer.from(await Bun.file(archivePath).arrayBuffer());
    const names = zipNames(archive);
    expect(names).toContain("manifest.json");
    expect(names).not.toContain("creative-studio/manifest.json");
    expect(new Set(names).size).toBe(names.length);

    process.env.IPOLLOWORK_RUNTIME_DB = join(temp, "runtime.sqlite");
    const config: ServerConfig = {
      host: "127.0.0.1", port: 0, token: "test", hostToken: "host",
      approval: { mode: "auto", timeoutMs: 1_000 }, corsOrigins: ["*"], workspaces: [], authorizedRoots: [temp],
      readOnly: false, startedAt: Date.now(), tokenSource: "env", hostTokenSource: "env", logFormat: "pretty", logRequests: false,
    };
    const workspace: WorkspaceInfo = { id: "creative", name: "Creative", path: join(temp, "workspace"), preset: "default", workspaceType: "local" };
    const installed = await importTemplate(config, workspace.id, archive);
    expect(installed.manifest.id).toBe("startbootstrap.creative-studio");
    const created = await materializeTemplate(config, workspace, installed.manifest.id, "session_1");
    expect(created.state.entry).toBe("design/session_1/entry.html");
    expect(await readFile(join(workspace.path, created.state.entry), "utf8")).toContain("Northstar Studio");
  });
});
