import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createEnginePackageManager } from "../../apps/desktop/electron/engine-package-manager.mjs";

const ENGINE_IDS = ["codex-harness", "deepseek-harness"];
const DIRECT_RELEASE_PREFIX = "https://github.com/Devin-AXIS/iPolloWork/releases/download/";
const MIRROR_PREFIXES = ["https://gh-proxy.com/", "https://ghfast.top/"];

export default {
  id: "engine-download-fallback",
  title: "Packaged Agent engines recover through verified release mirrors",
  kind: "internal",
  requiresApp: false,
  steps: [
    {
      name: "Both optional engines install after the direct release source fails",
      run: async (ctx) => {
        let temporaryRoot;
        let evidence;
        try {
          await ctx.prove("Codex and DeepSeek engine packages install through a mirror with official GitHub digests", {
            voiceover: "When the direct release download is unavailable, the packaged engine manager finds the matching official assets, switches to a mirror, verifies both packages, and finishes with usable Codex and DeepSeek command lines.",
            action: async () => {
              temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ipollowork-engine-fraimz-"));
              const constants = JSON.parse(await readFile(path.resolve("constants.json"), "utf8"));
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

              const requestedUrls = [];
              const manager = createEnginePackageManager({
                app: {
                  getPath() { return path.join(temporaryRoot, "user-data"); },
                  getVersion() { return "0.50.1"; },
                  isPackaged: true,
                },
                desktopRoot: path.resolve("apps/desktop"),
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
                fetch: async (url, init) => {
                  requestedUrls.push(String(url));
                  if (String(url).startsWith(DIRECT_RELEASE_PREFIX)) {
                    return new Response("forced direct-source failure", { status: 503 });
                  }
                  return fetch(url, init);
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
                  usedMirror: requestedUrls.some((url) => (
                    MIRROR_PREFIXES.some((mirror) => url.startsWith(mirror))
                    && url.includes(`ipollowork-engine-${engineId}-`)
                  )),
                });
              }
              evidence = {
                appVersion: "0.50.1",
                resolvedLatestRelease: requestedUrls.some((url) => url.endsWith("/releases/latest")),
                results,
              };
            },
            assert: async () => {
              ctx.assert(evidence?.resolvedLatestRelease === true, "The missing v0.50.1 release must fall back to the latest official release metadata.");
              ctx.assert(evidence?.results?.length === ENGINE_IDS.length, "Both optional engines must produce install evidence.");
              for (const result of evidence.results) {
                ctx.assert(result.status === "ready", `${result.engineId} must finish ready.`);
                ctx.assert(result.source === "downloaded", `${result.engineId} must be managed by iPolloWork.`);
                ctx.assert(result.installedBytes > 0, `${result.engineId} must install non-empty runtime files.`);
                ctx.assert(result.cliExists, `${result.engineId} must expose its installed CLI.`);
                ctx.assert(result.usedMirror, `${result.engineId} must recover through a configured mirror.`);
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
