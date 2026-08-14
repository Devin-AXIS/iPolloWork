import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

import { runHarnessHeadless } from "./dsh-headless.ts";
import { runHarnessTurn, type HarnessTurnResult } from "./dsh-jsonrpc.ts";
import {
  assertProviderReady,
  bundledCordisConfigPath,
  childEnvironment,
  executable,
  promptForMode,
  readEnvironmentValues,
  resolveRuntimeLocation,
  sandboxProfile,
  type EnvironmentRuntime,
  type JobMode,
  type RuntimeEnvironmentValues,
  type RuntimeLocation,
} from "./dsh-runtime.ts";
import { collectWorkspacePatch, prepareIsolatedWorkspace } from "./isolated-git-workspace.ts";
import {
  installManagedRuntime,
  latestOfficialRuntimeVersion,
  managedRuntimeStatus,
  RECOMMENDED_DSH_RUNTIME_VERSION,
  removeManagedRuntimes,
} from "./runtime-manager.ts";

type AuthorizationRuntime = {
  getCredential(methodId: string, accountId?: string): Promise<Readonly<Record<string, string>> | null>;
};

type ServiceRuntime = {
  plugin: Readonly<{ id: string; version: string }>;
  authorization: AuthorizationRuntime;
  environment: EnvironmentRuntime;
  storage: Readonly<{ dataDir: string }>;
  workspace: Readonly<{ root: string }>;
};

type JobState = "running" | "completed" | "failed" | "cancelled";

type JobResult = {
  finalResponse: string;
  patch: string;
  notificationCount: number;
  subagentCount: number;
};

type StoredJob = {
  jobId: string;
  state: Exclude<JobState, "running">;
  mode: JobMode;
  provider: string;
  model: string;
  sourceDirectory: string;
  startedAt: number;
  finishedAt: number;
  result?: JobResult;
  error?: string;
};

type ActiveJob = {
  jobId: string;
  state: JobState;
  mode: JobMode;
  provider: string;
  model: string;
  sourceDirectory: string;
  prompt: string;
  startedAt: number;
  finishedAt?: number;
  result?: JobResult;
  error?: string;
  abort: AbortController;
  task?: Promise<void>;
};

const MAX_PATCH_CHUNK = 500_000;
const MIN_MODEL_OUTPUT_TOKENS = 1_024;
const BUNDLED_HEADLESS_PLATFORM = process.platform === "win32" || process.platform === "darwin";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredText(args: Record<string, unknown>, key: string, maximum: number): string {
  const value = typeof args[key] === "string" ? args[key].trim() : "";
  if (!value) throw new Error(`${key} is required`);
  if (value.length > maximum) throw new Error(`${key} exceeds ${maximum} characters`);
  return value;
}

function optionalText(args: Record<string, unknown>, key: string, fallback: string, maximum: number): string {
  const value = typeof args[key] === "string" ? args[key].trim() : "";
  if (value.length > maximum) throw new Error(`${key} exceeds ${maximum} characters`);
  return value || fallback;
}

function modeValue(args: Record<string, unknown>): JobMode {
  const value = args.mode;
  if (value === undefined) return "standard";
  if (value === "standard" || value === "code" || value === "review") return value;
  throw new Error("mode must be standard, code, or review");
}

function optionalInteger(args: Record<string, unknown>, key: string, minimum: number, maximum: number): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function headlessPatch(
  provider: string,
  model: string,
  maxTokens: number | undefined,
  values: RuntimeEnvironmentValues,
  sessionsRoot: string,
): string {
  const entries: Record<string, unknown>[] = [
    { id: "agent-default-model", config: { provider, model } },
    { id: "session-persistence-jsonl", config: { root: sessionsRoot } },
  ];
  if (provider === "deepseek-official" && (maxTokens !== undefined || values.DEEPSEEK_BASE_URL)) {
    entries.push({
      id: "llm-deepseek",
      config: {
        apiKeyEnv: "DEEPSEEK_API_KEY",
        ...(values.DEEPSEEK_BASE_URL ? { baseURL: values.DEEPSEEK_BASE_URL } : {}),
        thinking: "enabled",
        reasoningEffort: "max",
        ...(maxTokens === undefined ? {} : { maxTokens }),
      },
    });
  }
  if (provider === "ipollowork") {
    entries.push({
      id: "llm-pi-ai",
      config: {
        providers: {
          ipollowork: {
            displayName: "iPolloWork",
            apiKeyEnv: "IPOLLOWORK_API_KEY",
            api: "openai-completions",
            baseURL: values.IPOLLOWORK_INFERENCE_BASE_URL,
            models: [{
              id: model,
              name: model,
              contextWindow: 128_000,
              ...(maxTokens === undefined ? {} : { maxTokens }),
            }],
          },
        },
      },
    });
  }
  return `${JSON.stringify(entries, null, 2)}\n`;
}


function publicJob(job: ActiveJob | StoredJob, args: Record<string, unknown>) {
  const base = {
    jobId: job.jobId,
    state: job.state,
    mode: job.mode,
    provider: job.provider,
    model: job.model,
    sourceDirectory: job.sourceDirectory,
    startedAt: job.startedAt,
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
  if (!job.result) return base;
  const includePatch = args.includePatch !== false;
  const offset = typeof args.patchOffset === "number" && Number.isInteger(args.patchOffset) && args.patchOffset >= 0 ? args.patchOffset : 0;
  const requestedLimit = typeof args.patchLimit === "number" && Number.isInteger(args.patchLimit) && args.patchLimit > 0 ? args.patchLimit : 200_000;
  const limit = Math.min(requestedLimit, MAX_PATCH_CHUNK);
  const patch = includePatch ? job.result.patch.slice(offset, offset + limit) : undefined;
  return {
    ...base,
    result: {
      finalResponse: job.result.finalResponse,
      notificationCount: job.result.notificationCount,
      subagentCount: job.result.subagentCount,
      patchLength: job.result.patch.length,
      ...(includePatch ? { patch, patchOffset: offset, patchHasMore: offset + (patch?.length ?? 0) < job.result.patch.length } : {}),
    },
  };
}

export default async function createDeepSeekHarnessService(runtime: ServiceRuntime) {
  const jobs = new Map<string, ActiveJob>();
  const jobsRoot = resolve(runtime.storage.dataDir, "jobs");
  let runtimeMutation = Promise.resolve();

  function serializeRuntimeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = runtimeMutation.then(operation, operation);
    runtimeMutation = result.then(() => undefined, () => undefined);
    return result;
  }

  function hasRunningJobs(): boolean {
    return [...jobs.values()].some((job) => job.state === "running");
  }

  async function environmentValues(): Promise<RuntimeEnvironmentValues> {
    const values = await readEnvironmentValues(runtime.environment);
    const credential = await runtime.authorization.getCredential("deepseek-api-key");
    const apiKey = credential?.apiKey?.trim();
    const baseUrl = credential?.baseUrl?.trim();
    return {
      ...values,
      DEEPSEEK_API_KEY: apiKey || values.DEEPSEEK_API_KEY,
      DEEPSEEK_BASE_URL: baseUrl || values.DEEPSEEK_BASE_URL,
    };
  }

  async function installRuntime(version: string) {
    return serializeRuntimeMutation(async () => {
      const installed = await installManagedRuntime(runtime.storage.dataDir, version);
      const status = await managedRuntimeStatus(runtime.storage.dataDir);
      return {
        installed: true,
        active: installed,
        installedVersions: status.installedVersions,
        recommendedVersion: status.recommendedVersion,
      };
    });
  }

  async function persist(job: ActiveJob): Promise<void> {
    if (job.state === "running" || job.finishedAt === undefined) return;
    const stored: StoredJob = {
      jobId: job.jobId,
      state: job.state,
      mode: job.mode,
      provider: job.provider,
      model: job.model,
      sourceDirectory: job.sourceDirectory,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      ...(job.result ? { result: job.result } : {}),
      ...(job.error ? { error: job.error } : {}),
    };
    const directory = resolve(jobsRoot, job.jobId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(resolve(directory, "result.json"), `${JSON.stringify(stored)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async function storedJob(jobId: string): Promise<StoredJob | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(resolve(jobsRoot, jobId, "result.json"), "utf8"));
      const value = record(parsed);
      return value?.jobId === jobId ? parsed as StoredJob : null;
    } catch {
      return null;
    }
  }

  async function execute(job: ActiveJob, location: RuntimeLocation, values: RuntimeEnvironmentValues, maxTokens?: number): Promise<void> {
    const requestedExecutionRoot = resolve(tmpdir(), "ipollowork-dsh", job.jobId);
    await mkdir(requestedExecutionRoot, { recursive: true, mode: 0o700 });
    const executionRoot = await realpath(requestedExecutionRoot);
    const workspaceRoot = resolve(executionRoot, "workspace");
    const stateRoot = resolve(executionRoot, "state");
    const sessionsRoot = resolve(stateRoot, "sessions");
    const homeRoot = resolve(stateRoot, "home");
    const dshHome = resolve(runtime.storage.dataDir, "dsh-home");
    try {
      await mkdir(homeRoot, { recursive: true, mode: 0o700 });
      await mkdir(resolve(homeRoot, "tmp"), { recursive: true, mode: 0o700 });
      await mkdir(resolve(homeRoot, "appdata"), { recursive: true, mode: 0o700 });
      await mkdir(resolve(homeRoot, "localappdata"), { recursive: true, mode: 0o700 });
      await mkdir(sessionsRoot, { recursive: true, mode: 0o700 });
      await mkdir(dshHome, { recursive: true, mode: 0o700 });
      const isolated = await prepareIsolatedWorkspace(job.sourceDirectory, workspaceRoot);
      const configPath = location.transport === "jsonrpc" && values.DSH_CORDIS_CONFIG
        ? resolve(values.DSH_CORDIS_CONFIG)
        : location.transport === "jsonrpc" ? bundledCordisConfigPath() : undefined;
      const env = childEnvironment(process.env, values, {
        cwd: isolated.cwd,
        home: homeRoot,
        dshHome,
        sessions: sessionsRoot,
        config: configPath,
        mode: job.mode,
        provider: job.provider,
        model: job.model,
      });
      const prompt = promptForMode(job.prompt, job.mode);
      let turn: HarnessTurnResult;
      if (location.transport === "headless") {
        const patchPath = resolve(stateRoot, "ipollowork.patch.yml");
        await writeFile(patchPath, headlessPatch(job.provider, job.model, maxTokens, values, sessionsRoot), { encoding: "utf8", mode: 0o600 });
        const useMacSandbox = process.platform === "darwin";
        turn = await runHarnessHeadless({
          command: useMacSandbox ? "/usr/bin/sandbox-exec" : process.execPath,
          commandArgs: useMacSandbox
            ? ["-p", sandboxProfile(job.mode, executionRoot, stateRoot, job.sourceDirectory, [dshHome]), "--", process.execPath]
            : [],
          script: location.path,
          cwd: isolated.cwd,
          env,
          patch: patchPath,
          prompt,
          signal: job.abort.signal,
        });
      } else {
        const useMacSandbox = process.platform === "darwin";
        const useNodeScript = process.platform === "win32" && /\.[cm]?js$/i.test(location.path);
        turn = await runHarnessTurn({
          command: useMacSandbox ? "/usr/bin/sandbox-exec" : useNodeScript ? process.execPath : location.path,
          args: useMacSandbox
            ? ["-p", sandboxProfile(job.mode, executionRoot, stateRoot, job.sourceDirectory, [dshHome]), "--", location.path]
            : useNodeScript ? [location.path] : [],
          cwd: isolated.cwd,
          env: {
            ...env,
            ...(useNodeScript && process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          },
          provider: job.provider,
          model: job.model,
          ...(maxTokens === undefined ? {} : { maxTokens }),
          prompt,
          sessionId: `ipollowork-${job.jobId}`,
          signal: job.abort.signal,
        });
      }
      job.result = { ...turn, patch: await collectWorkspacePatch(isolated) };
    } catch (error) {
      if (job.abort.signal.aborted) {
        job.state = "cancelled";
        job.error = "DeepSeek Harness job was cancelled";
      } else {
        job.state = "failed";
        job.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      const finalState = job.state === "running" ? "completed" : job.state;
      const finishedAt = Date.now();
      await rm(executionRoot, { recursive: true, force: true });
      try {
        await persist({ ...job, state: finalState, finishedAt });
      } finally {
        job.state = finalState;
        job.finishedAt = finishedAt;
      }
    }
  }

  return {
    actions: {
      capabilities: async () => {
        const values = await environmentValues();
        const managed = await managedRuntimeStatus(runtime.storage.dataDir);
        const location = await resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir);
        const macSandboxAvailable = process.platform !== "darwin" || await executable("/usr/bin/sandbox-exec");
        const available = Boolean(location) && macSandboxAvailable;
        const message = available
          ? "DSH service is ready"
          : !location && BUNDLED_HEADLESS_PLATFORM
            ? "The bundled DSH CLI is missing. Reinstall iPolloWork and try again"
            : !location
              ? "The DeepSeek Harness runtime is unavailable"
              : "The DeepSeek Harness sandbox is unavailable";
        return {
          available,
          serviceStatus: available ? "ready" : "unavailable",
          message,
          platform: process.platform,
          runtime: location ? { source: location.source, transport: location.transport, ...(location.version ? { version: location.version } : {}) } : null,
          runtimeManagement: {
            supported: !BUNDLED_HEADLESS_PLATFORM && location?.transport !== "headless",
            recommendedVersion: managed.recommendedVersion,
            installedVersions: managed.installedVersions,
            managedActiveVersion: managed.active?.version ?? null,
          },
          modes: ["standard", "code", "review"],
          providers: {
            deepseekOfficial: Boolean(values.DEEPSEEK_API_KEY),
            ipollowork: Boolean(values.IPOLLOWORK_API_KEY && values.IPOLLOWORK_INFERENCE_BASE_URL),
            customConfig: Boolean(values.DSH_CORDIS_CONFIG),
          },
          isolation: {
            originalWorkspaceWrite: false,
            gitClone: true,
            macosSeatbelt: process.platform === "darwin" && macSandboxAvailable,
            windowsPwshSandbox: process.platform === "win32" && location?.transport === "headless",
            uninstallDeletesData: true,
          },
        };
      },
      runtime_status: async () => {
        const [managed, location] = await Promise.all([
          managedRuntimeStatus(runtime.storage.dataDir),
          resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir),
        ]);
        const latestVersion = BUNDLED_HEADLESS_PLATFORM
          ? location?.version ?? null
          : await latestOfficialRuntimeVersion();
        return {
          active: location,
          managedActive: managed.active,
          installedVersions: managed.installedVersions,
          recommendedVersion: managed.recommendedVersion,
          latestVersion,
          updateAvailable: BUNDLED_HEADLESS_PLATFORM ? false : managed.active?.version !== latestVersion,
        };
      },
      runtime_install: async (args: Record<string, unknown>) => {
        const active = await resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir);
        if (active?.transport === "headless") {
          return { installed: false, active, installedVersions: [], recommendedVersion: active.version ?? null };
        }
        if (BUNDLED_HEADLESS_PLATFORM) throw new Error("The bundled DSH CLI is unavailable");
        const version = optionalText(args, "version", RECOMMENDED_DSH_RUNTIME_VERSION, 64);
        return installRuntime(version);
      },
      runtime_update: async () => {
        const active = await resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir);
        if (active?.transport === "headless") {
          return { installed: false, active, installedVersions: [], recommendedVersion: active.version ?? null };
        }
        if (BUNDLED_HEADLESS_PLATFORM) throw new Error("The bundled DSH CLI is unavailable");
        const version = await latestOfficialRuntimeVersion();
        return installRuntime(version);
      },
      runtime_remove: async () => {
        if (hasRunningJobs()) throw new Error("Cannot remove the DSH runtime while jobs are running");
        const active = await resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir);
        if (BUNDLED_HEADLESS_PLATFORM) return { removed: false, reason: active?.transport === "headless" ? "bundled" : "external" };
        await serializeRuntimeMutation(() => removeManagedRuntimes(runtime.storage.dataDir));
        return { removed: true };
      },
      start: async (args: Record<string, unknown>, context: Record<string, unknown>) => {
        const prompt = requiredText(args, "prompt", 100_000);
        const mode = modeValue(args);
        const provider = optionalText(args, "provider", "deepseek-official", 100);
        const model = optionalText(args, "model", provider === "deepseek-official" ? "deepseek-v4-flash" : "", 200);
        if (!model) throw new Error("model is required for this provider");
        const maxTokens = optionalInteger(args, "maxTokens", MIN_MODEL_OUTPUT_TOKENS, 262_144);
        const values = await environmentValues();
        if (!values.DSH_CORDIS_CONFIG) assertProviderReady(provider, values);
        const location = await resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir);
        if (!location) {
          if (BUNDLED_HEADLESS_PLATFORM) throw new Error("DeepSeek Harness service is unavailable because the bundled DSH CLI is missing. Reinstall iPolloWork and try again");
          throw new Error("DeepSeek Harness runtime installation did not produce an executable");
        }
        if (location.transport === "headless" && values.DSH_CORDIS_CONFIG) {
          throw new Error("Custom DSH_CORDIS_CONFIG is not supported by the bundled headless runtime");
        }
        if (process.platform === "darwin" && !await executable("/usr/bin/sandbox-exec")) {
          throw new Error("macOS sandbox-exec is unavailable");
        }
        if (location.transport === "jsonrpc" && process.platform !== "darwin" && location.source !== "environment") {
          throw new Error("The managed DSH JSON-RPC runtime requires macOS Seatbelt isolation");
        }
        const requestedDirectory = typeof context.directory === "string" && context.directory.trim()
          ? resolve(context.directory)
          : runtime.workspace.root;
        if (!inside(runtime.workspace.root, requestedDirectory)) throw new Error("DeepSeek Harness source directory is outside the active workspace");
        const jobId = randomUUID().replaceAll("-", "");
        const job: ActiveJob = {
          jobId,
          state: "running",
          mode,
          provider,
          model,
          sourceDirectory: requestedDirectory,
          startedAt: Date.now(),
          abort: new AbortController(),
          prompt,
        };
        jobs.set(jobId, job);
        job.task = execute(job, location, values, maxTokens);
        return { jobId, state: job.state, mode, provider, model, isolated: true };
      },
      status: async (args: Record<string, unknown>) => {
        const jobId = requiredText(args, "jobId", 64);
        const active = jobs.get(jobId);
        if (active) return publicJob(active, args);
        const stored = await storedJob(jobId);
        if (!stored) throw new Error(`DeepSeek Harness job not found: ${jobId}`);
        return publicJob(stored, args);
      },
      cancel: async (args: Record<string, unknown>) => {
        const jobId = requiredText(args, "jobId", 64);
        const job = jobs.get(jobId);
        if (!job) return { jobId, cancelled: false, reason: "not-running" };
        if (job.state !== "running") return { jobId, cancelled: false, reason: job.state };
        job.abort.abort();
        await job.task;
        return { jobId, cancelled: true };
      },
    },
    dispose: async () => {
      const running = [...jobs.values()].filter((job) => job.state === "running");
      for (const job of running) job.abort.abort();
      await Promise.all(running.map((job) => job.task));
    },
  };
}
