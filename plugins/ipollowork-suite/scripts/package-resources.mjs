/** Build the byte-identical archive dependencies before publishing the smaller suite. */
import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const output = resolve(process.argv[2] ?? '../../dist/resources')
const releases = JSON.parse(await readFile('catalog/bundled-releases.json', 'utf8'))
for (const release of releases.plugins) {
  const kind = release.name === 'deepseek-idesign' ? 'design' : release.name === 'deepseek-ivideo' ? 'video' : release.name.startsWith('@ipollo/dsh-') ? release.name.slice('@ipollo/dsh-'.length) : undefined
  if (!kind) throw Error('Unsupported bundled resource')
  const source = join('catalog/packages', release.file)
  if (createHash('sha256').update(await readFile(source)).digest('hex') !== release.sha256) throw Error('Resource checksum mismatch')
  const directory = join(output, kind)
  await mkdir(directory, { recursive: true })
  await copyFile(source, join(directory, release.file))
  await copyFile('LICENSE', join(directory, 'LICENSE'))
  await writeFile(join(directory, 'README.md'), `# iPolloWork ${kind} resources\n\nByte-identical native DSH archive. SHA-256: ${release.sha256}.\n`)
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: `@ipollo/dsh-${kind}-resources`, version: release.version,
    description: `Pinned native ${kind} archive for iPolloWork`, license: 'SEE LICENSE IN LICENSE',
    files: [release.file, 'LICENSE', 'README.md'], exports: { [`./${release.file}`]: `./${release.file}` },
  }, null, 2) + '\n')
  execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--ignore-scripts', '--pack-destination', output], { cwd: directory, stdio: 'inherit' })
}
