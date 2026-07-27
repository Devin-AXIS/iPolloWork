import { describe, expect, test } from "bun:test";

import { toggleTransformScale } from "../src/react-app/domains/session/design/design-transform";

describe("toggleTransformScale", () => {
  test("adds then removes a horizontal mirror", () => {
    expect(toggleTransformScale("", "x")).toBe("scaleX(-1)");
    expect(toggleTransformScale("scaleX(-1)", "x")).toBe("none");
  });

  test("preserves rotation and the other mirror axis when toggling", () => {
    expect(toggleTransformScale("rotate(45deg) scaleY(-1)", "x")).toBe("rotate(45deg) scaleY(-1) scaleX(-1)");
    expect(toggleTransformScale("rotate(45deg) scaleY(-1) scaleX(-1)", "x")).toBe("rotate(45deg) scaleY(-1)");
  });
});
