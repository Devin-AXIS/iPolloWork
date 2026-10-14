// Release preparation only. Publication remains the existing cloud resource workflow.
import { spawnSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogPluginPackageIds, resolveBundledPluginPackageRoot } from "../apps/server/src/plugin-package-catalog.ts";
import { previewPluginPackage } from "../apps/server/src/plugin-package-lifecycle.ts";
import { PLUGIN_PACKAGE_MAX_BYTES, PLUGIN_PACKAGE_MAX_FILES } from "../packages/types/src/plugins.ts";

const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  if (!["--out", "--keyring"].includes(args[index]) || !args[index + 1]) throw new Error("Usage: bun scripts/package-plugin-collection.mjs --out <directory> [--keyring <publisher-keys.json>]");
  options.set(args[index], args[index + 1]);
}
if (!options.has("--out")) throw new Error("--out is required");
const output = resolve(options.get("--out"));
const keys = options.has("--keyring") ? JSON.parse(await readFile(resolve(options.get("--keyring")), "utf8")) : null;
const entries = [];
for (const pluginId of catalogPluginPackageIds) {
  const root = await resolveBundledPluginPackageRoot(pluginId);
  if (["operation-recorder", "labelu-data-annotation", "short-video-studio", "xiaohongshu-ops"].includes(pluginId) && !root.replaceAll("\\", "/").endsWith("/dist/package")) {
    throw new Error("Build the closed distribution first: " + pluginId);
  }
  const preview = await previewPluginPackage({ packageRoot: root });
  const metadata = preview.manifest.package;
  const files = preview.files.length + 1;
  const bytes = (await stat(join(root, "ipollowork.plugin.json"))).size
    + (await Promise.all(preview.files.map(file => stat(join(root, file.path))))).reduce((sum, file) => sum + file.size, 0);
  if (files > PLUGIN_PACKAGE_MAX_FILES || bytes + 2048 > PLUGIN_PACKAGE_MAX_BYTES) throw new Error("Package exceeds upload bounds: " + pluginId);
  const publisher = metadata.publisher?.id;
  if (keys && (!publisher || !keys[publisher]?.privateKey || !keys[publisher]?.keyId)) throw new Error("Missing release signing key for publisher: " + publisher);
  entries.push({ pluginId, name: preview.manifest.name, version: metadata.version, publisher, updateId: metadata.updateId,
    platforms: metadata.compatibility?.platforms ?? null, minimumHost: metadata.compatibility?.ipollowork ?? null,
    externalService: pluginId === "ipollo-onto" ? "Onto service source is not included; connect an existing service." : null,
    files, bytes, root });
}
await mkdir(output, { recursive: true });
const packager = fileURLToPath(new URL("./package-plugin.mjs", import.meta.url));
for (const entry of entries) {
  if (keys) {
    const key = keys[entry.publisher];
    const archive = join(output, entry.pluginId + "-" + entry.version + ".ipollowork-plugin");
    const result = spawnSync(process.execPath, [packager, "--root", entry.root, "--out", archive, "--private-key", resolve(key.privateKey), "--key-id", key.keyId],
      { encoding: "utf8", windowsHide: true, env: { ...process.env, BUN_BE_BUN: "1" } });
    if (result.status !== 0) throw new Error("Cannot package " + entry.pluginId + ": " + result.stderr);
    const packaged = JSON.parse(result.stdout.trim());
    entry.artifact = { file: archive, sha256: packaged.archiveSha256, bytes: packaged.archiveBytes };
  }
  delete entry.root;
}
await writeFile(join(output, "collection.json"), JSON.stringify({ schemaVersion: 1, signed: Boolean(keys), plugins: entries }, null, 2) + "\n");
console.log(JSON.stringify({ output, plugins: entries.length, signed: Boolean(keys), bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0) }));
