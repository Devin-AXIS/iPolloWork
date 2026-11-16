/** Optional cloud-project connector. It contributes no local execution tools. */
import { Context, Service } from '@deepseek-ai/cordis';

declare module '@deepseek-ai/cordis' { interface Context { ipolloCloud: CloudProjectsCapability } }
/** Presence follows the plugin lifetime; the main suite queries it before every operation. */
export class CloudProjectsCapability extends Service {
  constructor(ctx:Context) { super(ctx,'ipolloCloud'); }
}
export const name='ipollowork-cloud-projects';
/** Publish cloud availability only for this plugin lifetime. */
export function apply(ctx:Context):void { new CloudProjectsCapability(ctx); }
