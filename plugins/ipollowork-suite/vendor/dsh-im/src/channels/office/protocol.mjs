export const OFFICE_PROTOCOL_VERSION = 'office-harness.v1';
export const OFFICE_RPC_CHANNEL = '/office';

export const OFFICE_RPC_ENDPOINTS = Object.freeze({
  status: 'connection.status',
  configure: 'connector.configure',
  reconnect: 'connector.reconnect',
  test: 'connector.test',
  remove: 'connector.remove',
});

export const OFFICE_HOOK_PATHS = Object.freeze({
  stream: '/api/harness/connector/stream',
  heartbeat: '/api/harness/connector/heartbeat',
  job: '/api/harness/connector/jobs/:id',
  accept: '/api/harness/connector/jobs/:id/accept',
  renew: '/api/harness/connector/jobs/:id/renew',
  progress: '/api/harness/connector/jobs/:id/progress',
  approval: '/api/harness/connector/jobs/:id/approval',
  result: '/api/harness/connector/jobs/:id/result',
  fail: '/api/harness/connector/jobs/:id/fail',
});

export function normalizeOfficeBaseUrl(value) {
  const url = new URL(typeof value === 'string' ? value.trim() : '');
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) {
    throw new TypeError('AI Office URL must use HTTPS (HTTP is allowed only for loopback testing)');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError('AI Office URL must be a bare origin');
  }
  url.pathname = '/';
  return url;
}

export function officeHookUrls(baseUrl) {
  const origin = normalizeOfficeBaseUrl(baseUrl);
  return Object.fromEntries(Object.entries(OFFICE_HOOK_PATHS).map(([name, path]) => [
    name,
    new URL(path, origin).toString(),
  ]));
}
