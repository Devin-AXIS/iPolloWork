import { HarnessClient } from '../shared/harness-client.mjs';

export class SlackHarnessClient extends HarnessClient {
  constructor(options) {
    super({
      ...options,
      rpcIdPrefix: 'slack',
      logPrefix: 'dsh-slack',
    });
  }
}
