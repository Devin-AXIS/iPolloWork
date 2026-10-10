// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CanvasContextMenu } from "./CanvasContextMenu";
import type { DomEditSelection } from "./domEditingTypes";

const cutout = vi.hoisted(() => ({ avatarCutoutProgress: null as number | null, handleAvatarCutout: vi.fn() }));
vi.mock("../../contexts/DomEditContext", () => ({ useDomEditActionsContextOptional: () => cutout }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  cutout.avatarCutoutProgress = null;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
function button(label: string) {
  const match = Array.from(document.querySelectorAll("button")).find(item => (item.getAttribute("aria-label") ?? item.textContent?.trim()) === label);
  if (!match) throw new Error(`Missing menu action: ${label}`);
  return match;
}
async function render(props: Partial<ComponentProps<typeof CanvasContextMenu>> = {}) {
  await act(async () => root.render(<CanvasContextMenu x={10} y={10} selection={null} onClose={() => {}} {...props} />));
}

it("positions the measured menu inside the viewport and keeps it isolated from canvas gestures", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 240, 320));
  const outside = vi.fn();
  await act(async () => root.render(<div onPointerDown={outside}><CanvasContextMenu x={window.innerWidth - 2} y={window.innerHeight - 2} selection={null} onDelete={() => {}} onClose={() => {}} /></div>));
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  expect(menu?.style.left).toBe(`${window.innerWidth - 248}px`);
  expect(menu?.style.top).toBe(`${window.innerHeight - 328}px`);
  expect(menu?.className).toContain("max-h-[calc(100vh-16px)]");
  await act(async () => menu?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  expect(outside).not.toHaveBeenCalled();
});

it("supports keyboard navigation, keyboard activation and restoring focus", async () => {
  const previous = document.createElement("button");
  document.body.append(previous);
  previous.focus();
  const remove = vi.fn(), close = vi.fn();
  await render({ onRename: vi.fn(), onDelete: remove, onClose: close, renameValue: "Current clip" });
  expect(document.activeElement).toBe(button("Rename clip"));
  await act(async () => button("Rename clip").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  expect(document.activeElement).toBe(button("Delete"));
  await act(async () => button("Delete").click());
  expect(remove).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  expect(document.activeElement).toBe(previous);
});

it("runs a mouse action once even when the trailing click follows pointerdown", async () => {
  const remove = vi.fn();
  await render({ onDelete: remove });
  await act(async () => {
    button("Delete").dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true, cancelable: true }));
    button("Delete").dispatchEvent(new MouseEvent("click", { button: 0, detail: 1, bubbles: true }));
  });
  expect(remove).toHaveBeenCalledTimes(1);
});

it("retains rename input on failure and saves through the same keyboard-compatible action", async () => {
  const rename = vi.fn().mockRejectedValueOnce(new Error("conflict")).mockResolvedValue(undefined);
  const close = vi.fn();
  await render({ onRename: rename, renameValue: "Original", onClose: close });
  await act(async () => button("Rename clip").click());
  const input = document.querySelector("input");
  if (!input) throw new Error("Rename input missing");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => { setter?.call(input, "Updated"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => button("Save").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Couldn't rename");
  expect(input.value).toBe("Updated");
  expect(close).not.toHaveBeenCalled();
  await act(async () => button("Save").click());
  expect(rename).toHaveBeenCalledTimes(2);
  expect(rename).toHaveBeenLastCalledWith("Updated");
  expect(close).toHaveBeenCalledTimes(1);
});

it("keeps cutout and both video layer presets actionable without duplicate calls", async () => {
  const container = document.createElement("div");
  container.innerHTML = '<div style="z-index:0"></div><video id="person" style="position:absolute;z-index:2"></video><div style="z-index:4"></div>';
  document.body.append(container);
  const element = container.querySelector("video");
  if (!element) throw new Error("Video missing");
  const selection: DomEditSelection = {
    element, id: "person", label: "Person", tagName: "video", sourceFile: "index.html", compositionPath: "index.html",
    isCompositionHost: false, isInsideLockedComposition: false, boundingBox: { x: 0, y: 0, width: 100, height: 200 },
    textContent: null, dataAttributes: {}, inlineStyles: {}, computedStyles: {}, textFields: [],
    capabilities: { canSelect: true, canEditStyles: true, canCrop: true, canMove: true, canResize: true, canApplyManualOffset: true, canApplyManualSize: true, canApplyManualRotation: true },
  };
  const apply = vi.fn();
  await render({ selection, onApplyZIndex: apply });
  await act(async () => button("Smart cutout").click());
  expect(cutout.handleAvatarCutout).toHaveBeenCalledExactlyOnceWith(selection);
  await act(async () => {
    button("Remove avatar background").dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true, cancelable: true }));
    button("Remove avatar background").dispatchEvent(new MouseEvent("click", { button: 0, detail: 1, bubbles: true }));
  });
  expect(cutout.handleAvatarCutout).toHaveBeenCalledTimes(2);
  expect(cutout.handleAvatarCutout).toHaveBeenLastCalledWith(selection, "remove-background");

  element.setAttribute("data-avatar-original-src", "assets/person.mp4");
  await render({ selection, onApplyZIndex: apply });
  expect(document.body.textContent).not.toContain("Smart cutout");
  await act(async () => button("Restore background").click());
  expect(cutout.handleAvatarCutout).toHaveBeenCalledTimes(3);
  expect(cutout.handleAvatarCutout).toHaveBeenLastCalledWith(selection, "remove-background");

  cutout.avatarCutoutProgress = 50;
  await render({ selection, onApplyZIndex: apply });
  expect(button("AI cutout in progress…").disabled).toBe(true);
  await act(async () => button("AI cutout in progress…").click());
  expect(cutout.handleAvatarCutout).toHaveBeenCalledTimes(3);
  await act(async () => button("Low layer · above background").click());
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0][1]).toBe("send-to-back");
  await act(async () => button("High layer · above content").click());
  expect(apply).toHaveBeenCalledTimes(2);
  expect(apply.mock.calls[1][1]).toBe("bring-to-front");
});
