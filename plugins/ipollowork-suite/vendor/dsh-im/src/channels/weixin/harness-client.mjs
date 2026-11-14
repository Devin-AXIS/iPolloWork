import {
  HarnessClient as SharedHarnessClient,
} from '../shared/harness-client.mjs';

export {
  HarnessInteractionError,
  HarnessReplyTracker,
  HarnessRpcError,
} from '../shared/harness-client.mjs';

export class HarnessClient extends SharedHarnessClient {
  constructor(options) {
    super({
      ...options,
      rpcIdPrefix: 'weixin',
      logPrefix: 'dsh-weixin',
    });
  }
}
