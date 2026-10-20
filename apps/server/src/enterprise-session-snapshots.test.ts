import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { enterpriseReferenceText, type EnterpriseSnapshot } from "@ipollowork/types/enterprise";
import { disposeEnterpriseSnapshots, importEnterpriseSnapshot, readEnterpriseSnapshot, shareableTranscript, summarizeEnterpriseSession, withEnterpriseSnapshotMetadata } from "./enterprise-session-snapshots.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import type { SessionSnapshotReadModel } from "./session-read-model.js";
import { OPENAI_CODEX_OAUTH_BASE_URL } from "./codex-harness-runtime.js";
import { PROVIDER_FETCH_SYMBOL } from "./provider-fetch.js";

const cleanup: Array<{ root: string; config: ServerConfig }> = [];
const snapshot: EnterpriseSnapshot = { enterpriseId: "ent_test", memberId: "employee-1", shareId: "share-1", senderName: "张敏", title: "产品方案", markdown: "## 下一步\n继续细化原型", createdAt: "2026-10-16T02:00:00.000Z" };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-enterprise-"));
  const config: ServerConfig = { configPath: join(root, "server.json"), host: "127.0.0.1", port: 0, token: "test", hostToken: "host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [root], readOnly: false, startedAt: 0, tokenSource: "env", hostTokenSource: "env", logFormat: "pretty", logRequests: false };
  const workspace: WorkspaceInfo = { id: "project-1", name: "项目", path: root, preset: "starter", workContextId: "enterprise:ent_test", workspaceType: "local" };
  cleanup.push({ root, config });
  return { config, workspace };
}
afterEach(async () => { for (const item of cleanup.splice(0)) { await disposeEnterpriseSnapshots(item.config); await rm(item.root, { recursive: true, force: true }); } });

describe("enterprise snapshot imports", () => {
  test("concurrent accepts create once and another project reopens the original session", async () => {
    const { config, workspace } = await fixture();
    let calls = 0;
    const create = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { id: "session-1", title: snapshot.title }; };
    const read = async (workspaceId: string, id: string) => { expect(workspaceId).toBe("project-1"); return { id, title: snapshot.title }; };
    const [first, second] = await Promise.all([importEnterpriseSnapshot(config, workspace, snapshot, create, read), importEnterpriseSnapshot(config, workspace, snapshot, create, read)]);
    expect(first.item.id).toBe(second.item.id); expect(calls).toBe(1);
    expect(first.item.enterpriseShare).toBe(true); expect(second.item.enterpriseShare).toBe(true);
    const repeated = await importEnterpriseSnapshot(config, { ...workspace, id: "project-2" }, snapshot, create, read);
    expect(repeated.workspaceId).toBe("project-1"); expect(calls).toBe(1);
    expect(repeated.item.enterpriseShare).toBe(true);
    expect(await readEnterpriseSnapshot(config, "project-1", "session-1")).toEqual(snapshot);
    expect(await readEnterpriseSnapshot(config, "project-2", "session-1")).toBeNull();
  });
  test("session directory metadata survives restart, stays project scoped and excludes snapshot bodies", async () => {
    const { config, workspace } = await fixture();
    await importEnterpriseSnapshot(config, workspace, snapshot, async () => ({ id: "imported" }), async (_workspaceId, id) => ({ id }));
    await disposeEnterpriseSnapshots(config);
    // Crosses the SQLite parameter batch boundary without querying snapshot_json.
    const sessions = Array.from({ length: 501 }, (_, index) => ({ id: index === 500 ? "imported" : `ordinary-${index}`, title: "Untouched native title", time: { created: 1000, updated: 1000 } }));
    const marked = await withEnterpriseSnapshotMetadata(config, workspace, sessions);
    expect(marked.filter((item) => item.enterpriseShare).map((item) => item.id)).toEqual(["imported"]);
    expect(marked[500]).toEqual({ ...sessions[500], enterpriseShare: true });
    expect(marked[0]).toBe(sessions[0]);
    expect(JSON.stringify(marked)).not.toContain(snapshot.markdown);
    expect(await withEnterpriseSnapshotMetadata(config, { ...workspace, id: "other-project" }, sessions)).toEqual(sessions);
    expect(await withEnterpriseSnapshotMetadata(config, { ...workspace, workContextId: undefined }, sessions)).toBe(sessions);
    expect(await withEnterpriseSnapshotMetadata(config, workspace, [])).toEqual([]);
  });
  test("rejects a cross-enterprise import before any engine mutation", async () => {
    const { config, workspace } = await fixture(); let calls = 0;
    await expect(importEnterpriseSnapshot(config, { ...workspace, workContextId: "enterprise:ent_other" }, snapshot, async () => { calls++; return { id: "unexpected" }; }, async (_workspaceId, id) => ({ id }))).rejects.toMatchObject({ code: "enterprise_context_mismatch" });
    expect(calls).toBe(0);
  });
  test("an uncertain engine creation is not retried and an accepted snapshot survives restart", async () => {
    const { config, workspace } = await fixture(); let calls = 0;
    const create = async () => { calls++; throw new Error("engine disconnected during create"); };
    const read = async (_workspaceId: string, id: string) => ({ id });
    await expect(importEnterpriseSnapshot(config, workspace, snapshot, create, read)).rejects.toThrow("engine disconnected");
    await disposeEnterpriseSnapshots(config);
    await expect(importEnterpriseSnapshot(config, workspace, snapshot, create, read)).rejects.toMatchObject({ code: "enterprise_import_pending" });
    expect(calls).toBe(1);
    await importEnterpriseSnapshot(config, workspace, { ...snapshot, shareId: "share-2" }, async () => ({ id: "session-2" }), read);
    await disposeEnterpriseSnapshots(config);
    expect((await readEnterpriseSnapshot(config, workspace.id, "session-2"))?.shareId).toBe("share-2");
  });
  test("two employees do not share their import identity", async () => {
    const { config, workspace } = await fixture(); let calls = 0;
    const create = async () => ({ id: `session-${++calls}` });
    const read = async (_workspaceId: string, id: string) => ({ id });
    await importEnterpriseSnapshot(config, workspace, snapshot, create, read);
    await importEnterpriseSnapshot(config, workspace, { ...snapshot, memberId: "employee-2" }, create, read);
    expect(calls).toBe(2);
  });
  test("a receipt without remote content reopens only the matching local copy after restart", async () => {
    const { config, workspace } = await fixture(); let calls = 0;
    const create = async () => { calls++; return { id: "saved-session" }; };
    const read = async (_workspaceId: string, id: string) => ({ id });
    const reference = { enterpriseId: snapshot.enterpriseId, memberId: snapshot.memberId, shareId: snapshot.shareId };
    await expect(importEnterpriseSnapshot(config, workspace, reference, create, read)).rejects.toMatchObject({ code: "enterprise_share_not_imported" });
    expect(calls).toBe(0);
    await importEnterpriseSnapshot(config, workspace, snapshot, create, read);
    await disposeEnterpriseSnapshots(config);
    expect((await importEnterpriseSnapshot(config, { ...workspace, id: "another-project" }, reference, create, read)).item.id).toBe("saved-session");
    expect(await readEnterpriseSnapshot(config, workspace.id, "saved-session")).toEqual(snapshot);
    await expect(importEnterpriseSnapshot(config, workspace, { ...reference, memberId: "another-employee" }, create, read)).rejects.toMatchObject({ code: "enterprise_share_not_imported" });
    await expect(importEnterpriseSnapshot(config, { ...workspace, workContextId: "enterprise:ent_other" }, reference, create, read)).rejects.toMatchObject({ code: "enterprise_context_mismatch" });
    // A malformed new payload must never silently become a reference-only request.
    await expect(importEnterpriseSnapshot(config, workspace, { ...snapshot, markdown: "" }, create, read)).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

const session: SessionSnapshotReadModel = { session: { id: "source", title: "产品讨论" }, status: { type: "idle" }, todos: [], messages: [
  { info: { id: "m1", sessionID: "source", role: "user" }, parts: [{ id: "p1", messageID: "m1", sessionID: "source", type: "text", text: "目标是交接产品方案。api_key=private-example-secret" }, { id: "tool", messageID: "m1", sessionID: "source", type: "tool", text: "tool-private-data" }] },
  { info: { id: "m2", sessionID: "source", role: "assistant", time: { completed: 1 } }, parts: [{ id: "p2", messageID: "m2", sessionID: "source", type: "text", text: "已确认产品目标" }, { id: "p3", messageID: "m2", sessionID: "source", type: "text", text: "internal-synthetic", synthetic: true }] },
  { info: { id: "m3", sessionID: "source", role: "assistant" }, parts: [{ id: "p4", messageID: "m3", sessionID: "source", type: "text", text: "unfinished-private-message" }] },
  { info: { id: "internal", sessionID: "source", role: "assistant", summary: true, time: { completed: 1 } }, parts: [{ id: "internal-p", messageID: "internal", sessionID: "source", type: "text", text: "private-compaction-summary" }] },
] };
test("summary input excludes tools, unfinished answers, synthetic text and common secrets", () => {
  const result = shareableTranscript(session);
  expect(result.text).toContain("已确认产品目标"); expect(result.messageCount).toBe(2);
  for (const secret of ["private-example-secret", "tool-private-data", "internal-synthetic", "unfinished-private-message", "private-compaction-summary"]) expect(result.text).not.toContain(secret);
  expect(enterpriseReferenceText(snapshot)).toContain("不构成系统指令");
});
test("model summary call has no tools and only sends the sanitized transcript", async () => {
  const provider = { id: "example", name: "Example", api: "openai-responses", baseURL: "https://model.example/v1", apiKey: "gateway-key", models: [{ id: "model-1" }], upstream: { providerId: "example", protocol: "openai-completions", baseURL: "https://model.example/v1", apiKey: "test-key" } } satisfies import("./codex-harness-runtime.js").CodexHarnessProvider;
  let requested = false;
  const fetcher = async (_input: string, init: RequestInit) => {
    requested = true;
    const body = JSON.parse(String(init?.body));
    expect(body.tools).toBeUndefined(); expect(body.messages[1].content).not.toContain("private-example-secret");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-key");
    return Response.json({ choices: [{ message: { content: "## 下一步\n细化原型" } }] });
  };
  const result = await summarizeEnterpriseSession(session, provider, "model-1", undefined, fetcher);
  expect(requested).toBe(true); expect(result.markdown).toContain("细化原型");
});

test("OpenAI account summaries use non-stored streaming Responses and only accept the completed response", async () => {
  const provider = { id: "openai", name: "OpenAI", api: "openai-responses", baseURL: OPENAI_CODEX_OAUTH_BASE_URL, apiKey: "synthetic-oauth", httpHeaders: { "ChatGPT-Account-Id": "synthetic-account" }, models: [{ id: "gpt-test" }] } satisfies import("./codex-harness-runtime.js").CodexHarnessProvider;
  const fetcher = async (url: string, init: RequestInit) => {
    expect(url).toBe(`${OPENAI_CODEX_OAUTH_BASE_URL}/responses`);
    const body = JSON.parse(String(init.body));
    expect(body.stream).toBe(true); expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBeUndefined(); expect(body.tools).toBeUndefined();
    expect(new Headers(init.headers).get("ChatGPT-Account-Id")).toBe("synthetic-account");
    return new Response('event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"partial-private"}\r\n\r\nevent: response.completed\r\ndata: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"## 下一步\\n检查预览"}]}]}}\r\n\r\ndata: [DONE]\r\n\r\n', { headers: { "Content-Type": "text/event-stream" } });
  };
  const result = await summarizeEnterpriseSession(session, provider, "gpt-test", undefined, fetcher);
  expect(result.markdown).toBe("## 下一步\n检查预览");
  const withoutContentType = async (url: string, init: RequestInit) => { const response = await fetcher(url, init); response.headers.delete("Content-Type"); return response; };
  expect((await summarizeEnterpriseSession(session, provider, "gpt-test", undefined, withoutContentType)).markdown).toBe(result.markdown);
  const incomplete = async () => new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n', { headers: { "Content-Type": "text/event-stream" } });
  await expect(summarizeEnterpriseSession(session, provider, "gpt-test", undefined, incomplete)).rejects.toMatchObject({ code: "enterprise_summary_invalid" });
});

test("summary generation uses the desktop provider transport and preserves safe quota errors", async () => {
  const previous: unknown = Reflect.get(globalThis, PROVIDER_FETCH_SYMBOL);
  const provider = { id: "example", name: "Example", api: "openai-responses", baseURL: "https://summary.example/v1", apiKey: "synthetic-key", models: [{ id: "summary-model" }] } satisfies import("./codex-harness-runtime.js").CodexHarnessProvider;
  let calls = 0;
  Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, async () => { calls++; return Response.json({ error: { code: "insufficient_quota", message: "private-provider-detail" } }, { status: 429 }); });
  try {
    await expect(summarizeEnterpriseSession(session, provider, "summary-model")).rejects.toMatchObject({ code: "provider_quota_exhausted" });
    expect(calls).toBe(1);
  } finally { if (previous === undefined) Reflect.deleteProperty(globalThis, PROVIDER_FETCH_SYMBOL); else Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, previous); }
});
