import test from 'node:test'
import assert from 'node:assert/strict'
import { createOwnedProject, isAbsoluteProjectPath, ProjectCreationError } from '../src/client/project-creation-actions.ts'

test('project names and relative paths cannot reach native registration', async () => {
  for (const path of ['恰恰是', 'new-project', './project', '../project', '~/project', 'C:project', '/tmp/invalid\0name']) {
    assert.equal(isAbsoluteProjectPath(path), false)
    await assert.rejects(createOwnedProject(path, 'enterprise', {
      create: async () => { assert.fail('Invalid paths must not reach the native workspace API') },
      assign: async () => { assert.fail('Invalid paths must not write enterprise metadata') },
    }), error => error instanceof ProjectCreationError && error.code === 'IPW_PROJECT_PATH_REQUIRED')
  }
  for (const path of ['/tmp/project', 'C:\\Users\\me\\project', 'D:/project', '\\\\server\\share\\project']) assert.equal(isAbsoluteProjectPath(path), true)
})

test('project opening waits for the selected enterprise to be saved', async () => {
  const order: string[] = []
  const project = {workspaceId:'native-project',path:'/team/project',title:'Project'}
  let finish: (() => void) | undefined
  const pending = createOwnedProject(project.path, 'enterprise', {
    create: async path => { assert.equal(path, project.path); order.push('create'); return project },
    assign: async (id, enterpriseId) => {
      assert.equal(id, project.workspaceId)
      assert.equal(enterpriseId, 'enterprise')
      order.push('assign')
      await new Promise<void>(resolve => { finish = resolve })
    },
  }).then(result => { order.push('open'); return result })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, ['create','assign'])
  assert(finish)
  finish()
  assert.equal(await pending, project)
  assert.deepEqual(order, ['create','assign','open'])
})

test('failed native creation never attempts ownership, including personal projects', async () => {
  const failure = new Error('Directory is unavailable')
  await assert.rejects(createOwnedProject('/missing', null, {
    create: async () => { throw failure },
    assign: async () => { assert.fail('Ownership cannot be saved without a native project') },
  }), failure)
})

test('failed ownership keeps the same native project available for retry', async () => {
  const project = {workspaceId:'native-project',path:'/team/project',title:'Project'}
  let attempt = 0
  const actions = {
    create: async (path: string) => { assert.equal(path, project.path); return project },
    assign: async (id: string, enterpriseId: string | null) => {
      assert.equal(id, project.workspaceId)
      assert.equal(enterpriseId, 'enterprise')
      if (attempt++ === 0) throw new Error('Service unavailable')
    },
  }
  await assert.rejects(createOwnedProject(project.path, 'enterprise', actions), {message:'IPW_PROJECT_OWNERSHIP_PENDING'})
  assert.equal(await createOwnedProject(project.path, 'enterprise', actions), project)
  assert.equal(attempt, 2)
})
