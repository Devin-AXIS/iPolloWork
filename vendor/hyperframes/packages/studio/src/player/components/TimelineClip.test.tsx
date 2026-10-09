// @vitest-environment happy-dom

import { act } from "react";
import { TimelineEditProvider } from "../../contexts/TimelineEditContext";
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
  accent: "#1FBAC0",
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
    animationContent?: React.ReactNode;
    element?: TimelineElement;
    callbacks?: import("./timelineCallbacks").TimelineEditCallbacks;
  },
) {
  const root = createRoot(container);
  const noop = vi.fn();
  flushSync(() =>
    root.render(
      <TimelineEditProvider value={input.callbacks ?? {}}>
        <TimelineClip
          el={{
            ...baseElement,
            ...input.element,
            duration: input.widthPx / 100,
          }}
          pps={100}
          clipY={3}
          isSelected={input.selected ?? false}
          isHovered={false}
          hasCustomContent={input.customContent ?? false}
          hasAnimationRow={input.animationContent !== undefined}
          animationContent={input.animationContent}
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
          {input.customContent ? (
            <div className="hf-timeline-clip-content">Scene Title</div>
          ) : null}
        </TimelineClip>
      </TimelineEditProvider>,
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

  it("folds only the Visual row, preserving the owner clip and its contents", async () => {
    root = renderTimelineClip(container, {
      widthPx: 200, customContent: true,
      animationContent: <span data-testid="native-animation">Native diamond</span>,
    });
    const toggle = container.querySelector('button[aria-expanded]');
    if (!(toggle instanceof HTMLButtonElement)) throw new Error("Visual disclosure missing");
    const clip = container.querySelector('[data-clip]');
    expect(container.querySelector('[data-testid="native-animation"]')).not.toBeNull();
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-testid="native-animation"]')).toBeNull();
    expect(container.querySelector('[data-testid="timeline-visual-row"]')).toBeNull();
    expect(container.querySelector('[data-clip]')).toBe(clip);
    expect(container.querySelector('.hf-timeline-clip-content')?.textContent).toBe("Scene Title");
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-testid="native-animation"]')).not.toBeNull();
  });

  it("does not force labels into selected micro clips", () => {
    root = renderTimelineClip(container, { widthPx: 16, selected: true });

    const clip = container.querySelector("[data-clip]");
    expect(clip?.classList.contains("is-micro")).toBe(true);
    expect(container.querySelector(".timeline-clip__label")).toBeNull();
    expect(container.querySelector(".timeline-clip__timecode")).toBeNull();
  });
  it("previews clip gain, persists on blur and discards Escape edits", async () => {
    const callbacks = {
      onSetElementAttributeLive: vi.fn(),
      onSetElementAttributeQuiet: vi.fn().mockResolvedValue(undefined),
      onRevertElementAttributeLive: vi.fn(),
    };
    const element = { ...baseElement, tag: "audio", volume: 0.7, duration: 2 };
    root = renderTimelineClip(container, {
      widthPx: 200,
      selected: true,
      element,
      callbacks,
    });
    const input = container.querySelector("input");
    if (!input) throw new Error("clip volume is missing");
    const setValue = (value: string) => {
      Reflect.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      setValue("45");
    });
    expect(callbacks.onSetElementAttributeLive).toHaveBeenLastCalledWith(
      element,
      "data-volume",
      "0.45",
    );
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(callbacks.onSetElementAttributeQuiet).toHaveBeenCalledWith(
      element,
      "data-volume",
      "0.45",
      "Change clip volume",
    );
    callbacks.onSetElementAttributeQuiet.mockClear();
    await act(async () => {
      setValue("90");
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(callbacks.onRevertElementAttributeLive).toHaveBeenCalledWith(
      element,
      "data-volume",
    );
    expect(input.value).toBe("70");
    expect(callbacks.onSetElementAttributeQuiet).not.toHaveBeenCalled();
  });
});
