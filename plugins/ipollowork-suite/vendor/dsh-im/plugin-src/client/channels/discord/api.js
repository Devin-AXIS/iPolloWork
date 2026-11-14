import { TOKEN_BOT_ENDPOINTS, createTokenChannelApi } from '../shared/token-api.js';

export const DISCORD_RPC_CHANNEL = '/discord';
export const DISCORD_ENDPOINTS = TOKEN_BOT_ENDPOINTS;

const api = createTokenChannelApi('Discord', ' Gateway 长连接');

export const unwrapRpcResult = api.unwrapRpcResult;
export const normalizeSnapshot = api.normalizeSnapshot;
export const presentError = api.presentError;
export { api as discordClientApi };
