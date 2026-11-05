export const RELEASE_REPOSITORY = "Devin-AXIS/iPolloWork";
export const RELEASE_API_URL = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
export const UPDATE_METADATA_PATTERN = /<!-- ipollowork-desktop-update:v1\s+([\s\S]*?)\s*-->/g;
export const CLOUD_UPDATE_BASE = "http://i.ipollo.ai/desktop-updates/";

export function updateMetadataBlock(metadata) {
  return `<!-- ipollowork-desktop-update:v1\n${JSON.stringify(metadata)}\n-->`;
}

/** @param {object} release @param {{ platform?: string, arch?: string }} target */
export function releaseUpdateInfo(release, { platform = process.platform, arch = process.arch } = {}) {
  const version = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(release.tag_name ?? "")?.[1];
  if (!version || release.draft || release.prerelease) throw new Error("Expected a published stable desktop release.");
  if (!["win32", "darwin", "linux"].includes(platform) || !["x64", "arm64"].includes(arch)) throw new Error("Unsupported update platform.");
  const blocks = [...String(release.body ?? "").matchAll(UPDATE_METADATA_PATTERN)];
  if (blocks.length !== 1 || blocks[0][1].length > 24_000) throw new Error("Desktop release update metadata is missing or invalid.");
  const metadata = JSON.parse(blocks[0][1]);
  const file = metadata.files?.[`${platform}-${arch}`];
  if (metadata.version !== version || !file || !Number.isSafeInteger(file.size) || file.size <= 0
    || typeof file.sha512 !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) {
    throw new Error("Desktop update version, size or SHA-512 is invalid.");
  }
  const os = { win32: "win", darwin: "mac", linux: "linux" }[platform];
  const fileArch = platform === "linux" && arch === "x64" ? "x86_64" : arch;
  const extension = { win32: "exe", darwin: "zip", linux: "AppImage" }[platform];
  const name = `ipollowork-${os}-${fileArch}-${version}.${extension}`;
  const expectedUrl = platform === "darwin"
    ? `${CLOUD_UPDATE_BASE}${release.tag_name}/${Buffer.from(file.sha512, "base64").toString("hex")}-${name}`
    : `https://github.com/${RELEASE_REPOSITORY}/releases/download/${release.tag_name}/${name}`;
  if (file.url !== expectedUrl) throw new Error("Desktop update URL does not match the official platform artifact.");
  if (platform !== "darwin") {
    const assets = release.assets?.filter((asset) => asset.name === name);
    if (assets?.length !== 1 || assets[0].state !== "uploaded" || assets[0].size !== file.size
      || assets[0].browser_download_url !== expectedUrl) throw new Error("Desktop installer is missing or differs from its update metadata.");
  }
  // Metadata and SHA-512 arrive over GitHub HTTPS. electron-updater verifies
  // the complete payload before installation, including cloud-hosted Mac ZIPs.
  return { version, files: [{ url: file.url, size: file.size, sha512: file.sha512 }], releaseDate: release.published_at,
    releaseNotes: String(release.body ?? "").replace(UPDATE_METADATA_PATTERN, "").trim() };
}

export async function createGithubInstallerProvider() {
  const { Provider, resolveFiles } = await import("electron-updater/out/providers/Provider.js");
  return class GithubInstallerProvider extends Provider {
    constructor(_configuration, _updater, runtimeOptions) {
      super({ ...runtimeOptions, isUseMultipleRangeRequest: false });
      this.platform = runtimeOptions.platform ?? process.platform;
    }
    async getLatestVersion() {
      const raw = await this.httpRequest(new URL(RELEASE_API_URL), { Accept: "application/vnd.github+json", "User-Agent": "iPolloWork" });
      return releaseUpdateInfo(JSON.parse(raw), { platform: this.platform });
    }
    resolveFiles(info) {
      return resolveFiles(info, new URL(`https://github.com/${RELEASE_REPOSITORY}/releases/download/`));
    }
  };
}
