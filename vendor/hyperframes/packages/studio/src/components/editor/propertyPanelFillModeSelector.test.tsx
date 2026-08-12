// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitElementBackgroundImage,
  ImageFillField,
  isThemeBackgroundSurface,
  resolveEditableBackgroundImage,
  syncLegacyThemeBackgroundPreview,
  toRelativeProjectAssetPath,
} from "./propertyPanelFill";
import { FillModeSelector } from "./propertyPanelFlatStyleSections";

describe("FillModeSelector", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  it("uses the selected Figma asset and reports a fill mode change", () => {
    const onChange = vi.fn();
    flushSync(() =>
      root.render(<FillModeSelector value="Solid" disabled={false} onChange={onChange} />),
    );

    const solid = container.querySelector('[aria-label="Solid color"]');
    const gradient = container.querySelector('[aria-label="Gradient"]');
    if (!(solid instanceof HTMLButtonElement) || !(gradient instanceof HTMLButtonElement)) {
      throw new Error("Fill controls were not rendered");
    }

    expect(solid.getAttribute("aria-pressed")).toBe("true");
    const solidIcon = solid.querySelector("img")?.getAttribute("src") ?? "";
    const gradientIcon = gradient.querySelector("img")?.getAttribute("src") ?? "";
    expect(decodeURIComponent(solidIcon)).toContain("fill='white'");
    expect(decodeURIComponent(gradientIcon)).toContain("stroke='#858A94'");
    expect(gradient.getAttribute("aria-pressed")).toBe("false");

    gradient.click();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("Gradient");
  });

  it("disables all fill controls and suppresses interaction", () => {
    const onChange = vi.fn();
    flushSync(() => root.render(<FillModeSelector value="None" disabled onChange={onChange} />));

    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(4);
    expect(buttons.every((button) => button.disabled)).toBe(true);

    buttons[1]?.click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the image-picker action legible over light and dark thumbnails", () => {
    flushSync(() =>
      root.render(
        <ImageFillField
          flat
          projectId="project-1"
          sourceFile="index.html"
          value='url("assets/cover.png")'
          assets={["assets/cover.png"]}
          onCommit={vi.fn()}
          onImportAssets={vi.fn()}
        />,
      ),
    );

    const action = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Choose Media"),
    );
    if (!(action instanceof HTMLButtonElement)) throw new Error("Image picker action missing");
    expect(action.className).toContain("border-black/80");
    expect(action.className).toContain("bg-white");
    expect(action.className).toContain("text-black");
  });

  it("writes an asset path relative to a nested composition", () => {
    expect(
      toRelativeProjectAssetPath(
        "compositions/effects/effect-ending-douyin-follow.html",
        "assets/fill.png",
      ),
    ).toBe("../../assets/fill.png");
    expect(toRelativeProjectAssetPath("index.html", "assets/fill.png")).toBe("assets/fill.png");
  });

  it("routes a full-frame composition fill through the theme image token", async () => {
    const element = document.createElement("div");
    element.dataset.compositionId = "ending";
    element.dataset.compositionSrc = "compositions/ending.html";
    const onSetStyle = vi.fn(async () => undefined);

    expect(isThemeBackgroundSurface(element)).toBe(true);
    await commitElementBackgroundImage(element, 'url("assets/cover.png")', onSetStyle);

    expect(element.style.getPropertyValue("--ipw-bg-image")).toBe('url("assets/cover.png")');
    expect(onSetStyle.mock.calls).toEqual([
      ["--ipw-bg-image", 'url("assets/cover.png")'],
      ["background-image", 'url("assets/cover.png")'],
    ]);
  });

  it("keeps ordinary element fills on the direct background property", async () => {
    const element = document.createElement("div");
    const onSetStyle = vi.fn(async () => undefined);

    expect(isThemeBackgroundSurface(element)).toBe(false);
    await commitElementBackgroundImage(element, "linear-gradient(red, blue)", onSetStyle);

    expect(element.style.getPropertyValue("--ipw-bg-image")).toBe("");
    expect(onSetStyle).toHaveBeenCalledOnce();
    expect(onSetStyle).toHaveBeenCalledWith("background-image", "linear-gradient(red, blue)");
  });

  it("prefers an authored image over the theme's computed gradient layers", () => {
    const element = document.createElement("div");
    element.style.backgroundImage = 'url("cover.png")';

    expect(
      resolveEditableBackgroundImage(element, {
        "background-image": "linear-gradient(transparent, transparent), none, none",
        "--ipw-bg-image": "none",
      }),
    ).toBe('url("cover.png")');

    element.style.setProperty("--ipw-bg-image", 'url("theme-cover.png")');
    expect(resolveEditableBackgroundImage(element, {})).toBe('url("theme-cover.png")');
  });

  it("shows legacy full-frame image fills without writing the project", () => {
    const element = document.createElement("div");
    element.dataset.compositionId = "ending";
    element.dataset.compositionSrc = "compositions/ending.html";
    element.style.backgroundImage = 'url("legacy-cover.png")';

    expect(syncLegacyThemeBackgroundPreview(element)).toBe(true);
    expect(element.style.getPropertyValue("--ipw-bg-image")).toBe('url("legacy-cover.png")');
    expect(syncLegacyThemeBackgroundPreview(element)).toBe(false);
  });
});
