import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { createEnginePackageManager } from "../../apps/desktop/electron/engine-package-manager.mjs";
import { fetchDesktopResourceManifest } from "../../apps/desktop/electron/desktop-resource-manifest.mjs";
import { DESKTOP_RESOURCE_APP_VERSION } from "../../apps/desktop/electron/app-version.mjs";

export default {
  id: "desktop-resource-install",
  title: "Signed native release archives install, start and remain available offline",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "Install both engines on the native release runner",
    run: async (ctx) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-resource-proof-"));
      const baseUrl = "http://i.ipollo.ai";
      const archiveDirectory = process.env.IPOLLOWORK_RESOURCE_PROOF_ARCHIVE_DIR;
      const verifiedArchives = new Map();
      const constants = JSON.parse(await readFile(new URL("../../constants.json", import.meta.url), "utf8"));
      const versions = { opencode: constants.opencodeVersion, codexHarness: constants.codexHarnessVersion, deepseekHarness: constants.deepseekHarnessVersion };
      const home = path.join(root, "home");
      const environment = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, "app-data"), LOCALAPPDATA: path.join(home, "local-app-data"), ProgramFiles: path.join(home, "program-files") };
      for (const key of Object.keys(environment)) {
        if (/^IPOLLOWORK_(CODEX|DSH)_/.test(key)) delete environment[key];
        if (key.toLowerCase() === "path") delete environment[key];
      }
      environment.PATH = path.dirname(process.execPath);
      const options = {
        app: { getPath: () => root, getVersion: () => DESKTOP_RESOURCE_APP_VERSION, isPackaged: true },
        desktopRoot: path.join(root, "desktop"), homeDir: path.join(root, "home"), versions,
        env: environment,
        fetch: (url, init) => {
          const cached = verifiedArchives.get(String(url));
          return cached
            ? new Response(Readable.toWeb(createReadStream(cached.file)), { headers: { "Content-Length": String(cached.size) } })
            : fetch(url, init);
        },
      };
      try {
        await ctx.prove("Cloud download endpoints serve the signed release and both native engines install and work offline", {
          voiceover: archiveDirectory
            ? "The public cloud signs all four archives and serves their actual download ranges. This clean native runner checks the full published archives against those signed hashes, installs both engines, starts them, and reuses the installed copies offline. Full cloud transfer speed is not measured by this proof."
            : "This clean release runner downloads both engines from the signed cloud release for its own operating system and processor. Their checksums pass, the engines start, and a new manager reuses the installed copies offline.",
          assert: async () => {
            const manifest = await fetchDesktopResourceManifest({ baseUrl, appVersion: DESKTOP_RESOURCE_APP_VERSION, platform: process.platform, arch: process.arch, fetch });
            for (const resource of manifest.resources) {
              const head = await fetch(resource.url, { method: "HEAD", signal: AbortSignal.timeout(30_000) });
              ctx.assert(head.ok && Number(head.headers.get("content-length")) === resource.sizeBytes, `${resource.id} HEAD matches the signed size`);
              const range = await fetch(resource.url, { headers: { Range: "bytes=0-1" }, signal: AbortSignal.timeout(30_000) });
              const bytes = Buffer.from(await range.arrayBuffer());
              ctx.assert(range.status === 206 && bytes.equals(Buffer.from([0x1f, 0x8b])), `${resource.id} supports an actual gzip range download`);
              if (archiveDirectory) {
                ctx.assert(path.basename(resource.fileName) === resource.fileName, `${resource.id} has a safe archive name`);
                const file = path.resolve(archiveDirectory, resource.fileName);
                const hash = createHash("sha256");
                for await (const chunk of createReadStream(file)) hash.update(chunk);
                ctx.assert((await stat(file)).size === resource.sizeBytes && hash.digest("hex") === resource.sha256, `${resource.id} complete published archive matches the signed cloud size and SHA-256`);
                const tail = await fetch(resource.url, { headers: { Range: `bytes=${resource.sizeBytes - 2}-` }, signal: AbortSignal.timeout(30_000) });
                const handle = await open(file, "r");
                const expected = Buffer.alloc(2);
                try { await handle.read(expected, 0, 2, resource.sizeBytes - 2); } finally { await handle.close(); }
                ctx.assert(tail.status === 206 && Buffer.from(await tail.arrayBuffer()).equals(expected), `${resource.id} cloud download also serves the matching archive tail`);
                verifiedArchives.set(resource.url, { file, size: resource.sizeBytes });
              }
            }
            ctx.output("Archive transport", archiveDirectory ? "Complete published archives; live cloud signature, HEAD and prefix/tail range checks. Full cloud download throughput is not asserted." : "Complete downloads from the public cloud.");
            const manager = createEnginePackageManager(options);
            for (const id of ["codex-harness", "deepseek-harness"]) {
              const installed = await manager.install(id, baseUrl);
              ctx.assert(installed.status === "ready" && installed.source === "downloaded", `${id} verified, extracted and started through the engine package manager`);
              const cli = id === "deepseek-harness" ? environment.IPOLLOWORK_DSH_CLI : environment.IPOLLOWORK_CODEX_CLI;
              const command = id === "deepseek-harness" ? environment.IPOLLOWORK_DSH_NODE_BIN : cli.endsWith(".js") ? process.execPath : cli;
              const args = command === cli ? ["--version"] : [cli, "--version"];
              const probe = spawnSync(command, args, { encoding: "utf8", timeout: 30_000, windowsHide: true, env: environment });
              ctx.assert(probe.status === 0 && (probe.stdout + probe.stderr).includes(installed.version), `${id} starts and reports its pinned version: ${probe.stderr}`);
              ctx.output(id, JSON.stringify({ platform: process.platform, arch: process.arch, version: installed.version, status: installed.status, source: installed.source, probe: probe.stdout.trim() }));
            }
            // Do not let environment paths set by the first manager substitute for its saved installation.
            for (const key of Object.keys(environment)) {
              if (/^IPOLLOWORK_(CODEX|DSH)_/.test(key)) delete environment[key];
            }
            const offline = createEnginePackageManager({ ...options, fetch: async () => { throw new Error("Offline proof must not download"); } });
            const packages = await offline.list();
            for (const id of ["codex-harness", "deepseek-harness"]) {
              const installed = packages.find(item => item.id === id);
              ctx.assert(installed?.status === "ready" && installed.source === "downloaded", `${id} remains ready in a fresh offline manager`);
            }
          },
        });
      } finally { await rm(root, { recursive: true, force: true }); }
    },
  }],
};
