/** Desktop profile initialization and native recovery. */

import {
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  closeSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  DESKTOP_HOST_PACKAGE,
  desktopCorePackageOverrides,
  verifyDesktopCorePackageSet,
} from './core-package-set.ts'
import type { DesktopPaths } from './paths.ts'
import type { DesktopRelease } from './release.ts'
import { readDesktopRuntime } from './runtime-tree.ts'
import { initProfile, removeLinkProjections, sanitizeProfile } from '@deepseek-ai/dsh-app-boot'
import { PROFILE_TEMPLATES, type ProfileTemplate } from '@deepseek-ai/dsh-official-bundles'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import semver from 'semver'
import { isMap, isScalar, parseDocument } from 'yaml'

const PROJECT_NAME = '@ipollo/desktop-runtime'
const DSH_PACKAGE = '@deepseek-ai/dsh'
const CORE_BUILD_PACKAGE = '@deepseek-ai/dsh-subprocess-local'
const WEB_PROFILE = PROFILE_TEMPLATES.web as ProfileTemplate
const WORKSPACE_SETTINGS = 'nodeLinker: hoisted\nautoInstallPeers: false\n'
const STUDIO_NATIVE_BUILDS = {
  'esbuild@0.25.12': true,
  'sharp@0.34.5': true,
  'onnxruntime-node@1.21.0': true,
  'onnxruntime-node@1.27.0': true,
} as const
const STUDIO_PROFILE_BUILDS = {
  ...STUDIO_NATIVE_BUILDS,
  'onnxruntime-node@1.21.0': false,
  'onnxruntime-node@1.27.0': false,
  'protobufjs@7.6.6': false,
} as const
const PENDING_BUILD = 'set this to true or false'
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 })
}

function workspaceFile(overrides: Readonly<Record<string, string>> = {}): string {
  const entries = Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right))
  const overrideSection = entries.length === 0
    ? ''
    : `overrides:\n${entries.map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`).join('\n')}\n`
  if (entries.length === 0) return `packages:\n  - .\n\n${WORKSPACE_SETTINGS}`
  const coreBuildSpec = overrides[CORE_BUILD_PACKAGE]
  const coreBuildKey = coreBuildSpec === undefined
    ? CORE_BUILD_PACKAGE
    : `${CORE_BUILD_PACKAGE}@${coreBuildSpec.replace('file:./', 'file:')}`
  // Bundled Studio packages pin these native dependency versions in their manifests.
  const studioBuilds = overrides['deepseek-idesign'] || overrides['deepseek-ivideo']
    ? Object.keys(STUDIO_NATIVE_BUILDS).map(spec => `  ${JSON.stringify(spec)}: true\n`).join('')
    : ''
  return `packages:\n  - .\n\n${overrideSection}${WORKSPACE_SETTINGS}allowBuilds:\n  node-pty: true\n  koffi: true\n  fs-ext: true\n  ${JSON.stringify(coreBuildKey)}: true\n${studioBuilds}  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n`
}

/** Apply the shipped Studio dependency decisions to the desktop plugin profile. */
async function configureStudioBuilds(profile: string): Promise<void> {
  const path = join(profile, 'pnpm-workspace.yaml')
  const document = parseDocument(readFileSync(path, 'utf8'))
  if (document.errors.length > 0 || !isMap(document.contents)) return
  // Legacy custom build policies cannot be combined with allowBuilds.
  if (document.has('<<') || document.get('dangerouslyAllowAllBuilds') === true
    || ['onlyBuiltDependencies', 'onlyBuiltDependenciesFile', 'neverBuiltDependencies', 'ignoredBuiltDependencies']
      .some(key => document.has(key))) return
  const builds = document.get('allowBuilds')
  if (builds !== undefined && !isMap(builds)) return
  const existing = new Map<string, boolean | typeof PENDING_BUILD>()
  if (isMap(builds)) {
    if (builds.anchor) return
    for (const { key, value } of builds.items) {
      if (!isScalar(key) || typeof key.value !== 'string' || key.anchor || /[*?]/.test(key.value)
        || !isScalar(value) || value.anchor || (typeof value.value !== 'boolean' && value.value !== PENDING_BUILD)) return
      existing.set(key.value, value.value)
    }
  }

  let changed = false
  for (const [spec, allow] of Object.entries(STUDIO_PROFILE_BUILDS)) {
    const at = spec.lastIndexOf('@')
    const name = spec.slice(0, at)
    const version = spec.slice(at + 1)
    const decided = [...existing].some(([key, value]) => value !== PENDING_BUILD
      && (key === name || (key.startsWith(`${name}@`) && semver.satisfies(version, key.slice(at + 1)))))
    if (decided) continue
    if (existing.get(name) === PENDING_BUILD) document.deleteIn(['allowBuilds', name])
    document.setIn(['allowBuilds', spec], allow)
    changed = true
  }
  if (changed) await writeFileAtomic(path, String(document), { mode: 0o600 })
}

/** Initializes the Desktop profile and disables third-party bundles during recovery. */
export class DesktopProjectManager {
  /**
   * @param paths - Electron-owned package state and reserved desktop profile paths.
   * @param runtime - location of the bundled application runtime.
   */
  constructor(
    readonly paths: DesktopPaths,
    readonly runtime: { readonly dsh: string },
  ) {}

  /**
   * Back up the profile patch and disable third-party bundles without loading application resources.
   * The caller must stop the Host first.
   * @returns Backup path after the locked profile write, or undefined if the patch was absent.
   */
  async disableAllPlugins(): Promise<string | undefined> {
    return this.withLock(() => sanitizeProfile('dsh', this.paths.profile, WEB_PROFILE.bundles))
  }

  /**
   * Load application metadata and prepare the external plugin profile without installing packages.
   */
  async applyRelease(): Promise<void> {
    await this.withLock(async () => {
      // Validation only: an unreadable or mismatched runtime descriptor stops preparation before the Host starts.
      readDesktopRuntime(this.runtime.dsh)
      const hasSuite = existsSync(join(this.runtime.dsh, 'node_modules', '@ipollo', 'dsh-suite', 'package.json'))
      await createPluginProfile(this.paths.profile, hasSuite ? [DESKTOP_HOST_PACKAGE] : [])
      removeLinkProjections(this.paths.profile)
    })
  }

  private async withLock<T>(operation: () => T | Promise<T>): Promise<T> {
    mkdirSync(this.paths.profile, { recursive: true, mode: 0o700 })
    const lockPath = join(realpathSync(this.paths.profile), 'lock')
    let descriptor: number
    try {
      descriptor = openSync(lockPath, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const lock = lstatSync(lockPath)
        if (lock.isSymbolicLink() || !lock.isFile()) {
          throw new Error('desktop project: profile lock is not a regular file')
        }
        const owner = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10)
        let active = !Number.isSafeInteger(owner) || owner <= 0
        if (!active) {
          try {
            process.kill(owner, 0)
            active = true
          } catch (signalError) {
            active = (signalError as NodeJS.ErrnoException).code !== 'ESRCH'
          }
        }
        if (active) throw new Error('desktop project: another profile operation is active')
        unlinkSync(lockPath)
        descriptor = openSync(lockPath, 'wx', 0o600)
      } else {
        throw error
      }
    }
    try {
      writeSync(descriptor, `${String(process.pid)}\n`)
      fsyncSync(descriptor)
      return await operation()
    } finally {
      closeSync(descriptor)
      unlinkSync(lockPath)
    }
  }
}

/** Create build-only project metadata for materializing the signed runtime. */
export function createRuntimeProjectMetadata(projectDir: string, release: DesktopRelease): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const packageSet = verifyDesktopCorePackageSet(projectDir, release.version)
  const manifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: desktopCorePackageOverrides(packageSet),
    dsh: { profile: { bundles: [...WEB_PROFILE.bundles] } },
  }
  writeJson(join(projectDir, 'package.json'), manifest)
  writeFileSync(
    join(projectDir, 'pnpm-workspace.yaml'),
    workspaceFile(desktopCorePackageOverrides(packageSet)),
    { mode: 0o600 },
  )
}

/**
 * Create metadata for the unpackaged development project that links the current workspace.
 * @param projectDir - Disposable development profile directory.
 * @param release - Release identity shared by the linked CLI package and Electron shell.
 */
export function createDevelopmentProjectMetadata(projectDir: string, release: DesktopRelease): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const manifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: {
      [DSH_PACKAGE]: release.version,
      [DESKTOP_HOST_PACKAGE]: release.version,
    },
    dsh: { profile: { bundles: [...WEB_PROFILE.bundles] } },
  }
  writeJson(join(projectDir, 'package.json'), manifest)
  writeFileSync(join(projectDir, 'pnpm-workspace.yaml'), workspaceFile(), { mode: 0o600 })
}

/** Create the first external plugin profile without running a package manager.
 * @param projectDir - Desktop profile directory.
 * @param requiredBundles - Installation-owned bundles enabled by the desktop distribution.
 */
export async function createPluginProfile(projectDir: string, requiredBundles: readonly string[] = []): Promise<void> {
  initProfile(projectDir, [...WEB_PROFILE.bundles, ...requiredBundles])
  await configureStudioBuilds(projectDir)
}
