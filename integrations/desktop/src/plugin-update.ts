/** Read-only preflight against the update feed and the native DSH profile. */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { evaluatePluginCompatibility, readProfileManifest, readProfileVersionExemptions, resolveBundleDir } from '@deepseek-ai/dsh-app-boot'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { gte, valid } from 'semver'
import { z } from 'zod'

export const pluginUpdatePlanFile = 'ipollowork-plugin-update.json'
const packageName = z.string().max(214).regex(/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u)
const version = z.string().max(100).refine(value => valid(value) !== null)
const archive = z.object({ name: packageName, version, sha256: z.string().regex(/^[a-f0-9]{64}$/u) })
const compatibility = z.object({ runtime: version, plugins: z.array(archive).max(100) })
  .refine(value => new Set(value.plugins.map(plugin => plugin.name)).size === value.plugins.length)

interface PluginIssue {
  name: string
  version?: string
  linked: boolean
  enabled: boolean
}

export function inspectPluginUpdate(profile: string, runtime: string, candidate: unknown, legacyStartup = false) {
  const metadata = compatibility.safeParse(candidate)
  const manifest = readProfileManifest('dsh', profile)
  const enabled = new Set(manifest.dsh?.profile?.bundles ?? [])
  const anchor = join(runtime, 'package.json')
  const issues: PluginIssue[] = []
  const plugins: (z.infer<typeof archive> & { fromVersion: string; fromSource: string })[] = []

  // The installation resolves official bundles before any profile copies.
  const sources = new Map<string, string | undefined>(Object.entries(manifest.dependencies ?? {}))
  for (const name of enabled) if (!sources.has(name)) sources.set(name, undefined)
  const entries = [...sources].filter(([name]) =>
    packageName.safeParse(name).success && !existsSync(join(runtime, 'node_modules', name, 'package.json')))
  if (!metadata.success) {
    const unknown = entries.some(([name]) => enabled.has(name))
    return { unknown, blocked: unknown, issues, runtime: undefined, plugins }
  }
  const exemptions = readProfileVersionExemptions(profile)
  const cache = resolve(profile, '..', '..', 'cache', 'ipollowork-market')
  const catalog = join(runtime, 'node_modules', '@ipollo', 'dsh-suite', 'catalog', 'packages')
  for (const [name, source] of entries) {
    const linked = source?.startsWith('link:') === true
    const issue: PluginIssue = { name, linked, enabled: enabled.has(name) }
    if (legacyStartup && !issue.enabled) continue
    let installed
    let incompatible: boolean
    try {
      installed = readProfileManifest('dsh', resolveBundleDir('dsh', name, anchor, profile))
      if (installed.version !== undefined) issue.version = installed.version
      const compatibility = evaluatePluginCompatibility(installed, exemptions, metadata.data.runtime)
      incompatible = compatibility !== undefined && !compatibility.exempted
    } catch {
      issues.push(issue)
      continue
    }
    const target = metadata.data.plugins.find(plugin => plugin.name === name)
    const path = source?.startsWith('file:') ? resolve(profile, source.slice(5)) : undefined
    // Only the iPolloWork market's local archives can be replaced automatically.
    const managed = path !== undefined && (
      (dirname(path) === cache && /^[a-f0-9]{64}\.tgz$/u.test(basename(path)))
      || (dirname(path) === catalog && basename(path).endsWith('.tgz'))
    )
    if (target && managed && source !== undefined && installed.version && valid(installed.version)
      && gte(target.version, installed.version) && (incompatible || (!legacyStartup && target.version !== installed.version))) {
      plugins.push({ ...target, fromVersion: installed.version, fromSource: source })
    } else if (incompatible) issues.push(issue)
  }
  return { unknown: false, blocked: issues.some(issue => issue.enabled), issues, runtime: metadata.data.runtime, plugins }
}

/** Only expose installed, user-linked sources that were offered by the current compatibility check. */
export function localPluginUpdateDirectory(profile: string, issue: PluginIssue): string | undefined {
  if (!issue.linked || !issue.enabled || !packageName.safeParse(issue.name).success) return undefined
  const source = readProfileManifest('dsh', profile).dependencies?.[issue.name]
  if (!source?.startsWith('link:') || source.length === 'link:'.length) return undefined
  // Use the declared source even when the installed junction no longer resolves.
  return resolve(profile, source.slice('link:'.length))
}

/** Repair older installations that started the upgrade without a preflight handoff. */
export async function prepareLegacyPluginUpdate(profile: string, runtime: string, appVersion: string, runtimeVersion: string): Promise<void> {
  const planPath = join(profile, pluginUpdatePlanFile)
  const existing = await readFile(planPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })
  if (existing !== undefined) {
    try {
      const plan: unknown = JSON.parse(existing)
      if (typeof plan === 'object' && plan !== null && 'version' in plan && plan.version === appVersion
        && 'runtime' in plan && plan.runtime === runtimeVersion && 'plugins' in plan && Array.isArray(plan.plugins)) return
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }

  const catalogPath = join(runtime, 'node_modules', '@ipollo', 'dsh-suite', 'catalog', 'bundled-releases.json')
  const catalog = await readFile(catalogPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })
  if (catalog === undefined) return
  const bundled: unknown = JSON.parse(catalog)
  if (typeof bundled !== 'object' || bundled === null || !('plugins' in bundled)) return
  const { plugins } = inspectPluginUpdate(profile, runtime, { runtime: runtimeVersion, plugins: bundled.plugins }, true)
  if (plugins.length > 0) {
    await writeFileAtomic(planPath, JSON.stringify({ version: appVersion, runtime: runtimeVersion, plugins }) + '\n', { mode: 0o600 })
  }
}

export function pluginUpdatePrompt(check: ReturnType<typeof inspectPluginUpdate>, chinese: boolean, mandatory = false) {
  if (check.unknown) return {
    title: chinese ? '无法验证插件兼容性' : 'Plugin compatibility could not be verified',
    detail: chinese ? '发布源缺少目标 DSH 版本或插件兼容数据。请保留当前版本，等待包含兼容信息的更新。'
      : 'The update feed is missing compatibility information. Keep your current version until a verified update is available.',
  }
  const issues = check.blocked ? check.issues.filter(issue => issue.enabled) : check.issues
  const lines = issues.map(issue =>
    [issue.name, issue.version, issue.linked ? (chinese ? '本地链接' : 'local link') : undefined,
      issue.enabled ? (chinese ? '已启用' : 'enabled') : (chinese ? '已停用' : 'disabled')].filter(Boolean).join(' · '))
  return {
    title: check.blocked ? (chinese ? '当前插件阻止升级' : 'An enabled plugin is blocking this update')
      : (chinese ? '升级后的插件可用性' : 'Plugin availability after the update'),
    detail: [
      chinese ? ('目标 DSH ' + check.runtime) : ('Target DSH ' + check.runtime),
      ...lines,
      check.blocked
        ? mandatory
          ? (chinese ? '当前版本和插件设置已保留。请修复或替换不兼容的插件，再重试更新。'
            : 'Your current version and plugin settings are preserved. Repair or replace the incompatible plugins, then retry the update.')
          : (chinese ? '当前版本和插件设置已保留。请在插件管理器中安装兼容版本，或修复自制插件后重试。'
            : 'Your current version and plugin settings are preserved. Install a compatible version in the Plugin Manager or repair your local plugin, then retry.')
        : (chinese ? '这些已停用的插件需要更新后才能在新版中启用。' : 'Update these disabled plugins before enabling them on the new version.'),
    ].join('\n'),
  }
}
