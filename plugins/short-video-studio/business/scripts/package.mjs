import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
const root = fileURLToPath(new URL("../", import.meta.url));
const host = process.env.IPOLLOWORK_SOURCE_ROOT || resolve(root, "../../..");
const key = process.env.IPOLLOWORK_PLUGIN_SIGNING_KEY;
const keyId = process.env.IPOLLOWORK_PLUGIN_KEY_ID;
if (!key || !keyId) throw new Error("Provide IPOLLOWORK_PLUGIN_SIGNING_KEY and IPOLLOWORK_PLUGIN_KEY_ID. Never bundle the private key.");
const manifest = JSON.parse(await readFile(resolve(root, "dist/package/ipollowork.plugin.json"), "utf8"));
await new Promise((done, reject) => {
  const child = spawn(process.execPath, [resolve(host, "scripts/package-plugin.mjs"), "--root", resolve(root, "dist/package"),
    "--out", resolve(root, "dist/short-video-studio-" + manifest.package.version + ".ipollowork-plugin"),
    "--private-key", key, "--key-id", keyId], { cwd: host, stdio: "inherit", windowsHide: true });
  child.once("error", reject); child.once("exit", code => code === 0 ? done() : reject(new Error("Plugin packaging failed")));
});
