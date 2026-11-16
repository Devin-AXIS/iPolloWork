import { HarnessClient } from '../shared/harness-client.mjs';

export class WecomAppHarnessClient extends HarnessClient {
  constructor(options) {
    super({
      ...options,
      rpcIdPrefix: 'wecomapp',
      logPrefix: 'dsh-wecom-app',
    });
  }
}
