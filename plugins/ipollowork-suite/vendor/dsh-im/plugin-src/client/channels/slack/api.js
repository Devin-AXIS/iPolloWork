import { TOKEN_BOT_ENDPOINTS, createTokenChannelApi } from '../shared/token-api.js';

export const SLACK_RPC_CHANNEL = '/slack';
export const SLACK_ENDPOINTS = TOKEN_BOT_ENDPOINTS;

const api = createTokenChannelApi('Slack', ' Socket Mode 长连接');

export const unwrapRpcResult = api.unwrapRpcResult;
export const normalizeSnapshot = api.normalizeSnapshot;
export const presentError = api.presentError;
export { api as slackClientApi };
