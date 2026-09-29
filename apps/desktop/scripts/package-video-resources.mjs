import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const runtimeRoot = path.join(desktopRoot, "hyperframes-runtime");
const registryRoot = path.join(repoRoot, "vendor", "hyperframes", "registry");
const license = path.join(desktopRoot, "resources", "licenses", "GPL-3.0.txt");
const outputIndex = process.argv.indexOf("--outdir");
const outputRoot = path.resolve(outputIndex < 0 ? path.join(desktopRoot, "dist-video-packs") : process.argv[outputIndex + 1]);
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
if (!existsSync(path.join(runtimeRoot, "packages", "cli", "bin", "hyperframes.mjs"))) {
  const result = spawnSync(process.execPath, [path.join(desktopRoot, "scripts", "prepare-hyperframes-runtime.mjs")], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Could not prepare the HyperFrames runtime.");
}
for (const required of [
  path.join(runtimeRoot, "packages", "cli", "bin", "hyperframes.mjs"),
  path.join(runtimeRoot, "LICENSE"),
  path.join(registryRoot, "registry.json"),
  path.join(repoRoot, "vendor", "hyperframes", "LICENSE"),
  license,
]) {
  if (!existsSync(required)) throw new Error(`Missing video resource input: ${required}`);
}
await mkdir(outputRoot, { recursive: true });
const version = JSON.parse(readFileSync(path.join(runtimeRoot, "packages", "cli", "package.json"), "utf8")).version;
const runtimeArchive = pack(`ipollowork-hyperframes-runtime-${platform}-${arch}-${version}.tar.gz`, runtimeRoot, ["package.json", "LICENSE", "packages", "node_modules"]);
await record(runtimeArchive);
const registryArchive = pack(`ipollowork-hyperframes-registry-${version}.tar.gz`, registryRoot, [
  "registry.json", "blocks", "components", "-C", path.join(repoRoot, "vendor", "hyperframes"), "LICENSE",
]);
await record(registryArchive);

for (const id of ["ffmpeg", "ffprobe"]) {
  const installer = require(id === "ffmpeg" ? "@ffmpeg-installer/ffmpeg" : "@ffprobe-installer/ffprobe");
  const binary = installer.path;
  if (!binary || !existsSync(binary)) throw new Error(`Missing ${id} release binary.`);
  const packageRoot = path.dirname(binary);
  const metadata = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const staging = await mkdtemp(path.join(os.tmpdir(), `ipollowork-${id}-pack-`));
  try {
    await copyFile(binary, path.join(staging, path.basename(binary)));
    await copyFile(license, path.join(staging, "LICENSE-GPL-3.0.txt"));
    await copyFile(path.join(packageRoot, "package.json"), path.join(staging, "BINARY-PACKAGE.json"));
    if (existsSync(path.join(packageRoot, "README.md"))) {
      await copyFile(path.join(packageRoot, "README.md"), path.join(staging, "BINARY-README.md"));
    }
    const archive = pack(`ipollowork-${id}-${platform}-${arch}-${metadata.version}.tar.gz`, staging, ["."]);
    await record(archive);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
