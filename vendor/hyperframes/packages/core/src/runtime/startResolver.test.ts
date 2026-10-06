import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeStartTimeResolver, resolveCompositionElement } from "./startResolver";

afterEach(() => {
  document.body.innerHTML = "";
});
function fixture(rate = "0.5", trim = "0") {
  document.body.innerHTML = `<main data-composition-id="root" data-duration="40"><section id="scene" data-composition-id="scene" data-start="10" data-duration="20" data-source-duration="10" data-playback-rate="${rate}" data-playback-start="${trim}"><div id="node" data-start="2" data-duration="3"></div><section id="nested" data-composition-id="nested" data-start="4" data-duration="2" data-source-duration="4" data-playback-rate="2"><div id="leaf" data-start="1" data-duration="2"></div></section></section><div id="after" data-start="node + 1" data-duration="1"></div></main>`;
  return createRuntimeStartTimeResolver({ includeAuthoredTimingAttrs: true });
}
describe("composition source clocks", () => {
  it("stretches internal windows while retaining the host display slot", () => {
    const resolver = fixture();
    expect(resolver.resolveStartForElement(document.getElementById("node")!)).toBe(14);
    expect(resolver.resolveDurationForElement(document.getElementById("node")!)).toBe(6);
    expect(resolver.resolveDurationForElement(document.getElementById("scene")!)).toBe(20);
  });
  it("composes nested component rates once", () => {
    const resolver = fixture();
    expect(resolver.resolveStartForElement(document.getElementById("nested")!)).toBe(18);
    expect(resolver.resolveDurationForElement(document.getElementById("nested")!)).toBe(4);
    expect(resolver.resolveStartForElement(document.getElementById("leaf")!)).toBe(19);
    expect(resolver.resolveDurationForElement(document.getElementById("leaf")!)).toBe(2);
  });
  it("preserves a split's source offset instead of replaying its first half", () => {
    const resolver = fixture("0.5", "5");
    expect(resolver.resolveStartForElement(document.getElementById("node")!)).toBe(4);
    expect(resolver.resolveStartForElement(document.getElementById("nested")!)).toBe(8);
  });
  it("resolves end references in the referring node's clock", () => {
    const resolver = fixture();
    expect(resolver.resolveStartForElement(document.getElementById("after")!)).toBe(21);
  });
  it("keeps unretimed legacy compositions unchanged", () => {
    const resolver = fixture("1");
    document.getElementById("nested")!.removeAttribute("data-playback-rate");
    expect(resolver.resolveStartForElement(document.getElementById("node")!)).toBe(12);
    expect(resolver.resolveDurationForElement(document.getElementById("node")!)).toBe(3);
  });
});

 it("resolves a canonical mount behind a prepended sibling's authored inner id", () => {
  document.body.innerHTML = '<main data-composition-id="root"><section data-composition-id="scene-2" data-composition-file="scene.html" data-start="5"><div data-hf-inner-root="true" data-composition-id="scene"></div></section><section id="original" data-composition-id="scene" data-composition-file="scene.html" data-start="0"></section></main>';
  expect(resolveCompositionElement("scene")?.id).toBe("original");
});
