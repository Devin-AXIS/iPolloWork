import { HarnessClient } from '../shared/harness-client.mjs';

export class MatrixHarnessClient extends HarnessClient {
  constructor(options) {
    super({
      ...options,
      rpcIdPrefix: 'matrix',
      logPrefix: 'dsh-matrix',
    });
  }
}
