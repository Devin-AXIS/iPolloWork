import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { hyperframesStudioPort, videoProjectId } from "@ipollowork/types/hyperframes";

import { iPolloWorkExtensionsPreview } from "./ipollowork-extensions-preview.js";

const originalServerUrl = process.env.IPOLLOWORK_SERVER_URL;
const originalServerToken = process.env.IPOLLOWORK_SERVER_TOKEN;
const originalUiControlTools = process.env.IPOLLOWORK_UI_CONTROL_TOOLS;
const originalUiControlDiscovery = process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY;
const stops: Array<() => void> = [];

const searchResultSchema = z.object({
  ok: z.literal(true),
  scannedSessions: z.number(),
  results: z.array(z.object({
    workspaceId: z.string(),
    sessionId: z.string(),
    kind: z.string(),
    role: z.string().optional(),
    snippet: z.object({ match: z.string() }).passthrough(),
  }).passthrough()),
}).passthrough();

const readResultSchema = z.object({
  ok: z.literal(true),
  workspaceId: z.string(),
  sessionId: z.string(),
  title: z.string(),
  messages: z.array(z.object({
    role: z.string(),
    text: z.string(),
  }).passthrough()),
}).passthrough();

afterEach(() => {
  while (stops.length) stops.pop()?.();
  if (originalServerUrl === undefined) delete process.env.IPOLLOWORK_SERVER_URL;
  else process.env.IPOLLOWORK_SERVER_URL = originalServerUrl;
  if (originalServerToken === undefined) delete process.env.IPOLLOWORK_SERVER_TOKEN;
  else process.env.IPOLLOWORK_SERVER_TOKEN = originalServerToken;
  if (originalUiControlTools === undefined) delete process.env.IPOLLOWORK_UI_CONTROL_TOOLS;
  else process.env.IPOLLOWORK_UI_CONTROL_TOOLS = originalUiControlTools;
  if (originalUiControlDiscovery === undefined) delete process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY;
  else process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY = originalUiControlDiscovery;
});

async function transformedSystem(plugin: Awaited<ReturnType<typeof iPolloWorkExtensionsPreview>>): Promise<string> {
  const output: { system: string[] } = { system: [] };
  await plugin["experimental.chat.system.transform"]({}, output);
  return output.system.join("\n");
}

function startFakeiPolloWorkServer() {
  const requests: Array<{ pathname: string; search: string; authorization: string | null; body?: unknown }> = [];

  const workspaceOne = { id: "ws_1", name: "Main", path: "/tmp/main" };
  const workspaceTwo = { id: "ws_2", name: "Archive", displayName: "Archive", path: "/tmp/archive" };
  const sessionAlpha = { id: "ses_alpha", title: "Alpha planning", time: { created: 100, updated: 300 } };
  const sessionBeta = { id: "ses_beta", title: "Neon backlog", time: { created: 50, updated: 200 } };
  const sessionArchive = { id: "ses_archive", title: "Archive decisions", time: { created: 10, updated: 100 } };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json() : undefined;
      requests.push({
        pathname: url.pathname,
        search: url.search,
        authorization: request.headers.get("authorization"),
        body,
      });

      if (request.headers.get("authorization") !== "Bearer test-token") {
        return Response.json({ message: "Unauthorized" }, { status: 401 });
      }

      if (url.pathname === "/engine-tools/call") {
        return Response.json({ ok: true, received: body });
      }

      if (url.pathname === "/workspaces") {
        return Response.json({ items: [workspaceOne, workspaceTwo], workspaces: [workspaceOne, workspaceTwo] });
      }

      if (url.pathname === "/workspace/ws_1/sessions") {
        return Response.json({ items: [sessionAlpha, sessionBeta] });
      }
      if (url.pathname === "/workspace/ws_2/sessions") {
        return Response.json({ items: [sessionArchive] });
      }

      if (url.pathname === "/workspace/ws_1/sessions/ses_alpha") return Response.json({ item: sessionAlpha });
      if (url.pathname === "/workspace/ws_1/sessions/ses_beta") return Response.json({ item: sessionBeta });
      if (url.pathname === "/workspace/ws_2/sessions/ses_archive") return Response.json({ item: sessionArchive });

      if (url.pathname === "/workspace/ws_1/sessions/ses_alpha/messages") {
        return Response.json({
          items: [
            {
              info: { id: "msg_assistant", role: "assistant", time: { created: 301 } },
              parts: [{ type: "text", text: "The launch checklist can wait." }],
            },
            {
              info: { id: "msg_user", role: "user", time: { created: 302 } },
              parts: [{ type: "text", text: "Please remember the raven launch checklist." }],
            },
          ],
        });
      }
      if (url.pathname === "/workspace/ws_1/sessions/ses_beta/messages") {
        return Response.json({ items: [] });
      }
      if (url.pathname === "/workspace/ws_2/sessions/ses_archive/messages") {
        return Response.json({
          items: [
            {
              info: { id: "msg_old", role: "assistant", time: { created: 101 } },
              parts: [{ type: "text", text: "Ignored implementation note", ignored: true }],
            },
            {
              info: { id: "msg_latest", role: "assistant", time: { created: 102 } },
              parts: [{ type: "text", text: "We decided to ship the archive importer first." }],
            },
          ],
        });
      }

      return Response.json({ message: "Not found" }, { status: 404 });
    },
  });
  stops.push(() => server.stop(true));
  process.env.IPOLLOWORK_SERVER_URL = `http://127.0.0.1:${server.port}`;
  process.env.IPOLLOWORK_SERVER_TOKEN = "test-token";
  return { requests };
}

function startFakeVideoStudio() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const sessionID = `motion_plugin_${process.pid}_${attempt}`;
    const projectId = videoProjectId(sessionID);
    const requests: Array<{ pathname: string; search: string; body: unknown }> = [];
    try {
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: hyperframesStudioPort(sessionID),
        async fetch(request) {
          const url = new URL(request.url);
          const body = request.method === "POST" ? await request.json() : null;
          requests.push({ pathname: url.pathname, search: url.search, body });
          if (url.pathname === `/api/projects/${projectId}/motion-presets`) {
            return Response.json({ presets: [{ id: "text.enter.rise" }] });
          }
          if (url.pathname === `/api/projects/${projectId}/gsap-mutations/index.html`) {
            return Response.json({ ok: true, mutation: body });
          }
          return Response.json({ message: "Not found" }, { status: 404 });
        },
      });
      stops.push(() => server.stop(true));
      return { sessionID, projectId, requests };
    } catch {
      // Deterministic port was already occupied; try another session id.
    }
  }
  throw new Error("Could not allocate a deterministic Video Studio test port");
}

describe("iPolloWorkExtensionsPreview session tools", () => {
  test("searches past chat transcript text and prefers the user's matching message", async () => {
    const fake = startFakeiPolloWorkServer();
    const plugin = await iPolloWorkExtensionsPreview();

    const output = await plugin.tool.ipollowork_session_search.execute({
      query: "raven launch",
      limit: 5,
      scanLimit: 10,
    });
    const parsed = searchResultSchema.parse(JSON.parse(output));

    expect(parsed.scannedSessions).toBe(3);
    expect(parsed.results[0]).toMatchObject({
      workspaceId: "ws_1",
      sessionId: "ses_alpha",
      kind: "message",
      role: "user",
    });
    expect(parsed.results[0]?.snippet.match.toLowerCase()).toBe("raven launch");
    expect(fake.requests.some((request) => request.pathname === "/workspace/ws_1/sessions/ses_alpha/messages" && request.search === "?limit=400")).toBe(true);
  });

  test("reads a transcript by session id without opening the UI", async () => {
    startFakeiPolloWorkServer();
    const plugin = await iPolloWorkExtensionsPreview();

    const output = await plugin.tool.ipollowork_session_read.execute({
      sessionId: "ses_archive",
      count: 2,
    });
    const parsed = readResultSchema.parse(JSON.parse(output));

    expect(parsed).toMatchObject({
      workspaceId: "ws_2",
      sessionId: "ses_archive",
      title: "Archive decisions",
    });
    expect(parsed.messages).toEqual([
      {
        index: 1,
        id: "msg_latest",
        role: "assistant",
        text: "We decided to ship the archive importer first.",
      },
    ]);
  });
});

describe("iPolloWorkExtensionsPreview UI control tools", () => {
  test("omits UI-control tools and steering by default", async () => {
    delete process.env.IPOLLOWORK_UI_CONTROL_TOOLS;
    const plugin = await iPolloWorkExtensionsPreview();
    const tools = Object.keys(plugin.tool);

    expect(tools).not.toContain("ipollowork_ui_snapshot");
    expect(tools).not.toContain("ipollowork_ui_list_actions");
    expect(tools).not.toContain("ipollowork_ui_execute_action");
    expect(tools).toContain("ipollowork_session_search");
    expect(tools).toContain("ipollowork_extension_list_actions");
    expect(tools).toContain("ipollowork_project_read");
    expect(tools).toContain("ipollowork_project_apply");
    expect(tools).toContain("ipollowork_schedule_preview");
    expect(tools).toContain("ipollowork_schedule_apply");
    expect(tools).toContain("ipollowork_workspace_app_list_tools");
    expect(tools).toContain("ipollowork_workspace_app_call_tool");
    expect(tools).toContain("ipollowork_browser_open_url");
    expect(tools).toContain("ipollowork_browser_snapshot");
    expect(tools).toContain("ipollowork_browser_act");
    expect(tools).toContain("ipollowork_browser_set_proxy");
    expect(tools).toContain("list_motion_presets");
    expect(tools).toContain("mutate_motion");

    const system = await transformedSystem(plugin);
    expect(system).not.toContain("ipollowork_ui_");
    expect(system).toContain("ipollowork_session_search");
    expect(system).toContain("Never use these cross-session tools to recover the current task");
    expect(plugin.tool.ipollowork_session_search.description).toContain("Never use it to recover or infer the current interrupted task");
    expect(plugin.tool.ipollowork_session_read.description).toContain("never use it to recover or infer the current interrupted task");
    expect(plugin.tool.ipollowork_schedule_preview.description).toContain("是否需要生成计划并加入 iPolloWork 日程？");
    expect(plugin.tool.ipollowork_schedule_preview.description).toContain("treat that request as agreement to schedule");
    expect(system).toContain("是否需要生成计划并加入 iPolloWork 日程？");
    expect(system).toContain("call this tool immediately");
    expect(system).toContain("even when the plan does not yet include concrete dates or times");
    expect(system).toContain("list_motion_presets");
    expect(system).toContain("mutate_motion");
    expect(system).toContain("stale refs");
    expect(system).not.toContain("browser_url plus target_id");
  });

  test("registers UI-control tools and steering when opted in", async () => {
    process.env.IPOLLOWORK_UI_CONTROL_TOOLS = "1";
    const plugin = await iPolloWorkExtensionsPreview();
    const tools = Object.keys(plugin.tool);

    expect(tools).toContain("ipollowork_ui_snapshot");
    expect(tools).toContain("ipollowork_ui_list_actions");
    expect(tools).toContain("ipollowork_ui_execute_action");

    const system = await transformedSystem(plugin);
    expect(system).toContain("ipollowork_ui_execute_action");
  });

  test("accepts every semantic browser action exposed by the shared host descriptor", async () => {
    const fake = startFakeiPolloWorkServer();
    const plugin = await iPolloWorkExtensionsPreview();
    const actions = [
      { type: "hover", ref: "r1", expectedName: "Menu" },
      { type: "select", ref: "r2", expectedName: "Channel", option: "Video" },
      { type: "check", ref: "r3", expectedName: "Original", checked: true },
      { type: "scroll", direction: "down", amount: "page" },
      { type: "press", key: "Enter", ref: "r4", expectedName: "Continue" },
      { type: "waitFor", condition: "url", value: "/published", match: "contains" },
      { type: "waitFor", condition: "text", value: "Published" },
      { type: "waitFor", condition: "load", state: "complete" },
    ];

    const output = await plugin.tool.ipollowork_browser_act.execute({
      tabId: "tab-1",
      snapshotId: "snapshot-1",
      actions,
    }, { directory: "/tmp/main" });

    expect(JSON.parse(output)).toMatchObject({ ok: true });
    expect(fake.requests.find((request) => request.pathname === "/engine-tools/call")?.body).toMatchObject({
      name: "ipollowork_browser_act",
      args: { actions },
    });
  });

});

describe("iPolloWorkExtensionsPreview semantic motion tools", () => {
  test("locks preset listing and mutation to the current Video Studio session", async () => {
    const fake = startFakeVideoStudio();
    const plugin = await iPolloWorkExtensionsPreview();

    const listed = JSON.parse(await plugin.tool.list_motion_presets.execute(
      { phase: "enter", tone: "modern" },
      { sessionID: fake.sessionID },
    ));
    expect(listed.presets[0].id).toBe("text.enter.rise");

    const mutated = JSON.parse(await plugin.tool.mutate_motion.execute(
      {
        operation: "upsert",
        targetSelector: "#headline",
        phase: "enter",
        presetId: "text.enter.rise",
        parameters: { intensity: 0.8 },
      },
      { sessionID: fake.sessionID },
    ));
    expect(mutated.mutation).toMatchObject({
      type: "mutate-motion",
      targetKind: "text",
      elementId: "headline",
      presetId: "text.enter.rise",
    });
    expect(fake.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pathname: `/api/projects/${fake.projectId}/motion-presets`,
        search: "?targetKind=text&phase=enter&tone=modern",
      }),
      expect.objectContaining({
        pathname: `/api/projects/${fake.projectId}/gsap-mutations/index.html`,
      }),
    ]));
  });
});
