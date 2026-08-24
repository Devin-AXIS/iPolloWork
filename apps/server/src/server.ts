import { existsSync } from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { IPOLLOWORK_PACKAGE_EXTENSION, IPOLLOWORK_PACKAGE_MEDIA_TYPE, templateCategorySchema } from "@ipollowork/types/templates";
import { CODEX_HARNESS_ENGINE_ID, DEEPSEEK_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";
import { projectExecutionSystemContext } from "@ipollowork/types/work-items";
import { DEFAULT_ENGINE_ID, type ApprovalRequest, type Capabilities, type ServerConfig, type WorkspaceInfo, type Actor, type ReloadReason, type ReloadTrigger, type TokenScope } from "./types.js";
import { ApprovalService } from "./approvals.js";
import { sanitizePortableOpencodeConfig } from "./portable-opencode.js";
import { addMcp, listMcp, removeMcp, setMcpEnabled } from "./mcp.js";
import {
  completeMcpAuthorization,
  mcpAuthorizationStatus,
  proxyMcpRequest,
  revokeMcpAuthorization,
  startMcpAuthorization,
} from "./mcp-authorization.js";
import { exportExtensions } from "./extensions-export.js";
import { deleteSkill, listSkills, upsertSkill } from "./skills.js";
import { installHubSkill, listHubSkills } from "./skill-hub.js";
import { deleteCommand, listCommands, repairCommands, upsertCommand } from "./commands.js";
import { ApiError, formatError, isApiError } from "./errors.js";
import { readLimitedRequestBody } from "./limited-request-body.js";
import { readJsoncFile, updateJsoncTopLevel, writeJsoncFile } from "./jsonc.js";
import { recordAudit, readAuditEntries, readLastAudit } from "./audit.js";
import { ReloadEventStore } from "./events.js";
import { computeReloadFingerprint } from "./reload-fingerprint.js";
import { startReloadWatchers } from "./reload-watcher.js";
import { opencodeConfigPath, ipolloworkConfigPath, projectCommandsDir, projectSkillsDir } from "./workspace-files.js";
import { ensureDir, exists, hashToken, shortId } from "./utils.js";
import { defaultWorkspaceiPolloWorkConfig, ensureWorkspaceFiles, readRawOpencodeConfig } from "./workspace-init.js";
import { sanitizeCommandName, validateMcpName } from "./validators.js";
import { TokenService } from "./tokens.js";
import { EnvService } from "./env-file.js";
import { DeepSeekHarnessRuntimePool } from "./deepseek-harness-runtime.js";
import { CodexHarnessRuntimePool } from "./codex-harness-runtime.js";
import { WorkspaceSessionRuntime } from "./workspace-session-runtime.js";
import { pluginEngineAdapters, pluginEngineCompatibility } from "./plugin-engine-adapter.js";
import type { PluginPackageManifest } from "./plugin-package-manifest.js";

import {
  normalizeResourceSnapshot,
  readDesktopCloudSyncState,
  syncDesktopCloudResources,
} from "./desktop-cloud-sync.js";
import {
  assertPluginPackageSafeForImport,
  installPluginPackage,
  listInstalledPluginPackages,
  listSuppressedDefaultPluginIds,
  pluginPackageVersionChange,

  previewPluginPackage,
  readInstalledPluginUiResource,
  reconcilePluginPackagesForWorkspace,
  rollbackPluginPackage,
  setPluginPackageEnabled,
  setPluginPackageResourceEnabled,
  uninstallPluginPackage,
  updatePluginPackage,
} from "./plugin-package-lifecycle.js";
import { withMaterializedPluginPackageUpload } from "./plugin-package-upload.js";
import { bundledPluginPackageIds, defaultBundledPluginPackageIds, resolveBundledPluginPackageRoot } from "./plugin-package-catalog.js";
import {
  cancelPluginAuthorizationFlow,
  completePluginBrowserAuthorization,
  deletePluginAuthorization,
  listPluginAuthorization,
  pollPluginDeviceAuthorization,
  reconcilePluginAuthorization,
  revokePluginAuthorization,
  savePluginSecretAuthorization,
  startIndependentPluginAuthorization,
} from "./plugin-platform-runtime.js";
import { deletePluginServiceData, disposeAllPluginServices, disposePluginServices } from "./plugin-service-runtime.js";
import { resolveCompatibleGitHubPluginBundle, withMaterializedCompatibleGitHubPluginBundle } from "./github-plugin-source.js";
import {
  applyMaterializedBlueprintSessions,
  normalizeBlueprintSessionTemplates,
  readMaterializedBlueprintSessions,
  sanitizeiPolloWorkTemplateConfig,
} from "./blueprint-sessions.js";
import { resolveWorkspaceOpencodeConnection } from "./opencode-connection.js";
import { seedOpencodeSessionMessages } from "./opencode-db.js";
import { listPortableFiles } from "./portable-files.js";
import {
  buildWorkspaceImportPreview,
  normalizeWorkspaceImportPayload,
  publicWorkspaceImportPreview,
  summarizeWorkspaceImportApplied,
  summarizeWorkspaceImportPreview,
  type WorkspaceImportPlan,
  workspaceImportPreviewApprovalPaths,
} from "./workspace-import-preview.js";
import {
  collectWorkspaceExportWarnings,
  stripSensitiveWorkspaceExportData,
  type WorkspaceExportSensitiveMode,
} from "./workspace-export-safety.js";
import { serve, type ServeResult } from "./serve-node.js";
import { registerCoreRoutes } from "./routes/core.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerOperationRoutes } from "./routes/operations.js";
import { addRoute, matchRoute, type AuthMode, type RequestContext, type Route } from "./routes/registry.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerDeepSeekHarnessRoutes } from "./routes/deepseek-harness.js";
import { registerCodexHarnessRoutes } from "./routes/codex-harness.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";
import { registerPluginWorkshopRoutes } from "./routes/plugin-workshop.js";
import { registerWorkItemRoutes } from "./routes/work-items.js";
import {
  disposeRuntimeOpencodeConfigStore,
  mergeOpencodeConfigs,
  mergeRuntimeProviderUpdate,
  readRuntimeOpencodeConfig,
  readRuntimeProviderChannels,
  type RuntimeOpencodeConfig,
  writeRuntimeOpencodeConfig,
  writeRuntimeProviderChannels,
} from "./runtime-opencode-config-store.js";
import { readRuntimeMcpConfig } from "./runtime-capability-store.js";
import { runtimeStorageDir } from "./runtime-storage.js";
import {
  disposeiPolloWorkWorkspaceConfigStore,
  hasiPolloWorkWorkspaceConfig,
  readiPolloWorkWorkspaceConfig,
  seediPolloWorkWorkspaceConfigIfEmpty,
  writeiPolloWorkWorkspaceConfig,
} from "./ipollowork-workspace-config-store.js";
import { buildiPolloWorkRuntimeConfigObject } from "./ipollowork-runtime-config.js";
import {
  disposeWorkItemStore,
  finishProjectSessionExecution,
  resolveProjectExecutionPlan,
  startProjectSessionExecution,
  startWorkItemAutomationScheduler,
} from "./work-items.js";
import {
  MAX_TEMPLATE_PACKAGE_BYTES,
  adoptLegacyVideoSession,
  createTemplateAuthoringSession,
  disposeTemplateStore,
  exportLocalTemplatePackage,
  exportTemplateFromSession,
  importTemplate,
  installBundledTemplate,
  listTemplateSessions,
  listTemplates,
  materializeTemplate,
  migrateTemplateSessionSnapshots,
  parseTemplateLibraryScope,
  readTemplateSession,
  readTemplateCover,
  saveTemplateFromSession,
  uninstallTemplate,
  validateTemplateFromSession,
} from "./templates.js";
import pkg from "../package.json" with { type: "json" };
import constants from "../../../constants.json" with { type: "json" };
import { listHyperframesCatalog } from "./hyperframes-catalog.js";

export {
  isSupportedWorkspaceTextFilePath,
  normalizeWorkspaceRelativePath,
  resolveWorkspaceArtifactTargets,
} from "./routes/files.js";

const SERVER_VERSION = pkg.version;
const OPENCODE_VERSION = constants.opencodeVersion.trim().replace(/^v/, "");

const IPOLLOWORK_VOICE_REALTIME_MODEL = "gpt-realtime-2";
const IPOLLOWORK_VOICE_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
let desktopCloudSyncQueue: Promise<void> = Promise.resolve();

const IPOLLOWORK_VOICE_REALTIME_TOOLS = [
  {
    type: "function",
    name: "ipollowork_snapshot",
    description: "Read the current iPolloWork UI control snapshot: route, status, narration, and visible action metadata.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "ipollowork_list_actions",
    description: "List semantic iPolloWork UI actions. Call this before ipollowork_execute_action when you do not know the exact action id.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "ipollowork_execute_action",
    description: "Execute a semantic iPolloWork UI action by id. Prefer this over screen coordinates or DOM guessing.",
    parameters: {
      type: "object",
      properties: {
        actionId: { type: "string", description: "The action id from ipollowork_list_actions, such as composer.set_text or composer.send." },
        args: { type: "object", description: "Optional JSON arguments for the action.", additionalProperties: true },
      },
      required: ["actionId"],
      additionalProperties: false,
    },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(value: unknown, key: string): string {
  if (!isRecord(value)) return "";
  const field = value[key];
  return typeof field === "string" ? field.trim() : "";
}

function runtimeConfigKeys(config: RuntimeOpencodeConfig): string[] {
  const keys: string[] = [];
  if (config.default_agent) keys.push("default_agent");
  if (Array.isArray(config.plugin) && config.plugin.length) keys.push("plugin");
  if (Array.isArray(config.disabled_providers) && config.disabled_providers.length) keys.push("disabled_providers");
  if (isRecord(config.mcp) && Object.keys(config.mcp).length) keys.push("mcp");
  const permission = isRecord(config.permission) ? config.permission : null;
  if (permission && isRecord(permission.external_directory) && Object.keys(permission.external_directory).length) {
    keys.push("permission");
  }
  if (isRecord(config.provider) && Object.keys(config.provider).length) keys.push("provider");
  return keys;
}

function userOpencodeConfigKeys(config: Record<string, unknown>): string[] {
  return Object.keys(config).filter((key) => key !== "$schema").sort();
}

async function resolveOpenAiRealtimeApiKey(env: EnvService): Promise<string> {
  const records = await env.list();
  const storedKey =
    records.find((entry) => entry.key === "OPENAI_REALTIME_API_KEY")?.value.trim() ||
    records.find((entry) => entry.key === "OPENAI_API_KEY")?.value.trim() ||
    "";
  if (storedKey) return storedKey;

  return process.env.IPOLLOWORK_OPENAI_REALTIME_API_KEY?.trim() ||
    process.env.OPENAI_REALTIME_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "";
}

async function resolveiPolloWorkModelsVoiceConfig(env: EnvService): Promise<{ baseUrl: string; apiKey: string } | null> {
  const records = await env.list();
  const apiKey =
    records.find((entry) => entry.key === "IPOLLOWORK_API_KEY")?.value.trim() ||
    records.find((entry) => entry.key === "IPOLLOWORK_MODELS_API_KEY")?.value.trim() ||
    process.env.IPOLLOWORK_API_KEY?.trim() ||
    process.env.IPOLLOWORK_MODELS_API_KEY?.trim() ||
    "";
  if (!apiKey) return null;

  const baseUrl =
    records.find((entry) => entry.key === "IPOLLOWORK_INFERENCE_BASE_URL")?.value.trim() ||
    records.find((entry) => entry.key === "IPOLLOWORK_MODELS_BASE_URL")?.value.trim() ||
    process.env.IPOLLOWORK_INFERENCE_BASE_URL?.trim() ||
    process.env.IPOLLOWORK_MODELS_BASE_URL?.trim() ||
    "";
  if (!baseUrl) return null;
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, "") };
}

function ipolloworkVoiceRealtimeInstructions(sessionContext: string) {
  const trimmedContext = sessionContext.trim();
  const contextSection = trimmedContext
    ? `

# Current Session Context

Use this recent transcript context to answer questions about what was last discussed and to resolve references such as "this" or "that" when continuing the existing session. Do not treat it as a new user request.

${trimmedContext}`
    : "";
  return `# Role and Objective

You are iPolloWork Voice Mode, a voice-first control layer inside iPolloWork.
Help the user control iPolloWork by using the semantic iPolloWork UI tools.

# Tool Policy

- Prefer ipollowork_snapshot, ipollowork_list_actions, and ipollowork_execute_action over visual guessing.
- If the user asks to write or draft something, use composer.set_text.
- If the user asks to send or run the current prompt, use composer.send.
- For navigation, settings, session, transcript, and composer work, inspect the action list first if the action id is unknown.
- Do not claim an action completed until the tool succeeds.
- Ask for confirmation before destructive actions such as deleting a session.

# Voice Style

- Be concise, calm, and direct.
- If audio is unclear, ask the user to repeat it instead of guessing.
- Ignore background speech that is not addressed to iPolloWork.
- Summarize tool results briefly and offer the next useful step.${contextSection}`;
}

function enqueueDesktopCloudSync<T>(operation: () => Promise<T>): Promise<T> {
  const run = desktopCloudSyncQueue.then(operation);
  desktopCloudSyncQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function readOpenAiClientSecret(payload: unknown): { clientSecret: string; expiresAt: number | null } {
  if (!isRecord(payload)) return { clientSecret: "", expiresAt: null };
  const clientSecret = payload.client_secret;
  if (typeof clientSecret === "string") return { clientSecret, expiresAt: null };
  if (isRecord(clientSecret)) {
    const value = typeof clientSecret.value === "string" ? clientSecret.value : "";
    const expiresAt = typeof clientSecret.expires_at === "number" ? clientSecret.expires_at : null;
    return { clientSecret: value, expiresAt };
  }
  const value = typeof payload.value === "string" ? payload.value : "";
  return { clientSecret: value, expiresAt: null };
}

async function createOpenAiRealtimeVoiceSession(env: EnvService, input: unknown) {
  const managedVoice = await resolveiPolloWorkModelsVoiceConfig(env);
  if (managedVoice) {
    try {
      return await createManagedVoiceSession(managedVoice, input);
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        const fallbackKey = await resolveOpenAiRealtimeApiKey(env);
        if (fallbackKey) {
          console.warn("[voice] iPolloWork Models broker returned 503 — falling back to direct OpenAI Realtime.");
          return createDirectOpenAiVoiceSession(fallbackKey, input);
        }
        throw new ApiError(
          503,
          "ipollowork_models_voice_unavailable",
          "iPolloWork Models voice is active but the server is not fully configured. Ask your admin to add an OpenAI key, or save your own OPENAI_API_KEY in Environment settings.",
        );
      }
      throw error;
    }
  }

  const apiKey = await resolveOpenAiRealtimeApiKey(env);
  if (!apiKey) {
    throw new ApiError(
      400,
      "openai_api_key_missing",
      "OpenAI API key missing. Save OPENAI_API_KEY in iPolloWork Environment Variables or configure the Voice Mode extension.",
    );
  }

  return createDirectOpenAiVoiceSession(apiKey, input);
}

async function createManagedVoiceSession(config: { baseUrl: string; apiKey: string }, input: unknown) {
  const response = await fetch(`${config.baseUrl}/voice/realtime/session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input ?? {}),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const message = typeof errorPayload?.message === "string" ? errorPayload.message : response.statusText;
    throw new ApiError(response.status, "ipollowork_models_voice_failed", message || "iPolloWork Models could not create a voice session");
  }
  if (
    !isRecord(payload) ||
    payload.ok !== true ||
    typeof payload.clientSecret !== "string" ||
    typeof payload.model !== "string" ||
    !Array.isArray(payload.tools) ||
    payload.tools.some((tool) => typeof tool !== "string")
  ) {
    throw new ApiError(502, "ipollowork_models_voice_invalid_response", "iPolloWork Models did not return a usable Realtime session payload");
  }
  return {
    ok: true,
    clientSecret: payload.clientSecret,
    expiresAt: typeof payload.expiresAt === "number" ? payload.expiresAt : null,
    model: payload.model,
    transcriptionModel: typeof payload.transcriptionModel === "string" ? payload.transcriptionModel : IPOLLOWORK_VOICE_TRANSCRIPTION_MODEL,
    tools: payload.tools,
    ...(typeof payload.source === "string" ? { source: payload.source } : {}),
  };
}

async function createDirectOpenAiVoiceSession(apiKey: string, input: unknown) {
  const model = readStringField(input, "model") || IPOLLOWORK_VOICE_REALTIME_MODEL;
  const sessionContext = readStringField(input, "sessionContext").slice(0, 6_000);
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
        output_modalities: ["audio"],
        audio: {
          input: {
            transcription: { model: IPOLLOWORK_VOICE_TRANSCRIPTION_MODEL, language: "en" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.58,
              silence_duration_ms: 320,
              prefix_padding_ms: 300,
              create_response: true,
              interrupt_response: true,
            },
          },
        },
        instructions: ipolloworkVoiceRealtimeInstructions(sessionContext),
        tool_choice: "auto",
        tools: IPOLLOWORK_VOICE_REALTIME_TOOLS,
      },
    }),
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const message = typeof errorPayload?.message === "string" ? errorPayload.message : response.statusText;
    throw new ApiError(response.status, "openai_realtime_failed", message || "Failed to create OpenAI Realtime session");
  }

  const { clientSecret, expiresAt } = readOpenAiClientSecret(payload);
  if (!clientSecret) {
    throw new ApiError(502, "openai_realtime_invalid_response", "OpenAI did not return a usable Realtime client secret");
  }

  return {
    ok: true,
    clientSecret,
    expiresAt,
    model,
    transcriptionModel: IPOLLOWORK_VOICE_TRANSCRIPTION_MODEL,
    tools: IPOLLOWORK_VOICE_REALTIME_TOOLS.map((tool) => tool.name),
  };
}

const reloadBaselineRefreshers = new WeakMap<
  ServerConfig,
  (workspaceId: string, reasons?: ReloadReason[]) => Promise<void>
>();

type LogLevel = "info" | "warn" | "error";

type LogAttributes = Record<string, unknown>;

type ServerLogger = {
  log: (level: LogLevel, message: string, attributes?: LogAttributes) => void;
};

const LOG_LEVEL_NUMBERS: Record<LogLevel, number> = {
  info: 9,
  warn: 13,
  error: 17,
};

let stdoutErrorHandlerInstalled = false;
let stdoutUnavailable = false;

function toUnixNano(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

export function createServerLogger(config: ServerConfig): ServerLogger {
  installStdoutErrorHandler();
  const runId = process.env.IPOLLOWORK_RUN_ID ?? shortId();
  const host = hostname().trim();
  const resource: Record<string, string> = {
    "service.name": "ipollowork-server",
    "service.version": SERVER_VERSION,
    "service.instance.id": runId,
  };
  if (host) {
    resource["host.name"] = host;
  }
  const baseAttributes: LogAttributes = {
    "run.id": runId,
    "process.pid": process.pid,
  };
  const writeStdoutLine = (line: string) => {
    if (stdoutUnavailable) return;
    try {
      const canContinue = process.stdout.write(`${line}\n`);
      if (!canContinue) {
        process.stdout.once("drain", () => {});
      }
    } catch (error) {
      if (isIgnorableStdoutWriteError(error)) {
        stdoutUnavailable = true;
        return;
      }
      throw error;
    }
  };

  const emit = (level: LogLevel, message: string, attributes?: LogAttributes) => {
    const merged = { ...baseAttributes, ...(attributes ?? {}) };
    if (config.logFormat === "json") {
      const record = {
        timeUnixNano: toUnixNano(),
        severityText: level.toUpperCase(),
        severityNumber: LOG_LEVEL_NUMBERS[level],
        body: message,
        attributes: merged,
        resource,
      };
      writeStdoutLine(JSON.stringify(record));
      return;
    }
    writeStdoutLine(message);
  };

  return { log: emit };
}

function isIgnorableStdoutWriteError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? error.code : undefined;
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED";
}

function installStdoutErrorHandler() {
  if (stdoutErrorHandlerInstalled) return;
  stdoutErrorHandlerInstalled = true;
  process.stdout.on("error", (error) => {
    if (isIgnorableStdoutWriteError(error)) {
      stdoutUnavailable = true;
      return;
    }
    throw error;
  });
  process.on("uncaughtException", (error) => {
    if (isIgnorableStdoutWriteError(error)) {
      stdoutUnavailable = true;
      return;
    }
    throw error;
  });
}

function logRequest(input: {
  logger: ServerLogger;
  request: Request;
  response: Response;
  durationMs: number;
  authMode: AuthMode;
  proxyService?: "opencode";
  proxyBaseUrl?: string;
  error?: string;
}) {
  const { logger, request, response, durationMs, authMode, proxyService, proxyBaseUrl, error } = input;
  const status = response.status;
  const level: LogLevel = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const proxyLabel = proxyBaseUrl ? ` (${proxyService ?? "proxy"})` : "";
  const message = `${method} ${url.pathname} ${status} ${durationMs}ms${proxyLabel}`;
  const attributes: LogAttributes = {
    method,
    path: url.pathname,
    status,
    durationMs,
    auth: authMode,
  };
  if (proxyBaseUrl) {
    attributes["proxy.base_url"] = proxyBaseUrl;
    if (proxyService) attributes["proxy.service"] = proxyService;
  }
  if (error) {
    attributes.error = error;
  }
  logger.log(level, message, attributes);
}

function parseWorkspaceMount(pathname: string): { workspaceId: string; restPath: string } | null {
  if (!pathname.startsWith("/w/")) return null;
  const remainder = pathname.slice(3);
  if (!remainder) return null;
  const slash = remainder.indexOf("/");
  if (slash === -1) {
    return { workspaceId: decodeURIComponent(remainder), restPath: "/" };
  }
  const workspaceId = remainder.slice(0, slash);
  const restPath = remainder.slice(slash) || "/";
  if (!workspaceId.trim()) return null;
  return { workspaceId: decodeURIComponent(workspaceId), restPath };
}

function parseWorkspaceOpencodeMount(pathname: string): { workspaceId: string; restPath: string } | null {
  if (!pathname.startsWith("/workspace/")) return null;
  const remainder = pathname.slice("/workspace/".length);
  if (!remainder) return null;
  const slash = remainder.indexOf("/");
  if (slash === -1) return null;
  const workspaceId = remainder.slice(0, slash);
  const restPath = remainder.slice(slash) || "/";
  if (!workspaceId.trim()) return null;
  if (restPath !== "/opencode" && !restPath.startsWith("/opencode/")) return null;
  return { workspaceId: decodeURIComponent(workspaceId), restPath };
}

function normalizeOpencodeProxyPath(proxyPath: string): string {
  const raw = (proxyPath ?? "").trim() || "/";
  const withoutPrefix = raw.startsWith("/opencode") ? raw.slice("/opencode".length) : raw;
  const normalized = (withoutPrefix || "/").replace(/\/+$/, "");
  return normalized || "/";
}

export function assertOpencodeProxyAllowed(actor: Actor, method: string, proxyPath: string) {
  const m = method.toUpperCase();
  const scope = actor.scope ?? "viewer";

  if (scope === "viewer" && m !== "GET" && m !== "HEAD") {
    throw new ApiError(403, "forbidden", "Viewer tokens are read-only");
  }

  // Prevent viewers from self-approving OpenCode permission requests via the
  // proxy. OpenCode uses /permission/:requestId/reply (and historically also
  // a session-scoped variant). Collaborators must be allowed: the SPA's only
  // credential is the collaborator-scoped client token (IPOLLOWORK_TOKEN), so
  // an owner-only gate made every interactive permission dialog un-answerable
  // (403 "Only owner tokens can reply") and left tool calls stuck in
  // "running" forever (#1918).
  if (scope === "viewer" && m !== "GET" && m !== "HEAD") {
    const normalized = normalizeOpencodeProxyPath(proxyPath);
    if (/\/permission\/[^/]+\/reply$/.test(normalized)) {
      throw new ApiError(403, "forbidden", "Viewer tokens cannot reply to permission requests");
    }
  }
}

function isSessionCommandProxyRequest(method: string, proxyPath: string) {
  return method === "POST" && /^\/session\/[^/]+\/command$/.test(normalizeOpencodeProxyPath(proxyPath));
}

function pluginPackageEngineState(workspace: WorkspaceInfo, manifest: PluginPackageManifest) {
  const activeEngineId = workspace.engineId?.trim() || DEFAULT_ENGINE_ID;
  return {
    activeEngineId,
    engineCompatibility: pluginEngineAdapters.ids().map((engineId) => (
      pluginEngineCompatibility(pluginEngineAdapters.get(engineId), manifest)
    )),
  };
}

async function ensureDefaultBundledPluginPackages(config: ServerConfig): Promise<void> {
  const workspaces = config.workspaces.filter((workspace) => workspace.workspaceType === "local");
  const installWorkspace = workspaces[0];
  if (!installWorkspace) return;

  const logger = createServerLogger(config);
  const installedById = new Map(
    (await listInstalledPluginPackages({ serverConfig: config })).map((item) => [item.pluginId, item]),
  );
  const suppressed = new Set(await listSuppressedDefaultPluginIds({ serverConfig: config }));

  for (const pluginId of defaultBundledPluginPackageIds) {
    try {
      const packageRoot = await resolveBundledPluginPackageRoot(pluginId);
      const preview = await previewPluginPackage({
        packageRoot,
        engineId: installWorkspace.engineId ?? DEFAULT_ENGINE_ID,
      });
      if (!preview.manifest.defaultEnabled
        || preview.manifest.source.origin !== "builtin"
        || !preview.manifest.source.trusted) continue;

      const installed = installedById.get(pluginId);
      if (!installed && suppressed.has(pluginId)) continue;
      if (!installed) {
        await installPluginPackage({
          serverConfig: config,
          packageRoot,
        });
      } else if (installed.version !== preview.manifest.package?.version) {
        await updatePluginPackage({
          serverConfig: config,
          packageRoot,
        });
      }
    } catch (error) {
      logger.log("warn", `Default plugin package could not be prepared: ${pluginId}`, {
        pluginId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const workspace of workspaces) {
    try {
      await reconcilePluginPackagesForWorkspace({
        serverConfig: config,
        workspaceId: workspace.id,
        workspaceRoot: workspace.path,
      });
    } catch (error) {
      logger.log("warn", `Plugin package projection could not be reconciled: ${workspace.id}`, {
        workspaceId: workspace.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function startServer(config: ServerConfig): Promise<ServeResult> {
  // This is a real migration, not a runtime fallback: legacy template.json
  // records are moved into the canonical SQLite table before routes exist.
  await migrateTemplateSessionSnapshots(config);
  const approvals = new ApprovalService(config.approval);
  const reloadEvents = new ReloadEventStore();
  const tokens = new TokenService(config);
  // Keep the persisted account environment and this long-lived desktop/server
  // process in lockstep. Managed agent children inherit this process on their
  // next start, so disconnecting a provider cannot leave a stale credential.
  const env = new EnvService({ processEnv: process.env });
  const deepseekHarness = new DeepSeekHarnessRuntimePool({ config, env });
  const codexHarness = new CodexHarnessRuntimePool({ config, env });
  const sessionRuntime = new WorkspaceSessionRuntime({
    config,
    createWorkspaceOpencodeClient,
    unwrapOpencodeResult,
    deepseekHarness,
    codexHarness,
  });
  const logger = createServerLogger(config);
  let watcherHandle = startReloadWatchers({ config, reloadEvents, logger });
  const refreshWorkspaceReloadBaseline = (workspaceId: string, reasons?: ReloadReason[]) =>
    watcherHandle.refreshWorkspace(workspaceId, reasons);
  reloadBaselineRefreshers.set(config, refreshWorkspaceReloadBaseline);
  let reloadWatcherRestart = Promise.resolve();
  const restartReloadWatchers = (): Promise<void> => {
    const restart = async () => {
      await watcherHandle.close();
      watcherHandle = startReloadWatchers({ config, reloadEvents, logger });
    };
    reloadWatcherRestart = reloadWatcherRestart.then(restart, restart);
    return reloadWatcherRestart;
  };
  const routes = createRoutes(
    config,
    approvals,
    tokens,
    env,
    deepseekHarness,
    codexHarness,
    sessionRuntime,
    restartReloadWatchers,
  );

  const serverOptions: {
    hostname: string;
    port: number;
    fetch: (request: Request) => Response | Promise<Response>;
  } = {
    hostname: config.host,
    port: config.port,
    fetch: async (request: Request) => {
      const url = new URL(request.url);
      const startedAt = Date.now();
      let authMode: AuthMode = "none";
      let proxyService: "opencode" | undefined;
      let proxyBaseUrl: string | undefined;
      let errorMessage: string | undefined;

      const finalize = (response: Response) => {
        const wrapped = withCors(response, request, config);
        if (config.logRequests) {
            logRequest({
              logger,
              request,
              response: wrapped,
              durationMs: Date.now() - startedAt,
              authMode,
              proxyService,
              proxyBaseUrl,
              error: errorMessage,
            });
        }
        return wrapped;
      };

      const proxyWorkspaceOpencodeMount = async (mount: { workspaceId: string; restPath: string }) => {
        authMode = "client";
        try {
          const actor = await requireClient(request, config, tokens);
          assertOpencodeProxyAllowed(actor, request.method, mount.restPath);
          const workspace = await resolveWorkspace(config, mount.workspaceId);
          proxyService = "opencode";
          proxyBaseUrl = workspace.baseUrl?.trim() || undefined;
          const response = await proxyOpencodeRequest({ config, request, url, workspace, proxyPath: mount.restPath });
          return finalize(response);
        } catch (error) {
          const apiError = isApiError(error)
            ? error
            : new ApiError(500, "internal_error", "Unexpected server error");
          errorMessage = apiError.message;
          return finalize(jsonResponse(formatError(apiError), apiError.status));
        }
      };

      if (request.method === "OPTIONS") {
        return finalize(new Response(null, { status: 204 }));
      }

      const canonicalOpencodeMount = parseWorkspaceOpencodeMount(url.pathname);
      if (canonicalOpencodeMount) {
        return proxyWorkspaceOpencodeMount(canonicalOpencodeMount);
      }

      const mount = parseWorkspaceMount(url.pathname);
      if (mount && (mount.restPath === "/opencode" || mount.restPath.startsWith("/opencode/"))) {
        return proxyWorkspaceOpencodeMount(mount);
      }

      // Allow clients to use a mounted base URL (e.g. http://host:8787/w/<id>) while
      // still calling the existing /workspace/:id/* API surface.
      // Example: baseUrl + "/workspace/<id>/plugin-packages" => "/w/<id>/workspace/<id>/plugin-packages".
      // We strip the mount prefix and route-match on the rest path.
      //
      // Important: when using a mounted base URL, enforce that the nested /workspace/:id
      // matches the mount workspace id to preserve the "single-workspace" mental model.
      if (mount && mount.restPath.startsWith("/workspace/")) {
        const match = mount.restPath.match(/^\/workspace\/([^/]+)/);
        const nestedId = match?.[1] ? decodeURIComponent(match[1]) : null;
        if (nestedId && nestedId !== mount.workspaceId) {
          errorMessage = "not_found";
          return finalize(jsonResponse({ code: "not_found", message: "Not found" }, 404));
        }
        url.pathname = mount.restPath;
      }

      if (url.pathname === "/opencode" || url.pathname.startsWith("/opencode/")) {
        authMode = "client";
        proxyBaseUrl = config.workspaces[0]?.baseUrl?.trim() || undefined;
        try {
          const actor = await requireClient(request, config, tokens);
          assertOpencodeProxyAllowed(actor, request.method, url.pathname);
          proxyService = "opencode";
          const response = await proxyOpencodeRequest({ config, request, url, workspace: config.workspaces[0] });
          return finalize(response);
        } catch (error) {
          const apiError = isApiError(error)
            ? error
            : new ApiError(500, "internal_error", "Unexpected server error");
          errorMessage = apiError.message;
          return finalize(jsonResponse(formatError(apiError), apiError.status));
        }
      }

      const route = matchRoute(routes, request.method, url.pathname);
      if (!route) {
        errorMessage = "not_found";
        return finalize(jsonResponse({ code: "not_found", message: "Not found" }, 404));
      }

      authMode = route.auth;
      try {
        const actor =
          route.auth === "host-token"
            ? requireHostToken(request, config)
            : route.auth === "host"
              ? await requireHost(request, config, tokens)
              : route.auth === "client"
                ? await requireClient(request, config, tokens)
                : undefined;
        const response = await route.handler({
          request,
          url,
          params: route.params,
          config,
          approvals,
          reloadEvents,
          tokens,
          actor,
        });
        return finalize(response);
      } catch (error) {
        if (!isApiError(error)) {
          console.error("[ipollowork-server] Unhandled error:", error);
        }
        const apiError = isApiError(error)
          ? error
          : new ApiError(500, "internal_error", "Unexpected server error");
        errorMessage = apiError.message;
        return finalize(jsonResponse(formatError(apiError), apiError.status));
      }
    },
  };

  const server = await serve({
    ...serverOptions,
    idleTimeout: 120,
  });
  config.port = server.port;
  const automationMonitorAbort = new AbortController();
  const automationMonitors = new Map<string, Promise<void>>();
  const monitorAutomationSession = (workspace: WorkspaceInfo, sessionId: string): void => {
    const key = `${workspace.id}\u0000${sessionId}`;
    if (automationMonitors.has(key)) return;
    let monitor: Promise<void>;
    monitor = (async () => {
      try {
        const completion = await sessionRuntime.waitForCompletion(workspace, sessionId, {
          signal: automationMonitorAbort.signal,
        });
        await finishProjectSessionExecution(config, workspace.id, sessionId, completion);
      } catch (error) {
        if (automationMonitorAbort.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Automatic task monitoring failed";
        try {
          await finishProjectSessionExecution(config, workspace.id, sessionId, {
            status: "failed",
            error: message,
          });
        } catch (finishError) {
          console.error("[work-item-automation] Failed to persist task completion", finishError);
        }
      }
    })().finally(() => {
      if (automationMonitors.get(key) === monitor) automationMonitors.delete(key);
    });
    automationMonitors.set(key, monitor);
  };
  const workItemAutomationScheduler = startWorkItemAutomationScheduler({
    config,
    dispatch: async (item) => {
      const workspace = await resolveWorkspace(config, item.workspaceId);
      const requestedRuntime = {
        engineId: workspace.engineId?.trim() || DEFAULT_ENGINE_ID,
        model: item.automation?.model ?? null,
        mode: null,
        modelVariant: null,
      };
      const plan = await resolveProjectExecutionPlan(config, workspace, {
        agentId: item.assignee ?? undefined,
        runtime: requestedRuntime,
      });
      const session = await sessionRuntime.create(workspace, item.title, plan.runtime.model ? {
        providerID: plan.runtime.model.providerId,
        modelID: plan.runtime.model.modelId,
      } : undefined);
      const execution = {
        sessionId: session.id,
        ...plan,
        boundAt: Date.now(),
      };
      await startProjectSessionExecution(config, workspace.id, item.title, execution);
      try {
        const promptedSessionId = await sessionRuntime.prompt(workspace, session.id, {
          text: item.description?.trim() || item.title,
          ...(execution.runtime.model ? {
            model: {
              providerID: execution.runtime.model.providerId,
              modelID: execution.runtime.model.modelId,
            },
          } : {}),
          ...(execution.runtime.mode ? { mode: execution.runtime.mode } : {}),
          ...(execution.runtime.modelVariant ? { reasoningEffort: execution.runtime.modelVariant } : {}),
          system: projectExecutionSystemContext(execution),
        });
        monitorAutomationSession(workspace, promptedSessionId);
        return promptedSessionId;
      } catch (error) {
        await finishProjectSessionExecution(config, workspace.id, session.id, {
          status: "failed",
          error: error instanceof Error ? error.message : "Automatic execution failed",
        });
        return session.id;
      }
    },
    onError: (error) => console.error("[work-item-automation] Scheduler tick failed", error),
  });

  return {
    ...server,
    stop: async () => {
      await workItemAutomationScheduler.close();
      automationMonitorAbort.abort(new Error("Server stopped"));
      await Promise.allSettled(automationMonitors.values());
      await reloadWatcherRestart;
      await watcherHandle.close();
      reloadBaselineRefreshers.delete(config);
      try {
        await Promise.all([deepseekHarness.close(), codexHarness.close()]);
        await disposeAllPluginServices(config);
        await server.stop();
      } finally {
        await Promise.all([
          disposeRuntimeOpencodeConfigStore(config),
          disposeiPolloWorkWorkspaceConfigStore(config),
          disposeWorkItemStore(config),
          disposeTemplateStore(config),
        ]);
        // Bun releases Windows SQLite file handles on the following event-loop
        // turn even though Database.close() itself is synchronous.
        await new Promise<void>((resolveClose) => setTimeout(resolveClose, process.platform === "win32" ? 100 : 0));
      }
    },
  };
}

function buildOpencodeProxyUrl(baseUrl: string, path: string, search: string) {
  const target = new URL(baseUrl);
  const trimmedPath = path.replace(/^\/opencode/, "");
  target.pathname = trimmedPath.startsWith("/") ? trimmedPath : `/${trimmedPath}`;
  target.search = search;
  return target.toString();
}

function buildOpencodeDirectoryHeader(directory: string) {
  return /[^\x00-\x7F]/.test(directory) ? encodeURIComponent(directory) : directory;
}

function createOpencodeDirectoryFetch(directory: string): typeof fetch {
  return Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const headers = new Headers(init?.headers ?? request.headers);
      headers.set("x-opencode-directory", buildOpencodeDirectoryHeader(directory));
      return fetch(new Request(request, { headers }));
    },
    { preconnect: fetch.preconnect },
  );
}

type OpencodeClientResult<T, E> =
  | { data: T | undefined; error: undefined; response: Response }
  | { data: undefined; error: E; response: Response };

function createWorkspaceOpencodeClient(config: ServerConfig, workspace: WorkspaceInfo) {
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  const directory = resolveOpencodeDirectory(workspace);
  const directoryFetch = directory ? createOpencodeDirectoryFetch(directory) : undefined;

  return createOpencodeClient({
    baseUrl: connection.baseUrl?.trim(),
    ...(directory ? { directory } : {}),
    ...(directoryFetch ? { fetch: directoryFetch } : {}),
    ...(connection.authHeader ? { headers: { Authorization: connection.authHeader } } : {}),
  });
}

function unwrapOpencodeResult<T, E>(result: OpencodeClientResult<T, E>, path: string): NonNullable<T> {
  if (result.data != null) {
    return result.data;
  }
  if (result.error === undefined) {
    throw new ApiError(502, "opencode_empty_response", "OpenCode returned an empty response", { path });
  }
  throw new ApiError(502, "opencode_request_failed", "OpenCode request failed", {
    status: result.response.status,
    body: result.error,
    path,
  });
}

async function proxyOpencodeRequest(input: {
  config: ServerConfig;
  request: Request;
  url: URL;
  workspace?: WorkspaceInfo;
  proxyPath?: string;
}) {
  const workspace = input.workspace;
  const baseUrl = workspace ? resolveWorkspaceOpencodeConnection(input.config, workspace).baseUrl?.trim() ?? "" : "";
  if (!baseUrl) {
    throw new ApiError(400, "opencode_unconfigured", "OpenCode base URL is missing for this workspace");
  }

  const proxyPath = input.proxyPath ?? input.url.pathname;
  const targetUrl = buildOpencodeProxyUrl(baseUrl, proxyPath, input.url.search);
  const headers = new Headers(input.request.headers);
  headers.delete("authorization");
  headers.delete("x-ipollowork-host-token");
  headers.delete("x-ipollowork-client-id");
  headers.delete("host");
  headers.delete("origin");

  const directory = workspace ? resolveOpencodeDirectory(workspace) : null;
  if (directory && !headers.has("x-opencode-directory")) {
    headers.set("x-opencode-directory", buildOpencodeDirectoryHeader(directory));
  }

  const auth = workspace ? resolveWorkspaceOpencodeConnection(input.config, workspace).authHeader ?? null : null;
  if (auth) {
    headers.set("Authorization", auth);
  }

  const method = input.request.method.toUpperCase();
  // Buffer the request body so it can be forwarded reliably across Node.js
  // stream boundaries (Readable.toWeb streams from the HTTP adapter aren't
  // always accepted directly by Node's global fetch as a body).
  const body = method === "GET" || method === "HEAD"
    ? undefined
    : await input.request.arrayBuffer().then((buf) => (buf.byteLength > 0 ? buf : undefined));
  if (isSessionCommandProxyRequest(method, proxyPath)) {
    void fetch(targetUrl, {
      method,
      headers,
      body,
    }).catch(() => {
      // Command failures are surfaced through the OpenCode event stream.
    });
    return jsonResponse({ ok: true, accepted: true });
  }
  const response = await fetch(targetUrl, {
    method,
    headers,
    body,
  });

  return sanitizeProxyResponse(response);
}

/**
 * Strip hop-by-hop and transport-level headers that Bun's native fetch keeps
 * in the upstream response even after it has already decoded the body for us.
 * Without this the browser sees `content-encoding: gzip` on a plain-text
 * payload and bails out with ERR_CONTENT_DECODING_FAILED, breaking any UI
 * code that reaches through /opencode/* (including session.create).
 */
function sanitizeProxyResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("transfer-encoding");
  headers.delete("content-length");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseTemplateFromSessionInput(body: Record<string, unknown>) {
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const category = templateCategorySchema.safeParse(body.category);
  const title = typeof body.title === "string" ? body.title : "";
  if (!sessionId || !category.success || !title) throw new ApiError(400, "invalid_payload", "sessionId, category and title are required");
  return {
    sessionId,
    category: category.data,
    title,
    description: typeof body.description === "string" ? body.description : undefined,
    subcategory: typeof body.subcategory === "string" ? body.subcategory : undefined,
    style: typeof body.style === "string" ? body.style : undefined,
    tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
  };
}

function withCors(response: Response, request: Request, config: ServerConfig) {
  const origin = request.headers.get("origin");
  const allowedOrigins = config.corsOrigins;
  let allowOrigin: string | null = null;
  if (allowedOrigins.includes("*")) {
    allowOrigin = "*";
  } else if (origin && allowedOrigins.includes(origin)) {
    allowOrigin = origin;
  }

  if (!allowOrigin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", allowOrigin);
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-iPolloWork-Host-Token, X-iPolloWork-Client-Id, X-iPolloWork-Filename, X-iPolloWork-Resource-Scope, X-iPolloWork-Template-Category, X-OpenCode-Directory, X-Opencode-Directory, x-opencode-directory",
  );
  headers.set("Access-Control-Expose-Headers", "Content-Disposition, X-iPollo-Artifact-SHA256");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

async function requireClient(request: Request, config: ServerConfig, tokens: TokenService): Promise<Actor> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  if (!token) {
    throw new ApiError(401, "unauthorized", "Invalid bearer token");
  }
  const scope = await tokens.scopeForToken(token);
  if (!scope) {
    throw new ApiError(401, "unauthorized", "Invalid bearer token");
  }
  const clientId = request.headers.get("x-ipollowork-client-id") ?? undefined;
  return { type: "remote", clientId, tokenHash: hashToken(token), scope };
}

function requireHostToken(request: Request, config: ServerConfig): Actor {
  const hostToken = request.headers.get("x-ipollowork-host-token");
  if (hostToken && hostToken === config.hostToken) {
    return { type: "host", tokenHash: hashToken(hostToken), scope: "owner" };
  }
  throw new ApiError(401, "unauthorized", "Invalid host token");
}

async function requireHost(request: Request, config: ServerConfig, tokens: TokenService): Promise<Actor> {
  const hostToken = request.headers.get("x-ipollowork-host-token");
  if (hostToken && hostToken === config.hostToken) {
    return { type: "host", tokenHash: hashToken(hostToken), scope: "owner" };
  }

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const bearer = match?.[1];
  if (!bearer) {
    throw new ApiError(401, "unauthorized", "Invalid host token");
  }
  const scope = await tokens.scopeForToken(bearer);
  if (scope !== "owner") {
    throw new ApiError(401, "unauthorized", "Invalid host token");
  }
  const clientId = request.headers.get("x-ipollowork-client-id") ?? undefined;
  return { type: "remote", clientId, tokenHash: hashToken(bearer), scope };
}

function buildCapabilities(config: ServerConfig, workspace?: WorkspaceInfo): Capabilities {
  const writeEnabled = !config.readOnly;
  const schemaVersion = 1;
  const sandboxBackend = resolveSandboxBackend();
  const sandboxEnabled = resolveSandboxEnabled(sandboxBackend);
  const inboxEnabled = resolveInboxEnabled();
  const outboxEnabled = resolveOutboxEnabled();
  const maxBytes = resolveInboxMaxBytes();
  const toyUiEnabled = resolveToyUiEnabled();
  const browserProvider = resolveBrowserProvider();
  const opencodeConfigured = config.workspaces.some((workspace) => Boolean(workspace.baseUrl?.trim()));
  return {
    schemaVersion,
    serverVersion: SERVER_VERSION,
    opencodeVersion: OPENCODE_VERSION,
    skills: { read: true, write: writeEnabled, source: "ipollowork" },
    hub: {
      skills: {
        read: true,
        install: writeEnabled,
        repo: { owner: "different-ai", name: "ipollowork-hub", ref: "main" },
      },
    },
    mcp: { read: true, write: writeEnabled },
    commands: { read: true, write: writeEnabled },
    config: { read: true, write: writeEnabled },
    templates: { read: true, install: writeEnabled, import: writeEnabled, uninstall: writeEnabled },
    work: { read: true, write: writeEnabled, board: true, schedule: true },
    ...(workspace ? {
      engine: {
        id: workspace.engineId?.trim() || DEFAULT_ENGINE_ID,
        sessions: {
          read: true,
          create: writeEnabled,
          prompt: writeEnabled,
          delete: writeEnabled && workspace.engineId !== DEEPSEEK_HARNESS_ENGINE_ID,
        },
      },
    } : {}),

    approvals: { mode: config.approval.mode, timeoutMs: config.approval.timeoutMs },
    sandbox: { enabled: sandboxEnabled, backend: sandboxBackend },
    ui: { toy: toyUiEnabled },
    tokens: { scoped: true, scopes: ["owner", "collaborator", "viewer"] },
    proxy: {
      opencode: opencodeConfigured,
    },
    toolProviders: {
      browser: browserProvider,
      files: {
        injection: writeEnabled && inboxEnabled,
        outbox: outboxEnabled,
        inboxPath: ".opencode/ipollowork/inbox/",
        outboxPath: ".opencode/ipollowork/outbox/",
        maxBytes,
      },
    },
  };
}

function resolveSandboxBackend(): Capabilities["sandbox"]["backend"] {
  const raw = (process.env.IPOLLOWORK_SANDBOX_BACKEND ?? "").trim().toLowerCase();
  if (raw === "docker") return "docker";
  if (raw === "container") return "container";
  return "none";
}

function resolveSandboxEnabled(backend: Capabilities["sandbox"]["backend"]): boolean {
  const raw = (process.env.IPOLLOWORK_SANDBOX_ENABLED ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return backend !== "none";
}

function resolveInboxEnabled(): boolean {
  const raw = (process.env.IPOLLOWORK_INBOX_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return true;
  return ["1", "true", "yes", "on"].includes(raw);
}

function resolveOutboxEnabled(): boolean {
  const raw = (process.env.IPOLLOWORK_OUTBOX_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return true;
  return ["1", "true", "yes", "on"].includes(raw);
}

function resolveInboxMaxBytes(): number {
  const raw = (process.env.IPOLLOWORK_INBOX_MAX_BYTES ?? "").trim();
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.trunc(parsed), 250_000_000);
  }
  return 50_000_000;
}

function resolveToyUiEnabled(): boolean {
  const raw = (process.env.IPOLLOWORK_TOY_UI ?? "").trim().toLowerCase();
  if (!raw) return true;
  return ["1", "true", "yes", "on"].includes(raw);
}

// Dev-only log sink target. When IPOLLOWORK_DEV_LOG_FILE is set to a path, the
// /dev/log endpoint accepts JSON payloads and appends them to that file so an
// operator can `tail -f` the file to see live browser activity. Returning null
// disables the endpoint entirely.
function resolveDevLogPath(): string | null {
  const raw = (process.env.IPOLLOWORK_DEV_LOG_FILE ?? "").trim();
  return raw.length > 0 ? raw : null;
}

function resolveBrowserProvider(): Capabilities["toolProviders"]["browser"] {
  const raw = (process.env.IPOLLOWORK_BROWSER_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "sandbox-headless") {
    return { enabled: true, placement: "in-sandbox", mode: "headless" };
  }
  if (raw === "host-interactive") {
    return { enabled: true, placement: "host-machine", mode: "interactive" };
  }
  if (raw === "client-interactive") {
    return { enabled: true, placement: "client-machine", mode: "interactive" };
  }
  return { enabled: false, placement: "external", mode: "none" };
}

function emitReloadEvent(
  reloadEvents: ReloadEventStore,
  workspace: WorkspaceInfo,
  reason: ReloadReason,
  trigger?: ReloadTrigger,
) {
  reloadEvents.recordDebounced(workspace.id, reason, trigger);
}

function pluginProjectionRoots(config: ServerConfig): string[] {
  return config.workspaces
    .filter((workspace) => workspace.workspaceType === "local")
    .flatMap((workspace) => pluginEngineAdapters
      .get(workspace.engineId ?? DEFAULT_ENGINE_ID)
      .projectionRoots
      .map((root) => join(workspace.path, root)));
}

function emitPluginReloadEvents(
  reloadEvents: ReloadEventStore,
  config: ServerConfig,
  reason: ReloadReason,
  trigger: ReloadTrigger,
) {
  for (const workspace of config.workspaces) emitReloadEvent(reloadEvents, workspace, reason, trigger);
}

async function disposePluginServicesEverywhere(config: ServerConfig, pluginId: string) {
  await Promise.all(config.workspaces.map((workspace) => disposePluginServices(config, workspace.id, pluginId)));
}

function buildConfigTrigger(path: string): ReloadTrigger {
  const name = path.split(/[\\/]/).filter(Boolean).pop();
  return {
    type: "config",
    name: name || "opencode.json",
    action: "updated",
    path,
  };
}

export type AuthorizedFoldersResponse = {
  folders: string[];
  hiddenCount: number;
  workspaceRoot: string;
};

export type AuthorizedFoldersUpdateResponse = {
  folders: string[];
  hiddenCount: number;
  updatedAt: number;
};

type AuthorizedFoldersConfig = {
  folders: string[];
  hiddenEntries: Record<string, unknown>;
};

function normalizeAuthorizedFolderPath(input: string | null | undefined): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "";
  if (trimmed === "/*") return "/";
  const withoutWildcard = trimmed.replace(/[\\/]\*+$/, "");
  const withoutVerbatim = /^\\\\\?\\UNC\\/i.test(withoutWildcard)
    ? `\\${withoutWildcard.slice(7)}`
    : /^\\\\\?\\[a-zA-Z]:[\\/]/.test(withoutWildcard)
      ? withoutWildcard.slice(4)
      : withoutWildcard;
  const unified = withoutVerbatim.replace(/\\/g, "/");
  const withoutTrailing = unified.replace(/\/+$/, "");
  return withoutTrailing || "/";
}

function externalDirectoryKeyToAuthorizedFolder(key: string, value: unknown): string | null {
  if (value !== "allow") return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (trimmed === "/*") return "/";
  if (!trimmed.endsWith("/*")) return null;
  return normalizeAuthorizedFolderPath(trimmed.slice(0, -2));
}

function authorizedFolderToExternalDirectoryKey(folder: string): string {
  return folder === "/" ? "/*" : `${folder}/*`;
}

function hasOwnKey(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function readAuthorizedFoldersFromOpencodeConfig(
  opencodeConfig: Record<string, unknown>,
  workspaceRoot: string,
): AuthorizedFoldersConfig {
  const workspaceRootFolder = normalizeAuthorizedFolderPath(workspaceRoot);
  const permission = ensurePlainObject(opencodeConfig.permission);
  const externalDirectory = ensurePlainObject(permission.external_directory);
  const folders: string[] = [];
  const hiddenEntries: Record<string, unknown> = {};
  const seen = new Set<string>();

  for (const [key, value] of Object.entries(externalDirectory)) {
    const folder = externalDirectoryKeyToAuthorizedFolder(key, value);
    if (!folder) {
      hiddenEntries[key] = value;
      continue;
    }
    if (folder === workspaceRootFolder || seen.has(folder)) continue;
    seen.add(folder);
    folders.push(folder);
  }

  return { folders, hiddenEntries };
}

function parseAuthorizedFoldersPayload(input: unknown, workspaceRoot: string): string[] {
  if (!Array.isArray(input)) {
    throw new ApiError(400, "invalid_payload", "folders must be an array");
  }

  const workspaceRootFolder = normalizeAuthorizedFolderPath(workspaceRoot);
  const folders: string[] = [];
  const seen = new Set<string>();

  for (const item of input) {
    if (typeof item !== "string") {
      throw new ApiError(400, "invalid_payload", "folders must be an array of strings");
    }
    const folder = normalizeAuthorizedFolderPath(item);
    if (!folder || folder === workspaceRootFolder || seen.has(folder)) continue;
    seen.add(folder);
    folders.push(folder);
  }

  return folders;
}

function mergeAuthorizedFoldersIntoExternalDirectory(
  folders: string[],
  hiddenEntries: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = { ...hiddenEntries };
  for (const folder of folders) {
    next[authorizedFolderToExternalDirectoryKey(folder)] = "allow";
  }
  return Object.keys(next).length ? next : undefined;
}

function buildAuthorizedFoldersResponse(workspace: WorkspaceInfo, config: AuthorizedFoldersConfig): AuthorizedFoldersResponse {
  return {
    folders: config.folders,
    hiddenCount: Object.keys(config.hiddenEntries).length,
    workspaceRoot: normalizeAuthorizedFolderPath(workspace.path),
  };
}

function serializeWorkspace(workspace: ServerConfig["workspaces"][number]) {
  const { opencodeUsername, opencodePassword, ...rest } = workspace;
  const opencodeDirectory = resolveOpencodeDirectory(workspace);
  const opencode =
    workspace.baseUrl || opencodeDirectory || opencodeUsername || opencodePassword
      ? {
          baseUrl: workspace.baseUrl,
          directory: opencodeDirectory ?? undefined,
          username: opencodeUsername,
          password: opencodePassword,
        }
      : undefined;
  return {
    ...rest,
    opencode,
  };
}

function createRoutes(
  config: ServerConfig,
  approvals: ApprovalService,
  tokens: TokenService,
  env: EnvService,
  deepseekHarness: DeepSeekHarnessRuntimePool,
  codexHarness: CodexHarnessRuntimePool,
  sessionRuntime: WorkspaceSessionRuntime,
  onWorkspacesChanged: () => Promise<void>,
): Route[] {
  const routes: Route[] = [];
  let defaultPluginPreparation: Promise<void> | null = null;
  const prepareDefaultPlugins = () => {
    if (!defaultPluginPreparation) {
      defaultPluginPreparation = ensureDefaultBundledPluginPackages(config)
        .catch((error) => {
          defaultPluginPreparation = null;
          throw error;
        });
    }
    return defaultPluginPreparation;
  };
  registerCoreRoutes({
    routes,
    config,
    tokens,
    env,
    serverVersion: SERVER_VERSION,
    opencodeVersion: OPENCODE_VERSION,
    jsonResponse,
    readJsonBody,
    readOptionalJsonBody,
    parseOptionalBoolean,
    ensureWritable,
    buildCapabilities,
    fetchRuntimeControl,
    resolveWorkspace,
    serializeWorkspace,
    resolveToyUiEnabled,
    resolveDevLogPath,
    createOpenAiRealtimeVoiceSession,
  });

  registerWorkspaceRoutes({
    routes,
    config,
    onWorkspacesChanged,
    jsonResponse,
    readJsonBody,
    readOptionalJsonBody,
    parseOptionalBoolean,
    ensureWritable,
    resolveWorkspace,
    serializeWorkspace,
    reloadOpencodeEngine,
  });

  registerSessionRoutes({
    routes,
    config,
    jsonResponse,
    readJsonBody,
    parseOptionalBoolean,
    parseOptionalPositiveInteger,
    parseOptionalNonNegativeInteger,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    createWorkspaceOpencodeClient,
    unwrapOpencodeResult,
    deepseekHarness,
    codexHarness,
    sessionRuntime,
  });

  registerDeepSeekHarnessRoutes({
    routes,
    config,
    runtime: deepseekHarness,
    readJsonBody,
    requireClientScope,
    resolveWorkspace,
  });

  registerCodexHarnessRoutes({
    routes,
    config,
    runtime: codexHarness,
    readJsonBody,
    requireClientScope,
    resolveWorkspace,
  });

  registerPluginWorkshopRoutes({
    routes,
    config,
    jsonResponse,
    ensureWritable,
    readPluginPackageUploadBody,
    requireClientScope,
    resolveWorkspace,
  });

  registerWorkItemRoutes({
    routes,
    config,
    jsonResponse,
    readJsonBody,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
  });

  addRoute(routes, "GET", "/workspace/:id/templates", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const scope = parseTemplateLibraryScope(ctx.request.headers.get("x-ipollowork-resource-scope"));
    return jsonResponse({ items: await listTemplates(config, workspace.id, scope) });
  });

  addRoute(routes, "GET", "/workspace/:id/hyperframes-catalog", "client", async (ctx) => {
    await resolveWorkspace(config, ctx.params.id);
    return jsonResponse({ items: await listHyperframesCatalog() });
  });

  addRoute(routes, "GET", "/workspace/:id/templates/:templateId/cover", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const scope = parseTemplateLibraryScope(ctx.request.headers.get("x-ipollowork-resource-scope"));
    const cover = await readTemplateCover(config, workspace.id, ctx.params.templateId, scope);
    return new Response(cover.data, { headers: { "Content-Type": cover.contentType, "Cache-Control": "no-store" } });
  });

  addRoute(routes, "GET", "/workspace/:id/templates/:templateId/package", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const scope = parseTemplateLibraryScope(ctx.request.headers.get("x-ipollowork-resource-scope"));
    const template = await exportLocalTemplatePackage(config, workspace.id, ctx.params.templateId, scope);
    return new Response(Uint8Array.from(template.archive), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${template.manifest.id}-${template.manifest.version}${IPOLLOWORK_PACKAGE_EXTENSION}"`,
        "Content-Type": IPOLLOWORK_PACKAGE_MEDIA_TYPE,
        "X-iPollo-Artifact-SHA256": template.digest,
      },
    });
  });

  addRoute(routes, "POST", "/workspace/:id/templates/import", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const scope = parseTemplateLibraryScope(ctx.request.headers.get("x-ipollowork-resource-scope"));
    await requireApproval(ctx, { workspaceId: workspace.id, action: "template.import", summary: "Import a personal template", paths: [join(dirname(runtimeDbPathForServer(config)), "templates")] });
    const category = ctx.request.headers.get("x-ipollowork-template-category")?.trim();
    const archive = await readLimitedRequestBody(ctx.request, MAX_TEMPLATE_PACKAGE_BYTES);
    if (archive.byteLength === 0) throw new ApiError(400, "empty_template_package", "Choose an iPolloWork template package");
    return jsonResponse({ item: await importTemplate(config, workspace.id, archive, category, scope) }, 201);
  });

  addRoute(routes, "POST", "/workspace/:id/templates/from-session/package", "client", async (ctx) => {
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const template = await exportTemplateFromSession(config, workspace, parseTemplateFromSessionInput(await readJsonBody(ctx.request)));
    return new Response(Uint8Array.from(template.archive), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${template.manifest.id}-${template.manifest.version}${IPOLLOWORK_PACKAGE_EXTENSION}"`,
        "Content-Type": IPOLLOWORK_PACKAGE_MEDIA_TYPE,
        "X-iPollo-Artifact-SHA256": template.digest,
      },
    });
  });

  addRoute(routes, "POST", "/workspace/:id/templates/from-session", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const scope = parseTemplateLibraryScope(ctx.request.headers.get("x-ipollowork-resource-scope"));
    await requireApproval(ctx, { workspaceId: workspace.id, action: "template.save", summary: "Save the current work as a personal template", paths: [join(dirname(runtimeDbPathForServer(config)), "templates")] });
    return jsonResponse({ item: await saveTemplateFromSession(config, workspace, parseTemplateFromSessionInput(await readJsonBody(ctx.request)), scope) }, 201);
  });

  addRoute(routes, "POST", "/workspace/:id/templates/authoring-sessions", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const scope = parseTemplateLibraryScope(ctx.request.headers.get("x-ipollowork-resource-scope"));
    if (scope !== "personal") throw new ApiError(400, "enterprise_template_authoring_unsupported", "Template authoring is available in the personal template library only");
    const body = await readJsonBody(ctx.request);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const category = typeof body.category === "string" ? body.category : "";
    if (!sessionId || !category) throw new ApiError(400, "invalid_payload", "sessionId and category are required");
    return jsonResponse(await createTemplateAuthoringSession(config, workspace, {
      sessionId,
      category: category as import("@ipollowork/types/templates").TemplateCategory,
      pptxCompatibility: typeof body.pptxCompatibility === "string"
        ? body.pptxCompatibility as import("@ipollowork/types/templates").PptxCompatibility
        : undefined,
      purpose: typeof body.purpose === "string"
        ? body.purpose as import("@ipollowork/types/templates").TemplateAuthoringInput["purpose"]
        : undefined,
    }), 201);
  });

  addRoute(routes, "POST", "/workspace/:id/templates/from-session/validate", "client", async (ctx) => {
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) throw new ApiError(400, "invalid_payload", "sessionId is required");
    return jsonResponse(await validateTemplateFromSession(config, workspace, sessionId));
  });

  addRoute(routes, "POST", "/workspace/:id/templates/:templateId/install", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const scope = parseTemplateLibraryScope(ctx.request.headers.get("x-ipollowork-resource-scope"));
    await requireApproval(ctx, { workspaceId: workspace.id, action: "template.install", summary: `Install template ${ctx.params.templateId}`, paths: [join(dirname(runtimeDbPathForServer(config)), "templates")] });
    return jsonResponse({ item: await installBundledTemplate(config, workspace.id, ctx.params.templateId, scope) });
  });

  addRoute(routes, "DELETE", "/workspace/:id/templates/:templateId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const scope = parseTemplateLibraryScope(ctx.request.headers.get("x-ipollowork-resource-scope"));
    await requireApproval(ctx, { workspaceId: workspace.id, action: "template.uninstall", summary: `Uninstall template ${ctx.params.templateId}. Existing works will remain available.`, paths: [join(dirname(runtimeDbPathForServer(config)), "templates")] });
    return jsonResponse(await uninstallTemplate(config, workspace.id, ctx.params.templateId, scope));
  });

  addRoute(routes, "POST", "/workspace/:id/templates/:templateId/materialize", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const scope = parseTemplateLibraryScope(ctx.request.headers.get("x-ipollowork-resource-scope"));
    const body = await readJsonBody(ctx.request);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) throw new ApiError(400, "invalid_payload", "sessionId is required");
    return jsonResponse(await materializeTemplate(config, workspace, ctx.params.templateId, sessionId, body.brief, scope));
  });

  addRoute(routes, "POST", "/workspace/:id/template-sessions/:sessionId/adopt-video", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse(await adoptLegacyVideoSession(config, workspace, ctx.params.sessionId));
  });

  addRoute(routes, "GET", "/workspace/:id/template-sessions", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse({ items: await listTemplateSessions(config, workspace) });
  });

  addRoute(routes, "GET", "/workspace/:id/template-sessions/:sessionId", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse(await readTemplateSession(config, workspace, ctx.params.sessionId));
  });

  addRoute(routes, "GET", "/workspace/:id/config", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const ipollowork = await readiPolloWorkConfigForWorkspace(config, workspace);
    const [persistedOpencode, runtimeOpencode, providerChannels] = await Promise.all([
      readOpencodeConfig(workspace.path),
      readRuntimeOpencodeConfig(config, workspace.id),
      readRuntimeProviderChannels(config),
    ]);
    const opencode = mergeOpencodeConfigs(
      persistedOpencode,
      runtimeOpencode,
      providerChannels,
    );
    const lastAudit = await readLastAudit(workspace.path, workspace.id);
    return jsonResponse({ opencode, ipollowork, updatedAt: lastAudit?.timestamp ?? null });
  });

  addRoute(routes, "GET", "/workspace/:id/desktop-cloud-sync", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const ipollowork = await readiPolloWorkConfigForWorkspace(config, workspace);
    return jsonResponse(readDesktopCloudSyncState(ipollowork));
  });

  addRoute(routes, "POST", "/workspace/:id/desktop-cloud-sync", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const snapshot = normalizeResourceSnapshot(body.snapshot);
    if (!snapshot) {
      throw new ApiError(400, "invalid_payload", "snapshot is required");
    }

    const result = await enqueueDesktopCloudSync(async () => {
      const ipollowork = await readiPolloWorkConfigForWorkspace(config, workspace);
      const next = syncDesktopCloudResources({ ipollowork, snapshot });
      await writeiPolloWorkWorkspaceConfig(config, workspace.id, (current) => ({
        ...current,
        desktopCloudSync: next.state,
      }));
      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "desktop_cloud_sync.update",
        target: ipolloworkConfigPath(workspace.path),
        summary: "Updated desktop cloud sync state",
        timestamp: Date.now(),
      });
      return next;
    });
    return jsonResponse({ changes: result.changes, state: result.state });
  });

  addRoute(routes, "POST", "/workspace/:id/plugin-packages/import/github", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) throw new ApiError(400, "invalid_payload", "GitHub URL is required");
    const ref = typeof body.ref === "string" && body.ref.trim() ? body.ref.trim() : undefined;
    const dryRun = body.dryRun === true;
    const bundle = await resolveCompatibleGitHubPluginBundle({ url, ref });
    requireClientScope(ctx, "collaborator");
    return withMaterializedCompatibleGitHubPluginBundle(bundle, async (packageRoot) => {
      const preview = await previewPluginPackage({ packageRoot, engineId: workspace.engineId ?? DEFAULT_ENGINE_ID });
      const safety = await assertPluginPackageSafeForImport({ packageRoot, preview, purpose: "install" });
      const incomingVersion = preview.manifest.package?.version;
      if (!incomingVersion) {
        throw new ApiError(400, "plugin_package_metadata_required", "Package metadata is required for installation");
      }
      const current = (await listInstalledPluginPackages({ serverConfig: config }))
        .find((item) => item.pluginId === preview.manifest.id);
      const installedVersion = current?.version ?? null;
      const versionChange = pluginPackageVersionChange(installedVersion, incomingVersion);
      if (dryRun) {
        return jsonResponse({
          preview: {
            ...preview,
            safety,
            installedVersion,
            versionChange,
            ...pluginPackageEngineState(workspace, preview.manifest),
          },
          source: bundle.preview,
        });
      }
      ensureWritable(config);
      if (versionChange === "downgrade" && ctx.url.searchParams.get("allowDowngrade") !== "true") {
        throw new ApiError(
          409,
          "plugin_package_downgrade_confirmation_required",
          `Importing ${preview.manifest.name} ${incomingVersion} would replace installed version ${installedVersion}`,
          { installedVersion, incomingVersion },
        );
      }
      await requireApproval(ctx, {
        workspaceId: workspace.id,
        action: "plugin_packages.install",
        summary: `Import plugin package ${preview.manifest.name} from GitHub`,
        paths: pluginProjectionRoots(config),
      });
      const result = current && current.version !== preview.manifest.package?.version
        ? await updatePluginPackage({ serverConfig: config, packageRoot })
        : await installPluginPackage({ serverConfig: config, packageRoot });
      await disposePluginServicesEverywhere(config, preview.manifest.id);
      await reconcilePluginAuthorization({ config, pluginId: preview.manifest.id });
      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "plugin_packages.import",
        target: url,
        summary: `Imported plugin package ${preview.manifest.name} from GitHub`,
        timestamp: Date.now(),
      });
      emitPluginReloadEvents(ctx.reloadEvents, config, "plugins", {
        type: "plugin",
        name: preview.manifest.id,
        action: current ? "updated" : "added",
      });
      const installedItem = (await listInstalledPluginPackages({ serverConfig: config }))
        .find((entry) => entry.pluginId === preview.manifest.id);
      const item = installedItem
        ? { ...installedItem, ...pluginPackageEngineState(workspace, installedItem.manifest) }
        : undefined;
      return jsonResponse({ result, item, safety, source: bundle.preview });
    });
  });

  addRoute(routes, "GET", "/workspace/:id/plugin-packages", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    await prepareDefaultPlugins();
    await reconcilePluginPackagesForWorkspace({ serverConfig: config, workspaceId: workspace.id, workspaceRoot: workspace.path });
    const items = (await listInstalledPluginPackages({ serverConfig: config })).map((item) => ({
      ...item,
      ...pluginPackageEngineState(workspace, item.manifest),
    }));
    return jsonResponse({ items });
  });

  addRoute(routes, "GET", "/workspace/:id/plugin-packages/:pluginId/ui/:resourceId", "client", async (ctx) => {
    await resolveWorkspace(config, ctx.params.id);
    const result = await readInstalledPluginUiResource({
      serverConfig: config,
      pluginId: ctx.params.pluginId ?? "",
      resourceId: ctx.params.resourceId ?? "",
    });
    return jsonResponse(result);
  });

  addRoute(routes, "GET", "/workspace/:id/plugin-packages/catalog", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    await prepareDefaultPlugins();
    const installed = await listInstalledPluginPackages({ serverConfig: config });
    const installedById = new Map(installed.map((item) => [item.pluginId, item]));
    const items = await Promise.all(bundledPluginPackageIds.map(async (pluginId) => {
      const packageRoot = await resolveBundledPluginPackageRoot(pluginId);
      const preview = await previewPluginPackage({ packageRoot });
      const current = installedById.get(pluginId);
      return {
        pluginId,
        name: preview.manifest.name,
        version: preview.manifest.package?.version ?? "",
        manifest: preview.manifest,
        integrity: preview.integrity,
        installedVersion: current?.version ?? null,
        updateAvailable: Boolean(current && current.version !== preview.manifest.package?.version),
        ...pluginPackageEngineState(workspace, preview.manifest),
      };
    }));
    return jsonResponse({ items });
  });

  addRoute(routes, "POST", "/workspace/:id/plugin-packages/catalog/:pluginId/install", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const pluginId = ctx.params.pluginId ?? "";
    const packageRoot = await resolveBundledPluginPackageRoot(pluginId);
    const preview = await previewPluginPackage({ packageRoot, engineId: workspace.engineId ?? DEFAULT_ENGINE_ID });
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "plugin_packages.install",
      summary: `Install bundled plugin package ${preview.manifest.name}`,
      paths: pluginProjectionRoots(config),
    });
    const current = (await listInstalledPluginPackages({ serverConfig: config }))
      .find((item) => item.pluginId === pluginId);
    const result = current && current.version !== preview.manifest.package?.version
      ? await updatePluginPackage({ serverConfig: config, packageRoot })
      : await installPluginPackage({ serverConfig: config, packageRoot });
    await disposePluginServicesEverywhere(config, pluginId);
    await reconcilePluginAuthorization({ config, pluginId });
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "plugin_packages.install",
      target: `bundled:${pluginId}`,
      summary: `Installed bundled plugin package ${preview.manifest.name} ${preview.manifest.package?.version ?? ""}`.trim(),
      timestamp: Date.now(),
    });
    emitPluginReloadEvents(ctx.reloadEvents, config, "plugins", {
      type: "plugin",
      name: pluginId,
      action: current ? "updated" : "added",
    });
    const installedItem = (await listInstalledPluginPackages({ serverConfig: config }))
      .find((entry) => entry.pluginId === pluginId);
    const item = installedItem ? { ...installedItem, ...pluginPackageEngineState(workspace, installedItem.manifest) } : undefined;
    return jsonResponse({ result, item });
  });

  addRoute(routes, "POST", "/workspace/:id/plugin-packages/import/validate", "client", async (ctx) => {
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readPluginPackageUploadBody(ctx.request);
    return withMaterializedPluginPackageUpload(body, "install", async ({ packageRoot }) => {
      const preview = await previewPluginPackage({ packageRoot, engineId: workspace.engineId ?? DEFAULT_ENGINE_ID });
      const safety = await assertPluginPackageSafeForImport({ packageRoot, preview, purpose: "install" });
      const incomingVersion = preview.manifest.package?.version;
      if (!incomingVersion) {
        throw new ApiError(400, "plugin_package_metadata_required", "Package metadata is required for installation");
      }
      const current = (await listInstalledPluginPackages({ serverConfig: config }))
        .find((item) => item.pluginId === preview.manifest.id);
      const installedVersion = current?.version ?? null;
      return jsonResponse({
        preview: {
          ...preview,
          safety,
          installedVersion,
          versionChange: pluginPackageVersionChange(installedVersion, incomingVersion),
          ...pluginPackageEngineState(workspace, preview.manifest),
        },
      });

    });
  });

  addRoute(routes, "POST", "/workspace/:id/plugin-packages/import", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readPluginPackageUploadBody(ctx.request);
    return withMaterializedPluginPackageUpload(body, "install", async ({ archiveName, packageRoot }) => {
      const preview = await previewPluginPackage({ packageRoot, engineId: workspace.engineId ?? DEFAULT_ENGINE_ID });
      const safety = await assertPluginPackageSafeForImport({ packageRoot, preview, purpose: "install" });
      const current = (await listInstalledPluginPackages({ serverConfig: config }))
        .find((item) => item.pluginId === preview.manifest.id);
      const incomingVersion = preview.manifest.package?.version;
      if (!incomingVersion) {
        throw new ApiError(400, "plugin_package_metadata_required", "Package metadata is required for installation");
      }
      if (
        pluginPackageVersionChange(current?.version ?? null, incomingVersion) === "downgrade"
        && ctx.url.searchParams.get("allowDowngrade") !== "true"
      ) {
        throw new ApiError(
          409,
          "plugin_package_downgrade_confirmation_required",
          `Importing ${preview.manifest.name} ${incomingVersion} would replace installed version ${current?.version}`,
          { installedVersion: current?.version, incomingVersion },
        );
      }

      await requireApproval(ctx, {
        workspaceId: workspace.id,
        action: "plugin_packages.install",
        summary: `Import declarative plugin package ${preview.manifest.name}`,
        paths: pluginProjectionRoots(config),
      });
      const result = current && current.version !== preview.manifest.package?.version
        ? await updatePluginPackage({ serverConfig: config, packageRoot })
        : await installPluginPackage({ serverConfig: config, packageRoot });
      await disposePluginServicesEverywhere(config, preview.manifest.id);
      await reconcilePluginAuthorization({ config, pluginId: preview.manifest.id });
      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "plugin_packages.import",
        target: archiveName,
        summary: `Imported declarative plugin package ${preview.manifest.name} ${preview.manifest.package?.version ?? ""}`.trim(),
        timestamp: Date.now(),
      });
      emitPluginReloadEvents(ctx.reloadEvents, config, "plugins", {
        type: "plugin",
        name: preview.manifest.id,
        action: current ? "updated" : "added",
      });
      const installedItem = (await listInstalledPluginPackages({ serverConfig: config }))
        .find((entry) => entry.pluginId === preview.manifest.id);
      const item = installedItem ? { ...installedItem, ...pluginPackageEngineState(workspace, installedItem.manifest) } : undefined;
      return jsonResponse({ result, item, safety });
    });
  });

  addRoute(routes, "POST", "/workspace/:id/plugin-packages/validate", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const packageRoot = resolveLocalPluginPackageRoot(workspace.path, body.packageRoot);
    const preview = await previewPluginPackage({ packageRoot, engineId: workspace.engineId ?? DEFAULT_ENGINE_ID });
    const safety = await assertPluginPackageSafeForImport({ packageRoot, preview, purpose: "install" });
    return jsonResponse({ preview: { ...preview, safety, ...pluginPackageEngineState(workspace, preview.manifest) } });

  });

  addRoute(routes, "POST", "/workspace/:id/plugin-packages", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const packageRoot = resolveLocalPluginPackageRoot(workspace.path, body.packageRoot);
    const preview = await previewPluginPackage({ packageRoot, engineId: workspace.engineId ?? DEFAULT_ENGINE_ID });
    await assertPluginPackageSafeForImport({ packageRoot, preview, purpose: "install" });

    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "plugin_packages.install",
      summary: `Install plugin package ${preview.manifest.name}`,
      paths: pluginProjectionRoots(config),
    });
    const result = await installPluginPackage({ serverConfig: config, packageRoot });
    await reconcilePluginAuthorization({ config, pluginId: preview.manifest.id });
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "plugin_packages.install",
      target: packageRoot,
      summary: `Installed plugin package ${preview.manifest.name} ${preview.manifest.package?.version ?? ""}`.trim(),
      timestamp: Date.now(),
    });
    if (result.status === "installed") emitPluginReloadEvents(ctx.reloadEvents, config, "plugins", { type: "plugin", name: preview.manifest.id, action: "added" });
    const installedItem = (await listInstalledPluginPackages({ serverConfig: config })).find((entry) => entry.pluginId === preview.manifest.id);
    const item = installedItem ? { ...installedItem, ...pluginPackageEngineState(workspace, installedItem.manifest) } : undefined;

    return jsonResponse({ result, item });
  });

  addRoute(routes, "POST", "/workspace/:id/plugin-packages/:pluginId/update", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const packageRoot = resolveLocalPluginPackageRoot(workspace.path, body.packageRoot);
    const preview = await previewPluginPackage({ packageRoot, engineId: workspace.engineId ?? DEFAULT_ENGINE_ID });
    await assertPluginPackageSafeForImport({ packageRoot, preview, purpose: "install" });

    if (preview.manifest.id !== ctx.params.pluginId) throw new ApiError(400, "plugin_package_id_mismatch", "Update package ID does not match the installed plugin");
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "plugin_packages.update",
      summary: `Update plugin package ${preview.manifest.name}`,
      paths: pluginProjectionRoots(config),
    });
    const result = await updatePluginPackage({ serverConfig: config, packageRoot });
    await disposePluginServicesEverywhere(config, preview.manifest.id);
    await reconcilePluginAuthorization({ config, pluginId: preview.manifest.id });
    emitPluginReloadEvents(ctx.reloadEvents, config, "plugins", { type: "plugin", name: preview.manifest.id, action: "updated" });
    return jsonResponse({ result });
  });

  addRoute(routes, "POST", "/workspace/:id/plugin-packages/:pluginId/rollback", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const pluginId = ctx.params.pluginId ?? "";
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "plugin_packages.rollback",
      summary: `Roll back plugin package ${pluginId}`,
      paths: pluginProjectionRoots(config),
    });
    const result = await rollbackPluginPackage({ serverConfig: config, pluginId });
    await disposePluginServicesEverywhere(config, pluginId);
    await reconcilePluginAuthorization({ config, pluginId });
    emitPluginReloadEvents(ctx.reloadEvents, config, "plugins", { type: "plugin", name: pluginId, action: "updated" });
    return jsonResponse({ result });
  });

  addRoute(routes, "PATCH", "/workspace/:id/plugin-packages/:pluginId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    if (typeof body.enabled !== "boolean") throw new ApiError(400, "invalid_payload", "enabled must be a boolean");
    const result = await setPluginPackageEnabled({
      serverConfig: config,
      pluginId: ctx.params.pluginId ?? "",
      enabled: body.enabled,
    });
    if (result.changed) await disposePluginServicesEverywhere(config, result.pluginId);
    if (result.changed) emitPluginReloadEvents(ctx.reloadEvents, config, "plugins", { type: "plugin", name: result.pluginId, action: body.enabled ? "added" : "removed" });
    return jsonResponse({ result });
  });

  addRoute(routes, "PATCH", "/workspace/:id/plugin-packages/:pluginId/resources/:resourceId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    if (typeof body.enabled !== "boolean") throw new ApiError(400, "invalid_payload", "enabled must be a boolean");
    const result = await setPluginPackageResourceEnabled({
      serverConfig: config,
      pluginId: ctx.params.pluginId ?? "",
      resourceId: ctx.params.resourceId ?? "",
      enabled: body.enabled,
    });
    if (result.changed) emitPluginReloadEvents(ctx.reloadEvents, config, "skills", {
      type: "skill",
      name: result.resourceId,
      action: body.enabled ? "added" : "removed",
    });
    return jsonResponse({ result });
  });

  addRoute(routes, "DELETE", "/workspace/:id/plugin-packages/:pluginId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const pluginId = ctx.params.pluginId ?? "";
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "plugin_packages.remove",
      summary: `Remove plugin package ${pluginId}`,
      paths: pluginProjectionRoots(config),
    });
    const installed = (await listInstalledPluginPackages({ serverConfig: config }))
      .find((entry) => entry.pluginId === pluginId);
    const result = await uninstallPluginPackage({ serverConfig: config, pluginId });
    try {
      await disposePluginServicesEverywhere(config, pluginId);
    } finally {
      try {
        await Promise.all(config.workspaces.map((entry) => deletePluginServiceData(config, entry.id, pluginId)));
      } finally {
        await deletePluginAuthorization({
          config,
          pluginId,
          methods: installed?.manifest.authorization?.methods ?? [],
        });
      }
    }
    emitPluginReloadEvents(ctx.reloadEvents, config, "plugins", { type: "plugin", name: pluginId, action: "removed" });
    return jsonResponse({ result });
  });

  addRoute(routes, "GET", "/workspace/:id/plugin-packages/:pluginId/authorization", "client", async (ctx) => {
    await resolveWorkspace(config, ctx.params.id);
    return jsonResponse(await listPluginAuthorization(config, ctx.params.pluginId ?? ""));
  });

  addRoute(routes, "POST", "/workspace/:id/plugin-packages/:pluginId/authorization/:methodId/credentials", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const accountId = typeof body.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : "default";
    const status = await savePluginSecretAuthorization({
      config,
      pluginId: ctx.params.pluginId ?? "",
      methodId: ctx.params.methodId ?? "",
      accountId,
      values: body.values,
    });
    await disposePluginServicesEverywhere(config, ctx.params.pluginId ?? "");
    return jsonResponse({ status });
  });

  addRoute(routes, "POST", "/workspace/:id/plugin-packages/:pluginId/authorization/:methodId/start", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readOptionalJsonBody(ctx.request);
    const accountId = typeof body.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : "default";
    const callbackUrl = new URL(ctx.request.url);
    callbackUrl.pathname = `/workspace/${encodeURIComponent(workspace.id)}/plugin-packages/${encodeURIComponent(ctx.params.pluginId ?? "")}/authorization/callback`;
    callbackUrl.search = "";
    const flow = await startIndependentPluginAuthorization({
      config,
      pluginId: ctx.params.pluginId ?? "",
      methodId: ctx.params.methodId ?? "",
      accountId,
      callbackUrl: callbackUrl.toString(),
    });
    return jsonResponse({ flow });
  });

  addRoute(routes, "GET", "/workspace/:id/plugin-packages/:pluginId/authorization/callback", "none", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const status = await completePluginBrowserAuthorization({
      config,
      pluginId: ctx.params.pluginId ?? "",
      state: ctx.url.searchParams.get("state") ?? "",
      code: ctx.url.searchParams.get("code") ?? "",
    });
    await disposePluginServicesEverywhere(config, ctx.params.pluginId ?? "");
    const title = status.status === "connected" ? "Plugin connected" : "Plugin authorization finished";
    return new Response(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:32px"><h1>${title}</h1><p>You can close this window and return to iPolloWork.</p></body>`, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  });

  addRoute(routes, "POST", "/workspace/:id/plugin-packages/:pluginId/authorization/callback", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const status = await completePluginBrowserAuthorization({
      config,
      pluginId: ctx.params.pluginId ?? "",
      state: typeof body.state === "string" ? body.state : "",
      code: typeof body.code === "string" ? body.code : undefined,
    });
    await disposePluginServicesEverywhere(config, ctx.params.pluginId ?? "");
    return jsonResponse({ status });
  });

  addRoute(routes, "POST", "/workspace/:id/plugin-packages/:pluginId/authorization/device/:flowId/poll", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const status = await pollPluginDeviceAuthorization({ config, pluginId: ctx.params.pluginId ?? "", flowId: ctx.params.flowId ?? "" });
    if ("status" in status && status.status === "connected") await disposePluginServicesEverywhere(config, ctx.params.pluginId ?? "");
    return jsonResponse({ status });
  });

  addRoute(routes, "DELETE", "/workspace/:id/plugin-packages/:pluginId/authorization/flows/:flowId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const removed = await cancelPluginAuthorizationFlow({
      config,
      pluginId: ctx.params.pluginId ?? "",
      flowId: ctx.params.flowId ?? "",
    });
    return jsonResponse({ removed });
  });

  addRoute(routes, "DELETE", "/workspace/:id/plugin-packages/:pluginId/authorization/:accountId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const removed = await revokePluginAuthorization({ config, pluginId: ctx.params.pluginId ?? "", accountId: ctx.params.accountId ?? "" });
    if (removed) await disposePluginServicesEverywhere(config, ctx.params.pluginId ?? "");
    return jsonResponse({ removed });
  });

  addRoute(routes, "GET", "/workspace/:id/authorized-folders", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const opencode = mergeOpencodeConfigs(
      await readOpencodeConfig(workspace.path),
      await readRuntimeOpencodeConfig(config, workspace.id),
    );
    const foldersConfig = readAuthorizedFoldersFromOpencodeConfig(opencode, workspace.path);
    return jsonResponse(buildAuthorizedFoldersResponse(workspace, foldersConfig));
  });

  addRoute(routes, "PUT", "/workspace/:id/authorized-folders", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const folders = parseAuthorizedFoldersPayload(body.folders, workspace.path);
    const configPath = ipolloworkConfigPath(workspace.path);

    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "config.authorized_folders.write",
      summary: "Update authorized folders",
      paths: [configPath],
    });

    const persistedOpencode = await readOpencodeConfig(workspace.path);
    const runtimeOpencode = await readRuntimeOpencodeConfig(config, workspace.id);
    const existingOpencode = mergeOpencodeConfigs(persistedOpencode, runtimeOpencode);
    const existingFoldersConfig = readAuthorizedFoldersFromOpencodeConfig(existingOpencode, workspace.path);
    const nextExternalDirectory = mergeAuthorizedFoldersIntoExternalDirectory(
      folders,
      existingFoldersConfig.hiddenEntries,
    );

    await writeRuntimeOpencodeConfig(config, workspace.id, (current) => ({
      ...current,
      permission: {
        ...(ensurePlainObject(current.permission)),
        external_directory: nextExternalDirectory ?? {},
      },
    }));

    const updatedAt = Date.now();
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "config.authorized_folders.write",
      target: configPath,
      summary: "Updated authorized folders",
      timestamp: updatedAt,
    });

    emitReloadEvent(ctx.reloadEvents, workspace, "config", buildConfigTrigger(configPath));

    const updatedFoldersConfig = readAuthorizedFoldersFromOpencodeConfig({
      permission: { external_directory: nextExternalDirectory ?? {} },
    }, workspace.path);

    const response: AuthorizedFoldersUpdateResponse = {
      folders: updatedFoldersConfig.folders,
      hiddenCount: Object.keys(updatedFoldersConfig.hiddenEntries).length,
      updatedAt,
    };
    return jsonResponse(response);
  });

  addRoute(routes, "GET", "/workspace/:id/runtime-config", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const runtime = await readRuntimeOpencodeConfig(config, workspace.id);
    const rawOpencode = await readRawOpencodeConfig(opencodeConfigPath(workspace.path));
    const persistedOpencode = await readOpencodeConfig(workspace.path);
    const globalOpencodePath = resolveOpencodeConfigFilePath("global", workspace.path);
    const rawGlobalOpencode = await readRawOpencodeConfig(globalOpencodePath);
    const globalOpencode = (await readJsoncFile(globalOpencodePath, {} as Record<string, unknown>, { allowInvalid: true })).data;
    const effectiveRuntime = await buildiPolloWorkRuntimeConfigObject(config, workspace.id);

    return jsonResponse({
      runtime,
      runtimeKeys: runtimeConfigKeys(runtime),
      effectiveRuntime,
      sources: {
        projectOpencode: {
          path: opencodeConfigPath(workspace.path),
          exists: rawOpencode.exists,
          keys: userOpencodeConfigKeys(persistedOpencode),
          config: persistedOpencode,
        },
        globalOpencode: {
          path: globalOpencodePath,
          exists: rawGlobalOpencode.exists,
          keys: userOpencodeConfigKeys(globalOpencode),
          config: globalOpencode,
        },
        runtimeDatabase: {
          keys: runtimeConfigKeys(runtime),
          config: runtime,
        },
        injected: {
          keys: runtimeConfigKeys(effectiveRuntime),
          config: effectiveRuntime,
        },
      },
    });
  });

  addRoute(routes, "GET", "/workspace/:id/opencode-config", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const scope = normalizeOpencodeScope(ctx.url.searchParams.get("scope"));
    const configPath = resolveOpencodeConfigFilePath(scope, workspace.path);
    const result = await readRawOpencodeConfig(configPath);
    return jsonResponse({ path: configPath, exists: result.exists, content: result.content });
  });

  addRoute(routes, "POST", "/workspace/:id/opencode-config", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const scope = normalizeOpencodeScope(typeof body.scope === "string" ? body.scope : null);
    const content = typeof body.content === "string" ? body.content : null;
    if (content === null) {
      throw new ApiError(400, "invalid_payload", "content must be a string");
    }

    const configPath = resolveOpencodeConfigFilePath(scope, workspace.path);
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: scope === "global" ? "config.global.write" : "config.write",
      summary: `Write ${scope} OpenCode config`,
      paths: [configPath],
    });

    const nextContent = content.endsWith("\n") ? content : `${content}\n`;
    const current = await readRawOpencodeConfig(configPath);
    const changed = !current.exists || current.content !== nextContent;
    if (changed) {
      await ensureDir(dirname(configPath));
      await writeFile(configPath, nextContent, "utf8");
    }

    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: scope === "global" ? "config.global.write" : "config.write",
      target: configPath,
      summary: `Updated ${scope} OpenCode config`,
      timestamp: Date.now(),
    });

    if (scope === "project" && changed) {
      emitReloadEvent(ctx.reloadEvents, workspace, "config", buildConfigTrigger(configPath));
    }

    return jsonResponse({
      ok: true,
      status: 0,
      stdout: `Wrote ${configPath}`,
      stderr: "",
    });
  });

  addRoute(routes, "GET", "/workspace/:id/audit", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const limitParam = ctx.url.searchParams.get("limit");
    const parsed = limitParam ? Number(limitParam) : NaN;
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
    const items = await readAuditEntries(workspace.path, workspace.id, limit);
    return jsonResponse({ items });
  });

  addRoute(routes, "PATCH", "/workspace/:id/config", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const opencode = body.opencode as Record<string, unknown> | undefined;
    const ipollowork = body.ipollowork as Record<string, unknown> | undefined;
    let runtimeChanged = false;

    if (!opencode && !ipollowork) {
      throw new ApiError(400, "invalid_payload", "opencode or ipollowork updates required");
    }

    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "config.patch",
      summary: "Patch workspace config",
      paths: [opencode || ipollowork ? ipolloworkConfigPath(workspace.path) : null].filter(Boolean) as string[],
    });

    if (opencode) {
      const configPath = ipolloworkConfigPath(workspace.path);
      const nextOpencode = ensurePlainObject(opencode);
      const { permission, provider, ...topLevelUpdates } = nextOpencode;
      const logicalUpdates: Record<string, unknown> = { ...topLevelUpdates };

      // Provider channels are application-level resources. Store them once and
      // project the same profile into every engine instead of binding them to
      // whichever OpenCode workspace happened to be selected during setup.
      const providerUpdate = isRecord(provider) ? provider : {};
      if (Object.keys(providerUpdate).length) {
        const result = await writeRuntimeProviderChannels(config, (current) => (
          mergeRuntimeProviderUpdate(current, providerUpdate) ?? {}
        ));
        runtimeChanged ||= result.changed;
      }

      const permissionUpdate = ensurePlainObject(permission);
      if (Object.prototype.hasOwnProperty.call(permissionUpdate, "external_directory")) {
        const existingRuntime = await readRuntimeOpencodeConfig(config, workspace.id);
        const existingPermission = ensurePlainObject(existingRuntime.permission);
        const nextExternalDirectory = permissionUpdate.external_directory;
        const existingPermissionKeys = Object.keys(existingPermission);
        const removePermissionParent =
          typeof nextExternalDirectory === "undefined" &&
            (existingPermissionKeys.length === 0 ||
            (existingPermissionKeys.length === 1 && Object.prototype.hasOwnProperty.call(existingPermission, "external_directory")));

        if (removePermissionParent) {
          logicalUpdates.permission = undefined;
        } else {
          logicalUpdates.permission = {
            ...existingPermission,
            external_directory: nextExternalDirectory,
          };
        }
      }

      if (Object.keys(logicalUpdates).length || Object.prototype.hasOwnProperty.call(logicalUpdates, "permission")) {
        const result = await writeRuntimeOpencodeConfig(config, workspace.id, (current) => ({
          ...current,
          ...logicalUpdates,
        }));
        runtimeChanged ||= result.changed;
      }
    }
    if (ipollowork) {
      await writeiPolloWorkWorkspaceConfig(config, workspace.id, (current) => ({
        ...current,
        ...ipollowork,
      }));
    }

    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "config.patch",
      target: ipolloworkConfigPath(workspace.path),
      summary: "Patched workspace config",
      timestamp: Date.now(),
    });

    // A no-op provider patch (for example cloud sync reconciling an identical
    // block) must not force an engine reload; that caused a dispose/create loop.
    if (opencode && runtimeChanged) {
      emitReloadEvent(ctx.reloadEvents, workspace, "config", buildConfigTrigger(ipolloworkConfigPath(workspace.path)));
    }

    return jsonResponse({ updatedAt: Date.now() });
  });

  registerOperationRoutes({
    routes,
    config,
    jsonResponse,
    readJsonBody,
    requireClientScope,
    resolveWorkspace,
    reloadWorkspaceEngine: async (serverConfig, workspace) => {
      if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) {
        await deepseekHarness.closeWorkspace(workspace.id);
        return;
      }
      if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
        await codexHarness.closeWorkspace(workspace.id);
        return;
      }
      await reloadOpencodeEngine(serverConfig, workspace);
    },
  });

  registerFileRoutes({
    routes,
    config,
    jsonResponse,
    readJsonBody,
    ensureWritable,
    requireApproval,
    requireClientScope,
    resolveWorkspace,
    resolveInboxEnabled,
    resolveOutboxEnabled,
    resolveInboxMaxBytes,
    scopeRank,
  });

  addRoute(routes, "GET", "/hub/skills", "client", async (ctx) => {
    const owner = ctx.url.searchParams.get("owner")?.trim();
    const repo = ctx.url.searchParams.get("repo")?.trim();
    const ref = ctx.url.searchParams.get("ref")?.trim();
    const items = await listHubSkills({
      owner: owner || "different-ai",
      repo: repo || "ipollowork-hub",
      ref: ref || "main",
    });
    return jsonResponse({ items });
  });

  addRoute(routes, "GET", "/workspace/:id/skills", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const includeGlobal = ctx.url.searchParams.get("includeGlobal") === "true";
    const items = await listSkills(workspace.path, includeGlobal);
    return jsonResponse({ items });
  });

  addRoute(routes, "POST", "/workspace/:id/skills/hub/:name", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const name = String(ctx.params.name ?? "").trim();
    if (!name) {
      throw new ApiError(400, "invalid_skill_name", "Skill name is required");
    }
    const body = await readJsonBody(ctx.request);
    const overwrite = body?.overwrite === true;
    const repoPayload = body?.repo && typeof body.repo === "object" ? (body.repo as Record<string, unknown>) : undefined;
    const repo = repoPayload
      ? {
          owner: typeof repoPayload.owner === "string" ? repoPayload.owner : undefined,
          repo: typeof repoPayload.repo === "string" ? repoPayload.repo : undefined,
          ref: typeof repoPayload.ref === "string" ? repoPayload.ref : undefined,
        }
      : undefined;

    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "skills.install_hub",
      summary: `Install hub skill ${name}`,
      paths: [join(workspace.path, ".opencode", "skills", name)],
    });

    const result = await installHubSkill(workspace.path, { name, overwrite, repo });
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "skills.install_hub",
      target: result.path,
      summary: `Installed hub skill ${name}`,
      timestamp: Date.now(),
    });
    emitReloadEvent(ctx.reloadEvents, workspace, "skills", {
      type: "skill",
      name,
      action: result.action,
      path: result.path,
    });

    return jsonResponse({ ok: true, ...result });
  });

  addRoute(routes, "GET", "/workspace/:id/skills/:name", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const includeGlobal = ctx.url.searchParams.get("includeGlobal") === "true";
    const name = String(ctx.params.name ?? "").trim();
    if (!name) {
      throw new ApiError(400, "invalid_skill_name", "Skill name is required");
    }
    const items = await listSkills(workspace.path, includeGlobal);
    const item = items.find((skill) => skill.name === name);
    if (!item) {
      throw new ApiError(404, "skill_not_found", `Skill not found: ${name}`);
    }
    const content = await readFile(item.path, "utf8");
    return jsonResponse({ item, content });
  });

  addRoute(routes, "POST", "/workspace/:id/skills", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const name = String(body.name ?? "");
    const content = String(body.content ?? "");
    const description = body.description ? String(body.description) : undefined;
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "skills.upsert",
      summary: `Upsert skill ${name}`,
      paths: [join(workspace.path, ".opencode", "skills", name, "SKILL.md")],
    });
    const result = await upsertSkill(workspace.path, { name, content, description });
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "skills.upsert",
      target: result.path,
      summary: `Upserted skill ${name}`,
      timestamp: Date.now(),
    });
    emitReloadEvent(ctx.reloadEvents, workspace, "skills", {
      type: "skill",
      name,
      action: result.action,
      path: result.path,
    });
    return jsonResponse({ name, path: result.path, description: description ?? "", scope: "project" });
  });

  addRoute(routes, "DELETE", "/workspace/:id/skills/:name", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const name = String(ctx.params.name ?? "").trim();
    if (!name) {
      throw new ApiError(400, "invalid_skill_name", "Skill name is required");
    }
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "skills.delete",
      summary: `Delete skill ${name}`,
      paths: [join(workspace.path, ".opencode", "skills", name)],
    });
    const result = await deleteSkill(workspace.path, name);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "skills.delete",
      target: result.path,
      summary: `Deleted skill ${name}`,
      timestamp: Date.now(),
    });
    emitReloadEvent(ctx.reloadEvents, workspace, "skills", {
      type: "skill",
      name,
      action: "removed",
      path: result.path,
    });
    return jsonResponse({ ok: true, name, path: result.path });
  });

  addRoute(routes, "GET", "/workspace/:id/mcp", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const items = await listMcp(config, workspace.id, workspace.path);
    return jsonResponse({ items, engineSync: engineMcpSyncState(workspace.id) });
  });

  // Portable export of installed skills and MCP servers (including
  // iPolloWork-managed runtime MCPs that only live in the runtime DB), so
  // agents can package them into marketplace plugins. Read-only; MCP
  // secrets (headers/environment) are always redacted.
  addRoute(routes, "POST", "/workspace/:id/extensions/export", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const skills = Array.isArray(body.skills)
      ? body.skills.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const mcps = Array.isArray(body.mcps)
      ? body.mcps.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    if (skills.length === 0 && mcps.length === 0) {
      throw new ApiError(400, "invalid_payload", "At least one skill or mcp name is required");
    }
    const result = await exportExtensions({
      serverConfig: config,
      workspaceId: workspace.id,
      workspaceRoot: workspace.path,
      skills,
      mcps,
    });
    return jsonResponse(result);
  });

  addRoute(routes, "POST", "/workspace/:id/mcp", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const name = String(body.name ?? "");
    const configPayload = body.config as Record<string, unknown> | undefined;
    if (!configPayload) {
      throw new ApiError(400, "invalid_payload", "MCP config is required");
    }
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "mcp.add",
      summary: `Add MCP ${name}`,
      paths: [ipolloworkConfigPath(workspace.path)],
    });
    const result = await addMcp(config, workspace.id, name, configPayload);
    // Hot-add into the running engine so connect/auth works immediately,
    // without waiting for an engine instance rebuild.
    await syncRuntimeMcpToOpencodeEngine(config, workspace, [name]).catch(() => undefined);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "mcp.add",
      target: ipolloworkConfigPath(workspace.path),
      summary: `Added MCP ${name}`,
      timestamp: Date.now(),
    });
    emitReloadEvent(ctx.reloadEvents, workspace, "mcp", {
      type: "mcp",
      name,
      action: result.action,
    });
    const items = await listMcp(config, workspace.id, workspace.path);
    return jsonResponse({ items });
  });

  addRoute(routes, "DELETE", "/workspace/:id/mcp/:name", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const name = ctx.params.name ?? "";
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "mcp.remove",
      summary: `Remove MCP ${name}`,
      paths: [ipolloworkConfigPath(workspace.path)],
    });
    const removed = await removeMcp(config, workspace.id, name);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "mcp.remove",
      target: ipolloworkConfigPath(workspace.path),
      summary: `Removed MCP ${name}`,
      timestamp: Date.now(),
    });
    if (removed) {
      await disconnectMcpFromOpencodeEngine(config, workspace, name).catch(() => undefined);
      emitReloadEvent(ctx.reloadEvents, workspace, "mcp", {
        type: "mcp",
        name,
        action: "removed",
      });
    }
    const items = await listMcp(config, workspace.id, workspace.path);
    return jsonResponse({ items });
  });

  // Toggle `enabled` on a workspace MCP. Strict body validation — `Boolean(body.enabled)`
  // would silently disable on `{}` or coerce `"false"` to true.
  addRoute(routes, "POST", "/workspace/:id/mcp/:name/enabled", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const name = ctx.params.name ?? "";
    const body = await readJsonBody(ctx.request);
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.enabled !== "boolean") {
      throw new ApiError(400, "invalid_payload", "enabled must be a boolean");
    }
    const enabled = body.enabled;
    const action = enabled ? "mcp.enable" : "mcp.disable";
    const summary = `${enabled ? "Enable" : "Disable"} MCP ${name}`;
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action,
      summary,
      paths: [ipolloworkConfigPath(workspace.path)],
    });
    const updated = await setMcpEnabled(config, workspace.id, name, enabled);
    if (!updated) {
      throw new ApiError(404, "mcp_not_found", `MCP ${name} not found in workspace config`);
    }
    await syncRuntimeMcpToOpencodeEngine(config, workspace, [name]).catch(() => undefined);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action,
      target: ipolloworkConfigPath(workspace.path),
      summary: `${enabled ? "Enabled" : "Disabled"} MCP ${name}`,
      timestamp: Date.now(),
    });
    // ReloadTrigger.action only allows added/removed/updated, so toggle => "updated".
    emitReloadEvent(ctx.reloadEvents, workspace, "mcp", {
      type: "mcp",
      name,
      action: "updated",
    });
    const items = await listMcp(config, workspace.id, workspace.path);
    return jsonResponse({ items });
  });

  addRoute(routes, "DELETE", "/workspace/:id/mcp/:name/auth", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const name = String(ctx.params.name ?? "").trim();
    validateMcpName(name);

    const authStorePath = join(runtimeStorageDir(config), "authorization.vault");
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "mcp.auth.remove",
      summary: `Logout MCP ${name}`,
      paths: [authStorePath],
    });

    await revokeMcpAuthorization(config, workspace.id, name);
    await disconnectMcpFromOpencodeEngine(config, workspace, name).catch(() => undefined);

    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "mcp.auth.remove",
      target: authStorePath,
      summary: `Logged out MCP ${name}`,
      timestamp: Date.now(),
    });

    return jsonResponse({ ok: true });
  });

  addRoute(routes, "POST", "/workspace/:id/mcp/:name/auth/start", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const name = String(ctx.params.name ?? "").trim();
    validateMcpName(name);
    const entry = (await listMcp(config, workspace.id, workspace.path)).find((item) => item.name === name);
    if (!entry || entry.config.type !== "remote") throw new ApiError(404, "mcp_not_found", `Remote MCP ${name} was not found`);
    const callbackUrl = new URL("/mcp/oauth/callback", ctx.request.url).toString();
    const result = await startMcpAuthorization({ config, workspaceId: workspace.id, name, source: entry.config, callbackUrl });
    await syncRuntimeMcpToOpencodeEngine(config, workspace, [name]).catch(() => undefined);
    return jsonResponse(result);
  });

  addRoute(routes, "GET", "/workspace/:id/mcp/:name/auth", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const name = String(ctx.params.name ?? "").trim();
    validateMcpName(name);
    return jsonResponse(await mcpAuthorizationStatus(config, workspace.id, name));
  });

  addRoute(routes, "GET", "/mcp/oauth/callback", "none", async (ctx) => {
    await completeMcpAuthorization(config, ctx.url);
    return new Response("<!doctype html><meta charset=\"utf-8\"><title>iPolloWork</title><body style=\"font:16px system-ui;padding:48px\">MCP connected. You can close this window.</body>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });

  for (const method of ["GET", "POST", "DELETE"] as const) {
    addRoute(routes, method, "/mcp-proxy/:workspaceId/:name", "none", async (ctx) =>
      proxyMcpRequest(config, ctx.params.workspaceId, ctx.params.name, ctx.request)
    );
  }

  addRoute(routes, "GET", "/workspace/:id/commands", "client", async (ctx) => {
    const scope = ctx.url.searchParams.get("scope") === "global" ? "global" : "workspace";
    if (scope === "global") {
      await requireHost(ctx.request, config, tokens);
    }
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const items = await listCommands(workspace.path, scope);
    return jsonResponse({ items });
  });

  addRoute(routes, "POST", "/workspace/:id/commands", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const name = String(body.name ?? "");
    const template = String(body.template ?? "");
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "commands.upsert",
      summary: `Upsert command ${name}`,
      paths: [join(workspace.path, ".opencode", "commands", `${sanitizeCommandName(name)}.md`)],
    });
    const path = await upsertCommand(workspace.path, {
      name,
      description: body.description ? String(body.description) : undefined,
      template,
      agent: body.agent ? String(body.agent) : undefined,
      model: body.model ? String(body.model) : undefined,
      subtask: typeof body.subtask === "boolean" ? body.subtask : undefined,
    });
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "commands.upsert",
      target: path,
      summary: `Upserted command ${name}`,
      timestamp: Date.now(),
    });

    emitReloadEvent(ctx.reloadEvents, workspace, "commands", {
      type: "command",
      name: sanitizeCommandName(name),
      action: "updated",
      path,
    });
    const items = await listCommands(workspace.path, "workspace");
    return jsonResponse({ items });
  });

  addRoute(routes, "DELETE", "/workspace/:id/commands/:name", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const name = ctx.params.name ?? "";
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "commands.delete",
      summary: `Delete command ${name}`,
      paths: [join(workspace.path, ".opencode", "commands", `${sanitizeCommandName(name)}.md`)],
    });
    await deleteCommand(workspace.path, name);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "commands.delete",
      target: join(workspace.path, ".opencode", "commands"),
      summary: `Deleted command ${name}`,
      timestamp: Date.now(),
    });

    emitReloadEvent(ctx.reloadEvents, workspace, "commands", {
      type: "command",
      name: sanitizeCommandName(name),
      action: "removed",
      path: join(workspace.path, ".opencode", "commands", `${sanitizeCommandName(name)}.md`),
    });
    return jsonResponse({ ok: true });
  });

  addRoute(routes, "GET", "/workspace/:id/export", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sensitiveMode = parseWorkspaceExportSensitiveMode(ctx.url.searchParams.get("sensitive"));
    const exportPayload = await exportWorkspace(config, workspace, { sensitiveMode });
    return jsonResponse(exportPayload);
  });

  addRoute(routes, "POST", "/workspace/:id/import/preview", "client", async (ctx) => {
    requireClientScope(ctx, "viewer");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const preview = await buildWorkspaceImportPreview(workspace.path, body);
    return jsonResponse(publicWorkspaceImportPreview(preview));
  });

  addRoute(routes, "POST", "/workspace/:id/import", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const expectedFingerprint = parseWorkspaceImportPreviewFingerprint(body);
    const preview = await buildWorkspaceImportPreview(workspace.path, body);
    if (expectedFingerprint && expectedFingerprint !== preview.fingerprint) {
      return jsonResponse(
        {
          ok: false,
          code: "workspace_import_preview_stale",
          message: "Workspace changed after this import was previewed. Review the latest preview before importing.",
          preview: publicWorkspaceImportPreview(preview),
        },
        409,
      );
    }
    const approvalPaths = workspaceImportPreviewApprovalPaths(preview);
    if (approvalPaths.length === 0) {
      return jsonResponse({ ok: true, preview: publicWorkspaceImportPreview(preview) });
    }
    if (!expectedFingerprint) {
      return jsonResponse(
        {
          ok: false,
          code: "workspace_import_preview_required",
          message: "Review this import preview before applying workspace changes.",
          preview: publicWorkspaceImportPreview(preview),
        },
        409,
      );
    }
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "config.import",
      summary: summarizeWorkspaceImportPreview(preview),
      paths: approvalPaths,
    });
    const latestPreview = await buildWorkspaceImportPreview(workspace.path, body);
    if (latestPreview.fingerprint !== expectedFingerprint) {
      return jsonResponse(
        {
          ok: false,
          code: "workspace_import_preview_stale",
          message: "Workspace changed after this import was previewed. Review the latest preview before importing.",
          preview: publicWorkspaceImportPreview(latestPreview),
        },
        409,
      );
    }
    const configFingerprintBefore = await computeReloadFingerprint(workspace.path, "config");
    await importWorkspace(config, workspace, body, latestPreview);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "config.import",
      target: "workspace",
      summary: summarizeWorkspaceImportApplied(latestPreview),
      timestamp: Date.now(),
    });
    if (configFingerprintBefore !== await computeReloadFingerprint(workspace.path, "config")) {
      emitReloadEvent(ctx.reloadEvents, workspace, "config", buildConfigTrigger(opencodeConfigPath(workspace.path)));
    }
    return jsonResponse({ ok: true, preview: publicWorkspaceImportPreview(latestPreview) });
  });

  addRoute(routes, "POST", "/workspace/:id/blueprint/sessions/materialize", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const result = await materializeBlueprintSessions(config, workspace);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "blueprint.sessions.materialize",
      target: "workspace",
      summary: result.created.length
        ? `Materialized ${result.created.length} template starter session${result.created.length === 1 ? "" : "s"}`
        : "Checked template starter sessions",
      timestamp: Date.now(),
    });
    return jsonResponse(result);
  });

  return routes;
}

function resolveLocalPluginPackageRoot(workspaceRoot: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, "invalid_payload", "packageRoot is required");
  const root = resolve(workspaceRoot);
  const target = resolve(root, value.trim());
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new ApiError(403, "plugin_package_root_unauthorized", "Local plugin packages must be inside the selected workspace");
  }
  return target;
}

async function resolveWorkspace(config: ServerConfig, id: string): Promise<WorkspaceInfo> {
  const workspaceId = id.trim();
  const aliasWorkspaceId = workspaceId.startsWith("rem_") ? workspaceId.slice("rem_".length) : "";
  const workspace =
    config.workspaces.find((entry) => entry.id === workspaceId) ??
    (aliasWorkspaceId ? config.workspaces.find((entry) => entry.id === aliasWorkspaceId) : undefined);
  if (!workspace) {
    throw new ApiError(404, "workspace_not_found", "Workspace not found");
  }
  const resolvedWorkspace = resolve(workspace.path);
  const authorized = await isAuthorizedRoot(resolvedWorkspace, config.authorizedRoots);
  if (!authorized) {
    throw new ApiError(403, "workspace_unauthorized", "Workspace is not authorized");
  }
  if (!config.readOnly) {
    const ensured = await ensureWorkspaceFiles(resolvedWorkspace, workspace.preset ?? "starter");
    const bootstrapReloadReasons = new Set<ReloadReason>(ensured.reloadReasons);
    if (await repairCommands(resolvedWorkspace)) {
      bootstrapReloadReasons.add("commands");
    }
    if (bootstrapReloadReasons.size > 0) {
      await reloadBaselineRefreshers.get(config)?.(workspace.id, Array.from(bootstrapReloadReasons));
      reloadOpencodeEngineAfterInternalBootstrap(config, { ...workspace, path: resolvedWorkspace });
    }
  }
  return { ...workspace, path: resolvedWorkspace };
}

function reloadOpencodeEngineAfterInternalBootstrap(config: ServerConfig, workspace: WorkspaceInfo): void {
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  if (!connection.baseUrl?.trim()) return;
  void reloadOpencodeEngine(config, workspace).catch(() => undefined);
}

async function isAuthorizedRoot(workspacePath: string, roots: string[]): Promise<boolean> {
  const resolvedWorkspace = resolve(workspacePath);
  for (const root of roots) {
    const resolvedRoot = resolve(root);
    if (resolvedWorkspace === resolvedRoot) return true;
    if (resolvedWorkspace.startsWith(resolvedRoot + sep)) return true;
  }
  return false;
}

function ensureWritable(config: ServerConfig): void {
  if (config.readOnly) {
    throw new ApiError(403, "read_only", "Server is read-only");
  }
}

function runtimeDbPathForServer(config: ServerConfig): string {
  const override = process.env.IPOLLOWORK_RUNTIME_DB?.trim();
  if (override) return resolve(override);
  const configDir = config.configPath?.trim() ? dirname(config.configPath) : join(homedir(), ".config", "ipollowork");
  return join(configDir, "runtime.sqlite");
}

function scopeRank(scope: TokenScope): number {
  if (scope === "viewer") return 1;
  if (scope === "collaborator") return 2;
  return 3;
}

function requireClientScope(ctx: RequestContext, required: TokenScope): void {
  const scope = ctx.actor?.scope;
  if (!scope) {
    throw new ApiError(401, "unauthorized", "Missing token scope");
  }
  if (scopeRank(scope) < scopeRank(required)) {
    throw new ApiError(403, "forbidden", "Insufficient token scope", { required, scope });
  }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const json = await request.json();
    return json as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_json", "Invalid JSON body");
  }
}

async function readPluginPackageUploadBody(request: Request): Promise<unknown> {
  const bytes = await readLimitedRequestBody(request, 15 * 1024 * 1024, {
    code: "plugin_package_upload_too_large",
    message: "Plugin package upload exceeds 15 MB",
  });
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value;
  } catch {
    throw new ApiError(400, "invalid_json", "Invalid plugin package upload");
  }
}

async function readOptionalJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return ensurePlainObject(JSON.parse(text));
  } catch {
    throw new ApiError(400, "invalid_json", "Invalid JSON body");
  }
}

function parseOptionalPositiveInteger(value: string | null, name: string): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError(400, "invalid_query", `${name} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalNonNegativeInteger(value: string | null, name: string): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ApiError(400, "invalid_query", `${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseOptionalBoolean(value: string | null, name: string): boolean | undefined {
  if (value === null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new ApiError(400, "invalid_query", `${name} must be a boolean`);
}

function ensurePlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeOpencodeScope(value: string | null | undefined): "project" | "global" {
  return value?.trim().toLowerCase() === "global" ? "global" : "project";
}

function resolveOpencodeConfigFilePath(scope: "project" | "global", workspaceRoot: string): string {
  if (scope === "global") {
    const base = join(homedir(), ".config", "opencode");
    const jsoncPath = join(base, "opencode.jsonc");
    const jsonPath = join(base, "opencode.json");
    if (existsSync(jsoncPath)) return jsoncPath;
    if (existsSync(jsonPath)) return jsonPath;
    return jsoncPath;
  }
  return opencodeConfigPath(workspaceRoot);
}

function getRuntimeControlConfig(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.IPOLLOWORK_CONTROL_BASE_URL?.trim() ?? "";
  const token = process.env.IPOLLOWORK_CONTROL_TOKEN?.trim() ?? "";
  if (!baseUrl || !token) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

async function fetchRuntimeControl(path: string, init?: { method?: string; body?: unknown }) {
  const control = getRuntimeControlConfig();
  if (!control) {
    throw new ApiError(501, "runtime_upgrade_unavailable", "Worker runtime control is not configured on this host");
  }
  const response = await fetch(`${control.baseUrl}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${control.token}`,
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(response.status, "runtime_upgrade_failed", "Worker runtime control request failed", json);
  }
  return json;
}

async function readOpencodeConfig(workspaceRoot: string): Promise<Record<string, unknown>> {
  const { data } = await readJsoncFile(opencodeConfigPath(workspaceRoot), {} as Record<string, unknown>, { allowInvalid: true });
  return data;
}

/**
 * Resolve the per-workspace iPolloWork config from the runtime DB. New local
 * workspaces receive the canonical default document on first access.
 */
async function readiPolloWorkConfigForWorkspace(
  config: ServerConfig,
  workspace: WorkspaceInfo,
): Promise<Record<string, unknown>> {
  const stored = await readiPolloWorkWorkspaceConfig(config, workspace.id);
  if (Object.keys(stored).length > 0 || (await hasiPolloWorkWorkspaceConfig(config, workspace.id))) {
    return stored;
  }
  if (workspace.workspaceType !== "remote" && workspace.path.trim()) {
    return seediPolloWorkWorkspaceConfigIfEmpty(
      config,
      workspace.id,
      defaultWorkspaceiPolloWorkConfig(workspace.path, workspace.preset ?? "starter"),
    );
  }
  return {};
}

/**
 * Persist a full ipollowork config document for a workspace to the runtime DB.
 * Replaces the legacy file write path; the file is no longer written.
 */
async function writeiPolloWorkConfigForWorkspace(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  payload: Record<string, unknown>,
  merge: boolean,
): Promise<void> {
  await writeiPolloWorkWorkspaceConfig(config, workspace.id, (current) =>
    merge ? { ...current, ...payload } : payload,
  );
}

function resolveOpencodeDirectory(workspace: WorkspaceInfo): string | null {
  const explicit = workspace.directory?.trim() ?? "";
  if (explicit) return normalizeOpencodeDirectory(explicit);
  if (workspace.workspaceType === "local") return normalizeOpencodeDirectory(workspace.path);
  return null;
}

function normalizeOpencodeDirectory(directory: string): string {
  // OpenCode stores/list-filters Windows sessions by regular drive paths
  // (`C:\Users\...`). Electron can persist local workspaces as extended-length
  // paths (`\\?\C:\Users\...`); passing those through as the directory query
  // makes OpenCode return an empty session list even though the sessions exist.
  if (process.platform === "win32") {
    return directory.replace(/^\\\\\?\\/, "").replace(/^\/\/\?\//, "");
  }
  return directory;
}

function buildOpencodeReloadUrl(baseUrl: string, directory?: string | null): string {
  try {
    const url = new URL(baseUrl);
    url.pathname = "/instance/dispose";
    url.search = "";
    if (directory) {
      url.searchParams.set("directory", directory);
    }
    return url.toString();
  } catch {
    throw new ApiError(400, "opencode_url_invalid", "OpenCode base URL is invalid");
  }
}

function parseOpencodeErrorBody(input: string): unknown {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

async function reloadOpencodeEngine(config: ServerConfig, workspace: WorkspaceInfo): Promise<void> {
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  const baseUrl = connection.baseUrl?.trim() ?? "";
  if (!baseUrl) {
    throw new ApiError(400, "opencode_unconfigured", "OpenCode base URL is missing for this workspace");
  }

  const directory = resolveOpencodeDirectory(workspace);
  const targetUrl = buildOpencodeReloadUrl(baseUrl, directory);
  const headers: Record<string, string> = {};
  const auth = connection.authHeader ?? null;
  if (auth) headers.Authorization = auth;

  let response: Response;
  try {
    response = await fetch(targetUrl, { method: "POST", headers });
  } catch (error) {
    throw new ApiError(
      503,
      "opencode_engine_unreachable",
      "OpenCode engine is not reachable; a full engine restart is required",
      { baseUrl, cause: error instanceof Error ? error.message : String(error) },
    );
  }
  if (!response.ok) {
    const body = parseOpencodeErrorBody(await response.text());
    throw new ApiError(502, "opencode_reload_failed", "OpenCode reload failed", {
      status: response.status,
      body,
    });
  }

  // Re-register runtime-DB MCPs: dispose rebuilds engine state from disk
  // configs (including the server-managed runtime config file for the
  // primary workspace), but other workspaces' runtime MCPs only reach the
  // engine through this dynamic push.
  await syncRuntimeMcpToOpencodeEngine(config, workspace).catch(() => undefined);
}

// Push runtime-DB MCP entries into the running OpenCode engine via its dynamic
// add endpoint, so adds/toggles take effect without waiting for an engine
// instance rebuild. Best-effort: callers treat engine sync as advisory and
// swallow failures; outcomes are recorded per workspace (engineMcpSyncState)
// and logged so failures aren't silent.
async function syncRuntimeMcpToOpencodeEngine(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  onlyNames?: string[],
): Promise<void> {
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  const baseUrl = connection.baseUrl?.trim() ?? "";
  if (!baseUrl) return;

  const entries = Object.entries(await readRuntimeMcpConfig(config, workspace.id)).filter(
    ([name, mcpConfig]) =>
      (!onlyNames || onlyNames.includes(name)) &&
      (Boolean(onlyNames) || mcpConfig.enabled !== false),
  );
  if (entries.length === 0) return;

  const url = new URL(baseUrl);
  url.pathname = "/mcp";
  url.search = "";
  const directory = resolveOpencodeDirectory(workspace);
  if (directory) url.searchParams.set("directory", directory);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (connection.authHeader) headers.Authorization = connection.authHeader;

  // Keep going past per-entry failures: one dead or invalid MCP must not
  // block re-registration of every entry after it (e.g. ipollowork-ui) on
  // each engine reload.
  const failures: EngineMcpSyncFailure[] = [];
  for (const [name, mcpConfig] of entries) {
    const failure = await postMcpEntryWithRetry(url, headers, name, mcpConfig);
    if (failure) failures.push(failure);
  }

  recordEngineMcpSyncResult(workspace.id, {
    syncedNames: entries.map(([name]) => name),
    failures,
    // A full sync covered every runtime entry, so its result replaces any
    // previously recorded failures (e.g. for since-removed MCPs).
    replace: !onlyNames,
  });

  if (failures.length > 0) {
    const names = failures.map((failure) => failure.name).join(", ");
    const details = failures.map(formatEngineMcpSyncFailure).join(", ");
    createServerLogger(config).log("warn", `Engine MCP sync failed for workspace ${workspace.id}: ${details}`, {
      "workspace.id": workspace.id,
      "mcp.failed": names,
    });
    throw new ApiError(502, "opencode_mcp_sync_failed", `Failed to register MCPs with the engine: ${names}`, {
      failures,
    });
  }
}

function formatEngineMcpSyncFailure(failure: EngineMcpSyncFailure): string {
  if (failure.status !== undefined) {
    return `${failure.name} (HTTP ${failure.status}: ${engineMcpFailureMessage(failure.body)})`;
  }
  return `${failure.name} (${failure.message ?? "request failed"})`;
}

function engineMcpFailureMessage(body: unknown): string {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (isRecord(body)) {
    const code = typeof body.code === "string" ? body.code : null;
    const message = typeof body.message === "string" ? body.message : null;
    if (code && message) return `${code}: ${message}`;
    if (message) return message;
    if (code) return code;
  }
  return "request rejected";
}

// POST one MCP entry to the engine, retrying once on 5xx/network errors
// (the engine is often mid-rebuild right after a dispose). 4xx responses
// are not retried — they won't change.
async function postMcpEntryWithRetry(
  url: URL,
  headers: Record<string, string>,
  name: string,
  mcpConfig: Record<string, unknown>,
): Promise<EngineMcpSyncFailure | null> {
  let failure: EngineMcpSyncFailure | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, engineMcpSyncRetryDelayMs()));
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ name, config: mcpConfig }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return null;
      failure = { name, status: response.status, body: parseOpencodeErrorBody(await response.text()) };
      if (response.status < 500) return failure;
    } catch (error) {
      failure = { name, message: error instanceof Error ? error.message : String(error) };
    }
  }
  return failure;
}

// Read lazily so tests can shrink the delay at runtime.
function engineMcpSyncRetryDelayMs(): number {
  const parsed = Number(process.env.IPOLLOWORK_MCP_SYNC_RETRY_DELAY_MS ?? "750");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 750;
}

export type EngineMcpSyncFailure = { name: string; status?: number; body?: unknown; message?: string };
export type EngineMcpSyncState = { status: "ok" | "failed"; at: number; failures: EngineMcpSyncFailure[] };

// Last engine sync outcome per workspace, surfaced on GET /workspace/:id/mcp
// so the UI can explain why an enabled MCP shows as disconnected instead of
// failing silently.
const engineMcpSyncStateByWorkspace = new Map<string, EngineMcpSyncState>();

function recordEngineMcpSyncResult(
  workspaceId: string,
  result: { syncedNames: string[]; failures: EngineMcpSyncFailure[]; replace: boolean },
): void {
  const previous = engineMcpSyncStateByWorkspace.get(workspaceId);
  // Partial syncs (onlyNames) shouldn't clear recorded failures for entries
  // they didn't touch; merge by name instead.
  const remaining = result.replace
    ? []
    : (previous?.failures ?? []).filter((failure) => !result.syncedNames.includes(failure.name));
  const merged = [...remaining, ...result.failures];
  engineMcpSyncStateByWorkspace.set(workspaceId, {
    status: merged.length > 0 ? "failed" : "ok",
    at: Date.now(),
    failures: merged,
  });
}

export function engineMcpSyncState(workspaceId: string): EngineMcpSyncState | null {
  return engineMcpSyncStateByWorkspace.get(workspaceId) ?? null;
}

// Re-push every workspace's runtime-DB MCPs into the engine. Used at startup:
// the runtime config file injected via OPENCODE_CONFIG covers workspaces[0]
// only, so other workspaces' runtime MCPs are invisible to the engine until
// something re-syncs them. Best-effort.
export async function syncAllWorkspacesRuntimeMcpToEngine(config: ServerConfig): Promise<void> {
  for (const workspace of config.workspaces) {
    if ((workspace.engineId?.trim() || DEFAULT_ENGINE_ID) !== DEFAULT_ENGINE_ID) continue;
    await syncRuntimeMcpToOpencodeEngine(config, workspace).catch(() => undefined);
  }
}

// Counterpart of syncRuntimeMcpToOpencodeEngine for removals: tell the engine
// to drop the MCP's client so deleted MCPs stop serving tools immediately
// instead of lingering until the next engine restart. Best-effort.
async function disconnectMcpFromOpencodeEngine(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  name: string,
): Promise<void> {
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  const baseUrl = connection.baseUrl?.trim() ?? "";
  if (!baseUrl) return;

  const url = new URL(baseUrl);
  url.pathname = `/mcp/${encodeURIComponent(name)}/disconnect`;
  url.search = "";
  const directory = resolveOpencodeDirectory(workspace);
  if (directory) url.searchParams.set("directory", directory);
  const headers: Record<string, string> = {};
  if (connection.authHeader) headers.Authorization = connection.authHeader;

  const response = await fetch(url, { method: "POST", headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const body = parseOpencodeErrorBody(await response.text());
    throw new ApiError(502, "opencode_mcp_disconnect_failed", `Failed to disconnect MCP ${name} from the engine`, {
      status: response.status,
      body,
    });
  }
}

async function requireApproval(
  ctx: RequestContext,
  input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">,
): Promise<void> {
  const actor = ctx.actor ?? { type: "remote" };
  const result = await ctx.approvals.requestApproval({ ...input, actor });
  if (!result.allowed) {
    throw new ApiError(403, "write_denied", "Write request denied", {
      requestId: result.id,
      reason: result.reason,
    });
  }
}

async function exportWorkspace(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  options?: { sensitiveMode?: WorkspaceExportSensitiveMode },
) {
  const sensitiveMode = options?.sensitiveMode ?? "auto";
  const rawOpencode = await readOpencodeConfig(workspace.path);
  let opencode = sanitizePortableOpencodeConfig(rawOpencode);
  const ipollowork = sanitizeiPolloWorkTemplateConfig(await readiPolloWorkConfigForWorkspace(config, workspace));
  const skills = await listSkills(workspace.path, false);
  const commands = await listCommands(workspace.path, "workspace");
  let files = await listPortableFiles(workspace.path);
  const warnings = collectWorkspaceExportWarnings({ opencode: rawOpencode, files });
  if (warnings.length && sensitiveMode === "auto") {
    throw new ApiError(
      409,
      "workspace_export_requires_decision",
      "This workspace includes sensitive config. Choose whether to exclude it or include it before exporting.",
      { warnings },
    );
  }
  if (sensitiveMode === "exclude") {
    const sanitized = stripSensitiveWorkspaceExportData({ opencode, files });
    opencode = sanitized.opencode;
    files = sanitized.files;
  }
  const skillContents = await Promise.all(
    skills.map(async (skill) => ({
      name: skill.name,
      description: skill.description,
      content: await readFile(skill.path, "utf8"),
    })),
  );
  const commandContents = await Promise.all(
    commands.map(async (command) => ({
      name: command.name,
      description: command.description,
      template: command.template,
    })),
  );

  return {
    workspaceId: workspace.id,
    exportedAt: Date.now(),
    opencode,
    ipollowork,
    skills: skillContents,
    commands: commandContents,
    ...(files.length ? { files } : {}),
  };
}

function parseWorkspaceExportSensitiveMode(input: string | null): WorkspaceExportSensitiveMode {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "auto";
  if (trimmed === "auto" || trimmed === "include" || trimmed === "exclude") {
    return trimmed;
  }
  throw new ApiError(400, "invalid_workspace_export_sensitive_mode", `Invalid workspace export sensitive mode: ${trimmed}`);
}

function parseWorkspaceImportPreviewFingerprint(payload: Record<string, unknown>): string | null {
  const value = payload.previewFingerprint;
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ApiError(
      400,
      "invalid_workspace_import_preview_fingerprint",
      "Workspace import preview fingerprint must be a string",
    );
  }
  return value;
}

function workspaceImportRelativePath(workspace: WorkspaceInfo, path: string): string {
  return relative(workspace.path, path).replaceAll("\\", "/");
}

async function importWorkspace(config: ServerConfig, workspace: WorkspaceInfo, payload: Record<string, unknown>, preview: WorkspaceImportPlan): Promise<void> {
  const input = normalizeWorkspaceImportPayload(workspace.path, payload);
  const changed = new Set(
    preview.changes
      .filter((change) => change.action !== "unchanged")
      .map((change) => `${change.kind}:${change.path}`),
  );
  const changedPath = (kind: string, path: string) => changed.has(`${kind}:${path}`);

  if (
    input.opencode !== undefined &&
    changedPath("opencode", workspaceImportRelativePath(workspace, opencodeConfigPath(workspace.path)))
  ) {
    if (input.modes.opencode === "replace") {
      await writeJsoncFile(opencodeConfigPath(workspace.path), input.opencode);
    } else {
      await updateJsoncTopLevel(opencodeConfigPath(workspace.path), input.opencode);
    }
  }

  if (
    input.ipollowork !== undefined &&
    changedPath("ipollowork", workspaceImportRelativePath(workspace, ipolloworkConfigPath(workspace.path)))
  ) {
    if (input.modes.ipollowork === "replace") {
      await writeiPolloWorkConfigForWorkspace(config, workspace, input.ipollowork, false);
    } else {
      await writeiPolloWorkConfigForWorkspace(config, workspace, input.ipollowork, true);
    }
  }

  if (input.sections.skills) {
    for (const skill of input.skills) {
      const path = workspaceImportRelativePath(workspace, join(projectSkillsDir(workspace.path), skill.name, "SKILL.md"));
      if (!changedPath("skill", path)) continue;
      await upsertSkill(workspace.path, skill);
    }
    if (input.modes.skills === "replace") {
      for (const change of preview.changes) {
        if (change.kind === "skill" && change.action === "delete") {
          await rm(change.absolutePath, { recursive: true, force: true });
        }
      }
    }
  }

  if (input.sections.commands) {
    for (const command of input.commands) {
      const path = workspaceImportRelativePath(workspace, join(projectCommandsDir(workspace.path), `${command.name}.md`));
      if (!changedPath("command", path)) continue;
      await upsertCommand(workspace.path, command);
    }
    if (input.modes.commands === "replace") {
      for (const change of preview.changes) {
        if (change.kind === "command" && change.action === "delete") {
          await rm(change.absolutePath, { force: true });
        }
      }
    }
  }

  if (input.sections.files) {
    for (const file of input.files) {
      if (!changedPath("file", file.path)) continue;
      const path = join(workspace.path, file.path);
      await ensureDir(dirname(path));
      await writeFile(path, file.content, "utf8");
    }
    if (input.modes.files === "replace") {
      for (const change of preview.changes) {
        if (change.kind === "file" && change.action === "delete") {
          await rm(change.absolutePath, { force: true });
        }
      }
    }
  }
}

async function materializeBlueprintSessions(config: ServerConfig, workspace: WorkspaceInfo): Promise<{
  ok: boolean;
  created: Array<{ templateId: string; sessionId: string; title: string }>;
  existing: Array<{ templateId: string; sessionId: string }>;
  openSessionId: string | null;
}> {
  const ipollowork = await readiPolloWorkConfigForWorkspace(config, workspace);
  const templates = normalizeBlueprintSessionTemplates(ipollowork);
  if (!templates.length) {
    return { ok: true, created: [], existing: [], openSessionId: null };
  }

  const existing = readMaterializedBlueprintSessions(ipollowork);
  if (existing.length > 0) {
    const preferredTemplate = templates.find((template) => template.openOnFirstLoad) ?? templates[0] ?? null;
    const openSessionId = preferredTemplate
      ? existing.find((item) => item.templateId === preferredTemplate.id)?.sessionId ?? existing[0]?.sessionId ?? null
      : existing[0]?.sessionId ?? null;
    return { ok: true, created: [], existing, openSessionId };
  }

  const created: Array<{ templateId: string; sessionId: string; title: string }> = [];
  const opencode = createWorkspaceOpencodeClient(config, workspace);
  for (const template of templates) {
    const result = unwrapOpencodeResult(await opencode.session.create({ title: template.title }), "/session");
    const sessionId =
      result && typeof result === "object" && "id" in result && typeof result.id === "string" ? result.id.trim() : "";
    if (!sessionId) {
      throw new ApiError(502, "opencode_failed", "OpenCode session did not return an id");
    }
    seedOpencodeSessionMessages({
      sessionId,
      workspaceRoot: resolveOpencodeDirectory(workspace) ?? workspace.path,
      messages: template.messages,
    });
    created.push({ templateId: template.id, sessionId, title: template.title });
  }

  const now = Date.now();
  const nextiPolloWork = applyMaterializedBlueprintSessions(
    ipollowork,
    created.map(({ templateId, sessionId }) => ({ templateId, sessionId })),
    now,
  );
  await writeiPolloWorkConfigForWorkspace(config, workspace, nextiPolloWork, false);

  const preferredTemplate = templates.find((template) => template.openOnFirstLoad) ?? templates[0] ?? null;
  const openSessionId = preferredTemplate
    ? created.find((item) => item.templateId === preferredTemplate.id)?.sessionId ?? created[0]?.sessionId ?? null
    : created[0]?.sessionId ?? null;

  return { ok: true, created, existing: [], openSessionId };
}
