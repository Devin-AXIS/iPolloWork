// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistryVariable } from "@hyperframes/core/registry";
import { BlockParamsPanel } from "./BlockParamsPanel";
import { PROPERTY_INPUT_DEBOUNCE_MS } from "./propertyPanelPrimitives";

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
    vi.useRealTimers();
    flushSync(() => root.unmount());
    container.remove();
  });

  it("renders component variables with the shared flat Design form controls", () => {
    const onVariableChange = vi.fn(async () => undefined);
    const onBack = vi.fn();
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
          onBack={onBack}
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
    expect(container.textContent).not.toContain("Theme linked");
    expect(container.textContent).not.toContain("VIDEO");
    expect(container.querySelector('[data-save-state="saved"]')?.textContent).toContain("Autosaved");
    expect(container.textContent).not.toContain("AI can edit");
    const backButton = container.querySelector('button[aria-label="Back to components"]');
    if (!(backButton instanceof HTMLButtonElement)) throw new Error("Back button missing");
    expect(container.querySelector('button[aria-label="Close parameters"]')).toBeNull();
    flushSync(() => backButton.click());
    expect(onBack).toHaveBeenCalledTimes(1);

    const gridToggle = container.querySelector('button[role="switch"][aria-label="Show grid"]');
    if (!(gridToggle instanceof HTMLButtonElement)) throw new Error("Grid toggle missing");
    flushSync(() => gridToggle.click());
    expect(onVariableChange).toHaveBeenCalledWith("grid", false);
  });

  it("shows one panel-level save state instead of repeated LIVE labels", async () => {
    let rejectSave: (reason?: unknown) => void = () => undefined;
    const onVariableChange = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    flushSync(() =>
      root.render(
        <BlockParamsPanel
          blockTitle="Route Map"
          params={[]}
          variables={[{ id: "grid", type: "boolean", label: "Show grid", default: true }]}
          variableValues={{}}
          onVariableChange={onVariableChange}
          onBack={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).not.toContain("LIVE");
    const gridToggle = container.querySelector('button[role="switch"][aria-label="Show grid"]');
    if (!(gridToggle instanceof HTMLButtonElement)) throw new Error("Grid toggle missing");
    flushSync(() => gridToggle.click());
    expect(container.querySelector('[data-save-state="saving"]')?.textContent).toContain("Saving");

    rejectSave(new Error("save failed"));
    await vi.waitFor(() => {
      expect(container.querySelector('[data-save-state="error"]')?.textContent).toContain(
        "Save failed",
      );
    });
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
          onBack={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector('[data-component-data-contract="region-value"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-component-data-row]")).toHaveLength(2);
    expect(container.textContent).toContain("2 items");
    expect(container.textContent).toContain("Add item");
    expect(container.querySelectorAll('button[aria-label^="Drag to reorder"]')).toHaveLength(2);
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

  it("debounces live structured data, keeps focus, and submits only the latest draft", () => {
    vi.useFakeTimers();
    const onVariableChange = vi.fn(async () => undefined);
    const variables: RegistryVariable[] = [
      {
        id: "values",
        type: "string",
        label: "State data",
        default: "CA:253.9,TX:112.8",
        maxLength: 2000,
        update: "live",
      },
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
                { id: "region", label: "State", type: "string", role: "id", required: true },
                { id: "value", label: "Value", type: "number", role: "value", required: true },
              ],
              minRows: 1,
              maxRows: 51,
            },
          }}
          onVariableChange={onVariableChange}
          onBack={vi.fn()}
        />,
      ),
    );

    const value = container.querySelector('input[aria-label="Value 1"]');
    if (!(value instanceof HTMLInputElement)) throw new Error("Value input missing");
    const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setInputValue) throw new Error("Input value setter missing");
    flushSync(() => {
      value.focus();
      setInputValue.call(value, "30");
      value.dispatchEvent(new Event("input", { bubbles: true }));
      setInputValue.call(value, "300");
      value.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onVariableChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(value);

    flushSync(() => vi.advanceTimersByTime(PROPERTY_INPUT_DEBOUNCE_MS - 1));
    expect(onVariableChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(value);

    flushSync(() => vi.advanceTimersByTime(1));
    expect(onVariableChange).toHaveBeenCalledWith("values", "CA:300,TX:112.8");
    expect(onVariableChange).toHaveBeenCalledTimes(1);

    flushSync(() => value.blur());
    expect(onVariableChange).toHaveBeenCalledTimes(1);
  });

  it("keeps an incomplete added data row in the form without saving invalid preview data", () => {
    vi.useFakeTimers();
    const onVariableChange = vi.fn(async (_id: string, _value: string | number | boolean) => undefined);
    flushSync(() => root.render(
      <BlockParamsPanel blockTitle="Metrics" params={[]}
        variables={[{ id: "items", type: "string", label: "Items", default: '{"version":1,"kind":"category-value","rows":[]}', update: "live" }]}
        variableValues={{}} visualComponent={{ version: 1, category: "maps", surfaces: ["video"], themeMode: "inherit", data: {
          version: 1, kind: "category-value", mode: "replace", rowId: "label", binding: { variable: "items", encoding: "json" }, minRows: 0, maxRows: 3,
          columns: [{ id: "label", label: "Metric", type: "string", role: "id", required: true }, { id: "value", label: "Value", type: "number", role: "value", required: true }],
        } }} onVariableChange={onVariableChange} onBack={vi.fn()} />
    ));
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add item"))!;
    flushSync(() => add.click());
    expect(container.querySelectorAll("[data-component-data-row]")).toHaveLength(1);
    expect(onVariableChange).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("required");
    const metric = container.querySelector('input[aria-label="Metric 1"]') as HTMLInputElement;
    flushSync(() => {
      metric.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(metric, "中文指标");
      metric.dispatchEvent(new Event("input", { bubbles: true }));
    });
    flushSync(() => vi.advanceTimersByTime(PROPERTY_INPUT_DEBOUNCE_MS));
    expect(onVariableChange).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(onVariableChange.mock.calls[0]![1])).rows).toEqual([{ label: "中文指标", value: 0 }]);
  });

  it("keeps out-of-range numeric drafts editable and saves valid inclusive endpoints", () => {
    vi.useFakeTimers();
    const onVariableChange = vi.fn(async (_id: string, _value: string | number | boolean) => undefined);
    flushSync(() => root.render(
      <BlockParamsPanel blockTitle="Journey" params={[]}
        variables={[{ id: "rows", type: "string", label: "Rows", default: JSON.stringify({ version: 1, kind: "category-value", rows: [{ id: "one", level: .5 }] }), update: "live" }]}
        variableValues={{}} visualComponent={{ version: 1, category: "business", surfaces: ["video"], themeMode: "inherit", data: {
          version: 1, kind: "category-value", mode: "replace", rowId: "id", binding: { variable: "rows", encoding: "json" }, minRows: 1, maxRows: 3,
          columns: [{ id: "id", label: "ID", type: "string", role: "id", required: true }, { id: "level", label: "Level", type: "number", role: "value", required: true, min: 0, max: 1 }],
        } }} onVariableChange={onVariableChange} onBack={vi.fn()} />
    ));
    const input = container.querySelector('input[aria-label="Level 1"]');
    if (!(input instanceof HTMLInputElement)) throw Error("Missing numeric row input");
    expect([input.min, input.max, input.step]).toEqual(["0", "1", "any"]);
    expect(input.title).toBe("Range: 0–1");
    expect(container.textContent).toContain("Level: 0–1");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw Error("Missing input setter");
    const edit = (value: string) => {
      flushSync(() => { input.focus(); setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
      flushSync(() => vi.advanceTimersByTime(PROPERTY_INPUT_DEBOUNCE_MS));
    };
    for (const value of ["1.2", "-0.1"]) {
      edit(value);
      expect(input.value).toBe(value);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("0–1");
      expect(onVariableChange).not.toHaveBeenCalled();
    }
    for (const [index, value] of ["1", "0"].entries()) {
      edit(value);
      expect(input.getAttribute("aria-invalid")).toBe("false");
      expect(onVariableChange).toHaveBeenCalledTimes(index + 1);
      expect(JSON.parse(String(onVariableChange.mock.calls[index]![1])).rows[0].level).toBe(Number(value));
    }
    edit("");
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(onVariableChange).toHaveBeenCalledTimes(2);
  });

  it("rejects overflowing branch drafts without truncating or saving them", () => {
    vi.useFakeTimers();
    const onVariableChange = vi.fn(async () => undefined);
    flushSync(() => root.render(
      <BlockParamsPanel blockTitle="Map" params={[]}
        variables={[{ id: "branches", type: "string", label: "Branches", default: JSON.stringify({ version: 1, kind: "category-value", rows: [{ id: "one", label: "方向", leaves: "甲、乙" }, { id: "two", label: "行动" }] }), update: "live" }]}
        variableValues={{}} visualComponent={{ version: 1, category: "business", surfaces: ["video"], themeMode: "inherit", data: {
          version: 1, kind: "category-value", mode: "replace", rowId: "id", binding: { variable: "branches", encoding: "json" }, minRows: 2, maxRows: 6,
          columns: [{ id: "id", label: "ID", type: "string", role: "id", required: true }, { id: "label", label: "Branch", type: "string", role: "label", required: true, maxLength: 2 }, { id: "leaves", label: "Leaves", type: "string", role: "value", list: { maxItems: 2, itemMaxLength: 2, separators: "、,，\n" } }],
        } }} onVariableChange={onVariableChange} onBack={vi.fn()} />
    ));
    const branch = container.querySelector('input[aria-label="Branch 1"]');
    expect(branch).toBeInstanceOf(HTMLInputElement);
    if (!(branch instanceof HTMLInputElement)) throw Error("Missing branch input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw Error("Missing input setter");
    flushSync(() => {
      branch.focus(); setter.call(branch, "完整内容");
      branch.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(PROPERTY_INPUT_DEBOUNCE_MS);
    });
    expect(branch.value).toBe("完整内容");
    expect(branch.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("2 characters");
    expect(onVariableChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain("2–6");
    expect(container.querySelector('button[aria-label="Remove data row 1"]')).toHaveProperty("disabled", true);
    flushSync(() => {
      setter.call(branch, "创作"); branch.dispatchEvent(new Event("input", { bubbles: true }));
    });
    flushSync(() => vi.advanceTimersByTime(PROPERTY_INPUT_DEBOUNCE_MS));
    expect(onVariableChange).toHaveBeenCalledTimes(1);
  });

  it("does not replace a focused live text draft when an earlier save is acknowledged", () => {
    vi.useFakeTimers();
    const onVariableChange = vi.fn(async () => undefined);
    const variables: RegistryVariable[] = [
      { id: "title", type: "string", label: "Title", default: "Map", update: "live" },
    ];
    const renderPanel = (title?: string) =>
      root.render(
        <BlockParamsPanel
          blockTitle="World Map"
          params={[]}
          variables={variables}
          variableValues={title === undefined ? {} : { title }}
          visualComponent={{
            version: 1,
            category: "maps",
            surfaces: ["video"],
            themeMode: "inherit",
          }}
          onVariableChange={onVariableChange}
          onBack={vi.fn()}
        />,
      );

    flushSync(() => renderPanel());
    const title = container.querySelector('input[aria-label="Title"]');
    if (!(title instanceof HTMLInputElement)) throw new Error("Title input missing");
    const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setInputValue) throw new Error("Input value setter missing");

    flushSync(() => {
      title.focus();
      setInputValue.call(title, "Map A");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    flushSync(() => vi.advanceTimersByTime(PROPERTY_INPUT_DEBOUNCE_MS));
    expect(onVariableChange).toHaveBeenCalledWith("title", "Map A");

    flushSync(() => {
      setInputValue.call(title, "Map AB");
      title.dispatchEvent(new Event("input", { bubbles: true }));
      renderPanel("Map A");
    });
    expect(title.value).toBe("Map AB");
    expect(document.activeElement).toBe(title);

    flushSync(() => vi.advanceTimersByTime(PROPERTY_INPUT_DEBOUNCE_MS));
    expect(onVariableChange).toHaveBeenLastCalledWith("title", "Map AB");
    expect(onVariableChange).toHaveBeenCalledTimes(2);
  });
});
