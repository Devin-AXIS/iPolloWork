// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelLayout, type InitialPanelLayoutState } from "./usePanelLayout";
import { useDomEditPreviewSync } from "./useDomEditPreviewSync";
import { useAppHotkeys } from "./useAppHotkeys";
import type { DomEditSelection } from "../components/editor/domEditing";
import { useDockLayoutStore, type DockController } from "../components/dock/dockLayoutStore";

vi.mock("../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

describe("canonical dock navigation", () => {
  let root: Root;
  let layout: ReturnType<typeof usePanelLayout>;
  let container: HTMLDivElement;
  const controller: DockController = {
    open: vi.fn(), activate: vi.fn(), setTitle: vi.fn(), close: vi.fn(),
    setGroupVisible: vi.fn(), reset: vi.fn(),
  };
  function Probe({ initial }: { initial?: InitialPanelLayoutState }) {
    layout = usePanelLayout(initial);
    return null;
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    useDockLayoutStore.setState(useDockLayoutStore.getInitialState(), true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  it("preserves an assets deep link requested before the native dock mounts", () => {
    act(() => root.render(<Probe initial={{ rightPanelTab: "assets" }} />));
    expect(layout.rightPanelTab).toBe("assets");
    expect(useDockLayoutStore.getState().pendingActivation).toBe("design");
  });
  it("maps removed Code deep links to the inspector without reviving the page", () => {
    act(() => root.render(<Probe initial={{ rightPanelTab: "code" }} />));
    expect(layout.rightPanelTab).toBe("design");
    expect(useDockLayoutStore.getState().pendingActivation).toBe("design");
    act(() => layout.setRightPanelTab("assets"));
    act(() => layout.setRightPanelTab("code"));
    expect(layout.rightPanelTab).toBe("design");
  });
  it("reveals assets in the right sidebar without opening a second dock panel", () => {
    useDockLayoutStore.getState().attach(controller);
    act(() => root.render(<Probe initial={{ rightPanelTab: "voice" }} />));
    act(() => layout.setRightPanelTab("assets"));
    expect(layout.rightPanelTab).toBe("assets");
    expect(controller.setGroupVisible).toHaveBeenCalledWith("design", true);
    expect(controller.activate).toHaveBeenCalledWith("design");
    expect(controller.activate).not.toHaveBeenCalledWith("assets");
  });
  it("keeps a manually opened media file through preview refreshes, but reveals a new target or reopened Code panel", () => {
    const openSource = vi.fn();
    const selection = { id: "title", sourceFile: "index.html", selector: "#title", selectorIndex: 0 } as DomEditSelection;
    const selectionRef = { current: selection };
    const noop = vi.fn();
    function SourceProbe({ selected, sourcePanelActive = true }: { selected: DomEditSelection; sourcePanelActive?: boolean }) {
      selectionRef.current = selected;
      useDomEditPreviewSync({
        sourcePanelActive,
        previewIframe: null, activeCompPath: "index.html", captionEditMode: false,
        domEditSelectionRef: selectionRef, domEditSelection: selected,
        applyDomSelection: noop, buildDomSelectionFromTarget: async () => null,
        refreshPreviewDocumentVersion: noop, syncPreviewHistoryHotkey: noop,
        applyStudioManualEditsToPreviewRef: { current: async () => {} },
        openSourceForSelection: openSource,
      });
      return null;
    }
    act(() => useDockLayoutStore.setState({ visiblePanels: new Set(["design"]) }));
    act(() => root.render(<SourceProbe selected={selection} />));
    expect(openSource).toHaveBeenCalledTimes(1);
    // A preview refresh updates computed styles and element objects while the
    // user has independently opened a media file in the source file tree.
    act(() => root.render(<SourceProbe selected={{ ...selection, computedStyles: { ...selection.computedStyles, color: "red" } }} />));
    expect(openSource).toHaveBeenCalledTimes(1);
    const other = { ...selection, id: "shape", selector: "#shape" };
    act(() => root.render(<SourceProbe selected={other} />));
    expect(openSource).toHaveBeenCalledTimes(2);
    act(() => useDockLayoutStore.setState({ visiblePanels: new Set() }));
    act(() => useDockLayoutStore.setState({ visiblePanels: new Set(["design"]) }));
    expect(openSource).toHaveBeenCalledTimes(3);
    expect(openSource).toHaveBeenLastCalledWith("index.html", { id: "shape", selector: "#shape", selectorIndex: 0 });
    act(() => root.render(<SourceProbe selected={other} sourcePanelActive={false} />));
    act(() => root.render(<SourceProbe selected={other} />));
    expect(openSource).toHaveBeenCalledTimes(4);
  });

  it("uses dock visibility for collapse and reopens through the native controller", () => {
    useDockLayoutStore.getState().attach(controller);
    act(() => root.render(<Probe initial={{ rightPanelTab: "layers" }} />));
    expect(layout.rightPanelTab).toBe("design");
    act(() => layout.setRightCollapsed(true));
    expect(controller.close).toHaveBeenCalledWith("design");
    act(() => useDockLayoutStore.getState().sync({
      openPanels: new Set(["preview", "timeline"]),
      visiblePanels: new Set(["preview", "timeline"]), activePanel: "preview",
    }));
    expect(layout.rightCollapsed).toBe(true);
    act(() => layout.setRightCollapsed(false));
    expect(controller.activate).toHaveBeenCalledWith("design");
    act(() => useDockLayoutStore.getState().sync({
      openPanels: new Set(["design"]), visiblePanels: new Set(["design"]), activePanel: "design",
    }));
    expect(layout.rightCollapsed).toBe(false);
  });

  it("routes script and asset hotkeys through their current owners without opening removed dock panels", () => {
    const onOpenScript = vi.fn();
    const onOpenAssets = vi.fn();
    const noop = vi.fn();
    const asyncNoop = async () => {};
    function HotkeyProbe() {
      useAppHotkeys({
        onOpenScript, onOpenAssets,
        handleTimelineElementDelete: asyncNoop,
        handleTimelineElementSplit: asyncNoop,
        handleDomEditElementDelete: asyncNoop,
        domEditSelectionRef: { current: null }, clearDomSelectionRef: { current: noop },
        editHistory: { undo: async () => ({ ok: true }), redo: async () => ({ ok: true }), state: { undo: [], redo: [] } },
        readOptionalProjectFile: async () => "", readProjectFile: async () => "", writeProjectFile: asyncNoop,
        domEditSaveTimestampRef: { current: 0 }, showToast: noop,
        syncHistoryPreviewAfterApply: asyncNoop, waitForPendingDomEditSaves: asyncNoop,
        handleCopy: () => false, handlePaste: asyncNoop, handleCut: async () => false,
        onResetKeyframes: () => false, onDeleteSelectedKeyframes: noop,
      });
      return null;
    }
    useDockLayoutStore.getState().attach(controller);
    act(() => root.render(<HotkeyProbe />));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", metaKey: true }));
    });
    expect(onOpenScript).toHaveBeenCalledOnce();
    expect(onOpenAssets).toHaveBeenCalledOnce();
    expect(controller.activate).not.toHaveBeenCalled();
  });
});
