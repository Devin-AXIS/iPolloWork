import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const license = path.join(desktopRoot, "resources", "licenses", "GPL-3.0.txt");
const outputIndex = process.argv.indexOf("--outdir");
const bundled = process.argv.includes("--bundled");
const outputRoot = path.resolve(outputIndex < 0 ? path.join(desktopRoot, bundled ? "video-codecs" : "dist-video-packs") : process.argv[outputIndex + 1]);
const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
const arch = process.arch;

function pack(name, source, entries) {
  const archive = path.join(outputRoot, name);
  const result = spawnSync("tar", ["-czf", archive, "-C", source, ...entries], { stdio: "inherit", windowsHide: true });
  if (result.status !== 0) throw new Error(`Could not package ${name}.`);
  return archive;
}

async function record(archive) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const checksum = hash.digest("hex");
  writeFileSync(`${archive}.sha256`, `${checksum}  ${path.basename(archive)}\n`);
  process.stdout.write(`${path.basename(archive)} ${checksum}\n`);
}

if (!["x64", "arm64"].includes(arch)) throw new Error(`Unsupported resource architecture: ${arch}`);
if (!existsSync(license)) throw new Error(`Missing video resource license: ${license}`);
await mkdir(outputRoot, { recursive: true });

for (const id of ["ffmpeg", "ffprobe"]) {
  const installer = require(id === "ffmpeg" ? "@ffmpeg-installer/ffmpeg" : "@ffprobe-installer/ffprobe");
  const binary = installer.path;
  if (!binary || !existsSync(binary)) throw new Error(`Missing ${id} release binary.`);
  const packageRoot = path.dirname(binary);
  const metadata = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const staging = bundled ? path.join(outputRoot, id) : await mkdtemp(path.join(os.tmpdir(), `ipollowork-${id}-pack-`));
  await mkdir(staging, { recursive: true });
  try {
    await copyFile(binary, path.join(staging, path.basename(binary)));
    if (process.platform !== "win32") await chmod(path.join(staging, path.basename(binary)), 0o755);
    await copyFile(license, path.join(staging, "LICENSE-GPL-3.0.txt"));
    await copyFile(path.join(packageRoot, "package.json"), path.join(staging, "BINARY-PACKAGE.json"));
    if (existsSync(path.join(packageRoot, "README.md"))) {
      await copyFile(path.join(packageRoot, "README.md"), path.join(staging, "BINARY-README.md"));
    }
    if (bundled) {
      const verified = spawnSync(path.join(staging, path.basename(binary)), ["-version"], { encoding: "utf8" });
      if (verified.status !== 0) throw new Error(`Bundled ${id} failed its version check.`);
      continue;
    }
    const archive = pack(`ipollowork-${id}-${platform}-${arch}-${metadata.version}.tar.gz`, staging, ["."]);
    await record(archive);
  } finally {
    if (!bundled) await rm(staging, { recursive: true, force: true });
  }
}
