import { HarnessClient } from '../shared/harness-client.mjs';

export class WhatsappHarnessClient extends HarnessClient {
  constructor(options) {
    super({
      ...options,
      rpcIdPrefix: 'whatsapp',
      logPrefix: 'dsh-whatsapp',
    });
  }
}
