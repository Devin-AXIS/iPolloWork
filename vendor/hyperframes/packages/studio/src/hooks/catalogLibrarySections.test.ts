import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REGISTRY_ROOT = fileURLToPath(new URL("../../../../registry", import.meta.url));
const REMOVED_EFFECT_SECTIONS = ["opening-effect", "ending-effect", "transition-effect"];

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

const VISUAL_COMPONENTS = [
  ["brand-headline", "intro"],
  ["feature-grid", "product"],
  ["metric-signal", "data"],
  ["chart-story", "data"],
  ["architecture-hub", "diagrams"],
  ["decision-flow", "diagrams"],
  ["milestone-timeline", "flow"],
  ["route-map", "maps"],
  ["map-flow", "maps"],
  ["before-after-contrast", "compare"],
  ["learning-pyramid", "knowledge"],
  ["profile-quote", "people"],
  ["evidence-stack", "proof"],
  ["brand-cta", "outro"],
] as const;

const OFFICIAL_DATA_COMPONENTS = [
  ["animated-bar-chart", "data"],
  ["bar-chart-race", "data"],
  ["conic-progress-ring", "data"],
  ["data-chart", "data"],
  ["decline-chart", "data"],
  ["logo-wall", "proof"],
  ["number-wheel", "data"],
  ["oscilloscope-trace", "data"],
  ["spain-map", "maps"],
  ["star-rating-fill", "proof"],
  ["us-map", "maps"],
  ["us-map-bubble", "maps"],
  ["us-map-flow", "maps"],
  ["us-map-hex", "maps"],
  ["world-map", "maps"],
] as const;

interface MotionManifest {
  name: string;
  librarySection?: string;
  type: string;
  kind?: string;
  motionPreset?: unknown;
  files?: Array<{ path: string }>;
  visualComponent?: {
    version: number;
    category: string;
    surfaces: string[];
    themeMode: string;
    ai?: { slots: string[] };
  };
  variables?: Array<{ id: string; default: string | number | boolean }>;
}

interface RegistryIndex {
  items: Array<{ name: string; type: string }>;
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

function isVariableEntry(value: unknown): value is { id: string } {
  return Boolean(
    value && typeof value === "object" && "id" in value && typeof value.id === "string",
  );
}

describe("component catalog registry", () => {
  it("does not publish the removed effect clip catalog", () => {
    const manifests = [
      ...registryManifests(join(REGISTRY_ROOT, "blocks")),
      ...registryManifests(join(REGISTRY_ROOT, "components")),
    ].map(parseManifest);
    expect(
      manifests.filter((manifest) =>
        REMOVED_EFFECT_SECTIONS.includes(manifest.librarySection ?? ""),
      ),
    ).toEqual([]);
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

  it("lists retained captions and excludes migrated captions in registry.json", () => {
    const registry = JSON.parse(
      readFileSync(join(REGISTRY_ROOT, "registry.json"), "utf8"),
    ) as RegistryIndex;
    const names = registry.items.map((item) => item.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "route-map",
        ...VISUAL_COMPONENTS.map(([name]) => name),
        "caption-pill-karaoke",
        "caption-word-pulse",
        "caption-phrase-lift",
        "caption-mask-reveal",
        "caption-editorial-snap",
        "caption-editorial-emphasis",
      ]),
    );
    expect(names).not.toEqual(expect.arrayContaining(MIGRATED_CAPTION_COMPONENTS));
  });

  it("keeps the reusable component set focused, themed, and simple to configure", () => {
    for (const [name, category] of VISUAL_COMPONENTS) {
      const manifestPath = join(REGISTRY_ROOT, "blocks", name, "registry-item.json");
      const manifest = parseManifest(manifestPath);
      const html = readFileSync(
        join(dirname(manifestPath), manifest.files?.[0]?.path ?? ""),
        "utf8",
      );
      const declaredMatch = html.match(/data-composition-variables='([^']+)'/);
      const declarations: unknown = declaredMatch ? JSON.parse(declaredMatch[1]) : [];

      expect(manifest.visualComponent).toMatchObject({
        version: 1,
        category,
        surfaces: ["video"],
        themeMode: "inherit",
      });
      expect(manifest.variables?.length).toBeLessThanOrEqual(4);
      expect(manifest.visualComponent?.ai?.slots).toEqual(
        manifest.variables?.map((variable) => variable.id),
      );
      expect(Array.isArray(declarations) ? declarations.filter(isVariableEntry).map((variable) => variable.id) : []).toEqual(
        manifest.variables?.map((variable) => variable.id),
      );
      expect(html).toMatch(/gsap\.timeline\(\{\s*paused:\s*true/);
    }
  });

  it("adapts all fifteen official Data catalog entries to the shared component contract", () => {
    for (const [name, category] of OFFICIAL_DATA_COMPONENTS) {
      const manifestPath = join(REGISTRY_ROOT, "blocks", name, "registry-item.json");
      const manifest = parseManifest(manifestPath);
      const html = readFileSync(
        join(dirname(manifestPath), manifest.files?.[0]?.path ?? ""),
        "utf8",
      );

      expect(manifest.visualComponent).toMatchObject({
        version: 1,
        category,
        surfaces: ["video"],
        themeMode: "inherit",
      });
      expect(manifest.variables).toHaveLength(4);
      expect(manifest.visualComponent?.ai?.slots).toEqual(
        manifest.variables?.map((variable) => variable.id),
      );
      for (const variable of manifest.variables ?? []) {
        expect(html).toContain(variable.id);
      }
      expect(html).toContain("window.__hyperframes");
      expect(html).toContain("var(--ipw-color-");
      expect(html).toMatch(/gsap\.timeline\(\{\s*paused:\s*true/);
    }
  });

  it("publishes the route map as a theme-aware, seekable component demo", () => {
    const manifestPath = join(REGISTRY_ROOT, "blocks", "route-map", "registry-item.json");
    const manifest = parseManifest(manifestPath);
    const html = readFileSync(join(dirname(manifestPath), manifest.files?.[0]?.path ?? ""), "utf8");
    const declaredMatch = html.match(/data-composition-variables='([^']+)'/);
    const parsedDeclarations: unknown = declaredMatch ? JSON.parse(declaredMatch[1]) : [];
    const declarations = Array.isArray(parsedDeclarations)
      ? parsedDeclarations.filter(isVariableEntry)
      : [];

    expect(manifest.visualComponent).toMatchObject({
      version: 1,
      category: "maps",
      surfaces: ["video"],
      themeMode: "inherit",
      ai: { slots: ["title", "origin", "destination", "annotation"] },
    });
    expect(declarations.map((variable) => variable.id)).toEqual(
      manifest.variables?.map((variable) => variable.id),
    );
    expect(html).toContain("var(--ipw-color-primary");
    expect(html).toContain('id="root"');
    expect(html).not.toContain('class="route-map"');
    expect(html).toContain('data-ipw-ai-slot="annotation"');
    expect(html).toContain("window.__hfVariablesByComp[runtimeCompositionId]");
    expect(html).toContain("gsap.timeline({ paused: true })");
    expect(html).toContain('window.__timelines["route-map"] = tl');
    expect(html).not.toContain("three.min.js");
  });
});
