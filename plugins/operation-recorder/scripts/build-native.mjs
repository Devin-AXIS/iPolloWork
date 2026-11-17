import { build } from "esbuild";
import { spawn } from "node:child_process";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist/package");
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
    for (const architecture of ["amd64", "arm64"]) {
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

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "native"), { recursive: true });
await build({ entryPoints: [resolve(root, "service/recorder.ts")],
  outfile: resolve(output, "service/recorder.mjs"), bundle: true, platform: "node", format: "esm", target: "node22" });
await cp(resolve(root, "ui"), resolve(output, "ui"), { recursive: true });
await cp(resolve(root, "skills"), resolve(output, "skills"), { recursive: true });

await buildNative();
await cp(resolve(root, "native/THIRD-PARTY-NOTICES.txt"), resolve(output, "native/THIRD-PARTY-NOTICES.txt"));
if (process.platform === "darwin") {
  for (const arch of ["arm64", "x86_64"]) {
    await run("swiftc", ["-swift-version", "6", "-O", "-target", `${arch}-apple-macosx14.0`,
      resolve(root, "native/Recorder.swift"), "-o", resolve(root, `dist/recorder-${arch}`)]);
  }
  await run("lipo", ["-create", resolve(root, "dist/recorder-arm64"), resolve(root, "dist/recorder-x86_64"),
    "-output", resolve(output, "native/recorder")]);
  await run("codesign", ["--force", "--sign", "-", "--identifier", "com.ipollowork.operation-recorder", resolve(output, "native/recorder")]);
  await chmod(resolve(output, "native/recorder"), 0o700);
}
