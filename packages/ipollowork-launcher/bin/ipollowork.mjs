#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process"
import { chmodSync, createWriteStream, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"

const VERSION = "0.1.0"
const REPOSITORY = "Devin-AXIS/iPolloWork"
const RELEASES_API = `https://api.github.com/repos/${REPOSITORY}/releases`

function printHelp() {
  console.log([
    "iPolloWork installer",
    "",
    "Usage:",
    "  npx -y ipollowork",
    "  npx -y ipollowork --release v0.17.26",
    "",
    "Downloads the official desktop build for this computer from iPolloWork Releases.",
    "macOS installs to ~/Applications, Windows opens the official installer,",
    "and Linux installs an AppImage in ~/.local/share/ipollowork.",
  ].join("\n"))
}

function parseArgs(argv) {
  let release = null
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--help" || arg === "-h") return { help: true }
    if (arg === "--version") return { version: true }
    if (arg === "--release") {
      release = argv[index + 1]
      index += 1
      if (!release) throw new Error("missing_value: --release")
      continue
    }
    throw new Error(`unknown_option: ${arg}`)
  }
  return { release }
}

export function assetNamePrefixes(platform = process.platform, arch = process.arch) {
  if (platform === "darwin") {
    if (arch === "arm64") return ["ipollowork-mac-arm64-"]
    if (arch === "x64") return ["ipollowork-mac-x64-"]
  }
  if (platform === "win32") {
    if (arch === "arm64") return ["ipollowork-win-arm64-"]
    if (arch === "x64") return ["ipollowork-win-x64-"]
  }
  if (platform === "linux") {
    if (arch === "arm64") return ["ipollowork-linux-arm64-"]
    if (arch === "x64") return ["ipollowork-linux-x86_64-", "ipollowork-linux-x64-"]
  }
  throw new Error(`unsupported_platform: ${platform}-${arch}`)
}

function expectedExtension(platform) {
  if (platform === "darwin") return ".dmg"
  if (platform === "win32") return ".exe"
  if (platform === "linux") return ".AppImage"
  throw new Error(`unsupported_platform: ${platform}`)
}

export function selectReleaseAsset(assets, platform = process.platform, arch = process.arch) {
  const extension = expectedExtension(platform)
  const asset = assetNamePrefixes(platform, arch)
    .flatMap((prefix) => assets.filter((candidate) => candidate?.name?.startsWith(prefix) && candidate.name.endsWith(extension)))
    .find((candidate) => typeof candidate.browser_download_url === "string")

  if (!asset) throw new Error(`official_installer_not_found: ${platform}-${arch}`)
  return asset
}

export function releaseEndpoint(release) {
  if (!release) return `${RELEASES_API}/latest`
  const tag = release.startsWith("v") ? release : `v${release}`
  return `${RELEASES_API}/tags/${encodeURIComponent(tag)}`
}

async function fetchRelease(release) {
  const response = await fetch(releaseEndpoint(release), {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `ipollowork-installer/${VERSION}`,
    },
  })
  if (!response.ok) throw new Error(`release_fetch_failed: ${response.status}`)
  const payload = await response.json()
  if (!Array.isArray(payload.assets)) throw new Error("release_assets_missing")
  return payload
}

async function downloadAsset(asset, destination) {
  const response = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": `ipollowork-installer/${VERSION}` },
    redirect: "follow",
  })
  if (!response.ok || !response.body) throw new Error(`installer_download_failed: ${response.status}`)

  const hash = createHash("sha256")
  const checksum = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(response.body), checksum, createWriteStream(destination))

  const digest = hash.digest("hex")
  if (typeof asset.digest === "string" && asset.digest.startsWith("sha256:") && asset.digest.slice("sha256:".length).toLowerCase() !== digest) {
    throw new Error("installer_checksum_mismatch")
  }
  return digest
}

function findAppBundle(root) {
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.shift()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory() && entry.name.endsWith(".app")) return path
      if (entry.isDirectory()) queue.push(path)
    }
  }
  throw new Error("app_bundle_not_found_in_dmg")
}

function installMac(dmgPath, workDir) {
  const mountPoint = join(workDir, "mount")
  const applications = join(homedir(), "Applications")
  mkdirSync(mountPoint, { recursive: true })
  mkdirSync(applications, { recursive: true })

  let mounted = false
  try {
    execFileSync("hdiutil", ["attach", dmgPath, "-nobrowse", "-readonly", "-mountpoint", mountPoint], { stdio: "pipe" })
    mounted = true
    const source = findAppBundle(mountPoint)
    const target = join(applications, "iPolloWork.app")
    rmSync(target, { recursive: true, force: true })
    execFileSync("ditto", [source, target], { stdio: "pipe" })
    try {
      execFileSync("xattr", ["-dr", "com.apple.quarantine", target], { stdio: "pipe" })
    } catch {}
    return target
  } finally {
    if (mounted) {
      try {
        execFileSync("hdiutil", ["detach", mountPoint, "-quiet"], { stdio: "pipe" })
      } catch {
        execFileSync("hdiutil", ["detach", mountPoint, "-force", "-quiet"], { stdio: "pipe" })
      }
    }
  }
}

function installLinux(appImagePath) {
  const installDir = join(homedir(), ".local", "share", "ipollowork")
  const target = join(installDir, "iPolloWork.AppImage")
  mkdirSync(installDir, { recursive: true })
  rmSync(target, { force: true })
  execFileSync("cp", [appImagePath, target], { stdio: "pipe" })
  chmodSync(target, 0o755)
  return target
}

function launch(path) {
  const options = { detached: true, stdio: "ignore" }
  const child = process.platform === "darwin"
    ? spawn("open", [path], options)
    : spawn(path, [], options)
  child.unref()
}

async function install() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) return printHelp()
  if (args.version) return console.log(VERSION)

  const release = await fetchRelease(args.release)
  const asset = selectReleaseAsset(release.assets)
  const workDir = mkdtempSync(join(tmpdir(), "ipollowork-install-"))
  const downloadPath = join(workDir, asset.name)
  let keepDownload = false

  try {
    console.log(`Downloading iPolloWork ${release.tag_name} for ${process.platform}-${process.arch}…`)
    await downloadAsset(asset, downloadPath)

    if (process.platform === "darwin") {
      const appPath = installMac(downloadPath, workDir)
      launch(appPath)
      console.log(`Installed and opened iPolloWork: ${appPath}`)
      return
    }

    if (process.platform === "win32") {
      keepDownload = true
      launch(downloadPath)
      console.log("The official iPolloWork installer has opened. Follow its short setup steps to finish.")
      return
    }

    if (process.platform === "linux") {
      const appPath = installLinux(downloadPath)
      launch(appPath)
      console.log(`Installed and opened iPolloWork: ${appPath}`)
      return
    }

    throw new Error(`unsupported_platform: ${process.platform}-${process.arch}`)
  } finally {
    if (!keepDownload) rmSync(workDir, { recursive: true, force: true })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  install().catch((error) => {
    console.error(`iPolloWork installer failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
