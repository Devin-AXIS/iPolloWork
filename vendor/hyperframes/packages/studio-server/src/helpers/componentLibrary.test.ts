import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importComponentPack, installLibraryComponent, listLibraryComponents, parseComponentPack, safeComponentPath } from "./componentLibrary.js";

const dirs: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "hf-component-test-")); dirs.push(dir); return dir; };
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture(name = "sample") {
  return { format: "hyperframes:components", version: 1, items: [{
    manifest: { name, type: "hyperframes:block", title: "Sample", description: "Sample component", duration: 10, dimensions: { width: 1920, height: 1080 },
      visualComponent: { version: 1, category: "business", surfaces: ["video"], themeMode: "inherit" },
      variables: [{ id: "speed", label: "Speed", type: "number", default: 1, min: .3, max: 2 }],
      files: [{ path: "sample.html", target: `compositions/${name}/sample.html`, type: "hyperframes:composition" }] },
    files: { "sample.html": `<html><div data-composition-id="${name}">Sample</div></html>` },
  }] };
}
describe("component library import", () => {
  it("preserves inclusive numeric column bounds and rejects invalid bounds without coercion", () => {
    const raw = fixture();
    const pack = (min: unknown, max: unknown, type = "number") => ({ ...raw, items: raw.items.map(item => ({ ...item, manifest: { ...item.manifest, visualComponent: { ...item.manifest.visualComponent, data: {
      version: 1, kind: "category-value", mode: "replace", rowId: "id", binding: { variable: "rows", encoding: "json" },
      columns: [{ id: "level", label: "Level", type, role: "value", required: true, min, max }],
    } } } })) });
    const column = parseComponentPack(pack(0, 1)).items[0]?.manifest.visualComponent?.data?.columns[0];
    expect([column?.min, column?.max]).toEqual([0, 1]);
    expect(parseComponentPack(pack(undefined, 1)).items).toHaveLength(1);
    expect(parseComponentPack(pack(0, undefined)).items).toHaveLength(1);
    for (const [min, max] of [[2, 1], [null, 1], ["0", 1], [Number.NaN, 1], [0, Infinity], [0, "1"]]) {
      expect(() => parseComponentPack(pack(min, max))).toThrow("theme contract");
    }
    expect(() => parseComponentPack(pack(0, 1, "string"))).toThrow("theme contract");
  });
  it("preserves layout limits and rejects malformed capacity declarations", () => {
    const raw = fixture();
    const pack = { ...raw, items: raw.items.map(item => ({ ...item, manifest: { ...item.manifest, visualComponent: { ...item.manifest.visualComponent, data: {
      version: 1, kind: "category-value", mode: "replace", rowId: "id", binding: { variable: "items", encoding: "json" }, minRows: 2, maxRows: 6,
      columns: [{ id: "id", label: "ID", type: "string", role: "id", maxLength: 20, list: { maxItems: 4, itemMaxLength: 12, separators: "、,，\n" } }],
    } } } })) };
    expect(parseComponentPack(pack).items[0]?.manifest.visualComponent?.data?.columns[0]?.list?.maxItems).toBe(4);
    pack.items[0]!.manifest.visualComponent.data.columns[0]!.list.maxItems = -1;
    expect(() => parseComponentPack(pack)).toThrow("theme contract");
    pack.items[0]!.manifest.visualComponent.data.columns[0]!.list.maxItems = 4;
    pack.items[0]!.manifest.visualComponent.data.columns[0]!.maxLength = 0;
    expect(() => parseComponentPack(pack)).toThrow("theme contract");
  });
  it("publishes a complete pack atomically and imports identical packs idempotently", () => {
    const root = temp(), pack = parseComponentPack(fixture());
    expect(importComponentPack(pack, [], root)).toHaveLength(1);
    expect(importComponentPack(pack, [], root)).toHaveLength(1);
    const library = listLibraryComponents(root);
    expect(library).toHaveLength(1);
    const project = temp();
    expect(installLibraryComponent(library[0]!, project)).toEqual(["compositions/sample/sample.html"]);
    const source = join(project, "compositions/sample/sample.html");
    writeFileSync(source, readFileSync(source, "utf8").replace("Sample</div>", "Edited</div>"));
    installLibraryComponent(library[0]!, project);
    expect(readFileSync(source, "utf8")).toContain("Edited</div>");
  });
  it("rejects builtin and changed-package collisions without overwriting", () => {
    const root = temp(), pack = parseComponentPack(fixture());
    expect(() => importComponentPack(pack, ["sample"], root)).toThrow("already exists");
    expect(listLibraryComponents(root)).toHaveLength(0);
    importComponentPack(pack, [], root);
    const changed = fixture(); changed.items[0]!.manifest.title = "Different";
    expect(() => importComponentPack(parseComponentPack(changed), [], root)).toThrow("already exists");
    expect(listLibraryComponents(root)[0]?.manifest.title).toBe("Sample");
  });
  it.each(["../escape.html", "/tmp/escape.html", "a/../../escape.html", "a\\escape.html", "a//escape.html"])("rejects unsafe file paths %s", path => {
    const raw = fixture(); raw.items[0]!.manifest.files[0]!.path = path;
    expect(() => parseComponentPack(raw)).toThrow();
  });
  it("rejects targets outside the component namespace and undeclared files", () => {
    const raw = fixture(); raw.items[0]!.manifest.files[0]!.target = "index.html";
    expect(() => parseComponentPack(raw)).toThrow("compositions/sample/");
    const extra = fixture(); Object.assign(extra.items[0]!.files, { "hidden.js": "bad" });
    expect(() => parseComponentPack(extra)).toThrow("Unlisted");
  });
  it("requires the existing native theme contract and valid variables", () => {
    const raw = fixture(); raw.items[0]!.manifest.visualComponent.themeMode = "dark-only";
    expect(() => parseComponentPack(raw)).toThrow("theme contract");
    const variables = fixture(); variables.items[0]!.manifest.variables[0]!.default = Number.NaN;
    expect(() => parseComponentPack(variables)).toThrow();
    expect(() => parseComponentPack({ items: [] })).toThrow("component pack");
  });
  it("rejects writes through a project symlink", () => {
    const root = temp(), outside = temp(); symlinkSync(outside, join(root, "compositions"), process.platform === "win32" ? "junction" : "dir");
    expect(() => safeComponentPath(root, "compositions/sample/a.html")).toThrow("Symbolic");
  });
});
