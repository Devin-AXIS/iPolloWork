// examples/plugin-packages/deepseek-harness/service/deepseek-harness.ts
import { randomUUID } from "node:crypto";
import { mkdir as mkdir3, readFile as readFile2, realpath as realpath2, rm as rm2, writeFile as writeFile2 } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve as resolve4, sep as sep2 } from "node:path";

// examples/plugin-packages/deepseek-harness/service/dsh-headless.ts
import { spawn } from "node:child_process";
var MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
var MAX_ERROR_DETAIL_CHARS = 16000;
var MAX_WINDOWS_LINK_RETRIES = 8;
var MAX_TURN_DURATION_MS = 60 * 60 * 1000;
function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null)
    return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }, 2000).unref();
}
function runProcess(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, [...input.commandArgs, input.script, "--profile", "headless", "--patch", input.patch, input.prompt], {
      cwd: input.cwd,
      env: {
        ...input.env,
        ...process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}
      },
      windowsHide: true,
      stdio: "pipe"
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (operation) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timeout);
      input.signal.removeEventListener("abort", onAbort);
      operation();
    };
    const collect = (target, chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        terminate(child);
        finish(() => reject(new Error(`DeepSeek Harness output exceeded ${MAX_OUTPUT_BYTES} bytes`)));
        return;
      }
      target.push(chunk);
    };
    const onAbort = () => {
      terminate(child);
      finish(() => reject(new Error("DeepSeek Harness job was cancelled")));
    };
    const timeout = setTimeout(() => {
      terminate(child);
      finish(() => reject(new Error("DeepSeek Harness service did not respond within 60 minutes")));
    }, MAX_TURN_DURATION_MS);
    timeout.unref();
    input.signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => collect(stdout, chunk));
    child.stderr.on("data", (chunk) => collect(stderr, chunk));
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code) => finish(() => resolve({
      code,
      stdout: Buffer.concat(stdout).toString("utf8").trim(),
      stderr: Buffer.concat(stderr).toString("utf8").trim()
    })));
  });
}
function retryableWindowsLinkFailure(result) {
  return process.platform === "win32" && result.code !== 0 && result.stderr.includes("EBUSY") && result.stderr.includes("symlink");
}
function failureDetail(result) {
  const streams = [
    result.stderr ? `stderr:
${result.stderr}` : "",
    result.stdout ? `stdout:
${result.stdout}` : ""
  ].filter(Boolean);
  if (streams.length === 0) {
    return "DSH exited before producing a final response. The model may have reached its maxTokens limit or the provider may have rejected the request.";
  }
  return streams.join(`
`).slice(-MAX_ERROR_DETAIL_CHARS);
}
async function runHarnessHeadless(input) {
  if (input.signal.aborted)
    throw new Error("DeepSeek Harness job was cancelled");
  for (let attempt = 0;attempt < MAX_WINDOWS_LINK_RETRIES; attempt += 1) {
    const result = await runProcess(input);
    if (result.code === 0) {
      if (!result.stdout)
        throw new Error("DeepSeek Harness completed without a final response");
      return { finalResponse: result.stdout, notificationCount: 0, subagentCount: 0 };
    }
    if (retryableWindowsLinkFailure(result) && attempt + 1 < MAX_WINDOWS_LINK_RETRIES)
      continue;
    throw new Error(`DeepSeek Harness headless runtime failed (${result.code ?? "unknown"})
${failureDetail(result)}`);
  }
  throw new Error("DeepSeek Harness headless runtime could not initialize");
}

// examples/plugin-packages/deepseek-harness/service/dsh-jsonrpc.ts
import { spawn as spawn2 } from "node:child_process";
import { createInterface } from "node:readline";
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function textBlocks(value) {
  if (!Array.isArray(value))
    return "";
  return value.flatMap((block) => {
    const item = record(block);
    return item?.type === "text" && typeof item.text === "string" ? [item.text] : [];
  }).join("");
}
function assistantMessageText(params, sessionId) {
  if (params.sessionId !== sessionId)
    return null;
  const event = record(params.event);
  if (event?.type !== "assistant/message")
    return null;
  const data = record(event.data);
  const message = record(data?.message);
  if (message)
    return textBlocks(message.content);
  return textBlocks(data?.content);
}

class HarnessProcess {
  input;
  child;
  pending = new Map;
  stderr = [];
  nextId = 1;
  closed = false;
  idleResolve = null;
  idleReject = null;
  finalResponse = "";
  notificationCount = 0;
  subagentCount = 0;
  constructor(input) {
    this.input = input;
    this.child = spawn2(input.command, input.args ?? [], {
      cwd: input.cwd,
      env: input.env,
      stdio: "pipe",
      detached: process.platform !== "win32"
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => this.handleLine(line));
    createInterface({ input: this.child.stderr }).on("line", (line) => {
      this.stderr.push(line);
      if (this.stderr.length > 80)
        this.stderr.shift();
    });
    this.child.once("error", (error) => this.fail(error));
    this.child.once("exit", (code, signal) => {
      if (this.closed)
        return;
      this.fail(new Error(`DeepSeek Harness runtime exited before completion (${signal ?? code ?? "unknown"})${this.diagnostics()}`));
    });
    input.signal.addEventListener("abort", () => {
      this.fail(new Error("DeepSeek Harness job was cancelled"));
      this.terminate();
    }, { once: true });
  }
  async run() {
    try {
      const initialize = {
        cwd: this.input.cwd,
        provider: this.input.provider,
        model: this.input.model
      };
      if (this.input.maxTokens !== undefined)
        initialize.maxTokens = this.input.maxTokens;
      await this.request("initialize", initialize);
      const idle = new Promise((resolve, reject) => {
        this.idleResolve = resolve;
        this.idleReject = reject;
      });
      const prompt = this.request("session/prompt", {
        sessionId: this.input.sessionId,
        contentBlocks: [{ type: "text", text: this.input.prompt }]
      });
      await Promise.all([prompt, idle]);
      return {
        finalResponse: this.finalResponse,
        notificationCount: this.notificationCount,
        subagentCount: this.subagentCount
      };
    } finally {
      await this.close();
    }
  }
  request(method, params) {
    if (this.closed)
      return Promise.reject(new Error("DeepSeek Harness runtime is closed"));
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...params ? { params } : {} })}
`);
    return response;
  }
  handleLine(line) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    const message = record(value);
    if (!message)
      return;
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending)
        return;
      this.pending.delete(message.id);
      const error = record(message.error);
      if (error) {
        pending.reject(new Error(`DeepSeek Harness ${typeof error.message === "string" ? error.message : "request failed"}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message.method !== "string")
      return;
    this.notificationCount += 1;
    const params = record(message.params) ?? {};
    if (message.method === "subagent.started")
      this.subagentCount += 1;
    if (message.method === "session.event") {
      const response = assistantMessageText(params, this.input.sessionId);
      if (response !== null)
        this.finalResponse = response;
    }
    if (message.method === "session.status" && params.sessionId === this.input.sessionId && params.status === "idle") {
      this.idleResolve?.();
      this.idleResolve = null;
      this.idleReject = null;
    }
  }
  diagnostics() {
    return this.stderr.length ? `
${this.stderr.join(`
`)}` : "";
  }
  fail(error) {
    if (this.closed)
      return;
    for (const pending of this.pending.values())
      pending.reject(error);
    this.pending.clear();
    this.idleReject?.(error);
    this.idleResolve = null;
    this.idleReject = null;
  }
  terminate() {
    if (this.child.exitCode !== null || this.child.signalCode !== null || this.child.pid === undefined)
      return;
    try {
      if (process.platform === "win32")
        this.child.kill("SIGTERM");
      else
        process.kill(-this.child.pid, "SIGTERM");
    } catch {
      this.child.kill("SIGTERM");
    }
    const pid = this.child.pid;
    setTimeout(() => {
      if (this.child.exitCode !== null || this.child.signalCode !== null)
        return;
      try {
        if (process.platform === "win32")
          this.child.kill("SIGKILL");
        else
          process.kill(-pid, "SIGKILL");
      } catch {
        this.child.kill("SIGKILL");
      }
    }, 2000).unref();
  }
  async close() {
    if (this.closed)
      return;
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      this.closed = true;
      return;
    }
    const shutdown = this.request("shutdown");
    await Promise.race([shutdown, new Promise((resolve) => setTimeout(resolve, 1000))]).catch(() => {
      return;
    });
    this.closed = true;
    this.child.stdin.end();
    this.terminate();
  }
}
function runHarnessTurn(input) {
  return new HarnessProcess(input).run();
}

// examples/plugin-packages/deepseek-harness/service/dsh-runtime.ts
import { constants as fsConstants } from "node:fs";
import { access as access2 } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";

// examples/plugin-packages/deepseek-harness/service/runtime-manager.ts
import { createHash } from "node:crypto";
import { spawn as spawn3 } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { finished } from "node:stream/promises";
var RECOMMENDED_DSH_RUNTIME_VERSION = "0.1.0rc6";
var PYPI_PROJECT = "deepseek-harness-runtime-bin";
var MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
var MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
function runtimeRoot(dataDir) {
  return resolve(dataDir, "runtime");
}
function versionsRoot(dataDir) {
  return resolve(runtimeRoot(dataDir), "versions");
}
function binaryName() {
  if (process.platform === "darwin" && process.arch === "arm64")
    return "dsh-jsonrpc-agent-pkg-macos-arm64";
  if (process.platform === "linux" && process.arch === "arm64")
    return "dsh-jsonrpc-agent-pkg-linux-arm64";
  if (process.platform === "linux" && process.arch === "x64")
    return "dsh-jsonrpc-agent-pkg-linux-x64";
  return null;
}
function wheelTag() {
  if (process.platform === "darwin" && process.arch === "arm64")
    return "macosx_14_0_arm64.whl";
  if (process.platform === "linux" && process.arch === "arm64")
    return "manylinux_2_28_aarch64.whl";
  if (process.platform === "linux" && process.arch === "x64")
    return "manylinux_2_28_x86_64.whl";
  return null;
}
function assertVersion(version) {
  const normalized = version.trim();
  if (!/^\d+\.\d+\.\d+(?:(?:a|b|rc)\d+)?$/.test(normalized)) {
    throw new Error("DSH runtime version must be a published PEP 440 release such as 0.1.0rc6");
  }
  return normalized;
}
async function executable(path) {
  try {
    await access(path, 1);
    return true;
  } catch {
    return false;
  }
}
async function activeVersion(dataDir) {
  try {
    const parsed = JSON.parse(await readFile(resolve(runtimeRoot(dataDir), "active.json"), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return null;
    const version = Reflect.get(parsed, "version");
    return typeof version === "string" ? assertVersion(version) : null;
  } catch {
    return null;
  }
}
function managedBinaryPath(dataDir, version) {
  const name = binaryName();
  return name ? resolve(versionsRoot(dataDir), version, "deepseek_harness_runtime", "runtime", name) : null;
}
async function installedVersions(dataDir) {
  try {
    const entries = await readdir(versionsRoot(dataDir), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+(?:(?:a|b|rc)\d+)?$/.test(entry.name)).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}
async function managedRuntimeStatus(dataDir) {
  const version = await activeVersion(dataDir);
  const path = version ? managedBinaryPath(dataDir, version) : null;
  return {
    active: path && await executable(path) ? { path, source: "managed", version } : null,
    installedVersions: await installedVersions(dataDir),
    recommendedVersion: RECOMMENDED_DSH_RUNTIME_VERSION
  };
}
function releaseRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
async function releaseMetadata(version) {
  const endpoint = version ? `https://pypi.org/pypi/${PYPI_PROJECT}/${encodeURIComponent(assertVersion(version))}/json` : `https://pypi.org/pypi/${PYPI_PROJECT}/json`;
  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok)
    throw new Error(`Unable to resolve official DSH runtime metadata (${response.status})`);
  const payload = await response.json();
  const root = releaseRecord(payload);
  const info = releaseRecord(root?.info);
  const resolvedVersion = typeof info?.version === "string" ? assertVersion(info.version) : null;
  const urls = Array.isArray(root?.urls) ? root.urls : [];
  const tag = wheelTag();
  if (!resolvedVersion || !tag)
    throw new Error("Managed DSH runtime is unavailable for this platform");
  for (const candidate of urls) {
    const item = releaseRecord(candidate);
    const digests = releaseRecord(item?.digests);
    if (typeof item?.filename === "string" && item.filename.endsWith(tag) && typeof item.url === "string" && typeof digests?.sha256 === "string" && typeof item.size === "number") {
      return {
        version: resolvedVersion,
        wheel: { filename: item.filename, url: item.url, sha256: digests.sha256, size: item.size }
      };
    }
  }
  throw new Error(`Official DSH runtime ${resolvedVersion} has no wheel for this platform`);
}
async function downloadWheel(release, destination) {
  if (release.size < 1 || release.size > MAX_DOWNLOAD_BYTES)
    throw new Error("Official DSH runtime download size is outside the allowed range");
  const response = await fetch(release.url);
  if (!response.ok || !response.body)
    throw new Error(`Unable to download official DSH runtime (${response.status})`);
  const declaredLength = Number(response.headers.get("content-length") ?? release.size);
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_DOWNLOAD_BYTES)
    throw new Error("Official DSH runtime download is too large");
  const hash = createHash("sha256");
  const stream = createWriteStream(destination, { flags: "wx", mode: 384 });
  const reader = response.body.getReader();
  let written = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done)
        break;
      written += chunk.value.byteLength;
      if (written > MAX_DOWNLOAD_BYTES)
        throw new Error("Official DSH runtime download exceeded the allowed size");
      hash.update(chunk.value);
      if (!stream.write(chunk.value))
        await new Promise((resolveDrain) => stream.once("drain", resolveDrain));
    }
    stream.end();
    await finished(stream);
  } catch (error) {
    stream.destroy();
    throw error;
  }
  if (written !== release.size)
    throw new Error(`Official DSH runtime download was incomplete (${written}/${release.size} bytes)`);
  if (hash.digest("hex") !== release.sha256)
    throw new Error("Official DSH runtime checksum verification failed");
}
async function command(commandPath, args) {
  await new Promise((resolveCommand, rejectCommand) => {
    const child = spawn3(commandPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let outputBytes = 0;
    let settled = false;
    const rejectOnce = (error) => {
      if (settled)
        return;
      settled = true;
      child.kill("SIGKILL");
      rejectCommand(error);
    };
    const collect = (chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        rejectOnce(new Error(`${basename(commandPath)} output exceeded ${MAX_COMMAND_OUTPUT_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", rejectOnce);
    child.once("close", (code) => {
      if (settled)
        return;
      settled = true;
      const output = Buffer.concat(chunks).toString("utf8").trim();
      if (code !== 0) {
        rejectCommand(new Error(`${basename(commandPath)} failed (${code ?? "unknown"}): ${output}`));
        return;
      }
      resolveCommand();
    });
  });
}
async function activate(dataDir, version) {
  const path = managedBinaryPath(dataDir, version);
  if (!path || !await executable(path))
    throw new Error(`DSH runtime ${version} is not installed correctly`);
  const root = runtimeRoot(dataDir);
  await mkdir(root, { recursive: true, mode: 448 });
  const temporary = resolve(root, `active.${process.pid}.${Date.now()}.json`);
  await writeFile(temporary, `${JSON.stringify({ version })}
`, { encoding: "utf8", mode: 384 });
  await rename(temporary, resolve(root, "active.json"));
  return { path, source: "managed", version };
}
async function latestOfficialRuntimeVersion() {
  return (await releaseMetadata()).version;
}
async function installManagedRuntime(dataDir, requestedVersion = RECOMMENDED_DSH_RUNTIME_VERSION) {
  const version = assertVersion(requestedVersion);
  const existingPath = managedBinaryPath(dataDir, version);
  if (existingPath && await executable(existingPath))
    return activate(dataDir, version);
  const release = await releaseMetadata(version);
  if (release.version !== version)
    throw new Error(`PyPI resolved DSH runtime ${release.version}, expected ${version}`);
  const root = runtimeRoot(dataDir);
  const versions = versionsRoot(dataDir);
  const staging = resolve(root, `.install-${version}-${process.pid}-${Date.now()}`);
  const wheel = resolve(staging, release.wheel.filename);
  const extracted = resolve(staging, "extracted");
  await mkdir(extracted, { recursive: true, mode: 448 });
  try {
    await downloadWheel(release.wheel, wheel);
    await command("/usr/bin/unzip", ["-q", wheel, "-d", extracted]);
    const name = binaryName();
    if (!name)
      throw new Error("Managed DSH runtime is unavailable for this platform");
    const runtimeDirectory = resolve(extracted, "deepseek_harness_runtime", "runtime");
    const runtimePath = resolve(runtimeDirectory, name);
    if (!await access(runtimePath).then(() => true).catch(() => false))
      throw new Error("Official DSH runtime wheel did not contain its declared executable");
    await chmod(runtimePath, 493);
    const helper = `${runtimePath}-spawn-helper`;
    if (await access(helper).then(() => true).catch(() => false))
      await chmod(helper, 493);
    await mkdir(versions, { recursive: true, mode: 448 });
    const target = resolve(versions, version);
    await rm(target, { recursive: true, force: true });
    await rename(extracted, target);
    return await activate(dataDir, version);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
async function removeManagedRuntimes(dataDir) {
  await rm(runtimeRoot(dataDir), { recursive: true, force: true });
}

// examples/plugin-packages/deepseek-harness/service/dsh-runtime.ts
var ENVIRONMENT_KEYS = [
  "DSH_RUNTIME_BIN",
  "DSH_CORDIS_CONFIG",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "IPOLLOWORK_API_KEY",
  "IPOLLOWORK_INFERENCE_BASE_URL",
  "IPOLLOWORK_DSH_CLI",
  "IPOLLOWORK_DSH_CLI_VERSION"
];
var SAFE_CHILD_ENV = [
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
  "SSL_CERT_DIR"
];
function quote(value) {
  return JSON.stringify(value);
}
function runtimeBinaryName() {
  const platform = process.platform === "darwin" ? "macos" : process.platform === "linux" ? "linux" : null;
  if (!platform || process.arch !== "arm64" && process.arch !== "x64")
    return null;
  return `dsh-jsonrpc-agent-pkg-${platform}-${process.arch}`;
}
async function executable2(path) {
  try {
    await access2(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
async function readable(path) {
  try {
    await access2(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}
async function resolveRuntimeLocation(environment, dataDir) {
  const configured = await environment.get("DSH_RUNTIME_BIN");
  if (configured) {
    const path2 = resolve2(configured);
    if (await executable2(path2))
      return { path: path2, source: "environment", transport: "jsonrpc" };
  }
  if (process.platform === "win32" || process.platform === "darwin") {
    const configuredCli = await environment.get("IPOLLOWORK_DSH_CLI");
    if (configuredCli) {
      const path2 = resolve2(configuredCli);
      if (await readable(path2)) {
        const version = await environment.get("IPOLLOWORK_DSH_CLI_VERSION");
        return { path: path2, source: "bundled", transport: "headless", ...version ? { version } : {} };
      }
    }
    return null;
  }
  const managed = (await managedRuntimeStatus(dataDir)).active;
  if (managed)
    return { ...managed, transport: "jsonrpc" };
  const name = runtimeBinaryName();
  if (!name)
    return null;
  const path = fileURLToPath(new URL(`../runtime/${name}`, import.meta.url));
  return await executable2(path) ? { path, source: "bundled", transport: "jsonrpc" } : null;
}
async function readEnvironmentValues(environment) {
  return Object.fromEntries(await Promise.all(ENVIRONMENT_KEYS.map(async (key) => [key, await environment.get(key)])));
}
function assertProviderReady(provider, values) {
  if (provider === "deepseek-official") {
    if (!values.DEEPSEEK_API_KEY)
      throw new Error("DeepSeek API key is not configured for this plugin");
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
function bundledCordisConfigPath() {
  return fileURLToPath(new URL("../cordis.yml", import.meta.url));
}
function sandboxProfile(mode, jobRoot, stateRoot, sourceRoot, additionalWritableRoots = []) {
  const escaped = (path) => quote(path).replaceAll("\\", "\\\\");
  const writable = [...new Set([...mode === "review" ? [stateRoot] : [jobRoot], ...additionalWritableRoots])];
  const protectedRoots = [...new Set([homedir(), sourceRoot])];
  return [
    "(version 1)",
    "(allow default)",
    `(deny file-write* ${protectedRoots.map((path) => `(subpath ${escaped(path)})`).join(" ")})`,
    `(allow file-write* (literal ${escaped("/dev/null")}))`,
    `(allow file-write* ${writable.map((path) => `(subpath ${escaped(path)})`).join(" ")})`
  ].join(" ");
}
function childEnvironment(base, values, input) {
  const env = {};
  for (const key of SAFE_CHILD_ENV)
    if (base[key])
      env[key] = base[key];
  for (const key of ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "IPOLLOWORK_API_KEY", "IPOLLOWORK_INFERENCE_BASE_URL"]) {
    if (values[key])
      env[key] = values[key] ?? undefined;
  }
  env.HOME = input.home;
  env.USERPROFILE = input.home;
  env.APPDATA = resolve2(input.home, "appdata");
  env.LOCALAPPDATA = resolve2(input.home, "localappdata");
  env.TMPDIR = resolve2(input.home, "tmp");
  env.TMP = resolve2(input.home, "tmp");
  env.TEMP = resolve2(input.home, "tmp");
  env.DSH_HOME = input.dshHome;
  env.DSH_CWD = input.cwd;
  env.DSH_SESSION_ROOT = input.sessions;
  if (input.config)
    env.DSH_CORDIS_CONFIG = input.config;
  env.DSH_PERMISSION_MODE = input.mode === "review" ? "read-only" : "workspace-write";
  env.DSH_TOOL_MODE = input.mode === "code" ? "code" : "native";
  env.DSH_TOOLS_MODE = env.DSH_TOOL_MODE;
  env.DSH_SYSTEM_PROMPT = input.mode === "review" ? "You are an independent code reviewer. Inspect deeply, do not modify files, and return concise findings with evidence." : "You are an independent coding subagent. Work only inside the isolated repository, verify changes, and report exactly what changed.";
  env.DSH_PROVIDER = input.provider;
  env.DSH_MODEL = input.model;
  return env;
}
function promptForMode(prompt, mode) {
  if (mode === "review")
    return `Review the current repository without modifying it.

${prompt}`;
  return `Work in the isolated repository. Do not commit, publish, or contact the original workspace.

${prompt}`;
}

// examples/plugin-packages/deepseek-harness/service/isolated-git-workspace.ts
import { spawn as spawn4 } from "node:child_process";
import { copyFile, lstat, mkdir as mkdir2, readlink, realpath, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join as join2, relative, resolve as resolve3, sep } from "node:path";
var MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
function command2(command3, args, cwd, input, acceptedExitCodes = [0]) {
  return new Promise((resolveResult, reject) => {
    const child = spawn4(command3, args, { cwd, stdio: "pipe" });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_GIT_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        reject(new Error(`${command3} output exceeded ${MAX_GIT_OUTPUT_BYTES} bytes`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_GIT_OUTPUT_BYTES)
        stderr.push(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== null && acceptedExitCodes.includes(code))
        resolveResult({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
      else
        reject(new Error(`${command3} ${args.join(" ")} failed (${code ?? "unknown"}): ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
    if (input)
      child.stdin.end(input);
    else
      child.stdin.end();
  });
}
function gitArguments(args) {
  return process.platform === "win32" ? ["-c", "core.longpaths=true", ...args] : args;
}
async function git(cwd, args, input) {
  return (await command2("git", gitArguments(args), cwd, input)).stdout;
}
async function gitRevision(cwd) {
  const result = await command2("git", gitArguments(["rev-parse", "--verify", "--quiet", "HEAD"]), cwd, undefined, [0, 1]);
  return result.code === 0 ? result.stdout.toString("utf8").trim() : null;
}
function inside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}
async function copyWorkspaceFiles(sourceRoot, targetRoot, includeTracked) {
  const paths = (await git(sourceRoot, ["ls-files", ...includeTracked ? ["--cached"] : [], "--others", "--exclude-standard", "-z"])).toString("utf8").split("\x00").filter(Boolean);
  for (const path of paths) {
    if (isAbsolute(path))
      throw new Error(`Git returned an absolute untracked path: ${path}`);
    const source = resolve3(sourceRoot, path);
    const target = resolve3(targetRoot, path);
    if (!inside(sourceRoot, source) || !inside(targetRoot, target))
      throw new Error(`Untracked path escaped the repository: ${path}`);
    await mkdir2(dirname(target), { recursive: true });
    const metadata = await lstat(source);
    if (metadata.isSymbolicLink())
      await symlink(await readlink(source), target);
    else if (metadata.isFile())
      await copyFile(source, target);
  }
}
async function prepareIsolatedWorkspace(sourceDirectory, destination) {
  const source = await realpath(resolve3(sourceDirectory));
  const gitRoot = await realpath((await git(source, ["rev-parse", "--show-toplevel"])).toString("utf8").trim());
  const sourceRelative = relative(gitRoot, source);
  if (sourceRelative.startsWith("..") || isAbsolute(sourceRelative))
    throw new Error("Current directory is outside its Git worktree");
  const revision = await gitRevision(gitRoot);
  await mkdir2(dirname(destination), { recursive: true });
  if (revision) {
    await git(gitRoot, ["clone", "--shared", "--no-hardlinks", "--no-checkout", "--", gitRoot, destination]);
    await git(destination, ["checkout", "--detach", revision]);
    const dirtyPatch = await git(gitRoot, ["diff", "--binary", "--no-ext-diff", "HEAD", "--"]);
    if (dirtyPatch.length)
      await git(destination, ["apply", "--binary", "--whitespace=nowarn", "-"], dirtyPatch);
  } else {
    await mkdir2(destination, { recursive: true });
    await git(destination, ["init"]);
  }
  if (process.platform === "win32")
    await git(destination, ["config", "core.longpaths", "true"]);
  await copyWorkspaceFiles(gitRoot, destination, revision === null);
  await git(destination, ["add", "-A"]);
  await git(destination, [
    "-c",
    "user.name=iPolloWork",
    "-c",
    "user.email=local@ipollowork.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "iPolloWork DSH isolated baseline"
  ]);
  const baseline = (await git(destination, ["rev-parse", "HEAD"])).toString("utf8").trim();
  const cwd = sourceRelative ? join2(destination, sourceRelative) : destination;
  await mkdir2(cwd, { recursive: true });
  return {
    root: destination,
    cwd,
    baseline
  };
}
async function collectWorkspacePatch(workspace) {
  await git(workspace.root, ["add", "-N", "-A"]);
  return (await git(workspace.root, ["diff", "--binary", "--no-ext-diff", workspace.baseline, "--"])).toString("utf8");
}

// examples/plugin-packages/deepseek-harness/service/deepseek-harness.ts
var MAX_PATCH_CHUNK = 500000;
var MIN_MODEL_OUTPUT_TOKENS = 1024;
var BUNDLED_HEADLESS_PLATFORM = process.platform === "win32" || process.platform === "darwin";
function record2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function requiredText(args, key, maximum) {
  const value = typeof args[key] === "string" ? args[key].trim() : "";
  if (!value)
    throw new Error(`${key} is required`);
  if (value.length > maximum)
    throw new Error(`${key} exceeds ${maximum} characters`);
  return value;
}
function optionalText(args, key, fallback, maximum) {
  const value = typeof args[key] === "string" ? args[key].trim() : "";
  if (value.length > maximum)
    throw new Error(`${key} exceeds ${maximum} characters`);
  return value || fallback;
}
function modeValue(args) {
  const value = args.mode;
  if (value === undefined)
    return "standard";
  if (value === "standard" || value === "code" || value === "review")
    return value;
  throw new Error("mode must be standard, code, or review");
}
function optionalInteger(args, key, minimum, maximum) {
  const value = args[key];
  if (value === undefined)
    return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
function inside2(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep2}`);
}
function headlessPatch(provider, model, maxTokens, values, sessionsRoot) {
  const entries = [
    { id: "agent-default-model", config: { provider, model } },
    { id: "session-persistence-jsonl", config: { root: sessionsRoot } }
  ];
  if (provider === "deepseek-official" && (maxTokens !== undefined || values.DEEPSEEK_BASE_URL)) {
    entries.push({
      id: "llm-deepseek",
      config: {
        apiKeyEnv: "DEEPSEEK_API_KEY",
        ...values.DEEPSEEK_BASE_URL ? { baseURL: values.DEEPSEEK_BASE_URL } : {},
        thinking: "enabled",
        reasoningEffort: "max",
        ...maxTokens === undefined ? {} : { maxTokens }
      }
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
              contextWindow: 128000,
              ...maxTokens === undefined ? {} : { maxTokens }
            }]
          }
        }
      }
    });
  }
  return `${JSON.stringify(entries, null, 2)}
`;
}
function publicJob(job, args) {
  const base = {
    jobId: job.jobId,
    state: job.state,
    mode: job.mode,
    provider: job.provider,
    model: job.model,
    sourceDirectory: job.sourceDirectory,
    startedAt: job.startedAt,
    ...job.finishedAt ? { finishedAt: job.finishedAt } : {},
    ...job.error ? { error: job.error } : {}
  };
  if (!job.result)
    return base;
  const includePatch = args.includePatch !== false;
  const offset = typeof args.patchOffset === "number" && Number.isInteger(args.patchOffset) && args.patchOffset >= 0 ? args.patchOffset : 0;
  const requestedLimit = typeof args.patchLimit === "number" && Number.isInteger(args.patchLimit) && args.patchLimit > 0 ? args.patchLimit : 200000;
  const limit = Math.min(requestedLimit, MAX_PATCH_CHUNK);
  const patch = includePatch ? job.result.patch.slice(offset, offset + limit) : undefined;
  return {
    ...base,
    result: {
      finalResponse: job.result.finalResponse,
      notificationCount: job.result.notificationCount,
      subagentCount: job.result.subagentCount,
      patchLength: job.result.patch.length,
      ...includePatch ? { patch, patchOffset: offset, patchHasMore: offset + (patch?.length ?? 0) < job.result.patch.length } : {}
    }
  };
}
async function createDeepSeekHarnessService(runtime) {
  const jobs = new Map;
  const jobsRoot = resolve4(runtime.storage.dataDir, "jobs");
  let runtimeMutation = Promise.resolve();
  function serializeRuntimeMutation(operation) {
    const result = runtimeMutation.then(operation, operation);
    runtimeMutation = result.then(() => {
      return;
    }, () => {
      return;
    });
    return result;
  }
  function hasRunningJobs() {
    return [...jobs.values()].some((job) => job.state === "running");
  }
  async function environmentValues() {
    const values = await readEnvironmentValues(runtime.environment);
    const credential = await runtime.authorization.getCredential("deepseek-api-key");
    const apiKey = credential?.apiKey?.trim();
    const baseUrl = credential?.baseUrl?.trim();
    return {
      ...values,
      DEEPSEEK_API_KEY: apiKey || values.DEEPSEEK_API_KEY,
      DEEPSEEK_BASE_URL: baseUrl || values.DEEPSEEK_BASE_URL
    };
  }
  async function installRuntime(version) {
    return serializeRuntimeMutation(async () => {
      const installed = await installManagedRuntime(runtime.storage.dataDir, version);
      const status = await managedRuntimeStatus(runtime.storage.dataDir);
      return {
        installed: true,
        active: installed,
        installedVersions: status.installedVersions,
        recommendedVersion: status.recommendedVersion
      };
    });
  }
  async function persist(job) {
    if (job.state === "running" || job.finishedAt === undefined)
      return;
    const stored = {
      jobId: job.jobId,
      state: job.state,
      mode: job.mode,
      provider: job.provider,
      model: job.model,
      sourceDirectory: job.sourceDirectory,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      ...job.result ? { result: job.result } : {},
      ...job.error ? { error: job.error } : {}
    };
    const directory = resolve4(jobsRoot, job.jobId);
    await mkdir3(directory, { recursive: true, mode: 448 });
    await writeFile2(resolve4(directory, "result.json"), `${JSON.stringify(stored)}
`, { encoding: "utf8", mode: 384 });
  }
  async function storedJob(jobId) {
    try {
      const parsed = JSON.parse(await readFile2(resolve4(jobsRoot, jobId, "result.json"), "utf8"));
      const value = record2(parsed);
      return value?.jobId === jobId ? parsed : null;
    } catch {
      return null;
    }
  }
  async function execute(job, location, values, maxTokens) {
    const requestedExecutionRoot = resolve4(tmpdir(), "ipollowork-dsh", job.jobId);
    await mkdir3(requestedExecutionRoot, { recursive: true, mode: 448 });
    const executionRoot = await realpath2(requestedExecutionRoot);
    const workspaceRoot = resolve4(executionRoot, "workspace");
    const stateRoot = resolve4(executionRoot, "state");
    const sessionsRoot = resolve4(stateRoot, "sessions");
    const homeRoot = resolve4(stateRoot, "home");
    const dshHome = resolve4(runtime.storage.dataDir, "dsh-home");
    try {
      await mkdir3(homeRoot, { recursive: true, mode: 448 });
      await mkdir3(resolve4(homeRoot, "tmp"), { recursive: true, mode: 448 });
      await mkdir3(resolve4(homeRoot, "appdata"), { recursive: true, mode: 448 });
      await mkdir3(resolve4(homeRoot, "localappdata"), { recursive: true, mode: 448 });
      await mkdir3(sessionsRoot, { recursive: true, mode: 448 });
      await mkdir3(dshHome, { recursive: true, mode: 448 });
      const isolated = await prepareIsolatedWorkspace(job.sourceDirectory, workspaceRoot);
      const configPath = location.transport === "jsonrpc" && values.DSH_CORDIS_CONFIG ? resolve4(values.DSH_CORDIS_CONFIG) : location.transport === "jsonrpc" ? bundledCordisConfigPath() : undefined;
      const env = childEnvironment(process.env, values, {
        cwd: isolated.cwd,
        home: homeRoot,
        dshHome,
        sessions: sessionsRoot,
        config: configPath,
        mode: job.mode,
        provider: job.provider,
        model: job.model
      });
      const prompt = promptForMode(job.prompt, job.mode);
      let turn;
      if (location.transport === "headless") {
        const patchPath = resolve4(stateRoot, "ipollowork.patch.yml");
        await writeFile2(patchPath, headlessPatch(job.provider, job.model, maxTokens, values, sessionsRoot), { encoding: "utf8", mode: 384 });
        const useMacSandbox = process.platform === "darwin";
        turn = await runHarnessHeadless({
          command: useMacSandbox ? "/usr/bin/sandbox-exec" : process.execPath,
          commandArgs: useMacSandbox ? ["-p", sandboxProfile(job.mode, executionRoot, stateRoot, job.sourceDirectory, [dshHome]), "--", process.execPath] : [],
          script: location.path,
          cwd: isolated.cwd,
          env,
          patch: patchPath,
          prompt,
          signal: job.abort.signal
        });
      } else {
        const useMacSandbox = process.platform === "darwin";
        const useNodeScript = process.platform === "win32" && /\.[cm]?js$/i.test(location.path);
        turn = await runHarnessTurn({
          command: useMacSandbox ? "/usr/bin/sandbox-exec" : useNodeScript ? process.execPath : location.path,
          args: useMacSandbox ? ["-p", sandboxProfile(job.mode, executionRoot, stateRoot, job.sourceDirectory, [dshHome]), "--", location.path] : useNodeScript ? [location.path] : [],
          cwd: isolated.cwd,
          env: {
            ...env,
            ...useNodeScript && process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}
          },
          provider: job.provider,
          model: job.model,
          ...maxTokens === undefined ? {} : { maxTokens },
          prompt,
          sessionId: `ipollowork-${job.jobId}`,
          signal: job.abort.signal
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
      await rm2(executionRoot, { recursive: true, force: true });
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
        const macSandboxAvailable = process.platform !== "darwin" || await executable2("/usr/bin/sandbox-exec");
        const available = Boolean(location) && macSandboxAvailable;
        const message = available ? "DSH service is ready" : !location && BUNDLED_HEADLESS_PLATFORM ? "The bundled DSH CLI is missing. Reinstall iPolloWork and try again" : !location ? "The DeepSeek Harness runtime is unavailable" : "The DeepSeek Harness sandbox is unavailable";
        return {
          available,
          serviceStatus: available ? "ready" : "unavailable",
          message,
          platform: process.platform,
          runtime: location ? { source: location.source, transport: location.transport, ...location.version ? { version: location.version } : {} } : null,
          runtimeManagement: {
            supported: !BUNDLED_HEADLESS_PLATFORM && location?.transport !== "headless",
            recommendedVersion: managed.recommendedVersion,
            installedVersions: managed.installedVersions,
            managedActiveVersion: managed.active?.version ?? null
          },
          modes: ["standard", "code", "review"],
          providers: {
            deepseekOfficial: Boolean(values.DEEPSEEK_API_KEY),
            ipollowork: Boolean(values.IPOLLOWORK_API_KEY && values.IPOLLOWORK_INFERENCE_BASE_URL),
            customConfig: Boolean(values.DSH_CORDIS_CONFIG)
          },
          isolation: {
            originalWorkspaceWrite: false,
            gitClone: true,
            macosSeatbelt: process.platform === "darwin" && macSandboxAvailable,
            windowsPwshSandbox: process.platform === "win32" && location?.transport === "headless",
            uninstallDeletesData: true
          }
        };
      },
      runtime_status: async () => {
        const [managed, location] = await Promise.all([
          managedRuntimeStatus(runtime.storage.dataDir),
          resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir)
        ]);
        const latestVersion = BUNDLED_HEADLESS_PLATFORM ? location?.version ?? null : await latestOfficialRuntimeVersion();
        return {
          active: location,
          managedActive: managed.active,
          installedVersions: managed.installedVersions,
          recommendedVersion: managed.recommendedVersion,
          latestVersion,
          updateAvailable: BUNDLED_HEADLESS_PLATFORM ? false : managed.active?.version !== latestVersion
        };
      },
      runtime_install: async (args) => {
        const active = await resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir);
        if (active?.transport === "headless") {
          return { installed: false, active, installedVersions: [], recommendedVersion: active.version ?? null };
        }
        if (BUNDLED_HEADLESS_PLATFORM)
          throw new Error("The bundled DSH CLI is unavailable");
        const version = optionalText(args, "version", RECOMMENDED_DSH_RUNTIME_VERSION, 64);
        return installRuntime(version);
      },
      runtime_update: async () => {
        const active = await resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir);
        if (active?.transport === "headless") {
          return { installed: false, active, installedVersions: [], recommendedVersion: active.version ?? null };
        }
        if (BUNDLED_HEADLESS_PLATFORM)
          throw new Error("The bundled DSH CLI is unavailable");
        const version = await latestOfficialRuntimeVersion();
        return installRuntime(version);
      },
      runtime_remove: async () => {
        if (hasRunningJobs())
          throw new Error("Cannot remove the DSH runtime while jobs are running");
        const active = await resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir);
        if (BUNDLED_HEADLESS_PLATFORM)
          return { removed: false, reason: active?.transport === "headless" ? "bundled" : "external" };
        await serializeRuntimeMutation(() => removeManagedRuntimes(runtime.storage.dataDir));
        return { removed: true };
      },
      start: async (args, context) => {
        const prompt = requiredText(args, "prompt", 1e5);
        const mode = modeValue(args);
        const provider = optionalText(args, "provider", "deepseek-official", 100);
        const model = optionalText(args, "model", provider === "deepseek-official" ? "deepseek-v4-flash" : "", 200);
        if (!model)
          throw new Error("model is required for this provider");
        const maxTokens = optionalInteger(args, "maxTokens", MIN_MODEL_OUTPUT_TOKENS, 262144);
        const values = await environmentValues();
        if (!values.DSH_CORDIS_CONFIG)
          assertProviderReady(provider, values);
        const location = await resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir);
        if (!location) {
          if (BUNDLED_HEADLESS_PLATFORM)
            throw new Error("DeepSeek Harness service is unavailable because the bundled DSH CLI is missing. Reinstall iPolloWork and try again");
          throw new Error("DeepSeek Harness runtime installation did not produce an executable");
        }
        if (location.transport === "headless" && values.DSH_CORDIS_CONFIG) {
          throw new Error("Custom DSH_CORDIS_CONFIG is not supported by the bundled headless runtime");
        }
        if (process.platform === "darwin" && !await executable2("/usr/bin/sandbox-exec")) {
          throw new Error("macOS sandbox-exec is unavailable");
        }
        if (location.transport === "jsonrpc" && process.platform !== "darwin" && location.source !== "environment") {
          throw new Error("The managed DSH JSON-RPC runtime requires macOS Seatbelt isolation");
        }
        const requestedDirectory = typeof context.directory === "string" && context.directory.trim() ? resolve4(context.directory) : runtime.workspace.root;
        if (!inside2(runtime.workspace.root, requestedDirectory))
          throw new Error("DeepSeek Harness source directory is outside the active workspace");
        const jobId = randomUUID().replaceAll("-", "");
        const job = {
          jobId,
          state: "running",
          mode,
          provider,
          model,
          sourceDirectory: requestedDirectory,
          startedAt: Date.now(),
          abort: new AbortController,
          prompt
        };
        jobs.set(jobId, job);
        job.task = execute(job, location, values, maxTokens);
        return { jobId, state: job.state, mode, provider, model, isolated: true };
      },
      status: async (args) => {
        const jobId = requiredText(args, "jobId", 64);
        const active = jobs.get(jobId);
        if (active)
          return publicJob(active, args);
        const stored = await storedJob(jobId);
        if (!stored)
          throw new Error(`DeepSeek Harness job not found: ${jobId}`);
        return publicJob(stored, args);
      },
      cancel: async (args) => {
        const jobId = requiredText(args, "jobId", 64);
        const job = jobs.get(jobId);
        if (!job)
          return { jobId, cancelled: false, reason: "not-running" };
        if (job.state !== "running")
          return { jobId, cancelled: false, reason: job.state };
        job.abort.abort();
        await job.task;
        return { jobId, cancelled: true };
      }
    },
    dispose: async () => {
      const running = [...jobs.values()].filter((job) => job.state === "running");
      for (const job of running)
        job.abort.abort();
      await Promise.all(running.map((job) => job.task));
    }
  };
}
export {
  createDeepSeekHarnessService as default
};
