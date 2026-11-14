import { resolveRpcAuthority } from './host/rpc-authority.mjs';

function rpcEndpoint(channel) {
  if (!/^\/[A-Za-z0-9._~-]+$/.test(channel)) throw new TypeError('Invalid IM RPC channel');
  return `dsh-im${channel}`;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLoopbackAuthority(authority) {
  if (!authority) return false;
  try {
    const url = new URL(`http://${authority}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false;
    const hostname = url.hostname.replace(/\.$/, '');
    return hostname === 'localhost' || hostname === '[::1]'
      || /^127\.\d+\.\d+\.\d+$/.test(hostname);
  } catch { return false; }
}

function isLoopbackRequest(request) {
  if (!isLoopbackAuthority(request.headers.get('host'))) return false;
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && isLoopbackAuthority(url.host);
  } catch { return false; }
}

function reply(rpcId, result) {
  // Older endpoint handlers omit details; Connection's client requires the field.
  const value = result.ok === false
    ? { ...result, error: { ...result.error, details: result.error.details ?? {} } } : result;
  return Response.json({ type: 'server-response', rpcId, result: value });
}

/** Register an IM channel through the public /api carrier shared by supported DSH releases. */
export function registerManagementRpc(ctx, channel, handler, { authority } = {}) {
  const policy = resolveRpcAuthority(authority);
  const endpoint = rpcEndpoint(channel);
  if (typeof ctx?.connection?.fetch?.register !== 'function') {
    throw new TypeError('DSH Host Connection Fetch registry is required');
  }
  return ctx.connection.fetch.register({
    path: `/api/${endpoint}`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      // DSH applies browser authentication and Host/Origin trust before this handler.
      if (policy === 'loopback' && !isLoopbackRequest(request)) return new Response('forbidden', { status: 403 });
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 });
      }
      let message;
      try { message = await request.json(); }
      catch { return new Response('body is not JSON', { status: 400 }); }
      const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request';
      const call = message?.payload;
      if (!isRecord(message) || message.type !== 'client-request' || typeof message.rpcId !== 'string'
        || message.method !== endpoint || !isRecord(call) || typeof call.method !== 'string'
        || !Object.hasOwn(call, 'payload')) {
        return reply(rpcId, { ok: false, error: { code: 'gateway/bad-request', message: 'Invalid IM management request.' } });
      }
      try { return reply(rpcId, await handler(call.method, call.payload, request.signal)); }
      catch { return new Response('IM management handler failed', { status: 500 }); }
    },
  });
}

function managementHttpStatus(cause, endpoint) {
  if (Number.isInteger(cause?.status) && cause.status >= 100 && cause.status <= 599) return cause.status;
  // DSH 0.2.x throws a plain Error for HTTP failures. Accept only its exact
  // transport message for this request, never an arbitrary embedded number.
  const prefix = `transport failure for /api/${endpoint}: HTTP `;
  if (!endpoint || typeof cause?.message !== 'string' || !cause.message.startsWith(prefix)) return undefined;
  const status = Number(cause.message.slice(prefix.length));
  return Number.isInteger(status) && status >= 100 && status <= 599 && cause.message === `${prefix}${status}`
    ? status : undefined;
}

function managementErrorMessage(status) {
  if (status === 401) return 'DSH 登录状态无效或已过期，请通过有效启动链接重新登录。';
  if (status === 403) return 'DSH 拒绝了当前管理请求（HTTP 403）。请检查访问权限、可信地址配置及代理设置；若启用了仅本机访问，请按该限制访问。';
  if (status === 404) return 'DSH 管理接口不存在（HTTP 404），请检查 Host 与插件版本及代理路径，重启后重试。';
  if (status >= 500) return 'DSH 管理服务暂时异常，请检查服务状态或稍后重试。';
  return 'DSH 管理请求失败，请检查服务状态和网络连接后重试。';
}

/** Keep channel UI callers unchanged while using DSH's native correlation and response validation. */
export async function callManagementRpc(connection, channel, method, payload, signal) {
  let endpoint;
  try {
    endpoint = rpcEndpoint(channel);
    return await connection.rpc.call('/api', endpoint, { method, payload }, signal);
  } catch (cause) {
    if (signal?.aborted || cause?.name === 'AbortError') throw cause;
    const httpStatus = managementHttpStatus(cause, endpoint);
    const error = new Error(managementErrorMessage(httpStatus), { cause });
    error.code = 'management-unreachable';
    error.details = { operation: method, stage: 'management.request', occurredAt: new Date().toISOString(),
      ...(httpStatus === undefined ? {} : { httpStatus }),
    };
    throw error;
  }
}
