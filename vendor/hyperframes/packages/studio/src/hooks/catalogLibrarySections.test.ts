import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REGISTRY_ROOT = fileURLToPath(new URL("../../../../registry", import.meta.url));
const ACTIVE_SECTIONS = {
  "opening-effect": 2,
  "ending-effect": 4,
  "transition-effect": 3,
} as const;

const MIGRATED_CAPTION_COMPONENTS = [
  "caption-highlight",
  "caption-matrix-decode",
  "caption-gradient-fill",
  "caption-neon-glow",
  "caption-neon-accent",
  "caption-glitch-rgb",
  "caption-clip-wipe",
  "caption-blend-difference",
  "caption-weight-shift",
  "caption-texture",
  "caption-kinetic-slam",
  "caption-emoji-pop",
  "caption-particle-burst",
] as const;

interface MotionManifest {
  name: string;
  librarySection?: string;
  type: string;
  kind?: string;
  motionPreset?: unknown;
  files?: Array<{ path: string }>;
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

describe("effect clip catalog library sections", () => {
  it("publishes only opening, social ending, and transition clips", () => {
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

    expect(active).toHaveLength(9);
    expect(counts).toEqual({
      "opening-effect": 2,
      "ending-effect": 4,
      "transition-effect": 3,
    });
  });

  it("does not publish migrated caption components in the catalog", () => {
    const captionComponents = registryManifests(join(REGISTRY_ROOT, "components"))
      .map(parseManifest)
      .filter(
        (manifest) =>
          manifest.type === "hyperframes:component" &&
          manifest.librarySection &&
          manifest.name.startsWith("caption-"),
      )
      .map((manifest) => manifest.name)
      .sort();

    expect(captionComponents).not.toEqual(expect.arrayContaining(MIGRATED_CAPTION_COMPONENTS));
  });

  it("keeps every visible effect as a standalone, themeable scene clip", () => {
    const manifests = registryManifests(join(REGISTRY_ROOT, "blocks"))
      .map(parseManifest)
      .filter((manifest) => manifest.librarySection && manifest.librarySection in ACTIVE_SECTIONS);

    for (const manifest of manifests) {
      expect(manifest.type, manifest.name).toBe("hyperframes:block");
      expect(manifest.kind, manifest.name).toBe("effect");
      expect(manifest.motionPreset, manifest.name).toBeUndefined();
      const manifestPath = registryManifests(join(REGISTRY_ROOT, "blocks")).find(
        (path) => parseManifest(path).name === manifest.name,
      );
      expect(manifestPath, manifest.name).toBeDefined();
      const html = readFileSync(
        join(dirname(manifestPath!), manifest.files?.[0]?.path ?? ""),
        "utf8",
      );
      expect(html, manifest.name).toContain("--ipw-color-");
      expect(html, manifest.name).toContain("gsap.timeline({paused:true})");
    }
  });
});
