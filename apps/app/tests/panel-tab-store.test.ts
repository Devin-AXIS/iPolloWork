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

  test("does not let late persistence hydration discard a tab the user just opened", async () => {
    usePanelTabStore.getState().openTab("session-1", {
      id: "workspace-app:image-studio:studio",
      type: "workspace-app",
      label: "图片工作台",
      sessionId: "session-1",
      surface: {
        id: "image-studio:studio",
        pluginId: "image-studio",
        label: "图片工作台",
        resource: { id: "studio", uri: "ui://image-studio/studio" },
      },
      launch: {
        intent: "edit-image",
        source: {
          kind: "workspace-file",
          path: "artifacts/image-studio/result.png",
          name: "result.png",
          preview: "image",
        },
      },
    });
    storage.set("ipollowork:panel-tabs:v1", JSON.stringify({
      state: {
        sessions: {
          "session-1": { tabs: [], activeTabId: null },
        },
      },
      version: 0,
    }));

    await usePanelTabStore.persist.rehydrate();

    const session = usePanelTabStore.getState().sessions["session-1"];
    expect(session?.activeTabId).toBe("workspace-app:image-studio:studio");
    expect(session?.tabs).toHaveLength(1);
    expect(session?.tabs[0]?.type).toBe("workspace-app");
  });
});

describe("material edit result routing", () => {
  const surface: import("../src/react-app/plugin-ui/plugin-ui-contributions").PluginUiSurface = {
    id:"image-studio:studio", pluginId:"image-studio", pluginName:"Image Studio", label:"Image Studio",
    description:"",iconSrc:null,action:null,
    resource:{id:"studio",type:"ui",path:"ui/studio.html",ui:{uri:"ui://image-studio/studio",mimeType:"text/html;profile=mcp-app"}},
  };
  beforeEach(() => {
    storage.clear();
    usePanelTabStore.setState({ sessions: {}, transcriptArtifactTargets: {}, mediaEdits: [] });
  });
  const edit = (): import("../src/react-app/domains/session/panel/panel-tab-store").MediaEditBinding => ({
    workspaceId: "workspace", sessionId: "conversation", projectSessionId: "original-project",
    source: {requestId: "edit-1", path: "design/original-project/assets/source.png", kind: "image"},
    page: "design/original-project/index.html", locator: "#hero", original: '<img id="hero" src="assets/source.png">',
    media: {kind:"image",source:"assets/source.png",preview:"assets/source.png",background:false},
    results: [], active:true, replaced:false,
  });
  test("routes a result to its project even when the conversation has a different ID", () => {
    const store=usePanelTabStore.getState();
    store.rememberMediaEdit(edit());
    expect(store.completeMediaEdit("workspace","original-project","edit-1","artifacts/result.png")).toBeNull();
    expect(store.completeMediaEdit("workspace","conversation","other-request","artifacts/result.png")).toBeNull();
    const result=store.completeMediaEdit("workspace","conversation","edit-1","artifacts/result.png");
    expect(result).not.toBeNull();
    expect(store.openMediaEditResult("workspace","conversation","artifacts/result.png",surface)).toBe(true);
    const tab=usePanelTabStore.getState().sessions.conversation.tabs[0];
    expect(tab.type).toBe("workspace-app");
    if(tab.type === "workspace-app") { expect(tab.sessionId).toBe("conversation"); expect(tab.mediaEditRequestId).toBe("edit-1"); }
    expect(usePanelTabStore.getState().sessions.conversation.tabs).toHaveLength(1);
    expect(store.openMediaEditResult("other-workspace","conversation","artifacts/result.png",surface)).toBe(false);
    expect(store.completeMediaEdit("workspace","conversation","edit-1","artifacts/result.mp4")).toBeNull();
  });
  test("restores source and replacement status after reopening a result card", async () => {
    const store=usePanelTabStore.getState();
    store.rememberMediaEdit(edit());
    store.completeMediaEdit("workspace","conversation","edit-1","artifacts/result.png");
    store.closeMediaEdit("edit-1",true);
    const persisted=storage.get("ipollowork:panel-tabs:v1");
    usePanelTabStore.setState({mediaEdits:[],sessions:{}});
    storage.set("ipollowork:panel-tabs:v1",persisted!);
    await usePanelTabStore.persist.rehydrate();
    expect(store.openMediaEditResult("workspace","conversation","artifacts/result.png",surface)).toBe(true);
    const restored=usePanelTabStore.getState().mediaEdits[0];
    expect(restored.locator).toBe("#hero");
    expect(restored.source.path).toBe(edit().source.path);
    expect(restored.resultPath).toBe("artifacts/result.png");
    expect(restored.replaced).toBe(true);
  });
});
