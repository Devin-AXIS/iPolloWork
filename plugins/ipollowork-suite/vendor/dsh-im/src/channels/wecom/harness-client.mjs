import { HarnessClient } from '../shared/harness-client.mjs';

export class WecomHarnessClient extends HarnessClient {
  constructor(options) {
    super({
      ...options,
      rpcIdPrefix: 'wecom',
      logPrefix: 'dsh-wecom',
    });
  }
}
