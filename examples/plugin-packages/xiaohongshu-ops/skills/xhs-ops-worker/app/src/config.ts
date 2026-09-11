import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(projectRoot, '.env')
if (existsSync(envPath)) loadEnvFile(envPath)

const dataDir = resolve(process.env.XHS_OPS_DATA_DIR ?? resolve(projectRoot, 'data'))
mkdirSync(dataDir, { recursive: true, mode: 0o700 })
mkdirSync(resolve(dataDir, 'assets'), { recursive: true, mode: 0o700 })
mkdirSync(resolve(dataDir, 'evidence'), { recursive: true, mode: 0o700 })
mkdirSync(resolve(dataDir, 'leases'), { recursive: true, mode: 0o700 })

function secretFromFile(name: string, bytes: number): string {
  const path = resolve(dataDir, name)
  if (existsSync(path)) return readFileSync(path, 'utf8').trim()
  const value = randomBytes(bytes).toString('base64url')
  writeFileSync(path, `${value}\n`, { mode: 0o600, flag: 'wx' })
  return value
}

const host = process.env.XHS_OPS_HOST ?? '127.0.0.1'
const port = Number.parseInt(process.env.XHS_OPS_PORT ?? '4790', 10)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('XHS_OPS_PORT must be a valid port')

function pageUrl(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${name} must be an HTTP(S) URL`)
  return parsed.toString()
}

export const config = {
  projectRoot,
  dataDir,
  assetDir: resolve(dataDir, 'assets'),
  evidenceDir: resolve(dataDir, 'evidence'),
  leaseDir: resolve(dataDir, 'leases'),
  databasePath: resolve(dataDir, 'xiaohongshu-ops.db'),
  host,
  port,
  origin: process.env.XHS_OPS_ORIGIN ?? `http://${host}:${port}`,
  timezone: process.env.XHS_OPS_TIMEZONE ?? 'Asia/Shanghai',
  wakeLockEnabled: process.env.XHS_OPS_WAKE_LOCK === '1',
  embedOrigins: process.env.XHS_OPS_EMBED_ORIGINS?.split(/\s+/).filter(Boolean) ?? [],
  xhs: {
    creatorUrl: pageUrl('XHS_OPS_CREATOR_URL', 'https://creator.xiaohongshu.com/'),
    webUrl: pageUrl('XHS_OPS_WEB_URL', 'https://www.xiaohongshu.com/'),
  },
  apiToken: process.env.XHS_OPS_API_TOKEN ?? secretFromFile('api-token', 32),
  codex: {
    executable: process.env.XHS_OPS_CODEX_PATH ?? '',
    model: process.env.XHS_OPS_CODEX_MODEL ?? 'gpt-5.6-terra',
    reasoningEffort: process.env.XHS_OPS_CODEX_REASONING ?? 'low',
  },
} as const
