import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { newTaskComposerScope } from "../src/react-app/domains/session/surface/composer-state-store";

const source = readFileSync(new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url), "utf8");
const start = source.indexOf("const sidePanelLauncherItems = rawSidePanelLauncherItems.map");
const end = source.indexOf("  useEffect(() => {", start);
const mapping = source.slice(start, end);
const effectStart = end + "  useEffect(() => {".length;
const effect = source.slice(effectStart, source.indexOf("  }, [pendingLauncher", effectStart));

function harness(create: () => Promise<string | null>, selectedSessionId: string | null = null) {
  const opened: string[] = [];
  const errors: string[] = [];
  const restored: string[] = [];
  const cleared: string[] = [];
  const context = {
    rawSidePanelLauncherItems: [{ id: "workspace-app:image", onClick: () => opened.push(context.props.selectedSessionId ?? "missing") }],
    props: { selectedSessionId, selectedWorkspaceId: "workspace", selectedWorkspaceDisplay: { engineId: "codex" }, sidebar: { onCreateTaskInWorkspace: create } },
    launcherBusy: false,
    initialTaskScope: newTaskComposerScope("workspace"),
    launcherCreationRef: { current: false },
    pendingLauncher: null,
    setLauncherBusy: (value: boolean) => { context.launcherBusy = value; },
    setPendingLauncher: (value: unknown) => { Object.assign(context, { pendingLauncher: value }); },
    useComposerStateStore: { getState: () => ({
      sessions: { [newTaskComposerScope("workspace")]: { draft: "unsent text", attachments: ["image"] } },
      restoreSessionIfEmpty: (id: string, draft: { draft: string }) => { restored.push(id + ":" + draft.draft); return true; },
      clearSession: (scope: string) => cleared.push(scope),
    }) },
    DEFAULT_ENGINE_ID: "codex",
    t: (key: string) => key,
    toast: { error: (message: string) => errors.push(message) },
    openPluginWorkshopForSession: (id: string) => opened.push(id),
    setSessionPanelView: () => {},
  };
  const items: Array<{ onClick: () => void }> = runInNewContext(mapping + "\nsidePanelLauncherItems", context);
  return { context, opened, errors, restored, cleared, click: () => items[0]!.onClick(), finish: () => runInNewContext(`(() => {${effect}})()`, { ...context }) };
}

test("new-chat launcher creates once, preserves draft and opens with the new session callbacks", async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return "created"; });
  h.click();
  h.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toBe(1);
  expect(h.context.launcherBusy).toBe(true);
  expect(h.restored).toEqual(["created:unsent text"]);
  expect(h.cleared).toEqual([newTaskComposerScope("workspace")]);
  h.finish();
  expect(h.opened).toEqual([]);
  h.context.props.selectedSessionId = "created";
  h.finish();
  expect(h.opened).toEqual(["created"]);
  expect(h.context.launcherBusy).toBe(false);
  expect(h.context.pendingLauncher).toBeNull();
});

test("existing sessions launch directly without creating another task", () => {
  const h = harness(async () => { throw new Error("should not create"); }, "existing");
  h.click();
  expect(h.opened).toEqual(["existing"]);
  expect(h.cleared).toEqual([]);
});

test("creation failure unlocks retry and does not launch against a missing session", async () => {
  const h = harness(async () => null);
  h.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(h.context.launcherBusy).toBe(false);
  expect(h.context.launcherCreationRef.current).toBe(false);
  expect(h.errors).toHaveLength(1);
  expect(h.opened).toEqual([]);
  expect(h.cleared).toEqual([]);
});

test("changing workspace cancels the deferred launcher", async () => {
  const h = harness(async () => "created");
  h.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.context.props.selectedWorkspaceId = "other";
  h.finish();
  expect(h.context.pendingLauncher).toBeNull();
  expect(h.opened).toEqual([]);
});

test("empty and populated panels share the same launcher menu", () => {
  const panel = readFileSync(new URL("../src/react-app/domains/session/panel/side-panel.tsx", import.meta.url), "utf8");
  expect(source).toContain("<SidePanelLauncherMenu launcherItems={sidePanelLauncherItems}");
  expect(panel).toContain("<SidePanelLauncherMenu launcherItems={launcherItems}");
  expect(source).not.toContain("min-[960px]:pt-[44vh]");
});
