import { HarnessClient } from '../shared/harness-client.mjs';

export class DiscordHarnessClient extends HarnessClient {
  constructor(options) {
    super({
      ...options,
      rpcIdPrefix: 'discord',
      logPrefix: 'dsh-discord',
    });
  }
}
