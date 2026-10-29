import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { validateInstallers } from "../../scripts/release/publish-electron-assets.mjs";
import { createGithubInstallerProvider, releaseUpdateInfo } from "../../apps/desktop/electron/github-installer-provider.mjs";

export default {
  id: "desktop-release-installers",
  title: "The desktop release exposes six installers and supports all six in-app update targets",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "Inspect the public release and download each update payload prefix",
    run: async (ctx) => {
      await ctx.prove("Only six installers are attached, and every in-app update resolves a complete platform-specific payload", {
        voiceover: "The release lists one installer for each system and processor. All six update targets resolve correctly; Windows and Linux use those installers, while Mac's update archive comes from the cloud with its checksum anchored in the official release.",
        assert: async () => {
          const tag = process.env.IPOLLOWORK_EVAL_RELEASE_TAG || "v0.50.30";
          const release = JSON.parse(execFileSync("gh", ["api", `repos/Devin-AXIS/iPolloWork/releases/tags/${tag}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
          ctx.assert(!release.draft && !release.prerelease, "The desktop release is public and stable");
          ctx.assert(validateInstallers(release, tag).length === 0 && release.assets.length === 6, "Exactly six complete installers are published");
          const results = [];
          for (const platform of ["win32", "darwin", "linux"]) for (const arch of ["x64", "arm64"]) {
            const info = releaseUpdateInfo(release, { platform, arch });
            const file = info.files[0];
            let response;
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                response = await fetch(file.url, { headers: { Range: "bytes=0-1" }, signal: AbortSignal.timeout(30_000) });
                break;
              } catch (error) { if (attempt === 1) throw error; }
            }
            ctx.assert(response?.status === 206, `${platform}/${arch} supports actual range downloads`);
            ctx.assert(response.headers.get("content-range") === `bytes 0-1/${file.size}`, `${platform}/${arch} payload size matches trusted update metadata`);
            const bytes = Buffer.from(await response.arrayBuffer());
            const magic = platform === "win32" ? [0x4d, 0x5a] : platform === "darwin" ? [0x50, 0x4b] : [0x7f, 0x45];
            ctx.assert(bytes.equals(Buffer.from(magic)), `${platform}/${arch} payload starts with its native format signature`);
            results.push({ platform, arch, url: file.url, size: file.size, sha512: file.sha512 });
          }
          ctx.output("public-installer-and-update-delivery", JSON.stringify({ tag, installers: release.assets.map(({ name, size, digest }) => ({ name, size, digest })), updates: results }, null, 2));
        },
      });
    },
  }, ...(process.env.IPOLLOWORK_EVAL_UPDATE_DOWNLOAD === "1" ? [{
    name: "Download the full Windows update through electron-updater",
    run: async (ctx) => {
      await ctx.prove("The Windows updater detects the public release and downloads its complete installer with SHA-512 verification", {
        voiceover: "The existing updater runs with an isolated previous-version profile. It finds the public release, downloads the entire Windows installer, and reaches the ready state after checksum verification. This proof does not replace the application installed on this computer.",
        assert: async () => {
          ctx.assert(process.platform === "win32", "The full installer download runs on Windows");
          const requireDesktop = createRequire(new URL("../../apps/desktop/package.json", import.meta.url));
          const { NsisUpdater } = requireDesktop("electron-updater/out/NsisUpdater.js");
          const requireBuilder = createRequire(requireDesktop.resolve("electron-builder"));
          const { httpExecutor } = requireBuilder("builder-util/out/nodeHttpExecutor.js");
          const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-release-update-proof-"));
          const config = path.join(root, "app-update.yml");
          await writeFile(config, "updaterCacheDirName: installer-proof\n");
          const updater = new NsisUpdater(null, { version: "0.50.29", isPackaged: true, userDataPath: root,
            baseCachePath: root, appUpdateConfigPath: config, name: "iPolloWork update proof", whenReady: async () => {},
            quit: () => { throw new Error("The proof must not install or quit the user's app."); } });
          updater.httpExecutor = httpExecutor;
          updater.autoDownload = false;
          updater.autoInstallOnAppQuit = false;
          updater.disableDifferentialDownload = true;
          updater.disableWebInstaller = true;
          updater.setFeedURL({ provider: "custom", updateProvider: await createGithubInstallerProvider() });
          const checked = await updater.checkForUpdates();
          ctx.assert(checked.isUpdateAvailable, "The previous-version profile sees the new public release");
          let ready = false;
          updater.on("update-downloaded", () => { ready = true; });
          const files = await updater.downloadUpdate();
          ctx.assert(ready && files.length === 1, "The updater emitted update-downloaded for one installer");
          const hash = createHash("sha512");
          for await (const chunk of createReadStream(files[0])) hash.update(chunk);
          ctx.assert(hash.digest("base64") === checked.updateInfo.files[0].sha512, "The complete downloaded installer matches the release SHA-512");
          ctx.assert((await stat(files[0])).size === checked.updateInfo.files[0].size, "The complete downloaded installer matches the release size");
          ctx.output("native-update-ready", JSON.stringify({ version: checked.updateInfo.version, file: files[0], size: (await stat(files[0])).size, installed: false }, null, 2));
        },
      });
    },
  }] : [])],
};
