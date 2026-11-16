/**
 * The switch for app data, an entry of the iPolloWork bundle that is enabled by default. While it is enabled the suite
 * offers the Data page, the `app_data` tool, the `app-data` skill and the `ipolloData` service; disabling it in the
 * plugin manager withdraws all four. Records stay in the account service either way.
 */
import { type Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    ipolloAppDataFeature: AppDataFeature
  }
}

/** Presence follows this plugin's lifetime; the suite's app data registrations depend on it. */
export class AppDataFeature extends Service {
  constructor(ctx: Context) {
    super(ctx, 'ipolloAppDataFeature')
  }
}

export const name = 'ipollowork-app-data'
/**
 * Enable app data for the suite.
 * @param ctx - the plugin scope.
 */
export function apply(ctx: Context): void {
  new AppDataFeature(ctx)
}
