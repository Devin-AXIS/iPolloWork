import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { videoModelStatusSchema, videoSubmitResultSchema } from "@ipollowork/types/video-generation";
import { createAuthorizationAccess, listAuthorizationServices, saveAuthorizationService, testAuthorizationService } from "./authorization-center.js";
import { callHeygenSubscriptionTool, HEYGEN_MCP_URL, heygenSubscriptionStatus, updateHeygenSubscription } from "./heygen-subscription.js";
import { completeMcpAuthorization, fetchMcpService } from "./mcp-authorization.js";
import { PROVIDER_FETCH_SYMBOL } from "./provider-fetch.js";
import { readRuntimeMcpConfig } from "./runtime-capability-store.js";
import { callVideoGenerationAction, pollVideoJobs } from "./extensions/video-generation.js";
import { getVideoJob, updateVideoJob } from "./extensions/video-jobs.js";
import type { ServerConfig } from "./types.js";
import { __test__ as vaultPaths } from "./authorization-runtime.js";

const roots: string[] = [];
const previousFetch: unknown = Reflect.get(globalThis, PROVIDER_FETCH_SYMBOL);
afterEach(async () => {
  if (previousFetch === undefined) Reflect.deleteProperty(globalThis, PROVIDER_FETCH_SYMBOL);
  else Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, previousFetch);
  for (const root of roots.splice(0)) {
    try { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch (error) {
      if (process.platform !== "win32" || !(error instanceof Error) || !["EBUSY", "EPERM"].includes(String(Reflect.get(error, "code")))) throw error;
    }
  }
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-heygen-subscription-"));
  roots.push(root);
  const config: ServerConfig = { host: "127.0.0.1", port: 3210, token: "token", hostToken: "host-token", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [], workspaces: [{ id: "workspace", name: "Workspace", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
  let registrationRejected = false, createLost = false, expiresIn = 3600, refreshes = 0;
  let plan = "creator";
  let rejection: { name: string; message: string } | undefined;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  // Captured from HeyGen's authenticated tools/list, whose inputs differ from the REST API.
  const inputs = {
    get_current_user: z.object({}).strict(),
    create_asset_upload: z.object({ filename: z.string(), contentType: z.string(), sizeBytes: z.number().int().positive() }).strict(),
    complete_asset_upload: z.object({ assetId: z.string() }).strict(),
    create_video_from_image: z.object({ image: z.object({ type: z.literal("asset_id"), asset_id: z.string() }), audioAssetId: z.string(),
      resolution: z.string(), aspectRatio: z.string(), fit: z.literal("contain"), outputFormat: z.literal("mp4"),
      expressiveness: z.literal("low"), motionPrompt: z.string(), title: z.string() }).strict(),
    get_video: z.object({ videoId: z.string() }).strict(),
  };
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.includes("oauth-protected-resource")) return json({ resource: HEYGEN_MCP_URL, authorization_servers: ["https://api2.heygen.com"], scopes_supported: ["openid", "profile", "email"] });
    if (url.pathname.includes("oauth-authorization-server")) return json({ issuer: "https://api2.heygen.com", authorization_endpoint: "https://api2.heygen.com/v1/oauth/authorize", token_endpoint: "https://api2.heygen.com/v1/oauth/token", registration_endpoint: "https://api2.heygen.com/v1/oauth/register", code_challenge_methods_supported: ["S256"] });
    if (url.pathname.endsWith("/register")) {
      if (registrationRejected) return json({ error: "invalid_client_metadata" }, 400);
      expect(JSON.parse(String(init?.body))).toMatchObject({ client_name: "iPolloWork", token_endpoint_auth_method: "none" });
      return json({ client_id: "own-ipollowork-client", token_endpoint_auth_method: "none" }, 201);
    }
    if (url.pathname.endsWith("/token")) {
      const params = new URLSearchParams(String(init?.body));
      expect(params.get("client_id")).toBe("own-ipollowork-client");
      if (params.get("grant_type") === "refresh_token") { refreshes++; expiresIn = 3600; }
      else expect(params.get("code_verifier")).toBeTruthy();
      return json({ access_token: `private-oauth-token-${refreshes}`, token_type: "Bearer", refresh_token: "private-refresh-token", expires_in: expiresIn });
    }
    if (url.origin === "https://assets.s3.amazonaws.com") {
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      expect(new Headers(init?.headers).has("x-api-key")).toBe(false);
      expect(init?.method).toBe("PUT");
      expect(init?.body).toBeInstanceOf(Blob);
      return new Response(null, { status: 200 });
    }
    expect(url.href).toBe(`${HEYGEN_MCP_URL}/`);
    expect(init?.redirect).toBe("error");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer private-oauth-token-${refreshes}`);
    for (const header of ["x-api-key", "x-heygen-source", "x-heygen-client-source", "x-ipollowork-host-token"]) expect(headers.has(header)).toBe(false);
    if (init?.method === "GET") return new Response(null, { status: 405 });
    const rpc = z.object({ id: z.union([z.number(), z.string()]).optional(), method: z.string(), params: z.unknown().optional() }).parse(JSON.parse(String(init?.body)));
    if (rpc.method.startsWith("notifications/")) return new Response(null, { status: 202 });
    let result: unknown;
    if (rpc.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "HeyGen fixture", version: "1" } };
    else if (rpc.method === "tools/list") result = { tools: Object.keys(inputs).map(name => ({ name, inputSchema: { type: "object" } })) };
    else {
      const params = z.object({ name: z.enum(["get_current_user", "create_asset_upload", "complete_asset_upload", "create_video_from_image", "get_video"]), arguments: z.record(z.string(), z.unknown()) }).parse(rpc.params);
      inputs[params.name].parse(params.arguments);
      calls.push({ name: params.name, args: params.arguments });
      if (params.name === "create_video_from_image" && createLost) throw new Error("Network lost after upstream accepted the create request");
      if (rejection?.name === params.name) return json({ jsonrpc: "2.0", id: rpc.id, result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: "plan_restricted", message: rejection.message } }) }] } });
      const data = params.name === "create_asset_upload" ? { asset_id: `asset-${calls.length}`, upload_url: "https://assets.s3.amazonaws.com/upload?signature=private", upload_headers: { "content-type": params.arguments.contentType } }
        : params.name === "create_video_from_image" ? { videoId: "subscription-video" } : params.name === "get_video" ? { status: "processing" } : { subscription: { plan } };
      result = { content: [{ type: "text", text: JSON.stringify({ data }) }] };
    }
    return json({ jsonrpc: "2.0", id: rpc.id, result });
  };
  Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, fetcher);
  const connect = async () => {
    const started = await updateHeygenSubscription(config, { action: "connect" }, "http://127.0.0.1:3210/mcp/oauth/callback");
    if (!("authorizationUrl" in started)) throw new Error("Missing authorize URL");
    const url = new URL(started.authorizationUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const callback = new URL("http://127.0.0.1:3210/mcp/oauth/callback");
    callback.searchParams.set("code", "user-approved-code");
    callback.searchParams.set("state", url.searchParams.get("state") ?? "");
    await completeMcpAuthorization(config, callback, fetcher);
    return callback;
  };
  return { root, config, calls, connect, get refreshes() { return refreshes; }, setExpiresIn: (value: number) => { expiresIn = value; }, rejectRegistration: () => { registrationRejected = true; }, loseCreate: () => { createLost = true; },
    setPlan: (value: string) => { plan = value; }, rejectTool: (name: string, message: string) => { rejection = { name, message }; } };
}

test("official PKCE login is encrypted, private to the host, replay safe and revocable without API fallback", async () => {
  const state = await setup();
  state.setPlan("free");
  await saveAuthorizationService(state.config, "heygen-video", { HEYGEN_API_KEY: "private-api-wallet-key" });
  const callback = await state.connect();
  const status = await heygenSubscriptionStatus(state.config);
  expect(status).toMatchObject({ connected: true, mode: "subscription" });
  expect(status.sessionId).toBeTruthy();
  const publicStatus = (await listAuthorizationServices(state.config)).find(item => item.id === "heygen-video");
  expect(publicStatus?.subscription).toEqual({ connected: true, mode: "subscription" });
  expect(JSON.stringify(publicStatus)).not.toContain("private-");
  expect(await readFile(vaultPaths.vaultPath(state.config), "utf8")).not.toContain("private-oauth-token");
  expect(await readRuntimeMcpConfig(state.config, "workspace")).toEqual({});
  await expect(completeMcpAuthorization(state.config, callback)).rejects.toThrow("invalid or expired");
  expect(await testAuthorizationService(state.config, "heygen-video")).toMatchObject({ ok: true, detail: expect.stringContaining("当前套餐：free") });
  expect(state.calls.map(call => call.name)).toEqual(["get_current_user"]);
  await updateHeygenSubscription(state.config, { action: "disconnect" }, "");
  expect(await heygenSubscriptionStatus(state.config)).toMatchObject({ connected: false, mode: "subscription" });
  const models = await callVideoGenerationAction(state.config, createAuthorizationAccess(state.config), "status", {}, {});
  expect(JSON.stringify(models)).not.toContain("heygen-avatar-iv");
});

test("failed registration keeps subscription selected even with a saved API wallet", async () => {
  const state = await setup();
  await saveAuthorizationService(state.config, "heygen-video", { HEYGEN_API_KEY: "private-api-wallet-key" });
  state.rejectRegistration();
  await expect(state.connect()).rejects.toThrow("白名单");
  expect(await heygenSubscriptionStatus(state.config)).toMatchObject({ mode: "subscription", connected: false });
});

test("transport accepts only the authorized resource's trailing-slash variant", async () => {
  const state = await setup();
  await state.connect();
  let fetched = false;
  const fetcher = async () => { fetched = true; return Response.json({}); };
  for (const target of ["https://other.example/mcp/v1/", `${HEYGEN_MCP_URL}/other`, `${HEYGEN_MCP_URL}/?redirect=other`]) {
    await expect(fetchMcpService(state.config, HEYGEN_MCP_URL, {}, fetcher, undefined, target)).rejects.toThrow("must match its authorized resource");
  }
  expect(fetched).toBe(false);
});

test("subscription refresh is shared by concurrent reads and retains the task binding", async () => {
  const state = await setup();
  state.setExpiresIn(1);
  await state.connect();
  const before = await heygenSubscriptionStatus(state.config);
  await Promise.all([1, 2].map(() => callHeygenSubscriptionTool(state.config, "get_current_user", {}, AbortSignal.timeout(5000), before.sessionId)));
  expect(state.refreshes).toBe(1);
  expect((await heygenSubscriptionStatus(state.config)).sessionId).toBe(before.sessionId);
});

test("Free plan status publishes 720p and 60 seconds, keeps RunningHub and shares account reads", async () => {
  const state = await setup();
  state.setPlan("free");
  await state.connect();
  await saveAuthorizationService(state.config, "runninghub-video", { RUNNINGHUB_API_KEY: "private-runninghub-key" });
  const authorization = createAuthorizationAccess(state.config);
  for (let index = 0; index < 2; index++) {
    const response = await callVideoGenerationAction(state.config, authorization, "status", {}, {});
    const { models } = videoModelStatusSchema.parse(response.result);
    expect(models.find(model => model.id === "heygen-avatar-iv")).toMatchObject({ plan: "free", billingMode: "subscription", avatarLimits: { resolution: "720p", maxDuration: 60 } });
    expect(models.some(model => model.id === "minimax-h3-avatar")).toBe(true);
    expect(JSON.stringify(models)).not.toContain("private-");
  }
  expect(state.calls.map(call => call.name)).toEqual(["get_current_user"]);
});

test("failed account checks block only HeyGen without pretending Free has no permission", async () => {
  const state = await setup();
  await state.connect();
  await saveAuthorizationService(state.config, "runninghub-video", { RUNNINGHUB_API_KEY: "private-runninghub-key" });
  state.rejectTool("get_current_user", "Account lookup temporarily failed");
  const response = await callVideoGenerationAction(state.config, createAuthorizationAccess(state.config), "status", {}, {});
  const { models } = videoModelStatusSchema.parse(response.result);
  expect(models.find(model => model.id === "heygen-avatar-iv")?.availabilityIssue).toContain("读取账户失败");
  expect(models.some(model => model.id === "minimax-h3-avatar")).toBe(true);
  expect(state.calls.map(call => call.name)).toEqual(["get_current_user"]);
});

test.each(["create_asset_upload", "create_video_from_image"])("MCP rejection retains the failing stage and safe provider reason (%s)", async name => {
  const state = await setup();
  await state.connect();
  state.rejectTool(name, 'Free plan only allows 720p; api_key=private-credential Bearer private-oauth-token https://heygen.com/private?signature=private');
  let failure: unknown;
  try {
    await callHeygenSubscriptionTool(state.config, name === "create_asset_upload" ? "create_asset_upload" : "create_video_from_image", name === "create_asset_upload"
      ? { filename: "portrait.png", contentType: "image/png", sizeBytes: 12 }
      : { image: { type: "asset_id", asset_id: "portrait" }, audioAssetId: "audio", resolution: "1080p", aspectRatio: "16:9", fit: "contain", outputFormat: "mp4", expressiveness: "low", motionPrompt: "人物自然讲述", title: "Test" }, AbortSignal.timeout(5000));
  } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  const message = failure instanceof Error ? failure.message : "";
  expect(message).toContain(name === "create_asset_upload" ? "申请素材上传失败" : "提交生成失败");
  expect(message).toContain("Free plan only allows 720p");
  expect(message).toContain("未改用 API 余额");
  expect(message).not.toContain("private");
  expect(state.calls).toHaveLength(1);
});

async function avatarInputs(state: Awaited<ReturnType<typeof setup>>, duration = 5) {
  await mkdir(join(state.root, "assets"));
  await mkdir(join(state.root, "video/session-one"), { recursive: true });
  await writeFile(join(state.root, "assets/person.png"), await sharp({ create: { width: 24, height: 32, channels: 3, background: "#888" } }).png().toBuffer());
  const samples = Math.round(8000 * duration);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  await writeFile(join(state.root, "video/session-one/voice.wav"), wav);
  await writeFile(join(state.root, "video/session-one/index.html"), `<main><audio data-ipw-voiceover="true" src="voice.wav" data-start="0" data-duration="${duration}"></audio></main>`);
  return { requestId: randomUUID(), model: "heygen-avatar-iv", operation: "reference", prompt: "人物自然讲述", imageRefs: "assets/person.png", audioRefs: "assets/voice.wav", ratio: "16:9", resolution: "1080p", duration: "5", avatarSource: "video-audio" };
}

test("Free preflight rejects the real 71.6-second narration before uploads or a queued task", async () => {
  const state = await setup();
  state.setPlan("free");
  await state.connect();
  await saveAuthorizationService(state.config, "heygen-video", { HEYGEN_API_KEY: "private-api-wallet-key" });
  const args = await avatarInputs(state, 71.576);
  const context = { workspaceId: "workspace", sessionId: "session-one" };
  await expect(callVideoGenerationAction(state.config, createAuthorizationAccess(state.config), "submit", args, context)).rejects.toThrow("最长 60 秒，当前为 71.6 秒");
  expect(state.calls.map(call => call.name)).toEqual(["get_current_user"]);
  await expect(getVideoJob(state.config, args.requestId, "workspace", "session-one")).rejects.toThrow();
});

test("Free requests use 720p despite stale 1080p input and reread the plan before generation", async () => {
  const state = await setup();
  await state.connect();
  const authorization = createAuthorizationAccess(state.config);
  // A cached paid plan cannot authorize a later Free submission.
  await callVideoGenerationAction(state.config, authorization, "status", {}, {});
  state.setPlan("free");
  const args = await avatarInputs(state);
  const response = await callVideoGenerationAction(state.config, authorization, "submit", args, { workspaceId: "workspace", sessionId: "session-one" });
  const queued = videoSubmitResultSchema.parse(response.result).job;
  expect(queued.avatarInput?.resolution).toBe("720p");
  expect(state.calls.filter(call => call.name === "get_current_user")).toHaveLength(2);
  expect(state.calls.some(call => call.name === "create_asset_upload")).toBe(false);
  await pollVideoJobs(state.config, authorization);
  expect(state.calls.filter(call => call.name === "get_current_user")).toHaveLength(3);
  expect(state.calls.find(call => call.name === "create_video_from_image")?.args.resolution).toBe("720p");
});

test("a plan downgrade blocks an already queued long clip before any provider upload", async () => {
  const state = await setup();
  await state.connect();
  const args = await avatarInputs(state, 71.576);
  const authorization = createAuthorizationAccess(state.config);
  await callVideoGenerationAction(state.config, authorization, "submit", args, { workspaceId: "workspace", sessionId: "session-one" });
  state.setPlan("free");
  await pollVideoJobs(state.config, authorization);
  const job = await getVideoJob(state.config, args.requestId, "workspace", "session-one");
  expect(job.status).toBe("failed");
  expect(job.message).toContain("最长 60 秒");
  expect(state.calls.some(call => call.name === "create_asset_upload")).toBe(false);
});

test("a definitive HeyGen rejection keeps its reason in the task and never retries or uses API funds", async () => {
  const state = await setup();
  state.setPlan("free");
  await state.connect();
  await saveAuthorizationService(state.config, "heygen-video", { HEYGEN_API_KEY: "private-api-wallet-key" });
  const args = await avatarInputs(state);
  const authorization = createAuthorizationAccess(state.config);
  await callVideoGenerationAction(state.config, authorization, "submit", args, { workspaceId: "workspace", sessionId: "session-one" });
  state.rejectTool("create_video_from_image", "insufficient_credits: Free video quota exhausted");
  await pollVideoJobs(state.config, authorization);
  const job = await getVideoJob(state.config, args.requestId, "workspace", "session-one");
  expect(job.status).toBe("failed");
  expect(job.message).toContain("提交生成失败");
  expect(job.message).toContain("Free video quota exhausted");
  expect(job.message).toContain("未改用 API 余额");
  await pollVideoJobs(state.config, authorization);
  expect(state.calls.filter(call => call.name === "create_video_from_image")).toHaveLength(1);
});

test.each([false, true])("subscription avatar task uploads privately and never repeats a lost create (lost=%s)", async lost => {
  const state = await setup();
  await state.connect();
  if (lost) state.loseCreate();
  const args = await avatarInputs(state);
  const authorization = createAuthorizationAccess(state.config);
  const context = { workspaceId: "workspace", sessionId: "session-one" };
  const id = args.requestId;
  const result = await callVideoGenerationAction(state.config, authorization, "submit", args, context);
  const queued = videoSubmitResultSchema.parse(result.result).job;
  expect(queued.heygenBilling).toMatchObject({ mode: "subscription" });
  expect(state.calls.map(call => call.name)).toEqual(["get_current_user"]);
  // Changing the preference does not change the channel of this queued task.
  await updateHeygenSubscription(state.config, { action: "use-api-key" }, "");
  await pollVideoJobs(state.config, authorization);
  let job = await getVideoJob(state.config, id, "workspace", "session-one");
  expect(job.status).toBe(lost ? "uncertain" : "running");
  expect(state.calls.filter(call => call.name === "create_asset_upload")).toHaveLength(2);
  expect(state.calls.filter(call => call.name === "create_video_from_image")).toHaveLength(1);
  expect(state.calls.find(call => call.name === "create_video_from_image")?.args).toMatchObject({ image: { type: "asset_id" }, audioAssetId: expect.any(String), resolution: "1080p" });
  if (!lost) await updateVideoJob(state.config, job, { nextPoll: 0 });
  await pollVideoJobs(state.config, authorization);
  expect(state.calls.filter(call => call.name === "create_video_from_image")).toHaveLength(1);
  if (!lost) {
    expect(state.calls.filter(call => call.name === "get_video")).toHaveLength(1);
    await updateHeygenSubscription(state.config, { action: "disconnect" }, "");
    job = await getVideoJob(state.config, id, "workspace", "session-one");
    await updateVideoJob(state.config, job, { nextPoll: 0 });
    await pollVideoJobs(state.config, authorization);
    expect(state.calls.filter(call => call.name === "get_video")).toHaveLength(1);
  }
});
