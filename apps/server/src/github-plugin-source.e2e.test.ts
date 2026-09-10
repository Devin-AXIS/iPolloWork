import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import { parseCompatibleGitHubPluginSource, resolveGitHubReleasePluginBundle } from "./github-plugin-source.js";
import type { ServerConfig } from "./types.js";

type Served = { port: number; stop: (closeActiveConnections?: boolean) => void | Promise<void> };

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];
let previousEnv: Record<string, string | undefined> = {};

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previousEnv = {};
});

function setEnv(key: string, value: string) {
  if (!(key in previousEnv)) previousEnv[key] = process.env[key];
  process.env[key] = value;
}

const PLUGIN_FILES: Record<string, string> = {
  ".claude-plugin/plugin.json": JSON.stringify({
    name: "slack",
    displayName: "Slack",
    description: "Slack integration for searching messages and sending communications",
    version: "1.0.0",
  }),
  ".mcp.json": JSON.stringify({
    mcpServers: {
      slack: { url: "https://mcp.slack.com/mcp" },
      "local-helper": { command: "${CLAUDE_PLUGIN_ROOT}/bin/run" },
    },
  }),
  "skills/slack-search/SKILL.md": [
    "---",
    "name: slack-search",
    "description: Search Slack messages effectively",
    "---",
    "",
    "Use the slack MCP tools to search.",
  ].join("\n"),
  "skills/slack-search/references/tips.md": "Extra reference file.",
  "commands/standup.md": [
    "---",
    "description: Compile a standup update from Slack",
    "---",
    "",
    "Summarize recent messages.",
  ].join("\n"),
  "README.md": "# Slack plugin",
};

function startMockGithub(options?: { branch?: string }) {
  const branch = options?.branch ?? "main";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      // API: repo info
      if (url.pathname === "/repos/slackapi/slack-mcp-plugin") {
        return Response.json({ default_branch: branch });
      }
      // API: recursive tree (ref may arrive %2F-encoded for slash branches)
      const treePrefix = "/repos/slackapi/slack-mcp-plugin/git/trees/";
      if (url.pathname.startsWith(treePrefix)) {
        const ref = decodeURIComponent(url.pathname.slice(treePrefix.length));
        if (ref !== branch) return Response.json({ message: "not found" }, { status: 404 });
        return Response.json({
          tree: Object.keys(PLUGIN_FILES).map((path) => ({ path, type: "blob", sha: `sha-${path}` })),
        });
      }
      // Raw files (slash-branch refs appear as literal path segments)
      const rawPrefix = `/slackapi/slack-mcp-plugin/${branch}/`;
      if (url.pathname.startsWith(rawPrefix)) {
        const path = decodeURIComponent(url.pathname.slice(rawPrefix.length));
        const content = PLUGIN_FILES[path];
        if (content !== undefined) return new Response(content);
      }
      return Response.json({ message: "not found" }, { status: 404 });
    },
  }) as Served;
  stops.push(() => server.stop(true));
  return server;
}

function startMockOpencode() {
  const requests: Array<{ method: string; pathname: string }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push({ method: request.method, pathname: url.pathname });
      return Response.json({});
    },
  }) as Served;
  stops.push(() => server.stop(true));
  return { server, requests };
}

async function startiPolloWork(options?: { branch?: string }) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ipollowork-github-plugin-"));
  roots.push(workspaceRoot);
  setEnv("IPOLLOWORK_RUNTIME_DB", join(workspaceRoot, "runtime.sqlite"));

  const github = startMockGithub(options);
  setEnv("IPOLLOWORK_GITHUB_API_BASE", `http://127.0.0.1:${github.port}`);
  setEnv("IPOLLOWORK_GITHUB_RAW_BASE", `http://127.0.0.1:${github.port}`);

  const engine = startMockOpencode();
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [
      {
        id: "ws_1",
        name: "Workspace",
        path: workspaceRoot,
        preset: "starter",
        workspaceType: "local",
        baseUrl: `http://127.0.0.1:${engine.server.port}`,
      },
    ],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config) as Served;
  stops.push(() => server.stop(true));
  return {
    base: `http://127.0.0.1:${server.port}`,
    headers: { Authorization: "Bearer owt_test_token", "Content-Type": "application/json" },
    workspaceRoot,
    engine,
  };
}

describe("parseCompatibleGitHubPluginSource", () => {
  test("parses URL variants", () => {
    expect(parseCompatibleGitHubPluginSource("https://github.com/slackapi/slack-mcp-plugin")).toEqual({
      owner: "slackapi",
      repo: "slack-mcp-plugin",
      ref: null,
      dir: null,
      treeSegments: null,
    });
    expect(parseCompatibleGitHubPluginSource("github.com/slackapi/slack-mcp-plugin.git")).toEqual({
      owner: "slackapi",
      repo: "slack-mcp-plugin",
      ref: null,
      dir: null,
      treeSegments: null,
    });
    expect(parseCompatibleGitHubPluginSource("https://github.com/a/b/tree/dev/plugins/x")).toEqual({
      owner: "a",
      repo: "b",
      ref: "dev",
      dir: "plugins/x",
      treeSegments: ["dev", "plugins", "x"],
    });
    // Query strings and hash fragments are ignored.
    expect(parseCompatibleGitHubPluginSource("https://github.com/a/b?tab=readme-ov-file#readme")).toEqual({
      owner: "a",
      repo: "b",
      ref: null,
      dir: null,
      treeSegments: null,
    });
    expect(parseCompatibleGitHubPluginSource("https://github.com/a/b/tree/dev/plugins/x?x=1")).toEqual({
      owner: "a",
      repo: "b",
      ref: "dev",
      dir: "plugins/x",
      treeSegments: ["dev", "plugins", "x"],
    });
    expect(() => parseCompatibleGitHubPluginSource("https://gitlab.com/a/b")).toThrow();
    expect(() => parseCompatibleGitHubPluginSource("not a url")).toThrow();
  });
});

describe("compatible GitHub plugin sources", () => {
  test("dryRun returns the Will-install preview with warnings", async () => {
    const ipollowork = await startiPolloWork();

    const response = await fetch(`${ipollowork.base}/workspace/ws_1/plugin-packages/import/github`, {
      method: "POST",
      headers: ipollowork.headers,
      body: JSON.stringify({ url: "https://github.com/slackapi/slack-mcp-plugin", dryRun: true }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      preview: { manifest: { name: string } };
      source: { name: string; version: string | null; components: Array<{ type: string; name: string }>; warnings: string[] };
    };

    expect(body.preview.manifest.name).toBe("Slack");
    expect(body.source.version).toBe("1.0.0");
    const byType = (type: string) => body.source.components.filter((entry) => entry.type === type).map((entry) => entry.name);
    expect(byType("mcp")).toEqual(["slack"]);
    expect(byType("skill")).toEqual(["slack-search"]);
    expect(byType("command")).toEqual(["standup"]);
    // local-helper uses ${CLAUDE_PLUGIN_ROOT} and must be skipped with a warning.
    expect(body.source.warnings.some((warning) => warning.includes("local-helper"))).toBe(true);
    // Nothing installed on dryRun.
    expect(existsSync(join(ipollowork.workspaceRoot, ".opencode/skills/github-slackapi-slack-mcp-plugin"))).toBe(false);
  });

  test("resolves branch names containing slashes in /tree/ URLs", async () => {
    const ipollowork = await startiPolloWork({ branch: "release/v1" });

    const response = await fetch(`${ipollowork.base}/workspace/ws_1/plugin-packages/import/github`, {
      method: "POST",
      headers: ipollowork.headers,
      body: JSON.stringify({
        url: "https://github.com/slackapi/slack-mcp-plugin/tree/release/v1",
        dryRun: true,
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { source: { name: string; source: { ref: string; dir: string | null } } };
    // "release" fails as a ref, so the resolver falls through to "release/v1".
    expect(body.source.source.ref).toBe("release/v1");
    expect(body.source.source.dir).toBeNull();
    expect(body.source.name).toBe("Slack");
  });

  test("installs skills, commands, and MCP servers; uninstall cleans up", async () => {
    const ipollowork = await startiPolloWork();

    const installResponse = await fetch(`${ipollowork.base}/workspace/ws_1/plugin-packages/import/github`, {
      method: "POST",
      headers: ipollowork.headers,
      body: JSON.stringify({ url: "https://github.com/slackapi/slack-mcp-plugin" }),
    });
    expect(installResponse.status).toBe(200);
    const installBody = await installResponse.json() as { item: { pluginId: string } };
    expect(installBody.item.pluginId).toBe("github-slackapi-slack-mcp-plugin");

    // Skill and command land namespaced under .opencode/.
    const skillPath = join(ipollowork.workspaceRoot, ".opencode/skills/github-slackapi-slack-mcp-plugin/slack-search/SKILL.md");
    const commandPath = join(ipollowork.workspaceRoot, ".opencode/commands/github-slackapi-slack-mcp-plugin/standup.md");
    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync(commandPath)).toBe(true);
    expect(await readFile(skillPath, "utf8")).toContain("Search Slack messages effectively");

    // MCP registered in the runtime DB and pushed to the engine.
    const listResponse = await fetch(`${ipollowork.base}/workspace/ws_1/mcp`, { headers: ipollowork.headers });
    const listBody = await listResponse.json() as { items: Array<{ name: string; source: string }> };
    const slackEntry = listBody.items.find((entry) => entry.name === "slack");
    expect(slackEntry?.source).toBe("config.remote");

    // Uninstall through the one global plugin-package lifecycle.
    const removeResponse = await fetch(
      `${ipollowork.base}/workspace/ws_1/plugin-packages/${encodeURIComponent(installBody.item.pluginId)}`,
      { method: "DELETE", headers: ipollowork.headers },
    );
    expect(removeResponse.status).toBe(200);
    expect(existsSync(skillPath)).toBe(false);
    expect(existsSync(commandPath)).toBe(false);
    const afterRemove = await fetch(`${ipollowork.base}/workspace/ws_1/mcp`, { headers: ipollowork.headers });
    const afterRemoveBody = await afterRemove.json() as { items: Array<{ name: string }> };
    expect(afterRemoveBody.items.some((entry) => entry.name === "slack")).toBe(false);
  });
});

// Public signed fixtures; no private signing material is stored in the test suite.
const releaseSignatures = {
  "1.0.0": {
    "checksum": {
      "algorithm": "sha256",
      "value": "4f78cbe79d91a22dc24430675e7662cd8a94d8c4ea3f3f51760f329223875e6b"
    },
    "signature": {
      "algorithm": "ed25519",
      "keyId": "social-plugins-2026",
      "value": "GYUb/YdSBMAManZJM5h52q4cYPIT0j86Bf9f/H3GeAirPSR072f2nf67AHm5Ccw6S3Y5fMn9CKEVafaoaa5bBg=="
    }
  },
  "1.0.1": {
    "checksum": {
      "algorithm": "sha256",
      "value": "81cf72e936903beba2871c771f2aaff9a12c4ec07fe1ef697eba02ca000da831"
    },
    "signature": {
      "algorithm": "ed25519",
      "keyId": "social-plugins-2026",
      "value": "/guQd9Bfr0bR5i0V6GEPcGRn9U6+4n1qZLqSQefrGlvgymXk9TecRVc4hIRQa2AiIt4bTwBFD0qpp2FSvJGSBA=="
    }
  }
};
function releaseUpload(version: keyof typeof releaseSignatures) {
  const manifest = {
  "schemaVersion": 2,
  "id": "xiaohongshu-ops",
  "name": "Release fixture",
  "description": "Signed release fixture",
  "source": {
    "format": "ipollowork-extension-manifest",
    "origin": "local",
    "trusted": false
  },
  "package": {
    "version": "1.0.0",
    "updateId": "zjy-web222/release-fixture",
    "publisher": {
      "id": "zjy-web222",
      "name": "zjy-web222"
    }
  },
  "resources": [
    {
      "type": "skill",
      "id": "release-fixture",
      "path": "skills/release-fixture/SKILL.md"
    }
  ]
};
  return { archiveName: "xiaohongshu-ops.ipollowork-plugin", files: [
    { path: "ipollowork.plugin.json", contentBase64: Buffer.from(JSON.stringify({ ...manifest, package: { ...manifest.package, version, ...releaseSignatures[version] } })).toString("base64") },
    { path: "skills/release-fixture/SKILL.md", contentBase64: Buffer.from("# Release fixture\n").toString("base64") },
  ] };
}

function mockRelease() {
  const state: { version: keyof typeof releaseSignatures; unavailable: boolean; prerelease: boolean; oversized: boolean; tamper: boolean; unsafePath: boolean; assetRequests: number } =
    { version: '1.0.0', unavailable: false, prerelease: false, oversized: false, tamper: false, unsafePath: false, assetRequests: 0 };
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (state.unavailable) return new Response('Unavailable', { status: 503 });
    if (path === '/repos/zjy-web222/ipollo-rednote-plugin/releases/latest') return Response.json({ draft: false, prerelease: state.prerelease, tag_name: 'v' + state.version,
      assets: [{ id: 123, name: 'plugin-package.json', size: state.oversized ? 16 * 1024 * 1024 : 2000 }] });
    if (path === '/repos/zjy-web222/ipollo-rednote-plugin/releases/assets/123') {
      state.assetRequests++;
      const upload = releaseUpload(state.version);
      if (state.tamper) upload.files[1]!.contentBase64 = Buffer.from('Tampered content').toString('base64');
      if (state.unsafePath) upload.files[1]!.path = '../outside.md';
      return Response.json(upload);
    }
    return new Response('Not found', { status: 404 });
  } });
  stops.push(() => server.stop(true));
  setEnv('IPOLLOWORK_GITHUB_API_BASE', `http://127.0.0.1:${server.port}`);
  return state;
}

test('GitHub catalog installs the latest signed release at click time and preserves installed data on failures', async () => {
  const host = await startiPolloWork();
  const release = mockRelease();
  const catalog = await (await fetch(`${host.base}/workspace/ws_1/plugin-packages/catalog`, { headers: host.headers })).json();
  expect(catalog.items).toContainEqual(expect.objectContaining({ pluginId: 'xiaohongshu-ops', version: '1.0.0', integrity: expect.objectContaining({ status: 'verified' }) }));
  expect(catalog.errors.some((error: string) => error.startsWith('douyin-ops:'))).toBe(true);
  release.version = '1.0.1';
  const install = () => fetch(`${host.base}/workspace/ws_1/plugin-packages/catalog/xiaohongshu-ops/install`, { method: 'POST', headers: host.headers });
  const result = await install();
  expect(result.status).toBe(200);
  expect((await result.json()).result).toMatchObject({ pluginId: 'xiaohongshu-ops', version: '1.0.1' });
  const imported = await fetch(`${host.base}/workspace/ws_1/plugin-packages/import/github`, { method: 'POST', headers: host.headers, body: JSON.stringify({ url: 'https://github.com/zjy-web222/ipollo-rednote-plugin', dryRun: true }) });
  expect(imported.status).toBe(200);
  expect((await imported.json()).preview).toMatchObject({ installedVersion: '1.0.1', safety: { level: 'signed' } });
  release.version = '1.0.0';
  expect((await install()).status).toBe(409);
  release.tamper = true;
  const tampered = await install();
  expect(tampered.status).toBe(400);
  expect((await tampered.json()).code).toBe('plugin_package_checksum_mismatch');
  release.unavailable = true;
  expect((await install()).status).toBe(502);
  const failedCatalog = await (await fetch(`${host.base}/workspace/ws_1/plugin-packages/catalog`, { headers: host.headers })).json();
  expect(failedCatalog.items.some((item: { pluginId: string }) => item.pluginId === 'figma')).toBe(true);
  expect(failedCatalog.errors.some((error: string) => error.startsWith('xiaohongshu-ops:'))).toBe(true);
  const installed = await (await fetch(`${host.base}/workspace/ws_1/plugin-packages`, { headers: host.headers })).json();
  expect(installed.items).toContainEqual(expect.objectContaining({ pluginId: 'xiaohongshu-ops', version: '1.0.1' }));
});

test('GitHub releases reject prereleases, excessive downloads and path traversal before materialization', async () => {
  const release = mockRelease();
  release.prerelease = true;
  await expect(resolveGitHubReleasePluginBundle('xiaohongshu-ops')).rejects.toMatchObject({ code: 'plugin_release_invalid' });
  release.prerelease = false; release.oversized = true;
  await expect(resolveGitHubReleasePluginBundle('xiaohongshu-ops')).rejects.toMatchObject({ code: 'plugin_release_asset_missing' });
  expect(release.assetRequests).toBe(0);
  release.oversized = false; release.unsafePath = true;
  await expect(resolveGitHubReleasePluginBundle('xiaohongshu-ops')).rejects.toMatchObject({ code: 'plugin_package_upload_path_invalid' });
});
