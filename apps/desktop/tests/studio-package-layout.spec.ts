import { FileMatcher } from 'app-builder-lib/out/fileMatcher.js'
import { expect, it } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'

it('keeps Studio child-process dependencies on disk without relocating DSH services', () => {
  const config = createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: 'com.example.studio-layout', DSH_DESKTOP_UNSIGNED: '1' }, 'darwin', 'arm64')
  const matcher = new FileMatcher('/app', '/out', value => value, [...config.asarUnpack])
  const patterns: Parameters<FileMatcher['computeParsedPatterns']>[0] = []
  matcher.computeParsedPatterns(patterns)
  for (const file of [
    'dsh/node_modules/deepseek-ivideo/lib/hyperframes/cli.js',
    'dsh/node_modules/@ipollo/dsh-suite/lib/host/agent-runtime.js',
    'dsh/node_modules/esbuild/lib/main.js',
    'dsh/node_modules/@esbuild/darwin-arm64/bin/esbuild',
    'dsh/node_modules/fontkit/dist/main.cjs',
    'dsh/node_modules/hono/dist/index.js',
  ]) expect(patterns.some(pattern => pattern.match(file)), file).toBe(true)
  expect(patterns.some(pattern => pattern.match('dsh/node_modules/@deepseek-ai/cordis/lib/index.js'))).toBe(false)
})
