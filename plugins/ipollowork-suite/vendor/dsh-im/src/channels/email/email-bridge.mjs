import { TextHarnessBridge, createTextBridgeStatus } from '../shared/text-harness-bridge.mjs';

export const EMAIL_DESCRIPTOR = Object.freeze({
  key: 'email',
  label: 'Email',
  connectionLabel: ' IMAP/SMTP 邮箱',
  // Email has no reaction concept; the fields stay for descriptor parity.
  reactions: Object.freeze({ processing: '', success: '', error: '' }),
});

export class EmailHarnessBridge extends TextHarnessBridge {
  constructor(options) {
    super({ ...options, descriptor: EMAIL_DESCRIPTOR });
  }
}

export { createTextBridgeStatus as createEmailBridgeStatus };
