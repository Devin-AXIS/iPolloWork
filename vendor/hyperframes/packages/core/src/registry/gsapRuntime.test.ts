import { describe, expect, it } from "vitest";
import { resolveGsapRegistryItemEngine } from "./gsapRuntime.js";

describe("resolveGsapRegistryItemEngine", () => {
  it("detects the runtime, version, plugins, and seek contract for legacy items", () => {
    expect(
      resolveGsapRegistryItemEngine(
        {},
        [
          '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>',
          "gsap.registerPlugin(ScrollTrigger); const tl = gsap.timeline({ paused: true });",
          'window.addEventListener("hf-seek", () => tl.pause());',
        ],
      ),
    ).toEqual({
      name: "gsap",
      version: "3.14.2",
      seekable: true,
      plugins: ["ScrollTrigger"],
    });
  });

  it("preserves an explicit manifest engine", () => {
    const engine = {
      name: "gsap",
      version: "3.15.0",
      seekable: true,
      plugins: ["CustomWiggle"],
    };
    expect(resolveGsapRegistryItemEngine({ engine }, ["plain html"])).toBe(engine);
  });

  it("does not classify non-GSAP components", () => {
    expect(resolveGsapRegistryItemEngine({}, ["transition: opacity 200ms ease"])).toBeUndefined();
  });
});
