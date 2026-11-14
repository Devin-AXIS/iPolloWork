import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { mountServiceModels } from '../src/host/service-models.ts'
import { Services } from '../src/host/services.ts'
import { AccountService } from '../src/host/account.ts'
import { resolveConfig } from '../src/host/config.ts'
import type { CredentialStore } from '../src/shared/types.ts'

test('official models register lazily, retain native providers and withdraw on own-key selection and unload', async () => {
  const ctx = new Context()
  const llm = ctx.plugin(LlmRuntime)
  await llm
  const records = new Map<string, { kind: string; payload?: unknown }>([
    [
      'ipollowork-suite/account',
      {
        kind: 'grant',
        payload: {
          version: 1,
          origin: 'https://accounts.test',
          token: 'test-account',
        },
      },
    ],
  ])
  const credentials: CredentialStore = {
    readRecord: async (key) => records.get(key),
    modifyRecord: async (key, update) => {
      const record = await update(records.get(key))
      records.set(key, record)
      return record
    },
    deleteRecord: async (key) => {
      records.delete(key)
    },
  }
  const account = new AccountService(
    credentials,
    resolveConfig({ accountOrigin: 'https://accounts.test' }),
    new AbortController().signal,
    async () =>
      Response.json({
        items: [
          {
            id: 'chat',
            provider: 'bailian',
            title: 'Official',
            capabilities: ['chat'],
            origin: 'https://vendor.test',
            basePath: '/v1',
            models: [
              {
                id: 'model',
                name: 'Model',
                contextWindow: 32768,
                maxTokens: 2048,
              },
            ],
            routes: [],
            available: true,
          },
        ],
        points: 10,
      }),
  )
  const center = new Services(
    account,
    credentials,
    new AbortController().signal,
  )
  let refresh = async () => {}
  const fiber = ctx.plugin({
    inject: ['llm'],
    apply(child: Context) {
      refresh = mountServiceModels(
        child,
        { getOrigin: () => 'http://127.0.0.1:12345', register: () => () => {} },
        center,
        account,
      )
    },
  })
  await fiber
  try {
    assert.equal(ctx.llm.listProviders().length, 0)
    await refresh()
    assert.equal(center.modelStatus, 'ready')
    assert.deepEqual(
      ctx.llm.listProviders().map((p) => p.id),
      ['ipollo-chat'],
    )
    const models = await ctx.llm.listModels('ipollo-chat')
    assert.equal(models[0]?.id, 'model')
    await center.choose('bailian', { source: 'own' })
    await refresh()
    assert.equal(ctx.llm.listProviders().length, 0)
    await center.choose('bailian', { source: 'official', serviceId: 'chat' })
    await refresh()
    assert.equal(ctx.llm.listProviders().length, 1)
  } finally {
    await fiber.dispose()
  }
  assert.equal(ctx.llm.listProviders().length, 0)
  await llm.dispose()
})
