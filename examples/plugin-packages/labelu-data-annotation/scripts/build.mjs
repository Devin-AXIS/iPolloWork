import { spawn } from "node:child_process";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist/package");
const require = createRequire(resolve(root, "package.json"));
const vite = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");

async function modifiedAt(path) {
  const info = await stat(path);
  if (!info.isDirectory()) return info.mtimeMs;
  return Math.max(info.mtimeMs, ...await Promise.all((await readdir(path)).map(name => modifiedAt(resolve(path, name)))));
}

if (process.argv.includes("--if-stale")) {
  try {
    const inputs = ["app/src", "app/public", "app/index.html", "app/vite.config.ts", "service/data-annotation.ts", "service/vite.config.ts", "ui", "skills", "ipollowork.plugin.json", "LICENSE-THIRD-PARTY.txt", "NOTICE.txt", "scripts/build.mjs", "package.json", "pnpm-lock.yaml"];
    const [built, latestInput] = await Promise.all([
      stat(resolve(output, "ipollowork.plugin.json")),
      Promise.all(inputs.map(name => modifiedAt(resolve(root, name)))).then(values => Math.max(...values)),
    ]);
    await Promise.all(["app/dist/index.html", "service/dist/data-annotation.mjs", "service/dist/pdf.worker.mjs", "service/dist/pdfjs", "ui/workbench.html", "skills/labelu-data-annotation/SKILL.md"].map(name => stat(resolve(output, name))));
    if (built.mtimeMs >= latestInput) process.exit(0);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

for (const config of ["app/vite.config.ts", "service/vite.config.ts"]) {
  await new Promise((resolveBuild, reject) => {
    const child = spawn(process.execPath, [vite, "build", "--config", config], { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolveBuild() : reject(new Error(`LabelU build exited ${code}`)));
  });
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ["app/dist", "service/dist", "ui", "skills", "LICENSE-THIRD-PARTY.txt", "NOTICE.txt", "ipollowork.plugin.json"]) {
  await cp(resolve(root, name), resolve(output, name), { recursive: true });
}
process.stdout.write(`Built bundled plugin: ${output}\n`);
