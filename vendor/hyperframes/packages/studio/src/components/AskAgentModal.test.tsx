// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AskAgentModal } from "./AskAgentModal";
import { PreviewTextSelectionToolbar } from "./nle/PreviewTextSelectionToolbar";
import { EditPopover } from "../player/components/EditModal";
import { BlocksTab } from "./sidebar/BlocksTab";
import { useAskAgentModal } from "../hooks/useAskAgentModal";
import { usePlayerStore } from "../player";
import type { DomEditSelection } from "./editor/domEditingTypes";

const bridge = vi.hoisted(() => ({
  deliver: vi.fn().mockResolvedValue(true),
  copy: vi.fn().mockResolvedValue(true),
  showToast: vi.fn(),
  askAgent: () => {},
}));
vi.mock("./editor/domEditingAgentPrompt", async (importOriginal) => ({
  ...await importOriginal<typeof import("./editor/domEditingAgentPrompt")>(),
  deliverStudioAgentPrompt: bridge.deliver,
}));
vi.mock("../utils/clipboard", () => ({ copyTextToClipboard: bridge.copy }));
vi.mock("../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({
    projectId: "video-one", activeCompPath: "scenes/current.html", showToast: bridge.showToast,
  }),
  useStudioPlaybackContext: () => ({ compositionLoading: false }),
}));
vi.mock("../contexts/DomEditContext", () => ({
  useDomEditActionsContext: () => ({ handleAskAgent: bridge.askAgent }),
}));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  bridge.deliver.mockResolvedValue(true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((item) =>
    item.textContent === label || item.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function textarea(): HTMLTextAreaElement {
  const input = document.querySelector("textarea");
  if (!input) throw new Error("Instruction input missing");
  return input;
}
async function fill(value: string) {
  const input = textarea();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("waits for acceptance, blocks duplicate shortcuts and closing, and preserves a rejected draft for retry", async () => {
  let rejectRequest: (error: Error) => void = () => {};
  const submit = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectRequest = reject; })).mockResolvedValue(undefined);
  const close = vi.fn();
  await act(async () => root.render(<AskAgentModal selectionLabel="Title" onSubmit={submit} onClose={close} />));
  expect(button("Copy prompt").disabled).toBe(true);
  await fill("  标题改成蓝色  ");
  await act(async () => {
    textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  });
  expect(submit).toHaveBeenCalledExactlyOnceWith("标题改成蓝色");
  expect(button("Sending…").disabled).toBe(true);
  expect(textarea().disabled).toBe(true);
  await act(async () => {
    button("Close").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.querySelector('[role="dialog"]')?.parentElement?.click();
  });
  expect(close).not.toHaveBeenCalled();
  await act(async () => rejectRequest(new Error("当前对话发送失败")));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("当前对话发送失败");
  expect(textarea().value).toBe("  标题改成蓝色  ");
  expect(button("Copy prompt").disabled).toBe(false);
  await act(async () => button("Copy prompt").click());
  expect(submit).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it("keeps explicit instruction copying separate from sending", async () => {
  const submit = vi.fn();
  await act(async () => root.render(<AskAgentModal selectionLabel="00:01 — 00:03" copyInstruction onSubmit={submit} onClose={() => {}} />));
  await fill("  调整这段画面  ");
  await act(async () => button("Copy Prompt").click());
  expect(bridge.copy).toHaveBeenCalledExactlyOnceWith("调整这段画面");
  expect(submit).not.toHaveBeenCalled();
  expect(button("Copied")).toBeDefined();
  expect(textarea().value).toBe("  调整这段画面  ");
});

it("does not forward dialog clicks to the underlying canvas or timeline and keeps a dirty draft", async () => {
  const clickThrough = vi.fn();
  const close = vi.fn();
  await act(async () => root.render(<div onClick={clickThrough} onPointerDown={clickThrough} onMouseDown={clickThrough}>
    <AskAgentModal selectionLabel="Title" onSubmit={() => {}} onClose={close} />
  </div>));
  await fill("尚未发送的修改要求");
  const backdrop = document.querySelector('[role="dialog"]')?.parentElement;
  await act(async () => {
    backdrop?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    backdrop?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    backdrop?.click();
  });
  expect(clickThrough).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(textarea().value).toBe("尚未发送的修改要求");
});

it("uses the same dialog for a timeline range and carries only its overlapping clips", async () => {
  usePlayerStore.setState({ elements: [
    { id: "inside", tag: "div", start: 1, duration: 2, track: 1 },
    { id: "outside", tag: "div", start: 8, duration: 1, track: 2 },
  ] });
  const close = vi.fn();
  await act(async () => root.render(<EditPopover rangeStart={3} rangeEnd={1} anchorX={20} anchorY={20} onClose={close} />));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await fill("这段画面提亮");
  bridge.deliver.mockRejectedValueOnce(new Error("左侧对话拒绝接收"));
  await act(async () => button("Copy prompt").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("左侧对话拒绝接收");
  expect(close).not.toHaveBeenCalled();
  await act(async () => button("Copy prompt").click());
  const [prompt, file, options] = bridge.deliver.mock.calls[1];
  expect(prompt).toContain("inside");
  expect(prompt).not.toContain("#outside");
  expect(file).toBe("scenes/current.html");
  expect(options).toEqual({ instruction: "这段画面提亮", requireCompleteContext: true });
  expect(close).toHaveBeenCalledOnce();
  expect(bridge.showToast).toHaveBeenCalledExactlyOnceWith("已复制提示词", "info");
});

it("preserves the existing default range instruction for an empty request", async () => {
  await act(async () => root.render(<EditPopover rangeStart={1} rangeEnd={3} anchorX={20} anchorY={20} onClose={() => {}} />));
  await act(async () => button("Copy prompt").click());
  expect(bridge.deliver.mock.calls[0]?.[2]).toEqual({ instruction: "修改选定时间范围内的视频内容", requireCompleteContext: true });
});

it("sends only selected clips, excluding simultaneous unselected tracks, without changing their timing", async () => {
  const selected = { id: "selected-title", tag: "div", label: "标题", start: 1.25, duration: 2.5, track: 1 };
  const unselected = { id: "unselected-audio", tag: "audio", start: 0, duration: 10, track: 2 };
  usePlayerStore.setState({ elements: [selected, unselected] });
  const before = JSON.stringify(usePlayerStore.getState().elements);
  await act(async () => root.render(<EditPopover rangeStart={1.25} rangeEnd={3.75} selectedElements={[selected]} onClose={() => {}} />));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("选中片段 · 标题");
  await fill("只放大选中的标题");
  await act(async () => button("Copy prompt").click());
  const [prompt, file, options] = bridge.deliver.mock.calls[0];
  expect(prompt).toContain("#selected-title");
  expect(prompt).not.toContain("unselected-audio");
  expect(prompt).toContain("Exact range (seconds): 1.250 - 3.750");
  expect(file).toBe("scenes/current.html");
  expect(options).toEqual({ instruction: "只放大选中的标题", requireCompleteContext: true });
  expect(JSON.stringify(usePlayerStore.getState().elements)).toBe(before);
});

it.each<["clip-range" | "timeline-lasso"]>([["clip-range"], ["timeline-lasso"]])("sends exact %s context with nested source timing and no simultaneous unrelated clip", async (selectionKind) => {
  const selected = { id: "nested-title", key: "host/title", hfId: "title-stable", selector: "#title", sourceFile: "scenes/intro.html",
    tag: "div", start: 11, duration: 4, track: 8, expandedParentStart: 10 };
  usePlayerStore.setState({ elements: [selected, { id: "other", tag: "audio", start: 0, duration: 30, track: 2 }] });
  await act(async () => root.render(<EditPopover rangeStart={12} rangeEnd={13.5} selectedElements={[selected]} selectionKind={selectionKind} onClose={() => {}} />));
  await fill("调整这部分");
  await act(async () => button("Copy prompt").click());
  const prompt = bridge.deliver.mock.calls[0]?.[0];
  expect(prompt).toContain(`"kind":"${selectionKind}"`);
  expect(prompt).toContain('"selectedStart":12,"selectedEnd":13.5');
  expect(prompt).toContain('"clipLocalStart":1,"clipLocalEnd":2.5');
  expect(prompt).toContain('"sourceStart":2,"sourceEnd":3.5');
  expect(prompt).toContain('"sourceFile":"scenes/intro.html"');
  expect(prompt).toContain('"hfId":"title-stable"');
  expect(prompt).not.toContain('"id":"other"');
});

it("uses the same instruction and retry flow for catalog references while keeping direct insert separate", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [{
    name: "test-widget", title: "Product widget", description: "Product introduction card",
    type: "hyperframes:block", duration: 4, tags: [],
    visualComponent: { category: "media", themeMode: "inherit", ai: { slots: ["headline"], instructions: "Preserve component contract" } },
  }] }));
  const insert = vi.fn().mockResolvedValue(true);
  await act(async () => root.render(<BlocksTab onAddBlock={insert} />));
  await act(async () => button("Ask AI").click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(insert).not.toHaveBeenCalled();
  expect(bridge.deliver).not.toHaveBeenCalled();
  await fill("使用这个组件表现产品亮点");
  bridge.deliver.mockRejectedValueOnce(new Error("发送失败，请重试"));
  await act(async () => button("Copy prompt").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("发送失败，请重试");
  expect(textarea().value).toBe("使用这个组件表现产品亮点");
  await act(async () => button("Copy prompt").click());
  const [prompt, file, options] = bridge.deliver.mock.calls[1];
  expect(prompt).toContain("使用这个组件表现产品亮点");
  expect(prompt).toContain("test-widget");
  expect(prompt).toContain("Preserve component contract");
  expect(prompt).toContain('"duration":4');
  expect(file).toBe("scenes/current.html");
  expect(options).toEqual({ instruction: "使用这个组件表现产品亮点" });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(insert).not.toHaveBeenCalled();
  await act(async () => button("Insert component").click());
  expect(insert).toHaveBeenCalledExactlyOnceWith("test-widget");
});

it("opens the real element instruction dialog from the sparkle toolbar instead of silently staging a selection", async () => {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("Preview document missing");
  const element = doc.createElement("span");
  element.id = "title-one";
  element.textContent = "明确目标与交付";
  doc.body.append(element);
  const selection: DomEditSelection = {
    element, id: element.id, selector: "#title-one", sourceFile: "scenes/current.html",
    label: "标题", tagName: "span", compositionPath: "scenes/current.html",
    isCompositionHost: false, isInsideLockedComposition: false,
    boundingBox: { x: 10, y: 20, width: 120, height: 40 }, textContent: element.textContent,
    dataAttributes: {}, inlineStyles: {}, computedStyles: {}, textFields: [],
    capabilities: { canSelect: true, canEditStyles: true, canCrop: false, canMove: true, canResize: true,
      canApplyManualOffset: true, canApplyManualSize: true, canApplyManualRotation: true },
  };
  function Harness() {
    const selectionRef = useRef(selection);
    const projectIdRef = useRef<string | null>("video-one");
    const modal = useAskAgentModal({ projectId: "video-one", activeCompPath: "scenes/current.html", projectDir: "/proof",
      projectIdRef, showToast: bridge.showToast, domEditSelectionRef: selectionRef, domEditSelection: selection });
    bridge.askAgent = modal.handleAskAgent;
    return <>
      <PreviewTextSelectionToolbar iframeRef={{ current: iframe }} containerRef={{ current: host }} activeSelection={selection} />
      {modal.agentModalOpen && <AskAgentModal selectionLabel={selection.label} onSubmit={modal.handleAgentModalSubmit} onClose={() => modal.setAgentModalOpen(false)} />}
    </>;
  }
  await act(async () => root.render(<Harness />));
  await act(async () => button("Ask AI about selected element").click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(bridge.deliver).not.toHaveBeenCalled();
  await fill("优化这段文字");
  await act(async () => button("Copy prompt").click());
  const [prompt, file, options] = bridge.deliver.mock.calls[0];
  expect(prompt).toContain("DOM id: title-one");
  expect(prompt).toContain("优化这段文字");
  expect(file).toBe("scenes/current.html");
  expect(options).toEqual({ selection, instruction: "优化这段文字" });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(bridge.showToast).toHaveBeenCalledExactlyOnceWith("已复制提示词", "info");
});
