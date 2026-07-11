#!/usr/bin/env node

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import os from "os"
import { createRequire } from "module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const rootDir = dirname(fileURLToPath(import.meta.url))

function detect() {
  const platformMap = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  }
  const archMap = {
    x64: "x64",
    arm64: "arm64",
    arm: "arm",
  }

  const platform = platformMap[os.platform()] || os.platform()
  const arch = archMap[os.arch()] || os.arch()
  return { platform, arch }
}

function packageName() {
  const { platform, arch } = detect()
  return `ipollowork-orchestrator-${platform}-${arch}`
}

function binaryName() {
  const { platform } = detect()
  return platform === "windows" ? "ipollowork.exe" : "ipollowork"
}

function fallbackAssetName() {
  const { platform, arch } = detect()
  return `ipollowork-bun-${platform}-${arch}${platform === "windows" ? ".exe" : ""}`
}

function fallbackBinaryPath() {
  return join(rootDir, "dist", "bin", binaryName())
}

function readOwnVersion() {
  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"))
  const version = String(pkg.version || "").trim()
  if (!version) {
    throw new Error("ipollowork-orchestrator: package version is missing")
  }
  return version
}

function resolveFallbackBaseUrl(version) {
  const override = String(process.env.IPOLLOWORK_ORCHESTRATOR_DOWNLOAD_BASE_URL || "").trim()
  if (override) {
    return override.replace(/\/$/, "")
  }
  return `https://github.com/Devin-AXIS/iPolloWork/releases/download/ipollowork-orchestrator-v${version}`
}

async function downloadFallbackBinary() {
  const version = readOwnVersion()
  const asset = fallbackAssetName()
  const url = `${resolveFallbackBaseUrl(version)}/${asset}`
  const destination = fallbackBinaryPath()

  console.log(`ipollowork-orchestrator: downloading fallback binary ${asset}`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`download failed (${response.status} ${response.statusText}) from ${url}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, buffer)
  if (binaryName() !== "ipollowork.exe") {
    chmodSync(destination, 0o755)
  }

  console.log(`ipollowork-orchestrator: installed fallback binary at ${destination}`)
}

async function main() {
  try {
    const pkg = packageName()
    require.resolve(`${pkg}/package.json`)
    console.log(`ipollowork-orchestrator: verified platform package: ${pkg}`)
    return
  } catch {
    if (existsSync(fallbackBinaryPath())) {
      console.log(`ipollowork-orchestrator: using existing fallback binary at ${fallbackBinaryPath()}`)
      return
    }
  }

  try {
    await downloadFallbackBinary()
  } catch (error) {
    const pkg = packageName()
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `ipollowork-orchestrator: failed to locate platform binary package (${pkg}).\n` +
        `Your package manager may have skipped optionalDependencies, or the package asset is unavailable.\n` +
        `Fallback download failed: ${message}\n` +
        `Try installing it manually: npm i -g ${pkg}`,
    )
    process.exit(1)
  }
}

await main()
