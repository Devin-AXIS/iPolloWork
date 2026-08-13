// examples/plugin-packages/deepseek-harness/service/deepseek-harness.ts
import { randomUUID } from "node:crypto";
import { mkdir as mkdir3, readFile as readFile2, realpath as realpath2, rm as rm2, writeFile as writeFile2 } from "node:fs/promises";
import { resolve as resolve4, sep as sep2 } from "node:path";

// examples/plugin-packages/deepseek-harness/service/dsh-jsonrpc.ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function textBlocks(value) {
  if (!Array.isArray(value))
    return "";
  return value.flatMap((block) => {
    let item = record(block);
    return item?.type === "text" && typeof item.text === "string" ? [item.text] : [];
  }).join("");
}
function assistantMessageText(params, sessionId) {
  if (params.sessionId !== sessionId)
    return null;
  let event = record(params.event);
  if (event?.type !== "assistant/message")
    return null;
  let data = record(event.data), message = record(data?.message);
  if (message)
    return textBlocks(message.content);
  return textBlocks(data?.content);
}

class HarnessProcess {
  input;
  child;
  pending = /* @__PURE__ */ new Map;
  stderr = [];
  nextId = 1;
  closed = !1;
  idleResolve = null;
  idleReject = null;
  finalResponse = "";
  notificationCount = 0;
  subagentCount = 0;
  constructor(input) {
    this.input = input;
    this.child = spawn(input.command, input.args ?? [], {
      cwd: input.cwd,
      env: input.env,
      stdio: "pipe",
      detached: process.platform !== "win32"
    }), createInterface({ input: this.child.stdout }).on("line", (line) => this.handleLine(line)), createInterface({ input: this.child.stderr }).on("line", (line) => {
      if (this.stderr.push(line), this.stderr.length > 80)
        this.stderr.shift();
    }), this.child.once("error", (error) => this.fail(error)), this.child.once("exit", (code, signal) => {
      if (this.closed)
        return;
      this.fail(Error(`DeepSeek Harness runtime exited before completion (${signal ?? code ?? "unknown"})${this.diagnostics()}`));
    }), input.signal.addEventListener("abort", () => {
      this.fail(Error("DeepSeek Harness job was cancelled")), this.terminate();
    }, { once: !0 });
  }
  async run() {
    try {
      let initialize = {
        cwd: this.input.cwd,
        provider: this.input.provider,
        model: this.input.model
      };
      if (this.input.maxTokens !== void 0)
        initialize.maxTokens = this.input.maxTokens;
      await this.request("initialize", initialize);
      let idle = new Promise((resolve, reject) => {
        this.idleResolve = resolve, this.idleReject = reject;
      }), prompt = this.request("session/prompt", {
        sessionId: this.input.sessionId,
        contentBlocks: [{ type: "text", text: this.input.prompt }]
      });
      return await Promise.all([prompt, idle]), {
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
      return Promise.reject(Error("DeepSeek Harness runtime is closed"));
    let id = this.nextId++, response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    return this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...params ? { params } : {} })}
`), response;
  }
  handleLine(line) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    let message = record(value);
    if (!message)
      return;
    if (typeof message.id === "number") {
      let pending = this.pending.get(message.id);
      if (!pending)
        return;
      this.pending.delete(message.id);
      let error = record(message.error);
      if (error)
        pending.reject(Error(`DeepSeek Harness ${typeof error.message === "string" ? error.message : "request failed"}`));
      else
        pending.resolve(message.result);
      return;
    }
    if (typeof message.method !== "string")
      return;
    this.notificationCount += 1;
    let params = record(message.params) ?? {};
    if (message.method === "subagent.started")
      this.subagentCount += 1;
    if (message.method === "session.event") {
      let response = assistantMessageText(params, this.input.sessionId);
      if (response !== null)
        this.finalResponse = response;
    }
    if (message.method === "session.status" && params.sessionId === this.input.sessionId && params.status === "idle")
      this.idleResolve?.(), this.idleResolve = null, this.idleReject = null;
  }
  diagnostics() {
    return this.stderr.length ? `
${this.stderr.join(`
`)}` : "";
  }
  fail(error) {
    if (this.closed)
      return;
    for (let pending of this.pending.values())
      pending.reject(error);
    this.pending.clear(), this.idleReject?.(error), this.idleResolve = null, this.idleReject = null;
  }
  terminate() {
    if (this.child.exitCode !== null || this.child.signalCode !== null || this.child.pid === void 0)
      return;
    try {
      if (process.platform === "win32")
        this.child.kill("SIGTERM");
      else
        process.kill(-this.child.pid, "SIGTERM");
    } catch {
      this.child.kill("SIGTERM");
    }
    let pid = this.child.pid;
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
      this.closed = !0;
      return;
    }
    let shutdown = this.request("shutdown");
    await Promise.race([shutdown, new Promise((resolve) => setTimeout(resolve, 1000))]).catch(() => {
      return;
    }), this.closed = !0, this.child.stdin.end(), this.terminate();
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
import { spawn as spawn2 } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { finished } from "node:stream/promises";
var RECOMMENDED_DSH_RUNTIME_VERSION = "0.1.0rc6", PYPI_PROJECT = "deepseek-harness-runtime-bin", MAX_DOWNLOAD_BYTES = 134217728, MAX_COMMAND_OUTPUT_BYTES = 1048576;
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
  let normalized = version.trim();
  if (!/^\d+\.\d+\.\d+(?:(?:a|b|rc)\d+)?$/.test(normalized))
    throw Error("DSH runtime version must be a published PEP 440 release such as 0.1.0rc6");
  return normalized;
}
async function executable(path) {
  try {
    return await access(path, 1), !0;
  } catch {
    return !1;
  }
}
async function activeVersion(dataDir) {
  try {
    let parsed = JSON.parse(await readFile(resolve(runtimeRoot(dataDir), "active.json"), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return null;
    let version = Reflect.get(parsed, "version");
    return typeof version === "string" ? assertVersion(version) : null;
  } catch {
    return null;
  }
}
function managedBinaryPath(dataDir, version) {
  let name = binaryName();
  return name ? resolve(versionsRoot(dataDir), version, "deepseek_harness_runtime", "runtime", name) : null;
}
async function installedVersions(dataDir) {
  try {
    return (await readdir(versionsRoot(dataDir), { withFileTypes: !0 })).filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+(?:(?:a|b|rc)\d+)?$/.test(entry.name)).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}
async function managedRuntimeStatus(dataDir) {
  let version = await activeVersion(dataDir), path = version ? managedBinaryPath(dataDir, version) : null;
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
  let endpoint = version ? `https://pypi.org/pypi/${PYPI_PROJECT}/${encodeURIComponent(assertVersion(version))}/json` : `https://pypi.org/pypi/${PYPI_PROJECT}/json`, response = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok)
    throw Error(`Unable to resolve official DSH runtime metadata (${response.status})`);
  let payload = await response.json(), root = releaseRecord(payload), info = releaseRecord(root?.info), resolvedVersion = typeof info?.version === "string" ? assertVersion(info.version) : null, urls = Array.isArray(root?.urls) ? root.urls : [], tag = wheelTag();
  if (!resolvedVersion || !tag)
    throw Error("Managed DSH runtime is unavailable for this platform");
  for (let candidate of urls) {
    let item = releaseRecord(candidate), digests = releaseRecord(item?.digests);
    if (typeof item?.filename === "string" && item.filename.endsWith(tag) && typeof item.url === "string" && typeof digests?.sha256 === "string" && typeof item.size === "number")
      return {
        version: resolvedVersion,
        wheel: { filename: item.filename, url: item.url, sha256: digests.sha256, size: item.size }
      };
  }
  throw Error(`Official DSH runtime ${resolvedVersion} has no wheel for this platform`);
}
async function downloadWheel(release, destination) {
  if (release.size < 1 || release.size > MAX_DOWNLOAD_BYTES)
    throw Error("Official DSH runtime download size is outside the allowed range");
  let response = await fetch(release.url);
  if (!response.ok || !response.body)
    throw Error(`Unable to download official DSH runtime (${response.status})`);
  let declaredLength = Number(response.headers.get("content-length") ?? release.size);
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_DOWNLOAD_BYTES)
    throw Error("Official DSH runtime download is too large");
  let hash = createHash("sha256"), stream = createWriteStream(destination, { flags: "wx", mode: 384 }), reader = response.body.getReader(), written = 0;
  try {
    while (!0) {
      let chunk = await reader.read();
      if (chunk.done)
        break;
      if (written += chunk.value.byteLength, written > MAX_DOWNLOAD_BYTES)
        throw Error("Official DSH runtime download exceeded the allowed size");
      if (hash.update(chunk.value), !stream.write(chunk.value))
        await new Promise((resolveDrain) => stream.once("drain", resolveDrain));
    }
    stream.end(), await finished(stream);
  } catch (error) {
    throw stream.destroy(), error;
  }
  if (written !== release.size)
    throw Error(`Official DSH runtime download was incomplete (${written}/${release.size} bytes)`);
  if (hash.digest("hex") !== release.sha256)
    throw Error("Official DSH runtime checksum verification failed");
}
async function command(commandPath, args) {
  await new Promise((resolveCommand, rejectCommand) => {
    let child = spawn2(commandPath, args, { stdio: ["ignore", "pipe", "pipe"] }), chunks = [], outputBytes = 0, settled = !1, rejectOnce = (error) => {
      if (settled)
        return;
      settled = !0, child.kill("SIGKILL"), rejectCommand(error);
    }, collect = (chunk) => {
      if (outputBytes += chunk.byteLength, outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        rejectOnce(Error(`${basename(commandPath)} output exceeded ${MAX_COMMAND_OUTPUT_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on("data", collect), child.stderr.on("data", collect), child.once("error", rejectOnce), child.once("close", (code) => {
      if (settled)
        return;
      settled = !0;
      let output = Buffer.concat(chunks).toString("utf8").trim();
      if (code !== 0) {
        rejectCommand(Error(`${basename(commandPath)} failed (${code ?? "unknown"}): ${output}`));
        return;
      }
      resolveCommand();
    });
  });
}
async function activate(dataDir, version) {
  let path = managedBinaryPath(dataDir, version);
  if (!path || !await executable(path))
    throw Error(`DSH runtime ${version} is not installed correctly`);
  let root = runtimeRoot(dataDir);
  await mkdir(root, { recursive: !0, mode: 448 });
  let temporary = resolve(root, `active.${process.pid}.${Date.now()}.json`);
  return await writeFile(temporary, `${JSON.stringify({ version })}
`, { encoding: "utf8", mode: 384 }), await rename(temporary, resolve(root, "active.json")), { path, source: "managed", version };
}
async function latestOfficialRuntimeVersion() {
  return (await releaseMetadata()).version;
}
async function installManagedRuntime(dataDir, requestedVersion = RECOMMENDED_DSH_RUNTIME_VERSION) {
  let version = assertVersion(requestedVersion), existingPath = managedBinaryPath(dataDir, version);
  if (existingPath && await executable(existingPath))
    return activate(dataDir, version);
  let release = await releaseMetadata(version);
  if (release.version !== version)
    throw Error(`PyPI resolved DSH runtime ${release.version}, expected ${version}`);
  let root = runtimeRoot(dataDir), versions = versionsRoot(dataDir), staging = resolve(root, `.install-${version}-${process.pid}-${Date.now()}`), wheel = resolve(staging, release.wheel.filename), extracted = resolve(staging, "extracted");
  await mkdir(extracted, { recursive: !0, mode: 448 });
  try {
    await downloadWheel(release.wheel, wheel), await command("/usr/bin/unzip", ["-q", wheel, "-d", extracted]);
    let name = binaryName();
    if (!name)
      throw Error("Managed DSH runtime is unavailable for this platform");
    let runtimeDirectory = resolve(extracted, "deepseek_harness_runtime", "runtime"), runtimePath = resolve(runtimeDirectory, name);
    if (!await access(runtimePath).then(() => !0).catch(() => !1))
      throw Error("Official DSH runtime wheel did not contain its declared executable");
    await chmod(runtimePath, 493);
    let helper = `${runtimePath}-spawn-helper`;
    if (await access(helper).then(() => !0).catch(() => !1))
      await chmod(helper, 493);
    await mkdir(versions, { recursive: !0, mode: 448 });
    let target = resolve(versions, version);
    return await rm(target, { recursive: !0, force: !0 }), await rename(extracted, target), await activate(dataDir, version);
  } finally {
    await rm(staging, { recursive: !0, force: !0 });
  }
}
async function removeManagedRuntimes(dataDir) {
  await rm(runtimeRoot(dataDir), { recursive: !0, force: !0 });
}

// examples/plugin-packages/deepseek-harness/service/dsh-runtime.ts
var ENVIRONMENT_KEYS = [
  "DSH_RUNTIME_BIN",
  "DSH_CORDIS_CONFIG",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "IPOLLOWORK_API_KEY",
  "IPOLLOWORK_INFERENCE_BASE_URL"
], SAFE_CHILD_ENV = [
  "PATH",
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
  let platform = process.platform === "darwin" ? "macos" : process.platform === "linux" ? "linux" : null;
  if (!platform || process.arch !== "arm64" && process.arch !== "x64")
    return null;
  return `dsh-jsonrpc-agent-pkg-${platform}-${process.arch}`;
}
async function executable2(path) {
  try {
    return await access2(path, fsConstants.X_OK), !0;
  } catch {
    return !1;
  }
}
async function resolveRuntimeLocation(environment, dataDir) {
  let configured = await environment.get("DSH_RUNTIME_BIN");
  if (configured) {
    let path2 = resolve2(configured);
    if (await executable2(path2))
      return { path: path2, source: "environment" };
  }
  let managed = (await managedRuntimeStatus(dataDir)).active;
  if (managed)
    return managed;
  let name = runtimeBinaryName();
  if (!name)
    return null;
  let path = fileURLToPath(new URL(`../runtime/${name}`, import.meta.url));
  return await executable2(path) ? { path, source: "bundled" } : null;
}
async function readEnvironmentValues(environment) {
  return Object.fromEntries(await Promise.all(ENVIRONMENT_KEYS.map(async (key) => [key, await environment.get(key)])));
}
function assertProviderReady(provider, values) {
  if (provider === "deepseek-official") {
    if (!values.DEEPSEEK_API_KEY)
      throw Error("DeepSeek API key is not configured for this plugin");
    return;
  }
  if (provider === "ipollowork") {
    if (!values.IPOLLOWORK_API_KEY || !values.IPOLLOWORK_INFERENCE_BASE_URL)
      throw Error("The current iPolloWork model connection has no reusable API key and inference URL");
    return;
  }
  throw Error(`Provider ${provider} requires a custom DSH_CORDIS_CONFIG`);
}
function bundledCordisConfigPath() {
  return fileURLToPath(new URL("../cordis.yml", import.meta.url));
}
function sandboxProfile(mode, jobRoot, stateRoot, sourceRoot) {
  let escaped = (path) => quote(path).replaceAll("\\", "\\\\"), writable = mode === "review" ? [stateRoot] : [jobRoot];
  return [
    "(version 1)",
    "(allow default)",
    `(deny file-write* ${[.../* @__PURE__ */ new Set([homedir(), sourceRoot])].map((path) => `(subpath ${escaped(path)})`).join(" ")})`,
    `(allow file-write* (literal ${escaped("/dev/null")}))`,
    `(allow file-write* ${writable.map((path) => `(subpath ${escaped(path)})`).join(" ")})`
  ].join(" ");
}
function childEnvironment(base, values, input) {
  let env = {};
  for (let key of SAFE_CHILD_ENV)
    if (base[key])
      env[key] = base[key];
  for (let key of ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "IPOLLOWORK_API_KEY", "IPOLLOWORK_INFERENCE_BASE_URL"])
    if (values[key])
      env[key] = values[key] ?? void 0;
  return env.HOME = input.home, env.TMPDIR = resolve2(input.home, "tmp"), env.DSH_HOME = input.home, env.DSH_CWD = input.cwd, env.DSH_SESSION_ROOT = input.sessions, env.DSH_CORDIS_CONFIG = input.config, env.DSH_PERMISSION_MODE = input.mode === "review" ? "read-only" : "workspace-write", env.DSH_TOOL_MODE = input.mode === "code" ? "code" : "native", env.DSH_SYSTEM_PROMPT = input.mode === "review" ? "You are an independent code reviewer. Inspect deeply, do not modify files, and return concise findings with evidence." : "You are an independent coding subagent. Work only inside the isolated repository, verify changes, and report exactly what changed.", env.DSH_PROVIDER = input.provider, env.DSH_MODEL = input.model, env;
}
function promptForMode(prompt, mode) {
  if (mode === "review")
    return `Review the current repository without modifying it.

${prompt}`;
  return `Work in the isolated repository. Do not commit, publish, or contact the original workspace.

${prompt}`;
}

// examples/plugin-packages/deepseek-harness/service/isolated-git-workspace.ts
import { spawn as spawn3 } from "node:child_process";
import { copyFile, lstat, mkdir as mkdir2, readlink, realpath, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join as join2, relative, resolve as resolve3, sep } from "node:path";
var MAX_GIT_OUTPUT_BYTES = 16777216;
function command2(command3, args, cwd, input) {
  return new Promise((resolveResult, reject) => {
    let child = spawn3(command3, args, { cwd, stdio: "pipe" }), stdout = [], stderr = [], stdoutBytes = 0, stderrBytes = 0;
    if (child.stdout.on("data", (chunk) => {
      if (stdoutBytes += chunk.length, stdoutBytes > MAX_GIT_OUTPUT_BYTES) {
        child.kill("SIGKILL"), reject(Error(`${command3} output exceeded ${MAX_GIT_OUTPUT_BYTES} bytes`));
        return;
      }
      stdout.push(chunk);
    }), child.stderr.on("data", (chunk) => {
      if (stderrBytes += chunk.length, stderrBytes <= MAX_GIT_OUTPUT_BYTES)
        stderr.push(chunk);
    }), child.once("error", reject), child.once("exit", (code) => {
      if (code === 0)
        resolveResult({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
      else
        reject(Error(`${command3} ${args.join(" ")} failed (${code ?? "unknown"}): ${Buffer.concat(stderr).toString("utf8").trim()}`));
    }), input)
      child.stdin.end(input);
    else
      child.stdin.end();
  });
}
async function git(cwd, args, input) {
  return (await command2("git", args, cwd, input)).stdout;
}
function inside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}
async function copyUntracked(sourceRoot, targetRoot) {
  let paths = (await git(sourceRoot, ["ls-files", "--others", "--exclude-standard", "-z"])).toString("utf8").split("\x00").filter(Boolean);
  for (let path of paths) {
    if (isAbsolute(path))
      throw Error(`Git returned an absolute untracked path: ${path}`);
    let source = resolve3(sourceRoot, path), target = resolve3(targetRoot, path);
    if (!inside(sourceRoot, source) || !inside(targetRoot, target))
      throw Error(`Untracked path escaped the repository: ${path}`);
    await mkdir2(dirname(target), { recursive: !0 });
    let metadata = await lstat(source);
    if (metadata.isSymbolicLink())
      await symlink(await readlink(source), target);
    else if (metadata.isFile())
      await copyFile(source, target);
  }
}
async function prepareIsolatedWorkspace(sourceDirectory, destination) {
  let source = await realpath(resolve3(sourceDirectory)), gitRoot = await realpath((await git(source, ["rev-parse", "--show-toplevel"])).toString("utf8").trim()), sourceRelative = relative(gitRoot, source);
  if (sourceRelative.startsWith("..") || isAbsolute(sourceRelative))
    throw Error("Current directory is outside its Git worktree");
  let revision = (await git(gitRoot, ["rev-parse", "HEAD"])).toString("utf8").trim();
  await mkdir2(dirname(destination), { recursive: !0 }), await git(gitRoot, ["clone", "--shared", "--no-hardlinks", "--no-checkout", "--", gitRoot, destination]), await git(destination, ["checkout", "--detach", revision]);
  let dirtyPatch = await git(gitRoot, ["diff", "--binary", "--no-ext-diff", "HEAD", "--"]);
  if (dirtyPatch.length)
    await git(destination, ["apply", "--binary", "--whitespace=nowarn", "-"], dirtyPatch);
  await copyUntracked(gitRoot, destination), await git(destination, ["add", "-A"]), await git(destination, [
    "-c",
    "user.name=iPolloWork",
    "-c",
    "user.email=local@ipollowork.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "iPolloWork DSH isolated baseline"
  ]);
  let baseline = (await git(destination, ["rev-parse", "HEAD"])).toString("utf8").trim();
  return {
    root: destination,
    cwd: sourceRelative ? join2(destination, sourceRelative) : destination,
    baseline
  };
}
async function collectWorkspacePatch(workspace) {
  return await git(workspace.root, ["add", "-N", "-A"]), (await git(workspace.root, ["diff", "--binary", "--no-ext-diff", workspace.baseline, "--"])).toString("utf8");
}

// examples/plugin-packages/deepseek-harness/service/deepseek-harness.ts
var MAX_PATCH_CHUNK = 500000;
function record2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function requiredText(args, key, maximum) {
  let value = typeof args[key] === "string" ? args[key].trim() : "";
  if (!value)
    throw Error(`${key} is required`);
  if (value.length > maximum)
    throw Error(`${key} exceeds ${maximum} characters`);
  return value;
}
function optionalText(args, key, fallback, maximum) {
  let value = typeof args[key] === "string" ? args[key].trim() : "";
  if (value.length > maximum)
    throw Error(`${key} exceeds ${maximum} characters`);
  return value || fallback;
}
function modeValue(args) {
  let value = args.mode;
  if (value === void 0)
    return "standard";
  if (value === "standard" || value === "code" || value === "review")
    return value;
  throw Error("mode must be standard, code, or review");
}
function optionalPositiveInteger(args, key, maximum) {
  let value = args[key];
  if (value === void 0)
    return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum)
    throw Error(`${key} must be an integer between 1 and ${maximum}`);
  return value;
}
function inside2(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep2}`);
}
function publicJob(job, args) {
  let base = {
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
  let includePatch = args.includePatch !== !1, offset = typeof args.patchOffset === "number" && Number.isInteger(args.patchOffset) && args.patchOffset >= 0 ? args.patchOffset : 0, requestedLimit = typeof args.patchLimit === "number" && Number.isInteger(args.patchLimit) && args.patchLimit > 0 ? args.patchLimit : 200000, limit = Math.min(requestedLimit, MAX_PATCH_CHUNK), patch = includePatch ? job.result.patch.slice(offset, offset + limit) : void 0;
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
  let jobs = /* @__PURE__ */ new Map, jobsRoot = resolve4(runtime.storage.dataDir, "jobs"), runtimeMutation = Promise.resolve();
  function serializeRuntimeMutation(operation) {
    let result = runtimeMutation.then(operation, operation);
    return runtimeMutation = result.then(() => {
      return;
    }, () => {
      return;
    }), result;
  }
  function hasRunningJobs() {
    return [...jobs.values()].some((job) => job.state === "running");
  }
  async function environmentValues() {
    let values = await readEnvironmentValues(runtime.environment), credential = await runtime.authorization.getCredential("deepseek-api-key"), apiKey = credential?.apiKey?.trim(), baseUrl = credential?.baseUrl?.trim();
    return {
      ...values,
      DEEPSEEK_API_KEY: apiKey || values.DEEPSEEK_API_KEY,
      DEEPSEEK_BASE_URL: baseUrl || values.DEEPSEEK_BASE_URL
    };
  }
  async function installRuntime(version) {
    return serializeRuntimeMutation(async () => {
      let installed = await installManagedRuntime(runtime.storage.dataDir, version), status = await managedRuntimeStatus(runtime.storage.dataDir);
      return {
        installed: !0,
        active: installed,
        installedVersions: status.installedVersions,
        recommendedVersion: status.recommendedVersion
      };
    });
  }
  async function persist(job) {
    if (job.state === "running" || job.finishedAt === void 0)
      return;
    let stored = {
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
    }, directory = resolve4(jobsRoot, job.jobId);
    await mkdir3(directory, { recursive: !0, mode: 448 }), await writeFile2(resolve4(directory, "result.json"), `${JSON.stringify(stored)}
`, { encoding: "utf8", mode: 384 });
  }
  async function storedJob(jobId) {
    try {
      let parsed = JSON.parse(await readFile2(resolve4(jobsRoot, jobId, "result.json"), "utf8"));
      return record2(parsed)?.jobId === jobId ? parsed : null;
    } catch {
      return null;
    }
  }
  async function execute(job, runtimePath, values, maxTokens) {
    let requestedJobRoot = resolve4(jobsRoot, job.jobId);
    await mkdir3(requestedJobRoot, { recursive: !0, mode: 448 });
    let jobRoot = await realpath2(requestedJobRoot), workspaceRoot = resolve4(jobRoot, "workspace"), stateRoot = resolve4(jobRoot, "state"), sessionsRoot = resolve4(stateRoot, "sessions"), homeRoot = resolve4(stateRoot, "home");
    try {
      await mkdir3(homeRoot, { recursive: !0, mode: 448 }), await mkdir3(resolve4(homeRoot, "tmp"), { recursive: !0, mode: 448 }), await mkdir3(sessionsRoot, { recursive: !0, mode: 448 });
      let isolated = await prepareIsolatedWorkspace(job.sourceDirectory, workspaceRoot), configPath = values.DSH_CORDIS_CONFIG ? resolve4(values.DSH_CORDIS_CONFIG) : bundledCordisConfigPath(), env = childEnvironment(process.env, values, {
        cwd: isolated.cwd,
        home: homeRoot,
        sessions: sessionsRoot,
        config: configPath,
        mode: job.mode,
        provider: job.provider,
        model: job.model
      }), turn = await runHarnessTurn({
        command: "/usr/bin/sandbox-exec",
        args: ["-p", sandboxProfile(job.mode, jobRoot, stateRoot, job.sourceDirectory), "--", runtimePath],
        cwd: isolated.cwd,
        env,
        provider: job.provider,
        model: job.model,
        ...maxTokens === void 0 ? {} : { maxTokens },
        prompt: promptForMode(job.prompt, job.mode),
        sessionId: `ipollowork-${job.jobId}`,
        signal: job.abort.signal
      });
      job.result = { ...turn, patch: await collectWorkspacePatch(isolated) }, job.state = "completed";
    } catch (error) {
      if (job.abort.signal.aborted)
        job.state = "cancelled", job.error = "DeepSeek Harness job was cancelled";
      else
        job.state = "failed", job.error = error instanceof Error ? error.message : String(error);
    } finally {
      job.finishedAt = Date.now(), await rm2(workspaceRoot, { recursive: !0, force: !0 }), await persist(job);
    }
  }
  return {
    actions: {
      capabilities: async () => {
        let values = await environmentValues(), managed = await managedRuntimeStatus(runtime.storage.dataDir), location = await resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir);
        return {
          available: Boolean(location) && process.platform === "darwin" && await executable2("/usr/bin/sandbox-exec"),
          runtime: location ? { source: location.source, ...location.version ? { version: location.version } : {} } : null,
          runtimeManagement: {
            supported: !0,
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
            originalWorkspaceWrite: !1,
            gitClone: !0,
            macosSeatbelt: !0,
            uninstallDeletesData: !0
          }
        };
      },
      runtime_status: async () => {
        let [managed, latestVersion, location] = await Promise.all([
          managedRuntimeStatus(runtime.storage.dataDir),
          latestOfficialRuntimeVersion(),
          resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir)
        ]);
        return {
          active: location,
          managedActive: managed.active,
          installedVersions: managed.installedVersions,
          recommendedVersion: managed.recommendedVersion,
          latestVersion,
          updateAvailable: managed.active?.version !== latestVersion
        };
      },
      runtime_install: async (args) => {
        let version = optionalText(args, "version", RECOMMENDED_DSH_RUNTIME_VERSION, 64);
        return installRuntime(version);
      },
      runtime_update: async () => {
        let version = await latestOfficialRuntimeVersion();
        return installRuntime(version);
      },
      runtime_remove: async () => {
        if (hasRunningJobs())
          throw Error("Cannot remove the DSH runtime while jobs are running");
        return await serializeRuntimeMutation(() => removeManagedRuntimes(runtime.storage.dataDir)), { removed: !0 };
      },
      start: async (args, context) => {
        if (process.platform !== "darwin")
          throw Error("DeepSeek Harness plugin currently requires macOS Seatbelt isolation");
        if (!await executable2("/usr/bin/sandbox-exec"))
          throw Error("macOS sandbox-exec is unavailable");
        let prompt = requiredText(args, "prompt", 1e5), mode = modeValue(args), provider = optionalText(args, "provider", "deepseek-official", 100), model = optionalText(args, "model", provider === "deepseek-official" ? "deepseek-v4-flash" : "", 200);
        if (!model)
          throw Error("model is required for this provider");
        let maxTokens = optionalPositiveInteger(args, "maxTokens", 262144), values = await environmentValues();
        if (!values.DSH_CORDIS_CONFIG)
          assertProviderReady(provider, values);
        let location = await resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir);
        if (!location)
          await installRuntime(RECOMMENDED_DSH_RUNTIME_VERSION), location = await resolveRuntimeLocation(runtime.environment, runtime.storage.dataDir);
        if (!location)
          throw Error("DeepSeek Harness runtime installation did not produce an executable");
        let requestedDirectory = typeof context.directory === "string" && context.directory.trim() ? resolve4(context.directory) : runtime.workspace.root;
        if (!inside2(runtime.workspace.root, requestedDirectory))
          throw Error("DeepSeek Harness source directory is outside the active workspace");
        let jobId = randomUUID().replaceAll("-", ""), job = {
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
        return jobs.set(jobId, job), job.task = execute(job, location.path, values, maxTokens), { jobId, state: job.state, mode, provider, model, isolated: !0 };
      },
      status: async (args) => {
        let jobId = requiredText(args, "jobId", 64), active = jobs.get(jobId);
        if (active)
          return publicJob(active, args);
        let stored = await storedJob(jobId);
        if (!stored)
          throw Error(`DeepSeek Harness job not found: ${jobId}`);
        return publicJob(stored, args);
      },
      cancel: async (args) => {
        let jobId = requiredText(args, "jobId", 64), job = jobs.get(jobId);
        if (!job)
          return { jobId, cancelled: !1, reason: "not-running" };
        if (job.state !== "running")
          return { jobId, cancelled: !1, reason: job.state };
        return job.abort.abort(), await job.task, { jobId, cancelled: !0 };
      }
    },
    dispose: async () => {
      let running = [...jobs.values()].filter((job) => job.state === "running");
      for (let job of running)
        job.abort.abort();
      await Promise.all(running.map((job) => job.task));
    }
  };
}
export {
  createDeepSeekHarnessService as default
};
