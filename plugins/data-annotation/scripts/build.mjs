import { build } from 'esbuild'
import { mkdir, cp } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
await mkdir('dist', { recursive: true })
for (const config of ['app/vite.config.ts', 'service/vite.config.ts']) { const r = spawnSync('node', ['node_modules/vite/bin/vite.js', 'build', '--config', config], { stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status ?? 1) }
await build({ entryPoints: ['src/host.ts'], outfile: 'dist/host.js', bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['@deepseek-ai/*', 'canvas', 'path2d', 'pdfjs-dist/*', '../service/data-annotation.ts'] })
await cp('src/client.js', 'dist/client.js')
// The service remains at its stable, separately built asset root.
import { readFile, writeFile } from 'node:fs/promises'
await writeFile('dist/host.js', (await readFile('dist/host.js', 'utf8')).replace('../service/data-annotation.ts', '../service/dist/data-annotation.mjs'))
