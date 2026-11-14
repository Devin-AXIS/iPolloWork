import { startQrConnect } from '@tencent-connect/qqbot-connector';

export class QqQrAuth {
  #start;
  #source;

  constructor({ start = startQrConnect, source = 'deepseek-harness' } = {}) {
    if (typeof start !== 'function') throw new TypeError('QQ QR connector is required');
    this.#start = start;
    this.#source = source;
  }

  start(callbacks, { signal } = {}) {
    if (!callbacks || typeof callbacks.onSuccess !== 'function'
      || typeof callbacks.onFailure !== 'function') {
      throw new TypeError('QQ QR callbacks are required');
    }
    return this.#start(callbacks, {
      displayQrCodeToConsole: false,
      source: this.#source,
      signal,
    });
  }
}
