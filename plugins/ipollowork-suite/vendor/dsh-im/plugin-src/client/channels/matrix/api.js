import { TOKEN_BOT_ENDPOINTS, createTokenChannelApi } from '../shared/token-api.js';

export const MATRIX_RPC_CHANNEL = '/matrix';
export const MATRIX_ENDPOINTS = TOKEN_BOT_ENDPOINTS;

const api = createTokenChannelApi('Matrix', ' CS API 长轮询');

export const unwrapRpcResult = api.unwrapRpcResult;
export const normalizeSnapshot = api.normalizeSnapshot;
export const presentError = api.presentError;
export { api as matrixClientApi };
