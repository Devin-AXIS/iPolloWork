// @vitest-environment happy-dom

import React, { act, type ComponentProps } from "react";
import type { DockviewApi } from "dockview-react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as dockLayout from "./dockLayout";
import { Dock } from "./Dock";
import { parseDockLayout } from "./dockLayoutSchema";
import { useDockLayoutStore } from "./dockLayoutStore";
import { PANEL_IDS } from "./panelRegistry";
import { readStudioUiPreferences } from "../../utils/studioUiPreferences";
import { ShortcutsPanel } from "../../player/components/ShortcutsPanel";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let dockApi: DockviewApi | null = null;
let initialDockSize: [number, number] | null = null;
vi.mock("dockview-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dockview-react")>();
  return {
    ...actual,
    DockviewReact: (props: ComponentProps<typeof actual.DockviewReact>) =>
      React.createElement(actual.DockviewReact, {
        ...props,
        onReady: (event) => {
          dockApi = event.api;
          if (initialDockSize) event.api.layout(...initialDockSize);
          props.onReady(event);
        },
      }),
  };
});

const liveObservers = new Set<{ callback: () => void; target?: Element }>();
class ResizeObserverStub {
  private readonly entry: { callback: () => void; target?: Element };
  constructor(callback: () => void) {
    this.entry = { callback };
  }
  observe(target: Element) {
    this.entry.target = target;
    liveObservers.add(this.entry);
  }
  unobserve() {}
  disconnect() {
    liveObservers.delete(this.entry);
  }
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  ResizeObserverStub;

vi.mock("./dockLayout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./dockLayout")>();
  return {
    ...actual,
    applySideMinimums: vi.fn(actual.applySideMinimums),
    addRegisteredPanel: vi.fn(actual.addRegisteredPanel),
  };
});
const applySideMinimums = vi.mocked(dockLayout.applySideMinimums);
const addRegisteredPanel = vi.mocked(dockLayout.addRegisteredPanel);

let root: Root | null = null;

function mount(
  projectId: string | null,
  titles: Partial<Record<(typeof PANEL_IDS)[number], string>> = {},
  options: Omit<
    ComponentProps<typeof Dock.Root>,
    "projectId" | "children"
  > = {},
  strict = false,
  menuOptions: ComponentProps<typeof Dock.WindowMenu> = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    const tree = <Dock.Root projectId={projectId} {...options}>
        <Dock.WindowMenu {...menuOptions} />
        {(options.panels ?? PANEL_IDS).map((id) => (
          <Dock.Panel key={id} id={id} title={titles[id]}>
            <div data-testid={`content-${id}`}>{id}</div>
          </Dock.Panel>
        ))}
      </Dock.Root>;
    root?.render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
  });
  return host;
}

/** The persisted views of the group holding `id`, after the debounced write lands. */
function persistedGroupOf(id: string): string | undefined {
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  const grid = JSON.stringify(
    readStudioUiPreferences(undefined, "p1").dockLayout?.grid,
  );
  const groups = [...grid.matchAll(/"views":\[([^\]]*)\]/g)].map((m) => m[1]);
  return groups.find((views) => views.includes(`"${id}"`));
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  initialDockSize = null;
  Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
  vi.useRealTimers();
});

// The default Edit layout tabs [compositions|assets|code|catalog] into one
// group and [design|layers|renders|variables] into another; dockview shows
// only the active tab's content per group. `slideshow` is never part of the
// default build — StudioRightPanels opens it itself when the file is one.
const DEFAULT_OPEN = PANEL_IDS.filter((id) => id !== "slideshow");
const DEFAULT_VISIBLE = ["preview", "timeline", "compositions", "design"];

describe("Dock on React 19", () => {
  it("Control tools hides native groups without disposing preview and restores saved visibility and reset", async () => {
    initialDockSize = [1280, 720];
    const panels = ["preview", "timeline", "design"] as const;
    const options = { panels, requiredPanels: ["preview", "timeline"] as const, fullHeightRight: true, hideHeaders: true, dockWidth: () => 1280 };
    const menuOptions = { label: "Control tools", visibilityOnly: true };
    let host = mount("p1", {}, options, false, menuOptions);
    const preview = host.querySelector('[data-testid="content-preview"]');
    const toggle = async (label: string) => {
      const menu = [...host.querySelectorAll("button")].find(button => button.textContent === "Control tools");
      if (!document.querySelector('[role="menu"]')) await act(async () => { menu?.click(); });
      const item = [...document.querySelectorAll('[role="menuitemcheckbox"]')].find(node => node.textContent?.startsWith(label));
      expect(item).toBeDefined();
      await act(async () => { (item as HTMLElement)?.click(); });
    };
    await toggle("Preview");
    expect(useDockLayoutStore.getState().visiblePanels.has("preview")).toBe(false);
    expect(useDockLayoutStore.getState().openPanels.has("preview")).toBe(true);
    expect(host.querySelector('[data-testid="content-preview"]')).toBe(preview);
    await toggle("Preview");
    expect(useDockLayoutStore.getState().visiblePanels.has("preview")).toBe(true);
    expect(host.querySelector('[data-testid="content-preview"]')).toBe(preview);
    await toggle("Timeline");
    act(() => vi.advanceTimersByTime(400));
    act(() => root?.unmount());
    root = null;
    host = mount("p1", {}, options, false, menuOptions);
    expect(useDockLayoutStore.getState().visiblePanels.has("timeline")).toBe(false);
    await toggle("Timeline");
    expect(useDockLayoutStore.getState().visiblePanels.has("timeline")).toBe(true);
    expect(dockApi?.getPanel("design")?.group.height).toBe(720);
    await toggle("Properties");
    expect(useDockLayoutStore.getState().visiblePanels.has("design")).toBe(false);
    act(() => useDockLayoutStore.getState().resetLayout());
    expect(useDockLayoutStore.getState().visiblePanels).toEqual(new Set(panels));
    expect(dockApi?.getPanel("design")?.group.height).toBe(720);
    act(() => {
      dockApi?.getPanel("design")?.group.api.setSize({ width: 300 });
      dockApi?.getPanel("timeline")?.group.api.setSize({ height: 220 });
    });
    for (const label of ["Preview", "Timeline", "Properties"]) await toggle(label);
    expect([...useDockLayoutStore.getState().visiblePanels]).toHaveLength(0);
    for (const label of ["Preview", "Timeline", "Properties"]) await toggle(label);
    expect(dockApi?.getPanel("design")?.group.width).toBe(300);
    expect(dockApi?.getPanel("timeline")?.group.height).toBe(220);
    for (const label of ["Preview", "Timeline", "Properties"]) await toggle(label);
    act(() => vi.advanceTimersByTime(400));
    act(() => root?.unmount());
    root = null;
    host = mount("p1", {}, options, false, menuOptions);
    for (const label of ["Preview", "Timeline", "Properties"]) await toggle(label);
    expect(dockApi?.getPanel("design")?.group.width).toBeLessThanOrEqual(640);
    expect(dockApi?.getPanel("timeline")?.group.height).toBeGreaterThan(0);
  });
  it("migrates a saved top-row inspector to full height and retains native close, reset and collapsed persistence", () => {
    // A real browser has its dock viewport before restore; happy-dom has no layout.
    initialDockSize = [1280, 720];
    const panels = ["preview", "timeline", "design"] as const;
    mount("p1", {}, { panels, hideHeaders: true, dockWidth: () => 1280 });
    act(() => {
      dockApi?.layout(1280, 720);
      dockApi?.getPanel("design")?.group.api.setSize({ width: 300 });
      dockApi?.getPanel("timeline")?.group.api.setSize({ height: 220 });
      vi.advanceTimersByTime(400);
    });
    expect(dockApi?.getPanel("design")?.group.height).toBeLessThan(720);
    act(() => root?.unmount());
    root = null;
    const options = { panels, fullHeightRight: true, hideHeaders: true, dockWidth: () => 1280 };
    mount("p1", {}, options);
    act(() => dockApi?.layout(1280, 720));
    const assertColumn = () => {
      expect(dockApi?.getPanel("design")?.group.height).toBe(720);
      expect(dockApi?.getPanel("timeline")?.group.width).toBe(dockApi?.getPanel("preview")?.group.width);
      expect(dockApi?.getPanel("timeline")?.group.width).toBeLessThan(1280);
      expect(dockApi?.groups.every(group => group.header.hidden)).toBe(true);
    };
    assertColumn();
    expect(dockApi?.getPanel("design")?.group.width).toBe(300);
    expect(dockApi?.getPanel("timeline")?.group.height).toBe(220);
    act(() => useDockLayoutStore.getState().controller?.setGroupVisible("timeline", false));
    act(() => vi.advanceTimersByTime(400));
    act(() => root?.unmount());
    root = null;
    mount("p1", {}, options);
    act(() => dockApi?.layout(1280, 720));
    expect(useDockLayoutStore.getState().visiblePanels.has("timeline")).toBe(false);
    expect(dockApi?.getPanel("design")?.group.height).toBe(720);
    act(() => useDockLayoutStore.getState().activatePanel("timeline"));
    assertColumn();
    act(() => useDockLayoutStore.getState().closePanel("design"));
    act(() => useDockLayoutStore.getState().activatePanel("design"));
    assertColumn();
    act(() => useDockLayoutStore.getState().resetLayout());
    assertColumn();
    expect(dockApi?.getPanel("timeline")?.group.height).toBe(360);
  });

  it("recovers closed essential panels while preserving a collapsed timeline on reload", () => {
    const panels = ["preview", "timeline", "design"] as const;
    const requiredPanels = ["preview", "timeline"] as const;
    mount("p1", {}, { panels });
    act(() => useDockLayoutStore.getState().closePanel("preview"));
    act(() => vi.advanceTimersByTime(400));
    act(() => root?.unmount());
    root = null;
    mount("p1", {}, { panels, requiredPanels });
    expect(useDockLayoutStore.getState().visiblePanels.has("preview")).toBe(true);
    act(() => useDockLayoutStore.getState().controller?.setGroupVisible("timeline", false));
    act(() => vi.advanceTimersByTime(400));
    act(() => root?.unmount());
    root = null;
    mount("p1", {}, { panels, requiredPanels });
    expect(useDockLayoutStore.getState().openPanels.has("timeline")).toBe(true);
    expect(useDockLayoutStore.getState().visiblePanels.has("timeline")).toBe(false);
    expect(useDockLayoutStore.getState().visiblePanels.has("preview")).toBe(true);
  });

  it("keeps layout tools reachable through collapse, expand and native dock reset", async () => {
    const showPopover = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value: showPopover });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const panels = ["preview", "timeline", "design"] as const;
    const requiredPanels = ["preview", "timeline"] as const;
    await act(async () => {
      root?.render(
        <Dock.Root projectId="p1" panels={panels} requiredPanels={requiredPanels} hideHeaders>
          <Dock.Panel id="preview">
            <div data-testid="preview-controls">
              <ShortcutsPanel disabled={false} duration={14} inPoint={null} outPoint={null}
                setInPoint={vi.fn()} setOutPoint={vi.fn()} onSeek={vi.fn()} />
            </div>
          </Dock.Panel>
          <Dock.Panel id="timeline"><div id="hf-shortcuts-toolbar-slot" /></Dock.Panel>
          <Dock.Panel id="design"><div>Inspector</div></Dock.Panel>
        </Dock.Root>,
      );
    });
    const click = async (label: string) => {
      const button = [...host.querySelectorAll("button")].find((node) =>
        node.getAttribute("aria-label") === label || node.textContent === label,
      );
      expect(button, label).toBeDefined();
      await act(async () => { button?.click(); });
    };
    const tool = () => host.querySelector('button[aria-label="Shortcuts and tools"]');
    expect(tool()?.closest("#hf-shortcuts-toolbar-slot")).not.toBeNull();
    await click("Shortcuts and tools");
    expect(host.querySelector(".hf-shortcuts-panel")?.textContent).toContain("Script table");
    expect(host.querySelector(".hf-shortcuts-panel")?.getAttribute("popover")).toBe("manual");
    expect(showPopover).toHaveBeenCalledOnce();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(host.querySelector(".hf-shortcuts-panel")).toBeNull();
    expect(document.activeElement).toBe(tool());
    await click("Shortcuts and tools");
    await click("Collapse timeline");
    expect(useDockLayoutStore.getState().visiblePanels.has("timeline")).toBe(false);
    expect(tool()?.closest('[data-testid="preview-controls"]')).not.toBeNull();
    await click("Shortcuts and tools");
    await click("Expand timeline");
    expect(useDockLayoutStore.getState().visiblePanels.has("timeline")).toBe(true);
    const oldSlot = host.querySelector("#hf-shortcuts-toolbar-slot");
    expect(tool()?.closest("#hf-shortcuts-toolbar-slot")).toBe(oldSlot);
    await click("Shortcuts and tools");
    await click("Reset layout");
    expect(oldSlot?.isConnected).toBe(false);
    expect(tool()?.closest("#hf-shortcuts-toolbar-slot")).not.toBeNull();
    expect(dockApi?.groups.every((group) => group.header.hidden)).toBe(true);
    await click("Shortcuts and tools");
    await click("Collapse timeline");
    expect(tool()?.closest('[data-testid="preview-controls"]')).not.toBeNull();
  });

  it("replaces the old left column and keeps headers hidden after restore, reset and reopen", () => {
    mount("p1");
    act(() => vi.advanceTimersByTime(400));
    act(() => root?.unmount());
    root = null;
    const panels = ["preview", "timeline", "design"] as const;
    const host = mount("p1", {}, { panels, hideHeaders: true, dockWidth: () => 1280 });
    act(() => dockApi?.layout(1280, 720));
    expect(useDockLayoutStore.getState().openPanels).toEqual(new Set(panels));
    expect(host.querySelector('[data-testid="content-compositions"]')).toBeNull();
    const assertHidden = () => {
      expect(dockApi?.groups).toHaveLength(3);
      expect(dockApi?.groups.every(group => group.header.hidden)).toBe(true);
    };
    assertHidden();
    act(() => useDockLayoutStore.getState().activatePanel("assets"));
    expect(useDockLayoutStore.getState().openPanels.has("assets")).toBe(false);
    act(() => useDockLayoutStore.getState().resetLayout());
    assertHidden();
    act(() => useDockLayoutStore.getState().closePanel("design"));
    act(() => useDockLayoutStore.getState().activatePanel("design"));
    assertHidden();
    expect(dockApi?.getPanel("design")?.group.width).toBe(dockLayout.defaultSideWidths(1280).right);
    act(() => vi.advanceTimersByTime(400));
    act(() => root?.unmount());
    root = null;
    mount("p1", {}, { panels, hideHeaders: true });
    assertHidden();
  });

  it("mounts the default layout's ten panels, showing only each group's active tab", () => {
    const host = mount("p1");
    for (const id of DEFAULT_VISIBLE) {
      expect(
        host.querySelector(`[data-testid="content-${id}"]`),
      ).not.toBeNull();
    }
    for (const id of DEFAULT_OPEN.filter(
      (id) => !DEFAULT_VISIBLE.includes(id),
    )) {
      expect(host.querySelector(`[data-testid="content-${id}"]`)).toBeNull();
    }
    expect(host.querySelector('[data-testid="content-slideshow"]')).toBeNull();
    expect(useDockLayoutStore.getState().openPanels).toEqual(
      new Set(DEFAULT_OPEN),
    );
  });

  it("persists a layout change per project and reads it back through the schema", () => {
    mount("p1");
    act(() => useDockLayoutStore.getState().closePanel("renders"));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const stored = readStudioUiPreferences(undefined, "p1").dockLayout;
    const expected = DEFAULT_OPEN.filter((id) => id !== "renders");
    expect(Object.keys(stored?.panels ?? {}).sort()).toEqual(
      [...expected].sort(),
    );
    expect(readStudioUiPreferences(undefined, "p2").dockLayout).toBeUndefined();
  });

  it("closes a panel and reopens it from the store, becoming its group's visible tab", async () => {
    const host = mount("p1");
    act(() => useDockLayoutStore.getState().closePanel("renders"));
    expect(useDockLayoutStore.getState().openPanels.has("renders")).toBe(false);
    expect(host.querySelector('[data-testid="content-renders"]')).toBeNull();
    // dockview's own panel-active event dispatch resolves on a microtask, one
    // tick after the synchronous store call returns; `act(async ...)` is what
    // actually waits for it instead of asserting against pre-flush DOM.
    await act(async () => {
      useDockLayoutStore.getState().togglePanel("renders");
      await Promise.resolve();
    });
    expect(useDockLayoutStore.getState().openPanels.has("renders")).toBe(true);
    expect(
      host.querySelector('[data-testid="content-renders"]'),
    ).not.toBeNull();
  });

  it("keeps a panel's custom title when it is closed and reopened", async () => {
    const host = mount("p1", { renders: "Renders (2)" });
    expect(host.textContent).toContain("Renders (2)");
    act(() => useDockLayoutStore.getState().closePanel("renders"));
    await act(async () => {
      useDockLayoutStore.getState().togglePanel("renders");
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Renders (2)");
  });

  it("reopens a closed panel as a tab of its zone's group, not a new group", () => {
    mount("p1");
    act(() => useDockLayoutStore.getState().closePanel("compositions"));
    act(() => useDockLayoutStore.getState().togglePanel("compositions"));
    expect(persistedGroupOf("compositions")).toContain('"assets"');
  });

  it("reopens a side panel next to the preview when its whole column was closed", () => {
    mount("p1");
    const { closePanel, togglePanel } = useDockLayoutStore.getState();
    for (const id of ["compositions", "assets", "code", "catalog"] as const)
      act(() => closePanel(id));
    act(() => togglePanel("compositions"));
    expect(useDockLayoutStore.getState().openPanels.has("compositions")).toBe(
      true,
    );
    expect(
      useDockLayoutStore.getState().visiblePanels.has("compositions"),
    ).toBe(true);
  });

  it("reopens a panel whose usual neighbour is only closed exactly as before: no new position", () => {
    mount("p1");
    const { closePanel, togglePanel } = useDockLayoutStore.getState();
    for (const id of ["compositions", "assets", "code", "catalog"] as const)
      act(() => closePanel(id));
    addRegisteredPanel.mockClear();
    act(() => togglePanel("assets"));
    expect(addRegisteredPanel).toHaveBeenCalledWith(
      expect.anything(),
      "assets",
      undefined,
    );
  });

  it("reopens the timeline as its own group, never as a tab of the preview", () => {
    mount("p1");
    act(() => useDockLayoutStore.getState().closePanel("timeline"));
    act(() => useDockLayoutStore.getState().togglePanel("timeline"));
    expect(persistedGroupOf("timeline")).not.toContain('"preview"');
  });

  it("restores the stored layout on the next mount instead of rebuilding the default", () => {
    mount("p1");
    act(() => useDockLayoutStore.getState().closePanel("renders"));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";

    mount("p1");
    expect(useDockLayoutStore.getState().openPanels.has("renders")).toBe(false);
  });

  it("reopens an assets deep link even when the saved layout closed that panel", () => {
    mount("assets-link");
    act(() => useDockLayoutStore.getState().closePanel("assets"));
    act(() => vi.advanceTimersByTime(1000));
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    act(() => useDockLayoutStore.getState().activatePanel("assets"));
    expect(useDockLayoutStore.getState().pendingActivation).toBe("assets");
    mount("assets-link");
    expect(useDockLayoutStore.getState().openPanels.has("assets")).toBe(true);
    expect(useDockLayoutStore.getState().visiblePanels.has("assets")).toBe(true);
  });

  it("falls back to the default layout when the stored one names an unknown panel", () => {
    localStorage.setItem(
      "hf-studio-ui-preferences:p1",
      JSON.stringify({ dockLayout: { grid: {}, panels: { nope: {} } } }),
    );
    const host = mount("p1");
    expect(
      host.querySelector('[data-testid="content-preview"]'),
    ).not.toBeNull();
  });
});

describe("Dock wiring", () => {
  it("re-applies the side minimums when a panel is dragged to another group", () => {
    mount(null);
    applySideMinimums.mockClear();
    const preview = dockApi?.getPanel("preview");
    const design = dockApi?.getPanel("design");
    if (!preview || !design)
      throw new Error("default layout is missing panels");
    act(() => design.api.moveTo({ group: preview.group }));
    expect(applySideMinimums).toHaveBeenCalled();
  });

  it("makes the sashes keyboard-focusable separators", () => {
    const host = mount(null);
    const sashes = host.querySelectorAll<HTMLElement>(
      '.dv-sash[role="separator"]',
    );
    expect(sashes.length).toBeGreaterThan(0);
    for (const sash of sashes) expect(sash.tabIndex).toBe(0);
  });

  it("re-fits the side columns to the window width when it resizes", () => {
    mount(null);
    const innerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      value: 560,
      configurable: true,
    });
    try {
      applySideMinimums.mockClear();
      const dockObservers = [...liveObservers].filter(({ target }) =>
        target?.classList.contains("hf-dock"),
      );
      act(() => dockObservers.forEach(({ callback }) => callback()));
      expect(applySideMinimums).toHaveBeenCalledWith(expect.anything(), 560);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        value: innerWidth,
        configurable: true,
      });
    }
  });
});

// A host app mounts a subset of Studio's panels under its own storage key and width.
describe("a host's dock", () => {
  const panels = ["preview", "timeline", "assets", "renders"] as const;
  const hostDock = { panels, storageKey: "host-dock" };

  it("builds only its panels and portals the Window menu above panel chrome", async () => {
    const host = mount("p1", {}, hostDock);
    expect(useDockLayoutStore.getState().openPanels).toEqual(new Set(panels));
    expect(useDockLayoutStore.getState().visiblePanels).toEqual(
      new Set(panels),
    );
    expect(dockApi?.getPanel("assets")?.group.id).not.toBe(
      dockApi?.getPanel("renders")?.group.id,
    );
    const menu = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Workspace",
    );
    await act(async () => { menu?.click(); await Promise.resolve(); });
    const items = [...document.querySelectorAll('[role="menuitemcheckbox"]')];
    expect(items.map((item) => item.textContent)).toEqual(["Preview✓", "Timeline✓", "Assets✓", "Renders✓"]);
    expect(items.every((item) => item.getAttribute("aria-checked") === "true")).toBe(true);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    await act(async () => { (items[1] as HTMLElement).click(); await Promise.resolve(); });
    expect(useDockLayoutStore.getState().openPanels.has("timeline")).toBe(false);
  });

  it("keeps its layout alone under its own key, never in Studio's preferences", () => {
    mount("p1", {}, hostDock);
    act(() => useDockLayoutStore.getState().closePanel("renders"));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const stored = readStudioUiPreferences(
      undefined,
      "p1",
      "host-dock",
    ).dockLayout;
    expect(Object.keys(stored?.panels ?? {}).sort()).toEqual([
      "assets",
      "preview",
      "timeline",
    ]);
    expect(readStudioUiPreferences(undefined, "p1").dockLayout).toBeUndefined();
  });

  it("falls back to its default when a stored layout names a panel it lacks", () => {
    mount("p1");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const studio = readStudioUiPreferences(undefined, "p1").dockLayout;
    act(() => root?.unmount());
    root = null;
    localStorage.setItem(
      "host-dock:p1",
      JSON.stringify({ dockLayout: studio }),
    );
    mount("p1", {}, hostDock);
    expect(useDockLayoutStore.getState().openPanels).toEqual(new Set(panels));
  });

  it("reopens a panel beside the preview when the panel it reopens near is not in the dock", () => {
    mount("p1", {}, hostDock);
    act(() => useDockLayoutStore.getState().closePanel("assets"));
    act(() => useDockLayoutStore.getState().togglePanel("assets"));
    expect(useDockLayoutStore.getState().visiblePanels.has("assets")).toBe(
      true,
    );
  });

  it("sizes its sides against its own width, not the window's", () => {
    mount(null, {}, { ...hostDock, dockWidth: () => 700 });
    applySideMinimums.mockClear();
    const dockObservers = [...liveObservers].filter(({ target }) =>
      target?.classList.contains("hf-dock"),
    );
    act(() => dockObservers.forEach(({ callback }) => callback()));
    expect(applySideMinimums).toHaveBeenCalledWith(expect.anything(), 700);
  });
});

describe("parseDockLayout", () => {
  it("rejects shapes that are not a dock layout", () => {
    expect(parseDockLayout(null)).toBeNull();
    expect(parseDockLayout({ grid: {}, panels: {} })).toBeNull();
    expect(
      parseDockLayout({
        grid: {
          width: 1,
          height: 1,
          orientation: "HORIZONTAL",
          root: { type: "leaf", data: { views: ["ghost"] } },
        },
        panels: { ghost: { id: "ghost", contentComponent: "panel" } },
      }),
    ).toBeNull();
  });

  const placed = (views: string[], panelIds: string[]) => ({
    grid: {
      width: 1,
      height: 1,
      orientation: "HORIZONTAL",
      root: { type: "leaf", data: { views } },
    },
    panels: Object.fromEntries(
      panelIds.map((id) => [id, { id, contentComponent: "panel" }]),
    ),
  });

  it("rejects a view that has no panel entry and a panel that no view places", () => {
    expect(
      parseDockLayout(placed(["preview", "design"], ["preview"])),
    ).toBeNull();
    expect(
      parseDockLayout(placed(["preview"], ["preview", "design"])),
    ).toBeNull();
    expect(
      parseDockLayout(placed(["preview", "design"], ["preview", "design"])),
    ).not.toBeNull();
  });
});

it("keeps the live dock controller through StrictMode effect replay", () => {
  mount("strict-proof", {}, { panels: ["preview", "timeline", "compositions", "assets", "design"] }, true);
  expect(useDockLayoutStore.getState().controller).not.toBeNull();
  act(() => useDockLayoutStore.getState().closePanel("timeline"));
  expect(useDockLayoutStore.getState().openPanels.has("timeline")).toBe(false);
  act(() => useDockLayoutStore.getState().activatePanel("timeline"));
  expect(useDockLayoutStore.getState().visiblePanels.has("timeline")).toBe(true);
});
