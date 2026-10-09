import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createArchive } from "./archive.ts";
import { compileSkill, defaultRecordingTitle, importChromeFlow, isRecord, MAX_STEPS, newSession, normalizeSession, normalizeStep, normalizeSteps, redact, text, type Session } from "./model.ts";

export type ServiceRuntime = {
  storage: Readonly<{ dataDir: string }>;
  workspace: Readonly<{ root: string }>;
  plugin: Readonly<{ id: string; version: string }>;
};
type Options = { collectorPath?: string; uiDir?: string; platform?: NodeJS.Platform; architecture?: string };
type DesktopCapabilities = {
  supported: boolean; accessibility: boolean; inputMonitoring: boolean;
  backend?: string; sessionType?: string; reason?: string; permissionHelp?: string;
};
type Arguments = Record<string, unknown>;
type ActionHandler = (input: Arguments) => Promise<unknown>;
type SessionSummary = { id: string; title: string; createdAt: string; status: Session["status"]; stepCount: number };
const BODY_LIMIT = 1_048_576;
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function nodeExecutable(): string {
  return process.env.IPOLLOWORK_NODE_BIN?.trim() || process.env.IPOLLOWORK_DSH_NODE_BIN?.trim()
    || (process.release.name === "node" && !Object.hasOwn(process.versions, "bun") ? process.execPath : process.platform === "win32" ? "node.exe" : "node");
}

function collectorEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) };
}

function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

// Check every existing component, including trusted roots: a symlink inside an
// otherwise contained string must never redirect a write into another workspace.
async function safeDirectory(path: string, create = true): Promise<string> {
  const absolute = resolve(path);
  const pathRoot = parse(absolute).root;
  const components = absolute.slice(pathRoot.length).split(sep).filter(Boolean);
  let current = pathRoot;
  for (const component of components) {
    current = join(current, component);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Storage path contains a symlink or non-directory");
    } catch (error) {
      if (!create || !isRecord(error) || error.code !== "ENOENT") throw error;
      try { await mkdir(current, { mode: 0o700 }); }
      catch (error) { if (!isRecord(error) || error.code !== "EEXIST") throw error; }
      const created = await lstat(current);
      if (created.isSymbolicLink() || !created.isDirectory()) throw new Error("Storage path contains a symlink or non-directory");
    }
  }
  return realpath(absolute);
}

async function regularFile(path: string, maximum: number): Promise<Buffer> {
  await safeDirectory(dirname(path), false);
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maximum) throw new Error("File is not a bounded regular file");
  return readFile(path);
}

async function atomicWrite(root: string, relativePath: string, value: string | Buffer, mode = 0o600): Promise<string> {
  if (isAbsolute(relativePath)) throw new Error("Absolute artifact paths are forbidden");
  const path = resolve(root, relativePath);
  if (!inside(root, path)) throw new Error("Artifact path escapes storage");
  await safeDirectory(dirname(path));
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Artifact target is not a regular file");
  } catch (error) {
    if (!isRecord(error) || error.code !== "ENOENT") throw error;
  }
  const temporary = `${path}.${randomUUID()}.partial`;
  try {
    await writeFile(temporary, value, { mode, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}

async function collectorResult(path: string, argument: string): Promise<unknown> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(nodeExecutable(), [path, argument], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: collectorEnvironment() });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Node.js collector permission check timed out")); }, 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > BODY_LIMIT) { child.kill(); reject(new Error("Collector output exceeded its limit")); }
    });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error("Node.js collector permission check failed")); return; }
      try { resolveResult(JSON.parse(output)); } catch { reject(new Error("Collector permission check returned invalid JSON")); }
    });
  });
}

function message(error: unknown): string {
  return redact(error instanceof Error ? error.message : "Operation failed");
}

export async function createRecorderService(runtime: ServiceRuntime, options: Options = {}) {
  const platform = options.platform ?? process.platform;
  const workspace = await realpath(runtime.workspace.root);
  // Host-provided roots may use macOS /var aliases. Canonicalize this trusted
  // boundary once; every plugin-owned descendant is then checked for symlinks.
  await mkdir(runtime.storage.dataDir, { recursive: true, mode: 0o700 });
  const dataRoot = await safeDirectory(await realpath(runtime.storage.dataDir));
  const workspaceKey = createHash("sha256").update(workspace).digest("hex").slice(0, 24);
  const storage = await safeDirectory(join(dataRoot, "workspaces", workspaceKey));
  const sessionsRoot = await safeDirectory(join(storage, "sessions"));
  const architecture = options.architecture ?? process.arch;
  const collectorSource = options.collectorPath ?? join(moduleRoot, "native", "recorder.mjs");
  const uiDir = options.uiDir ?? join(moduleRoot, "ui");
  const lockPath = join(dataRoot, "recording.lock");
  let current: Session | null = null;
  let child: ChildProcessWithoutNullStreams | null = null;
  let ownsLock = false;
  let lastError: string | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let server: Server | null = null;
  let workbenchUrl: string | null = null;
  let workbenchOpening: Promise<{ url: string }> | null = null;
  let disposed = false;
  let summaries: SessionSummary[] | null = null;

  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task);
    queue = next.catch(() => undefined);
    return next;
  }

  async function persist(session: Session): Promise<void> {
    const content = JSON.stringify(normalizeSession(session), null, 2);
    if (Buffer.byteLength(content) > BODY_LIMIT) throw new Error("Session exceeds 1 MiB. Reduce its metadata or split the workflow.");
    await atomicWrite(sessionsRoot, `${session.id}.json`, content);
    if (summaries) summaries = [summary(session), ...summaries.filter((entry) => entry.id !== session.id)].slice(0, 25);
  }

  function summary(session: Session): SessionSummary {
    return { id: session.id, title: session.title, createdAt: session.createdAt, status: session.status, stepCount: session.steps.length };
  }

  async function recordingOwnedElsewhere(id: string): Promise<boolean> {
    try {
      const lock: unknown = JSON.parse((await regularFile(lockPath, 1_024)).toString("utf8"));
      if (!isRecord(lock) || lock.workspace !== workspaceKey || lock.sessionId !== id || typeof lock.pid !== "number" || !Number.isSafeInteger(lock.pid) || lock.pid <= 0) return false;
      try { process.kill(lock.pid, 0); return true; }
      catch (error) { if (isRecord(error) && error.code === "ESRCH") return false; throw error; }
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") return false;
      throw error;
    }
  }

  async function load(id: unknown): Promise<Session> {
    const key = text(id, "Session ID", 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error("Invalid session ID");
    if (current?.id === key) return normalizeSession(current);
    const stored = normalizeSession(JSON.parse((await regularFile(join(sessionsRoot, `${key}.json`), BODY_LIMIT)).toString("utf8")));
    // A prior process can leave an interrupted recording. It is a reviewable
    // draft, never an active recorder in this service instance.
    if ((stored.status === "recording" || stored.status === "paused") && !await recordingOwnedElsewhere(key)) stored.status = "draft";
    return stored;
  }

  async function sessionEntries() {
    const entries = await readdir(sessionsRoot, { withFileTypes: true });
    if (entries.length > 1_000) throw new Error("Session storage exceeds the 1000-session limit");
    return entries.filter((entry) => entry.name.endsWith(".json"));
  }

  async function sessions(): Promise<SessionSummary[]> {
    if (summaries) return summaries;
    const entries = await sessionEntries();
    const dated = await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile()) throw new Error("Session storage contains a non-regular file");
      return { name: entry.name, modified: (await lstat(join(sessionsRoot, entry.name))).mtimeMs };
    }));
    const values = await Promise.all(dated.sort((left, right) => right.modified - left.modified).slice(0, 25).map((entry) => load(entry.name.slice(0, -5))));
    summaries = values.map(summary);
    return summaries;
  }

  async function exportDirectory(name: string): Promise<{ directory: string; version: string }> {
    const root = await safeDirectory(join(storage, "exports", name));
    const entries = await readdir(root, { withFileTypes: true });
    if (entries.length >= 1_000) throw new Error("This Skill has reached its 1000-version export limit");
    let revision = 0;
    for (const entry of entries) {
      const match = /^1\.0\.(\d{1,3})$/.exec(entry.name);
      if (!match || !entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Skill export storage contains an invalid revision or symlink");
      revision = Math.max(revision, Number(match[1]) + 1);
    }
    while (revision < 1_000) {
      const version = `1.0.${revision}`;
      const directory = join(root, version);
      try {
        // The directory itself reserves this immutable version across engines
        // and service instances; a partial export never reuses its version.
        await mkdir(directory, { mode: 0o700 });
        await safeDirectory(directory, false);
        return { directory, version };
      } catch (error) {
        if (!isRecord(error) || error.code !== "EEXIST") throw error;
        const existing = await lstat(directory);
        if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error("Skill export storage contains a symlink or non-directory");
        revision += 1;
      }
    }
    throw new Error("This Skill has reached its 1000-version export limit");
  }

  async function helper(): Promise<string> {
    // Execute from the immutable installed package so relative modules and
    // bundled N-API dependencies resolve without a download or executable cache.
    await regularFile(collectorSource, BODY_LIMIT);
    return collectorSource;
  }

  async function permissions(): Promise<DesktopCapabilities> {
    if (!["darwin", "win32", "linux"].includes(platform) || !["x64", "arm64"].includes(architecture)) {
      return { supported: false, accessibility: false, inputMonitoring: false, reason: `No desktop recorder for ${platform}/${architecture}.` };
    }
    try {
      const result = await collectorResult(await helper(), "--check");
      if (!isRecord(result) || typeof result.supported !== "boolean" || typeof result.accessibility !== "boolean" || typeof result.inputMonitoring !== "boolean") throw new Error("Invalid collector capabilities");
      const capabilities: DesktopCapabilities = { supported: result.supported, accessibility: result.accessibility, inputMonitoring: result.inputMonitoring };
      for (const field of ["backend", "sessionType", "reason", "permissionHelp"]) {
        const value = typeof result[field] === "string" ? redact(result[field].slice(0, 2_000)) : undefined;
        if (value && field === "backend") capabilities.backend = value;
        if (value && field === "sessionType") capabilities.sessionType = value;
        if (value && field === "reason") capabilities.reason = value;
        if (value && field === "permissionHelp") capabilities.permissionHelp = value;
      }
      return capabilities;
    } catch (error) {
      return { supported: false, accessibility: false, inputMonitoring: false, reason: message(error) };
    }
  }

  async function acquireLock(sessionId: string): Promise<void> {
    async function createLock(): Promise<void> {
      const lock = await open(lockPath, "wx", 0o600);
      await lock.writeFile(JSON.stringify({ pid: process.pid, workspace: workspaceKey, sessionId }));
      await lock.close();
      ownsLock = true;
    }
    try {
      await createLock();
    } catch (error) {
      if (!isRecord(error) || error.code !== "EEXIST") throw error;
      const recoveryPath = join(dataRoot, "recording-recovery.lock");
      const recovery = await open(recoveryPath, "wx", 0o600).catch(() => { throw new Error("Another desktop recording is active. Stop it before starting a new one."); });
      try {
        const prior: unknown = JSON.parse((await regularFile(lockPath, 1_024)).toString("utf8"));
        if (!isRecord(prior) || typeof prior.pid !== "number" || !Number.isSafeInteger(prior.pid) || prior.pid <= 0) throw new Error("Invalid recording lock. Inspect the plugin storage before retrying.");
        let dead = false;
        try { process.kill(prior.pid, 0); }
        catch (error) { if (isRecord(error) && error.code === "ESRCH") dead = true; else throw error; }
        if (!dead) throw new Error("Another desktop recording is active. Stop it before starting a new one.");
        await rm(lockPath);
        await createLock();
      } finally {
        await recovery.close();
        await rm(recoveryPath, { force: true });
      }
    }
  }

  async function releaseLock(): Promise<void> {
    if (ownsLock) {
      ownsLock = false;
      await rm(lockPath, { force: true });
    }
  }

  async function stopCapture(): Promise<void> {
    const active = child;
    child = null;
    if (active) {
      await new Promise<void>((done) => {
        const timer = setTimeout(() => { active.kill("SIGKILL"); done(); }, 2_000);
        active.once("close", () => { clearTimeout(timer); done(); });
        if (active.exitCode !== null) { clearTimeout(timer); done(); }
        else active.stdin.write(`${JSON.stringify({ command: "stop" })}\n`);
      });
    }
    await releaseLock();
  }

  async function startCapture(path: string): Promise<void> {
    const processHandle = spawn(nodeExecutable(), [path], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: collectorEnvironment() });
    child = processHandle;
    processHandle.stdin.on("error", (error: Error) => { lastError = message(error); processHandle.kill(); });
    let pendingBytes = 0;
    processHandle.stdout.on("data", (chunk: Buffer) => {
      for (const byte of chunk) {
        pendingBytes = byte === 10 ? 0 : pendingBytes + 1;
        if (pendingBytes > BODY_LIMIT) { lastError = "Native event exceeded its limit"; processHandle.kill(); break; }
      }
    });
    const lines = createInterface({ input: processHandle.stdout });
    // stderr carries runtime warnings as well as failures. Keep bounded
    // diagnostics for an exit; only protocol errors or failed capture set error.
    let diagnostics = "";
    processHandle.stderr.on("data", (data: Buffer) => { diagnostics = (diagnostics + data.toString("utf8")).slice(-2_000); });
    await new Promise<void>((ready, reject) => {
      let settled = false;
      const timer = setTimeout(() => { settled = true; reject(new Error("Desktop recorder did not become ready")); }, 10_000);
      processHandle.once("error", (error) => { clearTimeout(timer); settled = true; reject(error); });
      processHandle.once("close", (code) => {
        lines.close();
        clearTimeout(timer);
        const detail = diagnostics ? `: ${redact(diagnostics).slice(0, 500).trim()}` : "";
        if (!settled) { settled = true; reject(new Error(`Desktop recorder exited before ready (${code})${detail}`)); }
        if (child === processHandle) {
          child = null;
          void serialize(async () => {
            if (current?.status === "recording" || current?.status === "paused") {
              current.status = "draft";
              lastError = `Desktop recording stopped unexpectedly (${code})${detail}. Review the captured steps.`;
              await persist(current);
            }
            await releaseLock();
          });
        }
      });
      lines.on("line", (line) => {
        if (line.length > BODY_LIMIT) { processHandle.kill(); lastError = "Native event exceeded its limit"; return; }
        try {
          const event: unknown = JSON.parse(line);
          if (!isRecord(event)) throw new Error("Invalid recorder event");
          if (event.type === "ready" && !settled) { clearTimeout(timer); settled = true; ready(); }
          if (event.type === "error" || event.type === "limit") {
            void serialize(async () => {
              lastError = event.type === "limit" ? "Reached the recording step limit. Review or split the workflow." : message(new Error(typeof event.message === "string" ? event.message : "Desktop recorder failed"));
              await stopCapture();
              if (current) { current.status = "draft"; await persist(current); }
            });
          }
          if (event.type === "step") {
            // The native adapter filters by observation time. A valid click
            // observed before pause may arrive after double-click detection.
            if (!current || (current.status !== "recording" && current.status !== "paused")) return;
            const session = current;
            if (session.steps.length >= MAX_STEPS) {
              void serialize(async () => { await stopCapture(); session.status = "draft"; lastError = "Reached 500 steps. Review or split the workflow."; await persist(session); });
              return;
            }
            try {
              // Consume frames synchronously; stop waits for stdio to close.
              // Queuing the mutation behind stop would discard a final click
              // flushed by the native double-click detector during shutdown.
              session.steps.push(normalizeStep(event.step, session.steps.length));
              void serialize(() => persist(session)).catch(error => { lastError = message(error); });
            } catch (error) { lastError = message(error); }
          }
        } catch (error) { lastError = message(error); }
      });
    });
  }

  async function activeSession(): Promise<Session> {
    if (!current || !child || (current.status !== "recording" && current.status !== "paused")) throw new Error("No active desktop recording");
    return current;
  }

  const actions: Record<string, ActionHandler> = {
    capabilities: async () => ({ platform, desktop: await permissions(), chromeImport: true, portableEngines: ["opencode", "codex-harness", "deepseek-harness"], maxSteps: MAX_STEPS }),
    "request-permissions": async () => {
      if (platform === "darwin") await collectorResult(await helper(), "--request-permissions");
      return { desktop: await permissions() };
    },
    status: async (input) => {
      const stored = await sessions();
      const session = input.sessionId !== undefined ? await load(input.sessionId) : current ?? (stored[0] ? await load(stored[0].id) : null);
      return { session, sessions: stored, recording: child !== null, error: lastError };
    },
    start: async (input) => serialize(async () => {
      if (disposed) throw new Error("Recorder service is disposed");
      if (child) throw new Error("Stop the active recording first");
      const title = input.title === undefined || input.title === "" ? undefined : text(input.title, "Title", 200);
      const capability = await permissions();
      if (!capability.supported) throw new Error(capability.reason ?? "Desktop recording is unavailable in this session. Chrome Recorder import remains available.");
      if (!capability.accessibility || !capability.inputMonitoring) {
        throw new Error(capability.permissionHelp ?? capability.reason ?? "Grant desktop accessibility and input monitoring access, then start again.");
      }
      if ((await sessionEntries()).length >= 1_000) throw new Error("Session storage is full");
      const session = newSession(title, "recording");
      await acquireLock(session.id);
      current = session;
      lastError = null;
      try { await persist(current); await startCapture(await helper()); }
      catch (error) { await stopCapture(); current.status = "draft"; await persist(current); throw error; }
      return { session: current };
    }),
    pause: async () => serialize(async () => {
      const session = await activeSession();
      child?.stdin.write(`${JSON.stringify({ command: "pause" })}\n`);
      session.status = "paused";
      await persist(session);
      return { session };
    }),
    resume: async () => serialize(async () => {
      const session = await activeSession();
      child?.stdin.write(`${JSON.stringify({ command: "resume" })}\n`);
      session.status = "recording";
      await persist(session);
      return { session };
    }),
    stop: async () => serialize(async () => {
      const session = await activeSession();
      await stopCapture();
      session.status = "draft";
      if (session.title === defaultRecordingTitle(session.createdAt)) {
        const apps = [...new Set(session.steps.flatMap(step => step.app ? [step.app] : []))].slice(0, 2);
        if (apps.length) session.title = redact(`${apps.join("、")} · ${session.steps.length} 步`).slice(0, 200);
      }
      await persist(session);
      return { session };
    }),
    review: async (input) => serialize(async () => {
      const session = await load(input.sessionId);
      if (session.status === "recording" || session.status === "paused") throw new Error("Stop the recording before reviewing it");
      if (input.title !== undefined) session.title = redact(text(input.title, "Title", 200));
      if (input.steps !== undefined) session.steps = normalizeSteps(input.steps);
      session.status = input.approved === true ? "reviewed" : "draft";
      await persist(session);
      current = session;
      return { session };
    }),
    "import-chrome": async (input) => serialize(async () => {
      if (child) throw new Error("Stop the active recording before importing another workflow");
      if ((await sessionEntries()).length >= 1_000) throw new Error("Session storage is full");
      const session = importChromeFlow(input.flow);
      await persist(session);
      current = session;
      lastError = null;
      return { session };
    }),
    compile: async (input) => serialize(async () => {
      const session = await load(input.sessionId);
      const compiled = compileSkill(session, {
        ...(input.skillName !== undefined ? { skillName: text(input.skillName, "Skill name", 64) } : {}),
        ...(input.description !== undefined ? { description: text(input.description, "Description", 500) } : {}),
        ...(input.skillContent !== undefined ? { skillContent: text(input.skillContent, "Skill content", 131_072) } : {}),
      });
      const { directory, version } = await exportDirectory(compiled.name);
      compiled.manifest.package.version = version;
      const manifestPath = await atomicWrite(directory, "ipollowork.plugin.json", JSON.stringify(compiled.manifest, null, 2));
      const skillPath = await atomicWrite(directory, `skills/${compiled.name}/SKILL.md`, compiled.skill);
      const workflowPath = await atomicWrite(directory, `skills/${compiled.name}/references/workflow.json`, JSON.stringify(compiled.workflow, null, 2));
      const archive = createArchive({ "ipollowork.plugin.json": JSON.stringify(compiled.manifest, null, 2), [`skills/${compiled.name}/SKILL.md`]: compiled.skill, [`skills/${compiled.name}/references/workflow.json`]: JSON.stringify(compiled.workflow, null, 2) });
      const archiveName = `${compiled.name}-${version}.ipollowork-plugin`;
      const archivePath = await atomicWrite(directory, archiveName, archive);
      return { directory, version, manifestPath, skillPath, workflowPath, archivePath, archiveName, archiveBase64: archive.toString("base64"), session, ...compiled };
    }),
    "open-workbench": async () => {
      if (disposed) throw new Error("Recorder service is disposed");
      if (workbenchUrl) return { url: workbenchUrl };
      if (workbenchOpening) return workbenchOpening;
      workbenchOpening = (async () => {
        const token = randomBytes(32).toString("hex");
        const instance = createServer((request, response) => { void handleHttp(request, response, token).catch((error) => { if (!response.headersSent) response.writeHead(400); response.end(JSON.stringify({ error: message(error) })); }); });
        server = instance;
        instance.requestTimeout = 10_000;
        instance.headersTimeout = 10_000;
        instance.keepAliveTimeout = 5_000;
        await new Promise<void>((done, reject) => { instance.once("error", reject); instance.listen(0, "127.0.0.1", done); });
        const address = instance.address();
        if (!address || typeof address === "string") throw new Error("Could not open the workbench");
        workbenchUrl = `http://127.0.0.1:${address.port}/#token=${token}`;
        return { url: workbenchUrl };
      })();
      try { return await workbenchOpening; }
      finally { workbenchOpening = null; }
    },
  };

  async function handleHttp(request: IncomingMessage, response: ServerResponse, token: string): Promise<void> {
    const address = server?.address();
    if (!address || typeof address === "string") throw new Error("Workbench unavailable");
    const origin = `http://127.0.0.1:${address.port}`;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'");
    if (request.headers.host !== `127.0.0.1:${address.port}` || (request.headers.origin !== undefined && request.headers.origin !== origin)) { response.writeHead(403); response.end(JSON.stringify({ error: "Cross-origin requests are forbidden" })); return; }
    const url = new URL(request.url ?? "/", origin);
    if (url.pathname.startsWith("/api/")) {
      const authorization = request.headers.authorization ?? "";
      const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      const expectedBuffer = Buffer.from(token);
      const providedBuffer = Buffer.from(provided);
      if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) { response.writeHead(401); response.end(JSON.stringify({ error: "Invalid workbench token" })); return; }
      if (request.method !== "POST" || request.headers["content-type"]?.split(";")[0] !== "application/json") { response.writeHead(415); response.end(JSON.stringify({ error: "Use POST with application/json" })); return; }
      if (Number(request.headers["content-length"]) > BODY_LIMIT) { response.writeHead(413); response.end(JSON.stringify({ error: "Request exceeds 1 MiB" })); return; }
      const handler = actions[url.pathname.slice(5)];
      if (!handler || url.pathname === "/api/open-workbench") { response.writeHead(404); response.end(JSON.stringify({ error: "Unknown action" })); return; }
      request.setTimeout(10_000, () => request.destroy());
      let body = "";
      for await (const chunk of request) {
        body += typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : "";
        if (Buffer.byteLength(body) > BODY_LIMIT) { response.writeHead(413); response.end(JSON.stringify({ error: "Request exceeds 1 MiB" })); return; }
      }
      const input: unknown = JSON.parse(body);
      if (!isRecord(input)) throw new Error("Action arguments must be an object");
      if (disposed) throw new Error("Recorder service is disposed");
      response.end(JSON.stringify(await handler(input)));
      return;
    }
    if (request.method !== "GET" || (url.pathname !== "/" && url.pathname !== "/app.js")) { response.writeHead(404); response.end(); return; }
    const file = join(uiDir, url.pathname === "/" ? "index.html" : "app.js");
    const content = await regularFile(file, BODY_LIMIT);
    response.setHeader("Content-Type", url.pathname === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8");
    response.end(content);
  }

  const publicActions: Record<string, ActionHandler> = {};
  for (const [name, handler] of Object.entries(actions)) publicActions[name] = async (input) => {
    if (disposed) throw new Error("Recorder service is disposed");
    return handler(input);
  };
  return {
    actions: publicActions,
    dispose: async () => {
      disposed = true;
      if (workbenchOpening) await workbenchOpening;
      await serialize(async () => {
        await stopCapture();
        if (current?.status === "recording" || current?.status === "paused") { current.status = "draft"; await persist(current); }
      });
      if (server) await new Promise<void>((done, reject) => { server?.close((error) => error ? reject(error) : done()); server?.closeAllConnections(); });
      server = null;
      workbenchUrl = null;
    },
  };
}

export default createRecorderService;
