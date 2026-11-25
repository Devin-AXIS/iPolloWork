/** Use the enterprise release file with the existing external PostgreSQL Compose deployment. */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isIP } from 'node:net'
import { join, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { readReleaseConfig, releaseFile, releaseObject, releaseString } from './release-config.mjs'

const serviceRoot = resolve(import.meta.dirname, '..')
const containerCA = '/run/ipollowork/db-ca.pem'
const databaseFields = ['host', 'port', 'name', 'user', 'passwordFromEnv', 'urlFromEnv', 'schema',
  'poolSize', 'connectionTimeoutMs', 'statementTimeoutMs', 'lockTimeoutMs', 'queueLimit', 'tls']

function readDotenv(path, optional) {
  try { return parseEnv(readFileSync(path, 'utf8')) }
  catch (error) {
    if (optional && error.code === 'ENOENT') return {}
    throw new Error('release deployment: cannot read the selected .env file', { cause: error })
  }
}

function environmentValue(environment, name, field) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new Error(`release configuration: invalid ${field}`)
  const value = environment[name]
  if (!value) throw new Error(`release deployment: set ${name} in the environment or private .env`)
  return value
}

function origin(raw, field) {
  const value = releaseString(raw, field)
  if (value === undefined) return undefined
  const url = URL.parse(value)
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`release configuration: ${field} must be an HTTPS origin`)
  }
  return url
}

export function resolveReleaseDeployment(selected, environment) {
  const server = releaseObject(selected?.server, ['origin', 'publicationOrigin', 'database', 'https'], 'server')
  const database = releaseObject(server.database, databaseFields, 'server.database')
  const tls = releaseObject(database.tls, ['mode', 'caFile'], 'server.database.tls')
  const host = releaseString(database.host, 'server.database.host')
  const urlRef = releaseString(database.urlFromEnv, 'server.database.urlFromEnv')
  const mode = releaseString(tls.mode, 'server.database.tls.mode')
  const caFile = releaseFile(tls.caFile ?? environment.DATABASE_CA_FILE, selected?.directory ?? serviceRoot, 'database CA')
  const service = origin(server.origin, 'server.origin')
  const publication = origin(server.publicationOrigin, 'server.publicationOrigin')
  const overrides = {}
  if (service) overrides.SERVICE_ORIGIN = service.origin
  if (publication) overrides.PUBLICATION_ORIGIN = publication.origin
  const readUrl = raw => {
    const url = URL.parse(raw ?? '')
    if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
      throw new Error('release deployment: DATABASE_URL must be a PostgreSQL connection URL')
    }
    return url
  }
  if (host && urlRef) throw new Error('release configuration: choose database.host or database.urlFromEnv')
  if (!host && ['port', 'name', 'user', 'passwordFromEnv'].some(key => database[key] !== undefined)) {
    throw new Error('release configuration: database connection fields require database.host')
  }
  let url
  if (host) {
    const hostname = isIP(host) === 6 ? `[${host}]` : host
    if (!(isIP(host) || /^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/iu.test(host))) {
      throw new Error('release configuration: database.host must be a DNS name or IP address')
    }
    const port = database.port ?? 5432
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('release configuration: invalid database.port')
    url = new URL(`postgresql://${hostname}:${port}/`)
    url.username = encodeURIComponent(releaseString(database.user, 'server.database.user') ?? 'ipollowork')
    url.password = encodeURIComponent(environmentValue(environment,
      releaseString(database.passwordFromEnv, 'server.database.passwordFromEnv') ?? 'IPOLLOWORK_DB_PASSWORD', 'passwordFromEnv'))
    url.pathname = '/' + encodeURIComponent(releaseString(database.name, 'server.database.name') ?? 'ipollowork')
  } else if (urlRef || environment.DATABASE_URL) {
    url = readUrl(urlRef ? environmentValue(environment, urlRef, 'urlFromEnv') : environment.DATABASE_URL)
  }
  if ((mode || caFile) && !url) throw new Error('release deployment: database TLS requires an external database URL')
  const sslmode = mode ?? (caFile ? 'verify-full' : undefined)
  if (sslmode && !['require', 'verify-ca', 'verify-full', 'disable'].includes(sslmode)) {
    throw new Error('release configuration: invalid database TLS mode')
  }
  if (caFile && sslmode === 'disable') throw new Error('release configuration: database CA requires TLS')
  if (sslmode) url.searchParams.set('sslmode', sslmode)
  if (caFile) url.searchParams.set('sslrootcert', containerCA)
  if (url) overrides.DATABASE_URL = url.href
  if (database.schema !== undefined) overrides.DATABASE_SCHEMA = releaseString(database.schema, 'server.database.schema')
  for (const [key, variable] of Object.entries({
    poolSize: 'DATABASE_POOL_SIZE', connectionTimeoutMs: 'DATABASE_CONNECTION_TIMEOUT_MS',
    statementTimeoutMs: 'DATABASE_STATEMENT_TIMEOUT_MS', lockTimeoutMs: 'DATABASE_LOCK_TIMEOUT_MS', queueLimit: 'DATABASE_QUEUE_LIMIT',
  })) {
    if (database[key] === undefined) continue
    if (!Number.isSafeInteger(database[key]) || database[key] < 1) {
      throw new Error(`release configuration: database.${key} must be a positive integer`)
    }
    overrides[variable] = String(database[key])
  }
  if (server.https !== undefined && typeof server.https !== 'boolean') throw new Error('release configuration: server.https must be boolean')
  const proxy = server.https === true
  if (proxy) {
    const account = service ?? origin(environment.SERVICE_ORIGIN, 'SERVICE_ORIGIN')
    const sites = publication ?? origin(environment.PUBLICATION_ORIGIN, 'PUBLICATION_ORIGIN')
    if (!account || !sites || account.hostname === sites.hostname || account.port || sites.port) {
      throw new Error('release deployment: Caddy requires two distinct HTTPS hostnames on the default port')
    }
    overrides.SERVICE_DOMAIN = account.hostname
    overrides.PUBLICATION_DOMAIN = sites.hostname
  }
  return { overrides, caFile, proxy }
}

async function main(args) {
  if (args.length === 0) throw new Error('usage: node deploy/compose-release.mjs up -d')
  const selected = readReleaseConfig(process.env, resolve(serviceRoot, '../..', 'ipollowork.release.json'))
  const envPath = resolve(process.env.IPOLLO_ENV_FILE ?? join(serviceRoot, '.env'))
  const environment = { ...readDotenv(envPath, process.env.IPOLLO_ENV_FILE === undefined), ...process.env }
  const plan = resolveReleaseDeployment(selected, environment)
  const files = ['compose.external.yml', ...(plan.caFile ? ['compose.external.ca.yml'] : []),
    ...(plan.proxy ? ['compose.external.https.yml'] : [])].flatMap(file => ['-f', join(import.meta.dirname, file)])
  const temporary = mkdtempDisposableSync(join(tmpdir(), 'ipollowork-compose-'))
  const override = join(temporary.path, 'release.json')
  try {
    const composeEnvPath = existsSync(envPath) ? envPath : join(temporary.path, 'empty.env')
    if (composeEnvPath !== envPath) writeFileSync(composeEnvPath, '', { mode: 0o600 })
    for (const key of ['SERVICE_ORIGIN', 'PUBLICATION_ORIGIN', 'AUTH_SECRET', 'APP_DATA_DATABASE_URL', 'APP_DATA_DATABASE_SCHEMA']) {
      if (plan.overrides[key] === undefined && environment[key]) plan.overrides[key] = environment[key]
    }
    const keys = Object.keys(plan.overrides).filter(key => !['SERVICE_DOMAIN', 'PUBLICATION_DOMAIN'].includes(key))
    const config = { services: { work: { environment: Object.fromEntries(keys.map(key => [key, '${' + key + ':?Missing ' + key + '}'])) } } }
    writeFileSync(override, JSON.stringify(config), { mode: 0o600 })
    const child = spawn('docker', ['compose', ...files, '-f', override, ...args], {
      cwd: serviceRoot, stdio: 'inherit',
      env: { ...environment, ...plan.overrides, IPOLLO_ENV_FILE: composeEnvPath,
        ...(plan.caFile ? { DATABASE_CA_FILE: plan.caFile } : {}) },
    })
    const status = await new Promise((done, fail) => {
      child.once('error', fail)
      child.once('exit', code => done(code ?? 1))
    })
    process.exitCode = status
  } finally { temporary.remove() }
}

if (import.meta.main) {
  try { await main(process.argv.slice(2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
