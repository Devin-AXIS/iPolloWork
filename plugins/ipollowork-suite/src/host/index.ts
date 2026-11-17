import { discoverMarket } from './market-discovery.ts';
import type {} from './cloud/index.ts';
import { z as cloudSchema } from 'zod';
import { mountEnterpriseActivity } from "./enterprise-activity.ts";
/** One native Cordis plugin owns the suite's HTTP routes and domain services. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import semver from "semver";
import { ZodError } from "zod";
import packageInfo from "../../package.json" with { type: "json" };
import type { MarketEntry, CredentialStore } from "../shared/types.ts";
import { membershipSchema, membershipOrderSchema, membershipCheckoutSchema } from "../shared/membership.ts";
import { initializeAccountModel } from "./default-model.ts";
import { mountServiceModels } from "./service-models.ts";
import { mountEnterpriseMcp, type EnterpriseMcpScope } from "./enterprise-mcp.ts";
import { mountOutputContinuation } from "./output-continuation.ts";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent-default-model";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import { Services } from "./services.ts";
import type { ServiceCenter, ServiceChoice } from "../shared/services.ts";
import { AccountService, publicAccountState } from "./account.ts";
import { mountCapabilityTools } from "./capability-tools.ts";
import {
  sharingStatus,
  nativeShareAudience,
  configureNativeSharing,
  prepareNativeShare,
  createNativeShare,
  authorizeNativeShare,
  stopNativeShare,
  type NativeSharing,
} from "./native-sharing.ts";
import { mountProjectContext, type MemoryContext } from "./project-context.ts";
import {
  ProjectArchive,
  type ArchiveContext,
  type ArchiveSession,
} from "./project-archive.ts";
import { EnterpriseService, type EnterpriseNative } from "./enterprise.ts";
import {
  mountEnterpriseSkills,
  type EnterpriseSkillScope,
} from "./enterprise-skills.ts";
import { Config, resolveConfig, type Config as ConfigInput } from "./config.ts";
import { AppDataService, appDataRoute, appDataTool, APP_DATA_SKILL } from "./app-data.ts";
import type { IpolloData } from "../shared/app-data.ts";
import { readMarket, type NativePluginManager } from "./market.ts";
import { BRAND_PATH, brandIndex, serveBrand } from "./brand.ts";
import { AppDataRejection, SuiteError } from "./errors.ts";
import {
  blocksSuiteManagement,
  MANAGEMENT_DENIAL,
  type ToolCall,
  type Decision,
} from "./management.ts";
import * as NativeConnection from "@deepseek-ai/dsh-client-connection";
export { Config };
export const name = "ipollowork-suite";
export const inject = [
  "webServer",
  "connection",
  ...("ConnectionAuthentication" in NativeConnection ? ["connection.authentication"] : []),
  "credentials",
  "pluginManager",
  "profileContext",
  "workspaceRegistry",
  "sessionQuery",
  "systemPrompt",
  "tools",
  "fs",
];
const API = "/ipollowork-suite";
export interface HostContext extends EnterpriseNative, MemoryContext {
  fs: ArchiveContext["fs"];
  logger: ArchiveContext["logger"];
  inject?(
    names: ["skills"] | ["skills", "ipolloAppDataFeature"],
    callback: (scope: EnterpriseSkillScope) => void,
  ): unknown;
  inject?(names: ["mcpManager"], callback: (scope: EnterpriseMcpScope) => void): unknown;
  inject?(names: string[], callback: (scope: Context) => void): unknown;
  provide?(name: "ipolloServices", value: ServiceCenter): void;
  provide?(name: "ipolloData", value: IpolloData): void;
  provide?(name: "ipolloStage", value: import('../shared/stage.ts').StageBridge): void;
  get?(name: "ipolloCloud"): unknown;
  get?(name: "liveshareShares"): NativeSharing | undefined;
  on(
    event: "agent/pre-step",
    listener: (
      event: { agent: object & { session: { header: { cwd?: string } } } },
      next: () => Promise<unknown>,
    ) => Promise<unknown>,
  ): unknown;
  on(
    event: "session/event",
    listener: (
      session: ArchiveSession,
      event: { type: string; data: unknown },
    ) => void,
  ): unknown;
  on(
    event: "agent/created",
    listener: (event: { agent: { session: ArchiveSession } }) => void,
  ): unknown;
  effect(
    effect: () => void | (() => void | Promise<void>),
    label?: string,
  ): unknown;
  on(
    event: "tools/pre-execute",
    listener: (
      call: ToolCall,
      next: () => Promise<Decision>,
    ) => Promise<Decision>,
  ): () => void;
  fiber: { entry?: { id: string } };
  webServer: {
    getOrigin?(): string;
    register(route: {
      kind: "prefix";
      path: string;
      auth?: "anonymous";
      handler(
        request: IncomingMessage,
        response: ServerResponse,
      ): Promise<void>;
    }): () => void;
    tapIndex(transform: (html: string) => string): () => void;
  };
  connection: {
    admit(request: IncomingMessage): { rejection: number } | { peer: object };
  };
  credentials: CredentialStore;
  pluginManager: NativePluginManager;
  profileContext: { installAnchor: string; home: string };
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage, limit = 16384): Promise<unknown> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) throw new SuiteError("IPW_REQUEST_TOO_LARGE", 413);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (cause) {
    throw new SuiteError("IPW_INVALID_INPUT", 400, { cause });
  }
}
/** Read a multipart upload of at most 25 MiB, the account service's file limit plus form overhead. */
async function readForm(request: IncomingMessage): Promise<FormData> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > 25 * 1024 * 1024)
      throw new SuiteError("IPW_FILE_TOO_LARGE", 413);
    chunks.push(value);
  }
  return new Response(Buffer.concat(chunks), {
    headers: { "Content-Type": request.headers["content-type"] ?? "" },
  }).formData();
}
/** Stream a user-selected file with backpressure; the account service enforces the project quota. */
function uploadBody(request: IncomingMessage): ReadableStream<Uint8Array> {
  const iterator = request[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      try {
        const part = await iterator.next();
        if (part.done) controller.close();
        else controller.enqueue(Buffer.from(part.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
/** Stream an authorized download with backpressure; signed OSS URLs redirect directly. */
async function relayDownload(
  result: Response,
  response: ServerResponse,
  maxBytes: number,
): Promise<void> {
  if (result.headers.get("content-type")?.includes("application/json")) {
    const value = (await result.json()) as { url?: string };
    if (!value.url || new URL(value.url).protocol !== "https:")
      throw new SuiteError("IPW_INVALID_RESPONSE", 502);
    response.writeHead(303, { Location: value.url });
    response.end();
    return;
  }
  const reader = result.body?.getReader();
  if (!reader) throw new SuiteError("IPW_FILE_TRANSFER_FAILED", 502);
  const length = Number(result.headers.get("content-length"));
  if (length > maxBytes) {
    await reader.cancel();
    throw new SuiteError("IPW_FILE_TOO_LARGE", 413);
  }
  const disposition = result.headers.get("content-disposition");
  response.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": disposition?.startsWith("attachment")
      ? disposition
      : "attachment",
    "Cache-Control": "private, no-store",
  });
  let bytes = 0;
  const source = Readable.from(
    (async function* () {
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > maxBytes) throw new SuiteError("IPW_FILE_TOO_LARGE", 413);
          yield part.value;
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    })(),
  );
  await pipeline(source, response);
}
/** Mount the suite without changing DSH's model, session, or plugin-management implementation. */
export function apply(ctx: HostContext, input: ConfigInput): void {
  const config = resolveConfig(input);
  ctx.on("tools/pre-execute", async (call, next) =>
    config.dedicatedDesktop && blocksSuiteManagement(call, ctx.fiber.entry?.id)
      ? MANAGEMENT_DENIAL
      : next(),
  );
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort(), "ipollowork-suite: requests");
  const account = new AccountService(ctx.credentials, config, lifetime.signal);
  if (config.account) ctx.provide?.("ipolloStage", {
    request: async (action: string, input?: unknown, signal?: AbortSignal) => {
      const paths = new Set(["status", "connect", "disconnect", "launch", "catalog", "document", "generate", "export", "task", "source"]);
      if (!paths.has(action)) throw new SuiteError("IPW_INVALID_INPUT", 400);
      return account.request("/api/v1/stage/" + action, input, action === "status" ? "GET" : "POST", signal,{timeoutMs:config.uploadTimeoutMs,maximum:12*1024*1024});
    },
    download:async(id:string,signal?:AbortSignal)=>{
      if(!/^[a-f0-9]{32}$/.test(id))throw new SuiteError('IPW_INVALID_INPUT',400);
      return account.transfer('/api/v1/stage/download/'+id,undefined,signal);
    },
  });
  ctx.inject?.(["tools", "sandboxPolicy"], scope => mountCapabilityTools(scope, account, config.uploadTimeoutMs));
  let refreshModels = async () => {};
  let refreshSkills = async () => {};
  let refreshMcp = async () => {};
  // Account changes and enterprise grant edits change both the official model list and the granted enterprise skills.
  const refreshAccount = async () => {
    await Promise.all([refreshModels(), refreshSkills(), refreshMcp()]);
  };
  const services = new Services(
    account,
    ctx.credentials,
    lifetime.signal,
    config.account,
  );
  ctx.provide?.("ipolloServices", services);
  if (config.account && config.enterpriseUsageReporting)
    ctx.inject?.(["tools"], scope => mountEnterpriseActivity(scope, account, config.accountOrigin, config.enterpriseUsageQueueLimit));
  const appData = new AppDataService(account);
  // App data is the optional `ipollowork-app-data` entry of this bundle; the service, tool, skill and routes follow it.
  let appDataEnabled = false;
  if (config.account) {
    ctx.inject?.(["ipolloAppDataFeature"], (scope) => {
      scope.effect(() => {
        appDataEnabled = true;
        return () => {
          appDataEnabled = false;
        };
      }, "ipollowork-suite: app data switch");
      scope.provide("ipolloData", appData);
    });
    ctx.inject?.(["ipolloAppDataFeature", "tools", "sandboxPolicy"], (scope) =>
      scope.effect(
        () =>
          scope.tools.register(
            appDataTool(
              appData,
              (cwd) => ctx.workspaceRegistry.list().find((item) => item.path === cwd)?.title,
              (session) => scope.sandboxPolicy.resolve({ session }).mode === "read-only",
            ),
          ),
        "ipollowork-suite: app data tool",
      ),
    );
  }
  ctx.inject?.(["agents"], mountOutputContinuation);
  ctx.inject?.(["llm", "agentDefaultModel", "sessionController", "settings", "credentials"], (scope) => {
    if (!ctx.webServer.getOrigin) {
      services.modelStatus = "unsupported";
      return;
    }
    refreshModels = mountServiceModels(
      scope,
      {
        register: (route) => ctx.webServer.register(route),
        getOrigin: () => ctx.webServer.getOrigin!(),
      },
      services,
      account,
      providers => initializeAccountModel(scope, providers, account.cloudOnly),
    );
    void refreshModels().catch(() => { /* The refresh records the failure in Services. */ });
    scope.effect(() => () => {
      refreshModels = async () => {};
    });
  });
  ctx.inject?.(["skills"], (scope) => {
    refreshSkills = mountEnterpriseSkills(scope, account);
    void refreshSkills().catch(() => {});
  });
  if (config.account && !account.cloudOnly) ctx.inject?.(["mcpManager"], (scope) => {
    const web = ctx.webServer;
    if (!web.getOrigin) return;
    refreshMcp = mountEnterpriseMcp(scope, {
      register: route => web.register(route),
      getOrigin: () => web.getOrigin!(),
    }, account);
    scope.effect(() => () => { refreshMcp = async () => {}; });
    void refreshMcp().catch(() => {});
  });
  if (config.account)
    ctx.inject?.(["skills", "ipolloAppDataFeature"], (scope) =>
      scope.effect(
        () => scope.skills.register({ ...APP_DATA_SKILL, source: "runtime" }),
        "ipollowork-suite: app data skill",
      ),
    );
  const enterprise = new EnterpriseService(account, ctx, config.accountOrigin);
  const archive = config.account && config.automaticOutputArchive
    ? new ProjectArchive(
        ctx,
        account,
        config.accountOrigin,
        config.maxArtifactBytes,
        config.archiveHistoryLimit,
      )
    : undefined;
  if (config.account) mountProjectContext(ctx, account, config.accountOrigin);
  const anchor = ctx.profileContext.installAnchor;
  const installation = JSON.parse(readFileSync(anchor, "utf8")) as { name?: unknown; version?: unknown };
  // The desktop anchor is a private package-manager project, whose version is always 0.0.0.
  const runtime = installation.name === "@ipollo/desktop-runtime"
    ? JSON.parse(readFileSync(createRequire(anchor).resolve("@deepseek-ai/dsh/package.json"), "utf8")) as { version?: unknown }
    : installation;
  if (typeof runtime.version !== "string" || !semver.valid(runtime.version))
    throw new SuiteError("IPW_INVALID_RUNTIME_VERSION", 500);
  const runtimeVersion = runtime.version;
  if (config.theme) {
    ctx.effect(
      () => ctx.webServer.register({ kind: "prefix", path: BRAND_PATH, auth: "anonymous", handler: serveBrand }),
      "ipollowork-suite: brand files",
    );
    ctx.effect(() => ctx.webServer.tapIndex(brandIndex), "ipollowork-suite: brand page");
  }
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: API,
        handler: async (request, response) => {
          try {
            const admission = ctx.connection.admit(request);
            if ("rejection" in admission) {
              json(response, admission.rejection, { error: "IPW_UNAUTHORIZED" });
              return;
            }
            const url = new URL(request.url ?? "/", "http://localhost");
            const path = url.pathname.slice(API.length);
            if(path==='/cloud/availability' && request.method==='GET') {
              const active=Boolean(ctx.get?.('ipolloCloud'));
              json(response,200,active?await account.request('/api/v1/cloud-projects/availability'):{enabled:false});return;
            }
            if(path==='/cloud/projects' && request.method==='POST') {
              if(!ctx.get?.('ipolloCloud'))throw new SuiteError('IPW_CLOUD_DISABLED',409);
              const data=cloudSchema.object({projectId:cloudSchema.uuid().optional(),title:cloudSchema.string().trim().min(1).max(120).optional(),enterpriseId:cloudSchema.string().nullable().optional(),creationKey:cloudSchema.uuid().optional(),access:cloudSchema.json().optional()}).strict().parse(await body(request));
              const created=data.projectId?{id:data.projectId}:cloudSchema.object({id:cloudSchema.uuid()}).parse(await account.request('/api/v1/projects',{title:data.title,enterpriseId:data.enterpriseId??null,creationKey:data.creationKey,executionMode:'cloud'}));
              if(data.access && !data.projectId)await account.request('/api/v1/projects/'+created.id+'/access',data.access,'PUT');
              const result=cloudSchema.object({url:cloudSchema.url()}).parse(await account.openCloudProject(created.id));
              if(!ctx.get?.('ipolloCloud'))throw new SuiteError('IPW_CLOUD_DISABLED',409);
              const target=new URL(result.url);
              if(target.protocol!=='https:'||target.username||target.password)throw new SuiteError('IPW_INVALID_RESPONSE',502);
              json(response,200,{projectId:created.id,url:target.href});return;
            }
            if (request.method === "GET" && path === "/assets/client.css") {
              const css = await readFile(
                new URL("../client.css", import.meta.url),
              );
              response.writeHead(200, {
                "Content-Type": "text/css; charset=utf-8",
                "Cache-Control": "no-cache",
                "X-Content-Type-Options": "nosniff",
              });
              response.end(css);
              return;
            }
            if (request.method === "GET" && path === "/assets/mark.svg") {
              const mark = await readFile(
                new URL("../../assets/mark.svg", import.meta.url),
              );
              response.writeHead(200, {
                "Content-Type": "image/svg+xml",
                "Cache-Control": "no-cache",
                "X-Content-Type-Options": "nosniff",
              });
              response.end(mark);
              return;
            }
            if (request.method === "GET" && path === "/info") {
              json(response, 200, {
                name: "iPolloWork",
                version: packageInfo.version,
                theme: config.theme,
                market: config.market,
                account: config.account,
                appData: config.account && appDataEnabled,
                dedicatedDesktop: config.dedicatedDesktop,
              });
              return;
            }
            if (request.method === "POST" && path === "/catalog/discover" && config.market) {
              const permission = cloudSchema.object({ canManage: cloudSchema.boolean() }).parse(await account.request('/api/v1/market/manage'));
              if (!permission.canManage) throw new SuiteError('ADMIN_REQUIRED', 403);
              const input = cloudSchema.object({ source: cloudSchema.string().trim().min(1).max(2048), language: cloudSchema.enum(['zh', 'en']).default('en') }).strict().parse(await body(request));
              const entries = await discoverMarket(input.source, join(ctx.profileContext.home, 'cache', 'ipollowork-market-discovery'), input.language, runtimeVersion, lifetime.signal);
              json(response, 200, { entries });
              return;
            }
            if (request.method === "POST" && path === "/catalog/plugins" && config.market) {
              const permission = cloudSchema.object({ canManage: cloudSchema.boolean() }).parse(await account.request('/api/v1/market/manage'));
              if (!permission.canManage) throw new SuiteError('ADMIN_REQUIRED', 403);
              // The account service checks permission again when persisting the validated entry.
              const entry = await body(request, 65536) as MarketEntry;
              if (!entry.description?.trim()) delete entry.description;
              if (!entry.author?.trim()) delete entry.author;
              const base = JSON.parse(await readFile(config.catalogPath, 'utf8'));
              if (base.plugins.some((plugin: { name: string }) => plugin.name === entry.name)) throw new SuiteError('MARKET_DUPLICATE', 409);
              const { parseMarketIndex } = await import('@deepseek-ai/dsh-plugin-market-index');
              try { parseMarketIndex({ ...base, plugins: [entry] }, 'https://catalog.ipollowork.invalid/index.json'); }
              catch { throw new SuiteError('IPW_INVALID_CATALOG', 400); }
              json(response, 201, await account.request('/api/v1/market/plugins', entry));
              return;
            }
            if (
              request.method === "GET" &&
              path === "/catalog" &&
              config.market
            ) {
              const [catalog, permission] = await Promise.all([
                account.marketCatalog().catch(() => ({ plugins: [] })),
                account.request('/api/v1/market/manage', undefined, undefined, AbortSignal.timeout(3000)).catch(() => ({ canManage: false })),
              ]);
              const curated = cloudSchema.object({ plugins: cloudSchema.array(cloudSchema.unknown()).max(200) }).parse(catalog);
              const canManage = cloudSchema.object({ canManage: cloudSchema.boolean() }).parse(permission).canManage;
              const state = await readMarket(
                  config.catalogPath,
                  ctx.pluginManager,
                  runtimeVersion,
                  url.searchParams.get("language") === "zh" ? "zh" : "en",
                  config.maxResponseBytes,
                  join(ctx.profileContext.home, "cache", "ipollowork-market"),
                  config.dedicatedDesktop,
                  curated.plugins,
                );
              json(response, 200, { ...state, canManage });
              return;
            }
            if (request.method === "GET" && path === "/services") {
              await refreshModels().catch(() => { /* Return the catalog with the refresh status. */ });
              json(response, 200, await services.state());
              return;
            }
            if (request.method === "POST" && path === "/services/choice") {
              const value = (await body(request)) as {
                provider: string;
                choice: ServiceChoice;
              };
              await services.choose(value.provider, value.choice);
              await refreshModels();
              json(response, 200, { ok: true });
              return;
            }
            if (
              request.method === "GET" &&
              path === "/account" &&
              config.account
            ) {
              const state = await account.state();
              await refreshAccount().catch(() => {});
              json(response, 200, publicAccountState(state));
              return;
            }
            if (
              request.method === "POST" &&
              path === "/account/sign-in" &&
              config.account
            ) {
              const state = await account.signIn(await body(request));
              await refreshAccount().catch(() => {});
              json(response, 200, publicAccountState(state));
              return;
            }
            if (
              request.method === "POST" &&
              path === "/account/sign-up" &&
              config.account
            ) {
              const state = await account.signUp(await body(request));
              await refreshAccount().catch(() => {});
              json(response, 200, publicAccountState(state));
              return;
            }
            if (
              request.method === "POST" &&
              path === "/account/sign-out" &&
              config.account
            ) {
              const state = await account.signOut();
              await refreshAccount().catch(() => {});
              json(response, 200, publicAccountState(state));
              return;
            }
            if (request.method === "POST" && path === "/account/request-password-reset" && config.account) {
              await account.requestPasswordReset(await body(request));
              json(response, 200, { ok: true });
              return;
            }
            if (request.method === "GET" && path === "/membership" && config.account) {
              json(response, 200, membershipSchema.parse(await account.request("/api/v1/me/membership")));
              return;
            }
            if (request.method === "POST" && path === "/membership/checkout" && config.account) {
              json(response, 200, membershipCheckoutSchema.parse(await account.request("/api/v1/orders", membershipOrderSchema.parse(await body(request)))));
              return;
            }
            if (request.method === "POST" && /^\/membership\/orders\/[a-f0-9-]{36}\/sync$/.test(path) && config.account) {
              json(response, 200, membershipCheckoutSchema.parse(await account.request("/api/v1/orders/" + path.split("/")[3] + "/sync", {})));
              return;
            }
            if (path === "/enterprise/native-sharing") {
              if (request.method === "GET") {
                json(
                  response,
                  200,
                  await sharingStatus(ctx.get?.("liveshareShares"), account),
                );
                return;
              }
              if (request.method === "POST") {
                json(
                  response,
                  200,
                  await createNativeShare(
                    ctx.get?.("liveshareShares"),
                    await body(request),
                    account,
                  ),
                );
                return;
              }
            }
            if (
              path === "/enterprise/native-sharing/configure" &&
              request.method === "POST"
            ) {
              json(response, 200, await configureNativeSharing(ctx.get?.("liveshareShares"), account));
              return;
            }
            if (
              path.startsWith("/enterprise/native-sharing/audience/") &&
              (request.method === "GET" || request.method === "PUT")
            ) {
              json(
                response,
                200,
                await nativeShareAudience(
                  ctx.get?.("liveshareShares"),
                  account,
                  path.slice("/enterprise/native-sharing/audience/".length),
                  request.method === "PUT" ? await body(request) : undefined,
                ),
              );
              return;
            }
            if (
              path === "/enterprise/native-sharing/prepare" &&
              request.method === "POST"
            ) {
              json(
                response,
                200,
                await prepareNativeShare(
                  ctx.get?.("liveshareShares"),
                  await body(request),
                  account,
                ),
              );
              return;
            }
            if (
              path === "/enterprise/native-sharing/authorize" &&
              request.method === "POST"
            ) {
              json(
                response,
                200,
                await authorizeNativeShare(account, await body(request)),
              );
              return;
            }
            if (
              path.startsWith("/enterprise/native-sharing/") &&
              request.method === "DELETE"
            ) {
              json(
                response,
                200,
                await stopNativeShare(
                  ctx.get?.("liveshareShares"),
                  account,
                  path.slice("/enterprise/native-sharing/".length),
                ),
              );
              return;
            }
            if (path === "/enterprise/upload" && request.method === "POST") {
              const form = await readForm(request);
              const result = await account.transfer("/api/v1/resources", form);
              json(response, 200, await result.json());
              return;
            }
            const archiveStatus =
              /^\/enterprise\/projects\/([A-Za-z0-9_-]+)\/archive-status$/.exec(
                path,
              );
            if (archiveStatus) {
              await account.request(
                "/api/v1/projects/" + archiveStatus[1] + "/space",
              );
              if (request.method === "POST" && archive) archive.retry(archiveStatus[1]!);
              json(response, 200, { items: archive?.status(archiveStatus[1]!) ?? [] });
              return;
            }
            const artifactUpload =
              /^\/enterprise\/projects\/([A-Za-z0-9_-]+)\/artifacts\/upload$/.exec(
                path,
              );
            if (artifactUpload && request.method === "POST") {
              const metadata = request.headers["x-ipw-artifact"];
              if (typeof metadata !== "string" || metadata.length > 4096)
                throw new SuiteError("IPW_INVALID_INPUT", 400);
              json(
                response,
                201,
                await account.uploadProject(
                  artifactUpload[1]!,
                  metadata,
                  uploadBody(request),
                  lifetime.signal,
                ),
              );
              return;
            }
            const memoryDownload =
              /^\/enterprise\/projects\/([A-Za-z0-9_-]+)\/memory-versions\/([0-9]+)$/.exec(
                path,
              );
            if (memoryDownload && request.method === "GET") {
              await relayDownload(
                await account.transfer(
                  "/api/v1/projects/" +
                    memoryDownload[1] +
                    "/memory-versions/" +
                    memoryDownload[2],
                ),
                response,
                config.maxArtifactBytes,
              );
              return;
            }
            if (
              path.startsWith("/enterprise/download/") &&
              request.method === "GET"
            ) {
              const resourceId = path.slice("/enterprise/download/".length);
              if (!/^[A-Za-z0-9_-]{1,200}$/.test(resourceId))
                throw new SuiteError("IPW_INVALID_INPUT", 400);
              await relayDownload(
                await account.transfer(
                  "/api/v1/resources/" + resourceId + "/download",
                ),
                response,
                config.maxArtifactBytes,
              );
              return;
            }
            const packageFile =
              /^\/enterprise\/organizations\/([A-Za-z0-9_-]{1,100})\/packages\/([A-Za-z0-9_-]{1,100})\/(upload|files\/([A-Za-z0-9_-]{1,100})\/download)$/.exec(
                path,
              );
            if (
              packageFile &&
              packageFile[3] === "upload" &&
              request.method === "POST"
            ) {
              const form = await readForm(request);
              const result = await account.transfer(
                `/api/v1/enterprises/${packageFile[1]}/packages/${packageFile[2]}/files`,
                form,
              );
              json(response, 200, await result.json());
              return;
            }
            if (packageFile && packageFile[4] && request.method === "GET") {
              await relayDownload(
                await account.transfer(
                  `/api/v1/enterprises/${packageFile[1]}/packages/${packageFile[2]}/files/${packageFile[4]}/download`,
                ),
                response,
                config.maxArtifactBytes,
              );
              return;
            }
            const dataFile=/^\/data\/apps\/([0-9a-f-]{36})\/files(?:\/([0-9a-f-]{36}))?$/.exec(path);
            if(dataFile) {
              if(!config.account||!appDataEnabled)throw new SuiteError('IPW_APP_DATA_DISABLED',404);
              const base='/api/data/v1/apps/'+dataFile[1]+'/files';
              if(request.method==='POST'&&!dataFile[2]) {
                const bytes=Number(request.headers['content-length']);
                if(!Number.isSafeInteger(bytes)||bytes<1||bytes>24*1024*1024)throw new SuiteError('IPW_REQUEST_TOO_LARGE',413);
                json(response,201,await account.uploadAppFile(dataFile[1]!,String(request.headers['x-data-file']??'{}'),String(request.headers['content-type']??'application/octet-stream'),bytes,uploadBody(request),lifetime.signal));return;
              }
              if(request.method==='GET'&&dataFile[2]){await relayDownload(await account.transfer(base+'/'+dataFile[2]),response,config.maxArtifactBytes);return;}
              if(request.method==='DELETE'&&dataFile[2]){await account.request(base+'/'+dataFile[2],undefined,'DELETE');json(response,200,{deleted:true});return;}
              throw new SuiteError('IPW_NOT_FOUND',404);
            }
            if (path === "/data/apps" || path.startsWith("/data/apps/")) {
              if (!config.account) throw new SuiteError("IPW_NOT_FOUND", 404);
              if (!appDataEnabled) throw new SuiteError("IPW_APP_DATA_DISABLED", 404);
              json(
                response,
                200,
                await appDataRoute(
                  appData,
                  request.method ?? "GET",
                  path.slice("/data/apps".length),
                  () => body(request, config.maxRequestBytes),
                ),
              );
              return;
            }
            if (path === "/enterprise" || path.startsWith("/enterprise/")) {
              if (!config.account) throw new SuiteError("IPW_NOT_FOUND", 404);
              const value = await enterprise.request(
                request.method ?? "GET",
                path.slice("/enterprise".length),
                ["POST", "PATCH", "PUT"].includes(request.method ?? "")
                  ? await body(request, config.maxRequestBytes)
                  : undefined,
              );
              if (
                request.method !== "GET" &&
                /^\/enterprise\/organizations\/[^/]+\/(skills|mcp|grants|services|members|departments)/.test(
                  path,
                )
              )
                await refreshAccount().catch(() => {});
              json(response, 200, value);
              return;
            }
            json(response, 404, { error: "IPW_NOT_FOUND" });
          } catch (error) {
            if (response.headersSent) {
              response.destroy(
                error instanceof Error
                  ? error
                  : new Error("File transfer failed"),
              );
              return;
            }
            json(
              response,
              error instanceof SuiteError
                ? error.status
                : error instanceof ZodError
                  ? 400
                  : 500,
              {
                error:
                  error instanceof SuiteError
                    ? error.code
                    : error instanceof ZodError
                      ? "IPW_INVALID_INPUT"
                      : "IPW_SERVICE_UNAVAILABLE",
                ...(error instanceof AppDataRejection ? { message: error.reason } : {}),
              },
            );
          }
        },
      }),
    "ipollowork-suite: HTTP route",
  );
}
