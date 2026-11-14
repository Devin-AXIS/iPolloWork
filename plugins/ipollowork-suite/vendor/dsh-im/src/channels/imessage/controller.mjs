import { TokenBotController } from '../shared/token-bot-controller.mjs';
import { MacOSMessagesApi } from './imessage-api.mjs';
import {
  deriveIMessageBotIdentity,
  maskIMessageBotId,
} from './config-store.mjs';
import { IMESSAGE_DESCRIPTOR } from './imessage-bridge.mjs';

const NATIVE_CREDENTIAL = 'macos-messages-native';

export async function inspectIMessageCredential(value, { api = new MacOSMessagesApi() } = {}) {
  if (value !== NATIVE_CREDENTIAL) throw new TypeError('Invalid native iMessage credential');
  const permissions = await api.getPermissions();
  return { platformId: 'macos-messages', name: 'Mac Messages', permissions };
}

export class IMessageController extends TokenBotController {
  constructor(options) {
    super({
      ...options,
      descriptor: IMESSAGE_DESCRIPTOR,
      inspectToken: options.inspectToken ?? inspectIMessageCredential,
      deriveIdentity: deriveIMessageBotIdentity,
      maskPlatformId: maskIMessageBotId,
    });
  }

  async bindNative() {
    return super.bindCredentials({ token: NATIVE_CREDENTIAL });
  }

  async permissions() {
    return new MacOSMessagesApi().getPermissions();
  }
}

export { NATIVE_CREDENTIAL };
