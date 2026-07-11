import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { installConfigUrlFor, parseInstallerFilenameTag } from "@ipollowalk/install-config"

import { desktopBootstrapPath, legacyDesktopBootstrapPath } from "../src/bootstrap-path"
import { parseInstallLinkInput, resolveInstallerConfig } from "../src/config"
import { isTranslocatedPath, parseMountTableLine, readSidecarConfig, resolveTranslocatedOriginalPath } from "../src/config-sources"
import { writeBootstrapConfig } from "../src/install"
import { releaseAssetFor } from "../src/release-asset"

describe("desktopBootstrapPath", () => {
  test("honors the explicit override", () => {
    expect(desktopBootstrapPath({ IPOLLOWALK_DESKTOP_BOOTSTRAP_PATH: "/tmp/custom.json" }, "darwin")).toBe("/tmp/custom.json")
  })

  test("prefers XDG_CONFIG_HOME on every platform", () => {
    expect(desktopBootstrapPath({ XDG_CONFIG_HOME: "/xdg" }, "linux")).toBe(path.join("/xdg", "ipollowalk", "desktop-bootstrap.json"))
    expect(desktopBootstrapPath({ XDG_CONFIG_HOME: "/xdg" }, "win32")).toBe(path.join("/xdg", "ipollowalk", "desktop-bootstrap.json"))
  })

  test("uses LOCALAPPDATA on Windows and ~/.config elsewhere", () => {
    expect(desktopBootstrapPath({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32")).toBe(
      path.join("C:\\Users\\u\\AppData\\Local", "ipollowalk", "desktop-bootstrap.json"),
    )
    expect(desktopBootstrapPath({}, "darwin")).toBe(path.join(os.homedir(), ".config", "ipollowalk", "desktop-bootstrap.json"))
  })

  test("resolves the legacy bootstrap path under ~/.config on every platform", () => {
    expect(legacyDesktopBootstrapPath({ HOME: "/Users/u" }, "darwin")).toBe(
      path.join("/Users/u", ".config", "ipollowalk", "desktop-bootstrap.json"),
    )
    expect(legacyDesktopBootstrapPath({ USERPROFILE: "C:\\Users\\u" }, "win32")).toBe(
      path.join("C:\\Users\\u", ".config", "ipollowalk", "desktop-bootstrap.json"),
    )
  })
})

describe("releaseAssetFor", () => {
  test("resolves per-platform asset names", () => {
    expect(releaseAssetFor("v0.17.7", "darwin", "arm64").fileName).toBe("ipollowalk-mac-arm64-0.17.7.dmg")
    expect(releaseAssetFor("0.17.7", "darwin", "x64").fileName).toBe("ipollowalk-mac-x64-0.17.7.dmg")
    expect(releaseAssetFor("0.17.7", "win32", "x64").fileName).toBe("ipollowalk-win-x64-0.17.7.exe")
    expect(releaseAssetFor("0.17.7", "linux", "x64").fileName).toBe("ipollowalk-linux-x86_64-0.17.7.AppImage")
    expect(releaseAssetFor("0.17.7", "linux", "arm64").fileName).toBe("ipollowalk-linux-arm64-0.17.7.AppImage")
  })

  test("builds the release download URL from the version tag", () => {
    expect(releaseAssetFor("0.17.7", "darwin", "arm64").url).toBe(
      "https://github.com/Devin-AXIS/iPolloWalk/releases/download/v0.17.7/ipollowalk-mac-arm64-0.17.7.dmg",
    )
  })

  test("rejects unsupported targets", () => {
    expect(() => releaseAssetFor("0.17.7", "win32", "arm64")).toThrow()
    expect(() => releaseAssetFor("", "darwin", "arm64")).toThrow()
  })
})

describe("resolveInstallerConfig", () => {
  test("reads env overrides and normalizes URLs", async () => {
    const { config, source } = await resolveInstallerConfig({ env: {
      IPOLLOWALK_INSTALLER_APP_NAME: "Acme Work",
      IPOLLOWALK_INSTALLER_CLIENT_NAME: "Acme Corp",
      IPOLLOWALK_INSTALLER_WEB_URL: "https://ipollowalk.acme.com/",
      IPOLLOWALK_INSTALLER_API_URL: "https://ipollowalk-api.acme.com",
      IPOLLOWALK_INSTALLER_REQUIRE_SIGNIN: "true",
    } })
    expect(source).toBe("env")
    expect(config).toEqual({
      appName: "Acme Work",
      clientName: "Acme Corp",
      webUrl: "https://ipollowalk.acme.com",
      apiUrl: "https://ipollowalk-api.acme.com",
      logoUrl: null,
      requireSignin: true,
    })
  })

  test("accepts an optional logo URL and rejects non-http logos", async () => {
    const { config } = await resolveInstallerConfig({ env: {
      IPOLLOWALK_INSTALLER_CLIENT_NAME: "Acme",
      IPOLLOWALK_INSTALLER_WEB_URL: "https://ipollowalk.acme.com",
      IPOLLOWALK_INSTALLER_API_URL: "https://ipollowalk-api.acme.com",
      IPOLLOWALK_INSTALLER_LOGO_URL: "https://acme.com/logo.svg",
    } })
    expect(config.logoUrl).toBe("https://acme.com/logo.svg")
    await expect(
      resolveInstallerConfig({
        env: {
        IPOLLOWALK_INSTALLER_CLIENT_NAME: "Acme",
        IPOLLOWALK_INSTALLER_WEB_URL: "https://ipollowalk.acme.com",
        IPOLLOWALK_INSTALLER_API_URL: "https://ipollowalk-api.acme.com",
        IPOLLOWALK_INSTALLER_LOGO_URL: "file:///etc/passwd",
        },
      }),
    ).rejects.toThrow()
  })

  test("fails without a configured deployment", async () => {
    await expect(resolveInstallerConfig({ env: {}, execPath: path.join(os.tmpdir(), "ipollowalk-installer") })).rejects.toThrow()
  })

  test("prefers env overrides over sidecar config", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ipollowalk-installer-precedence-"))
    try {
      const execPath = path.join(dir, "ipollowalk-installer")
      writeFileSync(execPath, "")
      writeFileSync(path.join(dir, "ipollowalk-installer.json"), JSON.stringify({
        clientName: "Sidecar",
        webUrl: "https://sidecar.example.com",
        apiUrl: "https://sidecar-api.example.com",
        requireSignin: true,
        logoUrl: null,
      }))

      const resolution = await resolveInstallerConfig({
        env: {
          IPOLLOWALK_INSTALLER_CLIENT_NAME: "Env",
          IPOLLOWALK_INSTALLER_WEB_URL: "https://env.example.com",
          IPOLLOWALK_INSTALLER_API_URL: "https://env-api.example.com",
        },
        execPath,
      })

      expect(resolution.source).toBe("env")
      expect(resolution.config.clientName).toBe("Env")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // macOS-only semantics: .app bundles (and their slash-separated exec paths)
  // do not exist on Windows, where path.join builds a backslashed path the
  // bundle matcher rightly rejects.
  test.skipIf(process.platform === "win32")("reads sidecar next to the enclosing app bundle", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ipollowalk-installer-app-sidecar-"))
    try {
      const macOsDir = path.join(dir, "iPolloWalk Installer.app", "Contents", "MacOS")
      mkdirSync(macOsDir, { recursive: true })
      const execPath = path.join(macOsDir, "iPolloWalk Installer")
      writeFileSync(execPath, "")
      writeFileSync(path.join(dir, "ipollowalk-installer.json"), JSON.stringify({
        clientName: "Bundle Sidecar",
        webUrl: "https://bundle.example.com",
        apiUrl: "https://bundle-api.example.com",
        requireSignin: true,
        logoUrl: null,
      }))

      const resolution = await resolveInstallerConfig({ env: {}, execPath })
      expect(resolution.source).toBe("sidecar")
      expect(resolution.config.clientName).toBe("Bundle Sidecar")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("macOS App Translocation helpers", () => {
  test("parses a normal mount table line", () => {
    expect(parseMountTableLine("/private/tmp/iPolloWalk Installer.app on /private/var/folders/abc/T/AppTranslocation/123 (nullfs, local, read-only)")).toEqual({
      source: "/private/tmp/iPolloWalk Installer.app",
      mountPoint: "/private/var/folders/abc/T/AppTranslocation/123",
      options: "nullfs, local, read-only",
    })
  })

  test("parses paths with spaces and on in the source", () => {
    expect(parseMountTableLine("/private/tmp/folder with spaces/source on disk/iPolloWalk Installer.app on /private/var/folders/abc/T/AppTranslocation/UUID With Space (nullfs, local)")).toEqual({
      source: "/private/tmp/folder with spaces/source on disk/iPolloWalk Installer.app",
      mountPoint: "/private/var/folders/abc/T/AppTranslocation/UUID With Space",
      options: "nullfs, local",
    })
  })

  test("ignores junk mount table lines", () => {
    expect(parseMountTableLine("not a mount table line")).toBeNull()
    expect(parseMountTableLine("/private/tmp/iPolloWalk Installer.app on /private/var/folders/abc/T/AppTranslocation/123")).toBeNull()
  })

  test("resolves the original app through the translocated /d path", () => {
    const mountPoint = "/private/var/folders/abc/T/AppTranslocation/123"
    const source = "/private/tmp/iPolloWalk Installer.app"
    const execPath = `${mountPoint}/d/iPolloWalk Installer.app/Contents/MacOS/ipollowalk-installer`

    expect(resolveTranslocatedOriginalPath(execPath, `${source} on ${mountPoint} (nullfs, local, nodev)\n`)).toBe(source)
  })

  test("skips non-nullfs mounts", () => {
    const mountPoint = "/private/var/folders/abc/T/AppTranslocation/123"
    const source = "/private/tmp/iPolloWalk Installer.app"
    const execPath = `${mountPoint}/d/iPolloWalk Installer.app/Contents/MacOS/ipollowalk-installer`

    expect(resolveTranslocatedOriginalPath(execPath, `${source} on ${mountPoint} (apfs, local)\n`)).toBeNull()
  })

  test("requires a mountpoint path-prefix boundary", () => {
    const mountPoint = "/private/var/folders/abc/T/AppTranslocation/123"
    const source = "/private/tmp/iPolloWalk Installer.app"
    const execPath = `${mountPoint}-suffix/d/iPolloWalk Installer.app/Contents/MacOS/ipollowalk-installer`

    expect(resolveTranslocatedOriginalPath(execPath, `${source} on ${mountPoint} (nullfs, local)\n`)).toBeNull()
  })

  test("returns null when no translocation mount matches", () => {
    const execPath = "/private/var/folders/abc/T/AppTranslocation/123/d/iPolloWalk Installer.app/Contents/MacOS/ipollowalk-installer"
    const mountTable = "/private/tmp/iPolloWalk Installer.app on /private/var/folders/abc/T/AppTranslocation/other (nullfs, local)\n"

    expect(resolveTranslocatedOriginalPath(execPath, mountTable)).toBeNull()
  })

  test("detects App Translocation paths", () => {
    expect(isTranslocatedPath("/private/var/folders/abc/T/AppTranslocation/123/d/iPolloWalk Installer.app/Contents/MacOS/ipollowalk-installer")).toBe(true)
    expect(isTranslocatedPath("/Applications/iPolloWalk Installer.app/Contents/MacOS/ipollowalk-installer")).toBe(false)
  })

  test("reads the sidecar next to the original translocated app", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ipollowalk-installer-translocated-"))
    try {
      const originalAppPath = path.join(dir, "iPolloWalk Installer.app")
      const mountPoint = "/private/var/folders/abc/T/AppTranslocation/123"
      const execPath = `${mountPoint}/d/iPolloWalk Installer.app/Contents/MacOS/ipollowalk-installer`
      mkdirSync(originalAppPath, { recursive: true })
      writeFileSync(path.join(dir, "ipollowalk-installer.json"), JSON.stringify({
        clientName: "Translocated Sidecar",
        webUrl: "https://translocated.example.com",
        apiUrl: "https://translocated-api.example.com",
        requireSignin: true,
        logoUrl: null,
      }))

      expect(readSidecarConfig({
        execPath,
        readMountTable: () => `${originalAppPath} on ${mountPoint} (nullfs, local, read-only)\n`,
        warn: () => undefined,
      })).toEqual({
        appName: "iPolloWalk",
        clientName: "Translocated Sidecar",
        webUrl: "https://translocated.example.com",
        apiUrl: "https://translocated-api.example.com",
        requireSignin: true,
        logoUrl: null,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("falls through when the translocation mount is missing", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ipollowalk-installer-translocated-missing-"))
    try {
      const originalAppPath = path.join(dir, "iPolloWalk Installer.app")
      const execPath = "/private/var/folders/abc/T/AppTranslocation/123/d/iPolloWalk Installer.app/Contents/MacOS/ipollowalk-installer"
      writeFileSync(path.join(dir, "ipollowalk-installer.json"), JSON.stringify({
        clientName: "Missing Mount Sidecar",
        webUrl: "https://missing.example.com",
        apiUrl: "https://missing-api.example.com",
        requireSignin: false,
        logoUrl: null,
      }))

      expect(readSidecarConfig({
        execPath,
        readMountTable: () => `${originalAppPath} on /private/var/folders/abc/T/AppTranslocation/other (nullfs, local)\n`,
        warn: () => undefined,
      })).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("install link helpers", () => {
  test("parses filename stamps and install config URLs", () => {
    expect(parseInstallerFilenameTag("iPolloWalk-Installer--127.0.0.1_8790--abcDEF12.exe")).toEqual({
      host: "127.0.0.1:8790",
      token: "abcDEF12",
    })
    expect(parseInstallerFilenameTag("iPolloWalk-Installer--api.example.com--abcDEF12")).toEqual({
      host: "api.example.com",
      token: "abcDEF12",
    })
    expect(installConfigUrlFor("127.0.0.1:8790", "abcDEF12")).toBe("http://127.0.0.1:8790/v1/install-config?token=abcDEF12")
    expect(installConfigUrlFor("api.example.com", "abcDEF12")).toBe("https://api.example.com/v1/install-config?token=abcDEF12")
  })

  test("parses pasted install-link inputs", () => {
    expect(parseInstallLinkInput("https://app.example.com/install?token=abcDEF12")?.url).toBe(
      "https://app.example.com/api/den/v1/install-config?token=abcDEF12",
    )
    expect(parseInstallLinkInput("https://api.example.com/v1/install-config?token=abcDEF12")?.url).toBe(
      "https://api.example.com/v1/install-config?token=abcDEF12",
    )
    expect(parseInstallLinkInput("api.example.com abcDEF12")?.url).toBe(
      "https://api.example.com/v1/install-config?token=abcDEF12",
    )
    expect(parseInstallLinkInput("http://api.example.com/install?token=abcDEF12")).toBeNull()
  })
})

describe("writeBootstrapConfig", () => {
  test("migrates a legacy organization config instead of replacing it with hosted defaults", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ipollowalk-installer-test-"))
    const env = {
      LOCALAPPDATA: path.join(dir, "LocalAppData"),
      USERPROFILE: path.join(dir, "profile"),
    }
    const target = desktopBootstrapPath(env, "win32")
    const legacy = legacyDesktopBootstrapPath(env, "win32")
    try {
      mkdirSync(path.dirname(target), { recursive: true })
      mkdirSync(path.dirname(legacy), { recursive: true })
      writeFileSync(target, JSON.stringify({
        baseUrl: "https://app.ipollowalklabs.com/api/den/",
        writtenAt: "2026-07-10T13:00:00.000Z",
      }))
      writeFileSync(legacy, JSON.stringify({
        baseUrl: "https://ipollowalk.organization.internal.example",
        apiBaseUrl: "https://api.organization.internal.example",
        handoff: { grant: "drop-me" },
        prepared: { orgId: "org_example" },
        claimLinks: [{ id: "claim_example" }],
        writtenAt: "2026-07-09T12:00:00.000Z",
      }))
      const written = writeBootstrapConfig(
        { appName: "iPolloWalk", clientName: "Hosted", webUrl: "https://app.ipollowalklabs.com/", apiUrl: "https://api.ipollowalklabs.com/", requireSignin: false, logoUrl: null },
        env,
        "win32",
      )
      expect(written).toBe(target)
      const parsed = JSON.parse(readFileSync(target, "utf8"))
      expect(parsed.baseUrl).toBe("https://ipollowalk.organization.internal.example")
      expect(parsed.apiBaseUrl).toBe("https://api.organization.internal.example")
      expect(parsed.handoff).toBeUndefined()
      expect(parsed.prepared).toEqual({ orgId: "org_example" })
      expect(parsed.claimLinks).toEqual([{ id: "claim_example" }])
      expect(Number.isFinite(Date.parse(parsed.writtenAt))).toBe(true)
      expect(existsSync(legacy)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("keeps a canonical organization config across repeated hosted reinstalls", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ipollowalk-installer-test-"))
    const env = {
      LOCALAPPDATA: path.join(dir, "LocalAppData"),
      USERPROFILE: path.join(dir, "profile"),
    }
    const target = desktopBootstrapPath(env, "win32")
    try {
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, JSON.stringify({
        baseUrl: "https://ipollowalk.organization.internal.example",
        apiBaseUrl: "https://api.organization.internal.example",
        handoff: { grant: "drop-me" },
        prepared: { orgId: "org_example" },
        claimLinks: [{ id: "claim_example" }],
      }))
      const hostedConfig = {
        appName: "iPolloWalk",
        clientName: "Hosted",
        webUrl: "https://api.ipollowalklabs.com/v1/",
        apiUrl: "https://api.ipollowalklabs.com/",
        requireSignin: false,
        logoUrl: null,
      }

      writeBootstrapConfig(hostedConfig, env, "win32")
      writeBootstrapConfig(hostedConfig, env, "win32")

      const parsed = JSON.parse(readFileSync(target, "utf8"))
      expect(parsed.baseUrl).toBe("https://ipollowalk.organization.internal.example")
      expect(parsed.apiBaseUrl).toBe("https://api.organization.internal.example")
      expect(parsed.handoff).toBeUndefined()
      expect(parsed.prepared).toEqual({ orgId: "org_example" })
      expect(parsed.claimLinks).toEqual([{ id: "claim_example" }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("replaces an installed hosted default with a custom organization config", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ipollowalk-installer-test-"))
    const env = {
      LOCALAPPDATA: path.join(dir, "LocalAppData"),
      USERPROFILE: path.join(dir, "profile"),
    }
    const target = desktopBootstrapPath(env, "win32")
    try {
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, JSON.stringify({
        baseUrl: "https://app.ipollowalklabs.com/api/den/",
        apiBaseUrl: "https://api.ipollowalklabs.com/",
        prepared: { orgId: "org_example" },
        claimLinks: [{ id: "claim_example" }],
      }))

      writeBootstrapConfig(
        {
          appName: "Example Org Work",
          clientName: "Example Org",
          webUrl: "https://ipollowalk.custom.internal.example",
          apiUrl: "https://api.custom.internal.example",
          requireSignin: true,
          logoUrl: "https://ipollowalk.custom.internal.example/assets/wordmark.svg",
        },
        env,
        "win32",
      )

      const parsed = JSON.parse(readFileSync(target, "utf8"))
      expect(parsed.baseUrl).toBe("https://ipollowalk.custom.internal.example")
      expect(parsed.apiBaseUrl).toBe("https://api.custom.internal.example")
      expect(parsed.requireSignin).toBe(true)
      expect(parsed.brandAppName).toBe("Example Org Work")
      expect(parsed.brandLogoUrl).toBe("https://ipollowalk.custom.internal.example/assets/wordmark.svg")
      expect(parsed.prepared).toEqual({ orgId: "org_example" })
      expect(parsed.claimLinks).toEqual([{ id: "claim_example" }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
