import assert from "node:assert/strict";
import { generateKeyPairSync, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogPluginPackageIds, resolveBundledPluginPackageRoot } from "../../apps/server/src/plugin-package-catalog.ts";
import { previewPluginPackage, assertPluginPackageSafeForImport } from "../../apps/server/src/plugin-package-lifecycle.ts";
import { withMaterializedPluginPackageUpload } from "../../apps/server/src/plugin-package-upload.ts";
import { readPluginPackageArchive } from "../../apps/app/src/app/lib/plugin-package-archive.ts";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "ipollowork-plugin-collection-check-"));
const privateKey = join(root, "test-only.pem");
const { privateKey: generated } = generateKeyPairSync("ed25519");
await writeFile(privateKey, generated.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
const results = [];
try {
  for (const pluginId of catalogPluginPackageIds) {
    const source = await resolveBundledPluginPackageRoot(pluginId);
    const original = await previewPluginPackage({ packageRoot: source });
    const out = join(root, pluginId + ".ipollowork-plugin");
    const packed = spawnSync(process.execPath, [join(repository, "scripts/package-plugin.mjs"),
      "--root", source, "--out", out, "--private-key", privateKey, "--key-id", "isolated-test-only"],
      { cwd: repository, encoding: "utf8", windowsHide: true, env: { ...process.env, BUN_BE_BUN: "1" } });
    assert.equal(packed.status, 0, pluginId + ": " + packed.stderr);
    const metadata = JSON.parse(packed.stdout.trim());
    const bytes = await readFile(out);
    assert.equal(metadata.archiveSha256, createHash("sha256").update(bytes).digest("hex"));
    const upload = await readPluginPackageArchive(new File([bytes], pluginId + ".ipollowork-plugin"), "install");
    await withMaterializedPluginPackageUpload(upload, "install", async ({ packageRoot }) => {
      const preview = await previewPluginPackage({ packageRoot });
      assert.equal(preview.manifest.id, pluginId);
      assert.equal(preview.manifest.package.version, original.manifest.package.version);
      assert.equal(preview.integrity.status, "verified", pluginId + " checksum");
      assert.deepEqual(preview.files, original.files, pluginId + " full resource closure");
      await assert.rejects(assertPluginPackageSafeForImport({ packageRoot, preview, purpose: "install" }),
        error => error.code === "plugin_package_signature_untrusted", pluginId + " must not trust a test signer");
    });
    results.push({ pluginId, version: metadata.version, files: metadata.files, bytes: metadata.bytes, archiveBytes: bytes.byteLength,
      integrity: "verified", untrustedSigner: "rejected" });
  }
  const output = resolve(repository, "evals/results/plugin-cloud-collection");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "roundtrip.json"), JSON.stringify({ passed: results.length, results }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: results.length, expandedBytes: results.reduce((sum, item) => sum + item.bytes, 0), results }));
} finally {
  const owned = relative(tmpdir(), root);
  if (!owned || owned === ".." || owned.startsWith(".." + sep) || !root.includes("ipollowork-plugin-collection-check-")) throw new Error("Unsafe test cleanup");
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
