import { openAsBlob } from 'node:fs';

const ORIGIN = 'https://open.douyin.com';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 128 * 1024 * 1024;
const INT64_MAX = 9223372036854775807n;

// These scopes belong to these exact endpoints. Legacy list/data/comment
// permissions are not interchangeable with mini-app or *.bind permissions.
export const CAPABILITY_SCOPES = Object.freeze({
  userInfo: Object.freeze(['user_info']),
  publish: Object.freeze(['video.create.bind']),
  listVideos: Object.freeze(['video.list']),
  videoData: Object.freeze(['video.data']),
  listComments: Object.freeze(['item.comment']),
  replyComment: Object.freeze(['item.comment']),
  searchVideos: Object.freeze(['aweme.dy.video_search']),
});

export class ApiError extends Error {
  constructor(message, { code = 'DOUYIN_API_ERROR', uncertain = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.uncertain = uncertain;
  }
}

function invalid(message) { throw new ApiError(message, { code: 'INVALID_ARGUMENT' }); }

function required(value, label, max = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    invalid(`${label} 不能为空、含控制字符或超过 ${max} 字符。`);
  }
  return value;
}

function int64(value, label, positive = false) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) invalid(`${label} 必须是安全整数或十进制整数字符串。`);
  if (!['number', 'string'].includes(typeof value) || !/^\d{1,19}$/.test(String(value))) invalid(`${label} 必须是非负 Int64 整数。`);
  const integer = BigInt(value);
  if (integer > INT64_MAX || (positive && integer === 0n)) invalid(`${label} 超出 Int64 范围。`);
  return String(integer);
}

function page(cursor, count, maximum) {
  if (!Number.isInteger(count) || count < 1 || count > maximum) invalid(`每页数量必须为 1–${maximum}。`);
  return { cursor: int64(cursor, '分页游标'), count };
}

function auth(accessToken, openId) {
  return { accessToken: required(accessToken, '访问令牌'), query: { open_id: required(openId, 'OpenID') } };
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonempty(value) { return typeof value === 'string' && value.length > 0; }

// Never include upstream descriptions or transport exceptions: either may echo
// client secrets, OAuth codes, tokens, or request bodies into the UI and logs.
function apiMessage(code) {
  if ([10007].includes(code)) return '授权码已过期或已经使用，请重新授权。';
  if ([10010].includes(code)) return '刷新令牌已过期，请重新授权。';
  if ([10003, 10013, 10014, 29002002].includes(code)) return '应用凭据不正确，请检查 Client Key 和 Client Secret。';
  if ([10008, 2190002, 28001003, 28001008].includes(code)) return '抖音访问令牌无效或已过期，请刷新或重新授权。';
  if ([2190004, 28001014, 28001018, 28001019].includes(code)) return '应用未获准使用该接口，请检查开发者控制台的能力权限和用户授权范围。';
  if ([28001016].includes(code)) return '应用已被封禁或下线，请检查开发者控制台。';
  if ([10020, 28003017, 2118110, 2114007].includes(code)) return '请求频率、接口配额或每日发布数量已达上限。';
  if ([2190005].includes(code)) return '视频文件超过平台允许的大小。';
  if ([2114006].includes(code)) return '视频时长超过平台限制。';
  if ([2190007].includes(code)) return '上传视频标识无效，请检查上传结果。';
  if ([10002, 10005, 2100005, 28001007].includes(code)) return '请求参数或视频状态不符合接口要求，请检查对应内容是否公开且属于授权账号。';
  if ([10001, 2100004, 28001005, 28001006].includes(code)) return '抖音接口暂时异常，请先核对操作结果。';
  return '抖音接口拒绝请求，请检查开发者控制台的接口权限、用户授权及请求参数。';
}

async function readJson(response, uncertain) {
  const malformed = () => new ApiError('抖音接口返回了无法识别的结果，请先核对操作是否完成。', { code: 'INVALID_RESPONSE', uncertain });
  const advertisedLength = Number(response.headers.get('content-length'));
  if (advertisedLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new ApiError('抖音接口响应超过 2 MiB，请缩小查询范围。', { code: 'RESPONSE_TOO_LARGE', uncertain });
  }
  if (!response.body) throw malformed();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ApiError('抖音接口响应超过 2 MiB，请缩小查询范围。', { code: 'RESPONSE_TOO_LARGE', uncertain });
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    // Preserve opaque IDs and pagination cursors that exceed JS safe integers.
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'), (_key, value, context) =>
      typeof value === 'number' && !Number.isSafeInteger(value) && /^-?\d+$/.test(context.source) ? context.source : value);
  } catch { throw malformed(); }
}

export class DouyinApi {
  #fetch;
  #timeoutMs;

  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
    if (typeof fetchImpl !== 'function') invalid('需要可用的 fetch 实现。');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) invalid('接口超时必须为 1–300000 毫秒。');
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async #request(path, { method = 'GET', query = {}, accessToken, body, form, mutating = false, unwrap = result => result.data, validate = object } = {}) {
    const url = new URL(path, ORIGIN);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const headers = { accept: 'application/json' };
    if (accessToken !== undefined) headers['access-token'] = required(accessToken, '访问令牌');
    let payload;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(form);
    } else if (body instanceof FormData) {
      payload = body;
    } else {
      headers['content-type'] = 'application/json';
      if (body !== undefined) payload = JSON.stringify(body);
    }
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ApiError('抖音请求超时，请先核对操作结果再决定是否重试。', { code: 'TIMEOUT', uncertain: mutating }));
      }, this.#timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await this.#fetch(url, { method, headers, body: payload, signal: controller.signal, redirect: 'error' });
        if (!response.ok) {
          await response.body?.cancel();
          throw new ApiError(`抖音接口返回 HTTP ${response.status}。`, { code: `HTTP_${response.status}`, uncertain: mutating && (response.status >= 500 || response.status === 408) });
        }
        const result = await readJson(response, mutating);
        const codes = [result?.err_no, result?.error_code, result?.data?.error_code, result?.extra?.error_code, result?.data?.extra?.error_code, result?.data?.data?.error_code].filter(code => code !== undefined);
        if (!codes.length || codes.some(code => !/^(?:0|[1-9]\d{0,11})$/.test(String(code)))) {
          throw new ApiError('抖音接口未返回有效状态码，请先核对操作结果。', { code: 'INVALID_RESPONSE', uncertain: mutating });
        }
        const errorCode = codes.map(Number).find(code => code !== 0);
        if (errorCode !== undefined) {
          // Internal failures may be reported in an HTTP 200 envelope after a write.
          throw new ApiError(`${apiMessage(errorCode)}（${errorCode}）`, { code: errorCode, uncertain: mutating && [10001, 2100004, 28001005, 28001006].includes(errorCode) });
        }
        const data = unwrap(result);
        if (!object(data) || !validate(data)) throw new ApiError('抖音接口结果缺少必要字段，请先核对操作是否完成。', { code: 'INVALID_RESPONSE', uncertain: mutating });
        return data;
      })()]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('无法完成抖音接口请求，请检查网络并先核对操作结果。', { code: 'NETWORK_ERROR', uncertain: mutating });
    } finally { clearTimeout(timer); }
  }

  exchangeCode({ clientKey, clientSecret, code }) {
    return this.#request('/oauth/access_token/', { method: 'POST', mutating: true,
      form: { client_key: required(clientKey, 'Client Key'), client_secret: required(clientSecret, 'Client Secret'), code: required(code, '授权码'), grant_type: 'authorization_code' },
      validate: data => nonempty(data.access_token) && nonempty(data.open_id) && nonempty(data.refresh_token),
    });
  }

  refreshToken({ clientKey, refreshToken }) {
    return this.#request('/oauth/refresh_token/', { method: 'POST', mutating: true,
      form: { client_key: required(clientKey, 'Client Key'), refresh_token: required(refreshToken, '刷新令牌'), grant_type: 'refresh_token' },
      validate: data => nonempty(data.access_token) && nonempty(data.open_id),
    });
  }

  clientToken({ clientKey, clientSecret }) {
    return this.#request('/oauth/client_token/', { method: 'POST', mutating: true,
      body: { client_key: required(clientKey, 'Client Key'), client_secret: required(clientSecret, 'Client Secret'), grant_type: 'client_credential' },
      validate: data => nonempty(data.access_token) && Number(data.expires_in) > 0,
    });
  }

  userInfo({ accessToken, openId }) {
    return this.#request('/oauth/userinfo/', { method: 'POST', body: { access_token: required(accessToken, '访问令牌'), open_id: required(openId, 'OpenID') }, validate: data => nonempty(data.open_id) });
  }

  // Existing approved mobile/web applications only; see README API sources.
  listVideos({ accessToken, openId, cursor = 0, count = 20 }) {
    const credentials = auth(accessToken, openId);
    return this.#request('/video/list/', { ...credentials, query: { ...credentials.query, ...page(cursor, count, 20) }, validate: data => Array.isArray(data.list) });
  }

  videoData({ accessToken, openId, itemIds }) {
    if (!Array.isArray(itemIds) || !itemIds.length || itemIds.length > 20) invalid('每次查询需要 1–20 个视频标识。');
    return this.#request('/video/data/', { ...auth(accessToken, openId), method: 'POST', body: { item_ids: itemIds.map(id => required(id, '视频标识')) }, validate: data => Array.isArray(data.list) });
  }

  async uploadVideo({ accessToken, openId, filePath }) {
    const credentials = auth(accessToken, openId);
    required(filePath, '视频文件路径');
    let blob;
    try { blob = await openAsBlob(filePath, { type: 'video/mp4' }); }
    catch { throw new ApiError('无法读取视频文件，请重新选择本地 MP4。', { code: 'INVALID_VIDEO' }); }
    if (blob.size < 16 || blob.size > MAX_VIDEO_BYTES) invalid('视频必须为非空 MP4，大小不得超过 128 MiB。');
    let header;
    try { header = Buffer.from(await blob.slice(0, 32).arrayBuffer()); }
    catch { throw new ApiError('视频文件读取失败或已被修改，请重新选择文件。', { code: 'INVALID_VIDEO' }); }
    const boxSize = header.readUInt32BE(0);
    const brand = header.toString('ascii', 8, 12);
    if (header.toString('ascii', 4, 8) !== 'ftyp' || boxSize < 16 || boxSize > blob.size || !/^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)$/.test(brand)) invalid('文件不包含受支持的 MP4 文件头。');
    const body = new FormData();
    body.set('video', blob, 'video.mp4');
    return this.#request('/api/douyin/v1/video/upload_video/', { ...credentials, method: 'POST', body, mutating: true, validate: data => nonempty(data.video?.video_id) });
  }

  createVideo({ accessToken, openId, videoId, text }) {
    if (typeof text !== 'string' || [...text].length > 1000 || /[\u0000\u007f]/u.test(text)) invalid('视频文案必须是最多 1000 字的文本。');
    return this.#request('/api/douyin/v1/video/create_video/', { ...auth(accessToken, openId), method: 'POST', body: { video_id: required(videoId, '上传视频标识'), text }, mutating: true, validate: data => nonempty(data.item_id) });
  }

  listComments({ accessToken, openId, itemId, cursor = 0, count = 20 }) {
    const credentials = auth(accessToken, openId);
    return this.#request('/item/comment/list/', { ...credentials, query: { ...credentials.query, item_id: required(itemId, '视频标识'), ...page(cursor, count, 50) }, validate: data => Array.isArray(data.list) });
  }

  replyComment({ accessToken, openId, itemId, commentId, content }) {
    return this.#request('/item/comment/reply/', { ...auth(accessToken, openId), method: 'POST', body: { item_id: required(itemId, '视频标识'), comment_id: required(commentId, '评论标识'), content: required(content, '回复内容', 300) }, mutating: true, validate: data => nonempty(data.comment_id) });
  }

  searchVideos({ clientToken, keyword, deviceId, cursor = 0, count = 20, searchId }) {
    const pagination = page(cursor, count, 20);
    const query = { ...pagination, keyword: required(keyword, '搜索词', 100), device_id: int64(deviceId, '设备 ID', true) };
    if (searchId !== undefined && searchId !== '') query.search_id = required(searchId, '搜索 ID');
    if (pagination.cursor !== '0' && !query.search_id) invalid('继续搜索需要首屏返回的 search_id。');
    return this.#request('/dy_open_api/v1/search/video/', { accessToken: required(clientToken, '应用令牌'), query, unwrap: result => result.data?.data, validate: data => Array.isArray(data.video_list) });
  }
}
