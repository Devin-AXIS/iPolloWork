import { expect, it } from "vitest";
import { getSelectionPolygon, polygonIntersectsRect } from "./marqueeGeometry";

it("selects enclosed clips and edge crossings while excluding a concave lasso's empty corner", () => {
  const lasso = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 30 },
    { x: 30, y: 30 }, { x: 30, y: 100 }, { x: 0, y: 100 }];
  expect(polygonIntersectsRect(lasso, { left: 5, top: 5, width: 10, height: 10 })).toBe(true);
  expect(polygonIntersectsRect(lasso, { left: 20, top: 60, width: 20, height: 20 })).toBe(true);
  expect(polygonIntersectsRect(lasso, { left: 60, top: 60, width: 20, height: 20 })).toBe(false);
  expect(polygonIntersectsRect(lasso, { left: -5, top: -5, width: 110, height: 110 })).toBe(true);
  expect(polygonIntersectsRect(lasso, { left: 130, top: 130, width: 10, height: 10 })).toBe(false);
  expect(polygonIntersectsRect(lasso.slice(0, 2), { left: 5, top: 5, width: 10, height: 10 })).toBe(false);
});

it("rejects clicks and straight drags instead of inventing a box, and preserves the real pen outline", () => {
  expect(getSelectionPolygon([{ x: 5, y: 10 }])).toEqual([]);
  expect(getSelectionPolygon([{ x: 5, y: 10 }, { x: 15, y: 20 }, { x: 25, y: 30 }]))
    .toEqual([]);
  const circle = [{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 20 }];
  expect(getSelectionPolygon(circle)).toEqual(circle);
});
