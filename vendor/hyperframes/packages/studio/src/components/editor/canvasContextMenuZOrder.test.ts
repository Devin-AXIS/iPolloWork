// @vitest-environment jsdom
import { expect, it } from "vitest";
import { resolveAvatarLowLayer, resolveZOrderChange, readEffectiveZIndex } from "./canvasContextMenuZOrder";

it("keeps the person above backgrounds, below content, and can raise it again", () => {
  const root = document.createElement("div");
  root.innerHTML = '<div id="background" style="z-index:9"></div><div id="title" style="z-index:80"></div><video id="avatar" style="z-index:100"></video><div id="caption" style="z-index:300"></div><audio></audio>';
  const person = root.querySelector("video")!;
  for (const patch of resolveAvatarLowLayer(person)) patch.element.style.zIndex = String(patch.zIndex);
  const background = root.querySelector<HTMLElement>("#background")!;
  const title = root.querySelector<HTMLElement>("#title")!;
  const caption = root.querySelector<HTMLElement>("#caption")!;
  expect(readEffectiveZIndex(background)).toBeLessThan(readEffectiveZIndex(person));
  expect(readEffectiveZIndex(person)).toBeLessThan(readEffectiveZIndex(title));
  expect(readEffectiveZIndex(title)).toBeLessThan(readEffectiveZIndex(caption));
  expect(root.querySelector("audio")!.style.zIndex).toBe("");
  for (const patch of resolveZOrderChange(person, "bring-to-front") ?? []) patch.element.style.zIndex = String(patch.zIndex);
  expect(readEffectiveZIndex(person)).toBeGreaterThan(readEffectiveZIndex(caption));
});
