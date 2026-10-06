import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formatVisualComponentDataForAi,
  parseVisualComponentData,
  type RegistryVisualComponentDataContract,
} from "@hyperframes/core/registry";

const REGISTRY_ROOT = fileURLToPath(new URL("../../../../registry", import.meta.url));
const REMOVED_EFFECT_SECTIONS = ["opening-effect", "ending-effect", "transition-effect"];
const EXPECTED_VISUAL_COMPONENT_COUNTS = {
  maps: 12,
  media: 11,
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

const VISUAL_COMPONENTS = [
  ["route-map", "maps"],
  ["map-flow", "maps"],
  ["media-hero", "media"],
  ["split-screen", "media"],
  ["device-mockup", "media"],
  ["spatial-camera-suite", "media"],
  ["browser-walkthrough", "media"],
  ["mobile-walkthrough", "media"],
  ["location-pulse-map", "maps"],
  ["metro-network-map", "maps"],
  ["territory-heat-map", "maps"],
  ["china-map", "maps"],
] as const;

const OFFICIAL_MAP_COMPONENTS = [
  ["spain-map", "maps"],
  ["us-map", "maps"],
  ["us-map-bubble", "maps"],
  ["us-map-flow", "maps"],
  ["us-map-hex", "maps"],
  ["world-map", "maps"],
] as const;

const STRUCTURED_DATA_COMPONENTS = [
  "spain-map",
  "us-map",
  "us-map-bubble",
  "us-map-flow",
  "us-map-hex",
  "world-map",
  "china-map",
  "location-pulse-map",
  "metro-network-map",
  "territory-heat-map",
] as const;

interface MotionManifest {
  name: string;
  librarySection?: string;
  type: string;
  source?: { provider: string };
  kind?: string;
  motionPreset?: unknown;
  files?: Array<{ path: string }>;
  visualComponent?: {
    version: number;
    category: string;
    surfaces: string[];
    themeMode: string;
    data?: RegistryVisualComponentDataContract;
    ai?: { slots: string[] };
  };
  variables?: Array<{
    id: string;
    default: string | number | boolean;
    type?: string;
    options?: Array<{ value: string; label: string }>;
  }>;
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

function visualComponentManifests(): Array<{ manifestPath: string; manifest: MotionManifest }> {
  return registryManifests(join(REGISTRY_ROOT, "blocks"))
    .map((manifestPath) => ({ manifestPath, manifest: parseManifest(manifestPath) }))
    .filter(({ manifest }) => Boolean(manifest.visualComponent));
}

function isVariableEntry(value: unknown): value is { id: string } {
  return Boolean(
    value && typeof value === "object" && "id" in value && typeof value.id === "string",
  );
}

function contentVariableIds(manifest: MotionManifest): string[] {
  return (manifest.variables ?? [])
    .filter((variable) => variable.id !== "motionCueTimes")
    .map((variable) => variable.id);
}

describe("component catalog registry", () => {
  it("publishes only the retained visual component categories", () => {
    const components = visualComponentManifests();
    const imported = components.filter(({ manifest }) =>
      ["video-shotcraft", "hyperframes-video-shotcraft"].includes(manifest.source?.provider ?? ""),
    );
    const personal = components.filter(
      ({ manifest }) => manifest.source?.provider === "ipollowork-local-import",
    );
    const native = components.filter(
      (component) => !imported.includes(component) && !personal.includes(component),
    );
    const categoryCounts = Object.fromEntries(
      Object.keys(EXPECTED_VISUAL_COMPONENT_COUNTS).map((category) => [
        category,
        native.filter(({ manifest }) => manifest.visualComponent?.category === category).length,
      ]),
    );

    expect(native).toHaveLength(23);
    expect(categoryCounts).toEqual(EXPECTED_VISUAL_COMPONENT_COUNTS);
    expect(imported).toHaveLength(3);
    expect(
      imported.filter(({ manifest }) => manifest.visualComponent?.category === "media"),
    ).toHaveLength(3);
    expect(personal).toHaveLength(0);
    expect(components).toHaveLength(26);
    expect(new Set(components.map(({ manifest }) => manifest.name)).size).toBe(26);
    expect(components.map(({ manifest }) => manifest.visualComponent?.category)).not.toEqual(
      expect.arrayContaining(["scene", "product", "diagrams", "data", "typography", "proof", "knowledge", "people", "social", "developer", "brand"]),
    );
  });

  it("keeps visual components themeable, seekable, and within their authored property contracts", () => {
    for (const { manifestPath, manifest } of visualComponentManifests()) {
      const html = readFileSync(
        join(dirname(manifestPath), manifest.files?.[0]?.path ?? ""),
        "utf8",
      );

      expect(manifest.visualComponent).toMatchObject({
        version: 1,
        surfaces: ["video"],
        themeMode: "inherit",
      });
      const aiIds = contentVariableIds(manifest);
      const contentIds =
        manifest.name === "device-carousel" ? aiIds.filter((id) => id !== "carouselMode") : aiIds;
      expect(contentIds.length).toBeGreaterThan(0);
      expect(contentIds.length).toBeLessThanOrEqual(4);
      expect(new Set(manifest.variables?.map((variable) => variable.id)).size).toBe(
        manifest.variables?.length,
      );
      expect(manifest.visualComponent?.ai?.slots).toEqual(aiIds);
      if (manifest.name === "device-carousel") {
        expect(contentIds).toEqual(["title", "screenUrls", "labels", "note"]);
        const carouselMode = manifest.variables?.find((variable) => variable.id === "carouselMode");
        expect(carouselMode).toMatchObject({ type: "enum", default: "depth-tour" });
        expect(carouselMode?.options?.map((option) => option.value)).toEqual([
          "depth-tour",
          "flow-belt",
        ]);
        expect(html).toContain('values.carouselMode!=="flow-belt"');
      }
      const cueTimes = manifest.variables?.find((variable) => variable.id === "motionCueTimes");
      if (cueTimes) {
        expect(cueTimes).toMatchObject({ type: "string", default: "{}" });
        expect(manifest.visualComponent?.ai?.slots).not.toContain("motionCueTimes");
      }
      expect(html).toContain("var(--ipw-color-");
      if (manifest.source?.provider === "hyperframes-video-shotcraft") {
        expect(html).toContain("var(--ipw-color-bg,");
        expect(html).toContain("color:var(--ipw-color-text,");
      }
      expect(html).toMatch(/gsap\.timeline\(\{\s*paused:\s*true/);
      expect(html).not.toMatch(/Math\.random|Date\.now|repeat\s*:\s*-1/);
    }
  });

  it("exposes the eight spatial camera recipes through one editable registry stage", () => {
    const manifest = parseManifest(
      join(REGISTRY_ROOT, "blocks", "spatial-camera-suite", "registry-item.json"),
    );
    const html = readFileSync(
      join(REGISTRY_ROOT, "blocks", "spatial-camera-suite", "spatial-camera-suite.html"),
      "utf8",
    );
    const shotStyle = manifest.variables?.find((variable) => variable.id === "shotStyle");
    const recipeIds = [
      "graze-face-tour",
      "depth-layer-moves",
      "spotlight-hero-card",
      "runway-ground-skim",
      "steep-tilt-glide",
      "subject-follow-track",
      "container-morph",
      "gather-lockup",
    ];

    expect(shotStyle?.type).toBe("enum");
    expect(shotStyle?.options?.map((option) => option.value)).toEqual(recipeIds);
    expect(html.match(/gsap\.timeline\(\{paused:true\}\)/g)).toHaveLength(1);
    expect(html).toContain("window.__timelines[id]=tl;tl.seek(0)");
    for (const recipeId of recipeIds) expect(html).toContain(`shotStyle==="${recipeId}"`);
  });

  it("keeps the generated expansion property-safe and instance-aware", () => {
    const generated = visualComponentManifests().filter(({ manifestPath, manifest }) => {
      const html = readFileSync(
        join(dirname(manifestPath), manifest.files?.[0]?.path ?? ""),
        "utf8",
      );
      return html.includes("visual-component-catalog.ts");
    });

    expect(generated).toHaveLength(3);
    for (const { manifestPath, manifest } of generated) {
      const html = readFileSync(
        join(dirname(manifestPath), manifest.files?.[0]?.path ?? ""),
        "utf8",
      );
      const declaredMatch = html.match(/data-composition-variables='([^']+)'/);
      const serialized = (declaredMatch?.[1] ?? "")
        .replaceAll("&#39;", "'")
        .replaceAll("&amp;", "&");
      const declarations: unknown = JSON.parse(serialized);

      expect(contentVariableIds(manifest)).toEqual(["title", "items", "highlight", "note"]);
      expect(
        Array.isArray(declarations)
          ? declarations.filter(isVariableEntry).map((variable) => variable.id)
          : [],
      ).toEqual(manifest.variables?.map((variable) => variable.id));
      expect(html).toContain("window.__hfVariablesByComp?.[id]");
      expect(html).toContain("element.textContent");
      expect(html).not.toMatch(/innerHTML\s*=/);
    }
  });

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
      expect(contentVariableIds(manifest).length).toBeLessThanOrEqual(4);
      expect(manifest.visualComponent?.ai?.slots).toEqual(contentVariableIds(manifest));
      expect(
        Array.isArray(declarations)
          ? declarations.filter(isVariableEntry).map((variable) => variable.id)
          : [],
      ).toEqual(manifest.variables?.map((variable) => variable.id));
      expect(html).toMatch(/gsap\.timeline\(\{\s*paused:\s*true/);
      expect(html).toContain("getVariables");
      expect(html).toContain("var(--ipw-color-");
      for (const variable of manifest.variables ?? []) {
        expect(html.match(new RegExp(`\\b${variable.id}\\b`, "g"))?.length ?? 0).toBeGreaterThan(1);
      }
    }
  });

  it("uses real administrative geometry for the China and world maps", () => {
    const chinaMap = readFileSync(
      join(REGISTRY_ROOT, "blocks", "china-map", "china-map.html"),
      "utf8",
    );
    const worldMap = readFileSync(
      join(REGISTRY_ROOT, "blocks", "world-map", "world-map.html"),
      "utf8",
    );

    expect(chinaMap.match(/class="cm-region"/g)).toHaveLength(34);
    expect(chinaMap).toContain('data-region="广东"');
    expect(chinaMap).toContain('class="cm-south-sea-inset"');
    expect(worldMap.match(/class="wm-country"/g)?.length).toBeGreaterThanOrEqual(170);
    expect(worldMap).toContain('data-country="United States"');
    expect(worldMap).toContain('data-country="China"');
    expect(chinaMap).toContain("radius = 5 + 8 * Math.max(0, row.value / max)");
    expect(chinaMap).toContain('r="${radius + 4}"');
    expect(worldMap).toContain("radius = 6 + 9 * Math.max(0, row.value / max)");
    expect(worldMap).toContain('r="${radius + 4}"');
    for (const mapSource of [chinaMap, worldMap]) {
      expect(mapSource).toContain("...(window.__hyperframes?.getVariables?.() ?? {})");
      expect(mapSource).toContain("...(window.__hfVariablesByComp?.[id] ?? {})");
    }
    expect(`${chinaMap}${worldMap}`).not.toMatch(/fetch\(|topojson|world-atlas/);
  });

  it("adapts the six retained official map entries to the shared component contract", () => {
    for (const [name, category] of OFFICIAL_MAP_COMPONENTS) {
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
      expect(contentVariableIds(manifest)).toHaveLength(4);
      expect(manifest.visualComponent?.ai?.slots).toEqual(contentVariableIds(manifest));
      for (const variable of manifest.variables ?? []) {
        expect(html).toContain(variable.id);
      }
      expect(html).toContain("window.__hyperframes");
      expect(html).toContain("var(--ipw-color-");
      expect(html).toMatch(/gsap\.timeline\(\{\s*paused:\s*true/);
    }
  });

  it("gives data-driven components a validated semantic contract for forms and AI", () => {
    for (const name of STRUCTURED_DATA_COMPONENTS) {
      const manifest = parseManifest(join(REGISTRY_ROOT, "blocks", name, "registry-item.json"));
      const contract = manifest.visualComponent?.data;
      expect(contract).toBeDefined();
      if (!contract) continue;

      const variable = manifest.variables?.find(
        (candidate) => candidate.id === contract.binding.variable,
      );
      const highlightVariable = manifest.variables?.find(
        (candidate) => candidate.id === contract.highlightVariable,
      );
      expect(typeof variable?.default).toBe("string");
      expect(highlightVariable).toBeDefined();
      const value = String(variable?.default ?? "");
      const parsed = parseVisualComponentData(contract, value);

      expect(parsed.issues).toEqual([]);
      expect(parsed.document.rows.length).toBeGreaterThan(0);
      expect(formatVisualComponentDataForAi(contract, value)).toContain(
        `"kind": "${contract.kind}"`,
      );
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
