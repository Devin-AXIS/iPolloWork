import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkVideoComponents, installVideoComponents } from "./video-components.js";

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

  test("accepts a custom scene only when it records a specific reason", async () => {
    const { root, project } = await fixture();
    await writeFile(join(project, "index.html"), `<!doctype html><main data-composition-id="main">
      <section id="map" class="scene clip" data-ipw-scene data-ipw-component-decision="custom:requires a canal-specific geospatial path" data-motion-pattern="path-journey" data-ipw-timing-source="visual-cue" data-ipw-beats='[{"start":0,"end":12,"intent":"Travel along the canal","focus":"Canal route","action":"Grow the route through each stop","result":"Complete route remains visible","targets":["#map"],"animation":"custom:canal-route-growth","motion":{"start":0,"end":12}}]' data-start="0" data-duration="12" data-track-index="0"></section>
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
