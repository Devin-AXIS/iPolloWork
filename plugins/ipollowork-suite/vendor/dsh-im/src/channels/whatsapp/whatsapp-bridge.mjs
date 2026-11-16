import { t } from '../shared/i18n.mjs';
import { createTextBridgeStatus, TextHarnessBridge } from '../shared/text-harness-bridge.mjs';

export const WHATSAPP_DESCRIPTOR = Object.freeze({
  key: 'whatsapp',
  label: 'WhatsApp',
  // Translated lazily: t() must run after setImHostLanguage, not at import time.
  get connectionLabel() { return t(' Web 关联设备'); },
  reactions: Object.freeze({ processing: '👀', success: '✅', error: '❌' }),
});

export class WhatsappHarnessBridge extends TextHarnessBridge {
  constructor(options) {
    super({ ...options, descriptor: WHATSAPP_DESCRIPTOR });
  }
}

export { createTextBridgeStatus as createWhatsappBridgeStatus };
