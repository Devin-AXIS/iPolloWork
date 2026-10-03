import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { finished } from "node:stream/promises";

export const RECOMMENDED_DSH_RUNTIME_VERSION = "0.1.0rc6";

const PYPI_PROJECT = "deepseek-harness-runtime-bin";
const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;

export type ManagedRuntime = {
  path: string;
  source: "managed";
  version: string;
};

type RuntimeStatus = {
  active: ManagedRuntime | null;
  installedVersions: string[];
  recommendedVersion: string;
};

type WheelRelease = {
  filename: string;
  url: string;
  sha256: string;
  size: number;
};

function runtimeRoot(dataDir: string): string {
  return resolve(dataDir, "runtime");
}

function versionsRoot(dataDir: string): string {
  return resolve(runtimeRoot(dataDir), "versions");
}

function binaryName(): string | null {
  if (process.platform === "darwin" && process.arch === "arm64") return "dsh-jsonrpc-agent-pkg-macos-arm64";
  if (process.platform === "linux" && process.arch === "arm64") return "dsh-jsonrpc-agent-pkg-linux-arm64";
  if (process.platform === "linux" && process.arch === "x64") return "dsh-jsonrpc-agent-pkg-linux-x64";
  return null;
}

function wheelTag(): string | null {
  if (process.platform === "darwin" && process.arch === "arm64") return "macosx_14_0_arm64.whl";
  if (process.platform === "linux" && process.arch === "arm64") return "manylinux_2_28_aarch64.whl";
  if (process.platform === "linux" && process.arch === "x64") return "manylinux_2_28_x86_64.whl";
  return null;
}

function assertVersion(version: string): string {
  const normalized = version.trim();
  if (!/^\d+\.\d+\.\d+(?:(?:a|b|rc)\d+)?$/.test(normalized)) {
    throw new Error("DSH runtime version must be a published PEP 440 release such as 0.1.0rc6");
  }
  return normalized;
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, 1);
    return true;
  } catch {
    return false;
  }
}

async function activeVersion(dataDir: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(resolve(runtimeRoot(dataDir), "active.json"), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const version = Reflect.get(parsed, "version");
    return typeof version === "string" ? assertVersion(version) : null;
  } catch {
    return null;
  }
}

function managedBinaryPath(dataDir: string, version: string): string | null {
  const name = binaryName();
  return name ? resolve(versionsRoot(dataDir), version, "deepseek_harness_runtime", "runtime", name) : null;
}

async function installedVersions(dataDir: string): Promise<string[]> {
  try {
    const entries = await readdir(versionsRoot(dataDir), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+(?:(?:a|b|rc)\d+)?$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export async function managedRuntimeStatus(dataDir: string): Promise<RuntimeStatus> {
  const version = await activeVersion(dataDir);
  const path = version ? managedBinaryPath(dataDir, version) : null;
  return {
    active: path && await executable(path) ? { path, source: "managed", version } : null,
    installedVersions: await installedVersions(dataDir),
    recommendedVersion: RECOMMENDED_DSH_RUNTIME_VERSION,
  };
}

function releaseRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function releaseMetadata(version?: string): Promise<{ version: string; wheel: WheelRelease }> {
  const endpoint = version
    ? `https://pypi.org/pypi/${PYPI_PROJECT}/${encodeURIComponent(assertVersion(version))}/json`
    : `https://pypi.org/pypi/${PYPI_PROJECT}/json`;
  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Unable to resolve official DSH runtime metadata (${response.status})`);
  const payload: unknown = await response.json();
  const root = releaseRecord(payload);
  const info = releaseRecord(root?.info);
  const resolvedVersion = typeof info?.version === "string" ? assertVersion(info.version) : null;
  const urls = Array.isArray(root?.urls) ? root.urls : [];
  const tag = wheelTag();
  if (!resolvedVersion || !tag) throw new Error("Managed DSH runtime is unavailable for this platform");
  for (const candidate of urls) {
    const item = releaseRecord(candidate);
    const digests = releaseRecord(item?.digests);
    if (
      typeof item?.filename === "string"
      && item.filename.endsWith(tag)
      && typeof item.url === "string"
      && typeof digests?.sha256 === "string"
      && typeof item.size === "number"
    ) {
      return {
        version: resolvedVersion,
        wheel: { filename: item.filename, url: item.url, sha256: digests.sha256, size: item.size },
      };
    }
  }
  throw new Error(`Official DSH runtime ${resolvedVersion} has no wheel for this platform`);
}

async function downloadWheel(release: WheelRelease, destination: string): Promise<void> {
  if (release.size < 1 || release.size > MAX_DOWNLOAD_BYTES) throw new Error("Official DSH runtime download size is outside the allowed range");
  const response = await fetch(release.url);
  if (!response.ok || !response.body) throw new Error(`Unable to download official DSH runtime (${response.status})`);
  const declaredLength = Number(response.headers.get("content-length") ?? release.size);
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_DOWNLOAD_BYTES) throw new Error("Official DSH runtime download is too large");
  const hash = createHash("sha256");
  const stream = createWriteStream(destination, { flags: "wx", mode: 0o600 });
  const reader = response.body.getReader();
  let written = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      written += chunk.value.byteLength;
      if (written > MAX_DOWNLOAD_BYTES) throw new Error("Official DSH runtime download exceeded the allowed size");
      hash.update(chunk.value);
      if (!stream.write(chunk.value)) await new Promise<void>((resolveDrain) => stream.once("drain", resolveDrain));
    }
    stream.end();
    await finished(stream);
  } catch (error) {
    stream.destroy();
    throw error;
  }
  if (written !== release.size) throw new Error(`Official DSH runtime download was incomplete (${written}/${release.size} bytes)`);
  if (hash.digest("hex") !== release.sha256) throw new Error("Official DSH runtime checksum verification failed");
}

async function command(commandPath: string, args: string[]): Promise<void> {
  await new Promise<void>((resolveCommand, rejectCommand) => {
    const child = spawn(commandPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      rejectCommand(error);
    };
    const collect = (chunk: Buffer) => {
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
      if (settled) return;
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

async function activate(dataDir: string, version: string): Promise<ManagedRuntime> {
  const path = managedBinaryPath(dataDir, version);
  if (!path || !await executable(path)) throw new Error(`DSH runtime ${version} is not installed correctly`);
  const root = runtimeRoot(dataDir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const temporary = resolve(root, `active.${process.pid}.${Date.now()}.json`);
  await writeFile(temporary, `${JSON.stringify({ version })}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, resolve(root, "active.json"));
  return { path, source: "managed", version };
}

export async function latestOfficialRuntimeVersion(): Promise<string> {
  return (await releaseMetadata()).version;
}

export async function installManagedRuntime(dataDir: string, requestedVersion = RECOMMENDED_DSH_RUNTIME_VERSION): Promise<ManagedRuntime> {
  const version = assertVersion(requestedVersion);
  const existingPath = managedBinaryPath(dataDir, version);
  if (existingPath && await executable(existingPath)) return activate(dataDir, version);

  const release = await releaseMetadata(version);
  if (release.version !== version) throw new Error(`PyPI resolved DSH runtime ${release.version}, expected ${version}`);
  const root = runtimeRoot(dataDir);
  const versions = versionsRoot(dataDir);
  const staging = resolve(root, `.install-${version}-${process.pid}-${Date.now()}`);
  const wheel = resolve(staging, release.wheel.filename);
  const extracted = resolve(staging, "extracted");
  await mkdir(extracted, { recursive: true, mode: 0o700 });
  try {
    await downloadWheel(release.wheel, wheel);
    await command("/usr/bin/unzip", ["-q", wheel, "-d", extracted]);
    const name = binaryName();
    if (!name) throw new Error("Managed DSH runtime is unavailable for this platform");
    const runtimeDirectory = resolve(extracted, "deepseek_harness_runtime", "runtime");
    const runtimePath = resolve(runtimeDirectory, name);
    if (!await access(runtimePath).then(() => true).catch(() => false)) throw new Error("Official DSH runtime wheel did not contain its declared executable");
    await chmod(runtimePath, 0o755);
    const helper = `${runtimePath}-spawn-helper`;
    if (await access(helper).then(() => true).catch(() => false)) await chmod(helper, 0o755);
    await mkdir(versions, { recursive: true, mode: 0o700 });
    const target = resolve(versions, version);
    await rm(target, { recursive: true, force: true });
    await rename(extracted, target);
    return await activate(dataDir, version);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function removeManagedRuntimes(dataDir: string): Promise<void> {
  await rm(runtimeRoot(dataDir), { recursive: true, force: true });
}
