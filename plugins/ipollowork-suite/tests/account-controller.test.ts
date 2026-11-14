import test from 'node:test'
import assert from 'node:assert/strict'
import { AccountController } from '../src/client/account-controller.ts'

const account = (points: number) => ({ status: 'signed-in', origin: 'https://accounts.test', user: { id: 'user', email: 'user@example.com', name: 'User' }, points, balanceStatus: 'available' })
test('account refresh reads changed balances, coalesces reads and preserves pending authentication', async () => {
  const fetcher = globalThis.fetch
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  let calls = 0, points = 0
  let release: (() => void) | undefined
  globalThis.fetch = async () => {
    calls++
    if (release === undefined) return Response.json(account(points))
    await new Promise<void>(resolve => { release = resolve })
    return Response.json(account(points))
  }
  const controller = new AccountController()
  try {
    await controller.refresh()
    assert.equal(controller.getSnapshot().account?.status, 'signed-in')
    points = 10000
    const first = controller.refresh(), second = controller.refresh()
    assert.equal(first, second)
    await first
    assert.equal(calls, 2)
    assert.deepEqual(controller.getSnapshot().account, account(10000))
    release = () => {}
    const signingIn = controller.signIn('user@example.com', 'password')
    await controller.refresh()
    assert.equal(calls, 3)
    release()
    await signingIn
    assert.equal(controller.getSnapshot().error, null)
    controller.dispose()
    await controller.refresh()
    assert.equal(calls, 3)
  } finally {
    controller.dispose()
    globalThis.fetch = fetcher
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
