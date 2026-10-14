import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createiPolloWorkServerClient, type iPolloWorkExtensionActionCall } from "../src/app/lib/ipollowork-server";
import { createVideoLiveDirector, readVideoJevAdvice } from "../src/react-app/domains/session/video/video-live-director";
import type { ConversationPromptPart } from "../src/react-app/domains/session/engine/conversation-engine";
import type { VideoLivePreviewMessage } from "@ipollowork/types/hyperframes";

const context = { workspaceId: "video-workspace", sessionId: "video-session" };
const client = createiPolloWorkServerClient({ baseUrl: "http://127.0.0.1:9876", token: "host-test-token" });
const calls: iPolloWorkExtensionActionCall[] = [];
const restorers: Array<() => void> = [];
afterEach(() => { for (const restore of restorers.splice(0)) restore(); calls.length = 0; });
const choice = (id: string, confidence = 0.95) => ({ type: "choice", choice: id, confidence, probabilities: { [id]: 1 } });
const ok = (action: string, result: unknown) => Response.json({ ok: true, extensionId: "jev-decision-model", action, result });
function provider(evaluate: (call: iPolloWorkExtensionActionCall) => Response | Promise<Response>, configured = true) {
  const mock = spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const call: iPolloWorkExtensionActionCall = JSON.parse(String(init?.body));
    calls.push(call);
    return call.action === "status" ? ok("status", { configured }) : evaluate(call);
  });
  restorers.push(() => mock.mockRestore());
}
function preview(duration = 4, id = "live-run"): VideoLivePreviewMessage {
  return { type: "ipollowork:video-live-preview", projectId: "video-session", generation: { id, status: "generating", readyDuration: duration }, playhead: duration };
}
const parts = (text: string): ConversationPromptPart[] => [{ type: "text", text }];

describe("Jev video direction routing", () => {
  test("classifies guidance without selecting or simplifying the opening", async () => {
    provider(() => ok("evaluate", { answers: { route: choice("content") }, explanation: "untrusted arbitrary output" }));
    const advice = await readVideoJevAdvice(client, context, { phase: "steering", prompt: "做一个产品介绍视频" });
    expect(advice).toContain("requested text, narrative or media");
    expect(advice).not.toContain("untrusted arbitrary output");
    expect(calls.map(call => call.action)).toEqual(["status", "evaluate"]);
    expect(calls[1].context).toEqual(context);
    expect(calls[1].args?.state).toEqual({ phase: "steering", request: "做一个产品介绍视频" });
    expect(JSON.stringify(calls[1].args)).not.toContain("host-test-token");
    expect(JSON.stringify(calls[1].args)).not.toContain("video-workspace");
  });

  test.each(["parameters", "content", "structure"])("maps %s to a bounded production instruction", async route => {
    provider(() => ok("evaluate", { answers: { route: choice(route), relation: choice("replace") } }));
    const advice = await readVideoJevAdvice(client, context, { phase: "steering", prompt: "后面改成使用案例", previousDirection: "后面继续介绍功能" });
    expect(advice).toContain("unpublished");
    expect(advice).toContain("Drop only those conflicts");
    expect(Object.keys(calls[1].args?.questions ?? {})).toEqual(["route", "relation"]);
  });

  test.each([
    choice("parameters", 0.6), choice("unknown"), { ...choice("parameters"), probabilities: { parameters: 0.3 } },
    { ...choice("parameters"), confidence: 2 }, { ...choice("parameters"), type: "text" }, null,
  ])("ignores uncertain or invalid answers", async answer => {
    provider(() => ok("evaluate", { answers: { route: answer } }));
    expect(await readVideoJevAdvice(client, context, { phase: "steering", prompt: "慢一点" })).toBe("");
  });

  test("unconfigured plugins do not make an inference call", async () => {
    provider(() => { throw new Error("must not evaluate"); }, false);
    expect(await readVideoJevAdvice(client, context, { phase: "steering", prompt: "慢一点" })).toBe("");
    expect(calls.map(call => call.action)).toEqual(["status"]);
  });

  test("missing plugins, rate limits, and errors preserve the original path", async () => {
    provider(() => Response.json({ ok: false, error: "rate_limited", message: "busy" }, { status: 429 }));
    const sent: ConversationPromptPart[][] = [];
    const director = createVideoLiveDirector({ client, context, send: async input => { sent.push(input); } });
    expect(await director.steer(parts("后面改成蓝色"), () => preview())).toBe(true);
    expect(sent[0][0]).toEqual({ type: "text", text: "后面改成蓝色" });
    expect(JSON.stringify(sent)).toContain("published through 4.00s");
    expect(JSON.stringify(sent)).not.toContain("Jev production advice");
  });

  test("enforces the one-second decision budget even when the transport ignores cancellation", async () => {
    provider(() => new Promise<Response>(() => {}));
    const start = performance.now();
    expect(await readVideoJevAdvice(client, context, { phase: "steering", prompt: "慢一点" })).toBe("");
    expect(performance.now() - start).toBeLessThan(2_000);
  });

  test("skips oversized text, absent clients, and attachment contents", async () => {
    provider(() => { throw new Error("must not evaluate"); });
    expect(await readVideoJevAdvice(client, context, { phase: "steering", prompt: "x".repeat(4_001) })).toBe("");
    expect(await readVideoJevAdvice(null, context, { phase: "steering", prompt: "生成视频" })).toBe("");
    const sent: ConversationPromptPart[][] = [];
    const director = createVideoLiveDirector({ client, context, send: async input => { sent.push(input); } });
    await director.steer([...parts("参考这个文件"), { type: "file", mime: "text/plain", url: "file:///private.txt" }], () => preview());
    expect(calls).toHaveLength(0);
    expect(sent[0]).toHaveLength(3);
    await director.steer([...parts("参考这个文件"), { type: "text", text: "private file contents", synthetic: true }], () => preview());
    await director.steer(parts("pasted private contents"), () => preview(), null);
    expect(calls).toHaveLength(0);
  });

  test("reads the latest publication after Jev returns instead of freezing an obsolete prefix", async () => {
    let current = preview();
    provider(() => { current = preview(8); return ok("evaluate", { answers: { route: choice("content") } }); });
    const sent: ConversationPromptPart[][] = [];
    const director = createVideoLiveDirector({ client, context, send: async input => { sent.push(input); } });
    await director.steer(parts("后面展示案例"), () => current);
    expect(JSON.stringify(sent)).toContain("published through 8.00s");
    expect(JSON.stringify(sent)).toContain("Jev production advice");
  });

  test("rapid directions cancel old advice and reach the native engine in input order", async () => {
    let startFirst: (() => void) | undefined;
    const started = new Promise<void>(resolve => { startFirst = resolve; });
    provider(call => {
      if (JSON.stringify(call.args?.state).includes("红色")) { startFirst?.(); return new Promise<Response>(() => {}); }
      return ok("evaluate", { answers: { route: choice("parameters") } });
    });
    const sent: ConversationPromptPart[][] = [];
    const director = createVideoLiveDirector({ client, context, send: async input => { sent.push(input); } });
    const first = director.steer(parts("后面改成红色"), () => preview());
    await started;
    const second = director.steer(parts("后面还是改成蓝色"), () => preview());
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(sent.map(input => input[0])).toEqual([{ type: "text", text: "后面改成红色" }, { type: "text", text: "后面还是改成蓝色" }]);
    expect(JSON.stringify(sent[0])).not.toContain("Jev production advice");
  });

  test("late results cannot steer a different generation or a departed session", async () => {
    let current = preview();
    const sent: ConversationPromptPart[][] = [];
    const director = createVideoLiveDirector({ client, context, send: async input => { sent.push(input); } });
    provider(() => { current = preview(4, "replacement-run"); return ok("evaluate", { answers: { route: choice("content") } }); });
    expect(await director.steer(parts("后面展示案例"), () => current)).toBe(false);
    const pending = director.steer(parts("后面改成蓝色"), () => current);
    director.cancel();
    expect(await pending).toBe(false);
    expect(sent).toHaveLength(0);
  });

  test("retains previous directions within one run and clears them for the next run", async () => {
    provider(() => ok("evaluate", { answers: { route: choice("parameters"), relation: choice("supplement") } }));
    let current = preview();
    const director = createVideoLiveDirector({ client, context, send: async () => {} });
    await director.steer(parts("后面改成蓝色"), () => current);
    await director.steer(parts("再慢一点"), () => current);
    expect(calls[3].args?.state).toEqual({ phase: "steering", request: "再慢一点", previous_direction: "后面改成蓝色" });
    current = preview(4, "new-run");
    await director.steer(parts("生成新故事"), () => current);
    expect(JSON.stringify(calls.at(-1)?.args?.state)).not.toContain("previous_direction");
  });
});
