import {
  deriveTokenBotIdentity,
  maskPlatformId,
  TokenBotConfigStore,
} from '../shared/token-config-store.mjs';
import { t } from '../shared/i18n.mjs';

const IDENTITY_OPTIONS = Object.freeze({
  botPrefix: 'discord',
  tokenRefPrefix: 'DSH_DISCORD_BOT_TOKEN',
});

export function deriveDiscordBotIdentity(platformId) {
  return deriveTokenBotIdentity(platformId, IDENTITY_OPTIONS);
}

export function maskDiscordBotId(platformId) {
  return maskPlatformId(platformId, t('Discord机器人'));
}

export class DiscordConfigStore extends TokenBotConfigStore {
  constructor(path) {
    super(path, {
      channel: 'Discord',
      ...IDENTITY_OPTIONS,
      normalizeBotExtension(value) {
        if (value.ownerUserId == null) return { ownerUserId: null };
        const ownerUserId = typeof value.ownerUserId === 'string' ? value.ownerUserId.trim() : '';
        if (!/^\d{5,30}$/.test(ownerUserId) || ownerUserId === value.platformId?.trim()) return null;
        return { ownerUserId };
      },
    });
  }

  save(value) {
    // Shared credential binding rebuilds the base config. Preserve only this
    // bot's confirmed identity when omitted; explicit null still clears it.
    return super.save({
      ...value,
      ownerUserId: value?.ownerUserId === undefined
        ? this.get(value?.botId)?.ownerUserId ?? null
        : value.ownerUserId,
    });
  }
}
