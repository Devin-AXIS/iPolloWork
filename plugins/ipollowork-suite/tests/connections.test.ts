import test from 'node:test'
import assert from 'node:assert/strict'
import { Connections } from '../src/client/connections-model.ts'
import type { ConnectionProvider } from '../src/shared/connections.ts'

const provider = (plugin: string): ConnectionProvider => ({
  id: 'studio:resources', title: { en: 'Resources', zh: '资源' }, plugins: [plugin], fields: [],
  load: async () => ({ configured: false, writable: true }),
  save: async () => ({ configured: true, writable: true }),
})
test('shared service registrations survive removal of either contributing plugin', () => {
  const connections = new Connections(), design = provider('Design'), video = provider('Video')
  const removeDesign = connections.register(design), removeVideo = connections.register(video)
  assert.deepEqual(connections.getSnapshot().providers, [design])
  connections.open(design.id)
  removeDesign()
  assert.deepEqual(connections.getSnapshot().providers, [video])
  assert.equal(connections.getSnapshot().selected, design.id)
  removeVideo()
  assert.deepEqual(connections.getSnapshot().providers, [])
  assert.equal(connections.getSnapshot().selected, undefined)
})
test('connection navigation and updates publish without retaining form values', () => {
  const connections = new Connections()
  let notifications = 0
  const stop = connections.subscribe(() => notifications++)
  connections.open(); connections.changed(); connections.close()
  assert.equal(notifications, 3)
  assert.deepEqual(Object.keys(connections.getSnapshot()).sort(), ['open', 'providers', 'revision', 'selected'])
  stop(); connections.open()
  assert.equal(notifications, 3)
})
