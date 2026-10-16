import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { basename, delimiter, dirname, resolve } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  HYPERFRAMES_VERSION,
  hyperframesStudioPort,
  videoProjectDirectory,
  videoProjectId,
} from "../../../../packages/video-studio/src/project";
import { inside, verifiedExistingPath, verifiedWritePath } from "../../studio-host/src/http";

export { applyBundledTemplate } from "../../studio-host/src/templates";
export { safeRelativePath, verifiedExistingPath, verifiedWritePath } from "../../studio-host/src/http";

const DEFAULT_IDLE_MS = 60_000;
const DEFAULT_START_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_CHARS = 32_000;
const PORT_ATTEMPTS = 32;

type HyperframesServerConfig = {
  isHyperframes: boolean;
  projectDir?: string;
  projectName?: string;
  version?: string;
  pid?: number;
};

type ManagedChild = ChildProcess & { stdout: Readable; stderr: Readable };
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type ProjectIdentity = {
  key: string;
  workspaceRoot: string;
  projectDirectory: string;
  projectPath: string;
  projectId: string;
};

type ManagedPreview = {
  child: ManagedChild | null;
  owned: boolean;
  port: number;
  projectPath: string;
  leases: Set<string>;
  idleTimer: NodeJS.Timeout | null;
};

export type VideoStudioRuntimeSession = {
  projectDirectory: string;
  projectPath: string;
  port: number;
  reused: boolean;
};

export type VideoValidationResult = {
  ok: boolean;
  exitCode: number;
  report: JsonValue;
  output: string;
};

export type VideoRuntimeManagerOptions = {
  cliPath?: string;
  idleMs?: number;
  startTimeoutMs?: number;
};

function appendBounded(current: string, chunk: string) {
  const combined = `${current}${chunk}`;
  return combined.length <= MAX_OUTPUT_CHARS ? combined : combined.slice(-MAX_OUTPUT_CHARS);
}

function resolveHyperframesCli() {
  return fileURLToPath(new URL("./hyperframes/cli.js", import.meta.url));
}

function inheritedPath() {
  const current = process.env.PATH ?? "";
  const fallback = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  return [...new Set([...current.split(delimiter), ...fallback].filter(Boolean))].join(delimiter);
}

function killOwnedProcess(child: ManagedChild | null) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function matchesServer(config: HyperframesServerConfig | null, projectPath: string) {
  if (!config?.isHyperframes) return false;
  const runningProject = typeof config.projectDir === "string" ? resolve(config.projectDir) : "";
  const runningName = typeof config.projectName === "string" ? config.projectName : "";
  return runningProject === resolve(projectPath)
    && runningName === basename(projectPath)
    && config.version === HYPERFRAMES_VERSION;
}

export async function readHyperframesServerConfig(port: number): Promise<HyperframesServerConfig | null> {
  return new Promise((resolvePromise) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: "/__hyperframes_config",
      method: "GET",
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body = appendBounded(body, chunk);
      });
      response.on("end", () => {
        try {
          const value: unknown = JSON.parse(body);
          if (!value || typeof value !== "object" || Reflect.get(value, "isHyperframes") !== true) {
            resolvePromise(null);
            return;
          }
          resolvePromise({
            isHyperframes: true,
            projectDir: typeof Reflect.get(value, "projectDir") === "string" ? Reflect.get(value, "projectDir") : undefined,
            projectName: typeof Reflect.get(value, "projectName") === "string" ? Reflect.get(value, "projectName") : undefined,
            version: typeof Reflect.get(value, "version") === "string" ? Reflect.get(value, "version") : undefined,
            pid: typeof Reflect.get(value, "pid") === "number" ? Reflect.get(value, "pid") : undefined,
          });
        } catch {
          resolvePromise(null);
        }
      });
    });
    request.on("error", () => resolvePromise(null));
    request.setTimeout(1_200, () => {
      request.destroy();
      resolvePromise(null);
    });
    request.end();
  });
}

export class VideoRuntimeManager {
  private readonly cliPath: string;
  private readonly ownerGuardPath: string;
  private readonly idleMs: number;
  private readonly startTimeoutMs: number;
  private readonly previews = new Map<string, ManagedPreview>();
  private readonly starts = new Map<string, Promise<VideoStudioRuntimeSession>>();

  constructor(options: VideoRuntimeManagerOptions = {}) {
    this.cliPath = options.cliPath ?? resolveHyperframesCli();
    this.ownerGuardPath = fileURLToPath(new URL("./preview-owner-guard.js", import.meta.url));
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  }

  activePreviewCount() {
    return this.previews.size;
  }

  async start(input: { workspaceRoot: string; sessionId: string; viewId?: string }) {
    const identity = await this.projectIdentity(input.workspaceRoot, input.sessionId, true);
    const current = this.previews.get(identity.key);
    if (current && await this.previewIsReady(current, identity.projectPath)) {
      if (input.viewId) current.leases.add(input.viewId);
      this.clearIdle(current);
      return this.session(identity, current.port, true);
    }
    if (current) this.removePreview(identity.key, current);

    const existingStart = this.starts.get(identity.key);
    if (existingStart) {
      const session = await existingStart;
      const started = this.previews.get(identity.key);
      if (started && input.viewId) started.leases.add(input.viewId);
      return { ...session, reused: true };
    }

    const start = this.startProject(identity, input.viewId);
    this.starts.set(identity.key, start);
    try {
      return await start;
    } finally {
      if (this.starts.get(identity.key) === start) this.starts.delete(identity.key);
    }
  }

  async release(input: { workspaceRoot: string; sessionId: string; viewId: string }) {
    const identity = await this.projectIdentity(input.workspaceRoot, input.sessionId, false);
    const preview = this.previews.get(identity.key);
    if (!preview) return;
    preview.leases.delete(input.viewId);
    if (preview.leases.size === 0) this.scheduleIdle(identity.key, preview);
  }

  async stop(input: { workspaceRoot: string; sessionId: string }) {
    const identity = await this.projectIdentity(input.workspaceRoot, input.sessionId, false);
    await this.starts.get(identity.key)?.catch(() => undefined);
    const preview = this.previews.get(identity.key);
    if (preview) await this.stopPreview(identity.key, preview);
  }

  async validate(input: { workspaceRoot: string; sessionId: string; signal?: AbortSignal }): Promise<VideoValidationResult> {
    const identity = await this.projectIdentity(input.workspaceRoot, input.sessionId, false);
    await verifiedExistingPath(identity.workspaceRoot, `${identity.projectDirectory}/index.html`, "video", "iVideo");
    const result = await this.runCommand(
      ["check", identity.projectPath, "--json", "--samples", "5", "--max-issues", "40"],
      identity.projectPath,
      input.signal,
    );
    let report: JsonValue = null;
    try {
      report = JSON.parse(result.stdout.trim());
    } catch {
      report = null;
    }
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      report,
      output: (result.stderr.trim() || result.stdout.trim()).slice(-MAX_OUTPUT_CHARS),
    };
  }

  dispose() {
    for (const [key, preview] of this.previews) this.removePreview(key, preview);
  }

  private async projectIdentity(workspacePath: string, sessionId: string, create: boolean): Promise<ProjectIdentity> {
    const workspaceRoot = await realpath(resolve(workspacePath.trim()));
    const projectDirectory = videoProjectDirectory(sessionId);
    const projectId = videoProjectId(sessionId);
    const requestedProjectPath = create
      ? dirname(await verifiedWritePath(workspaceRoot, `${projectDirectory}/index.html`, "video", "iVideo"))
      : resolve(workspaceRoot, projectDirectory);
    const projectPath = create
      ? requestedProjectPath
      : await realpath(requestedProjectPath).catch((error: unknown) => {
        if (error && typeof error === "object" && Reflect.get(error, "code") === "ENOENT") return requestedProjectPath;
        throw error;
      });
    if (!inside(workspaceRoot, projectPath)) throw new Error("iVideo project escaped the workspace.");
    return {
      key: projectPath,
      workspaceRoot,
      projectDirectory,
      projectPath,
      projectId,
    };
  }

  private async startProject(identity: ProjectIdentity, viewId?: string) {
    await this.ensureProject(identity);
    const preferredPort = hyperframesStudioPort(identity.projectId);
    for (let offset = 0; offset < PORT_ATTEMPTS; offset += 1) {
      const port = preferredPort + offset;
      const config = await readHyperframesServerConfig(port);
      if (matchesServer(config, identity.projectPath)) {
        const preview: ManagedPreview = {
          child: null,
          owned: false,
          port,
          projectPath: identity.projectPath,
          leases: new Set(viewId ? [viewId] : []),
          idleTimer: null,
        };
        this.previews.set(identity.key, preview);
        if (!viewId) this.scheduleIdle(identity.key, preview);
        return this.session(identity, port, true);
      }
      if (config) continue;

      const child = this.spawnCommand(["preview", identity.projectPath, "--port", String(port), "--no-open"], identity.projectPath);
      let output = "";
      const onOutput = (chunk: Buffer) => {
        output = appendBounded(output, chunk.toString());
      };
      child.stdout.on("data", onOutput);
      child.stderr.on("data", onOutput);
      try {
        await this.waitForServer(port, identity.projectPath, child);
      } catch (error) {
        killOwnedProcess(child);
        if (output.toLowerCase().includes("address already in use") && offset < PORT_ATTEMPTS - 1) continue;
        throw new Error(output.trim() || (error instanceof Error ? error.message : "HyperFrames Studio failed to start."));
      }
      const preview: ManagedPreview = {
        child,
        owned: true,
        port,
        projectPath: identity.projectPath,
        leases: new Set(viewId ? [viewId] : []),
        idleTimer: null,
      };
      this.previews.set(identity.key, preview);
      child.once("exit", () => {
        if (this.previews.get(identity.key) === preview) this.removePreview(identity.key, preview, false);
      });
      if (!viewId) this.scheduleIdle(identity.key, preview);
      return this.session(identity, port, false);
    }
    throw new Error("No available local port could be found for HyperFrames Studio.");
  }

  private async ensureProject(identity: ProjectIdentity) {
    if (!existsSync(resolve(identity.projectPath, "index.html"))) {
      const result = await this.runCommand(
        ["init", identity.projectDirectory, "--example", "blank", "--non-interactive"],
        identity.workspaceRoot,
      );
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || "HyperFrames init failed.");
    }
    const indexPath = await verifiedExistingPath(
      identity.workspaceRoot,
      `${identity.projectDirectory}/index.html`,
      "video",
      "iVideo",
    );
    const html = await readFile(indexPath, "utf8");
    if (html.includes("ipollowork-video-placeholder") || !html.includes("Add your clips here")) return;
    const placeholder = `      <div id="ipollowork-video-placeholder" class="clip" data-start="0" data-duration="10" data-track-index="1" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#111827;color:#f8fafc;font:600 56px system-ui,sans-serif;">Ready</div>\n\n`;
    const patched = html.replace(
      /(<div\b[^>]*\bdata-composition-id="main"[^>]*>\s*)(<!--\s*Add your clips here)/,
      `$1${placeholder}$2`,
    );
    if (patched !== html) await writeFile(indexPath, patched, "utf8");
  }

  private spawnCommand(args: string[], cwd: string) {
    const ownsPreview = args[0] === "preview";
    return spawn(process.execPath, [
      ...(ownsPreview ? ["--import", this.ownerGuardPath] : []),
      this.cliPath,
      ...args,
    ], {
      cwd,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ownsPreview ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: inheritedPath(),
        BROWSER: "none",
        NO_COLOR: "1",
        HYPERFRAMES_SKIP_SKILLS: args[0] === "init" ? "1" : process.env.HYPERFRAMES_SKIP_SKILLS,
      },
    }) as ManagedChild;
  }

  private async runCommand(args: string[], cwd: string, signal?: AbortSignal) {
    const child = this.spawnCommand(args, cwd);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk.toString());
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk.toString());
    });
    return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolvePromise, reject) => {
      const abort = () => killOwnedProcess(child);
      signal?.addEventListener("abort", abort, { once: true });
      child.once("error", reject);
      child.once("exit", (code) => {
        signal?.removeEventListener("abort", abort);
        resolvePromise({ exitCode: code ?? 1, stdout, stderr });
      });
    });
  }

  private async waitForServer(port: number, projectPath: string, child: ManagedChild) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.startTimeoutMs) {
      if (child.exitCode !== null) throw new Error(`HyperFrames Studio stopped before it was ready (${child.exitCode}).`);
      if (matchesServer(await readHyperframesServerConfig(port), projectPath)) return;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    throw new Error(`Timed out waiting for HyperFrames Studio on port ${port}.`);
  }

  private async previewIsReady(preview: ManagedPreview, projectPath: string) {
    if (preview.owned && preview.child?.exitCode !== null) return false;
    return matchesServer(await readHyperframesServerConfig(preview.port), projectPath);
  }

  private session(identity: ProjectIdentity, port: number, reused: boolean): VideoStudioRuntimeSession {
    return {
      projectDirectory: identity.projectDirectory,
      projectPath: identity.projectPath,
      port,
      reused,
    };
  }

  private clearIdle(preview: ManagedPreview) {
    if (preview.idleTimer) clearTimeout(preview.idleTimer);
    preview.idleTimer = null;
  }

  private scheduleIdle(key: string, preview: ManagedPreview) {
    this.clearIdle(preview);
    preview.idleTimer = setTimeout(() => {
      if (preview.leases.size === 0 && this.previews.get(key) === preview) this.removePreview(key, preview);
    }, this.idleMs);
  }

  private removePreview(key: string, preview: ManagedPreview, stop = true) {
    this.clearIdle(preview);
    if (this.previews.get(key) === preview) this.previews.delete(key);
    if (stop && preview.owned) killOwnedProcess(preview.child);
  }

  private async stopPreview(key: string, preview: ManagedPreview) {
    this.removePreview(key, preview, false);
    const child = preview.owned ? preview.child : null;
    if (!child || child.exitCode !== null) return;
    const exited = new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
    killOwnedProcess(child);
    await Promise.race([
      exited,
      new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2_000)),
    ]);
    if (child.exitCode === null) {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      await exited;
    }
  }
}
