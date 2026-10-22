// Stage desktop resources or build signed cloud releases. Nothing is uploaded.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogPluginPackageIds, defaultBundledPluginPackageIds, resolveBundledPluginPackageRoot } from "../apps/server/src/plugin-package-catalog.ts";
import { previewPluginPackage, assertPluginPackageSafeForImport } from "../apps/server/src/plugin-package-lifecycle.ts";
import { withMaterializedPluginPackageUpload } from "../apps/server/src/plugin-package-upload.ts";
import { readPluginPackageArchive } from "../apps/app/src/app/lib/plugin-package-archive.ts";
import { pluginPackageIconFiles } from "../apps/desktop/scripts/plugin-package-icons.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const requireFromApp = createRequire(new URL("../apps/app/package.json", import.meta.url));
const JSZip = requireFromApp("jszip");
const usage = "pnpm plugins:package [--plugin <id>] [--out <new-directory>] [--config <release.json> | --keyring <publisher-keys.json>] [--inventory | --desktop]";
const options = new Map();
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (flag === "--help") { console.log(usage); process.exit(0); }
  if (["--inventory", "--desktop"].includes(flag)) { options.set(flag, true); continue; }
  if (!["--plugin", "--out", "--config", "--keyring"].includes(flag) || !args[index + 1] || args[index + 1].startsWith("--") || options.has(flag)) throw new Error(usage);
  options.set(flag, args[++index]);
}
if (options.has("--config") && options.has("--keyring")) throw new Error("Choose --config or --keyring");
const desktop = Boolean(options.get("--desktop"));
if (desktop && ["--inventory", "--config", "--keyring"].some(flag => options.has(flag))) throw new Error("Desktop resources do not use cloud signing or inventory mode");
const availableIds = [...catalogPluginPackageIds, ...(desktop ? defaultBundledPluginPackageIds : [])];
const ids = options.has("--plugin") ? [options.get("--plugin")] : availableIds;
if (ids.some(id => !availableIds.includes(id))) throw new Error("Unknown plugin ID. Available: " + availableIds.join(", "));
const inventoryOnly = Boolean(options.get("--inventory"));
const configPath = resolve(options.get("--config") ?? join(homedir(), ".ipollowork/plugin-signing/release.json"));
const release = !desktop && !inventoryOnly && !options.has("--keyring") ? JSON.parse(await readFile(configPath, "utf8").catch(error => {
  if (error.code === "ENOENT") throw new Error(`Create local signing config at ${configPath}; see docs/plugin-packages.md. Private keys must stay outside the repository.`);
  throw error;
})) : null;
const keys = !inventoryOnly && options.has("--keyring") ? JSON.parse(await readFile(resolve(options.get("--keyring")), "utf8")) : null;
if (release && (!release.privateKey || !release.keyId || !release.publisher?.id || !release.publisher?.name)) throw new Error("Release config requires privateKey, keyId and publisher {id, name}");
const desktopOutput = join(repo, "apps/desktop/resources/plugin-packages");
const output = resolve(options.get("--out") ?? (desktop ? desktopOutput : join(repo, ".ipollowork-dev/plugin-releases", new Date().toISOString().replace(/[:.]/g, "-"))));
// Only the fixed generated desktop resource directory may be replaced.
if (desktop && output === resolve(desktopOutput)) await rm(output, { recursive: true, force: true });
if (await stat(output).catch(error => { if (error.code === "ENOENT") return null; throw error; })) throw new Error("EEXIST: output directory already exists: " + output);
const closed = new Set(["operation-recorder", "short-video-studio", "xiaohongshu-ops", "ipollo-onto"]);
function run(script, scriptArgs = []) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd: repo, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, BUN_BE_BUN: "1" },
  });
  if (result.status !== 0) throw new Error(`Failed: ${basename(script)}\n${result.stderr || result.stdout || result.error?.message}`);
  return result.stdout;
}
// Preflight key paths before expensive builds. Installer verification remains
// authoritative; an unknown publisher key cannot produce a ready collection.
if (!desktop && !inventoryOnly) {
  for (const key of release ? [release] : Object.values(keys)) {
    if (!key?.privateKey || !key?.keyId || !(await stat(resolve(key.privateKey))).isFile()) throw new Error("Signing config requires an existing privateKey file and keyId");
  }
}
for (const id of ids) {
  if (!inventoryOnly && closed.has(id)) {
    console.error(`[plugins] Building ${id}`);
    run(join(repo, "examples/plugin-packages", id, "scripts/build.mjs"), desktop && id === "operation-recorder" ? ["--host"] : []);
  }
}
// Bun on Windows can report EEXIST for an existing redirected Desktop root.
await stat(dirname(output)).catch(async error => {
  if (error.code !== "ENOENT") throw error;
  await mkdir(dirname(output), { recursive: true });
});
await mkdir(output); // Never mix versions or overwrite a previous release.
const stage = await mkdtemp(join(tmpdir(), "ipollowork-plugin-release-"));
const entries = [];
const zip = new JSZip();
try {
  for (const id of ids) {
    const source = await resolveBundledPluginPackageRoot(id, [join(repo, "examples/plugin-packages")]);
    if (closed.has(id) && !source.replaceAll("\\", "/").endsWith("/dist/package")) throw new Error("Build the closed distribution first: " + id);
    const original = await previewPluginPackage({ packageRoot: source });
    const manifest = JSON.parse(await readFile(join(source, "ipollowork.plugin.json"), "utf8"));
    const entry = { pluginId: id, name: manifest.name, version: manifest.package.version,
      publisher: manifest.package.publisher?.id, updateId: manifest.package.updateId,
      platforms: manifest.package.compatibility?.platforms ?? null, minimumHost: manifest.package.compatibility?.ipollowork ?? null };
    if (inventoryOnly) { entries.push({ ...entry, files: original.files.length + 1 }); continue; }
    const key = release ?? keys?.[entry.publisher];
    if (!desktop && (!key?.privateKey || !key?.keyId)) throw new Error("Missing signing configuration for publisher: " + entry.publisher);
    const root = join(desktop ? output : stage, id);
    for (const file of original.files) {
      const target = join(root, file.path); // Paths already validated by the host preview.
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(source, file.path), target);
    }
    // Carry legal files even when the source manifest does not declare them.
    for (const [index, name] of ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE-THIRD-PARTY.txt", "NOTICE", "NOTICE.md", "NOTICE.txt"].entries()) {
      if (original.files.some(file => file.path === name)) continue;
      const legal = await stat(join(source, name)).catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (!legal?.isFile()) continue;
      const path = "distribution/legal/" + name;
      await mkdir(dirname(join(root, path)), { recursive: true });
      await copyFile(join(source, name), join(root, path));
      manifest.resources.push({ type: "file", id: "distribution-legal-" + index, path, required: true });
    }
    if (release) {
      entry.originalPublisher = manifest.package.publisher;
      await mkdir(join(root, "distribution"), { recursive: true });
      await writeFile(join(root, "distribution/NOTICE.md"), `# Distribution attribution\n\nOriginal publisher: ${JSON.stringify(manifest.package.publisher)}\n\nOriginal source: ${JSON.stringify(manifest.source)}\n\nRepackaged and signed by ${release.publisher.name}. Original licenses and attribution continue to apply. Plugin ID, version, update ID and business files are preserved.\n`);
      manifest.resources.push({ type: "file", id: "distribution-attribution", path: "distribution/NOTICE.md", required: true });
      manifest.package.publisher = release.publisher;
      entry.publisher = release.publisher.id;
    }
    delete manifest.package.signature;
    delete manifest.package.checksum;
    await writeFile(join(root, "ipollowork.plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
    if (desktop) {
      // The same runtime validator used by installation rejects incomplete bundles.
      const staged = await previewPluginPackage({ packageRoot: root });
      if (staged.manifest.id !== id || original.files.some(file => !staged.files.some(item => item.path === file.path && item.sha256 === file.sha256))) throw new Error("Desktop package resources changed: " + id);
      entries.push({ ...entry, files: staged.files.length + 1 });
      continue;
    }
    const file = `${id}-${entry.version}.ipollowork-plugin`;
    const packaged = JSON.parse(run(join(repo, "scripts/package-plugin.mjs"), ["--root", root, "--out", join(output, file), "--private-key", resolve(key.privateKey), "--key-id", key.keyId]).trim());
    const bytes = await readFile(join(output, file));
    const upload = await readPluginPackageArchive(new File([bytes], file), "install");
    await withMaterializedPluginPackageUpload(upload, "install", async ({ packageRoot }) => {
      const preview = await previewPluginPackage({ packageRoot });
      const safety = await assertPluginPackageSafeForImport({ packageRoot, preview, purpose: "install" });
      if (safety.level !== "signed" || preview.manifest.id !== id || preview.manifest.package.version !== entry.version || preview.manifest.package.updateId !== entry.updateId) throw new Error("Release identity/signature verification failed: " + id);
      for (const sourceFile of original.files) {
        if (!preview.files.some(file => file.path === sourceFile.path && file.sha256 === sourceFile.sha256)) throw new Error("Business resource changed: " + id + "/" + sourceFile.path);
      }
    });
    entry.artifact = { file, sha256: packaged.archiveSha256, bytes: packaged.archiveBytes };
    entry.verification = "host-signature-and-original-files-verified";
    entries.push(entry);
    zip.file(file, bytes);
    console.error(`[plugins] Verified ${id} ${entry.version}`);
  }
  const collection = JSON.stringify({ schemaVersion: 1, signed: !inventoryOnly && !desktop, cloudPublished: false, plugins: entries }, null, 2) + "\n";
  await writeFile(join(output, "collection.json"), collection);
  if (!inventoryOnly && !desktop) {
    for (const [file, bytes] of await pluginPackageIconFiles()) {
      await writeFile(join(output, file), bytes);
      zip.file(file, bytes);
    }
    const sums = entries.map(entry => entry.artifact.sha256 + "  " + entry.artifact.file).join("\n") + "\n";
    await writeFile(join(output, "SHA256SUMS"), sums);
    zip.file("collection.json", collection); zip.file("SHA256SUMS", sums);
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    await writeFile(join(output, "plugins-collection.zip"), bytes);
    await writeFile(join(output, "plugins-collection.zip.sha256"), createHash("sha256").update(bytes).digest("hex") + "  plugins-collection.zip\n");
  }
  console.log(JSON.stringify({ output, plugins: entries.length, signed: !inventoryOnly && !desktop }));
} finally {
  // mkdtemp creates this exact owned directory; no caller-controlled delete path.
  await rm(stage, { recursive: true, force: true });
}
