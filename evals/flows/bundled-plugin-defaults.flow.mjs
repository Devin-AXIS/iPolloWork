import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export default {
  id: "bundled-plugin-defaults",
  title: "Bundled plugins install by default and retain user choices after restart",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "Install the real bundled collection in an isolated production profile",
    run: async ctx => {
      const { startServer } = await import("../../apps/server/src/server.ts");
      const { bundledPluginPackageIds, catalogPluginPackageIds } = await import("../../apps/server/src/plugin-package-catalog.ts");
      const { listInstalledPluginPackages, listSuppressedDefaultPluginIds } = await import("../../apps/server/src/plugin-package-lifecycle.ts");
      const { disposeRuntimeOpencodeConfigStore } = await import("../../apps/server/src/runtime-opencode-config-store.ts");
      const { disposeiPolloWorkWorkspaceConfigStore } = await import("../../apps/server/src/ipollowork-workspace-config-store.ts");
      const { disposeTemplateStore } = await import("../../apps/server/src/templates.ts");
      const profile = await mkdtemp(join(tmpdir(), "ipollowork-bundled-defaults-proof-"));
      const workspace = join(profile, "workspace");
      await mkdir(workspace);
      const envNames = ["IPOLLOWORK_DEV_MODE", "IPOLLOWORK_LOCAL_PLUGIN_PACKAGES_DIR", "IPOLLOWORK_BUNDLED_PLUGIN_PACKAGES_DIR", "IPOLLOWORK_RUNTIME_DB"];
      const previousEnv = new Map(envNames.map(name => [name, process.env[name]]));
      delete process.env.IPOLLOWORK_DEV_MODE;
      delete process.env.IPOLLOWORK_LOCAL_PLUGIN_PACKAGES_DIR;
      process.env.IPOLLOWORK_BUNDLED_PLUGIN_PACKAGES_DIR = fileURLToPath(new URL("../../examples/plugin-packages", import.meta.url));
      process.env.IPOLLOWORK_RUNTIME_DB = join(profile, "runtime.sqlite");
      const config = {
        host: "127.0.0.1", port: 0, token: "isolated-proof-token", hostToken: "isolated-proof-host",
        configPath: join(profile, "server.json"), approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [],
        workspaces: [{ id: "ws_bundled_defaults", name: "Bundled defaults proof", path: workspace, preset: "starter", workspaceType: "local", engineId: "opencode" }],
        authorizedRoots: [workspace], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated",
        logFormat: "json", logRequests: false,
      };
      let server;
      let installed;
      let restarted;
      const request = async (suffix = "", method = "GET", body) => {
        const response = await fetch(`http://127.0.0.1:${server.port}/workspace/ws_bundled_defaults/plugin-packages${suffix}`, {
          method, headers: { authorization: "Bearer isolated-proof-token", "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const data = await response.json();
        ctx.assert(response.ok, `${method} ${suffix || "inventory"}: ${response.status} ${JSON.stringify(data)}`);
        return data;
      };
      try {
        await ctx.prove("首次打开插件列表时，软件内置插件已经全部安装", {
          voiceover: "全新的用户配置会自动安装软件提供的整套内置插件，列表中可以直接管理它们。",
          action: async () => {
            server = await startServer(config);
            installed = (await request()).items;
          },
          assert: async () => {
            const expected = [...catalogPluginPackageIds].sort();
            const actual = installed.map(item => item.pluginId).sort();
            ctx.assert(JSON.stringify(actual) === JSON.stringify(expected), `Installed catalog: ${JSON.stringify(actual)}`);
            ctx.assert(installed.every(item => item.enabled), "All fresh bundled plugins are enabled");
            const all = await listInstalledPluginPackages({ serverConfig: config });
            ctx.assert(all.length === bundledPluginPackageIds.length && all.some(item => item.pluginId === "reference-context"), "Internal reference capabilities remain installed");
            await access(join(workspace, ".opencode/skills/figma-use/SKILL.md"));
            ctx.assert(JSON.stringify((await request()).items) === JSON.stringify(installed), "Refreshing inventory is idempotent");
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Every real bundled package is installed and enabled in a clean production profile", actual: { visiblePlugins: actual, totalInstalled: all.length } });
            await ctx.output("installed-bundled-plugins", JSON.stringify(installed.map(({ pluginId, version, enabled }) => ({ pluginId, version, enabled })), null, 2));
          },
        });
        await ctx.prove("主动停用或卸载后，重启会保留用户的选择", {
          voiceover: "停用 GitHub、卸载操作录制后，重新启动仍保留这两个选择，也可以从内置目录重新安装。",
          action: async () => {
            await request("/github", "PATCH", { enabled: false });
            await request("/operation-recorder", "DELETE");
            await server.stop();
            server = await startServer(config);
            restarted = (await request()).items;
          },
          assert: async () => {
            ctx.assert(restarted.find(item => item.pluginId === "github")?.enabled === false, "GitHub remains disabled after restart");
            ctx.assert(!restarted.some(item => item.pluginId === "operation-recorder"), "Operation Recorder remains uninstalled after restart");
            ctx.assert((await listSuppressedDefaultPluginIds({ serverConfig: config })).includes("operation-recorder"), "The explicit uninstall is persisted");
            ctx.assert(restarted.length === catalogPluginPackageIds.length - 1, "Other bundled plugins remain installed");
            const result = await request("/catalog/operation-recorder/install", "POST");
            ctx.assert(result.result.status === "installed", "Explicit reinstall uses the existing catalog lifecycle");
            ctx.assert(!(await listSuppressedDefaultPluginIds({ serverConfig: config })).includes("operation-recorder"), "Reinstall clears the uninstall preference");
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "A real server restart retains disabling and uninstalling; explicit reinstall restores the bundled package", actual: { disabled: "github", uninstalled: "operation-recorder", reinstall: result.result.status } });
            await ctx.output("retained-user-choices", JSON.stringify({ githubEnabled: restarted.find(item => item.pluginId === "github")?.enabled, recorderInstalledAfterRestart: false, reinstall: result.result.status }, null, 2));
          },
        });
      } finally {
        try {
          await server?.stop();
          await Promise.all([disposeRuntimeOpencodeConfigStore(config), disposeiPolloWorkWorkspaceConfigStore(config), disposeTemplateStore(config)]);
        } finally {
          for (const [name, value] of previousEnv) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
          }
          if (dirname(profile) !== resolve(tmpdir()) || !basename(profile).startsWith("ipollowork-bundled-defaults-proof-")) throw new Error("Unexpected proof profile path");
          await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
      }
    },
  }],
};
