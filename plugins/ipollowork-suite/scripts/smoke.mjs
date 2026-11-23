import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import semver from 'semver'

// DSH writes the owner URL only into this disposable profile's private log.
const log = await readFile(process.argv[2] ?? '.runtime/server.log', 'utf8')
const match = log.match(/dsh web: (http:\/\/[^\s]+)/)
assert(match, 'A running disposable DSH profile is required')
const url = new URL(match[1])
const entry = await fetch(url, { redirect: 'manual' })
const cookies = entry.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
assert(cookies, 'The owner URL must establish the native DSH owner cookie')
const origin = url.origin
assert.equal((await fetch(`${origin}/ipollowork-suite/info`)).status, 401)
for (const path of ['/info', '/catalog?language=zh', '/account', '/assets/client.css', '/assets/mark.svg']) {
  const response = await fetch(`${origin}/ipollowork-suite${path}`, { headers: { Cookie: cookies } })
  assert.equal(response.status, 200, path)
  if (path === '/account') {
    const value = await response.json()
    assert.equal(value.status, 'anonymous')
    assert(!JSON.stringify(value).includes('token'))
  }
  if (path.startsWith('/catalog')) {
    const value = await response.json()
    const releases = JSON.parse(await readFile(new URL('../catalog/bundled-releases.json', import.meta.url), 'utf8'))
    assert.deepEqual(value.items.slice(0, 2).map(item => item.title), ['Design', 'Video'])
    for (const release of releases.plugins) {
      const item = value.items.find(candidate => candidate.name === release.name)
      assert(item?.compatible && semver.gte(item.version, release.version), release.name)
      if (item.archiveSha256) {
        assert.match(item.spec, /^https:\/\/github\.com\/Devin-AXIS\/iPolloWork\/releases\/download\//)
        assert.match(item.archiveSha256, /^[a-f0-9]{64}$/)
      } else assert(item.spec.startsWith('file:'), release.name)
    }
    assert.equal(value.categories[0].title, '效率')
  }
}
const foreignOrigin = await fetch(`${origin}/ipollowork-suite/account/sign-out`, {
  method: 'POST', headers: { Cookie: cookies, Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}',
})
assert.equal(foreignOrigin.status, 403)
console.log('Native DSH smoke passed: owner authorization, catalog, account metadata, CSS, logo, and cross-origin refusal.')
