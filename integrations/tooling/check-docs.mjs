/** Check product Markdown links without scanning downloaded or generated files. */
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0')
const errors = []
for (const path of paths) {
  if (!path.endsWith('.md') || !existsSync(path) || !lstatSync(path).isFile()) continue
  if (!['README.md', 'README.zh.md', 'integrations/README.md', 'integrations/README.zh.md', 'integrations/runtime/README.md', 'integrations/runtime/README.zh.md', 'integrations/desktop/README.md', 'integrations/desktop/README.zh.md'].includes(path)) continue
  const source = readFileSync(path, 'utf8')
  for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0]
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue
    if (!existsSync(resolve(dirname(path), target))) errors.push(`${path}: ${target}`)
  }
}
if (errors.length) throw new Error(errors.join('\n'))
console.log('Product documentation links passed')
