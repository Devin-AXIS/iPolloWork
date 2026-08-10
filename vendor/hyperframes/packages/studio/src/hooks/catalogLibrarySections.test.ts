import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REGISTRY_ROOT = fileURLToPath(new URL("../../../../registry", import.meta.url));
const ACTIVE_SECTIONS = {
  "opening-animation": "opening",
  "ending-animation": "ending",
  "transition-animation": "transition",
  "caption-animation": "caption",
} as const;

interface MotionManifest {
  name: string;
  librarySection?: string;
  motionPreset?: {
    version: number;
    category: string;
    targets: string[];
    keyframes: Array<{ percentage: number }>;
  };
}

function registryManifests(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return registryManifests(path);
    return entry.name === "registry-item.json" ? [path] : [];
  });
}

function parseManifest(manifestPath: string): MotionManifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as MotionManifest;
}

describe("animation catalog library sections", () => {
  it("publishes exactly four editable presets in each approved category", () => {
    const manifests = [
      ...registryManifests(join(REGISTRY_ROOT, "blocks")),
      ...registryManifests(join(REGISTRY_ROOT, "components")),
    ].map(parseManifest);
    const active = manifests.filter(
      (manifest) => manifest.librarySection && manifest.librarySection in ACTIVE_SECTIONS,
    );
    const counts = active.reduce<Record<string, number>>((result, manifest) => {
      const section = manifest.librarySection as keyof typeof ACTIVE_SECTIONS;
      result[section] = (result[section] ?? 0) + 1;
      return result;
    }, {});

    expect(active).toHaveLength(16);
    expect(counts).toEqual({
      "opening-animation": 4,
      "ending-animation": 4,
      "transition-animation": 4,
      "caption-animation": 4,
    });
  });

  it("keeps every visible animation source-editable and category-aligned", () => {
    const manifests = registryManifests(join(REGISTRY_ROOT, "blocks"))
      .map(parseManifest)
      .filter((manifest) => manifest.librarySection && manifest.librarySection in ACTIVE_SECTIONS);

    for (const manifest of manifests) {
      const section = manifest.librarySection as keyof typeof ACTIVE_SECTIONS;
      const preset = manifest.motionPreset;
      expect(preset, manifest.name).toBeDefined();
      expect(preset?.version, manifest.name).toBe(1);
      expect(preset?.category, manifest.name).toBe(ACTIVE_SECTIONS[section]);
      expect(preset?.targets.length, manifest.name).toBeGreaterThan(0);
      expect(preset?.keyframes[0]?.percentage, manifest.name).toBe(0);
      expect(preset?.keyframes.at(-1)?.percentage, manifest.name).toBe(100);
    }
  });
});
