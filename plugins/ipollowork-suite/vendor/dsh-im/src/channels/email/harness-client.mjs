import { HarnessClient } from '../shared/harness-client.mjs';

export class EmailHarnessClient extends HarnessClient {
  constructor(options) {
    super({ ...options, rpcIdPrefix: 'email', logPrefix: 'dsh-email' });
  }
}
