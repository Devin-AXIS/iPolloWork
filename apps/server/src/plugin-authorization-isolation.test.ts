import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-plugin-auth-"));
  roots.push(root);
  const { PluginAuthorizationStore } = await import("./plugin-authorization-store.js");
  const filePath = join(root, "plugin-authorization.vault");
  const store = new PluginAuthorizationStore({ filePath, encryptionKey: Buffer.alloc(32, 7) });
  return { filePath, store };
}

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("plugin authorization isolation", () => {
  test("encrypts credentials and returns only redacted plugin-scoped status", async () => {
    const { filePath, store } = await fixture();
    const saved = await store.saveCredential({
      installationId: "install_alpha",
      accountId: "personal",
      methodId: "api-key",
      values: { apiKey: "alpha-super-secret", region: "eu-west" },
      secretFields: ["apiKey"],
      now: 1_800_000_000_000,
    });

    expect(saved.status).toEqual({
      accountId: "personal",
      methodId: "api-key",
      status: "connected",
      fields: { apiKey: true, region: true },
      updatedAt: 1_800_000_000_000,
    });
    expect(JSON.stringify(await store.listConnections("install_alpha"))).not.toContain("alpha-super-secret");
    expect(await store.readCredential({ installationId: "install_alpha", handle: saved.handle })).toEqual({ apiKey: "alpha-super-secret", region: "eu-west" });
    expect(await store.readCredential({ installationId: "install_beta", handle: saved.handle })).toBeNull();
    expect(await store.readCredentialForAccount({ installationId: "install_alpha", accountId: "personal", methodId: "api-key" })).toEqual({
      apiKey: "alpha-super-secret",
      region: "eu-west",
    });
    expect(await store.readCredentialForAccount({ installationId: "install_beta", accountId: "personal", methodId: "api-key" })).toBeNull();
    expect(await readFile(filePath, "utf8")).not.toContain("alpha-super-secret");
  });

  test("consumes callback state once and rejects cross-plugin or expired use", async () => {
    const { store } = await fixture();
    await store.savePendingFlow({
      installationId: "install_alpha",
      accountId: "personal",
      methodId: "oauth",
      flowId: "flow_1",
      state: "state_1",
      privateData: { pkceVerifier: "private-verifier" },
      expiresAt: 1_800_000_060_000,
      now: 1_800_000_000_000,
    });
    await store.savePendingFlow({
      installationId: "install_alpha",
      accountId: "expired",
      methodId: "oauth",
      flowId: "flow_2",
      state: "state_expired",
      privateData: { pkceVerifier: "expired-verifier" },
      expiresAt: 1_799_999_999_999,
      now: 1_799_999_900_000,
    });

    expect(await store.listPendingFlows("install_alpha", 1_800_000_001_000)).toEqual([
      expect.objectContaining({ flowId: "flow_1", status: "pending" }),
      expect.objectContaining({ flowId: "flow_2", status: "expired" }),
    ]);
    expect(await store.consumePendingFlow({ installationId: "install_beta", state: "state_1", now: 1_800_000_001_000 })).toBeNull();
    expect(await store.consumePendingFlow({ installationId: "install_alpha", state: "state_expired", now: 1_800_000_001_000 })).toBeNull();
    expect(await store.consumePendingFlow({ installationId: "install_alpha", state: "state_1", now: 1_800_000_001_000 })).toMatchObject({
      flowId: "flow_1",
      privateData: { pkceVerifier: "private-verifier" },
    });
    expect(await store.consumePendingFlow({ installationId: "install_alpha", state: "state_1", now: 1_800_000_002_000 })).toBeNull();
  });

  test("cancels only the requested plugin flow", async () => {
    const { store } = await fixture();
    for (const installationId of ["install_alpha", "install_beta"]) {
      await store.savePendingFlow({
        installationId,
        accountId: "personal",
        methodId: "device",
        flowId: "flow_shared",
        state: `${installationId}_state`,
        privateData: { deviceCode: `${installationId}_private` },
        expiresAt: 1_800_000_060_000,
        now: 1_800_000_000_000,
      });
    }

    expect(await store.cancelPendingFlow({ installationId: "install_alpha", flowId: "flow_shared" })).toBe(true);
    expect(await store.listPendingFlows("install_alpha", 1_800_000_001_000)).toEqual([]);
    expect(await store.listPendingFlows("install_beta", 1_800_000_001_000)).toHaveLength(1);
  });

  test("revokes one account and deletes only the requested installation", async () => {
    const { store } = await fixture();
    for (const [installationId, accountId] of [
      ["install_alpha", "personal"],
      ["install_alpha", "work"],
      ["install_beta", "personal"],
    ]) {
      await store.saveCredential({
        installationId,
        accountId,
        methodId: "api-key",
        values: { apiKey: `${installationId}-${accountId}` },
        secretFields: ["apiKey"],
        now: 1_800_000_000_000,
      });
    }

    expect(await store.revokeAccount({ installationId: "install_alpha", accountId: "personal" })).toBe(true);
    expect((await store.listConnections("install_alpha")).map((entry) => entry.accountId)).toEqual(["work"]);
    expect(await store.deleteInstallation("install_alpha")).toBe(true);
    expect(await store.listConnections("install_alpha")).toEqual([]);
    expect((await store.listConnections("install_beta")).map((entry) => entry.accountId)).toEqual(["personal"]);
  });

  test("keeps compatible methods and removes stale credentials and flows after an update", async () => {
    const { store } = await fixture();
    for (const methodId of ["api-key", "removed-oauth"]) {
      await store.saveCredential({
        installationId: "install_alpha",
        accountId: "personal",
        methodId,
        values: { token: methodId },
        secretFields: ["token"],
      });
    }
    await store.savePendingFlow({
      installationId: "install_alpha",
      accountId: "personal",
      methodId: "removed-oauth",
      flowId: "stale-flow",
      state: "stale-state",
      privateData: {},
      expiresAt: Date.now() + 60_000,
    });

    expect(await store.retainMethods("install_alpha", new Set(["api-key"]))).toBe(2);
    expect(await store.listConnections("install_alpha")).toEqual([
      expect.objectContaining({ methodId: "api-key" }),
    ]);
    expect(await store.listPendingFlows("install_alpha")).toEqual([]);
  });

  test("persists an active account per method and falls back after revocation", async () => {
    const { store } = await fixture();
    for (const accountId of ["personal", "work"]) {
      await store.saveCredential({
        installationId: "install_alpha",
        accountId,
        methodId: "api-key",
        values: { apiKey: `${accountId}-key` },
        secretFields: ["apiKey"],
      });
    }

    expect(await store.setActiveAccount({ installationId: "install_alpha", methodId: "api-key", accountId: "work" })).toBe(true);
    expect(await store.readActiveCredential({ installationId: "install_alpha", methodId: "api-key" })).toEqual({
      accountId: "work",
      values: { apiKey: "work-key" },
    });
    await store.revokeAccount({ installationId: "install_alpha", accountId: "work" });
    expect(await store.readActiveCredential({ installationId: "install_alpha", methodId: "api-key" })).toEqual({
      accountId: "personal",
      values: { apiKey: "personal-key" },
    });
  });
});
