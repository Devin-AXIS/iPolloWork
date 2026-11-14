import { HarnessClient } from '../shared/harness-client.mjs';

export class QqHarnessClient extends HarnessClient {
  constructor(options) {
    super({
      ...options,
      rpcIdPrefix: 'qq',
      logPrefix: 'dsh-qq',
    });
  }
}
