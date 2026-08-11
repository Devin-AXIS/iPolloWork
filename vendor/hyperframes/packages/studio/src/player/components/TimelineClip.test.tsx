// @vitest-environment happy-dom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { TimelineClip } from "./TimelineClip";

const capabilities = {
  canMove: true,
  canTrimStart: true,
  canTrimEnd: true,
  status: "editable" as const,
};

const visualStyle = {
  clip: "#f5f6f9",
  label: "#20262d",
  accent: "#20bbc0",
  border: "#cccccc",
};

const baseElement: TimelineElement = {
  id: "scene-title",
  key: "scene-title",
  tag: "div",
  label: "Scene Title",
  start: 0,
  duration: 1,
  track: 0,
  domId: "scene-title",
};

function renderTimelineClip(
  container: HTMLElement,
  input: {
    widthPx: number;
    selected?: boolean;
    customContent?: boolean;
  },
) {
  const root = createRoot(container);
  const noop = vi.fn();
  flushSync(() =>
    root.render(
      <TimelineClip
        el={{ ...baseElement, duration: input.widthPx / 100 }}
        pps={100}
        clipY={3}
        isSelected={input.selected ?? false}
        isHovered={false}
        hasCustomContent={input.customContent ?? false}
        capabilities={capabilities}
        visualStyle={visualStyle}
        isComposition={false}
        onHoverStart={noop}
        onHoverEnd={noop}
        onResizeStart={noop}
        onPointerDown={noop}
        onClick={noop}
        onDoubleClick={noop}
      >
        {input.customContent ? <div className="hf-timeline-clip-content">Scene Title</div> : null}
      </TimelineClip>,
    ),
  );
  return root;
}

describe("TimelineClip", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = null;
  });

  afterEach(() => {
    if (root) flushSync(() => root?.unmount());
    container.remove();
  });

  it("marks micro clips by rendered width instead of custom content presence", () => {
    root = renderTimelineClip(container, { widthPx: 120, customContent: true });

    const clip = container.querySelector("[data-clip]");
    expect(clip?.classList.contains("is-micro")).toBe(false);
  });

  it("does not force labels into selected micro clips", () => {
    root = renderTimelineClip(container, { widthPx: 16, selected: true });

    const clip = container.querySelector("[data-clip]");
    expect(clip?.classList.contains("is-micro")).toBe(true);
    expect(container.querySelector(".timeline-clip__label")).toBeNull();
    expect(container.querySelector(".timeline-clip__timecode")).toBeNull();
  });
});
