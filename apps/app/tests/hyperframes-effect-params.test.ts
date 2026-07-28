import { describe, expect, test } from "bun:test";
import { hyperframesCatalogItemSchema } from "@ipollowork/types/hyperframes";
import {
  hyperframesSelectionPayload,
  updateHyperframesEffectVariableOverride,
} from "../src/app/lib/hyperframes-effect-params";

const item = hyperframesCatalogItemSchema.parse({
  name: "test-effect",
  title: "Test effect",
  description: "Parameter test fixture",
  type: "hyperframes:block",
  category: "effects",
  tags: ["effect"],
  engine: { name: "gsap", version: "3", seekable: true },
  variables: [
    {
      id: "intensity",
      label: "Intensity",
      type: "number",
      default: 1,
      min: 0,
      max: 3,
      step: 0.1,
      update: "live",
    },
    {
      id: "ease",
      label: "Ease",
      type: "enum",
      default: "power2.out",
      options: [
        { label: "Soft", value: "power2.out" },
        { label: "Linear", value: "none" },
      ],
      update: "rebuild",
    },
    {
      id: "backgroundColor",
      label: "Background color",
      type: "color",
      default: "#09090b",
      update: "live",
    },
  ],
});

describe("HyperFrames effect parameter overrides", () => {
  test("clamps numeric values and drops overrides that equal defaults", () => {
    const clamped = updateHyperframesEffectVariableOverride(item, {}, "intensity", 9);
    expect(clamped).toEqual({ intensity: 3 });

    const reset = updateHyperframesEffectVariableOverride(item, clamped, "intensity", 1);
    expect(reset).toEqual({});
  });

  test("rejects malformed color overrides", () => {
    expect(updateHyperframesEffectVariableOverride(item, {}, "backgroundColor", "red")).toEqual({});
    expect(updateHyperframesEffectVariableOverride(item, {}, "backgroundColor", "#123ABC")).toEqual({
      backgroundColor: "#123ABC",
    });
  });

  test("serializes the registry identity with resolved variable values", () => {
    expect(hyperframesSelectionPayload({ item, values: { ease: "none" } })).toEqual({
      registry: "test-effect",
      version: "bundled",
      engine: { name: "gsap", version: "3", seekable: true },
      variables: {
        intensity: 1,
        ease: "none",
        backgroundColor: "#09090b",
      },
    });
  });
});
