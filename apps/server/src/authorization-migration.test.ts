import { afterEach, expect, test } from "bun:test";
import { createCipheriv, randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateLegacyPluginAuthorization } from "./authorization-migration.js";
import { authorizationMethodFingerprint } from "./authorization-method.js";
import { authorizationVault } from "./authorization-runtime.js";
import { pluginAuthorizationMethodSchema } from "./plugin-package-manifest.js";
import type { ServerConfig } from "./types.js";

const roots: string[] = [];
const previousRuntimeDb = process.env.IPOLLOWORK_RUNTIME_DB;

afterEach(async () => {
  if (previousRuntimeDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
  else process.env.IPOLLOWORK_RUNTIME_DB = previousRuntimeDb;
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("moves legacy plugin credentials into the shared vault and removes the old store", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-authorization-migration-"));
  roots.push(root);
  process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const config = {
    configPath: join(root, "server.json"),
    workspaces: [{ id: "workspace", name: "Workspace", path: root, preset: "starter", workspaceType: "local" }],
  } as unknown as ServerConfig;
  const legacyMethod = {
    id: "oauth",
    kind: "oauth-pkce",
    label: "OAuth",
    clientId: "github-client",
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo"],
  };
  const lifecycleDirectory = join(root, "plugin-packages", "workspace");
  await mkdir(lifecycleDirectory, { recursive: true });
  await writeFile(join(lifecycleDirectory, "state.json"), JSON.stringify({
    schemaVersion: 2,
    packages: {
      github: {
        pluginId: "github",
        enabled: true,
        disabledResourceIds: [],
        currentVersion: "1.0.0",
        previousVersion: null,
        versions: {
          "1.0.0": {
            version: "1.0.0",
            manifest: { id: "github", authorization: { methods: [legacyMethod] } },
            files: [],
            installedAt: 1_800_000_000_000,
          },
        },
      },
    },
  }));

  const key = randomBytes(32);
  await writeFile(join(root, "plugin-authorization.key"), `${key.toString("base64")}\n`);
  const legacyDirectory = join(root, "plugin-authorization");
  await mkdir(legacyDirectory, { recursive: true });
  const state = {
    schemaVersion: 1,
    credentials: [{
      handle: "plugin_credential_legacy",
      installationId: "workspace:github",
      accountId: "personal",
      methodId: "oauth",
      values: { accessToken: "legacy-token", refreshToken: "legacy-refresh" },
      secretFields: ["accessToken", "refreshToken"],
      updatedAt: 1_800_000_000_000,
    }],
    pendingFlows: [],
    activeAccounts: [{ installationId: "workspace:github", methodId: "oauth", accountId: "personal" }],
  };
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  await writeFile(join(legacyDirectory, "workspace.vault"), JSON.stringify({
    schemaVersion: 1,
    algorithm: "aes-256-gcm",
    iv: initializationVector.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  }));

  expect(await migrateLegacyPluginAuthorization(config)).toBe(1);
  expect(await exists(join(root, "plugin-authorization.key"))).toBe(false);
  expect(await exists(legacyDirectory)).toBe(false);
  expect((await readFile(join(root, "authorization.key"), "utf8")).trim()).toBe(key.toString("base64"));

  const method = pluginAuthorizationMethodSchema.parse({ ...legacyMethod, connectionId: "github" });
  expect(await (await authorizationVault(config)).readActiveCredential({
    consumerId: "plugin:github",
    connectionId: "github",
    methodId: "oauth",
    methodFingerprint: authorizationMethodFingerprint(method),
  })).toEqual({
    accountId: "personal",
    values: { accessToken: "legacy-token", refreshToken: "legacy-refresh" },
  });
});
