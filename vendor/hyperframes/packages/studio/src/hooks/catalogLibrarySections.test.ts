import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REGISTRY_ROOT = fileURLToPath(new URL("../../../../registry", import.meta.url));
const VALID_SECTIONS = new Set([
  "text-animation",
  "interface-animation",
  "transition-scene",
  "background-scene",
]);

function registryManifests(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return registryManifests(path);
    return entry.name === "registry-item.json" ? [path] : [];
  });
}

function sectionIn(manifestPath: string): string | null {
  const source = readFileSync(manifestPath, "utf8");
  return source.match(/"librarySection":\s*"([^"]+)"/)?.[1] ?? null;
}

describe("catalog library sections", () => {
  it("explicitly classifies every current GSAP preset exactly once", () => {
    const manifests = [
      ...registryManifests(join(REGISTRY_ROOT, "blocks")),
      ...registryManifests(join(REGISTRY_ROOT, "components")),
    ];
    const sections = manifests.map(sectionIn).filter((section) => section !== null);
    const counts = sections.reduce<Record<string, number>>((result, section) => {
      result[section] = (result[section] ?? 0) + 1;
      return result;
    }, {});

    expect(sections).toHaveLength(151);
    expect(sections.every((section) => VALID_SECTIONS.has(section))).toBe(true);
    expect(counts).toEqual({
      "text-animation": 20,
      "interface-animation": 80,
      "transition-scene": 27,
      "background-scene": 24,
    });
  });

  it("keeps the approved ambiguous presets in their closest sections", () => {
    const block = (name: string) =>
      sectionIn(join(REGISTRY_ROOT, "blocks", name, "registry-item.json"));

    expect(block("app-showcase")).toBe("interface-animation");
    expect(block("apple-money-count")).toBe("background-scene");
    expect(block("blue-sweater-intro-video")).toBe("background-scene");
    expect(block("logo-outro")).toBe("background-scene");
  });
});
