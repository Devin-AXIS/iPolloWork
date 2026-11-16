import { build } from 'esbuild'
import { mkdir, cp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
await mkdir('dist', { recursive: true })
const result = spawnSync(process.execPath, ['scripts/build-native.mjs'], { stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status ?? 1)
await build({ entryPoints: ['src/host.ts'], outfile: 'dist/host.js', bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['@deepseek-ai/*', 'canvas', 'path2d', 'pdfjs-dist/*'] })
await cp('src/client.js', 'dist/client.js')
await rm('dist/native', { recursive: true, force: true }); await cp('dist/package/native', 'dist/native', { recursive: true }); await cp('ui', 'dist/ui', { recursive: true })
