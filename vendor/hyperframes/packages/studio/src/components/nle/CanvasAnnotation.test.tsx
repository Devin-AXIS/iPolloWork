// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePlayerStore } from "../../player";
import { CanvasAnnotation } from "./CanvasAnnotation";

const context = vi.hoisted(() => ({
  projectId: "project-one",
  showToast: vi.fn(),
  deliver: vi.fn().mockResolvedValue(true),
  iframe: { current: document.createElement("iframe") },
}));
vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({
    projectId: context.projectId,
    activeCompPath: "scenes/current.html",
    compositionDimensions: { width: 1280, height: 720 },
    previewIframeRef: context.iframe,
    showToast: context.showToast,
  }),
}));
vi.mock("../editor/domEditingAgentPrompt", () => ({
  deliverStudioAgentPrompt: context.deliver,
}));
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  vi.clearAllMocks();
  context.deliver.mockReset().mockResolvedValue(true);
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function startDrawing() {
  const host = document.createElement("div");
  document.body.append(host);
  const iframe = document.createElement("iframe");
  context.iframe.current = iframe;
  vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue(
    new DOMRect(100, 50, 400, 200),
  );
  usePlayerStore.setState({
    currentTime: 2,
    elements: [
      { id: "visible", tag: "div", start: 0, duration: 4, track: 1 },
      { id: "unrelated", tag: "div", start: 5, duration: 1, track: 2 },
    ],
  });
  const root = createRoot(host);
  await act(async () => root.render(<CanvasAnnotation />));
  await act(async () => host.querySelector("button")?.click());
  const svg = host.querySelector("svg[viewBox='0 0 100 100']");
  if (!(svg instanceof SVGSVGElement))
    throw new Error("drawing canvas missing");
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 600, 300),
  );
  svg.setPointerCapture = vi.fn();
  svg.hasPointerCapture = () => false;
  await act(async () => {
    svg.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 100,
      }),
    );
  });
  await act(async () => {
    svg.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 1,
        clientX: 400,
        clientY: 200,
      }),
    );
    svg.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }),
    );
  });
  expect(host.querySelector("input")).toBeNull();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(context.deliver).not.toHaveBeenCalled();
  const submit = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Copy prompt",
  );
  if (!submit) throw new Error("AI submit missing");
  return { root, host, submit };
}

it("maps the drawn region into the actual frame, excluding letterbox margins and unrelated clips", async () => {
  const { root, submit } = await startDrawing();
  await act(async () => submit?.click());
  const prompt = context.deliver.mock.calls[0]?.[0];
  expect(prompt).toContain('"x":12.5');
  expect(prompt).toContain('"y":25');
  expect(prompt).toContain('"width":62.5');
  expect(prompt).toContain('"height":50');
  expect(prompt).toContain("visible");
  expect(prompt).not.toContain("unrelated");
  expect(context.deliver.mock.calls[0]?.[1]).toBe("scenes/current.html");
  expect(context.deliver.mock.calls[0]?.[2]).toEqual({ instruction: "修改圈画区域中的内容" });
  expect(usePlayerStore.getState().isPlaying).toBe(false);
  await act(async () => root.unmount());
});

it("retains a rejected annotation and shares the pending, duplicate protection and retry interaction", async () => {
  const { root, host, submit } = await startDrawing();
  const input = document.querySelector("textarea");
  if (!input) throw new Error("Annotation input missing");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, "把圈出的文案提亮");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  let rejectRequest: (error: Error) => void = () => {};
  context.deliver.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
  await act(async () => {
    submit.click();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  });
  expect(context.deliver).toHaveBeenCalledOnce();
  expect(submit.textContent).toBe("Sending…");
  expect(submit.disabled).toBe(true);
  expect(input.disabled).toBe(true);
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector('[data-testid="canvas-annotation"]')).not.toBeNull();
  await act(async () => rejectRequest(new Error("左侧 AI 对话未确认接收")));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("左侧 AI 对话未确认接收");
  expect(input.value).toBe("把圈出的文案提亮");
  expect(host.querySelector("polyline")?.getAttribute("points")).not.toBe("");
  expect(context.showToast).not.toHaveBeenCalled();
  await act(async () => submit.click());
  expect(context.deliver).toHaveBeenCalledTimes(2);
  expect(context.deliver.mock.calls[1]?.[2]).toEqual({ instruction: "把圈出的文案提亮" });
  expect(host.querySelector('[data-testid="canvas-annotation"]')).toBeNull();
  await act(async () => root.unmount());
});

it("Escape cancels a draft without delivering a request", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<CanvasAnnotation />));
  await act(async () => host.querySelector("button")?.click());
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  expect(host.querySelector('[data-testid="canvas-annotation"]')).toBeNull();
  expect(context.deliver).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it("cancels a draft on seeking or project changes, so it cannot target a stale frame", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  usePlayerStore.setState({ currentTime: 2 });
  await act(async () => root.render(<CanvasAnnotation />));
  await act(async () => host.querySelector("button")?.click());
  expect(host.querySelector('[data-testid="canvas-annotation"]')).not.toBeNull();
  await act(async () => usePlayerStore.getState().setCurrentTime(3));
  expect(host.querySelector('[data-testid="canvas-annotation"]')).toBeNull();
  await act(async () => host.querySelector("button")?.click());
  context.projectId = "project-two";
  await act(async () => root.render(<CanvasAnnotation />));
  expect(host.querySelector('[data-testid="canvas-annotation"]')).toBeNull();
  expect(context.deliver).not.toHaveBeenCalled();
  context.projectId = "project-one";
  await act(async () => root.unmount());
});
