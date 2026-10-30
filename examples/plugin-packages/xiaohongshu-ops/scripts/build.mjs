await (async function buildXhsPackage() {
  const { cp, mkdir, readFile, realpath, rm, writeFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  const { dirname, resolve, relative, sep, basename } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { spawnSync } = await import("node:child_process");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const repo = process.env.IPOLLOWORK_PLUGIN_HOST_ROOT || resolve(root, "../../..");
  const appRoot = resolve(root, "skills/xhs-ops-worker/app");
  const appRequire = createRequire(resolve(appRoot, "package.json"));
  const { dependencies } = JSON.parse(await readFile(resolve(appRoot, "package.json"), "utf8"));
  async function dependenciesReady() {
    // These dependencies are pinned; ancestor/global modules do not satisfy the plugin's lockfile.
    const ready = await Promise.all(Object.entries(dependencies).map(async ([name, version]) => {
      try {
        const installed = JSON.parse(await readFile(resolve(appRoot, "node_modules", name, "package.json"), "utf8"));
        return installed.name === name && installed.version === version;
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
        throw error;
      }
    }));
    return ready.every(Boolean);
  }
  if (!await dependenciesReady()) {
    console.log("Preparing locked Xiaohongshu build dependencies...");
    const result = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["install", "--ignore-workspace", "--frozen-lockfile", "--ignore-scripts"],
      { cwd: appRoot, stdio: "inherit", windowsHide: true, shell: process.platform === "win32" });
    if (result.error || result.status !== 0 || !await dependenciesReady()) {
      throw new Error("Could not prepare the plugin's locked build dependencies", { cause: result.error });
    }
  }
  const hostRequire = createRequire(resolve(repo, "apps/app/package.json"));
  const viteRequire = createRequire(hostRequire.resolve("vite/package.json"));
  const { build } = viteRequire("esbuild");
  const output = resolve(root, "dist/package");
  const suffix = relative(root, output);
  if (!suffix || suffix === ".." || suffix.startsWith(".." + sep)) throw new Error("Unsafe package output");
  await rm(output, { recursive: true, force: true });
  const runtime = resolve(output, "runtime");
  await mkdir(resolve(output, "licenses"), { recursive: true });
  await cp(resolve(root, "LICENSE"), resolve(output, "licenses/LICENSE"));
  await cp(resolve(root, "LICENSES"), resolve(output, "licenses/third-party"), { recursive: true });
  await mkdir(resolve(runtime, "dist"), { recursive: true });
  await build({ entryPoints: [resolve(appRoot, "src/server.ts")], bundle: true, platform: "node", format: "esm",
    target: "node22", minify: true, external: ["sharp", "bun:sqlite"],
    alias: { "node:sqlite": resolve(root, "scripts/sqlite-runtime.mjs") },
    outfile: resolve(runtime, "dist/server.mjs") });
  await cp(resolve(appRoot, "public"), resolve(runtime, "public"), { recursive: true });
  await writeFile(resolve(runtime, "package.json"), '{"type":"module"}\n');
  async function dependencyRoot(name, resolver) {
    for (const directory of resolver.resolve.paths(name) || []) {
      const candidate = resolve(directory, name, "package.json");
      try {
        const metadata = JSON.parse(await readFile(candidate, "utf8"));
        if (metadata.name === name) return dirname(await realpath(candidate));
      } catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error; }
    }
    const error = new Error("Missing locked runtime dependency: " + name);
    error.code = "MODULE_NOT_FOUND";
    throw error;
  }
  const copied = new Set();
  async function copyDependency(name, resolver, optional = false) {
    if (copied.has(name)) return;
    if (name.startsWith("@img/sharp-") && !name.includes(process.platform + "-" + process.arch)) return;
    let source;
    try { source = await dependencyRoot(name, resolver); }
    catch (error) { if (optional && error.code === "MODULE_NOT_FOUND") return; throw error; }
    copied.add(name);
    const metadata = JSON.parse(await readFile(resolve(source, "package.json"), "utf8"));
    await cp(source, resolve(runtime, "node_modules", name), { recursive: true, dereference: true,
      filter: path => basename(path) !== "node_modules" });
    const childRequire = createRequire(resolve(source, "package.json"));
    for (const child of Object.keys(metadata.dependencies || {})) await copyDependency(child, childRequire);
    for (const child of Object.keys(metadata.optionalDependencies || {})) await copyDependency(child, childRequire, true);
  }
  await copyDependency("sharp", appRequire);
  const iconRoot = await dependencyRoot("@tabler/icons-webfont", appRequire);
  const iconTarget = resolve(runtime, "node_modules/@tabler/icons-webfont");
  await mkdir(resolve(iconTarget, "dist/fonts"), { recursive: true });
  for (const path of ["package.json", "LICENSE", "dist/tabler-icons.min.css", "dist/fonts/tabler-icons.woff2"]) {
    await cp(resolve(iconRoot, path), resolve(iconTarget, path));
  }
  await cp(resolve(root, "service"), resolve(output, "service"), { recursive: true });
  await cp(resolve(root, "skills"), resolve(output, "skills"), { recursive: true,
    filter: path => path !== appRoot && basename(path) !== "node_modules" });
  const manifest = JSON.parse(await readFile(resolve(root, "ipollowork.plugin.json"), "utf8"));
  for (const resource of manifest.resources) if (resource.type === "skill" && resource.path === "skills/xhs-ops-worker") {
    resource.path = "skills/xhs-ops-worker/SKILL.md";
  }
  manifest.resources.push({ id: "packaged-runtime", type: "file", path: "runtime", required: true },
    { id: "package-licenses", type: "file", path: "licenses", required: true });
  manifest.package.compatibility = { ...manifest.package.compatibility,
    ipollowork: ">=0.50.17", platforms: [{ os: process.platform, arch: process.arch }] };
  await writeFile(resolve(output, "ipollowork.plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ pluginId: manifest.id, version: manifest.package.version,
    target: process.platform + "-" + process.arch, dependencies: [...copied], output }));
})();
