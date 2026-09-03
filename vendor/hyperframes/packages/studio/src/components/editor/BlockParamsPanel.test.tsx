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

  it("edits compact component data through normalized rows and derives highlight options", () => {
    const onVariableChange = vi.fn(async () => undefined);
    const variables: RegistryVariable[] = [
      {
        id: "values",
        type: "string",
        label: "State data",
        default: "CA:253.9,TX:112.8",
        maxLength: 2000,
      },
      { id: "highlight", type: "string", label: "Highlight", default: "CA" },
    ];
    flushSync(() =>
      root.render(
        <BlockParamsPanel
          blockTitle="US Map"
          params={[]}
          variables={variables}
          variableValues={{}}
          visualComponent={{
            version: 1,
            category: "maps",
            surfaces: ["video"],
            themeMode: "inherit",
            data: {
              version: 1,
              kind: "region-value",
              mode: "override",
              rowId: "region",
              binding: { variable: "values", encoding: "key-value-list" },
              columns: [
                {
                  id: "region",
                  label: "State code",
                  labelZh: "州代码",
                  type: "string",
                  role: "id",
                  required: true,
                },
                {
                  id: "value",
                  label: "Population density",
                  labelZh: "人口密度",
                  type: "number",
                  role: "value",
                  required: true,
                },
              ],
              minRows: 1,
              maxRows: 51,
              highlightVariable: "highlight",
            },
          }}
          onVariableChange={onVariableChange}
          onClose={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector('[data-component-data-contract="region-value"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-component-data-row]")).toHaveLength(2);
    expect(container.querySelector('button[aria-label="Highlight"]')).not.toBeNull();

    const density = container.querySelector('input[aria-label="Population density 1"]');
    if (!(density instanceof HTMLInputElement)) throw new Error("Density input missing");
    const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setInputValue) throw new Error("Input value setter missing");
    flushSync(() => {
      setInputValue.call(density, "300");
      density.dispatchEvent(new Event("input", { bubbles: true }));
      density.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onVariableChange).toHaveBeenCalledWith("values", "CA:300,TX:112.8");
  });
});
