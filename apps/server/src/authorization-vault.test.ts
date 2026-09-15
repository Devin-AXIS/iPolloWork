import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuthorizationVault } from "./authorization-vault.js";

const roots: string[] = [];
const connectionId = "github";
const methodId = "oauth";
const methodFingerprint = "oauth-v1";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-authorization-"));
  roots.push(root);
  const filePath = join(root, "authorization.vault");
  const store = new AuthorizationVault({ filePath, encryptionKey: Buffer.alloc(32, 7) });
  return { filePath, store };
}

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("authorization vault isolation", () => {
  test("encrypts shared credentials and reveals handles only to selected consumers", async () => {
    const { filePath, store } = await fixture();
    const saved = await store.saveCredential({
      connectionId,
      accountId: "personal",
      methodId,
      methodFingerprint,
      values: { accessToken: "alpha-super-secret", region: "eu-west" },
      secretFields: ["accessToken"],
      now: 1_800_000_000_000,
    });

    expect(saved.status).toEqual({
      accountId: "personal",
      methodId,
      status: "connected",
      fields: { accessToken: true, region: true },
      updatedAt: 1_800_000_000_000,
    });
    expect(JSON.stringify(await store.listConnections({ connectionId, methodId, methodFingerprint }))).not.toContain("alpha-super-secret");
    expect(await store.readCredential({ consumerId: "plugin:alpha", handle: saved.handle })).toBeNull();
    expect(await store.setActiveAccount({ consumerId: "plugin:alpha", connectionId, methodId, methodFingerprint, accountId: "personal" })).toBe(true);
    expect(await store.readCredential({ consumerId: "plugin:alpha", handle: saved.handle })).toEqual({ accessToken: "alpha-super-secret", region: "eu-west" });
    expect(await store.readCredential({ consumerId: "plugin:beta", handle: saved.handle })).toBeNull();
    expect(await store.readCredentialForAccount({ connectionId, accountId: "personal", methodId, methodFingerprint })).toEqual({
      accessToken: "alpha-super-secret",
      region: "eu-west",
    });
    expect(await readFile(filePath, "utf8")).not.toContain("alpha-super-secret");
  });

  test("consumes callback state once and rejects cross-consumer or expired use", async () => {
    const { store } = await fixture();
    await store.savePendingFlow({
      consumerId: "plugin:alpha",
      connectionId,
      accountId: "personal",
      methodId,
      flowId: "flow_1",
      state: "state_1",
      privateData: { pkceVerifier: "private-verifier" },
      expiresAt: 1_800_000_060_000,
      now: 1_800_000_000_000,
    });
    await store.savePendingFlow({
      consumerId: "plugin:alpha",
      connectionId,
      accountId: "expired",
      methodId,
      flowId: "flow_2",
      state: "state_expired",
      privateData: { pkceVerifier: "expired-verifier" },
      expiresAt: 1_799_999_999_999,
      now: 1_799_999_900_000,
    });

    expect(await store.listPendingFlows("plugin:alpha", 1_800_000_001_000)).toEqual([
      expect.objectContaining({ flowId: "flow_1", status: "pending" }),
      expect.objectContaining({ flowId: "flow_2", status: "expired" }),
    ]);
    expect(await store.consumePendingFlow({ consumerId: "plugin:beta", state: "state_1", now: 1_800_000_001_000 })).toBeNull();
    expect(await store.consumePendingFlow({ consumerId: "plugin:alpha", state: "state_expired", now: 1_800_000_001_000 })).toBeNull();
    expect(await store.consumePendingFlow({ consumerId: "plugin:alpha", state: "state_1", now: 1_800_000_001_000 })).toMatchObject({
      flowId: "flow_1",
      privateData: { pkceVerifier: "private-verifier" },
    });
    expect(await store.consumePendingFlow({ consumerId: "plugin:alpha", state: "state_1", now: 1_800_000_002_000 })).toBeNull();
  });

  test("cancels only the requested consumer flow", async () => {
    const { store } = await fixture();
    for (const consumerId of ["plugin:alpha", "plugin:beta"]) {
      await store.savePendingFlow({
        consumerId,
        connectionId,
        accountId: "personal",
        methodId,
        flowId: "flow_shared",
        state: `${consumerId}_state`,
        privateData: { deviceCode: `${consumerId}_private` },
        expiresAt: 1_800_000_060_000,
        now: 1_800_000_000_000,
      });
    }

    expect(await store.cancelPendingFlow({ consumerId: "plugin:alpha", flowId: "flow_shared" })).toBe(true);
    expect(await store.listPendingFlows("plugin:alpha", 1_800_000_001_000)).toEqual([]);
    expect(await store.listPendingFlows("plugin:beta", 1_800_000_001_000)).toHaveLength(1);
  });

  test("removes shared accounts globally but removes consumers locally", async () => {
    const { store } = await fixture();
    for (const accountId of ["personal", "work"]) {
      await store.saveCredential({
        connectionId,
        accountId,
        methodId,
        methodFingerprint,
        values: { accessToken: `${accountId}-token` },
        secretFields: ["accessToken"],
      });
    }
    for (const consumerId of ["plugin:alpha", "plugin:beta"]) {
      await store.setActiveAccount({ consumerId, connectionId, methodId, methodFingerprint, accountId: "personal" });
    }

    expect(await store.deleteConsumer("plugin:alpha")).toBe(true);
    expect((await store.listConnections({ connectionId, methodId, methodFingerprint })).map((entry) => entry.accountId)).toEqual(["personal", "work"]);
    expect(await store.readActiveCredential({ consumerId: "plugin:beta", connectionId, methodId, methodFingerprint })).toEqual({
      accountId: "personal",
      values: { accessToken: "personal-token" },
    });
    expect(await store.revokeAccount({ connectionId, accountId: "personal" })).toBe(true);
    expect((await store.listConnections({ connectionId, methodId, methodFingerprint })).map((entry) => entry.accountId)).toEqual(["work"]);
    expect(await store.readActiveCredential({ consumerId: "plugin:beta", connectionId, methodId, methodFingerprint })).toEqual({
      accountId: "work",
      values: { accessToken: "work-token" },
    });
  });

  test("prunes orphaned plugin credentials but preserves scopes used by another consumer", async () => {
    const { store } = await fixture();
    await store.saveCredential({
      connectionId: "orphaned-service",
      accountId: "personal",
      methodId,
      methodFingerprint,
      values: { accessToken: "orphaned-token" },
      secretFields: ["accessToken"],
    });
    await store.saveCredential({
      connectionId: "shared-service",
      accountId: "personal",
      methodId,
      methodFingerprint,
      values: { accessToken: "shared-token" },
      secretFields: ["accessToken"],
    });
    await store.setActiveAccount({
      consumerId: "plugin:alpha",
      connectionId: "orphaned-service",
      methodId,
      methodFingerprint,
      accountId: "personal",
    });
    await store.setActiveAccount({
      consumerId: "plugin:beta",
      connectionId: "shared-service",
      methodId,
      methodFingerprint,
      accountId: "personal",
    });

    expect(await store.deleteConsumer("plugin:alpha", [
      { connectionId: "orphaned-service", methodId, methodFingerprint },
      { connectionId: "shared-service", methodId, methodFingerprint },
    ])).toBe(true);
    expect(await store.listConnections({ connectionId: "orphaned-service", methodId, methodFingerprint })).toEqual([]);
    expect(await store.listConnections({ connectionId: "shared-service", methodId, methodFingerprint })).toHaveLength(1);
  });

  test("removes stale consumer state without deleting reusable credentials", async () => {
    const { store } = await fixture();
    await store.saveCredential({
      connectionId,
      accountId: "personal",
      methodId,
      methodFingerprint,
      values: { accessToken: "shared-token" },
      secretFields: ["accessToken"],
    });
    await store.setActiveAccount({ consumerId: "plugin:alpha", connectionId, methodId, methodFingerprint, accountId: "personal" });
    await store.savePendingFlow({
      consumerId: "plugin:alpha",
      connectionId: "removed-service",
      accountId: "personal",
      methodId: "removed-oauth",
      flowId: "stale-flow",
      state: "stale-state",
      privateData: {},
      expiresAt: Date.now() + 60_000,
    });

    expect(await store.retainMethods("plugin:alpha", new Map([[methodId, connectionId]]))).toBe(1);
    expect(await store.listPendingFlows("plugin:alpha")).toEqual([]);
    expect(await store.listConnections({ connectionId, methodId, methodFingerprint })).toHaveLength(1);
  });

  test("persists account selection independently for each consumer", async () => {
    const { store } = await fixture();
    for (const accountId of ["personal", "work"]) {
      await store.saveCredential({
        connectionId,
        accountId,
        methodId,
        methodFingerprint,
        values: { accessToken: `${accountId}-token` },
        secretFields: ["accessToken"],
      });
    }

    await store.setActiveAccount({ consumerId: "plugin:alpha", connectionId, methodId, methodFingerprint, accountId: "work" });
    await store.setActiveAccount({ consumerId: "plugin:beta", connectionId, methodId, methodFingerprint, accountId: "personal" });
    expect(await store.readActiveCredential({ consumerId: "plugin:alpha", connectionId, methodId, methodFingerprint })).toEqual({
      accountId: "work",
      values: { accessToken: "work-token" },
    });
    expect(await store.readActiveCredential({ consumerId: "plugin:beta", connectionId, methodId, methodFingerprint })).toEqual({
      accountId: "personal",
      values: { accessToken: "personal-token" },
    });
  });

  test("merges workspace plugin consumers into one global plugin consumer", async () => {
    const { store } = await fixture();
    await store.saveCredential({
      connectionId,
      accountId: "personal",
      methodId,
      methodFingerprint,
      values: { accessToken: "shared-token" },
      secretFields: ["accessToken"],
    });
    await store.setActiveAccount({
      consumerId: "plugin:workspace-a:github",
      connectionId,
      methodId,
      methodFingerprint,
      accountId: "personal",
    });
    await store.savePendingFlow({
      consumerId: "plugin:workspace-b:github",
      connectionId,
      accountId: "personal",
      methodId,
      flowId: "flow-global",
      state: "state-global",
      privateData: {},
      expiresAt: 1_800_000_060_000,
      now: 1_800_000_000_000,
    });

    expect(await store.mergeConsumers("plugin:github", ["plugin:workspace-a:github", "plugin:workspace-b:github"])).toBe(2);
    expect(await store.readActiveCredential({ consumerId: "plugin:github", connectionId, methodId, methodFingerprint })).toEqual({
      accountId: "personal",
      values: { accessToken: "shared-token" },
    });
    expect(await store.listPendingFlows("plugin:github", 1_800_000_001_000)).toEqual([
      expect.objectContaining({ flowId: "flow-global", status: "pending" }),
    ]);
    expect(await store.listPendingFlows("plugin:workspace-b:github", 1_800_000_001_000)).toEqual([]);
  });
});
