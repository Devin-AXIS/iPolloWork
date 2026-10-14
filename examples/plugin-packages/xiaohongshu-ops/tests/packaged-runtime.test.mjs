import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("the closed cloud package starts and processes images with no Node or pnpm on PATH", { timeout: 30000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const built = spawnSync(process.execPath, [resolve(root, "scripts/build.mjs")], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(built.status, 0, built.stderr);
  const bun = spawnSync("bun", ["-e", "console.log(process.execPath)"], { encoding: "utf8", windowsHide: true }).stdout.trim();
  assert.ok(bun, "Bun build/test runtime is required");
  const sandbox = await mkdtemp(join(tmpdir(), "ipollowork-xhs-closed-"));
  const portProbe = createServer(); portProbe.listen(0, "127.0.0.1"); await once(portProbe, "listening");
  const port = portProbe.address().port; await new Promise(done => portProbe.close(done));
  const origin = "http://127.0.0.1:" + port;
  let output = "";
  const child = spawn(bun, [resolve(root, "dist/package/runtime/dist/server.mjs")], {
    cwd: resolve(root, "dist/package/runtime"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: "", BUN_BE_BUN: "1", XHS_OPS_DATA_DIR: sandbox, XHS_OPS_PORT: String(port), XHS_OPS_ORIGIN: origin },
  });
  child.stdout.on("data", chunk => { output = (output + chunk).slice(-4000); });
  child.stderr.on("data", chunk => { output = (output + chunk).slice(-4000); });
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) break;
      healthy = await fetch(origin + "/healthz", { signal: AbortSignal.timeout(300) }).then(r => r.ok, () => false);
      if (healthy) break;
      await new Promise(done => setTimeout(done, 100));
    }
    assert.ok(healthy, output);
    assert.match(await (await fetch(origin + "/accounts")).text(), /小红书/);
    assert.equal((await fetch(origin + "/icons/fonts/tabler-icons.woff2")).status, 200);
    const token = (await readFile(join(sandbox, "api-token"), "utf8")).trim();
    const require = createRequire(resolve(root, "skills/xhs-ops-worker/app/package.json"));
    const image = await require("sharp")({ create: { width: 2, height: 3, channels: 3, background: "#1fbac0" } }).png().toBuffer();
    const form = new FormData(); form.set("file", new File([image], "sample.png", { type: "image/png" }));
    const response = await fetch(origin + "/api/assets", { method: "POST", headers: { Authorization: "Bearer " + token }, body: form });
    const result = await response.json();
    assert.equal(response.status, 201, JSON.stringify(result));
    assert.equal(result.asset.width, 2); assert.equal(result.asset.height, 3);
    const headers = { Authorization: "Bearer " + token, Origin: origin, "Content-Type": "application/json" };
    const accountInput = { handle: "isolated-proof", displayName: "Isolated proof", expectedProfileId: "proof-only",
      profileUrl: "https://creator.xiaohongshu.com/new/home", workerThreadId: "isolated-proof-session",
      position: "Test", audience: "Test", noteTone: "Test", commentTone: "Test", contentColumns: ["Test"], bannedTopics: [], dailyLimit: 1 };
    const created = await fetch(origin + "/api/accounts", { method: "POST", headers, body: JSON.stringify(accountInput) });
    const account = (await created.json()).account;
    assert.equal(created.status, 201); assert.ok(account.id);
    const edited = await fetch(origin + "/api/accounts/" + account.id, { method: "PUT", headers,
      body: JSON.stringify({ ...accountInput, displayName: "Updated isolated proof" }) });
    assert.equal(edited.status, 200); assert.equal((await edited.json()).account.displayName, "Updated isolated proof");
    const queued = await fetch(origin + "/api/accounts/" + account.id + "/verify", { method: "POST", headers, body: "{}" });
    const queuedResult = await queued.json();
    assert.equal(queued.status, 202, JSON.stringify(queuedResult));
    assert.equal(queuedResult.job.type, "verify_session");
    const disabled = await fetch(origin + "/api/accounts/" + account.id + "/enabled", { method: "POST", headers,
      body: JSON.stringify({ enabled: false }) });
    assert.equal(disabled.status, 200); assert.equal((await disabled.json()).account.enabled, false);

  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, "exit"); }
    const target = resolve(sandbox), base = resolve(tmpdir()) + sep;
    assert.ok(target.startsWith(base), "Cleanup must stay inside the owned temporary directory");
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
