import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, copyFile, cp, mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const license = path.join(desktopRoot, "resources", "licenses", "GPL-3.0.txt");
const targets = {
  "x86_64-apple-darwin": { platform: "darwin", arch: "x64" },
  "aarch64-apple-darwin": { platform: "darwin", arch: "arm64" },
  "x86_64-unknown-linux-gnu": { platform: "linux", arch: "x64" },
  "aarch64-unknown-linux-gnu": { platform: "linux", arch: "arm64" },
  "x86_64-pc-windows-msvc": { platform: "win32", arch: "x64" },
  "aarch64-pc-windows-msvc": { platform: "win32", arch: "arm64" },
};

// Native ARM64 Windows binaries are unavailable in the npm installers.
const windowsArm64 = {
  tag: "autobuild-2026-10-01-13-06",
  asset: "ffmpeg-n8.1.3-14-g330caae0c1-winarm64-gpl-8.1.zip",
  sha256: "3dd51c0c37f8f6d6c6779da0af4b370589728abdcb16559bd9aa8318a187764e",
  version: "8.1.3",
};

export function resolveVideoResourceTarget(target = process.env.TAURI_ENV_TARGET_TRIPLE ?? process.env.CARGO_CFG_TARGET_TRIPLE ?? process.env.TARGET, platform = process.platform, arch = process.arch) {
  if (target?.trim()) {
    const resolved = Object.hasOwn(targets, target.trim()) ? targets[target.trim()] : null;
    if (!resolved) throw new Error(`Unsupported video resource target: ${target}`);
    return { ...resolved };
  }
  if (!["darwin", "linux", "win32"].includes(platform) || !["x64", "arm64"].includes(arch)) {
    throw new Error(`Unsupported video resource target: ${platform}/${arch}`);
  }
  return { platform, arch };
}

export function assertVideoPackageMetadata(metadata, { name, version, platform, arch }) {
  if (metadata.name !== name || metadata.version !== version || !Array.isArray(metadata.os) || !metadata.os.includes(platform) || !Array.isArray(metadata.cpu) || !metadata.cpu.includes(arch)) {
    throw new Error(`Video binary package does not match ${name}@${version} for ${platform}/${arch}.`);
  }
}

export async function assertVideoBinaryTarget(binary, { platform, arch }) {
  const file = await open(binary, "r");
  try {
    const header = Buffer.alloc(64);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    let actualPlatform, actualArch;
    if (bytesRead >= 20 && header.readUInt32LE(0) === 0xfeedfacf) {
      actualPlatform = "darwin";
      actualArch = ({ 0x01000007: "x64", 0x0100000c: "arm64" })[header.readUInt32LE(4)];
    } else if (bytesRead >= 20 && header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && header[4] === 2 && [1, 2].includes(header[5])) {
      actualPlatform = "linux";
      actualArch = ({ 62: "x64", 183: "arm64" })[header[5] === 1 ? header.readUInt16LE(18) : header.readUInt16BE(18)];
    } else if (bytesRead === 64 && header.toString("ascii", 0, 2) === "MZ") {
      const offset = header.readUInt32LE(60);
      const signature = Buffer.alloc(6);
      if (offset >= 64 && offset <= 1024 * 1024 && (await file.read(signature, 0, signature.length, offset)).bytesRead === 6 && signature.readUInt32LE(0) === 0x00004550) {
        actualPlatform = "win32";
        actualArch = ({ 0x8664: "x64", 0xaa64: "arm64" })[signature.readUInt16LE(4)];
      }
    }
    if (actualPlatform !== platform || actualArch !== arch) {
      throw new Error(`Video binary architecture mismatch: expected ${platform}/${arch}, found ${actualPlatform ?? "unknown"}/${actualArch ?? "unknown"}: ${binary}`);
    }
  } finally { await file.close(); }
}

async function digest(file, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

async function download(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`Video resource download failed (${response.status}): ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

function extract(archive, destination, zip = false) {
  const args = zip && process.platform === "win32"
    ? ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`]
    : zip ? ["-q", archive, "-d", destination] : ["-xzf", archive, "-C", destination];
  const result = spawnSync(zip ? process.platform === "win32" ? "powershell.exe" : "unzip" : "tar", args, { stdio: "inherit", windowsHide: true, timeout: 120_000 });
  if (result.status !== 0) throw new Error(`Could not extract video resource: ${archive}`);
}

async function npmBinary(id, target, temporary) {
  const installerPath = require.resolve(`@${id}-installer/${id}/package.json`);
  const installer = JSON.parse(readFileSync(installerPath, "utf8"));
  const name = `@${id}-installer/${target.platform}-${target.arch}`;
  const version = installer.optionalDependencies?.[name];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`No pinned ${id} binary for ${target.platform}/${target.arch}.`);
  let packageRoot;
  try { packageRoot = path.dirname(createRequire(installerPath).resolve(`${name}/package.json`)); }
  catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
  if (!packageRoot) {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Could not resolve ${name}@${version}.`);
    const registry = await response.json();
    assertVideoPackageMetadata(registry, { name, version, ...target });
    const integrity = /^(sha512|sha256)-([A-Za-z0-9+/=]+)$/.exec(registry.dist?.integrity ?? "");
    const tarball = new URL(registry.dist?.tarball);
    if (!integrity || tarball.protocol !== "https:" || tarball.hostname !== "registry.npmjs.org") throw new Error(`Invalid verified download metadata for ${name}@${version}.`);
    const archive = path.join(temporary, `${id}.tgz`);
    await download(tarball.href, archive);
    if (await digest(archive, integrity[1], "base64") !== integrity[2]) throw new Error(`Integrity mismatch for ${name}@${version}.`);
    const extracted = path.join(temporary, id);
    await mkdir(extracted);
    extract(archive, extracted);
    packageRoot = path.join(extracted, "package");
  }
  const metadata = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  assertVideoPackageMetadata(metadata, { name, version, ...target });
  return { binary: path.join(packageRoot, target.platform === "win32" ? `${id}.exe` : id), packageRoot, metadata };
}

async function windowsArm64Binaries(temporary) {
  const archive = path.join(temporary, windowsArm64.asset);
  await download(`https://github.com/BtbN/FFmpeg-Builds/releases/download/${windowsArm64.tag}/${windowsArm64.asset}`, archive);
  if (await digest(archive, "sha256", "hex") !== windowsArm64.sha256) throw new Error("Windows ARM64 video resource integrity mismatch.");
  const extracted = path.join(temporary, "windows-arm64");
  await mkdir(extracted);
  extract(archive, extracted, true);
  const packageRoot = path.join(extracted, windowsArm64.asset.replace(/\.zip$/, ""));
  const licensePath = path.join(packageRoot, "LICENSE.txt");
  if (!existsSync(licensePath)) throw new Error("Windows ARM64 codec license is missing.");
  return Object.fromEntries(["ffmpeg", "ffprobe"].map(id => [id, {
    binary: path.join(packageRoot, "bin", `${id}.exe`),
    packageRoot,
    licensePath,
    metadata: { name: "BtbN/FFmpeg-Builds", version: windowsArm64.version, os: ["win32"], cpu: ["arm64"], source: `https://github.com/BtbN/FFmpeg-Builds/releases/tag/${windowsArm64.tag}`, sha256: windowsArm64.sha256 },
  }]));
}

async function packageVideoResources() {
  const target = resolveVideoResourceTarget();
  const bundled = process.argv.includes("--bundled");
  const outputIndex = process.argv.indexOf("--outdir");
  if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error("--outdir requires a directory.");
  const outputRoot = path.resolve(outputIndex < 0 ? path.join(desktopRoot, bundled ? "video-codecs" : "dist-video-packs") : process.argv[outputIndex + 1]);
  if (!existsSync(license)) throw new Error(`Missing video resource license: ${license}`);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "ipollowork-video-resources-"));
  try {
    const resources = target.platform === "win32" && target.arch === "arm64" ? await windowsArm64Binaries(temporary) : null;
    const stagedResources = [];
    for (const id of ["ffmpeg", "ffprobe"]) {
      const resource = resources?.[id] ?? await npmBinary(id, target, temporary);
      await assertVideoBinaryTarget(resource.binary, target);
      const staging = path.join(temporary, `staged-${id}`);
      await mkdir(staging);
      const stagedBinary = path.join(staging, target.platform === "win32" ? `${id}.exe` : id);
      await copyFile(resource.binary, stagedBinary);
      if (target.platform !== "win32") await chmod(stagedBinary, 0o755);
      await copyFile(license, path.join(staging, "LICENSE-GPL-3.0.txt"));
      writeFileSync(path.join(staging, "BINARY-PACKAGE.json"), `${JSON.stringify(resource.metadata, null, 2)}\n`);
      if (resource.licensePath) await copyFile(resource.licensePath, path.join(staging, "BINARY-LICENSE.txt"));
      if (existsSync(path.join(resource.packageRoot, "README.md"))) await copyFile(path.join(resource.packageRoot, "README.md"), path.join(staging, "BINARY-README.md"));
      if (target.platform === process.platform && target.arch === process.arch) {
        const verified = spawnSync(stagedBinary, ["-version"], { encoding: "utf8", timeout: 10_000, windowsHide: true });
        if (verified.status !== 0 || !(verified.stdout + verified.stderr).toLowerCase().includes(id)) throw new Error(`Bundled ${id} failed its version check.`);
      }
      stagedResources.push({ id, staging, version: resource.metadata.version });
    }
    await mkdir(outputRoot, { recursive: true });
    for (const { id, staging, version } of stagedResources) {
      if (bundled) {
        const destination = path.join(outputRoot, id);
        await rm(destination, { recursive: true, force: true });
        await cp(staging, destination, { recursive: true });
      } else {
        const label = ({ darwin: "macos", win32: "windows", linux: "linux" })[target.platform];
        const archive = path.join(outputRoot, `ipollowork-${id}-${label}-${target.arch}-${version}.tar.gz`);
        const result = spawnSync("tar", ["-czf", archive, "-C", staging, "."], { stdio: "inherit", windowsHide: true, timeout: 120_000 });
        if (result.status !== 0) throw new Error(`Could not package ${archive}.`);
        const checksum = await digest(archive, "sha256", "hex");
        writeFileSync(`${archive}.sha256`, `${checksum}  ${path.basename(archive)}\n`);
        process.stdout.write(`${path.basename(archive)} ${checksum}\n`);
      }
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await packageVideoResources();
