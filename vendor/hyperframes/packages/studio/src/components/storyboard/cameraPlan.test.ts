import { describe, expect, it } from "vitest";
import { parseCameraPlan, serializeCameraPlan } from "./cameraPlan";

describe("storyboard camera plan", () => {
  it("round-trips a component-owned spatial camera without stacking wrapper presets", () => {
    const value = "component:spatial-camera-suite#depth-layer-moves | Land on the product";
    expect(serializeCameraPlan(parseCameraPlan(value))).toBe(value);
    expect(parseCameraPlan(value).presetIds).toEqual(["component:spatial-camera-suite#depth-layer-moves"]);
  });
  it("round-trips legacy stacked camera actions without losing the saved value", () => {
    const value = serializeCameraPlan({
      presetIds: ["camera.push-in", "camera.focus-travel", "camera.pull-back"],
      note: "Hold the subject centered",
    });

    expect(value).toBe(
      "camera.push-in → camera.focus-travel → camera.pull-back | Hold the subject centered",
    );
    expect(parseCameraPlan(value)).toEqual({
      presetIds: ["camera.push-in", "camera.focus-travel", "camera.pull-back"],
      note: "Hold the subject centered",
    });
  });

  it("serializes one selected movement with an optional camera note", () => {
    expect(
      serializeCameraPlan({ presetIds: ["camera.push-in"], note: "Keep the subject centered" }),
    ).toBe("camera.push-in | Keep the subject centered");
  });

  it("recognizes old catalog labels without losing custom camera directions", () => {
    expect(parseCameraPlan("Spatial glide")).toEqual({
      presetIds: ["camera.oblique-glide"],
      note: "",
    });
    expect(parseCameraPlan("Slow pan left, then settle on the title")).toEqual({
      presetIds: [],
      note: "Slow pan left, then settle on the title",
    });
  });

  it("removes duplicate actions and ignores unknown preset ids when serializing", () => {
    expect(
      serializeCameraPlan({
        presetIds: ["camera.push-in", "camera.push-in", "camera.not-real"],
        note: "",
      }),
    ).toBe("camera.push-in");
  });
});
