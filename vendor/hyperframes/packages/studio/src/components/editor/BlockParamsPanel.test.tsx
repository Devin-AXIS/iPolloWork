// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistryVariable } from "@hyperframes/core/registry";
import { BlockParamsPanel } from "./BlockParamsPanel";

const VARIABLES: RegistryVariable[] = [
  {
    id: "title",
    type: "string",
    label: "Title",
    default: "Route",
    placeholder: "Add a title",
    maxLength: 48,
  },
  { id: "accent", type: "color", label: "Accent", default: "#1fbac0" },
  { id: "grid", type: "boolean", label: "Show grid", default: true },
  {
    id: "layout",
    type: "enum",
    label: "Layout",
    default: "arc",
    options: [
      { label: "Arc", value: "arc" },
      { label: "Direct", value: "direct" },
    ],
  },
  {
    id: "speed",
    type: "number",
    label: "Travel speed",
    default: 1,
    min: 0.5,
    max: 2,
    step: 0.1,
    unit: "x",
  },
];

describe("BlockParamsPanel", () => {
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

  it("renders component variables with the shared flat Design form controls", () => {
    const onVariableChange = vi.fn(async () => undefined);
    flushSync(() =>
      root.render(
        <BlockParamsPanel
          blockTitle="Route Map"
          params={[]}
          variables={VARIABLES}
          variableValues={{}}
          visualComponent={{
            version: 1,
            category: "maps",
            surfaces: ["video"],
            themeMode: "inherit",
          }}
          onVariableChange={onVariableChange}
          onClose={vi.fn()}
        />,
      ),
    );

    const title = container.querySelector('input[aria-label="Title"]');
    expect(title).toBeInstanceOf(HTMLInputElement);
    expect(title?.getAttribute("placeholder")).toBe("Add a title");
    expect(title?.getAttribute("maxlength")).toBe("48");
    expect(container.querySelector('[data-flat-toggle="true"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Layout"]')).not.toBeNull();
    expect(container.querySelector('[role="slider"][aria-label="Travel speed"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Pick accent color"]')).not.toBeNull();
    expect(container.querySelector("select")).toBeNull();

    const gridToggle = container.querySelector('button[role="switch"][aria-label="Show grid"]');
    if (!(gridToggle instanceof HTMLButtonElement)) throw new Error("Grid toggle missing");
    flushSync(() => gridToggle.click());
    expect(onVariableChange).toHaveBeenCalledWith("grid", false);
  });
});
