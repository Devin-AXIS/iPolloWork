import { expect, test } from "bun:test";

import {
  buildGradientPresets,
  parseLinearGradient,
  serializeLinearGradient,
} from "../src/react-app/domains/session/design/design-gradient-picker";

test("parses and serializes editable two-stop gradients with opacity", () => {
  const gradient = parseLinearGradient("linear-gradient(135deg, rgba(10, 20, 30, 0.5) 10%, #abcdef 90%)");

  expect(gradient.angle).toBe(135);
  expect(gradient.stops[0].position).toBe(10);
  expect(gradient.stops[0].color.alpha).toBe(0.5);
  expect(gradient.stops[1].position).toBe(90);
  expect(serializeLinearGradient(gradient)).toBe("linear-gradient(135deg, rgba(10, 20, 30, 0.5) 10%, #abcdef 90%)");
});

test("builds six complete gradient presets from theme and current background colors", () => {
  const current = parseLinearGradient("linear-gradient(90deg, #010203 0%, #040506 100%)");
  const presets = buildGradientPresets([
    "#112233",
    "#445566",
    "#778899",
    "#f0f1f2",
    "#ffffff",
    "#ddeeff",
  ], current);

  expect(presets).toHaveLength(6);
  expect(serializeLinearGradient(presets[0])).toBe("linear-gradient(90deg, #112233 0%, #445566 100%)");
  expect(serializeLinearGradient(presets[5])).toBe("linear-gradient(90deg, #f0f1f2 0%, #778899 100%)");
});
