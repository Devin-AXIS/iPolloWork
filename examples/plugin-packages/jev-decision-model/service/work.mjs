import { createJevActions } from './jev.mjs';

export default function createService(runtime) {
  const service = createJevActions({
    getApiKey: async () => (await runtime.authorization.getCredential('typesafe-api-key'))?.apiKey,
  });
  return {
    dispose: service.dispose,
    actions: Object.fromEntries(Object.entries(service.actions).map(([id, action]) => [id, args => action(args)])),
  };
}
