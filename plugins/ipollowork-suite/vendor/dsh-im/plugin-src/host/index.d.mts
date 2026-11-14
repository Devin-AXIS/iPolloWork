/** Typed entry for the adapted MIT runtime. */
import type { Context } from '@deepseek-ai/cordis'
export const inject: string[]
export function createImHostPlugin(): { apply(ctx: Context, config: Record<string, unknown>): Promise<void> }
