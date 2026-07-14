import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryRoot = `HKCU\\Software\\iPolloWorkProtocolSwitcherTests\\${process.pid}`;

function queryCommand() {
  try {
    const output = execFileSync("reg.exe", ["query", `${registryRoot}\\shell\\open\\command`, "/ve"], { encoding: "utf8" });
    return output.match(/REG_SZ\s+(.+)$/m)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function run(script, env = {}) {
  return execFileSync("cmd.exe", ["/d", "/c", script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, IPOLLOWORK_PROTOCOL_REGISTRY_ROOT: registryRoot, IPOLLOWORK_PROTOCOL_NO_PAUSE: "1", ...env },
  });
}

test.afterEach(() => {
  execFileSync("reg.exe", ["delete", registryRoot, "/f"], { stdio: "ignore" });
});

test("switches the protocol to this repository's development Electron entrypoint", () => {
  const script = path.join(root, "切到开发版.cmd");
  assert.equal(existsSync(script), true, "development switch script should exist");

  const temp = mkdtempSync(path.join(os.tmpdir(), "ipollowork-electron-"));
  const electron = path.join(temp, "electron.exe");
  writeFileSync(electron, "test");
  try {
    run(script, { IPOLLOWORK_DEV_ELECTRON: electron });
    assert.equal(queryCommand(), `\"${script}\" --dispatch \"%1\"`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("restores the protocol to a validated production executable", () => {
  const script = path.join(root, "恢复正式版.cmd");
  assert.equal(existsSync(script), true, "production restore script should exist");
  const temp = mkdtempSync(path.join(os.tmpdir(), "ipollowork-production-"));
  const executable = path.join(temp, "iPolloWork.exe");
  writeFileSync(executable, "test");

  try {
    run(script, { IPOLLOWORK_PRODUCTION_EXE: executable });
    assert.equal(queryCommand(), `\"${executable}\" \"%1\"`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("does not change the current handler when production cannot be found", () => {
  const script = path.join(root, "恢复正式版.cmd");
  execFileSync("reg.exe", ["add", `${registryRoot}\\shell\\open\\command`, "/ve", "/d", "sentinel", "/f"], { stdio: "ignore" });

  assert.throws(() => run(script, { IPOLLOWORK_PRODUCTION_EXE: path.join(os.tmpdir(), "missing-ipollowork.exe"), IPOLLOWORK_SKIP_PRODUCTION_DISCOVERY: "1" }));
  assert.equal(queryCommand(), "sentinel");
});
