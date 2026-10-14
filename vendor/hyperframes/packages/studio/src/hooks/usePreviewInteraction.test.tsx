// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { resolveDomEditSelection, type DomEditSelection } from "../components/editor/domEditing";
import { usePreviewInteraction, type UsePreviewInteractionParams } from "./usePreviewInteraction";
import { DomEditOverlay } from "../components/editor/DomEditOverlay";
import { getPreviewTargetFromPointer } from "../utils/studioPreviewHelpers";
import { useTimelineSelectionPreviewSync } from "./useTimelineSelectionPreviewSync";
import { resolveTimelineTreeSelectionKey } from "../player/lib/timelineTreeSelection";
import { usePlayerStore } from "../player/store/playerStore";

vi.mock("../utils/studioPreviewHelpers", async importOriginal => ({
  ...await importOriginal<typeof import("../utils/studioPreviewHelpers")>(),
  getPreviewTargetFromPointer: vi.fn(),
}));

let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ""; });

function mount(resolve: UsePreviewInteractionParams["resolveDomSelectionFromPreviewPoint"]) {
  const apply = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  function Harness() {
    const interaction = usePreviewInteraction({
      captionEditMode: false, compositionLoading: false, previewIframeRef: { current: null },
      showToast: vi.fn(), applyDomSelection: apply, resolveDomSelectionFromPreviewPoint: resolve,
      updateDomEditHoverSelection: vi.fn(),
    });
    return <div onMouseDown={e => void interaction.handlePreviewCanvasMouseDown(e)} />;
  }
  root = createRoot(container);
  act(() => root?.render(<Harness />));
  const click = (x: number, button = 0) => act(() => {
    container.firstElementChild?.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, button, clientX: x, clientY: 40,
    }));
  });
  return { click, apply };
}

async function selection(id: string) {
  const element = document.createElement("div"); element.id = id;
  document.body.appendChild(element);
  return resolveDomEditSelection(element, { activeCompositionPath: "index.html", isMasterView: true });
}

test("plain left clicks resolve locally without waiting for a source probe", async () => {
  const picked = await selection("caption");
  const resolve = vi.fn(async () => picked);
  const ui = mount(resolve);
  await act(async () => ui.click(80));
  expect(resolve).toHaveBeenCalledWith(80, 40, { preferClipAncestor: false, skipSourceProbe: true });
  expect(ui.apply).toHaveBeenCalledWith(picked, { revealPanel: false, previewInteraction: "primary" });
});

test("a late click resolution cannot replace a newer selection or blank-canvas deselection", async () => {
  const picked = await selection("caption");
  let finishFirst: ((value: DomEditSelection | null) => void) | undefined;
  const first = new Promise<DomEditSelection | null>(resolve => { finishFirst = resolve; });
  const resolve = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(null);
  const ui = mount(resolve);
  await act(async () => { ui.click(80); ui.click(600); });
  await act(async () => finishFirst?.(picked));
  expect(ui.apply.mock.calls).toEqual([[null, { revealPanel: false }]]);
});

test("right clicks do not run the left-click selection path", async () => {
  const resolve = vi.fn(async () => null);
  const ui = mount(resolve);
  await act(async () => ui.click(80, 2));
  expect(resolve).not.toHaveBeenCalled();
  expect(ui.apply).not.toHaveBeenCalled();
});

test("a quick canvas click keeps its selection when resolution finishes after pointer release", async () => {
  const picked = await selection("caption");
  if (!picked) throw new Error("Missing selection fixture");
  vi.mocked(getPreviewTargetFromPointer).mockReturnValue(picked.element);
  let finish: ((value: DomEditSelection | null) => void) | undefined;
  const pending = new Promise<DomEditSelection | null>(resolve => { finish = resolve; });
  const apply = vi.fn();
  const container = document.createElement("div"), iframe = document.createElement("iframe");
  document.body.append(container, iframe);
  root = createRoot(container);
  function Harness() {
    const interaction = usePreviewInteraction({
      captionEditMode: false, compositionLoading: false, previewIframeRef: { current: iframe },
      showToast: vi.fn(), applyDomSelection: apply, resolveDomSelectionFromPreviewPoint: () => pending,
      updateDomEditHoverSelection: vi.fn(),
    });
    return <DomEditOverlay
    iframeRef={{ current: iframe }} activeCompositionPath="index.html"
    selection={null} hoverSelection={null} onCanvasMouseDown={interaction.handlePreviewCanvasMouseDown}
    onCanvasPointerMove={() => pending} onCanvasPointerLeave={vi.fn()}
    onSelectionChange={apply} onBlockedMove={vi.fn()} onPathOffsetCommit={vi.fn()}
    onGroupPathOffsetCommit={vi.fn()} onBoxSizeCommit={vi.fn()} onRotationCommit={vi.fn()}
    />;
  }
  act(() => root?.render(<Harness />));
  const canvas = container.querySelector('[aria-label="Composition canvas"]');
  if (!(canvas instanceof HTMLDivElement)) throw new Error("Missing canvas fixture");
  canvas.setPointerCapture = vi.fn();
  canvas.hasPointerCapture = vi.fn(() => false);
  act(() => {
    canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 80, clientY: 40 }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1, clientX: 80, clientY: 40 }));
  });
  await act(async () => finish?.(picked));
  expect(apply).toHaveBeenCalledWith(picked, { revealPanel: false, previewInteraction: "primary" });
});

test("a canvas-picked child stays selected while its timeline row is collapsed", async () => {
  const picked = await selection("caption");
  if (!picked) throw new Error("Missing selection fixture");
  const store = usePlayerStore.getState();
  const key = resolveTimelineTreeSelectionKey({
    elementId: picked.id ?? undefined, sourceFile: picked.sourceFile, selector: picked.selector,
    elements: [], manifest: store.clipManifest ?? [], domClipChildren: store.domClipChildren,
  });
  const apply = vi.fn(), build = vi.fn(async () => null);
  const container = document.createElement("div"); document.body.appendChild(container);
  function Harness({ selected }: { selected: boolean }) {
    useTimelineSelectionPreviewSync({
      selectedElementId: selected ? key : null, selectedElementIds: new Set(selected ? [key] : []),
      timelineElements: [], domEditSelection: picked, domEditGroupSelections: [],
      activeCompPath: "index.html", buildDomSelectionForTimelineElement: build,
      applyDomSelection: apply, applyMarqueeSelection: vi.fn(),
    });
    return null;
  }
  root = createRoot(container);
  await act(async () => root?.render(<Harness selected />));
  expect(apply).not.toHaveBeenCalled();
  expect(build).not.toHaveBeenCalled();
  await act(async () => root?.render(<Harness selected={false} />));
  expect(apply).toHaveBeenCalledWith(null, { revealPanel: false });
});
