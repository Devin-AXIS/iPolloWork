/** Opt-in real helper transport check; never requests macOS permissions. */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import ComputerUse from '@deepseek-ai/dsh-computer-use'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import * as Native from '@deepseek-ai/dsh-cua-macos'
import { expect, it } from 'vitest'

it.skipIf(!process.env.IPOLLO_CUA_TEST_HELPER)('connects the packaged helper and reads permissions without prompting', async () => {
  const ctx = new Context()
  ctx.baseUrl = import.meta.url
  try {
    await ctx.plugin(Loader)
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    await mountAgentLoopTestHarness(ctx)
    await ctx.plugin(ComputerUse)
    await ctx.plugin(Subprocess)
    await ctx.plugin(Native, { helperPath: process.env.IPOLLO_CUA_TEST_HELPER })
    const state = await ctx.cuaAccess.systemStatus()
    expect(state.platform).toBe('darwin')
    expect(typeof state.accessibility).toBe('boolean')
    expect(typeof state.screenRecording).toBe('boolean')
    console.log('Real helper permissions returned; PTC status:', ctx.cuaAccess.ptcConfiguration())
  } finally { await ctx.fiber.dispose() }
})
