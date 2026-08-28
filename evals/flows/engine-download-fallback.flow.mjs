import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createEnginePackageManager } from "../../apps/desktop/electron/engine-package-manager.mjs";

const ENGINE_IDS = ["codex-harness", "deepseek-harness"];

export default {
  id: "engine-download-fallback",
  title: "Packaged Agent engines install offline from verified bundled packages",
  kind: "internal",
  requiresApp: false,
  steps: [
    {
      name: "Both optional engines install while every network request is blocked",
      run: async (ctx) => {
        let temporaryRoot;
        let evidence;
        try {
          await ctx.prove("Codex and DeepSeek engine packages install from packaged resources without network access", {
            voiceover: "Even with every engine network request blocked, the packaged app verifies its bundled engine archives and finishes with usable Codex and DeepSeek command lines.",
            action: async () => {
              temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-engine-fraimz-"));
              const constants = JSON.parse(await readFile(path.resolve("constants.json"), "utf8"));
              const resourcesPath = path.resolve("apps/desktop/dist-electron/win-unpacked/resources");
              const environment = {
                ...process.env,
                PATH: path.join(temporaryRoot, "empty-bin"),
                APPDATA: path.join(temporaryRoot, "app-data"),
                LOCALAPPDATA: path.join(temporaryRoot, "local-app-data"),
                ProgramFiles: path.join(temporaryRoot, "program-files"),
              };
              for (const key of [
                "IPOLLOWORK_DSH_CLI",
                "IPOLLOWORK_DSH_CLI_VERSION",
                "IPOLLOWORK_CODEX_CLI",
                "IPOLLOWORK_CODEX_CLI_VERSION",
                "IPOLLOWORK_ENGINE_PACK_BASE_URL",
                "IPOLLOWORK_ENGINE_PACK_SOURCE_DIR",
              ]) delete environment[key];

              let networkRequests = 0;
              const manager = createEnginePackageManager({
                app: {
                  getPath() { return path.join(temporaryRoot, "user-data"); },
                  getVersion() { return "0.50.1"; },
                  isPackaged: true,
                },
                desktopRoot: path.resolve("apps/desktop"),
                resourcesPath,
                versions: {
                  opencode: constants.opencodeVersion,
                  deepseekHarness: constants.deepseekHarnessVersion,
                  codexHarness: constants.codexHarnessVersion,
                },
                platform: "win32",
                architecture: "x64",
                env: environment,
                homeDir: path.join(temporaryRoot, "home"),
                probeRuntime: async () => false,
                fetch: async () => {
                  networkRequests += 1;
                  throw new Error("network is intentionally unavailable");
                },
              });

              const results = [];
              for (const engineId of ENGINE_IDS) {
                const result = await manager.install(engineId);
                const cliKey = engineId === "codex-harness" ? "IPOLLOWORK_CODEX_CLI" : "IPOLLOWORK_DSH_CLI";
                results.push({
                  engineId,
                  status: result.status,
                  source: result.source,
                  installedBytes: result.installedBytes,
                  cliExists: Boolean(environment[cliKey] && existsSync(environment[cliKey])),
                });
              }
              evidence = {
                appVersion: "0.50.1",
                resourcesPath,
                networkRequests,
                results,
              };
            },
            assert: async () => {
              ctx.assert(evidence?.networkRequests === 0, "Bundled installs must not make a network request.");
              ctx.assert(evidence?.results?.length === ENGINE_IDS.length, "Both optional engines must produce install evidence.");
              for (const result of evidence.results) {
                ctx.assert(result.status === "ready", `${result.engineId} must finish ready.`);
                ctx.assert(result.source === "downloaded", `${result.engineId} must be managed by iPolloWork.`);
                ctx.assert(result.installedBytes > 0, `${result.engineId} must install non-empty runtime files.`);
                ctx.assert(result.cliExists, `${result.engineId} must expose its installed CLI.`);
              }
              ctx.output("Verified engine installs", JSON.stringify(evidence, null, 2));
            },
          });
        } finally {
          if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
        }
      },
    },
  ],
};
