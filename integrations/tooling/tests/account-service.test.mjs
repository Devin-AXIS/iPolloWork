import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveDesktopAccountOrigin } from '../account-service.mjs'
import { desktopApplicationEntries } from '../desktop-composition.mjs'

test('distribution account origins use the deployment file and preserve explicit HTTPS and loopback origins', () => {
  const configured = JSON.parse(readFileSync(new URL('../../../plugins/ipollowork-suite/deployment.json', import.meta.url), 'utf8')).accountOrigin
  assert.equal(resolveDesktopAccountOrigin({}), new URL(configured).origin)
  for (const origin of ['https://accounts.example.com', 'https://work.ipollo.net', 'http://localhost:4796'])
    assert.equal(resolveDesktopAccountOrigin({ DSH_DESKTOP_ACCOUNT_ORIGIN: origin + '/' }), origin)
  for (const origin of ['http://remote.example.com', 'https://user:password@example.com', 'https://example.com/api', 'https://example.com/?key=secret', 'file:///tmp/account', 'invalid'])
    assert.throws(() => resolveDesktopAccountOrigin({ DSH_DESKTOP_ACCOUNT_ORIGIN: origin }))
})

test('desktop composition embeds the selected service without mutating unrelated plugin preferences', () => {
  const patches = [{ insert: [{ id: 'ipollowork-suite', config: { accountOrigin: 'https://old.example.com', market: false } }, { id: 'other', config: { custom: true } }] }]
  const entries = desktopApplicationEntries(patches, [], 'https://accounts.example.com')
  assert.deepEqual(entries[0].config, { accountOrigin: 'https://accounts.example.com', market: false, dedicatedDesktop: true })
  assert.deepEqual(entries[1], patches[0].insert[1])
  assert.equal(patches[0].insert[0].config.accountOrigin, 'https://old.example.com')
})
