import { HarnessClient } from '../shared/harness-client.mjs';

export class TelegramHarnessClient extends HarnessClient {
  constructor(options) {
    super({
      ...options,
      rpcIdPrefix: 'telegram',
      logPrefix: 'dsh-telegram',
    });
  }
}
