import { TokenBotController } from '../shared/token-bot-controller.mjs';
import { deriveDiscordBotIdentity, maskDiscordBotId } from './config-store.mjs';
import { inspectDiscordOwner, inspectDiscordToken } from './discord-api.mjs';
import { DISCORD_DESCRIPTOR } from './discord-bridge.mjs';

export class DiscordController extends TokenBotController {
  constructor(options) {
    if (typeof options.createRuntime !== 'function') throw new TypeError('Discord runtime factory must be a function');
    const inspectOwner = options.inspectOwner ?? inspectDiscordOwner;
    if (typeof inspectOwner !== 'function') throw new TypeError('Discord owner inspector must be a function');
    super({
      ...options,
      descriptor: DISCORD_DESCRIPTOR,
      inspectToken: options.inspectToken ?? inspectDiscordToken,
      deriveIdentity: deriveDiscordBotIdentity,
      maskPlatformId: maskDiscordBotId,
      createRuntime: async (request) => {
        // Run inside the parent's existing per-bot transition. The production
        // callback must receive the committed owner before building its policy.
        let config = options.configStore.get(request.botId) ?? request.config;
        try {
          const ownerUserId = await inspectOwner(request.token, { platformId: config.platformId });
          if (ownerUserId != null && ownerUserId !== config.ownerUserId) {
            config = await options.configStore.save({ ...config, ownerUserId });
          }
        } catch {
          // Neither provider errors nor optional metadata writes should break
          // an otherwise usable bot. Do not log provider responses or user IDs.
          (options.logger ?? console).warn?.('[dsh-im:discord] owner lookup unavailable; using saved identity', {
            botId: request.botId,
          });
        }
        return options.createRuntime({ ...request, config });
      },
    });
  }
}
