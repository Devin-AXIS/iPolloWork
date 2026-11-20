import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';

export const name = 'ipollo-notification-center';
export const Config = z.object({
  sourceEnabled: z.dict(z.boolean()).default({}).volatile(),
});

export function apply(ctx: Context): void {
  ctx.inject(['settings'], scope => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber));
  });
}
