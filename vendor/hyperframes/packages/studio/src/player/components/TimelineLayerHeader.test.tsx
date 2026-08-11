// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { TimelineLayerHeader } from "./TimelineLayerHeader";
import { defaultTimelineTheme } from "./timelineTheme";

const element: TimelineElement = {
  id: "opening-title",
  key: "opening-title",
  domId: "opening-title",
  tag: "div",
  label: "Opening title",
  start: 0,
  duration: 2,
  track: 0,
};

const visualStyle = {
  accent: "#20bbc0",
  clip: "#f5f6f9",
  label: "#20262d",
};

describe("TimelineLayerHeader", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("selects the layer and enters inline rename mode on click", async () => {
    const onSelect = vi.fn();
    const onRename = vi.fn(async () => undefined);
    await act(async () => {
      root.render(
        <TimelineLayerHeader
          track={0}
          elements={[element]}
          hidden={false}
          locked={false}
          selected={false}
          expanded={false}
          expandable={false}
          theme={defaultTimelineTheme}
          visualStyle={visualStyle}
          onToggleHidden={vi.fn()}
          onToggleLocked={vi.fn()}
          onSelect={onSelect}
          onRename={onRename}
          onToggleExpanded={vi.fn()}
        />,
      );
    });

    const select = container.querySelector<HTMLElement>(".hf-timeline-layer-header__select");
    await act(async () => select?.click());

    expect(onSelect).toHaveBeenCalledWith(element);
    const input = container.querySelector<HTMLInputElement>(".hf-timeline-layer-header__rename-input");
    expect(input?.value).toBe("Opening title");

    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Renamed layer",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith(element, "Renamed layer");
  });

  it("keeps the editor open when rename persistence fails", async () => {
    const onRename = vi.fn(async () => {
      throw new Error("save failed");
    });
    await act(async () => {
      root.render(
        <TimelineLayerHeader
          track={0}
          elements={[element]}
          hidden={false}
          locked={false}
          selected
          expanded={false}
          expandable={false}
          theme={defaultTimelineTheme}
          visualStyle={visualStyle}
          onToggleHidden={vi.fn()}
          onToggleLocked={vi.fn()}
          onSelect={vi.fn()}
          onRename={onRename}
          onToggleExpanded={vi.fn()}
        />,
      );
    });

    await act(async () =>
      container.querySelector<HTMLElement>(".hf-timeline-layer-header__select")?.click(),
    );
    const input = container.querySelector<HTMLInputElement>(".hf-timeline-layer-header__rename-input");
    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Retry this name",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLInputElement>(".hf-timeline-layer-header__rename-input")?.value)
      .toBe("Retry this name");
  });

  it("cancels the rename without persisting when Escape is pressed", async () => {
    const onRename = vi.fn();
    await act(async () => {
      root.render(
        <TimelineLayerHeader
          track={0}
          elements={[element]}
          hidden={false}
          locked={false}
          selected
          expanded={false}
          expandable={false}
          theme={defaultTimelineTheme}
          visualStyle={visualStyle}
          onToggleHidden={vi.fn()}
          onToggleLocked={vi.fn()}
          onSelect={vi.fn()}
          onRename={onRename}
          onToggleExpanded={vi.fn()}
        />,
      );
    });

    await act(async () =>
      container.querySelector<HTMLElement>(".hf-timeline-layer-header__select")?.click(),
    );
    const input = container.querySelector<HTMLInputElement>(".hf-timeline-layer-header__rename-input");
    await act(async () =>
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );

    expect(onRename).not.toHaveBeenCalled();
    expect(container.querySelector(".hf-timeline-layer-header__rename-input")).toBeNull();
  });
});
