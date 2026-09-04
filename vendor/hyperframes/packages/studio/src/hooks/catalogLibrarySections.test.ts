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
  ["brand-headline", "scene"],
  ["feature-grid", "product"],
  ["metric-signal", "data"],
  ["chart-story", "data"],
  ["architecture-hub", "diagrams"],
  ["decision-flow", "diagrams"],
  ["milestone-timeline", "diagrams"],
  ["route-map", "maps"],
  ["map-flow", "maps"],
  ["before-after-contrast", "proof"],
  ["learning-pyramid", "knowledge"],
  ["profile-quote", "people"],
  ["evidence-stack", "proof"],
  ["lt-clean-bar", "typography"],
  ["chapter-divider", "typography"],
  ["bullet-stack", "typography"],
  ["pull-quote", "typography"],
  ["media-hero", "media"],
  ["split-screen", "media"],
  ["device-mockup", "media"],
  ["browser-walkthrough", "media"],
  ["mobile-walkthrough", "media"],
  ["ranking-list", "data"],
  ["podium-ranking", "data"],
  ["live-leaderboard", "data"],
  ["medal-table", "data"],
  ["comparison-matrix", "data"],
  ["kpi-dashboard", "data"],
  ["social-post", "social"],
  ["comment-thread", "social"],
  ["follow-card", "social"],
  ["instagram-post", "social"],
  ["instagram-story", "social"],
  ["instagram-reel", "social"],
  ["instagram-carousel", "social"],
  ["x-status-post", "social"],
  ["x-thread", "social"],
  ["x-poll", "social"],
  ["x-space", "social"],
  ["douyin-video", "social"],
  ["douyin-product-card", "social"],
  ["douyin-live-room", "social"],
  ["douyin-comment-stack", "social"],
  ["xiaohongshu-note", "social"],
  ["xiaohongshu-cover", "social"],
  ["xiaohongshu-checklist", "social"],
  ["xiaohongshu-review", "social"],
  ["code-walkthrough", "developer"],
  ["code-diff-card", "developer"],
  ["terminal-run", "developer"],
  ["product-spotlight", "product"],
  ["pricing-plans", "brand"],
  ["offer-card", "brand"],
  ["logo-reveal", "brand"],
  ["brand-palette", "brand"],
  ["campaign-lockup", "brand"],
  ["question-opener", "scene"],
  ["product-steps", "product"],
  ["process-cycle", "diagrams"],
  ["project-roadmap", "diagrams"],
  ["definition-card", "knowledge"],
  ["team-grid", "people"],
  ["testimonial-card", "proof"],
  ["end-screen", "scene"],
  ["brand-cta", "scene"],
  ["location-pulse-map", "maps"],
  ["metro-network-map", "maps"],
  ["territory-heat-map", "maps"],
  ["china-map", "maps"],
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

const STRUCTURED_DATA_COMPONENTS = [
  "spain-map",
  "us-map",
  "us-map-bubble",
  "us-map-flow",
  "us-map-hex",
  "world-map",
  "china-map",
  "ranking-list",
  "podium-ranking",
  "live-leaderboard",
  "medal-table",
  "location-pulse-map",
  "metro-network-map",
  "territory-heat-map",
  "kpi-dashboard",
  "pricing-plans",
  "instagram-carousel",
  "x-poll",
  "xiaohongshu-checklist",
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
    data?: RegistryVisualComponentDataContract;
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
