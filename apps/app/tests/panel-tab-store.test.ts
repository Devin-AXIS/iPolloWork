import { beforeEach, describe, expect, test } from "bun:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
  },
});

const { usePanelTabStore } = await import("../src/react-app/domains/session/panel/panel-tab-store");

const browserTab = {
  id: "browser:new",
  type: "browser" as const,
  label: "Example",
  url: "https://example.com",
  favicon: null,
  status: "ready" as const,
  canGoBack: false,
  canGoForward: false,
};

describe("panel tab store", () => {
  beforeEach(() => {
    storage.clear();
    usePanelTabStore.setState({ sessions: {}, transcriptArtifactTargets: {} });
  });

  test("selects a browser tab newly opened by the host", () => {
    const store = usePanelTabStore.getState();
    store.openTab("session-1", {
      id: "design:session-1:entry",
      type: "design",
      label: "entry.html",
      sessionId: "session-1",
    });

    usePanelTabStore.getState().syncBrowserTabs("session-1", [browserTab], browserTab.id);

    expect(usePanelTabStore.getState().sessions["session-1"]?.activeTabId).toBe(browserTab.id);
  });

  test("does not let background browser updates steal an existing work surface", () => {
    const store = usePanelTabStore.getState();
    store.openTab("session-1", browserTab);
    store.openTab("session-1", {
      id: "design:session-1:entry",
      type: "design",
      label: "entry.html",
      sessionId: "session-1",
    });

    usePanelTabStore.getState().syncBrowserTabs("session-1", [{ ...browserTab, label: "Updated" }], browserTab.id);

    expect(usePanelTabStore.getState().sessions["session-1"]?.activeTabId).toBe("design:session-1:entry");
  });
});
