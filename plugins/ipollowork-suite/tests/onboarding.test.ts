import test from 'node:test'
import assert from 'node:assert/strict'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DesktopOnboardingController } from '../src/client/onboarding/onboarding-state.ts'
import { OnboardingSettingsSchema, type OnboardingSettings } from '../src/client/onboarding/settings.ts'
import type { AccountSnapshot } from '../src/client/onboarding/account.ts'

function form<T extends object>(initial: T) {
  const store = createSnapshotStore<ConfigFormSnapshot<T>>({ status: 'ready', value: initial, base: initial, user: {}, revision: 0, writable: true })
  let refused = false
  const value = {
    getSnapshot: () => store.getSnapshot(), subscribe: (listener: () => void) => store.subscribe(listener),
    async mutate(ops: Parameters<ConfigForm<T>['mutate']>[0]) {
      if (refused) return false
      const next = { ...store.getSnapshot().value }
      for (const op of ops) {
        if (op.op !== 'set' || op.path.length !== 1) throw new Error('Unexpected onboarding write')
        Reflect.set(next, String(op.path[0]), op.value)
      }
      store.set({ ...store.getSnapshot(), value: next as T })
      return true
    },
  }
  return { value: value as ConfigForm<T>, refuse: (next: boolean) => { refused = next } }
}

function fixture(progress: Partial<OnboardingSettings> = {}, credit?: boolean) {
  const settings = form(OnboardingSettingsSchema(progress))
  const chat = form({ transcriptView: 'standard' as 'compact' | 'standard' | 'detailed', performanceUsage: 'compact' as 'compact' | 'detailed' })
  const account = createSnapshotStore<AccountSnapshot>({ view: { status: 'credential-stored' }, failed: false,
    ...(credit === undefined ? {} : { onboardingCredit: credit }) })
  const developer: boolean[] = []
  const controller = new DesktopOnboardingController(settings.value, chat.value, async enabled => { developer.push(enabled) }, account,
    async () => false, { getSnapshot: () => ({ status: 'ready', view: undefined, error: null }), subscribe: () => () => {}, ensure: async () => {}, acceptView: () => {} })
  return { controller, settings, chat, account, developer }
}

test('office onboarding keeps compact chat without hiding the full preset list', async () => {
  const f = fixture()
  try {
    assert.equal(f.controller.state.getSnapshot().visible, true)
    assert.equal(await f.controller.update({ step: 'purpose', purpose: 'office' }), true)
    assert.equal(await f.controller.complete('completed'), true)
    assert.deepEqual(f.chat.value.getSnapshot().value, { transcriptView: 'compact', performanceUsage: 'compact' })
    assert.equal(f.settings.value.getSnapshot().value?.step, 'done')
    assert.equal(f.controller.state.getSnapshot().visible, false)
    assert.deepEqual(f.developer, [true])
  } finally { f.controller.dispose() }
})

test('credit state and retry do not depend on the official account implementation', async () => {
  const f = fixture({ step: 'credit' }, true)
  try {
    assert.equal(f.controller.state.getSnapshot().creditFunded, true)
    f.settings.refuse(true)
    assert.equal(await f.controller.update({ step: 'purpose' }), false)
    assert.equal(f.controller.state.getSnapshot().error, 'settings')
    f.settings.refuse(false)
    assert.equal(await f.controller.retry(), true)
    assert.equal(f.settings.value.getSnapshot().value?.step, 'purpose')
    f.controller.dispose()
    assert.equal(await f.controller.update({ step: 'process' }), false)
  } finally { f.controller.dispose() }
})

test('skipping onboarding retains all built-in preset choices', async () => {
  const f = fixture({ step: 'purpose' })
  try {
    assert.equal(await f.controller.complete('skipped'), true)
    assert.deepEqual(f.developer, [true])
  } finally { f.controller.dispose() }
})
