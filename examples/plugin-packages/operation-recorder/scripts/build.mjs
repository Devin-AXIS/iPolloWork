import { spawn } from "node:child_process";
import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist/package");
const hostOnly = process.argv.includes("--host");
const compressNative = promisify(gzip);
function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`)));
  });
}

// Go cross-compiles the native helpers; installed clients need no Go runtime.
async function buildNative() {
  for (const platform of ["windows", "linux"]) {
    if (hostOnly && platform !== (process.platform === "win32" ? "windows" : process.platform)) continue;
    for (const architecture of ["amd64", "arm64"]) {
      if (hostOnly && architecture !== (process.arch === "x64" ? "amd64" : process.arch)) continue;
      const target = `${platform === "windows" ? "win32" : platform}-${architecture === "amd64" ? "x64" : architecture}`;
      const folder = resolve(root, "dist/native", target);
      const packagedFolder = resolve(output, "native", target);
      await mkdir(folder, { recursive: true });
      await mkdir(packagedFolder, { recursive: true });
      const name = platform === "windows" ? "recorder.exe" : "recorder";
      const binary = resolve(folder, name);
      await run("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", binary, "."],
        { cwd: resolve(root, "native"), env: { ...process.env, GOOS: platform, GOARCH: architecture, CGO_ENABLED: "0" } });
      await writeFile(resolve(packagedFolder, `${name}.gz`), await compressNative(await readFile(binary), { level: 9 }));
    }
  }
}

async function modifiedAt(path) {
  const info = await stat(path);
  if (!info.isDirectory()) return info.mtimeMs;
  return Math.max(info.mtimeMs, ...await Promise.all((await readdir(path)).map(name => modifiedAt(resolve(path, name)))));
}

if (hostOnly && process.argv.includes("--if-stale")) {
  const nativeName = process.platform === "darwin" ? "native/recorder"
    : `native/${process.platform}-${process.arch}/${process.platform === "win32" ? "recorder.exe" : "recorder"}.gz`;
  try {
    const [manifest, native, latestInput] = await Promise.all([
      stat(resolve(output, "ipollowork.plugin.json")), stat(resolve(output, nativeName)),
      Promise.all(["service", "native", "ui", "skills", "ipollowork.plugin.json", "scripts/build.mjs"].map(name => modifiedAt(resolve(root, name)))).then(values => Math.max(...values)),
    ]);
    if (Math.min(manifest.mtimeMs, native.mtimeMs) >= latestInput) process.exit(0);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "native"), { recursive: true });
// The host's Node 22.22+ runtime imports TypeScript services directly.
await cp(resolve(root, "service"), resolve(output, "service"), { recursive: true });
await cp(resolve(root, "ui"), resolve(output, "ui"), { recursive: true });
await cp(resolve(root, "skills"), resolve(output, "skills"), { recursive: true });
await cp(resolve(root, "ipollowork.plugin.json"), resolve(output, "ipollowork.plugin.json"));
await buildNative();
await cp(resolve(root, "native/THIRD-PARTY-NOTICES.txt"), resolve(output, "native/THIRD-PARTY-NOTICES.txt"));
if (process.platform === "darwin") {
  const architectures = hostOnly ? [process.arch === "arm64" ? "arm64" : "x86_64"] : ["arm64", "x86_64"];
  for (const arch of architectures) {
    await run("swiftc", ["-swift-version", "6", "-O", "-target", `${arch}-apple-macosx14.0`,
      resolve(root, "native/Recorder.swift"), "-o", resolve(root, `dist/recorder-${arch}`)]);
  }
  if (hostOnly) await cp(resolve(root, `dist/recorder-${architectures[0]}`), resolve(output, "native/recorder"));
  else await run("lipo", ["-create", resolve(root, "dist/recorder-arm64"), resolve(root, "dist/recorder-x86_64"),
    "-output", resolve(output, "native/recorder")]);
  await run("codesign", ["--force", "--sign", "-", "--identifier", "com.ipollowork.operation-recorder", resolve(output, "native/recorder")]);
  await chmod(resolve(output, "native/recorder"), 0o700);
}

if (process.argv.includes("--sign")) {
  const privateKey = process.env.IPOLLOWORK_PLUGIN_SIGNING_KEY;
  const keyId = process.env.IPOLLOWORK_PLUGIN_SIGNING_KEY_ID;
  const hostRoot = process.env.IPOLLOWORK_PLUGIN_HOST_ROOT;
  if (!privateKey || !keyId || !hostRoot) throw new Error("Set IPOLLOWORK_PLUGIN_SIGNING_KEY, IPOLLOWORK_PLUGIN_SIGNING_KEY_ID and IPOLLOWORK_PLUGIN_HOST_ROOT to use your existing trusted publisher.");
  const manifest = JSON.parse(await readFile(resolve(output, "ipollowork.plugin.json"), "utf8"));
  const archive = resolve(root, `dist/${manifest.id}-${manifest.package.version}.ipollowork-plugin`);
  await run(process.execPath, [resolve(hostRoot, "scripts/package-plugin.mjs"), "--root", output,
    "--out", archive, "--private-key", resolve(privateKey), "--key-id", keyId]);
}
process.stdout.write(`Built independent plugin: ${output}\n`);
