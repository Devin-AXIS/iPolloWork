/** Runs the official index generator in a bounded child; no plugin code is executed. */
import { generate } from '#dsh-market-generator'
const [source, cacheDir] = process.argv.slice(2)
if (!source || !cacheDir) process.exit(2)
try {
  const git = source.startsWith('https://github.com/')
  const result = await generate({
    sources: [git ? { kind: 'git', line: source, url: source } : { kind: 'npm', line: source, name: source }],
    cacheDir, registry: 'https://registry.npmjs.org/', recordRegistry: false,
    title: 'Import', inlineIconBytes: 32768,
    limits: { timeoutMs: 12000, maxTarballBytes: 64 * 1024 * 1024 },
    concurrency: 1, warn() {}, gitTransports: ['https'],
  })
  // An import must be fresh; do not silently offer a cached result after a failed lookup.
  if (result.failures.length) process.exit(3)
  process.stdout.write(JSON.stringify(result.index.plugins))
} catch { process.exit(3) }
