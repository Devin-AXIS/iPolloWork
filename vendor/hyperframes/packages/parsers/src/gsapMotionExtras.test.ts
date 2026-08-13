import { describe, expect, it } from "vitest";
import { parseGsapScriptAcorn } from "./gsapParserAcorn";
import {
  addAnimationToScript,
  isolateAnimationsForTargetInScript,
  updateAnimationInScript,
} from "./gsapWriterAcorn";

const MOTION_MARKER = 'ipw-motion:v1:{"id":"motion:#title:enter","presetId":"text.enter.rise"}';

function parsedMotionMarker(script: string): unknown {
  return parseGsapScriptAcorn(script).animations[0]?.extras?.data;
}

describe("GSAP semantic motion metadata", () => {
  it("isolates every shared-selector tween without changing its authored payload", () => {
    const script = [
      "const tl = gsap.timeline({ paused: true });",
      'tl.to(".card", { x: 80, duration: 1, repeat: 2 }, 0);',
      'tl.to(".card", { scale: 1.1, duration: 0.4 }, 0.2);',
    ].join("\n");
    const selected = '[data-hf-id="card-two"]';
    const remainder = ':is(.card):not([data-hf-id="card-two"])';

    const isolated = isolateAnimationsForTargetInScript(script, ".card", selected, remainder);
    const animations = parseGsapScriptAcorn(isolated).animations;

    expect(animations.filter((animation) => animation.targetSelector === selected)).toHaveLength(2);
    expect(animations.filter((animation) => animation.targetSelector === remainder)).toHaveLength(
      2,
    );
    expect(isolated).toContain("repeat: 2");
  });

  it("keeps the data marker outside editable properties and preserves it while updating", () => {
    const script = [
      "const tl = gsap.timeline({ paused: true });",
      `tl.to("#title", { opacity: 1, duration: 0.65, ease: "power2.out", data: ${JSON.stringify(MOTION_MARKER)} }, 0.25);`,
    ].join("\n");
    const parsed = parseGsapScriptAcorn(script);
    const animation = parsed.animations[0];

    expect(animation?.properties).toEqual({ opacity: 1 });
    expect(animation?.extras?.data).toBe(`__raw:${JSON.stringify(MOTION_MARKER)}`);

    const updated = updateAnimationInScript(script, animation?.id ?? "", { duration: 1.2 });
    expect(parseGsapScriptAcorn(updated).animations[0]?.duration).toBe(1.2);
    expect(parsedMotionMarker(updated)).toBe(`__raw:${JSON.stringify(MOTION_MARKER)}`);
  });

  it("writes and reparses the data marker when a semantic animation is added", () => {
    const script = "const tl = gsap.timeline({ paused: true });\n";
    const added = addAnimationToScript(script, {
      targetSelector: "#title",
      method: "to",
      position: 0.25,
      properties: { opacity: 1 },
      duration: 0.65,
      ease: "power2.out",
      extras: { data: MOTION_MARKER },
    });

    expect(added.id).not.toBe("");
    expect(parsedMotionMarker(added.script)).toBe(`__raw:${JSON.stringify(MOTION_MARKER)}`);
  });
});
