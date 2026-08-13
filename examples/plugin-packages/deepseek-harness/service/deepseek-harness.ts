import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { runHarnessTurn } from "./dsh-jsonrpc.ts";
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

function optionalPositiveInteger(args: Record<string, unknown>, key: string, maximum: number): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${key} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
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

  async function execute(job: ActiveJob, runtimePath: string, values: RuntimeEnvironmentValues, maxTokens?: number): Promise<void> {
    const requestedJobRoot = resolve(jobsRoot, job.jobId);
    await mkdir(requestedJobRoot, { recursive: true, mode: 0o700 });
    const jobRoot = await realpath(requestedJobRoot);
    const workspaceRoot = resolve(jobRoot, "workspace");
    const stateRoot = resolve(jobRoot, "state");
    const sessionsRoot = resolve(stateRoot, "sessions");
    const homeRoot = resolve(stateRoot, "home");
    try {
      await mkdir(homeRoot, { recursive: true, mode: 0o700 });
      await mkdir(resolve(homeRoot, "tmp"), { recursive: true, mode: 0o700 });
      await mkdir(sessionsRoot, { recursive: true, mode: 0o700 });
      const isolated = await prepareIsolatedWorkspace(job.sourceDirectory, workspaceRoot);
      const configPath = values.DSH_CORDIS_CONFIG
        ? resolve(values.DSH_CORDIS_CONFIG)
        : bundledCordisConfigPath();
      const env = childEnvironment(process.env, values, {
        cwd: isolated.cwd,
        home: homeRoot,
        sessions: sessionsRoot,
        config: configPath,
        mode: job.mode,
        provider: job.provider,
        model: job.model,
      });
      const turn = await runHarnessTurn({
        command: "/usr/bin/sandbox-exec",
        args: ["-p", sandboxProfile(job.mode, jobRoot, stateRoot, job.sourceDirectory), "--", runtimePath],
        cwd: isolated.cwd,
        env,
        provider: job.provider,
        model: job.model,
        ...(maxTokens === undefined ? {} : { maxTokens }),
        prompt: promptForMode(job.prompt, job.mode),
        sessionId: `ipollowork-${job.jobId}`,
        signal: job.abort.signal,
      });
      job.result = { ...turn, patch: await collectWorkspacePatch(isolated) };
      job.state = "completed";
    } catch (error) {
      if (job.abort.signal.aborted) {
        job.state = "cancelled";
        job.error = "DeepSeek Harness job was cancelled";
      } else {
        job.state = "failed";
        job.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      job.finishedAt = Date.now();
      await rm(workspaceRoot, { recursive: true, force: true });
      await persist(job);
    }
  }

  return {
    actions: {
      capabilities: async () => {
        const values = await environmentValues();
        const managed = await managedRuntimeStatus(runtime.storage.dataDir);
        const location = await resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir);
        return {
          available: Boolean(location) && process.platform === "darwin" && await executable("/usr/bin/sandbox-exec"),
          runtime: location ? { source: location.source, ...(location.version ? { version: location.version } : {}) } : null,
          runtimeManagement: {
            supported: true,
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
            macosSeatbelt: true,
            uninstallDeletesData: true,
          },
        };
      },
      runtime_status: async () => {
        const [managed, latestVersion, location] = await Promise.all([
          managedRuntimeStatus(runtime.storage.dataDir),
          latestOfficialRuntimeVersion(),
          resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir),
        ]);
        return {
          active: location,
          managedActive: managed.active,
          installedVersions: managed.installedVersions,
          recommendedVersion: managed.recommendedVersion,
          latestVersion,
          updateAvailable: managed.active?.version !== latestVersion,
        };
      },
      runtime_install: async (args: Record<string, unknown>) => {
        const version = optionalText(args, "version", RECOMMENDED_DSH_RUNTIME_VERSION, 64);
        return installRuntime(version);
      },
      runtime_update: async () => {
        const version = await latestOfficialRuntimeVersion();
        return installRuntime(version);
      },
      runtime_remove: async () => {
        if (hasRunningJobs()) throw new Error("Cannot remove the DSH runtime while jobs are running");
        await serializeRuntimeMutation(() => removeManagedRuntimes(runtime.storage.dataDir));
        return { removed: true };
      },
      start: async (args: Record<string, unknown>, context: Record<string, unknown>) => {
        if (process.platform !== "darwin") throw new Error("DeepSeek Harness plugin currently requires macOS Seatbelt isolation");
        if (!await executable("/usr/bin/sandbox-exec")) throw new Error("macOS sandbox-exec is unavailable");
        const prompt = requiredText(args, "prompt", 100_000);
        const mode = modeValue(args);
        const provider = optionalText(args, "provider", "deepseek-official", 100);
        const model = optionalText(args, "model", provider === "deepseek-official" ? "deepseek-v4-flash" : "", 200);
        if (!model) throw new Error("model is required for this provider");
        const maxTokens = optionalPositiveInteger(args, "maxTokens", 262_144);
        const values = await environmentValues();
        if (!values.DSH_CORDIS_CONFIG) assertProviderReady(provider, values);
        let location = await resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir);
        if (!location) {
          await installRuntime(RECOMMENDED_DSH_RUNTIME_VERSION);
          location = await resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir);
        }
        if (!location) throw new Error("DeepSeek Harness runtime installation did not produce an executable");
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
        job.task = execute(job, location.path, values, maxTokens);
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
