import { createHash } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { attribute, checkVideoComponents, installVideoComponents } from "./video-components.js";
import { z } from "zod";
import { hyperframesEffectVariableSchema, hyperframesMotionRecipeSchema, hyperframesPageCaptureSchema } from "@ipollowork/types/hyperframes";

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

afterEach(async () => {
  if (originalRegistryRoot === undefined) delete process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT;
  else process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT = originalRegistryRoot;
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-video-components-"));
  roots.push(root);
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

describe("Video Studio registry component integration", () => {
  test("rejects reference-only card IDs before writing even the valid selections", async () => {
    const { root, project } = await recipeFixture("question-opener");
    const original = await readFile(join(project, "index.html"), "utf8");
    const error = await installVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html", componentIds: ["question-opener", "depth-layer-moves"],
    }).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "video_recipe_reference_only" });
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
    expect(html).toContain('<p>Preserved</p>');
    expect((html.match(/data-ipw-selected-components=/g) ?? [])).toHaveLength(1);
    expect((await checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html" })).valid).toBe(true);
    expect((await checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", recipesOnly: true })).valid).toBe(true);
    await writeFile(join(project, "index.html"), html.replace('data-ipw-registry-component="question-opener"', 'data-ipw-component-decision="custom:diagram"'));
    expect((await checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html", recipesOnly: true })).issues.map(issue => issue.code)).toContain("recipe_only_scene_required");
    await writeFile(join(project, "index.html"), html.replace('data-composition-id="main"', 'data-composition-id="main" data-ipw-recipe-policy="recipes-only"'));
    expect((await checkVideoComponents({ id: "test", path: root }, { sourcePath: "video/session-one/index.html" })).valid).toBe(true);
    await writeFile(join(project, "index.html"), html.replace('data-composition-id="main"', 'data-composition-id="main" data-ipw-recipe-policy="recipes-only"').replace('data-ipw-registry-component="question-opener"', 'data-ipw-component-decision="custom:diagram"'));
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
      const values = manifest.motionRecipe.usage.example.values;
      expect(Object.keys(values).sort()).toEqual(manifest.variables.filter(variable => variable.id !== "motionCueTimes").map(variable => variable.id).sort());
      expect(Object.keys(manifest.motionRecipe.usage.inputRules).sort()).toEqual(Object.keys(values).sort());
      expect(Object.keys(manifest.motionRecipe.usage.cueBindings).sort()).toEqual(manifest.motionRecipe.events.map(event => event.id).sort());
      const html = await readFile(join(base.registry, name, name + ".html"), "utf8");
      expect(html).toContain('data-ipw-motion-recipe="1"');
      const embedded = html.match(/^ const recipe=(\{.*\});$/m);
      if (embedded?.[1]) {
        const recipe = z.object({ usage: hyperframesMotionRecipeSchema.shape.usage.optional() }).parse(JSON.parse(embedded[1]));
        if (recipe.usage) expect({ name, usage: recipe.usage }).toEqual({ name, usage: manifest.motionRecipe.usage });
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
      if (!capacity) continue;
      const base = await recipeFixture(name);
      await mkdir(join(base.project, "assets"), { recursive: true });
      await writeFile(join(base.project, "assets/evidence.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"/>');
      const example = manifest.motionRecipe.usage.example.values;
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

  test("installs the shared spatial stage with all five seekable shot recipes", async () => {
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

    await writeFile(join(project, "index.html"), host("basic"));
    const invalidRecipe = await checkVideoComponents({ id: "workspace", path: root }, {
      sourcePath: "video/session-one/index.html",
    });
    expect(invalidRecipe.valid).toBe(false);
    expect(invalidRecipe.issues.map(issue => issue.code)).toContain("invalid_spatial_camera_recipe");
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
      expect.objectContaining({ sceneId: "roadmap", code: "scene_still_interval_too_long", action: "apply-motion-preset" }),
      expect.objectContaining({ sceneId: "roadmap", code: "component_motion_ends_too_early", action: "apply-motion-preset" }),
    ]));
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
