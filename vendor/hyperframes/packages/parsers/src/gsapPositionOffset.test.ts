import { describe, expect, it } from "vitest";
import { parseGsapScriptAcorn } from "./gsapParserAcorn";
import { offsetPositionPathsInScript, syncPositionHoldsBeforeKeyframes } from "./gsapParser";

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
