/** IM adapters shipped inside the iPolloWork bundle; DSH owns their lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-error'
import { createImHostPlugin, inject as nativeInject } from '../../vendor/dsh-im/plugin-src/host/index.mjs'
import { COORDINATOR_PRESET } from '../shared/coordinator.ts'

export const name = 'ipollowork-im'
export const inject = [...nativeInject, 'pluginManager', 'fileUploads', 'ipolloAgents', 'agentPresets']
interface ImContext extends Context {
  pluginManager: { listBundles(): Promise<{ name: string; enabled: boolean }[]> }
  agentPresets: { resolve(id: string): Promise<{ broken?: string }> }
}

/** Refuse duplicate bot connections; upgrading this module follows the suite's normal update path. */
export async function apply(ctx: ImContext, config: Record<string, unknown> = {}): Promise<void> {
  const legacy = (await ctx.pluginManager.listBundles()).find(bundle => bundle.name === '@xmanrui/dsh-im' && bundle.enabled)
  if (legacy) throw new HarnessError('Disable the standalone @xmanrui/dsh-im bundle to use iPolloWork messaging. Existing channel settings are retained.', 'IPOLLO_IM_DUPLICATE')
  const coordinator = await ctx.agentPresets.resolve(COORDINATOR_PRESET)
  if (coordinator.broken) throw new HarnessError('The main assistant is unavailable. Check the iPolloWork agent module.', 'IPOLLO_COORDINATOR_UNAVAILABLE')
  await createImHostPlugin().apply(ctx, { ...config, entryAgentPreset: COORDINATOR_PRESET })
}
