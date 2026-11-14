import {
  EnvHttpProxyAgent,
  FormData as UndiciFormData,
  fetch as undiciFetch,
} from 'undici';

const TELEGRAM_CONNECTIONS = 4;

export function createTelegramHttpTransport() {
  const dispatcher = new EnvHttpProxyAgent({ connections: TELEGRAM_CONNECTIONS });
  let destroyed = false;
  return {
    fetchImpl: (url, options = {}) => undiciFetch(url, { ...options, dispatcher }),
    FormDataImpl: UndiciFormData,
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      await dispatcher.destroy();
    },
  };
}
