import { describe, expect, it } from "vitest";

import { GSAP_OFFICIAL_CAPABILITIES, resolveRegistryItemKind } from "./index";

describe("GSAP official capability baseline", () => {
  it("tracks the official 19 plugins and 6 ease extensions separately", () => {
    expect(
      GSAP_OFFICIAL_CAPABILITIES.filter((capability) => capability.kind === "plugin"),
    ).toHaveLength(19);
    expect(
      GSAP_OFFICIAL_CAPABILITIES.filter((capability) => capability.kind === "ease"),
    ).toHaveLength(6);
  });

  it("marks workflow-only capabilities as tools", () => {
    const tools = GSAP_OFFICIAL_CAPABILITIES.filter((capability) => capability.role === "tool").map(
      (capability) => capability.runtimeName,
    );

    expect(tools).toEqual(["MotionPathHelper", "GSDevTools"]);
  });
});

describe("resolveRegistryItemKind", () => {
  it("keeps an explicit registry kind", () => {
    expect(
      resolveRegistryItemKind({
        type: "hyperframes:block",
        kind: "animation",
        tags: ["effect"],
      }),
    ).toBe("animation");
  });

  it("infers legacy effect entries from their tags", () => {
    expect(
      resolveRegistryItemKind({
        type: "hyperframes:block",
        tags: ["showcase", "scroll-trigger", "effect"],
      }),
    ).toBe("effect");
  });
});
