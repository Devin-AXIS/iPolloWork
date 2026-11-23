import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import {
  databaseChoiceInput,
  databaseConnectionInput,
  type DatabaseConnection,
  type DatabaseSummary,
  type DatabaseCheck,
} from '../core/database'
import type { Project, TableDef } from '../core/contracts'
import { defaultPool, pool, inDatabase, migrate, transaction, isSqlite, type Pool } from './db'
import * as store from './store'
import { DataError } from './errors'

export const projectCreateInput = store.projectInput
  .extend({ database: databaseChoiceInput.default({ mode: 'default' }) })
  .strict()
interface Binding {
  project_id: string
  database_id: string
  connection_secret: string
  summary: DatabaseSummary
  project_snapshot: Project
  ready: boolean
}
const pools = new Map<string, Promise<Pool>>()
const tableProjects = new Map<string, string>()
const failures = new Map<string, number>()

function secretKey() {
  if (process.env.DATA_SECRET_KEY) {
    const key = Buffer.from(process.env.DATA_SECRET_KEY, 'base64')
    if (key.length !== 32) throw new DataError('服务端 DATA_SECRET_KEY 配置不正确')
    return key
  }
  const path =
    process.env.DATA_SECRET_FILE ??
    fileURLToPath(new URL('../../.local/database.key', import.meta.url))
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  try {
    writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
      throw new DataError('无法保存数据库连接密钥，请检查服务端目录权限')
  }
  const key = readFileSync(path)
  if (key.length !== 32) throw new DataError('数据库连接密钥文件无效')
  return key
}
function encrypt(input: DatabaseConnection) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', secretKey(), iv)
  const content = Buffer.concat([cipher.update(JSON.stringify(input)), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), content]).toString('base64')
}
function decrypt(value: string): DatabaseConnection {
  try {
    const data = Buffer.from(value, 'base64'),
      decipher = createDecipheriv('aes-256-gcm', secretKey(), data.subarray(0, 12))
    decipher.setAuthTag(data.subarray(12, 28))
    return databaseConnectionInput.parse(
      JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString()),
    )
  } catch {
    throw new DataError('无法解密数据库连接，请恢复服务端原有密钥')
  }
}
function open(input: DatabaseConnection) {
  const db = new pg.Pool({
    host: input.host,
    port: input.port,
    database: input.database,
    user: input.user,
    password: input.password,
    ssl:
      input.ssl === 'disable'
        ? false
        : { rejectUnauthorized: true, ...(input.ca ? { ca: input.ca } : {}) },
    max: 3,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    query_timeout: 15000,
    statement_timeout: 12000,
    application_name: 'ipollo-data',
  })
  db.on('error', () => {
    /* Request errors are reported without connection secrets. */
  })
  return db
}
function connectionError(error: unknown): DataError {
  if (error instanceof DataError) return error
  const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
  if (code === '28P01' || code === '28000')
    return new DataError('数据库认证失败，请检查用户名、密码和访问规则')
  if (code === '3D000') return new DataError('数据库不存在，请先在数据库服务中创建')
  if (code === '42501') return new DataError('数据库账号权限不足，需要创建项目表和读写数据的权限')
  if (code === '23505') return new DataError('这个数据库已经绑定项目，请打开已有项目', 409)
  return new DataError('数据库连接或操作未完成，请检查地址、端口、TLS 设置及服务状态')
}
async function probe(db: Pool): Promise<DatabaseCheck> {
  const start = performance.now()
  const result = await db.query('SELECT current_database() AS database, version() AS version')
  return { ok: true, ...result.rows[0], latencyMs: Math.round(performance.now() - start) }
}
export async function testConnection(raw: unknown) {
  const db = open(databaseConnectionInput.parse(raw))
  try {
    return await probe(db)
  } catch (e) {
    throw connectionError(e)
  } finally {
    await db.end()
  }
}
async function bindings(): Promise<Binding[]> {
  return (
    await defaultPool.query(
      'SELECT * FROM iw_data.project_databases ORDER BY created_at,project_id',
    )
  ).rows
}
async function binding(id: string): Promise<Binding | undefined> {
  return (
    await defaultPool.query('SELECT * FROM iw_data.project_databases WHERE project_id=$1', [id])
  ).rows[0]
}
function summary(
  input: DatabaseConnection,
  status: DatabaseSummary['status'] = 'connected',
): DatabaseSummary {
  const { host, port, database, user, ssl, engine } = input
  return { mode: 'independent', host, port, database, user, ssl, engine, status }
}
function defaultSummary(): DatabaseSummary {
  if (isSqlite(defaultPool)) return {mode: 'default', engine: 'sqlite', database: 'onto.sqlite', host: 'local', port: 0, user: '', ssl: 'disable', status: 'connected'}
  const url = new URL(process.env.DATABASE_URL!)
  return {
    mode: 'default',
    engine: 'postgres',
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    ssl: url.searchParams.get('sslmode') === 'verify-full' ? 'verify-full' : 'disable',
    status: 'connected',
  }
}
async function identity(db: Pool): Promise<string> {
  const result = await db.query('SELECT id FROM iw_data.database_identity WHERE singleton')
  if (!result.rows[0]) throw new DataError('数据库身份信息缺失')
  return result.rows[0].id
}
// A pending binding is a durable setup receipt. Restarting safely resumes the same project ID.
async function completeSetup(b: Binding, db: Pool) {
  await inDatabase(db, () =>
    transaction(async (conn) => {
      await conn.query('SELECT pg_advisory_xact_lock(5710,2)')
      if (
        (await conn.query('SELECT id FROM iw_data.projects WHERE id<>$1 LIMIT 1', [b.project_id]))
          .rowCount
      )
        throw new DataError('该数据库已有项目，请为独立项目使用另一个数据库', 409)
      const p = b.project_snapshot
      await conn.query(
        'INSERT INTO iw_data.projects(id,name,description,color,icon) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',
        [p.id, p.name, p.description, p.color, p.icon ?? 'folder'],
      )
    }),
  )
  await defaultPool.query('UPDATE iw_data.project_databases SET ready=true WHERE project_id=$1', [
    b.project_id,
  ])
}
async function projectPool(b: Binding): Promise<Pool> {
  if ((failures.get(b.project_id) ?? 0) > Date.now())
    throw new DataError('项目数据库暂时无法连接，可在项目管理中重新检查')
  let pending = pools.get(b.project_id)
  if (!pending) {
    pending = (async () => {
      const db = open(decrypt(b.connection_secret))
      try {
        if ((await identity(db)) !== b.database_id)
          throw new DataError('数据库身份发生变化，已停止读写，请检查连接目标')
        await inDatabase(db, migrate)
        if (!b.ready) await completeSetup(b, db)
        return db
      } catch (e) {
        await db.end()
        throw connectionError(e)
      }
    })()
    pools.set(b.project_id, pending)
    pending.catch(() => {
      pools.delete(b.project_id)
      failures.set(b.project_id, Date.now() + 10000)
    })
  }
  return pending
}
export async function withProject<T>(id: string, work: () => Promise<T>): Promise<T> {
  const b = await binding(id)
  if (!b) return inDatabase(defaultPool, work)
  const db = await projectPool(b)
  return inDatabase(db, work)
}
export async function withTable<T>(id: string, work: () => Promise<T>): Promise<T> {
  const cached = tableProjects.get(id)
  if (cached) return withProject(cached, work)
  if ((await defaultPool.query('SELECT id FROM iw_data.tables WHERE id=$1', [id])).rowCount)
    return inDatabase(defaultPool, work)
  let unavailable = false
  for (const b of await bindings()) {
    try {
      const db = await projectPool(b)
      if (
        (
          await db.query('SELECT id FROM iw_data.tables WHERE id=$1 AND project_id=$2', [
            id,
            b.project_id,
          ])
        ).rowCount
      ) {
        tableProjects.set(id, b.project_id)
        return inDatabase(db, work)
      }
    } catch {
      unavailable = true
    }
  }
  throw new DataError(
    unavailable ? '数据表不存在，或所属数据库暂时无法连接' : '数据表不存在',
    unavailable ? 400 : 404,
  )
}
export async function listProjects(): Promise<Project[]> {
  const local = (await inDatabase(defaultPool, store.getProjects)).map((p) => ({
    ...p,
    storage: defaultSummary(),
  }))
  const remote = await Promise.all(
    (await bindings()).map(async (b) => {
      try {
        const p = (await inDatabase(await projectPool(b), store.getProjects)).find(
          (p) => p.id === b.project_id,
        )
        if (!p) throw new DataError('项目不存在')
        return { ...p, storage: { ...b.summary, status: 'connected' as const } }
      } catch {
        return {
          ...b.project_snapshot,
          storage: {
            ...b.summary,
            status: b.ready ? ('unavailable' as const) : ('pending' as const),
          },
        }
      }
    }),
  )
  return [...local, ...remote].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}
export async function listTables(projectId?: string): Promise<TableDef[]> {
  if (projectId) return withProject(projectId, () => store.getTables(projectId))
  const local = await inDatabase(defaultPool, () => store.getTables())
  const remote = await Promise.all(
    (await bindings()).map(async (b) => {
      try {
        const tables = await inDatabase(await projectPool(b), () => store.getTables(b.project_id))
        for (const t of tables) tableProjects.set(t.id, b.project_id)
        return tables
      } catch {
        return []
      }
    }),
  )
  return [...local, ...remote.flat()]
}
export async function createManagedProject(raw: unknown): Promise<Project> {
  const input = projectCreateInput.parse(raw)
  if (input.database.mode === 'default')
    return {
      ...(await inDatabase(defaultPool, () => store.createProject(input))),
      storage: defaultSummary(),
    }
  const config = input.database.connection,
    db = open(config)
  let registered: Binding | undefined
  try {
    await probe(db)
    const exists = (await db.query("SELECT to_regnamespace('iw_data') AS schema")).rows[0].schema
    if (exists) {
      const known = (await db.query("SELECT to_regclass('iw_data.database_identity') AS identity"))
        .rows[0].identity
      if (!known) throw new DataError('目标数据库已有同名数据空间，请使用一个新的数据库')
      if ((await identity(db)) === (await identity(defaultPool)))
        throw new DataError('这是当前默认数据库，请选择「默认数据库」')
      if ((await db.query('SELECT id FROM iw_data.projects LIMIT 1')).rowCount)
        throw new DataError('该数据库已有项目，请为独立项目使用另一个数据库', 409)
    }
    const secret = encrypt(config)
    await inDatabase(db, migrate)
    const p: Project = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      color: input.color,
      icon: input.icon ?? 'folder',
      createdAt: new Date().toISOString(),
      groupLabel: null,
      tableCount: 0,
      recordCount: 0,
    }
    registered = {
      project_id: p.id,
      database_id: await identity(db),
      connection_secret: secret,
      summary: summary(config),
      project_snapshot: p,
      ready: false,
    }
    await defaultPool.query(
      'INSERT INTO iw_data.project_databases(project_id,database_id,connection_secret,summary,project_snapshot) VALUES($1,$2,$3,$4,$5)',
      [p.id, registered.database_id, secret, JSON.stringify(registered.summary), JSON.stringify(p)],
    )
    await completeSetup(registered, db)
    return { ...p, storage: registered.summary }
  } catch (error) {
    throw connectionError(error)
  } finally {
    await db.end()
  }
}
export async function projectDatabase(id: string): Promise<DatabaseSummary> {
  const b = await binding(id)
  if (b) {
    try {
      await probe(await projectPool(b))
      return { ...b.summary, status: 'connected' }
    } catch {
      return { ...b.summary, status: b.ready ? 'unavailable' : 'pending' }
    }
  }
  if (!(await defaultPool.query('SELECT id FROM iw_data.projects WHERE id=$1', [id])).rowCount)
    throw new DataError('项目不存在', 404)
  return defaultSummary()
}
export async function testProjectDatabase(id: string) {
  failures.delete(id)
  const b = await binding(id)
  try {
    if (b) return await probe(await projectPool(b))
    await projectDatabase(id)
    return await probe(defaultPool)
  } catch (e) {
    throw connectionError(e)
  }
}
export async function updateProject(id: string, raw: unknown) {
  const input = store.projectInput.strict().parse(raw)
  await withProject(id, async () => {
    if (
      !(
        await pool.query(
          'UPDATE iw_data.projects SET name=$2,description=$3,color=$4,icon=coalesce($5,icon) WHERE id=$1 RETURNING id',
          [id, input.name, input.description, input.color, input.icon],
        )
      ).rowCount
    )
      throw new DataError('项目不存在', 404)
  })
  const b = await binding(id)
  if (b)
    await defaultPool.query(
      'UPDATE iw_data.project_databases SET project_snapshot=$2 WHERE project_id=$1',
      [id, JSON.stringify({ ...b.project_snapshot, ...input })],
    )
  return { ok: true }
}
export async function deleteManagedProject(id: string) {
  await withProject(id, () => store.deleteProject(id))
  await defaultPool.query('DELETE FROM iw_data.project_databases WHERE project_id=$1', [id])
  const pending = pools.get(id)
  pools.delete(id)
  failures.delete(id)
  for (const [table, project] of tableProjects) if (project === id) tableProjects.delete(table)
  if (pending) await (await pending).end()
}
export async function forEachDatabase(work: () => Promise<void>) {
  await inDatabase(defaultPool, work)
  for (const b of await bindings()) {
    try {
      await inDatabase(await projectPool(b), work)
    } catch {
      /* An unavailable project must not stop other projects' automation. */
    }
  }
}
export async function closeProjectDatabases() {
  await Promise.allSettled([...pools.values()].map(async (p) => (await p).end()))
  pools.clear()
  failures.clear()
  tableProjects.clear()
}
