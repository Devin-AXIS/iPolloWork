/** Preserve dependency notices alongside code bundled into the native releases. */
import { readFile, readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire, isBuiltin } from 'node:module'

export async function dependencyNotices(resolver, names) {
  const seen = new Set(), notices = []
  async function visit(name, from) {
    if (isBuiltin(name)) return
    let file
    for (const base of from.resolve.paths(name) ?? []) {
      try { file = await realpath(join(base, name, 'package.json')); break } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    if (!file || seen.has(file)) return
    seen.add(file)
    const metadata = JSON.parse(await readFile(file, 'utf8')), directory = join(file, '..')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^(licen[cs]e|copying|notice)([.-].*)?$/i.test(entry.name)) continue
      notices.push(`\n--- ${metadata.name}@${metadata.version}/${entry.name} ---\n${await readFile(join(directory, entry.name), 'utf8')}`)
    }
    const next = createRequire(file)
    for (const child of Object.keys(metadata.dependencies ?? {})) await visit(child, next)
  }
  for (const name of names) await visit(name, resolver)
  return notices.join('\n') + '\n'
}
