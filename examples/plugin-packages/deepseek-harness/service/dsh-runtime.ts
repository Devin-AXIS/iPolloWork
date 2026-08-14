import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { managedRuntimeStatus, type ManagedRuntime } from "./runtime-manager.ts";

export type EnvironmentRuntime = {
  get(name: string): Promise<string | null>;
};

export type JobMode = "standard" | "code" | "review";

export type RuntimeLocation = {
  path: string;
  source: "bundled" | "environment" | "managed";
  transport: "headless" | "jsonrpc";
  version?: string;
};

const ENVIRONMENT_KEYS = [
  "DSH_RUNTIME_BIN",
  "DSH_CORDIS_CONFIG",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "IPOLLOWORK_API_KEY",
  "IPOLLOWORK_INFERENCE_BASE_URL",
  "IPOLLOWORK_DSH_CLI",
  "IPOLLOWORK_DSH_CLI_VERSION",
] as const;
const SAFE_CHILD_ENV = [
  "PATH",
  "PATHEXT",
  "ComSpec",
  "SystemRoot",
  "WINDIR",
  "PSModulePath",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SHELL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

export type RuntimeEnvironmentValues = Record<(typeof ENVIRONMENT_KEYS)[number], string | null>;

function quote(value: string): string {
  return JSON.stringify(value);
}

function runtimeBinaryName(): string | null {
  const platform = process.platform === "darwin" ? "macos" : process.platform === "linux" ? "linux" : null;
  if (!platform || (process.arch !== "arm64" && process.arch !== "x64")) return null;
  return `dsh-jsonrpc-agent-pkg-${platform}-${process.arch}`;
}

export async function executable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function readable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveRuntimeLocation(environment: EnvironmentRuntime, dataDir: string): Promise<RuntimeLocation | null> {
  const configured = await environment.get("DSH_RUNTIME_BIN");
  if (configured) {
    const path = resolve(configured);
    if (await executable(path)) return { path, source: "environment", transport: "jsonrpc" };
  }
  if (process.platform === "win32" || process.platform === "darwin") {
    const configuredCli = await environment.get("IPOLLOWORK_DSH_CLI");
    if (configuredCli) {
      const path = resolve(configuredCli);
      if (await readable(path)) {
        const version = await environment.get("IPOLLOWORK_DSH_CLI_VERSION");
        return { path, source: "bundled", transport: "headless", ...(version ? { version } : {}) };
      }
    }
    return null;
  }
  const managed: ManagedRuntime | null = (await managedRuntimeStatus(dataDir)).active;
  if (managed) return { ...managed, transport: "jsonrpc" };
  const name = runtimeBinaryName();
  if (!name) return null;
  const path = fileURLToPath(new URL(`../runtime/${name}`, import.meta.url));
  return await executable(path) ? { path, source: "bundled", transport: "jsonrpc" } : null;
}

export async function readEnvironmentValues(environment: EnvironmentRuntime): Promise<RuntimeEnvironmentValues> {
  return Object.fromEntries(await Promise.all(ENVIRONMENT_KEYS.map(async (key) => [key, await environment.get(key)]))) as RuntimeEnvironmentValues;
}

export function assertProviderReady(provider: string, values: RuntimeEnvironmentValues): void {
  if (provider === "deepseek-official") {
    if (!values.DEEPSEEK_API_KEY) throw new Error("DeepSeek API key is not configured for this plugin");
    return;
  }
  if (provider === "ipollowork") {
    if (!values.IPOLLOWORK_API_KEY || !values.IPOLLOWORK_INFERENCE_BASE_URL) {
      throw new Error("The current iPolloWork model connection has no reusable API key and inference URL");
    }
    return;
  }
  throw new Error(`Provider ${provider} requires a custom DSH_CORDIS_CONFIG`);
}

export function bundledCordisConfigPath(): string {
  return fileURLToPath(new URL("../cordis.yml", import.meta.url));
}

export function sandboxProfile(
  mode: JobMode,
  jobRoot: string,
  stateRoot: string,
  sourceRoot: string,
  additionalWritableRoots: string[] = [],
): string {
  const escaped = (path: string) => quote(path).replaceAll("\\", "\\\\");
  const writable = [...new Set([...(mode === "review" ? [stateRoot] : [jobRoot]), ...additionalWritableRoots])];
  const protectedRoots = [...new Set([homedir(), sourceRoot])];
  return [
    "(version 1)",
    "(allow default)",
    `(deny file-write* ${protectedRoots.map((path) => `(subpath ${escaped(path)})`).join(" ")})`,
    `(allow file-write* (literal ${escaped("/dev/null")}))`,
    `(allow file-write* ${writable.map((path) => `(subpath ${escaped(path)})`).join(" ")})`,
  ].join(" ");
}

export function childEnvironment(base: Record<string, string | undefined>, values: RuntimeEnvironmentValues, input: {
  cwd: string;
  home: string;
  dshHome: string;
  sessions: string;
  config?: string;
  mode: JobMode;
  provider: string;
  model: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_CHILD_ENV) if (base[key]) env[key] = base[key];
  for (const key of ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "IPOLLOWORK_API_KEY", "IPOLLOWORK_INFERENCE_BASE_URL"] as const) {
    if (values[key]) env[key] = values[key] ?? undefined;
  }
  env.HOME = input.home;
  env.USERPROFILE = input.home;
  env.APPDATA = resolve(input.home, "appdata");
  env.LOCALAPPDATA = resolve(input.home, "localappdata");
  env.TMPDIR = resolve(input.home, "tmp");
  env.TMP = resolve(input.home, "tmp");
  env.TEMP = resolve(input.home, "tmp");
  env.DSH_HOME = input.dshHome;
  env.DSH_CWD = input.cwd;
  env.DSH_SESSION_ROOT = input.sessions;
  if (input.config) env.DSH_CORDIS_CONFIG = input.config;
  env.DSH_PERMISSION_MODE = input.mode === "review" ? "read-only" : "workspace-write";
  env.DSH_TOOL_MODE = input.mode === "code" ? "code" : "native";
  env.DSH_TOOLS_MODE = env.DSH_TOOL_MODE;
  env.DSH_SYSTEM_PROMPT = input.mode === "review"
    ? "You are an independent code reviewer. Inspect deeply, do not modify files, and return concise findings with evidence."
    : "You are an independent coding subagent. Work only inside the isolated repository, verify changes, and report exactly what changed.";
  env.DSH_PROVIDER = input.provider;
  env.DSH_MODEL = input.model;
  return env;
}

export function promptForMode(prompt: string, mode: JobMode): string {
  if (mode === "review") return `Review the current repository without modifying it.\n\n${prompt}`;
  return `Work in the isolated repository. Do not commit, publish, or contact the original workspace.\n\n${prompt}`;
}
