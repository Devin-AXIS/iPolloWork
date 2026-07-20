import assert from "node:assert/strict"
import test from "node:test"
import { assetNamePrefixes, releaseEndpoint, selectReleaseAsset } from "../bin/ipollowork.mjs"

const assets = [
  { name: "ipollowork-mac-arm64-0.17.26.dmg", browser_download_url: "https://example.test/mac-arm64.dmg" },
  { name: "ipollowork-mac-x64-0.17.26.dmg", browser_download_url: "https://example.test/mac-x64.dmg" },
  { name: "ipollowork-win-arm64-0.17.26.exe", browser_download_url: "https://example.test/win-arm64.exe" },
  { name: "ipollowork-win-x64-0.17.26.exe", browser_download_url: "https://example.test/win-x64.exe" },
  { name: "ipollowork-linux-arm64-0.17.26.AppImage", browser_download_url: "https://example.test/linux-arm64.AppImage" },
  { name: "ipollowork-linux-x86_64-0.17.26.AppImage", browser_download_url: "https://example.test/linux-x64.AppImage" },
]

test("selects the official installer for each supported platform", () => {
  assert.equal(selectReleaseAsset(assets, "darwin", "arm64").name, "ipollowork-mac-arm64-0.17.26.dmg")
  assert.equal(selectReleaseAsset(assets, "darwin", "x64").name, "ipollowork-mac-x64-0.17.26.dmg")
  assert.equal(selectReleaseAsset(assets, "win32", "arm64").name, "ipollowork-win-arm64-0.17.26.exe")
  assert.equal(selectReleaseAsset(assets, "win32", "x64").name, "ipollowork-win-x64-0.17.26.exe")
  assert.equal(selectReleaseAsset(assets, "linux", "arm64").name, "ipollowork-linux-arm64-0.17.26.AppImage")
  assert.equal(selectReleaseAsset(assets, "linux", "x64").name, "ipollowork-linux-x86_64-0.17.26.AppImage")
})

test("uses a versioned release endpoint only when requested", () => {
  assert.match(releaseEndpoint(), /\/releases\/latest$/)
  assert.match(releaseEndpoint("0.17.26"), /\/releases\/tags\/v0.17.26$/)
  assert.match(releaseEndpoint("v0.17.26"), /\/releases\/tags\/v0.17.26$/)
})

test("rejects unsupported platforms and absent installers", () => {
  assert.throws(() => assetNamePrefixes("freebsd", "x64"), /unsupported_platform/)
  assert.throws(() => selectReleaseAsset([], "linux", "x64"), /official_installer_not_found/)
})
