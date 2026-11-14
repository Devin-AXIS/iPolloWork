import test from "node:test";
import assert from "node:assert/strict";
import { Services } from "../src/host/services.ts";
import { AccountService } from "../src/host/account.ts";
import { resolveConfig } from "../src/host/config.ts";
import type { CredentialStore } from "../src/shared/types.ts";

test("official source stays host-only and changing accounts invalidates an active binding", async () => {
  const records = new Map<string, { kind: string; payload?: unknown }>();
  records.set("ipollowork-suite/account", {
    kind: "grant",
    payload: {
      version: 1,
      origin: "https://accounts.test",
      token: "account-secret",
    },
  });
  const credentials: CredentialStore = {
    readRecord: async (key) => records.get(key),
    modifyRecord: async (key, fn) => {
      const value = await fn(records.get(key));
      records.set(key, value);
      return value;
    },
    deleteRecord: async (key) => {
      records.delete(key);
    },
  };
  let executed = 0;
  const account = new AccountService(
    credentials,
    resolveConfig({ accountOrigin: "https://accounts.test" }),
    new AbortController().signal,
    async (url, init) => {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer account-secret",
      );
      if (String(url).endsWith("/services"))
        return Response.json({
          items: [
            {
              id: "bailian",
              provider: "aliyun-bailian",
              title: "百炼",
              origin: "https://provider.test",
              basePath: "/v1",
              capabilities: ["image"],
              models: [],
              routes: [{ method: "POST", path: "/images", points: 0 }],
              available: true,
            },
            {
              id: "bailian-speech",
              provider: "aliyun-bailian",
              title: "Speech",
              origin: "https://provider.test",
              basePath: "",
              capabilities: ["speech"],
              models: [],
              routes: [{ method: "POST", path: "/speech", points: 0 }],
              available: true,
            },
          ],
          points: 10,
        });
      executed++;
      assert(!String(init?.body).includes("vendor-secret"));
      return Response.json({ ok: true });
    },
  );
  const center = new Services(
      account,
      credentials,
      new AbortController().signal,
    ),
    binding = await center.bind();
  assert(await binding.official("aliyun-bailian"));
  assert(
    (
      await (
        await binding.fetch("https://provider.test/v1/images", {
          method: "POST",
          body: "{}",
          headers: { authorization: "Bearer ipollo-managed" },
        })
      ).json()
    ).ok,
  );
  assert.equal(executed, 1);
  await binding.request("aliyun-bailian", "/speech", {
    method: "POST",
    body: "{}",
  });
  assert.equal(
    executed,
    2,
    "one shared provider key must route multiple capabilities",
  );
  await center.choose("aliyun-bailian", { source: "own" });
  assert.equal(await (await center.bind()).official("aliyun-bailian"), false);
  await account.signOut();
  await assert.rejects(binding.fetch("https://provider.test/v1/images"));
});

test("own keys and legacy credentials do not depend on an available account backend", async () => {
  const credentials: CredentialStore = {
    readRecord: async () => ({
      kind: "grant",
      payload: { bailian: { source: "own" } },
    }),
    modifyRecord: async () => undefined,
    deleteRecord: async () => {},
  };
  const account = new AccountService(
    credentials,
    resolveConfig({ accountOrigin: "https://accounts.test" }),
    new AbortController().signal,
    async () => {
      throw Error("backend must not be called");
    },
  );
  const center = new Services(
    account,
    credentials,
    new AbortController().signal,
  );
  const binding = await center.bind();
  assert.equal(await binding.official("bailian"), false);
  assert.equal(await binding.official("existing-key", true), false);
});

test("publishing streams only selected outputs with the account grant and withdraws for own storage or disabled services", async () => {
  const records = new Map<string, { kind: string; payload?: unknown }>([
    [
      "ipollowork-suite/account",
      {
        kind: "grant",
        payload: {
          version: 1,
          origin: "https://accounts.test",
          token: "account-secret",
        },
      },
    ],
  ]);
  const credentials: CredentialStore = {
    readRecord: async (key) => records.get(key),
    modifyRecord: async (key, fn) => {
      const value = await fn(records.get(key));
      records.set(key, value);
      return value;
    },
    deleteRecord: async (key) => {
      records.delete(key);
    },
  };
  const visited: string[] = [];
  const account = new AccountService(
    credentials,
    resolveConfig({ accountOrigin: "https://accounts.test" }),
    new AbortController().signal,
    async (url, init) => {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer account-secret",
      );
      const path = new URL(String(url)).pathname;
      visited.push(path);
      if (path === "/api/v1/publications/status")
        return Response.json({ available: true });
      if (path === "/api/v1/projects")
        return Response.json({
          items: [{ id: "project", native_id: "workspace" }],
        });
      if (path === "/api/v1/publications") {
        const input = JSON.parse(String(init?.body));
        assert.equal(input.projectId, "project");
        assert.deepEqual(input.files, [
          { path: "design/entry.html", bytes: 6 },
        ]);
        return Response.json({ id: "publication" });
      }
      if (path === "/api/v1/publications/publication/files/design/entry.html") {
        assert.equal(init?.method, "PUT");
        assert.equal(await new Response(init?.body).text(), "<h1 />");
        return Response.json({ ok: true });
      }
      assert.equal(path, "/api/v1/publications/publication/publish");
      return Response.json({
        url: "https://publish.test/p/publication/design/entry.html",
      });
    },
  );
  const center = new Services(
    account,
    credentials,
    new AbortController().signal,
  );
  const binding = await center.bind();
  assert.equal(await binding.publicationStatus?.(), true);
  const input = {
    workspaceId: "workspace",
    entry: "design/entry.html",
    files: [
      {
        path: "design/entry.html",
        bytes: 6,
        open: () => new Blob(["<h1 />"]).stream(),
      },
    ],
  };
  assert.deepEqual(await binding.publish?.(input), {
    url: "https://publish.test/p/publication/design/entry.html",
  });
  assert.equal(visited.length, 5);
  await center.choose("aliyun-oss", { source: "own" });
  assert.equal((await center.bind()).publish, undefined);
  assert.equal(
    (
      await new Services(
        account,
        credentials,
        new AbortController().signal,
        false,
      ).bind()
    ).publish,
    undefined,
  );
  await account.signOut();
  await assert.rejects(binding.publish!(input));
});
