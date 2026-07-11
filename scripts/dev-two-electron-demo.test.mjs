import assert from "node:assert/strict";
import { access, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDemoRun,
  demoEnv,
  resetDemoData,
  resolveDemoRoot
} from "./dev-two-electron-demo.mjs";

test("uses a non-production temporary demo root by default", () => {
  const root = resolveDemoRoot({});

  assert.equal(root, path.join(os.tmpdir(), "ipollowalk-two-electron-demo"));
  assert.notEqual(root, path.join(os.homedir(), ".ipollowalk"));
});

test("honors an explicit demo root", () => {
  assert.equal(
    resolveDemoRoot({
      IPOLLOWALK_ELECTRON_DEMO_ROOT: " /tmp/ipollowalk-custom-demo "
    }),
    "/tmp/ipollowalk-custom-demo"
  );
});

test("creates fresh, independent folders for every demo launch", async context => {
  const testRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowalk-demo-test-"));
  context.after(() => rm(testRoot, { recursive: true, force: true }));

  const first = await createDemoRun(testRoot);
  const second = await createDemoRun(testRoot);

  assert.notEqual(first.runRoot, second.runRoot);
  assert.notEqual(first.admin.root, first.consumer.root);
  assert.equal(path.dirname(first.admin.root), first.runRoot);
  assert.equal(path.dirname(first.consumer.root), first.runRoot);

  for (const paths of [
    first.admin,
    first.consumer,
    second.admin,
    second.consumer
  ]) {
    assert.equal((await stat(paths.userDataDir)).isDirectory(), true);
    assert.equal((await stat(paths.dataDir)).isDirectory(), true);
  }
});

test("reset removes all prior demo runs from the configured root", async context => {
  const testRoot = await mkdtemp(
    path.join(os.tmpdir(), "ipollowalk-demo-reset-test-")
  );
  context.after(() => rm(testRoot, { recursive: true, force: true }));
  const run = await createDemoRun(testRoot);

  await resetDemoData(testRoot);

  await assert.rejects(access(run.runRoot));
});

test("points each Electron instance at its own profile folders", async context => {
  const testRoot = await mkdtemp(
    path.join(os.tmpdir(), "ipollowalk-demo-env-test-")
  );
  context.after(() => rm(testRoot, { recursive: true, force: true }));
  const run = await createDemoRun(testRoot);
  const profile = {
    appIdentifier: "com.example.demo",
    appName: "Demo"
  };

  const adminEnv = demoEnv(profile, run.admin, "5273", "9923");
  const consumerEnv = demoEnv(profile, run.consumer, "5274", "9924");

  assert.equal(adminEnv.IPOLLOWALK_ELECTRON_USERDATA, run.admin.userDataDir);
  assert.equal(adminEnv.IPOLLOWALK_DATA_DIR, run.admin.dataDir);
  assert.equal(
    consumerEnv.IPOLLOWALK_ELECTRON_USERDATA,
    run.consumer.userDataDir
  );
  assert.equal(consumerEnv.IPOLLOWALK_DATA_DIR, run.consumer.dataDir);
  assert.notEqual(
    adminEnv.IPOLLOWALK_ELECTRON_USERDATA,
    consumerEnv.IPOLLOWALK_ELECTRON_USERDATA
  );
  assert.notEqual(adminEnv.IPOLLOWALK_DATA_DIR, consumerEnv.IPOLLOWALK_DATA_DIR);
});
