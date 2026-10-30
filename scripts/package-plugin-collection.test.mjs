import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginPackageIconFiles } from "../apps/desktop/scripts/plugin-package-icons.mjs";
const repo = fileURLToPath(new URL("../", import.meta.url));
const script = fileURLToPath(new URL("./package-plugin-collection.mjs", import.meta.url));
function run(args) { return spawnSync("bun", [script, ...args], { cwd: repo, encoding: "utf8", windowsHide: true, timeout: 60000 }); }

test("collection CLI rejects unknown IDs and missing signing config before creating output", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-release-cli-"));
  try {
    const output = join(root, "release");
    const unknown = run(["--plugin", "../private", "--out", output]);
    assert.notEqual(unknown.status, 0); assert.match(unknown.stderr, /Unknown plugin ID/);
    const missing = run(["--plugin", "figma", "--config", join(root, "absent.json"), "--out", output]);
    assert.notEqual(missing.status, 0); assert.match(missing.stderr, /Create local signing config/);
    await assert.rejects(readFile(join(output, "collection.json")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("single-plugin inventory requires no key and never overwrites a previous release", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-release-inventory-"));
  try {
    const output = join(root, "release");
    const result = run(["--plugin", "figma", "--inventory", "--out", output]);
    assert.equal(result.status, 0, result.stderr);
    const inventory = JSON.parse(await readFile(join(output, "collection.json"), "utf8"));
    assert.equal(inventory.signed, false); assert.equal(inventory.plugins.length, 1); assert.equal(inventory.plugins[0].pluginId, "figma");
    assert.equal(inventory.plugins[0].artifact, undefined);
    const repeated = run(["--plugin", "figma", "--inventory", "--out", output]);
    assert.notEqual(repeated.status, 0); assert.match(repeated.stderr, /EEXIST/);
    assert.deepEqual(JSON.parse(await readFile(join(output, "collection.json"), "utf8")), inventory);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an untrusted signing key cannot produce a ready cloud collection", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-release-trust-"));
  try {
    const output = join(root, "release");
    const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
    const key = join(root, "private.pem"); await writeFile(key, pem);
    const config = join(root, "release.json"); await writeFile(config, JSON.stringify({ privateKey: key, keyId: "untrusted", publisher: { id: "fixture", name: "Fixture" } }));
    const result = run(["--plugin", "figma", "--config", config, "--out", output]);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /trusted|signature|publisher/i);
    assert.equal((result.stdout + result.stderr).includes(String(pem)), false);
    await assert.rejects(readFile(join(output, "collection.json")), { code: "ENOENT" });
    await assert.rejects(readFile(join(output, "plugins-collection.zip")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("desktop staging includes complete installable resources without requiring a cloud signing key", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-desktop-collection-"));
  try {
    const output = join(root, "collection");
    const result = run(["--desktop", "--plugin", "figma", "--out", output]);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(join(output, "figma/ipollowork.plugin.json"), "utf8"));
    assert.equal(manifest.id, "figma");
    const inventory = JSON.parse(await readFile(join(output, "collection.json"), "utf8"));
    assert.equal(inventory.signed, false);
    assert.equal(inventory.plugins[0].pluginId, "figma");
    for (const resource of manifest.resources.filter(resource => resource.path)) {
      assert.ok(await stat(join(output, "figma", resource.path)));
    }
    await assert.rejects(readFile(join(output, "plugins-collection.zip")), { code: "ENOENT" });
    const repeated = run(["--desktop", "--plugin", "figma", "--out", output]);
    assert.notEqual(repeated.status, 0);
    assert.match(repeated.stderr, /EEXIST/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("collection includes a multi-resolution plugin icon and portable Windows enable/restore tools", async () => {
  const files = await pluginPackageIconFiles();
  const ico = files.get("plugin-package.ico");
  assert.equal(ico.readUInt32LE(0), 65536);
  assert.equal(ico.readUInt16LE(4), 7);
  for (let index = 0; index < 7; index++) {
    const offset = ico.readUInt32LE(6 + index * 16 + 12);
    assert.equal(ico.subarray(offset, offset + 8).toString("hex"), "89504e470d0a1a0a");
  }
  assert.match(files.get("Enable-plugin-icons.cmd").toString(), /%~dp0plugin-package-icons\.ps1.*-Action Enable/);
  assert.match(files.get("Restore-plugin-icons.cmd").toString(), /-Action Restore/);
  assert.ok(files.has("plugin-package-icons.ps1"));
  assert.ok(files.has("README-icons.txt"));
});

test("Windows icon registration is repeatable and restores the original icon without changing open commands", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-icon-test-"));
  const classes = `Software\\iPolloWorkIconTests\\${process.pid}`;
  const script = join(repo, "apps/desktop/scripts/plugin-package-icons.ps1");
  const icon = join(root, "插件 package.ico");
  const state = join(root, "icon state");
  const env = { ...process.env, ICON_TEST_ROOT: classes };
  function ps(args) {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], { env, encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  function action(value) { ps(["-File", script, "-Action", value, "-IconPath", icon, "-StateDirectory", state, "-ClassesRoot", classes]); }
  function query() {
    return JSON.parse(ps(["-Command", "$r = [Microsoft.Win32.Registry]::CurrentUser; $k = $r.OpenSubKey($env:ICON_TEST_ROOT + '\\.ipollowork-plugin\\DefaultIcon'); $o = $r.OpenSubKey($env:ICON_TEST_ROOT + '\\.ipollowork-plugin\\shell\\open\\command'); @{ icon = $(if ($k) { $k.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }); kind = $(if ($k) { $k.GetValueKind('').ToString() } else { $null }); command = $o.GetValue('') } | ConvertTo-Json -Compress; if ($k) { $k.Dispose() }; $o.Dispose()"]));
  }
  try {
    await writeFile(icon, (await pluginPackageIconFiles()).get("plugin-package.ico"));
    ps(["-Command", "$r = [Microsoft.Win32.Registry]::CurrentUser; $k = $r.CreateSubKey($env:ICON_TEST_ROOT + '\\.ipollowork-plugin\\DefaultIcon'); $k.SetValue('', '%SystemRoot%\\old.ico,2', [Microsoft.Win32.RegistryValueKind]::ExpandString); $k.Dispose(); $k = $r.CreateSubKey($env:ICON_TEST_ROOT + '\\.ipollowork-plugin\\shell\\open\\command'); $k.SetValue('', 'original-open-command'); $k.Dispose()"]);
    const before = query();
    action("Enable");
    assert.equal(query().icon, `"${join(state, "plugin-package.ico")}",0`);
    action("Enable");
    assert.deepEqual(await readFile(join(state, "plugin-package.ico")), await readFile(icon));
    action("Restore");
    assert.deepEqual(query(), before);
    action("Restore");
    assert.deepEqual(query(), before);
    ps(["-Command", "[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($env:ICON_TEST_ROOT + '\\.ipollowork-plugin\\DefaultIcon')"]);
    action("Enable"); action("Restore");
    assert.deepEqual(query(), { icon: null, kind: null, command: "original-open-command" });
  } finally {
    ps(["-Command", "[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($env:ICON_TEST_ROOT, $false)"]);
    await rm(root, { recursive: true, force: true });
  }
});
