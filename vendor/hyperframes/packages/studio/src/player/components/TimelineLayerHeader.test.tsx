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
  accent: "#1FBAC0",
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

  it("selects the layer without entering rename mode", async () => {
    const onSelect = vi.fn();
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
          gutterWidth={255}
          onToggleHidden={vi.fn()}
          onToggleLocked={vi.fn()}
          onSelect={onSelect}
          onToggleExpanded={vi.fn()}
        />,
      );
    });

    const select = container.querySelector<HTMLElement>(".hf-timeline-layer-header__select");
    await act(async () => select?.click());

    expect(onSelect).toHaveBeenCalledWith(element);
    expect(container.querySelector(".hf-timeline-layer-header__rename-input")).toBeNull();
    expect(container.querySelector(".hf-timeline-layer-header__label")?.textContent).toBe(
      "Opening title",
    );
  });

  it("uses the eye action to request hiding the layer", async () => {
    const onToggleHidden = vi.fn();
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
          gutterWidth={255}
          onToggleHidden={onToggleHidden}
          onToggleLocked={vi.fn()}
          onSelect={vi.fn()}
          onToggleExpanded={vi.fn()}
        />,
      );
    });

    const eye = container.querySelector<HTMLButtonElement>(".hf-timeline-layer-header__visibility");
    expect(eye?.getAttribute("aria-label")).toBe("Hide Opening title");
    await act(async () => eye?.click());
    expect(onToggleHidden).toHaveBeenCalledWith(true);
  });

  it("uses the full layer row as a selection target", async () => {
    const onSelect = vi.fn();
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
          gutterWidth={320}
          onToggleHidden={vi.fn()}
          onToggleLocked={vi.fn()}
          onSelect={onSelect}
          onToggleExpanded={vi.fn()}
        />,
      );
    });

    const row = container.querySelector<HTMLElement>(".hf-timeline-layer-header");
    expect(row?.style.width).toBe("320px");
    await act(async () => row?.click());
    expect(onSelect).toHaveBeenCalledWith(element);
  });
});
