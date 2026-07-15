import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EnvService } from "../env-file.js";
import type { ServerConfig } from "../types.js";
import { callStorageExtensionAction, STORAGE_EXTENSION_ID, withTemporaryWorkspaceObject } from "./storage.js";

const nativeFetch = globalThis.fetch;
const directories: string[] = [];

function env(values: Record<string, string>): EnvService {
  return {
    list: async () => Object.entries(values).map(([key, value]) => ({ key, value, updatedAt: 0 })),
  } as unknown as EnvService;
}

afterEach(async () => {
  globalThis.fetch = nativeFetch;
  while (directories.length) {
    const directory = directories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

async function workspaceConfig() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-storage-"));
  directories.push(root);
  await writeFile(join(root, "clip.mp4"), "video bytes");
  await writeFile(join(root, "site.html"), "<!doctype html><title>Published</title>");
  return {
    root,
    config: {
      workspaces: [{ id: "workspace-1", path: root, name: "Storage test" }],
    } as unknown as ServerConfig,
  };
}

describe("Storage Center extension", () => {
  test("uploads a workspace file to Alibaba OSS without exposing credentials", async () => {
    const { root, config } = await workspaceConfig();
    globalThis.fetch = ((input, init) => {
      expect(String(input)).toBe("https://private-assets.oss-cn-hangzhou.aliyuncs.com/ipollowork/workspace-1/clip.mp4");
      expect(init?.method).toBe("PUT");
      expect(init?.headers).toMatchObject({
        "x-oss-content-sha256": "UNSIGNED-PAYLOAD",
        Authorization: expect.stringContaining("Credential=LTAItest/"),
        "Content-Disposition": "inline",
      });
      expect(JSON.stringify(init)).not.toContain("test-secret");
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch;

    const result = await callStorageExtensionAction(config, env({
      ALIYUN_OSS_ACCESS_KEY_ID: "LTAItest",
      ALIYUN_OSS_ACCESS_KEY_SECRET: "test-secret",
      ALIYUN_OSS_BUCKET: "private-assets",
      ALIYUN_OSS_REGION: "cn-hangzhou",
      ALIYUN_OSS_PUBLIC_BASE_URL: "https://assets.example.com",
    }), "upload_workspace_file", { sourcePath: "clip.mp4" }, { directory: root });

    expect(result).toMatchObject({
      ok: true,
      extensionId: STORAGE_EXTENSION_ID,
      action: "upload_workspace_file",
      result: {
        provider: "aliyun-oss",
        objectKey: "ipollowork/workspace-1/clip.mp4",
        sourcePath: "clip.mp4",
        bytes: 11,
        downloadUrl: "https://assets.example.com/ipollowork/workspace-1/clip.mp4",
      },
    });
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });

  test("publishes HTML with a browser content type and inline disposition", async () => {
    const { root, config } = await workspaceConfig();
    globalThis.fetch = ((input, init) => {
      expect(String(input)).toBe("https://private-assets.oss-cn-hangzhou.aliyuncs.com/published/site.html");
      expect(init?.headers).toMatchObject({
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": "inline",
        Authorization: expect.stringContaining("AdditionalHeaders=content-disposition;host"),
      });
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch;

    const result = await callStorageExtensionAction(config, env({
      ALIYUN_OSS_ACCESS_KEY_ID: "LTAItest",
      ALIYUN_OSS_ACCESS_KEY_SECRET: "test-secret",
      ALIYUN_OSS_BUCKET: "private-assets",
      ALIYUN_OSS_REGION: "cn-hangzhou",
      ALIYUN_OSS_PUBLIC_BASE_URL: "https://assets.example.com",
    }), "upload_workspace_file", { sourcePath: "site.html", objectKey: "published/site.html" }, { directory: root });

    expect(result).toMatchObject({ ok: true, result: { downloadUrl: "https://assets.example.com/published/site.html" } });
  });

  test("uses Wasabi's regional S3 endpoint and V4 signed request", async () => {
    const { root, config } = await workspaceConfig();
    globalThis.fetch = ((input, init) => {
      expect(String(input)).toBe("https://s3.us-east-1.wasabisys.com/media/ipollowork/workspace-1/clip.mp4");
      expect(init?.method).toBe("PUT");
      expect(init?.headers).toMatchObject({
        "x-amz-content-sha256": expect.any(String),
        Authorization: expect.stringContaining("Credential=WasabiAccess/"),
        "Content-Disposition": "inline",
      });
      expect(JSON.stringify(init)).not.toContain("wasabi-secret");
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch;

    const result = await callStorageExtensionAction(config, env({
      WASABI_ACCESS_KEY_ID: "WasabiAccess",
      WASABI_SECRET_ACCESS_KEY: "wasabi-secret",
      WASABI_BUCKET: "media",
      WASABI_REGION: "us-east-1",
    }), "upload_workspace_file", { sourcePath: "clip.mp4" }, { directory: root });

    expect(result).toMatchObject({ ok: true, result: { provider: "wasabi", sourcePath: "clip.mp4" } });
    expect(JSON.stringify(result)).not.toContain("wasabi-secret");
  });

  test("does not let an upload escape the active workspace", async () => {
    const { root, config } = await workspaceConfig();
    await expect(callStorageExtensionAction(config, env({}), "upload_workspace_file", {
      sourcePath: "../outside.mp4",
    }, { directory: root })).rejects.toMatchObject({ code: "invalid_path" });
  });

  test("uses a short-lived Wasabi read URL and cleans up the temporary object when the provider fails", async () => {
    const { root, config } = await workspaceConfig();
    const methods: string[] = [];
    globalThis.fetch = ((input, init) => {
      methods.push(init?.method ?? "GET");
      expect(String(input)).toContain("https://s3.us-east-1.wasabisys.com/media/ipollowork/temp/voice-clone/");
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch;

    await expect(withTemporaryWorkspaceObject({
      config,
      env: env({
        WASABI_ACCESS_KEY_ID: "WasabiAccess",
        WASABI_SECRET_ACCESS_KEY: "wasabi-secret",
        WASABI_BUCKET: "media",
        WASABI_REGION: "us-east-1",
      }),
      context: { directory: root },
      sourcePath: "clip.mp4",
      purpose: "voice-clone",
      maxBytes: 1024,
      use: async (url) => {
        expect(url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
        expect(url).toContain("X-Amz-Expires=600");
        expect(url).not.toContain("wasabi-secret");
        throw new Error("provider failed");
      },
    })).rejects.toThrow("provider failed");

    expect(methods).toEqual(["PUT", "DELETE"]);
  });
});
