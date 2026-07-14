import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { templateManifestV1Schema } from "@ipollowork/types/templates";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "template-fixtures", "creative-studio");

async function text(path: string) {
  return readFile(join(root, path), "utf8");
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
});
