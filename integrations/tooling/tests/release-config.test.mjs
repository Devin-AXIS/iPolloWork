import assert from 'node:assert/strict'
import { mkdtempDisposableSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readReleaseConfig } from '../../../services/ipollowork/deploy/release-config.mjs'
import { resolveReleaseDeployment } from '../../../services/ipollowork/deploy/compose-release.mjs'
import { applyDesktopReleaseConfig, desktopArtifactName, readDesktopReleaseConfig } from '../desktop-release-config.mjs'
import { desktopApplicationEntries } from '../desktop-composition.mjs'

function fixture(t, value) {
  const directory = mkdtempDisposableSync(join(tmpdir(), 'ipollowork-release-test-'))
  t.after(() => directory.remove())
  const path = join(directory.path, 'ipollowork.release.json')
  writeFileSync(path, JSON.stringify({ version: 1, ...value }))
  return { directory: directory.path, env: { IPOLLOWORK_RELEASE_CONFIG: path } }
}

test('an empty release file keeps the existing desktop environment and artifact names', t => {
  const { env } = fixture(t, {})
  const environment = { ...env, DSH_DESKTOP_APP_ID: 'com.deepseek.harness', DSH_DESKTOP_ACCOUNT_ORIGIN: 'https://legacy.example',
    DSH_DESKTOP_UPDATE_URL: 'https://updates.legacy.example/', DSH_DESKTOP_UPDATE_CHANNEL: 'nightly' }
  assert.deepEqual(applyDesktopReleaseConfig(environment), environment)
  assert.deepEqual(readDesktopReleaseConfig(env).plugins, [])
  assert.equal(desktopArtifactName(env, { version: '1.0.19', os: 'win', arch: 'x64', ext: 'exe', suffix: '-unsigned' }), 'iPollo-1.0.19-win-x64-unsigned.exe')
})

test('desktop projects supported fields without copying server settings or changing explicit account precedence', t => {
  const { env, directory } = fixture(t, {
    desktop: { name: 'Enterprise Work', appId: 'com.example.work', installerName: 'Work-${version}-${arch}.${ext}',
      icons: { windows: './app.ico' }, plugins: [{ archive: './bundle.tgz', patch: './bundle.yml' }] },
    server: { origin: 'https://enterprise.example', database: { passwordFromEnv: 'EXAMPLE_DB_PASSWORD' } },
  })
  for (const name of ['app.ico', 'bundle.tgz', 'bundle.yml']) writeFileSync(join(directory, name), '')
  const desktop = readDesktopReleaseConfig(env)
  assert.equal(desktop.icons.windows, join(directory, 'app.ico'))
  assert.equal(desktop.plugins[0].patch, join(directory, 'bundle.yml'))
  assert.equal(desktop.accountOrigin, 'https://enterprise.example')
  assert.ok(!JSON.stringify(desktop).includes('EXAMPLE_DB_PASSWORD'))
  assert.equal(applyDesktopReleaseConfig(env).DSH_DESKTOP_APP_ID, 'com.example.work')
  const explicit = { ...env, PACKAGE_ACCOUNT_ORIGIN: 'https://other.example', DSH_DESKTOP_ACCOUNT_ORIGIN: 'https://other.example' }
  assert.equal(applyDesktopReleaseConfig(explicit).DSH_DESKTOP_ACCOUNT_ORIGIN, 'https://other.example')
  assert.equal(desktopArtifactName(env, { version: '2.0.0', os: 'win', arch: 'x64', ext: 'exe', suffix: '-unsigned' }), 'Work-2.0.0-x64-unsigned.exe')
})

test('release deployment encodes credentials, mounts the CA in the URL and selects the external HTTPS domains', t => {
  const { env, directory } = fixture(t, {
    server: { origin: 'https://work.example', publicationOrigin: 'https://sites.example', https: true,
      database: { host: 'db.example', poolSize: 16, passwordFromEnv: 'EXAMPLE_DB_PASSWORD', tls: { caFile: './ca.pem' } } },
  })
  writeFileSync(join(directory, 'ca.pem'), 'fixture')
  const config = readReleaseConfig(env)
  assert.throws(() => resolveReleaseDeployment(config, {}), /set EXAMPLE_DB_PASSWORD/u)
  const plan = resolveReleaseDeployment(config, { EXAMPLE_DB_PASSWORD: 'p@$$%# /:?ü' })
  const url = new URL(plan.overrides.DATABASE_URL)
  assert.equal(decodeURIComponent(url.password), 'p@$$%# /:?ü')
  assert.equal(url.hostname, 'db.example')
  assert.equal(url.port, '5432')
  assert.equal(url.searchParams.get('sslmode'), 'verify-full')
  assert.equal(url.searchParams.get('sslrootcert'), '/run/ipollowork/db-ca.pem')
  assert.equal(plan.caFile, join(directory, 'ca.pem'))
  assert.equal(plan.overrides.DATABASE_POOL_SIZE, '16')
  assert.equal(plan.overrides.PUBLICATION_DOMAIN, 'sites.example')
  assert.equal(plan.proxy, true)
})

test('the enterprise update feed and channel take precedence over the existing release preset', t => {
  const feedUrl = 'https://update.example/files/${target}/'
  const { env } = fixture(t, { desktop: { update: { feedUrl, channel: 'stable' } } })
  assert.deepEqual(readDesktopReleaseConfig(env).update, { feedUrl, channel: 'stable' })
  const projected = applyDesktopReleaseConfig({ ...env, DSH_DESKTOP_UPDATE_CHANNEL: 'nightly' })
  assert.equal(projected.IPOLLOWORK_DESKTOP_UPDATE_FEED, feedUrl)
  assert.equal(projected.DSH_DESKTOP_UPDATE_CHANNEL, 'stable')
})

test('the update feed rejects direct installer and insecure URLs before packaging', t => {
  for (const feedUrl of ['http://update.example/files', 'https://update.example/setup.exe',
    'https://update.example/?token=secret', 'https://update.example/${unknown}/']) {
    const { env } = fixture(t, { desktop: { update: { feedUrl } } })
    assert.throws(() => readDesktopReleaseConfig(env), /desktop\.update\.feedUrl/u)
  }
  const { env } = fixture(t, { desktop: { update: { channel: 'development' } } })
  assert.throws(() => readDesktopReleaseConfig(env), /desktop\.update\.channel/u)
})

test('external database URL from the existing environment and no CA still work', t => {
  const { env } = fixture(t, {})
  const DATABASE_URL = 'postgresql://user:password@rds.example/db?sslmode=verify-full'
  const plan = resolveReleaseDeployment(readReleaseConfig(env), { DATABASE_URL })
  assert.deepEqual(plan, { overrides: { DATABASE_URL }, caFile: undefined, proxy: false })
  assert.throws(() => resolveReleaseDeployment(readReleaseConfig(env), { DATABASE_URL: 'https://rds.example/db' }), /PostgreSQL connection URL/u)
  assert.throws(() => resolveReleaseDeployment(readReleaseConfig(env), { DATABASE_URL, DATABASE_CA_FILE: 'missing.pem' }), /CA.*existing file/u)
})

test('enterprise composition appends entries without allowing collisions with native product IDs', () => {
  const patches = [{ insert: [{ id: 'ipollowork-suite', name: '@ipollo/dsh-suite' }] }]
  const extra = { id: 'enterprise-fixture', name: '@example/fixture' }
  assert.deepEqual(desktopApplicationEntries(patches, 'https://account.example', [extra]).at(-1), extra)
  assert.throws(() => desktopApplicationEntries(patches, 'https://account.example', [extra, extra]), /duplicate entry ID/u)
  assert.throws(() => desktopApplicationEntries(patches, 'https://account.example', [{ id: 'ipollowork-suite' }]), /duplicate entry ID/u)
})
