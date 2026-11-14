import { HarnessClient } from '../shared/harness-client.mjs';

export class IMessageHarnessClient extends HarnessClient {
  constructor(options) {
    super({ ...options, rpcIdPrefix: 'imessage', logPrefix: 'dsh-imessage' });
  }
}
