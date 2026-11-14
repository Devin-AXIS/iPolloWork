import {
  deriveTokenBotIdentity,
  maskPlatformId,
  TokenBotConfigStore,
} from '../shared/token-config-store.mjs';

const IDENTITY_OPTIONS = Object.freeze({
  botPrefix: 'imessage',
  tokenRefPrefix: 'DSH_IMESSAGE_PASSWORD',
});

export function deriveIMessageBotIdentity(platformId) {
  return deriveTokenBotIdentity(platformId, IDENTITY_OPTIONS);
}

export function maskIMessageBotId(platformId) {
  return maskPlatformId(platformId, 'iMessage 网关');
}

export class IMessageConfigStore extends TokenBotConfigStore {
  constructor(path) {
    super(path, { channel: 'iMessage', ...IDENTITY_OPTIONS });
  }
}
