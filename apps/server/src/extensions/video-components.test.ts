import { createHash } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { attribute, checkVideoComponents, installVideoComponents } from "./video-components.js";
import { listHyperframesCatalog } from "../hyperframes-catalog.js";
import { z } from "zod";
import { hyperframesEffectVariableSchema, hyperframesMotionRecipeSchema, hyperframesPageCaptureSchema, hyperframesVisualComponentDataSchema } from "@ipollowork/types/hyperframes";

const recipeManifestSchema = z.object({
  name: z.string(), duration: z.number(),
  variables: z.array(hyperframesEffectVariableSchema),
  motionRecipe: hyperframesMotionRecipeSchema,
});

async function recipeFixture(componentId = "comparison-matrix") {
  const { root, project } = await fixture();
  const registry = join(import.meta.dir, "../../../../vendor/hyperframes/registry/blocks");
  process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT = registry;
  const manifest = recipeManifestSchema.parse(JSON.parse(await readFile(join(registry, componentId, "registry-item.json"), "utf8")));
  const values = Object.fromEntries(manifest.variables.filter(variable => variable.id !== "motionCueTimes").map(variable => [variable.id, variable.default]));
  return { root, project, registry, manifest, instance: {
    sceneId: "evidence", componentId, start: 0, duration: manifest.duration, values, timingSource: "visual-cue",
  } };
}

const roots: string[] = [];
const originalRegistryRoot = process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT;
const originalCatalogRoot = process.env.IPOLLOWORK_HYPERFRAMES_CATALOG_ROOT;
const originalComponentLibrary = process.env.HYPERFRAMES_COMPONENT_LIBRARY;

afterEach(async () => {
  if (originalRegistryRoot === undefined) delete process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT;
  else process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT = originalRegistryRoot;
  if (originalCatalogRoot === undefined) delete process.env.IPOLLOWORK_HYPERFRAMES_CATALOG_ROOT;
  else process.env.IPOLLOWORK_HYPERFRAMES_CATALOG_ROOT = originalCatalogRoot;
  if (originalComponentLibrary === undefined) delete process.env.HYPERFRAMES_COMPONENT_LIBRARY;
  else process.env.HYPERFRAMES_COMPONENT_LIBRARY = originalComponentLibrary;
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-video-components-"));
  roots.push(root);
  process.env.HYPERFRAMES_COMPONENT_LIBRARY = join(root, "component-library");
  const registry = join(root, "registry");
  const project = join(root, "video", "session-one");
  const component = join(registry, "milestone-timeline");
  await mkdir(component, { recursive: true });
  await mkdir(project, { recursive: true });
  await writeFile(join(project, "index.html"), "<!doctype html><main data-composition-id=\"main\"></main>");
  await writeFile(join(component, "milestone-timeline.html"), "<!doctype html><main data-composition-id=\"milestone-timeline\" data-start=\"0\" data-duration=\"9\" data-track-index=\"0\"><h1>Timeline</h1></main>");
  await writeFile(join(component, "registry-item.json"), JSON.stringify({
    name: "milestone-timeline",
    type: "hyperframes:block",
    duration: 9,
    visualComponent: { surfaces: ["video"] },
    variables: [{ id: "title" }, { id: "stepOne" }, { id: "stepTwo" }],
    files: [{ path: "milestone-timeline.html", target: "compositions/milestone-timeline.html", type: "hyperframes:composition" }],
  }));
  process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT = registry;
  return { root, project };
}

async function jsonRecipeFixture(count = 2) {
  const base = await fixture();
  const componentId = "milestone-timeline";
  const document = { version: 1, kind: "category-value", rows: Array.from({ length: count }, (_, index) => ({
    id: `branch-${index + 1}`, label: `分支${index + 1}`, sub: "业务说明", icon: "circle", highlighted: "no", leaves: "输入、处理,结果，证据", value: index + 1,
  })) };
  const { manifest: existing } = await recipeFixture();
  process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT = join(base.root, "registry");
  const events = [...Array.from({ length: 6 }, (_, index) => ({
    id: `step-${index + 1}`, target: `.branch-${index + 1}`, time: index + 1, duration: .2, action: "Reveal branch evidence",
  })), { id: "resolve", target: ".result", time: 7, duration: .2, action: "Resolve the diagram" }];
  const manifest = {
    name: componentId, type: "hyperframes:block", duration: 8,
    files: [{ path: "milestone-timeline.html", target: "compositions/milestone-timeline.html", type: "hyperframes:composition" }],
    visualComponent: { surfaces: ["video"], data: {
      version: 1, kind: "category-value", mode: "replace", rowId: "id", binding: { variable: "branches", encoding: "json" }, minRows: 2, maxRows: 6,
      columns: [
        { id: "label", label: "Branch", type: "string", role: "label", required: true, maxLength: 10 },
        { id: "sub", label: "Detail", type: "string", role: "value", maxLength: 18 },
        { id: "icon", label: "Icon", type: "string", role: "value", options: [{ value: "circle", label: "Circle" }] },
        { id: "highlighted", label: "Highlight", type: "string", role: "value", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
        { id: "leaves", label: "Leaves", type: "string", role: "value", list: { maxItems: 4, itemMaxLength: 12, separators: "、,，\n" } },
        { id: "value", label: "Value", type: "number", role: "value" },
      ],
    } },
    variables: [
      { id: "title", label: "Title", type: "string", default: "关系图", maxLength: 14 },
      { id: "sub", label: "Subtitle", type: "string", default: "", maxLength: 18 },
      { id: "branches", label: "Branches", type: "string", default: JSON.stringify(document), maxLength: 10000 },
      { id: "motionCueTimes", label: "Cues", type: "string", default: "{}" },
    ],
    motionRecipe: { ...existing.motionRecipe, minHoldSeconds: .5, capacity: { variable: "branches", encoding: "json", minItems: 2, maxItems: 6 }, events,
      usage: { ...existing.motionRecipe.usage, cueBindings: Object.fromEntries(events.map(event => [event.id, event.action])) },
    },
  };
  const manifestPath = join(base.root, "registry", componentId, "registry-item.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(join(base.root, "registry", componentId, "milestone-timeline.html"), '<main data-composition-id="milestone-timeline" data-ipw-motion-recipe="1"><script>const motionStyle={};</script></main>');
  const instance = { sceneId: "diagram", componentId, start: 0, duration: 8, values: { title: "关系图", sub: "", branches: JSON.stringify(document) }, timingSource: "visual-cue" };
  return { ...base, manifest, manifestPath, document, instance };
}

describe("Video Studio registry component integration", () => {
  test("lists and installs imported components from the same library without replacing bundled resources", async () => {
    const { root, project } = await fixture();
    const componentId = "imported-timeline";
    const packId = createHash("sha256").update("imported timeline fixture").digest("hex");
    const component = join(root, "component-library", packId, "blocks", componentId);
    await mkdir(component, { recursive: true });
    const html = '<main data-composition-id="imported-timeline"><h1>Imported timeline</h1></main>';
    await writeFile(join(component, "timeline.html"), html);
    await writeFile(join(component, "registry-item.json"), JSON.stringify({
      name: componentId, type: "hyperframes:block", title: "Imported timeline", description: "Imported component",
      duration: 9, visualComponent: { surfaces: ["video"] }, variables: [],
      files: [{ path: "timeline.html", target: "compositions/imported-timeline/timeline.html", type: "hyperframes:composition" }],
    }));
    expect((await listHyperframesCatalog()).some(item => item.name === componentId)).toBe(true);
    const result = await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: [componentId, "milestone-timeline"],
    });
    expect(result.components.map(item => item.componentId)).toEqual([componentId, "milestone-timeline"]);
    const installedHtml = await readFile(join(project, "compositions/imported-timeline/timeline.html"), "utf8");
    expect(installedHtml).toContain('<h1>Imported timeline</h1>');
    expect(installedHtml).toContain('data-composition-id="imported-timeline" data-ipw-timing-owner="host"');
    expect(await readFile(join(project, "compositions/milestone-timeline.html"), "utf8")).toContain("Timeline");
  });
  test("installs the same resources exposed by a configured catalog", async () => {
    const { root, project } = await fixture();
    const catalog = join(root, "registry");
    const componentId = "catalog-only-timeline";
    await mkdir(join(catalog, "blocks"));
    await rename(join(catalog, "milestone-timeline"), join(catalog, "blocks", componentId));
    const directory = join(catalog, "blocks", componentId);
    const manifestPath = join(directory, "registry-item.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, name: componentId, title: "Custom timeline", description: "Configured catalog resource" }));
    await writeFile(join(catalog, "registry.json"), "{}");
    delete process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT;
    process.env.IPOLLOWORK_HYPERFRAMES_CATALOG_ROOT = catalog;
    const authoredScene = '<section id="authored">Keep authored scene</section>';
    await writeFile(join(project, "index.html"), `<!doctype html><main data-composition-id="main">${authoredScene}</main>`);

    expect((await listHyperframesCatalog()).map(item => item.name)).toEqual([componentId]);
    const result = await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: [componentId],
    });
    expect(result.components.map(component => component.componentId)).toEqual([componentId]);
    expect(await readFile(join(project, "compositions", "milestone-timeline.html"), "utf8"))
      .toContain("Timeline");
    expect(await readFile(join(project, "index.html"), "utf8"))
      .toContain(authoredScene);
  });
  test("ignores incomplete catalog overrides for both listing and installation", async () => {
    const { root, project } = await fixture();
    const catalog = join(root, "registry");
    await mkdir(join(catalog, "blocks"));
    delete process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT;
    process.env.IPOLLOWORK_HYPERFRAMES_CATALOG_ROOT = catalog;

    const componentId = "spatial-camera-suite";
    expect((await listHyperframesCatalog()).some(item => item.name === componentId)).toBe(true);
    const result = await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: [componentId],
    });
    expect(result.components.some(component => component.componentId === componentId)).toBe(true);
    expect((await readFile(join(project, "compositions", `${componentId}.html`), "utf8")).length)
      .toBeGreaterThan(0);
  });
  test("rejects unavailable recipe IDs before writing even the valid selections", async () => {
    const { root, project } = await recipeFixture("question-opener");
    const original = await readFile(join(project, "index.html"), "utf8");
    const error = await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: ["question-opener", "depth-layer-moves"],
    }).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "video_component_not_found" });
    expect(await readFile(join(project, "index.html"), "utf8")).toBe(original);
    expect(await readdir(project)).toEqual(["index.html"]);
  });
  test("imported Shotcraft recipes retain pinned source, rules and installed license", async () => {
    for (const name of ["shotcraft-card-stack", "shotcraft-tracking-expand", "shotcraft-marker-title", "shotcraft-multiplane", "shotcraft-dolly-zoom"]) {
      const { root, project, registry, manifest, instance } = await recipeFixture(name);
      const source = z.object({ upstream: z.object({ revision: z.string(), upstreamSha256: z.string() }), license: z.literal("Apache-2.0") }).parse(JSON.parse(await readFile(join(registry, name, "registry-item.json"), "utf8")));
      expect(source.upstream.revision).toBe("5ddbf521038b0a7accfb6dc1e0a9eb29c67277ab");
      expect(createHash("sha256").update(await readFile(join(registry, name, "upstream.tsx"))).digest("hex")).toBe(source.upstream.upstreamSha256);
      expect((await readFile(join(registry, name, "upstream-card.md"), "utf8")).length).toBeGreaterThan(400);
      await mkdir(join(project, "assets"), { recursive: true });
      await writeFile(join(project, "assets", "evidence.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"/>');
      await installVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", componentIds: [name], instances: [instance] });
      expect(await readFile(join(project, "compositions/licenses/video-shotcraft-LICENSE.txt"), "utf8")).toContain("Apache License");
      const variable = manifest.variables.find(value => value.id === "title" || value.id === "keyword");
      expect(variable?.type).toBe("string");
      if (!variable || variable.type !== "string" || !variable.maxLength) throw Error("Missing bounded text input");
      await expect(installVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", componentIds: [name], instances: [{ ...instance, values: { ...instance.values, [variable.id]: "字".repeat(variable.maxLength + 1) } }] })).rejects.toMatchObject({ code: "invalid_video_recipe_values" });
    }
  });
  test("converted HyperFrames recipes retain original source and enforce bounded real content", async () => {
    for (const slug of ["blur-slide", "brace-expand", "outline-word-fill", "letter-drop", "scramble-decode", "karaoke-fill", "glitch-cycle", "gradient-word-sweep", "lead-word-zoom-assemble", "pill-chip-slot-cycle-handled", "pill-slot-cycle", "scramble", "split-flap-title", "text-column-converge", "title-demote-to-label", "split-text-stagger", "drift-assembly", "text-on-path", "font-weight-pump", "terminal-typewriter", "error-retype", "typing-code-block", "vertical-word-roll-blur-cycle", "word-relay-filmstrip", "word-relay-geometry"]) {
      const name = `shotcraft-${slug}`;
      const { root, project, registry, manifest, instance } = await recipeFixture(name);
      const source = z.object({ upstream: z.object({ revision: z.string(), upstreamSha256: z.string() }) }).parse(JSON.parse(await readFile(join(registry, name, "registry-item.json"), "utf8")));
      expect(source.upstream.revision).toBe("1df77f1ab080323558f70a5fb880fad0f88f87fc");
      const original = await readFile(join(registry, name, "upstream.html"), "utf8");
      expect(createHash("sha256").update(original).digest("hex")).toBe(source.upstream.upstreamSha256);
      expect(original).not.toContain("TODO: Port animation logic");
      await mkdir(join(project, "assets"), { recursive: true });
      await writeFile(join(project, "assets/evidence.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"/>');
      const installed = await installVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", componentIds: [name], instances: [instance] });
      expect(installed.instances).toHaveLength(1);
      expect(await readFile(join(project, "compositions/licenses/hyperframes-video-shotcraft-LICENSE.txt"), "utf8")).toContain("Apache License");
      if (slug === "text-on-path") {
        const mounted = await readFile(join(project, "compositions", name + ".html"), "utf8");
        expect(mounted).toContain("P2={x:1240,y:660}");
        expect(mounted).not.toContain("motionStyle.distance*.7540");
      }
      if (manifest.motionRecipe.events[0]?.id === "phase-1") {
        let start = .8, offset = 0;
        const words = manifest.motionRecipe.events.map((event, index) => {
          const text = `阶段${index + 1}`;
          const word = { text, beginIndex: offset, endIndex: offset + text.length, startSeconds: start, endSeconds: start + .1 };
          offset += text.length;
          start = Math.ceil((start + event.duration + .1) * 30) / 30;
          return word;
        });
        await writeFile(join(project, "assets/voice.timings.json"), JSON.stringify({ alignment: "provider", words }));
        const narration = { timingSourcePath: "video/session-one/assets/voice.timings.json", text: words.map(word => word.text).join(""), bindings: Object.fromEntries(manifest.motionRecipe.events.map((event, index) => [event.id, { phrase: words[index]!.text }])) };
        const aligned = await installVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", componentIds: [name], instances: [{ ...instance, duration: Math.max(manifest.duration, start + 1), timingSource: "voiceover", narration }] });
        expect(aligned.instances[0]!.cueTimes).toEqual(Object.fromEntries(manifest.motionRecipe.events.map((event, index) => [event.id, Math.round(words[index]!.startSeconds * 30) / 30])));
        await writeFile(join(project, "index.html"), `<main data-composition-id="main">${aligned.instances[0]!.snippet}</main>`);
        expect((await checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", recipesOnly: true })).valid).toBe(true);
      }
      const variable = manifest.variables.find(value => value.id !== "motionCueTimes");
      if (!variable || variable.type !== "string" || !variable.maxLength) throw Error("Missing bounded content variable");
      await expect(installVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", componentIds: [name], instances: [{ ...instance, values: { ...instance.values, [variable.id]: "字".repeat(variable.maxLength + 1) } }] })).rejects.toMatchObject({ code: "invalid_video_recipe_values" });
    }
  });
  test("camera recipes reject mismatched screenshot dimensions before writing", async () => {
    for (const componentId of ["shotcraft-multiplane", "shotcraft-dolly-zoom"]) {
      const { root, project, instance } = await recipeFixture(componentId);
      await mkdir(join(project, "assets"), { recursive: true });
      await writeFile(join(project, "assets/evidence.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"/>');
      const original = await readFile(join(project, "index.html"), "utf8");
      const capture = hyperframesPageCaptureSchema.parse(JSON.parse(String(instance.values.captureLayout)));
      for (const [layout, code] of [
        [{ ...capture, width: 1921 }, "video_capture_dimensions_mismatch"],
        [{ ...capture, heroId: "absent" }, "invalid_video_capture_layout"],
        [{ ...capture, foregroundIds: ["region-0", "region-0"] }, "invalid_video_capture_layout"],
        [{ ...capture, regions: capture.regions.map(region => ({ ...region, x: 1920 })) }, "invalid_video_capture_layout"],
      ]) {
        await expect(installVideoComponents({ id: "test", path: root }, {
          sourcePath: "video/session-one/index.html", componentIds: [componentId],
          instances: [{ ...instance, values: { ...instance.values, captureLayout: JSON.stringify(layout) } }],
        })).rejects.toMatchObject({ code });
        expect(await readFile(join(project, "index.html"), "utf8")).toBe(original);
        expect((await readdir(project)).sort()).toEqual(["assets", "index.html"]);
      }
    }
  });
  test("custom narrated scenes reject missing or shifted phrase bindings", async () => {
    const { root, project } = await fixture();
    await mkdir(join(project, "assets"), { recursive: true });
    await writeFile(join(project, "assets/voice.timings.json"), JSON.stringify({ alignment: "provider", words: [{ text: "加热", beginIndex: 0, endIndex: 2, startSeconds: 1, endSeconds: 1.5 }] }));
    const narration = { timingSourcePath: "video/session-one/assets/voice.timings.json", text: "加热", bindings: { "custom:heat": { phrase: "加热" } } };
    const save = async (motionStart: number, binding: unknown) => {
      const beats = [{ start: 0, end: 3, intent: "加热", focus: "暖气", action: "启动", result: "升温", targets: ["#heat"], animation: "custom:heat", motion: { start: motionStart, end: 2 } }];
      await writeFile(join(project, "index.html"), `<main data-composition-id="main"><section data-hf-id="editor-id" id="heat" class="scene clip" data-ipw-scene data-ipw-component-decision="custom:continuous physical simulation" data-motion-pattern="progressive-build" data-ipw-timing-source="voiceover" data-ipw-beats='${JSON.stringify(beats)}' ${binding ? `data-ipw-narration-binding='${JSON.stringify(binding)}'` : ""} data-start="0" data-duration="3" data-track-index="0"></section></main>`);
      return checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html" });
    };
    expect((await save(1, undefined)).issues.map(issue => issue.code)).toContain("invalid_custom_narration_binding");
    expect((await save(0, narration)).issues.map(issue => issue.code)).toContain("invalid_custom_narration_binding");
    expect((await save(1, narration)).valid).toBe(true);
    expect((await save(1, { ...narration, text: "停止" })).valid).toBe(false);
  });
  test("recipe-first custom scenes require inspectable recipe alternatives, not an alignment excuse", async () => {
    const { root, project } = await fixture();
    const scene = (decision: string, evidence = "") => `<main data-composition-id="main" data-ipw-recipe-policy="recipe-first"><section id="heat" class="scene clip" data-ipw-scene data-ipw-component-decision="${decision}" ${evidence ? `data-ipw-custom-recipe-evidence='${evidence}'` : ""} data-motion-pattern="progressive-build" data-ipw-timing-source="visual-cue" data-ipw-beats='[{"start":0,"end":3,"intent":"Explain heat","focus":"Heater","action":"Turn on","result":"Warmer","targets":["#heat"],"animation":"custom:heat","motion":{"start":0,"end":2}}]' data-start="0" data-duration="3" data-track-index="0"></section></main>`;
    const check = async (html: string) => {
      await writeFile(join(project, "index.html"), html);
      return checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html" });
    };
    expect((await check(scene("custom:cannot represent the heater state"))).issues.map(issue => issue.code)).toContain("custom_recipe_evidence_required");
    expect((await check(scene("custom:cannot represent the heater state").replace('data-ipw-recipe-policy="recipe-first"', "data-ipw-selected-components='[&quot;milestone-timeline&quot;]'"))).issues.map(issue => issue.code)).toContain("custom_recipe_evidence_required");
    const evidence = JSON.stringify({ candidates: [{ componentId: "milestone-timeline", limitation: "The timeline has no continuously measured heater state." }], splitOrCombine: "Splitting loses the single continuously updated thermostat state.", minimalScope: "Only the measured heater state needs an editable custom diagram." });
    expect((await check(scene("custom:phrase binding failed twice", evidence))).issues.map(issue => issue.code)).toContain("custom_recipe_evidence_required");
    expect((await check(scene("custom:continuous heater state is unavailable", evidence))).valid).toBe(true);
  });
  test("mounts selected recipes into empty slots and rejects unused selection without overwriting authored scenes", async () => {
    const { root, project, instance } = await recipeFixture("question-opener");
    expect(attribute('<section data-hf-id="editor-id" id="evidence">', "id")).toBe("evidence");
    expect(attribute('<main data-composition-id=main>', "data-composition-id")).toBe("main");
    const original = '<main data-composition-id="main"><section data-hf-id="editor-id" id="evidence"></section><p>Preserved</p></main>';
    await writeFile(join(project, "index.html"), original);
    const selected = await installVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", componentIds: [instance.componentId] });
    expect(selected.mounted).toBe(false);
    expect((await checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html" })).issues.map(issue => issue.code)).toContain("selected_recipe_not_mounted");
    const mounted = await installVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [instance], mount: true });
    expect(mounted.mounted).toBe(true);
    const html = await readFile(join(project, "index.html"), "utf8");
    expect(html).toContain(mounted.instances[0]!.snippet);
    expect(html).toContain('data-ipw-recipe-policy="recipe-first"');
    expect(html).toContain('<p>Preserved</p>');
    expect((html.match(/data-ipw-selected-components=/g) ?? [])).toHaveLength(1);
    expect((await checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html" })).valid).toBe(true);
    expect((await checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", recipesOnly: true })).valid).toBe(true);
    await writeFile(join(project, "index.html"), html.replace('data-ipw-registry-component="question-opener"', 'data-ipw-component-decision="custom:diagram"'));
    expect((await checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", recipesOnly: true })).issues.map(issue => issue.code)).toContain("recipe_only_scene_required");
    await writeFile(join(project, "index.html"), html.replace('data-ipw-recipe-policy="recipe-first"', 'data-ipw-recipe-policy="recipes-only"'));
    expect((await checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html" })).valid).toBe(true);
    await writeFile(join(project, "index.html"), html.replace('data-ipw-recipe-policy="recipe-first"', 'data-ipw-recipe-policy="recipes-only"').replace('data-ipw-registry-component="question-opener"', 'data-ipw-component-decision="custom:diagram"'));
    expect((await checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html" })).issues.map(issue => issue.code)).toContain("recipe_only_scene_required");
    await writeFile(join(project, "index.html"), html);
    await expect(installVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [instance], mount: true })).rejects.toMatchObject({ code: "video_mount_slot_conflict" });
    expect(await readFile(join(project, "index.html"), "utf8")).toBe(html);
  });
  test("compiles exact spoken phrases to frame cues and rechecks mounted alignment", async () => {
    const { root, project, manifest, instance } = await recipeFixture("question-opener");
    const events = manifest.motionRecipe.events;
    let offset = 0;
    const words = events.map((event, index) => {
      const text = `关键词${index + 1}`;
      const word = { text, beginIndex: offset, endIndex: offset + text.length, startSeconds: event.time + .007, endSeconds: event.time + .2 };
      offset += text.length;
      return word;
    });
    await mkdir(join(project, "assets"), { recursive: true });
    await writeFile(join(project, "assets/voice.timings.json"), JSON.stringify({ alignment: "provider", words }));
    const narration = { timingSourcePath: "video/session-one/assets/voice.timings.json", text: words.map(word => word.text).join(""), bindings: Object.fromEntries(events.map((event, index) => [event.id, { phrase: words[index]!.text }])) };
    const result = await installVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], motionStyle: "restrained", instances: [{ ...instance, timingSource: "voiceover", narration }] });
    expect(result.instances[0]!.cueTimes).toEqual(Object.fromEntries(events.map(event => [event.id, Math.round((event.time + .007) * 30) / 30])));
    const source = await readFile(join(project, "compositions/question-opener.html"), "utf8");
    expect(source).toContain("y:motionStyle.distance");
    expect(source).toContain("event.duration*=motionStyle.durationFactor");
    await writeFile(join(project, "index.html"), `<main>${result.instances[0]!.snippet}</main>`);
    expect((await checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html" })).valid).toBe(true);
    await expect(installVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, timingSource: "voiceover", narration: { ...narration, bindings: Object.fromEntries(events.map(event => [event.id, { phrase: "关键词" }])) } }] })).rejects.toThrow("ambiguous");
    await expect(installVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, timingSource: "voiceover" }] })).rejects.toMatchObject({ code: "video_recipe_alignment_required" });
    await writeFile(join(project, "assets/voice.timings.json"), JSON.stringify({ alignment: "unavailable", words: [] }));
    expect((await checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html" })).valid).toBe(false);
  });
  test("accepts a measured opening phrase before the recipe's default 0.65s establish", async () => {
    const { root, project, manifest, instance } = await recipeFixture("question-opener");
    const words = manifest.motionRecipe.events.map((event, index) => ({
      text: `词${index + 1}`, beginIndex: index * 2, endIndex: index * 2 + 2,
      startSeconds: index === 0 ? .28 : event.time, endSeconds: (index === 0 ? .28 : event.time) + .12,
    }));
    await mkdir(join(project, "assets"), { recursive: true });
    await writeFile(join(project, "assets/voice.timings.json"), JSON.stringify({ alignment: "provider", words }));
    const narration = { timingSourcePath: "video/session-one/assets/voice.timings.json", text: words.map(word => word.text).join(""), bindings: Object.fromEntries(manifest.motionRecipe.events.map((event, index) => [event.id, { phrase: words[index]!.text }])) };
    const result = await installVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, timingSource: "voiceover", narration }] });
    expect(result.instances[0]!.cueTimes[manifest.motionRecipe.events[0]!.id]).toBeCloseTo(8 / 30);
    const beats = JSON.parse(attribute(result.instances[0]!.snippet, "data-ipw-beats"));
    expect(beats[0].motion.end).toBeCloseTo(8 / 30);
    words[0]!.startSeconds = 0;
    words[0]!.endSeconds = .12;
    await writeFile(join(project, "assets/voice.timings.json"), JSON.stringify({ alignment: "provider", words }));
    const immediate = await installVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, timingSource: "voiceover", narration }] });
    expect(immediate.instances[0]!.cueTimes[manifest.motionRecipe.events[0]!.id]).toBe(0);
    expect(JSON.parse(attribute(immediate.instances[0]!.snippet, "data-ipw-beats"))[0].start).toBe(0);
  });
  test("numeric recipes reject invalid domains instead of inventing chart geometry", async () => {
    for (const [name, items] of [
      ["gauge-scorecard", "甲::101|乙::80"],
      ["benchmark-scorecard", "甲::90|乙::120"],
      ["conversion-funnel", "访问::100|购买::200"],
      ["conversion-funnel", "访问::0|购买::0"],
      ["cohort-retention", "甲::80,90,70|乙::70,60,50"],
      ["cohort-retention", "甲::90,80|乙::70,60,50"],
      ["sparkline-grid", "甲::10,,20|乙::20,30,40"],
      ["sparkline-grid", "甲::10,-5,20|乙::20,30,40"],
      ["metric-signal", "甲::-5|乙::10"],
    ]) {
      const fixture = await recipeFixture(name);
      const values = { ...fixture.manifest.motionRecipe.usage.example.values, items };
      await expect(installVideoComponents({ id: "test", path: fixture.root }, {
        sourcePath: "video/session-one/index.html", componentIds: [name],
        instances: [{ ...fixture.instance, values }],
      })).rejects.toThrow();
    }
    for (const [name, items] of [
      ["metric-signal", "甲::0|乙::0"],
      ["gauge-scorecard", "甲::0|乙::100"],
      ["conversion-funnel", "访问::100|购买::0"],
      ["sparkline-grid", "甲::0,0,0|乙::0,0,0"],
    ]) {
      const fixture = await recipeFixture(name);
      const values = { ...fixture.manifest.motionRecipe.usage.example.values, items };
      const installed = await installVideoComponents({ id: "test", path: fixture.root }, {
        sourcePath: "video/session-one/index.html", componentIds: [name], instances: [{ ...fixture.instance, values }],
      });
      expect(installed.instances).toHaveLength(1);
    }
  });
  test("all authored and source-attributed recipes expose complete rules and instantiate Chinese examples", async () => {
    const base = await recipeFixture();
    const names = [];
    for (const name of await readdir(base.registry)) {
      const raw = JSON.parse(await readFile(join(base.registry, name, "registry-item.json"), "utf8"));
      if (raw.motionRecipe) names.push(name);
    }
    expect(names).toHaveLength(81);
    await mkdir(join(base.project, "assets"), { recursive: true });
    await writeFile(join(base.project, "assets", "evidence.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#245b66"/></svg>');
    for (const name of names) {
      const manifest = recipeManifestSchema.parse(JSON.parse(await readFile(join(base.registry, name, "registry-item.json"), "utf8")));
      expect(manifest.motionRecipe.usage.intent?.length).toBeGreaterThan(12);
      const values = manifest.motionRecipe.usage.example.values;
      expect(Object.keys(values).sort()).toEqual(manifest.variables.filter(variable => variable.id !== "motionCueTimes").map(variable => variable.id).sort());
      expect(Object.keys(manifest.motionRecipe.usage.inputRules).sort()).toEqual(Object.keys(values).sort());
      expect(Object.keys(manifest.motionRecipe.usage.cueBindings).sort()).toEqual(manifest.motionRecipe.events.map(event => event.id).sort());
      const html = await readFile(join(base.registry, name, name + ".html"), "utf8");
      expect(html).toContain('data-ipw-motion-recipe="1"');
      const embedded = html.match(/^ const recipe=(\{.*\});$/m);
      if (embedded?.[1]) {
        const recipe = z.object({ usage: hyperframesMotionRecipeSchema.shape.usage.optional() }).parse(JSON.parse(embedded[1]));
        if (recipe.usage) {
          const embeddedUsage = { ...recipe.usage }, manifestUsage = { ...manifest.motionRecipe.usage };
          delete embeddedUsage.intent;
          delete manifestUsage.intent;
          expect({ name, usage: embeddedUsage }).toEqual({ name, usage: manifestUsage });
        }
      }

      const result = await installVideoComponents({ id: "test", path: base.root }, {
        sourcePath: "video/session-one/index.html", componentIds: [name],
        instances: [{ sceneId: "evidence", componentId: name, start: 0, duration: manifest.duration, values, timingSource: "visual-cue" }],
      });
      expect(result.instances).toHaveLength(1);
      const documentation = `compositions/${name}.recipe.md`;
      expect(result.components.find(component => component.componentId === name)?.written).toContain(`video/session-one/${documentation}`);
      expect(await readFile(join(base.project, documentation), "utf8")).toBe(await readFile(join(base.registry, name, "recipe.md"), "utf8"));
      const snippet = result.instances[0]!.snippet;
      expect(snippet).not.toContain("<scene-id>");
      expect(snippet).not.toContain("<seconds>");
      expect(snippet).toContain("motionCueTimes");
      await writeFile(join(base.project, "index.html"), `<main data-composition-id="main">${snippet}</main>`);
      const checked = await checkVideoComponents({ id: "test", path: base.root }, { sourcePath: "video/session-one/index.html" });
      expect({ name, issues: checked.issues }).toEqual({ name, issues: [] });
    }
  });

  test("preserves an edited project recipe card on repeated installation", async () => {
    const { root, project } = await recipeFixture("definition-highlight");
    const input = { sourcePath: "video/session-one/index.html", componentIds: ["definition-highlight"] };
    await installVideoComponents({ id: "test", path: root }, input);
    const path = join(project, "compositions/definition-highlight.recipe.md");
    const edited = (await readFile(path, "utf8")) + "\nProject-specific review note.\n";
    await writeFile(path, edited);
    await installVideoComponents({ id: "test", path: root }, input);
    expect(await readFile(path, "utf8")).toBe(edited);
  });

  test("capacity endpoints instantiate without truncation and reject malformed input", async () => {
    const catalog = await recipeFixture();
    for (const name of await readdir(catalog.registry)) {
      const raw = JSON.parse(await readFile(join(catalog.registry, name, "registry-item.json"), "utf8"));
      if (!raw.motionRecipe) continue;
      const manifest = recipeManifestSchema.parse(raw), capacity = manifest.motionRecipe.capacity;
      if (!capacity || capacity.encoding === "json") continue;
      const base = await recipeFixture(name);
      await mkdir(join(base.project, "assets"), { recursive: true });
      await writeFile(join(base.project, "assets/evidence.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"/>');
      const example = manifest.motionRecipe.usage.example.values;
      if (capacity.separator === undefined) throw Error("Delimited capacity requires a separator");
      const separator = capacity.separator.replaceAll("\\n", "\n");
      const first = String(example[capacity.variable]).replaceAll("\\n", "\n").split(separator)[0];
      for (const count of new Set([capacity.minItems, capacity.maxItems])) {
        const values = { ...example, [capacity.variable]: Array(count).fill(first).join(separator) };
        for (const key of ["highlight", "activeStep", "focusLine"]) if (key in values) values[key] = 1;
        const result = await installVideoComponents({ id: "test", path: base.root }, {
          sourcePath: "video/session-one/index.html", componentIds: [name],
          instances: [{ sceneId: "boundary", componentId: name, start: 0, duration: manifest.duration, values, timingSource: "visual-cue" }],
        });
        expect(result.instances).toHaveLength(1);
        expect(result.instances[0]!.snippet).toContain(JSON.stringify(values[capacity.variable]).slice(1, -1));
      }
    }
    for (const [name, changes] of [
      ["comparison-matrix", { rows: "需求|仅有一列" }],
      ["comparison-matrix", { options: "甲|乙|丙" }],
      ["bar-chart-race", { items: "甲:NaN,乙:2" }],
      ["bar-chart-race", { items: "甲:-1,乙:2" }],
      ["code-walkthrough", { code: "x".repeat(65) }],
      ["code-diff-card", { before: Array(5).fill("const x = 1").join("\n") }],
      ["concept-layers", { highlight: 1.5 }],
      ["concept-layers", { highlight: 4, items: "输入::材料|输出::结果" }],
      ["myth-fact-reveal", { items: "误区::描述|事实::描述" }],
    ] satisfies Array<[string, Record<string, string | number>]>) {
      const { root, instance } = await recipeFixture(name);
      await expect(installVideoComponents({ id: "test", path: root }, {
        sourcePath: "video/session-one/index.html", componentIds: [name],
        instances: [{ ...instance, values: { ...instance.values, ...changes } }],
      })).rejects.toThrow();
    }
  });

  test("shared JSON row capacity activates only present branches at both endpoints", async () => {
    for (const count of [2, 6]) {
      const { root, manifest, instance } = await jsonRecipeFixture(count);
      expect(hyperframesMotionRecipeSchema.safeParse(manifest.motionRecipe).success).toBe(true);
      expect(hyperframesMotionRecipeSchema.safeParse({ ...manifest.motionRecipe, capacity: { ...manifest.motionRecipe.capacity, encoding: "delimited" } }).success).toBe(false);
      const result = await installVideoComponents({ id: "test", path: root }, {
        sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [instance],
      });
      expect(Object.keys(result.instances[0]!.cueTimes)).toEqual([...Array.from({ length: count }, (_, index) => `step-${index + 1}`), "resolve"]);
      const mounted = z.object({ branches: z.string() }).parse(JSON.parse(attribute(result.instances[0]!.snippet, "data-variable-values")));
      expect(mounted.branches).toBe(instance.values.branches);
    }
  });

  test("shared JSON rows reject invalid counts, fields and identity before writing any instance", async () => {
    const { root, project, document, instance } = await jsonRecipeFixture();
    const row = document.rows[0]!;
    const invalidValues = [
      JSON.stringify({ ...document, rows: [row] }),
      JSON.stringify({ ...document, rows: Array.from({ length: 7 }, (_, index) => ({ ...row, id: `branch-${index}` })) }),
      "{not-json", JSON.stringify({ ...document, version: 2 }), JSON.stringify({ ...document, kind: "route-value" }),
      JSON.stringify({ ...document, rows: [null, row] }),
      JSON.stringify({ ...document, rows: [row, { id: "branch-2", sub: "Missing required label" }] }),
      ...[
        { label: "" }, { label: "字".repeat(11) }, { sub: "字".repeat(19) }, { icon: "unlisted" }, { highlighted: true },
        { leaves: "一,二，三、四\n五" }, { leaves: "字".repeat(13) }, { value: "NaN" }, { value: {} }, { id: row.id },
      ].map(changes => JSON.stringify({ ...document, rows: [row, { ...document.rows[1], ...changes }] })),
    ];
    for (const branches of invalidValues) await expect(installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: [instance.componentId],
      instances: [instance, { ...instance, sceneId: "invalid", values: { ...instance.values, branches } }],
    })).rejects.toThrow();
    expect(await readdir(project)).toEqual(["index.html"]);
    expect(await readFile(join(project, "index.html"), "utf8")).toBe('<!doctype html><main data-composition-id="main"></main>');
  });

  test("JSON recipe capacity still bounds a more permissive shared data contract", async () => {
    for (const count of [1, 7]) {
      const { root, project, manifest, manifestPath, instance } = await jsonRecipeFixture(count);
      await writeFile(manifestPath, JSON.stringify({ ...manifest, visualComponent: { ...manifest.visualComponent, data: { ...manifest.visualComponent.data, minRows: 0, maxRows: 8 } } }));
      await expect(installVideoComponents({ id: "test", path: root }, {
        sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [instance],
      })).rejects.toMatchObject({ code: "video_recipe_capacity_exceeded" });
      expect(await readdir(project)).toEqual(["index.html"]);
    }
  });

  test("JSON number fields allow optional blanks and real zero without coercing invalid types", async () => {
    const { root, manifest, manifestPath, document, instance } = await jsonRecipeFixture();
    const values = (value: unknown) => ({ ...instance.values, branches: JSON.stringify({ ...document, rows: document.rows.map(row => ({ ...row, value })) }) });
    for (const value of [0, "0", "", "  ", "\n"]) {
      const result = await installVideoComponents({ id: "test", path: root }, {
        sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, values: values(value) }],
      });
      const mounted = z.object({ branches: z.string() }).parse(JSON.parse(attribute(result.instances[0]!.snippet, "data-variable-values")));
      const rows = z.object({ rows: z.array(z.record(z.string(), z.unknown())) }).parse(JSON.parse(mounted.branches)).rows;
      expect(rows[0]?.value).toBe(value);
    }
    for (const value of [null, false, true, [], [1], {}, "NaN"]) await expect(installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, values: values(value) }],
    })).rejects.toMatchObject({ code: "invalid_video_recipe_data" });
    await writeFile(manifestPath, JSON.stringify({ ...manifest, visualComponent: { ...manifest.visualComponent, data: {
      ...manifest.visualComponent.data, columns: manifest.visualComponent.data.columns.map(column => column.id === "value" ? { ...column, required: true } : column),
    } } }));
    for (const value of ["", "  ", "\n"]) await expect(installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, values: values(value) }],
    })).rejects.toMatchObject({ code: "invalid_video_recipe_data" });
  });

  test("shared numeric row bounds retain metadata and reject invalid declarations or out-of-range inputs before writing", async () => {
    const { root, project, manifest, manifestPath, document, instance } = await jsonRecipeFixture();
    const data = { ...manifest.visualComponent.data, columns: manifest.visualComponent.data.columns.map(column => column.id === "value"
      ? { ...column, required: true, min: 0, max: 1 } : column) };
    const values = (value: unknown) => ({ ...instance.values, branches: JSON.stringify({ ...document, rows: document.rows.map(row => ({ ...row, value })) }) });
    for (const [min, max] of [[2, 1], [null, 1], ["0", 1], [Number.NaN, 1], [0, Infinity], [0, "1"]]) {
      const invalid = { ...data, columns: data.columns.map(column => column.id === "value" ? { ...column, min, max } : column) };
      expect(hyperframesVisualComponentDataSchema.safeParse(invalid).success).toBe(false);
      await writeFile(manifestPath, JSON.stringify({ ...manifest, visualComponent: { ...manifest.visualComponent, data: invalid } }));
      await expect(installVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, values: values(0) }] })).rejects.toThrow();
    }
    await writeFile(manifestPath, JSON.stringify({ ...manifest, visualComponent: { ...manifest.visualComponent, data } }));
    const parsed = hyperframesVisualComponentDataSchema.parse(data);
    expect(parsed.columns.find(column => column.id === "value")).toMatchObject({ min: 0, max: 1 });
    for (const value of [-.01, 1.01, "", " ", undefined]) await expect(installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, values: values(value) }],
    })).rejects.toMatchObject({ code: "invalid_video_recipe_data" });
    expect(await readdir(project)).toEqual(["index.html"]);
    for (const value of [0, 1, .5, "0", "1"]) {
      const result = await installVideoComponents({ id: "test", path: root }, {
        sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, values: values(value) }],
      });
      expect(result.instances).toHaveLength(1);
    }
    await writeFile(manifestPath, JSON.stringify({ ...manifest, visualComponent: { ...manifest.visualComponent, data: {
      ...data, columns: data.columns.map(column => column.id === "value" ? { ...column, required: false } : column),
    } } }));
    const optional = await installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, values: values(" ") }],
    });
    expect(optional.instances).toHaveLength(1);
    await expect(installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, values: values(1.01) }],
    })).rejects.toMatchObject({ code: "invalid_video_recipe_data" });
  });

  test("JSON row limits come from the shared manifest and preserve Unicode and literal separator semantics", async () => {
    const { root, project, manifest, manifestPath, document, instance } = await jsonRecipeFixture();
    for (const data of [
      { ...manifest.visualComponent.data, minRows: 3 },
      { ...manifest.visualComponent.data, maxRows: 1 },
      { ...manifest.visualComponent.data, binding: { variable: "other", encoding: "json" } },
    ]) {
      await writeFile(manifestPath, JSON.stringify({ ...manifest, visualComponent: { ...manifest.visualComponent, data } }));
      await expect(installVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [instance] })).rejects.toThrow();
    }
    expect(await readdir(project)).toEqual(["index.html"]);
    await writeFile(manifestPath, JSON.stringify({ ...manifest, visualComponent: { ...manifest.visualComponent, data: {
      ...manifest.visualComponent.data, columns: manifest.visualComponent.data.columns.map(column => column.id === "leaves"
        ? { ...column, list: { maxItems: 4, itemMaxLength: 12, separators: "[]" } } : column),
    } } }));
    const branches = JSON.stringify({ ...document, rows: document.rows.map(row => ({ ...row, label: "😀".repeat(10), leaves: "输入[处理]结果", extra: "legacy field retained" })) });
    const result = await installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, values: { ...instance.values, branches } }],
    });
    expect(result.instances[0]!.snippet).toContain("legacy field retained");
  });

  test("bounded scalar inputs allow declared empty defaults and count Unicode characters", async () => {
    const { root, project, manifest, manifestPath, instance } = await jsonRecipeFixture();
    await writeFile(manifestPath, JSON.stringify({ ...manifest, motionRecipe: { ...manifest.motionRecipe, textLimits: { title: { maxLines: 2, maxLineLength: 7 } } } }));
    for (const values of [
      { ...instance.values, title: "" }, { title: "关系图", branches: instance.values.branches },
      { ...instance.values, sub: "字".repeat(19) }, { ...instance.values, title: "😀".repeat(8) },
    ]) await expect(installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, values }],
    })).rejects.toThrow();
    expect(await readdir(project)).toEqual(["index.html"]);
    const result = await installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: [instance.componentId],
      instances: [{ ...instance, values: { ...instance.values, sub: "😀".repeat(18), title: "😀".repeat(7) } }],
    });
    expect(result.instances).toHaveLength(1);
  });

  test("measured provider narration binds exactly the active JSON branch events", async () => {
    for (const count of [2, 6]) {
      const { root, project, instance } = await jsonRecipeFixture(count);
      const eventIds = [...Array.from({ length: count }, (_, index) => `step-${index + 1}`), "resolve"];
      let offset = 0;
      const words = eventIds.map((id, index) => {
        const text = id === "resolve" ? "最后收束" : `分支${index + 1}`;
        const word = { text, beginIndex: offset, endIndex: offset + text.length, startSeconds: .237 + index, endSeconds: .437 + index };
        offset += text.length;
        return word;
      });
      await mkdir(join(project, "assets"));
      await writeFile(join(project, "assets/voice.timings.json"), JSON.stringify({ alignment: "provider", words }));
      const narration = { timingSourcePath: "video/session-one/assets/voice.timings.json", text: words.map(word => word.text).join(""), bindings: Object.fromEntries(eventIds.map((id, index) => [id, { phrase: words[index]!.text }])) };
      for (const bindings of [
        { ...narration.bindings, absent: { phrase: "最后收束" } },
        Object.fromEntries(Object.entries(narration.bindings).filter(([id]) => id !== "step-2")),
      ]) await expect(installVideoComponents({ id: "test", path: root }, {
        sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, duration: count + 1.5, timingSource: "voiceover", narration: { ...narration, bindings } }],
      })).rejects.toMatchObject({ code: "invalid_video_recipe_alignment" });
      expect((await readdir(project)).sort()).toEqual(["assets", "index.html"]);
      const result = await installVideoComponents({ id: "test", path: root }, {
        sourcePath: "video/session-one/index.html", componentIds: [instance.componentId], instances: [{ ...instance, duration: count + 1.5, timingSource: "voiceover", narration }],
      });
      expect(result.instances[0]!.cueTimes).toEqual(Object.fromEntries(eventIds.map((id, index) => [id, Math.round(words[index]!.startSeconds * 30) / 30])));
    }
  });

  test("validates input before copying and rejects capacity, unknown values, conflicting cues and duplicate identity", async () => {
    const { root, project, instance } = await recipeFixture();
    const run = (instances: unknown[]) => installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: ["comparison-matrix"], instances,
    });
    for (const invalid of [
      { ...instance, values: {} },
      { ...instance, values: { ...instance.values, winner: "invented" } },
      { ...instance, values: { ...instance.values, unknown: "ignored?" } },
      { ...instance, values: { ...instance.values, rows: "A|1|2;B|1|2;C|1|2;D|1|2;E|1|2" } },
      { ...instance, cueTimes: { "step-2": .2 } },
      { ...instance, cueTimes: { invented: 3 } },
      { ...instance, duration: 40 },
    ]) await expect(run([invalid])).rejects.toThrow();
    await expect(run([instance, instance])).rejects.toThrow("unique sceneId");
    expect(await readdir(project)).toEqual(["index.html"]);
  });

  test("escapes content, binds measured semantic cues and preserves an existing edited copy", async () => {
    const { root, project, instance } = await recipeFixture();
    const result = await installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: ["comparison-matrix"],
      instances: [{ ...instance, values: { ...instance.values, title: '证据 <script> & "quoted"' }, cueTimes: { "step-2": 3.4 } }],
    });
    expect(result.instances[0]?.snippet).toContain("&lt;script&gt;");
    expect(result.instances[0]?.snippet).not.toContain("<script>");
    expect(result.instances[0]?.cueTimes["step-2"]).toBe(3.4);
    const path = join(project, "compositions", "comparison-matrix.html");
    await writeFile(path, "<main>User-owned older composition</main>");
    await expect(installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: ["comparison-matrix"], instances: [instance],
    })).rejects.toThrow("Preserve its edits");
    expect(await readFile(path, "utf8")).toBe("<main>User-owned older composition</main>");
  });

  test("media recipes reject missing assets and attempts to escape their project", async () => {
    const { root, instance } = await recipeFixture("media-hero");
    for (const mediaUrl of ["assets/missing.png", "assets/../../other/file.png", "https://example.com/a.png"]) {
      await expect(installVideoComponents({ id: "test", path: root }, {
        sourcePath: "video/session-one/index.html", componentIds: ["media-hero"],
        instances: [{ ...instance, values: { ...instance.values, mediaUrl } }],
      })).rejects.toThrow();
    }
  });

  test("measured cues can extend a recipe without misreporting its native default as the motion end", async () => {
    const { root, project, instance } = await recipeFixture();
    const result = await installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: ["comparison-matrix"],
      instances: [{ ...instance, duration: 14, cueTimes: { "step-4": 9.2, resolve: 12.5 } }],
    });
    await writeFile(join(project, "index.html"), `<main>${result.instances[0]!.snippet}</main>`);
    expect((await checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html" })).issues).toEqual([]);
  });

  test("accepts a validated readable final hold without applying the legacy two-second cutoff", async () => {
    const { root, project, instance } = await recipeFixture();
    const result = await installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: ["comparison-matrix"],
      instances: [{ ...instance, duration: instance.duration + 2 }],
    });
    await writeFile(join(project, "index.html"), `<main>${result.instances[0]!.snippet}</main>`);
    expect((await checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html" })).issues).toEqual([]);
  });

  test("checks declared recipe motion against actual cue windows without rejecting readable holds", async () => {
    const { root, project, instance } = await recipeFixture();
    const result = await installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: [instance.componentId],
      instances: [{ ...instance, duration: instance.duration + 2 }],
    });
    const snippet = result.instances[0]!.snippet;
    const rawBeats = attribute(snippet, "data-ipw-beats");
    const beatSchema = z.array(z.object({
      start: z.number(), end: z.number(), animation: z.string(),
      motion: z.object({ start: z.number(), end: z.number() }),
    }).passthrough());
    const workspace = { id: "test", path: root };
    const input = { sourcePath: "video/session-one/index.html" };
    const save = (beats: z.infer<typeof beatSchema>) => writeFile(join(project, "index.html"),
      `<main>${snippet.replace(/data-ipw-beats="[^"]*"/u, () => `data-ipw-beats='${JSON.stringify(beats).replaceAll("&", "&amp;").replaceAll("'", "&#39;")}'`)}</main>`);

    // Extend both an inter-event gap and the final reading interval in metadata only.
    for (const index of [1, beatSchema.parse(JSON.parse(rawBeats)).length - 1]) {
      const beats = beatSchema.parse(JSON.parse(rawBeats));
      const beat = beats[index]!;
      beat.motion.end = beat.end;
      await save(beats);
      const checked = await checkVideoComponents(workspace, input);
      expect(checked.valid).toBe(false);
      expect(checked.issues.map(issue => issue.code)).toEqual(["component_beat_motion_mismatch"]);
      expect(checked.repairPlan).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "component_beat_motion_mismatch", action: "repair-metadata",
          message: expect.stringContaining("actual event and cue windows"),
        }),
      ]));
    }

    const beats = beatSchema.parse(JSON.parse(rawBeats));
    const final = beats.at(-1)!;
    const holdStart = final.motion.end;
    const hold = { ...final, start: holdStart, animation: "hold:reading", motion: { start: holdStart, end: final.end } };
    final.end = holdStart;
    beats.push(hold);
    await save(beats);
    expect(await checkVideoComponents(workspace, input)).toMatchObject({ valid: true, issues: [], pacing: { maxStillSeconds: 4 } });
  });

  test("installs the shared spatial stage with original shots and optional carrier recipes", async () => {
    const { root, project } = await fixture();
    process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT = join(
      import.meta.dir,
      "../../../../vendor/hyperframes/registry/blocks",
    );

    const result = await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
      componentIds: ["spatial-camera-suite"],
    });

    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.componentId).toBe("spatial-camera-suite");
    expect(result.components[0]?.motionContract).toMatchObject({
      version: 2,
      durationSeconds: 9,
      timing: "measure-from-render",
    });
    expect(result.components[0]?.snippet).toContain('data-composition-src="compositions/spatial-camera-suite.html"');
    expect(result.components[0]?.snippet).toContain('data-ipw-registry-component="spatial-camera-suite"');
    expect(result.components[0]?.snippet).toContain('data-ipw-animation-reference="spatial-camera-suite"');
    expect(result.components[0]?.snippet).toContain('data-ipw-timing-owner="host"');

    const installed = await readFile(join(project, "compositions", "spatial-camera-suite.html"), "utf8");
    expect(installed).toContain('data-ipw-native-duration="9"');
    expect(installed).not.toContain('data-duration="9"');
    for (const recipe of [
      "graze-face-tour",
      "depth-layer-moves",
      "spotlight-hero-card",
      "runway-ground-skim",
      "steep-tilt-glide",
      "subject-follow-track",
      "container-morph",
      "gather-lockup",
    ]) expect(installed).toContain(recipe);
  });

  test("installs selected components and returns a traceable native subcomposition snippet", async () => {
    const { root, project } = await fixture();
    const result = await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
      componentIds: ["milestone-timeline"],
    });

    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.snippet).toContain('data-composition-src="compositions/milestone-timeline.html"');
    expect(result.components[0]?.snippet).toContain('data-composition-id="milestone-timeline-<scene-id>"');
    expect(result.components[0]?.snippet).toContain('data-ipw-registry-component="milestone-timeline"');
    expect(result.components[0]?.snippet).toContain('data-ipw-timing-owner="host"');
    expect(result.components[0]?.snippet).toContain('data-ipw-beats=');
    expect(result.components[0]?.snippet).toContain('data-ipw-motion-contract=');
    expect(result.components[0]?.motionContract).toMatchObject({
      version: 2,
      durationSeconds: 9,
      targets: ['[data-ipw-variable="title"]', '[data-ipw-variable="stepOne"]', '[data-ipw-variable="stepTwo"]'],
      timing: "measure-from-render",
    });
    const installed = await readFile(join(project, "compositions", "milestone-timeline.html"), "utf8");
    expect(installed).toContain('data-ipw-timing-owner="host"');
    expect(installed).toContain('data-ipw-native-duration="9"');
    expect(installed).not.toContain('data-duration="9"');
    expect(installed).not.toContain('data-start="0"');
  });

  test("derives common component action targets from its authored timeline", async () => {
    const { root, project } = await fixture();
    await writeFile(join(root, "registry", "milestone-timeline", "milestone-timeline.html"), `<!doctype html><main data-composition-id="milestone-timeline"><h1 class="title">Timeline</h1><div class="steps"></div><script>const tl=gsap.timeline();tl.from(root.querySelector(".title"),{opacity:0}).to(root.querySelectorAll(".steps"),{opacity:1});</script></main>`);
    const result = await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
      componentIds: ["milestone-timeline"],
    });

    expect(result.components[0]?.motionContract).toMatchObject({
      source: "authored-timeline",
      targets: [".title", ".steps"],
      timing: "measure-from-render",
    });
    expect(await readFile(join(project, "compositions", "milestone-timeline.html"), "utf8")).toContain(".steps");
  });

  test("host timing normalization preserves quoted arrow functions and JSON defaults", async () => {
    const { root, project } = await fixture();
    const defaults = JSON.stringify({ code: "items.map(item => item.value)" });
    await writeFile(join(root, "registry", "milestone-timeline", "milestone-timeline.html"),
      `<main data-composition-id="milestone-timeline" data-duration="9" data-defaults='${defaults}'><h1>Code</h1></main>`);
    await installVideoComponents({ id: "test", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: ["milestone-timeline"],
    });
    const installed = await readFile(join(project, "compositions", "milestone-timeline.html"), "utf8");
    expect(installed).toContain(`data-defaults='${defaults}'`);
    expect(installed).toContain('data-ipw-native-duration="9"');
    expect(installed).not.toContain('data-duration="9"');
  });

  test("accepts real component reuse and rejects untracked custom imitation", async () => {
    const { root, project } = await fixture();
    await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
      componentIds: ["milestone-timeline"],
    });
    await writeFile(join(project, "index.html"), `<!doctype html><main data-composition-id="main">
      <section id="roadmap" class="scene clip" data-ipw-scene data-composition-id="milestone-timeline-roadmap" data-composition-src="compositions/milestone-timeline.html" data-ipw-registry-component="milestone-timeline" data-ipw-timing-owner="host" data-motion-pattern="path-journey" data-ipw-timing-source="voiceover" data-ipw-beats='[{"start":0,"end":4,"intent":"Frame the plan","focus":"First milestone","action":"Reveal the first step","result":"First milestone remains visible","targets":["#roadmap"],"animation":"component:milestone-timeline","motion":{"start":0,"end":4}},{"start":4,"end":9,"intent":"Complete the route","focus":"Full timeline","action":"Advance through remaining steps","result":"Complete timeline holds","targets":["#roadmap"],"animation":"component:milestone-timeline","motion":{"start":4,"end":9}}]' data-variable-values='{"title":"90 days"}' data-start="0" data-duration="9" data-track-index="0"></section>
    </main>`);
    expect(await checkVideoComponents({ id: "workspace", path: root }, { sourcePath: "video/session-one/index.html" })).toMatchObject({
      valid: true,
      sceneCount: 1,
      reusedComponentCount: 1,
      customSceneCount: 0,
      issues: [],
    });

    await writeFile(join(project, "index.html"), `<!doctype html><main data-composition-id="main">
      <section id="roadmap" class="scene clip" data-ipw-scene data-motion-pattern="path-journey" data-ipw-timing-source="estimated-reading" data-ipw-beats='[{"start":0,"end":9,"intent":"Explain the route","focus":"Roadmap","action":"Advance along the path","result":"Route is complete","targets":["#roadmap"],"animation":"custom:path-growth","motion":{"start":0,"end":9}}]' data-start="0" data-duration="9" data-track-index="0"></section>
    </main>`);
    const invalid = await checkVideoComponents({ id: "workspace", path: root }, { sourcePath: "video/session-one/index.html" });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map(issue => issue.code)).toContain("missing_component_decision");
  });

  test("accepts browser-serialized JSON attributes", async () => {
    const { root, project } = await fixture();
    await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
      componentIds: ["milestone-timeline"],
    });
    await writeFile(join(project, "index.html"), `<!doctype html><main data-composition-id="main">
      <section id="roadmap" class="scene clip" data-ipw-scene data-composition-id="milestone-timeline-roadmap" data-composition-src="compositions/milestone-timeline.html" data-ipw-registry-component="milestone-timeline" data-ipw-timing-owner="host" data-motion-pattern="path-journey" data-ipw-timing-source="voiceover" data-ipw-beats="[{&quot;start&quot;:0,&quot;end&quot;:4,&quot;intent&quot;:&quot;Frame the plan&quot;,&quot;focus&quot;:&quot;First milestone&quot;,&quot;action&quot;:&quot;Reveal the first step&quot;,&quot;result&quot;:&quot;First milestone remains visible&quot;,&quot;targets&quot;:[&quot;#roadmap&quot;],&quot;animation&quot;:&quot;component:milestone-timeline&quot;,&quot;motion&quot;:{&quot;start&quot;:0,&quot;end&quot;:4}},{&quot;start&quot;:4,&quot;end&quot;:9,&quot;intent&quot;:&quot;Complete the route&quot;,&quot;focus&quot;:&quot;Full timeline&quot;,&quot;action&quot;:&quot;Advance through remaining steps&quot;,&quot;result&quot;:&quot;Complete timeline holds&quot;,&quot;targets&quot;:[&quot;#roadmap&quot;],&quot;animation&quot;:&quot;component:milestone-timeline&quot;,&quot;motion&quot;:{&quot;start&quot;:4,&quot;end&quot;:9}}]" data-variable-values="{&quot;title&quot;:&quot;90 days&quot;}" data-start="0" data-duration="9" data-track-index="0"></section>
    </main>`);

    const result = await checkVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
    });
    expect(result.issues.map(issue => issue.code)).not.toContain("invalid_scene_beats");
    expect(result.issues.map(issue => issue.code)).not.toContain("invalid_component_values");
  });

  test("validates installed ShotCraft recipes when the composition declares them", async () => {
    const { root, project } = await fixture();
    const registry = join(import.meta.dir, "../../../../vendor/hyperframes/registry/blocks");
    const host = (shotStyle: string) => `<!doctype html><main data-composition-id="main">
      <section id="hero" class="scene clip" data-ipw-scene data-composition-id="spatial-camera-suite-hero" data-composition-src="compositions/spatial-camera-suite.html" data-ipw-registry-component="spatial-camera-suite" data-ipw-timing-owner="host" data-motion-pattern="camera-journey" data-ipw-timing-source="visual-cue" data-ipw-beats='[{"start":0,"end":2,"intent":"Establish","focus":"Wide composition","action":"Reveal the scene","result":"The visual is established","targets":["#hero"],"animation":"component:spatial-camera-suite","motion":{"start":0,"end":2}},{"start":2,"end":6,"intent":"Develop","focus":"Featured image","action":"Travel toward the image","result":"The image becomes the focus","targets":["#hero"],"animation":"component:spatial-camera-suite","motion":{"start":2,"end":6}},{"start":6,"end":9,"intent":"Land","focus":"Full composition","action":"Return to the complete frame","result":"The composition resolves","targets":["#hero"],"animation":"component:spatial-camera-suite","motion":{"start":6,"end":9}}]' data-variable-values='{"title":"A real story","shotStyle":"${shotStyle}","imageUrl":"assets/source.jpg","items":"*Evidence::The original image remains visible"}' data-start="0" data-duration="9" data-track-index="0"><img src="assets/source.jpg" alt="Source image"></section>
    </main>`;

    await writeFile(join(project, "index.html"), host("depth-layer-moves"));
    const withoutInstalledCamera = await checkVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
    });
    expect(withoutInstalledCamera.valid).toBe(false);
    expect(withoutInstalledCamera.issues.map(issue => issue.code)).toContain("missing_spatial_camera_component");

    process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT = registry;
    await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
      componentIds: ["spatial-camera-suite"],
    });
    for (const shotStyle of [
      "graze-face-tour",
      "depth-layer-moves",
      "spotlight-hero-card",
      "runway-ground-skim",
      "steep-tilt-glide",
    ]) {
      await writeFile(join(project, "index.html"), host(shotStyle));
      const withRealCamera = await checkVideoComponents({ id: "workspace", path: root }, {
        sourcePath: "video/session-one/index.html",
      });
      expect(withRealCamera.valid).toBe(true);
      expect(withRealCamera.scenes[0]).toMatchObject({
        componentId: "spatial-camera-suite",
        motionPattern: "camera-journey",
      });
    }

    const installedCamera = join(project, "compositions/spatial-camera-suite.html");
    const currentCamera = await readFile(installedCamera, "utf8");
    await writeFile(installedCamera, currentCamera.replaceAll('"value":"subject-follow-track"', '"value":"unavailable-follow-track"'));
    await writeFile(join(project, "index.html"), host("subject-follow-track"));
    const preservedOlderCopy = await checkVideoComponents({ id: "workspace", path: root }, {sourcePath: "video/session-one/index.html"});
    expect(preservedOlderCopy.issues.map(issue => issue.code)).toContain("installed_spatial_camera_recipe_outdated");
    expect(await readFile(installedCamera, "utf8")).not.toBe(currentCamera);
    await writeFile(installedCamera, currentCamera);

    await writeFile(join(project, "index.html"), host("basic"));
    const invalidRecipe = await checkVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
    });
    expect(invalidRecipe.valid).toBe(false);
    expect(invalidRecipe.issues.map(issue => issue.code)).toContain("invalid_spatial_camera_recipe");
  });

  test("accepts a host-owned camera journey summarized by explicit route metadata", async () => {
    const { root, project } = await fixture();
    process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT = join(import.meta.dir, "../../../../vendor/hyperframes/registry/blocks");
    await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
      componentIds: ["spatial-camera-suite"],
    });
    await writeFile(join(project, "index.html"), `<!doctype html><main data-composition-id="main">
      <section id="hero" class="scene clip" data-ipw-scene data-composition-id="spatial-camera-suite-hero" data-composition-src="compositions/spatial-camera-suite.html" data-ipw-registry-component="spatial-camera-suite" data-ipw-animation-reference="spatial-camera-suite" data-ipw-timing-owner="host" data-motion-pattern="camera-journey" data-ipw-camera-origin="wide opener" data-ipw-camera-waypoint="hero product card" data-ipw-camera-destination="settled overview" data-ipw-timing-source="visual-cue" data-ipw-beats='[{"start":0,"end":9,"intent":"Introduce","focus":"Product journey","action":"Run the installed camera choreography","result":"Overview lands","targets":"#hero","animation":"component:spatial-camera-suite","motion":{"start":0,"end":9}}]' data-variable-values='{"title":"A real story","shotStyle":"spotlight-hero-card","imageUrl":"assets/source.jpg","items":"*Evidence::Visible"}' data-start="0" data-duration="9" data-track-index="0"></section>
    </main>`);

    expect(await checkVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
    })).toMatchObject({ valid: true, sceneCount: 1, issues: [] });
  });

  test("accepts a justified custom scene with a logo without forcing a spatial camera", async () => {
    const { root, project } = await fixture();
    await writeFile(join(project, "index.html"), `<!doctype html><main data-composition-id="main">
      <section id="map" class="scene clip" data-ipw-scene data-ipw-component-decision="custom:requires a canal-specific geospatial path" data-motion-pattern="path-journey" data-ipw-timing-source="visual-cue" data-ipw-beats='[{"start":0,"end":12,"intent":"Travel along the canal","focus":"Canal route","action":"Grow the route through each stop","result":"Complete route remains visible","targets":["#map"],"animation":"custom:canal-route-growth","motion":{"start":0,"end":12}}]' data-start="0" data-duration="12" data-track-index="0"></section>
      <img src="assets/logo.svg" alt="Brand logo">
    </main>`);
    expect(await checkVideoComponents({ id: "workspace", path: root }, { sourcePath: "video/session-one/index.html" })).toMatchObject({
      valid: true,
      reusedComponentCount: 0,
      customSceneCount: 1,
      issues: [],
    });
  });

  test("rejects discontinuous beats, timeline gaps, and full scenes omitted from acceptance", async () => {
    const { root, project } = await fixture();
    await writeFile(join(project, "index.html"), `<!doctype html><main data-composition-id="main">
      <section id="opening" class="scene clip" data-ipw-scene data-ipw-component-decision="custom:title treatment" data-motion-pattern="progressive-build" data-ipw-timing-source="estimated-reading" data-ipw-beats='[{"start":0,"end":2,"intent":"Open","focus":"Title","action":"Reveal title","result":"Title holds","targets":["#opening"],"animation":"custom:title-reveal","motion":{"start":0,"end":2}},{"start":3,"end":5,"intent":"Orient","focus":"Subtitle","action":"Reveal subtitle","result":"Opening resolves","targets":["#opening"],"animation":"hold:reading","motion":{"start":3,"end":5}}]' data-start="0" data-duration="5" data-track-index="0"></section>
      <section id="details" class="scene clip" data-start="7" data-duration="5" data-track-index="0"></section>
    </main>`);
    const result = await checkVideoComponents({ id: "workspace", path: root }, { sourcePath: "video/session-one/index.html" });
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toContain("scene_beat_gap_or_overlap");
    expect(result.issues.map(issue => issue.code)).toContain("untracked_video_scene");
  });

  test("rejects older component copies with their own clip timing", async () => {
    const { root, project } = await fixture();
    await mkdir(join(project, "compositions"), { recursive: true });
    await writeFile(join(project, "compositions", "milestone-timeline.html"), '<main data-composition-id="milestone-timeline" data-start="0" data-duration="9"></main>');
    await writeFile(join(project, "index.html"), `<!doctype html><main data-composition-id="main">
      <section id="roadmap" class="scene clip" data-ipw-scene data-composition-id="milestone-timeline-roadmap" data-composition-src="compositions/milestone-timeline.html" data-ipw-registry-component="milestone-timeline" data-ipw-timing-owner="host" data-motion-pattern="path-journey" data-ipw-timing-source="voiceover" data-ipw-beats='[{"start":0,"end":20,"intent":"Explain milestones","focus":"Timeline","action":"Advance through milestones","result":"Complete timeline holds","targets":["#roadmap"],"animation":"component:milestone-timeline","motion":{"start":0,"end":20}}]' data-variable-values='{"title":"90 days"}' data-start="0" data-duration="20" data-track-index="0"></section>
    </main>`);
    const result = await checkVideoComponents({ id: "workspace", path: root }, { sourcePath: "video/session-one/index.html" });
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toContain("component_timing_not_host_owned");
    expect(result.issues.map(issue => issue.code)).toContain("component_has_internal_clip_timing");
  });

  test("rejects a long component scene whose executable motion ends near the start", async () => {
    const { root, project } = await fixture();
    await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
      componentIds: ["milestone-timeline"],
    });
    await writeFile(join(project, "index.html"), `<!doctype html><main data-composition-id="main">
      <section id="roadmap" class="scene clip" data-ipw-scene data-composition-id="milestone-timeline-roadmap" data-composition-src="compositions/milestone-timeline.html" data-ipw-registry-component="milestone-timeline" data-ipw-timing-owner="host" data-motion-pattern="path-journey" data-ipw-timing-source="estimated-reading" data-ipw-beats='[{"start":0,"end":9,"intent":"Build the route","focus":"Timeline","action":"Advance milestones","result":"Route resolves","targets":["#roadmap"],"animation":"component:milestone-timeline","motion":{"start":0,"end":9}},{"start":9,"end":14,"intent":"Explain the result","focus":"Resolved timeline","action":"Keep the result visible","result":"Route holds","targets":["#roadmap"],"animation":"hold:reading","motion":{"start":9,"end":14}}]' data-variable-values='{"title":"90 days"}' data-start="0" data-duration="14" data-track-index="0"></section>
    </main>`);
    const result = await checkVideoComponents({ id: "workspace", path: root }, { sourcePath: "video/session-one/index.html" });
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toContain("component_motion_ends_too_early");
    expect(result.issues.map(issue => issue.code)).toContain("scene_hold_too_long");
    expect(result.repairPlan).toEqual(expect.arrayContaining([
      expect.objectContaining({ sceneId: "roadmap", code: "scene_still_interval_too_long", action: "develop-beat", message: expect.stringContaining("visible content reveal, focus transfer, comparison, or state change") }),
      expect.objectContaining({ sceneId: "roadmap", code: "component_motion_ends_too_early", action: "develop-beat", message: expect.stringContaining("specific follow-up target") }),
    ]));
    expect(result.repairPlan.every(repair => !repair.message.includes("Call list_motion_presets"))).toBe(true);
  });

  test("returns a semantic split repair for a still interval longer than eight seconds", async () => {
    const { root, project } = await fixture();
    await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
      componentIds: ["milestone-timeline"],
    });
    await writeFile(join(project, "index.html"), `<!doctype html><main data-composition-id="main">
      <section id="roadmap" class="scene clip" data-ipw-scene data-composition-id="milestone-timeline-roadmap" data-composition-src="compositions/milestone-timeline.html" data-ipw-registry-component="milestone-timeline" data-ipw-timing-owner="host" data-motion-pattern="path-journey" data-ipw-timing-source="voiceover" data-ipw-beats='[{"start":0,"end":9,"intent":"Build the route","focus":"Timeline","action":"Advance milestones","result":"Route resolves","targets":["#roadmap"],"animation":"component:milestone-timeline","motion":{"start":0,"end":9}},{"start":9,"end":20,"intent":"Explain implications","focus":"Resolved timeline","action":"Keep the result visible","result":"Implications remain readable","targets":["#roadmap"],"animation":"hold:reading","motion":{"start":9,"end":20}}]' data-variable-values='{"title":"90 days"}' data-start="0" data-duration="20" data-track-index="0"></section>
    </main>`);
    const result = await checkVideoComponents({ id: "workspace", path: root }, { sourcePath: "video/session-one/index.html" });
    expect(result.valid).toBe(false);
    expect(result.repairPlan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sceneId: "roadmap",
        code: "scene_still_interval_too_long",
        action: "split-scene",
      }),
    ]));
  });

  test("preserves an existing project component instead of overwriting local edits", async () => {
    const { root, project } = await fixture();
    const target = join(project, "compositions", "milestone-timeline.html");
    await mkdir(join(project, "compositions"), { recursive: true });
    await writeFile(target, '<main data-composition-id="milestone-timeline" data-ipw-timing-owner="host" data-ipw-native-duration="9"><h1>Customized</h1></main>');

    await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
      componentIds: ["milestone-timeline"],
    });

    expect(await readFile(target, "utf8")).toContain("Customized");
  });

  test("accepts later preset motion and a declared incoming transition", async () => {
    const { root, project } = await fixture();
    await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
      componentIds: ["milestone-timeline"],
    });
    await writeFile(join(project, "index.html"), `<!doctype html><main data-composition-id="main">
      <section id="roadmap" class="scene clip" data-ipw-scene data-composition-id="milestone-timeline-roadmap" data-composition-src="compositions/milestone-timeline.html" data-ipw-registry-component="milestone-timeline" data-ipw-timing-owner="host" data-motion-pattern="path-journey" data-ipw-timing-source="estimated-reading" data-ipw-beats='[{"start":0,"end":9,"intent":"Build the route","focus":"Timeline","action":"Advance milestones","result":"Route resolves","targets":["#roadmap"],"animation":"component:milestone-timeline","motion":{"start":0,"end":9}},{"start":9,"end":12,"intent":"Emphasize the result","focus":"Final milestone","action":"Lift the final milestone","result":"Conclusion is clear","targets":["#roadmap .final-step"],"animation":"preset:element.emphasis.lift","motion":{"start":9,"end":12}}]' data-variable-values='{"title":"90 days"}' data-start="0" data-duration="12" data-track-index="0"><span class="final-step" data-ipw-animation-reference="element.emphasis.lift"></span></section>
      <section id="outro" class="scene clip" data-ipw-scene data-ipw-component-decision="custom:short closing lockup" data-motion-pattern="progressive-build" data-ipw-timing-source="visual-cue" data-ipw-transition-in="preset:transition.split-wipe" data-ipw-transition-duration="0.8" data-ipw-transition-intent="closure" data-ipw-beats='[{"start":0,"end":3,"intent":"Close","focus":"Final message","action":"Reveal the closing lockup","result":"Message lands","targets":["#outro"],"animation":"preset:transition.split-wipe","motion":{"start":0,"end":3}}]' data-ipw-animation-reference="transition.split-wipe" data-start="12" data-duration="3" data-track-index="0"></section>
    </main>`);
    expect(await checkVideoComponents({ id: "workspace", path: root }, { sourcePath: "video/session-one/index.html" })).toMatchObject({ valid: true, sceneCount: 2, issues: [] });
    const source = await readFile(join(project, "index.html"), "utf8");
    await writeFile(join(project, "index.html"), source.replace('data-ipw-transition-intent="closure"', 'data-ipw-transition-intent="progression"'));
    const invalid = await checkVideoComponents({ id: "workspace", path: root }, { sourcePath: "video/session-one/index.html" });
    expect(invalid.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_scene_transition_intent", message: expect.stringContaining("topic-change") }),
    ]));
  });

  test("accepts a timed authored transition only with an explicit cross-scene handoff", async () => {
    const { root, project } = await fixture();
    await writeFile(join(project, "index.html"), `<!doctype html><main data-composition-id="main">
      <section id="queue" class="scene clip" data-ipw-scene data-ipw-component-decision="custom:continuous queue state" data-motion-pattern="progressive-build" data-ipw-timing-source="visual-cue" data-ipw-beats='[{"start":0,"end":3,"intent":"Build the queue","focus":"Queue","action":"Show arrivals","result":"Three people wait","targets":["#queue"],"animation":"custom:arrivals","motion":{"start":0,"end":3}}]' data-start="0" data-duration="3" data-track-index="0"></section>
      <section id="backlog" class="scene clip" data-ipw-scene data-ipw-component-decision="custom:continuous queue state" data-motion-pattern="state-transformation" data-ipw-timing-source="visual-cue" data-ipw-transition-in="custom:queue-handoff" data-ipw-transition-duration="0.8" data-ipw-transition-intent="continue" data-ipw-transition-handoff='{"fromSceneId":"queue","outgoingResult":"Three people wait","incomingSubject":"The same coffee queue","continuity":"Keep the three existing people in place","visualAction":"Reveal the next arrival behind them","target":"#backlog"}' data-ipw-animation-reference="queue-handoff" data-ipw-beats='[{"start":0,"end":0.8,"intent":"Carry the queue","focus":"Same people","action":"Reveal another arrival","result":"Old queue stays visible","targets":["#backlog"],"animation":"custom:queue-handoff","motion":{"start":0,"end":0.8}},{"start":0.8,"end":3,"intent":"Read the result","focus":"Longer queue","action":"Hold the state","result":"Queue is readable","targets":["#backlog"],"animation":"hold:reading","motion":{"start":0.8,"end":0.9}}]' data-start="3" data-duration="3" data-track-index="0"></section>
    </main>`);
    const workspace = { id: "workspace", path: root };
    const input = { sourcePath: "video/session-one/index.html" };
    expect(await checkVideoComponents(workspace, input)).toMatchObject({ valid: true, sceneCount: 2, issues: [] });

    const source = await readFile(join(project, "index.html"), "utf8");
    await writeFile(join(project, "index.html"), source.replace(' data-ipw-animation-reference="queue-handoff"', ""));
    expect((await checkVideoComponents(workspace, input)).issues.map(issue => issue.code)).toContain("missing_transition_animation_reference");
    await writeFile(join(project, "index.html"), source.replace('"fromSceneId":"queue"', '"fromSceneId":"wrong-scene"'));
    expect((await checkVideoComponents(workspace, input)).issues.map(issue => issue.code)).toContain("invalid_custom_transition_handoff");
    await writeFile(join(project, "index.html"), source.replace('"animation":"custom:queue-handoff"', '"animation":"custom:unrelated"'));
    expect((await checkVideoComponents(workspace, input)).issues.map(issue => issue.code)).toContain("invalid_custom_transition_handoff");
  });

  test("enforces observable evidence for the five extended narrative patterns", async () => {
    const { root, project } = await fixture();
    const cases = [
      { pattern: "montage", beats: ["Shot one", "Shot two", "Shot three"], extra: "" },
      { pattern: "camera-journey", beats: ["Origin", "Waypoint", "Destination"], extra: "" },
      { pattern: "dialogue", beats: ["Speaker A", "Speaker B"], extra: "" },
      { pattern: "kinetic-type", beats: ["First phrase", "Final phrase"], extra: "" },
      { pattern: "audio-reactive", beats: ["Opening pulse", "Closing pulse"], extra: ` data-ipw-timing-source="music" data-ipw-audio-cues='[{"time":0.4,"strength":0.8},{"time":1.4,"strength":0.6}]'` },
    ];
    for (const item of cases) {
      const duration = item.beats.length;
      const timing = item.pattern === "audio-reactive" ? "" : ' data-ipw-timing-source="visual-cue"';
      const beats = item.beats.map((focus, index) => ({
        start: index,
        end: index + 1,
        intent: `Advance ${focus}`,
        focus,
        action: `Show ${focus}`,
        result: `${focus} is visible`,
        targets: [`#scene-${index}`],
        animation: `custom:${item.pattern}-${index}`,
        motion: { start: index, end: index + 1 },
      }));
      await writeFile(join(project, "index.html"), `<!doctype html><main data-composition-id="main">
        <section id="scene" class="scene clip" data-ipw-scene data-ipw-component-decision="custom:${item.pattern} acceptance fixture" data-motion-pattern="${item.pattern}"${timing}${item.extra} data-ipw-beats='${JSON.stringify(beats)}' data-start="0" data-duration="${duration}" data-track-index="0"></section>
      </main>`);
      const result = await checkVideoComponents({ id: "workspace", path: root }, { sourcePath: "video/session-one/index.html" });
      expect(result.valid).toBe(true);
    }
  });

  test("rejects an audio-reactive label without measured bound cues", async () => {
    const { root, project } = await fixture();
    await writeFile(join(project, "index.html"), `<!doctype html><main data-composition-id="main">
      <section id="signal" class="scene clip" data-ipw-scene data-ipw-component-decision="custom:audio signal visualization" data-motion-pattern="audio-reactive" data-ipw-timing-source="visual-cue" data-ipw-beats='[{"start":0,"end":2,"intent":"Show signal","focus":"Signal","action":"Draw waveform","result":"Signal lands","targets":["#signal"],"animation":"custom:signal-draw","motion":{"start":0,"end":2}}]' data-start="0" data-duration="2" data-track-index="0"></section>
    </main>`);
    const result = await checkVideoComponents({ id: "workspace", path: root }, { sourcePath: "video/session-one/index.html" });
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toContain("audio_reactive_invalid_timing_source");
    expect(result.issues.map(issue => issue.code)).toContain("audio_reactive_missing_cues");
  });
});
