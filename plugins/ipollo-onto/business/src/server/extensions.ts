import {
  extensionCatalog,
  fieldExtension,
  type ExtensionState,
  type ExtensionManifest,
} from '../core/extensions'
import { pool, transaction, type Connection } from './db'
import { DataError } from './errors'

// Metadata changes serialize with field/rule creation, not with ordinary record writes.
export async function lockExtensions(db: Connection) {
  await db.query('SELECT pg_advisory_xact_lock(5710,1)')
}
export async function requireExtension(db: Connection, id: string) {
  const manifest = extensionCatalog.find((e) => e.id === id)
  if (manifest?.loadError) throw new DataError(`插件加载失败：${manifest.loadError}`, 409)
  const state = (
    await db.query('SELECT installed_version,enabled FROM iw_data.extension_state WHERE id=$1', [
      id,
    ])
  ).rows[0]
  if (!manifest || !state?.enabled || state.installed_version !== manifest.version)
    throw new DataError(`请先安装并启用「${manifest?.name ?? id}」扩展`, 409)
}
export async function requireFieldExtension(db: Connection, type: string) {
  const manifest = fieldExtension(type)
  if (!manifest) throw new DataError('该字段类型尚未安装')
  await requireExtension(db, manifest.id)
}
export async function getExtensions(): Promise<ExtensionState[]> {
  const [states, usage, providerUsage] = await Promise.all([
    pool.query('SELECT id,installed_version,enabled FROM iw_data.extension_state'),
    pool.query('SELECT type,count(*)::int AS n FROM iw_data.fields GROUP BY type'),
    pool.query(
      "SELECT source->>'provider' AS provider,count(*)::int AS n FROM iw_data.fields WHERE source IS NOT NULL GROUP BY source->>'provider'",
    ),
  ])
  return extensionCatalog.map((e) => {
    const state = states.rows.find((s) => s.id === e.id)
    return {
      ...e,
      installedVersion: state?.installed_version ?? null,
      enabled: state?.enabled ?? false,
      usedBy:
        usage.rows
          .filter((r) => e.contributes.fields?.includes(r.type))
          .reduce((n, r) => n + r.n, 0) +
        providerUsage.rows
          .filter((r) => e.contributes.providers?.includes(r.provider))
          .reduce((n, r) => n + r.n, 0),
    }
  })
}
export async function changeExtension(
  id: string,
  action: 'install' | 'enable' | 'disable' | 'uninstall' | 'upgrade',
) {
  await setExtension(id, action)
  return getExtensions()
}
export async function setExtension(
  id: string,
  action: 'install' | 'enable' | 'disable' | 'uninstall' | 'upgrade',
  incoming?: ExtensionManifest,
) {
  await transaction(async (db) => {
    await lockExtensions(db)
    const extension = incoming ?? extensionCatalog.find((e) => e.id === id)
    if (!extension) throw new DataError('扩展不在当前发行包中', 404)
    if (extension.loadError && !['disable', 'uninstall'].includes(action))
      throw new DataError(`插件加载失败：${extension.loadError}`, 409)
    await db.query('INSERT INTO iw_data.extension_state(id) VALUES($1) ON CONFLICT DO NOTHING', [
      id,
    ])
    const state = (
      await db.query('SELECT * FROM iw_data.extension_state WHERE id=$1 FOR UPDATE', [id])
    ).rows[0]
    if (extension.required && ['disable', 'uninstall'].includes(action))
      throw new DataError('基础能力不能停用', 409)
    if (['enable', 'upgrade'].includes(action) && !state?.installed_version)
      throw new DataError('请先安装这个扩展', 409)
    if (['disable', 'uninstall'].includes(action)) {
      const used = await db.query(
        "SELECT count(*)::int AS n FROM iw_data.fields WHERE type=ANY($1::text[]) OR source->>'provider'=ANY($2::text[])",
        [extension.contributes.fields ?? [], extension.contributes.providers ?? []],
      )
      if (used.rows[0].n)
        throw new DataError(`还有 ${used.rows[0].n} 个字段使用这个扩展，请先迁移字段`, 409)
      const enabled = (
        await db.query('SELECT id FROM iw_data.extension_state WHERE enabled')
      ).rows.map((r) => r.id)
      const dependent = extensionCatalog.find(
        (e) => enabled.includes(e.id) && e.dependencies.includes(id),
      )
      if (dependent) throw new DataError(`请先停用依赖它的「${dependent.name}」`, 409)
    } else {
      for (const dependency of extension.dependencies) await requireExtension(db, dependency)
    }
    await db.query(
      'UPDATE iw_data.extension_state SET installed_version=$2,enabled=$3,updated_at=now() WHERE id=$1',
      [
        id,
        action === 'uninstall'
          ? null
          : action === 'disable'
            ? state.installed_version
            : extension.version,
        !['disable', 'uninstall'].includes(action),
      ],
    )
  })
}
