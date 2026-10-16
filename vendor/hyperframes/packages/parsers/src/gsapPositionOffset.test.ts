import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { parseGsapScriptAcorn } from "./gsapParserAcorn";
import { addAnimationToScript, offsetPositionPathsInScript, syncPositionHoldsBeforeKeyframes } from "./gsapParser";

describe("inserting a dragged avatar into a template timeline", () => {
  for (const nested of [
    'if (false) tl.to("#title", { x: 20 });',
    '[0, 1, 2].forEach(i => { if (i) tl.to("#title", { x: i }); });',
    'const add = (selector) => { if (selector) tl.to(selector, { x: 20 }); }; add("#title");',
  ]) {
    it(`inserts once in the timeline scope: ${nested}`, () => {
      const source = `(() => { const tl = gsap.timeline({paused:true}); ${nested} })();`;
      const result = addAnimationToScript(source, { targetSelector: "#avatar", method: "set", properties: { x: 80, y: 25 }, position: 0 });
      const targets: string[] = [];
      const timeline = { to: (selector: string) => targets.push(selector), set: (selector: string) => targets.push(selector) };
      runInNewContext(result.script, { gsap: { timeline: () => timeline } });
      expect(targets.filter(target => target === "#avatar")).toHaveLength(1);
    });
  }
});

describe("offsetPositionPathsInScript", () => {
  it("moves every authored position phase and its base without losing motion metadata", () => {
    const source = [
      "const tl = gsap.timeline({ paused: true });",
      'gsap.set("#title", { x: 10, y: 20 });',
      'tl.to("#title", { keyframes: { "0%": { x: 0, y: 0 }, "100%": { x: 30, y: 10 } }, duration: 1, data: "enter-motion" }, 0);',
      'tl.to("#title", { keyframes: { "0%": { x: 30, y: 10 }, "100%": { x: -10, y: 5 } }, duration: 1, data: "exit-motion" }, 3);',
      'tl.set("#title", { x: 0, y: 0, data: "hf-hold" }, 0);',
    ].join("\n");

    const shifted = syncPositionHoldsBeforeKeyframes(
      offsetPositionPathsInScript(source, "#title", 40, -10),
    );
    const animations = parseGsapScriptAcorn(shifted).animations;
    const base = animations.find((animation) => animation.global);
    const paths = animations.filter((animation) => animation.keyframes);

    expect(base?.properties).toMatchObject({ x: 50, y: 10 });
    expect(paths).toHaveLength(2);
    expect(paths[0]?.keyframes?.keyframes).toEqual([
      { percentage: 0, properties: { x: 40, y: -10 } },
      { percentage: 100, properties: { x: 70, y: 0 } },
    ]);
    expect(paths[1]?.keyframes?.keyframes).toEqual([
      { percentage: 0, properties: { x: 70, y: 0 } },
      { percentage: 100, properties: { x: 30, y: -5 } },
    ]);
    expect(paths.map((animation) => animation.extras?.data)).toEqual([
      '__raw:"enter-motion"',
      '__raw:"exit-motion"',
    ]);
  });

  it("moves every point of an authored GSAP motion path", () => {
    const source = [
      "const tl = gsap.timeline({ paused: true });",
      'tl.to("#orb", { motionPath: { path: [{ x: 0, y: 0 }, { x: 80, y: 40 }], curviness: 1.2 }, duration: 2 }, 0);',
    ].join("\n");

    const shifted = offsetPositionPathsInScript(source, "#orb", 25, 60);
    const path = parseGsapScriptAcorn(shifted).animations.find(
      (animation) => animation.targetSelector === "#orb" && animation.arcPath,
    );

    expect(path?.keyframes?.keyframes).toEqual([
      { percentage: 0, properties: { x: 25, y: 60 } },
      { percentage: 100, properties: { x: 105, y: 100 } },
    ]);
  });
});


it("layout X adds only a static base while preserving Y and manually equal-valued points", () => {
  const source = [
    "const tl = gsap.timeline({ paused: true });",
    'tl.to("#title", { keyframes: { "0%": { y: 100 }, "45%": { y: 35, data: "hf-manual-keyframe" }, "100%": { y: 0 }, easeEach: "power2.out" }, duration: 0.54, data: "authored-motion", ease: "none" }, 1);',
    'tl.to("#peer", { keyframes: { "0%": { x: 20, data: "hf-manual-keyframe" }, "100%": { x: 20, data: "hf-manual-keyframe" } }, duration: 1 }, 2);',
  ].join("\n");
  const before = parseGsapScriptAcorn(source).animations;
  const once = offsetPositionPathsInScript(source, "#title", 100, 0);
  const twice = offsetPositionPathsInScript(once, "#title", 20, 0);
  const after = parseGsapScriptAcorn(twice).animations;
  expect(after.filter(a => a.global)).toHaveLength(1);
  expect(after.find(a => a.global)?.properties).toMatchObject({ x: 120, y: 0 });
  expect(after.filter(a => a.keyframes)).toEqual(before);
  expect(after.find(a => a.targetSelector === "#title" && a.keyframes)?.keyframes?.keyframes.every(k => !("x" in k.properties))).toBe(true);
});


it("layout moves all proven unique aliases with one static base and preserves manual timing", () => {
  const source = [
    'const tl = gsap.timeline({ paused: true });',
    'tl.to("#scene .copy", { keyframes: { "0%": { y: 100 }, "45%": { y: 35, data: "hf-manual-keyframe" }, "100%": { y: 0 }, easeEach: "power2.out" }, duration: 0.54, ease: "none" }, 1);',
    'tl.fromTo(".copy", { y: 0 }, { y: -50, duration: 1, ease: "expo.out" }, 3);',
    'tl.to("#peer", { y: 75, duration: 1 }, 0);',
  ].join("\n");
  const shifted = offsetPositionPathsInScript(source, '[data-hf-id="copy"]', 0, 25, ['#scene .copy', '.copy']);
  const after = parseGsapScriptAcorn(shifted).animations;
  const keys = after.find(a => a.keyframes);
  expect(keys?.keyframes?.keyframes.map(k => [k.percentage, k.properties.y])).toEqual([[0, 125], [45, 60], [100, 25]]);
  expect(keys?.keyframes?.easeEach).toBe("power2.out");
  expect(keys?.position).toBe(1);
  expect(keys?.duration).toBe(0.54);
  expect(keys?.keyframes?.keyframes[1]?.properties.data).toBe("hf-manual-keyframe");
  expect(after.find(a => a.targetSelector === ".copy")?.fromProperties).toEqual({ y: 25 });
  expect(after.find(a => a.targetSelector === ".copy")?.properties.y).toBe(-25);
  expect(after.find(a => a.targetSelector === "#peer")?.properties.y).toBe(75);
  expect(after.filter(a => a.global)).toHaveLength(1);
  expect(after.find(a => a.global)?.properties).toEqual({ x: 0, y: 25 });
});
