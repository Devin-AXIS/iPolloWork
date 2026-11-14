import { WecomCrypto } from '@wecom/aibot-node-sdk';

import { t } from '../shared/i18n.mjs';

// Enterprise WeChat self-built application protocol layer: URL verification and
// encrypted callbacks share the official WeCom crypto scheme exposed by
// @wecom/aibot-node-sdk, while outbound messages use the public cgi-bin API.

export const WECOM_APP_DEFAULT_API_BASE = 'https://qyapi.weixin.qq.com';
export const WECOM_APP_TEXT_MAX_BYTES = 2048;
export const WECOM_APP_STREAM_PLACEHOLDER = () => t('正在思考中…');

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class WecomAppError extends Error {
  constructor(code, message, { providerCode, hint } = {}) {
    super(message);
    this.name = 'WecomAppError';
    this.code = code;
    this.providerCode = providerCode;
    this.hint = hint;
  }
}

export function normalizeApiBaseUrl(value) {
  const raw = cleanString(value);
  if (!raw) return WECOM_APP_DEFAULT_API_BASE;
  if (!/^https?:\/\//iu.test(raw)) {
    throw new WecomAppError('invalid-api-base', '代理地址必须是 http(s) 地址');
  }
  return raw.replace(/\/+$/u, '');
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

// WeCom text messages accept at most 2048 UTF-8 bytes per message; split on
// code-point boundaries so multi-byte characters are never cut in half.
export function splitUtf8ByBytes(text, maxBytes = WECOM_APP_TEXT_MAX_BYTES) {
  const value = typeof text === 'string' ? text : '';
  if (value === '') return [''];
  const chunks = [];
  let current = '';
  let currentBytes = 0;
  for (const char of value) {
    const size = byteLength(char);
    if (currentBytes + size > maxBytes && current.length > 0) {
      chunks.push(current);
      current = char;
      currentBytes = size;
      continue;
    }
    current += char;
    currentBytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// Parses the two XML shapes WeCom uses (CDATA-wrapped and plain values).
// Enterprise WeChat payloads are small, flat dictionaries, so a scoped regex
// parser avoids an XML dependency while matching the official samples.
export function parseWecomAppXmlBody(xml) {
  const result = {};
  const source = typeof xml === 'string' ? xml : '';
  const cdataPattern = /<([\w:-]+)><!\[CDATA\[([\s\S]*?)\]\]><\/\1>/gu;
  let match;
  while ((match = cdataPattern.exec(source)) !== null) {
    result[match[1]] = match[2];
  }
  const simplePattern = /<([\w:-]+)>([^<>]*)<\/\1>/gu;
  while ((match = simplePattern.exec(source)) !== null) {
    if (result[match[1]] === undefined) result[match[1]] = match[2];
  }
  return result;
}

export function isXmlFormat(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.startsWith('<') && trimmed.endsWith('>');
}

// Normalizes the decrypted plaintext into the internal inbound message shape.
// Accepts both the JSON and XML callback formats and keeps the JSON field
// names used by the WeCom documentation as canonical.
export function parseWecomAppPlainMessage(raw) {
  const source = typeof raw === 'string' ? raw.trim() : '';
  if (!source) return null;
  let data;
  if (isXmlFormat(source)) {
    const xml = parseWecomAppXmlBody(source);
    data = {
      msgid: xml.MsgId ?? xml.msgid,
      msgtype: (xml.MsgType ?? xml.msgtype ?? '').toLowerCase(),
      createTime: xml.CreateTime ?? xml.createTime,
      agentId: xml.AgentID ?? xml.agentid,
      from: xml.FromUserName ? { userid: xml.FromUserName } : undefined,
      to: xml.ToUserName ?? undefined,
      text: xml.Content !== undefined ? { content: xml.Content } : undefined,
      image: xml.PicUrl ? { url: xml.PicUrl } : undefined,
      mediaId: xml.MediaId ?? xml.mediaid,
      recognition: xml.Recognition,
      format: xml.Format,
      event: (xml.Event ?? xml.event ?? '').toLowerCase() || undefined,
      eventKey: xml.EventKey,
      stream: xml.StreamId ? { id: xml.StreamId } : undefined,
      chatid: xml.ChatId,
    };
  } else {
    try {
      data = JSON.parse(source);
    } catch {
      return null;
    }
    if (!isRecord(data)) return null;
    data = {
      msgid: data.msgid ?? data.MsgId,
      msgtype: String(data.msgtype ?? data.MsgType ?? '').toLowerCase(),
      createTime: data.createTime ?? data.CreateTime,
      agentId: data.agentid ?? data.AgentID,
      from: isRecord(data.from) ? data.from : data.FromUserName ? { userid: data.FromUserName } : undefined,
      to: data.to ?? undefined,
      text: isRecord(data.text) ? data.text : undefined,
      image: isRecord(data.image) ? data.image : undefined,
      mediaId: data.mediaid ?? data.MediaId ?? data.voice?.media_id ?? data.file?.media_id ?? data.video?.media_id,
      recognition: typeof data.recognition === 'string' ? data.recognition : undefined,
      format: data.format ?? data.voice?.format,
      event: String(data.event ?? data.eventtype ?? '').toLowerCase() || undefined,
      eventKey: data.eventkey ?? undefined,
      stream: isRecord(data.stream) ? data.stream : undefined,
      chatid: typeof data.chatid === 'string' ? data.chatid : undefined,
      voice: isRecord(data.voice) ? data.voice : undefined,
    };
  }
  return data;
}

export function createUserCrypto({ token, encodingAESKey, corpId }) {
  return new WecomCrypto(cleanString(token) ?? '', cleanString(encodingAESKey) ?? '', cleanString(corpId) ?? '');
}

// Builds the encrypted passive-reply body in the same XML or JSON envelope the
// callback was received with.
export function buildEncryptedReply({ format, crypto, plaintext, timestamp, nonce }) {
  const plain = typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext ?? {});
  const { encrypt, signature } = crypto.encrypt(plain, String(timestamp), String(nonce));
  if (String(format ?? '').toLowerCase() === 'json') {
    return JSON.stringify({ encrypt, msgsignature: signature, timestamp: String(timestamp), nonce: String(nonce) });
  }
  return [
    '<xml>',
    `<Encrypt><![CDATA[${encrypt}]]></Encrypt>`,
    `<MsgSignature><![CDATA[${signature}]]></MsgSignature>`,
    `<TimeStamp>${String(timestamp)}</TimeStamp>`,
    `<Nonce><![CDATA[${String(nonce)}]]></Nonce>`,
    '</xml>',
  ].join('');
}

class WecomAppTokenCache {
  #api;
  #value = null;
  #expiresAt = 0;
  #pending = null;

  constructor(api) {
    this.#api = api;
  }

  invalidate() {
    this.#value = null;
    this.#expiresAt = 0;
  }

  async getToken(signal, { force = false } = {}) {
    if (!force && this.#value && Date.now() < this.#expiresAt) return this.#value;
    if (this.#pending) return this.#pending;
    this.#pending = this.#fetchToken(signal).finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  async #fetchToken(signal) {
    const payload = await this.#api.request('/cgi-bin/gettoken', {
      query: { corpid: this.#api.corpId, corpsecret: this.#api.corpSecret },
      signal,
    });
    if (!payload.access_token) {
      throw new WecomAppError('token-missing', '企业微信没有返回 access_token', {
        providerCode: payload.errcode === undefined ? undefined : String(payload.errcode),
      });
    }
    this.#value = payload.access_token;
    const lifetime = Number(payload.expires_in);
    this.#expiresAt = Date.now() + (Number.isFinite(lifetime) && lifetime > 300 ? lifetime - 300 : 3_600) * 1_000;
    return this.#value;
  }
}

export class WecomAppApi {
  #base;
  #tokens;
  #logger;
  #fetchImpl;
  #timeoutMs;

  constructor({ corpId, corpSecret, agentId, apiBaseUrl, logger = console, fetchImpl, timeoutMs = 15_000 }) {
    if (!cleanString(corpId) || !cleanString(corpSecret) || !cleanString(agentId)) {
      throw new TypeError('WecomAppApi requires corpId, corpSecret, and agentId');
    }
    this.corpId = cleanString(corpId);
    this.corpSecret = cleanString(corpSecret);
    this.agentId = cleanString(agentId);
    this.#base = normalizeApiBaseUrl(apiBaseUrl);
    this.#logger = logger;
    this.#fetchImpl = fetchImpl ?? fetch;
    this.#timeoutMs = timeoutMs;
    this.#tokens = new WecomAppTokenCache(this);
  }

  get apiBaseUrl() {
    return this.#base;
  }

  async #fetchJson(url, { method = 'GET', body, headers, signal, timeoutMs } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(new DOMException('WecomApp API request aborted', 'AbortError'));
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs ?? this.#timeoutMs);
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    try {
      const response = await this.#fetchImpl(url, {
        method,
        body,
        headers,
        signal: controller.signal,
      });
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        throw new WecomAppError('bad-response', `企业微信返回了无法解析的内容（HTTP ${response.status}）`);
      }
      return { status: response.status, payload };
    } catch (error) {
      if (error instanceof WecomAppError) throw error;
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new WecomAppError('api-timeout', '企业微信 API 请求超时或被取消');
      }
      throw new WecomAppError('network-failed', `企业微信 API 网络请求失败：${error?.message ?? String(error)}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
    }
  }

  async request(pathname, { query, signal, retryOnToken = true } = {}) {
    const url = new URL(`${this.#base}${pathname}`);
    // URLSearchParams instances carry no enumerable own properties, so
    // Object.entries() would silently drop every parameter.
    const pairs = typeof query?.entries === 'function' ? [...query.entries()] : Object.entries(query ?? {});
    for (const [key, value] of pairs) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const { payload } = await this.#fetchJson(url, { signal });
    const errcode = Number(payload.errcode ?? 0);
    if (errcode !== 0) {
      if (retryOnToken && (errcode === 40014 || errcode === 42001)) {
        this.#tokens.invalidate();
        return this.request(pathname, { query, signal, retryOnToken: false });
      }
      throw this.#apiError(errcode, payload.errmsg);
    }
    return payload;
  }

  #apiError(errcode, errmsg) {
    const code = String(errcode);
    const message = `企业微信 API 调用失败（${code}：${errmsg ?? 'unknown'}）`;
    if (errcode === 60020) return new WecomAppError('trusted-ip', message, {
      providerCode: code,
      hint: '请在企业微信后台将该服务器公网 IP 加入“企业可信 IP”',
    });
    if (errcode === 81013) return new WecomAppError('invalid-user', message, {
      providerCode: code,
      hint: 'userid、部门或标签不存在，请检查应用可见范围',
    });
    if (errcode === 40056) return new WecomAppError('invalid-agent', message, {
      providerCode: code,
      hint: 'agentid 不合法，请核对自建应用 AgentId',
    });
    return new WecomAppError('api-failed', message, { providerCode: code });
  }

  async #send({ payload, signal }) {
    const token = await this.#tokens.getToken(signal);
    const url = new URL(`${this.#base}/cgi-bin/message/send`);
    url.searchParams.set('access_token', token);
    const { payload: result } = await this.#fetchJson(url, {
      method: 'POST',
      body: JSON.stringify({ ...payload, agentid: Number(this.agentId) }),
      headers: { 'content-type': 'application/json' },
      signal,
    });
    const errcode = Number(result.errcode ?? 0);
    if (errcode !== 0) throw this.#apiError(errcode, result.errmsg);
    if (Array.isArray(result?.invaliduser) && result.invaliduser.length > 0) {
      throw new WecomAppError('invalid-user', `消息没有送达：${result.invaliduser.join(', ')}`, {
        providerCode: '81013',
        hint: '请确认接收人仍在应用可见范围内',
      });
    }
    return result;
  }

  async sendText({ userId, content, signal } = {}) {
    const target = cleanString(userId);
    const text = typeof content === 'string' ? content : '';
    if (!target || !text) throw new WecomAppError('bad-request', 'sendText requires userId and content');
    return this.#send({
      payload: { touser: target, msgtype: 'text', text: { content: text } },
      signal,
    });
  }

  /** Read the application's existing bottom menu using its native credential. */
  async getMenu({ signal } = {}) {
    const token = await this.#tokens.getToken(signal);
    return this.request('/cgi-bin/menu/get', { query: { access_token: token, agentid: this.agentId }, signal });
  }

  /** Publish a reviewed menu document for this application. */
  async setMenu(menu, { signal } = {}) {
    const token = await this.#tokens.getToken(signal);
    const url = new URL(`${this.#base}/cgi-bin/menu/create`);
    url.searchParams.set('access_token', token);
    url.searchParams.set('agentid', String(this.agentId));
    const { status, payload } = await this.#fetchJson(url, {
      method: 'POST', body: JSON.stringify(menu), headers: { 'content-type': 'application/json' }, signal,
    });
    if (status < 200 || status >= 300) throw new WecomAppError('bad-response', `Enterprise WeChat menu request failed (HTTP ${status})`);
    if (Number(payload.errcode ?? 0) !== 0) throw this.#apiError(Number(payload.errcode), payload.errmsg);
    return payload;
  }

  async sendMedia({ userId, mediaType, mediaId, signal } = {}) {
    const target = cleanString(userId);
    if (!target || !cleanString(mediaId)) throw new WecomAppError('bad-request', 'sendMedia requires userId and mediaId');
    return this.#send({
      payload: { touser: target, msgtype: mediaType, [mediaType]: { media_id: cleanString(mediaId) } },
      signal,
    });
  }

  async uploadMedia({ type = 'image', bytes, filename, signal } = {}) {
    const mediaType = type === 'file' ? 'file' : 'image';
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      throw new WecomAppError('bad-request', 'uploadMedia requires non-empty bytes');
    }
    const token = await this.#tokens.getToken(signal);
    const url = new URL(`${this.#base}/cgi-bin/media/upload`);
    url.searchParams.set('access_token', token);
    url.searchParams.set('type', mediaType);
    const form = new FormData();
    form.append('media', new Blob([bytes]), filename ?? (mediaType === 'image' ? 'image.png' : 'file.bin'));
    const { payload: result } = await this.#fetchJson(url, {
      method: 'POST',
      body: form,
      signal,
      timeoutMs: 60_000,
    });
    if (!result.media_id) {
      throw this.#apiError(Number(result.errcode ?? -1), result.errmsg);
    }
    return result;
  }

  async health(signal) {
    await this.#tokens.getToken(signal);
    return { ok: true };
  }

  async #rawFetch(url, { signal, timeoutMs } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(new DOMException('WecomApp API request aborted', 'AbortError'));
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs ?? this.#timeoutMs);
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    try {
      return await this.#fetchImpl(url, { method: 'GET', signal: controller.signal });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new WecomAppError('api-timeout', '企业微信媒体下载超时或被取消');
      }
      throw new WecomAppError('network-failed', `企业微信媒体下载失败：${error?.message ?? String(error)}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
    }
  }

  // Downloads media through the authenticated media/get API. WeCom answers
  // with raw bytes on success and a JSON error document on failure.
  async downloadMedia({ mediaId, signal } = {}) {
    const target = cleanString(mediaId);
    if (!target) throw new WecomAppError('bad-request', 'downloadMedia requires mediaId');
    const token = await this.#tokens.getToken(signal);
    const url = new URL(`${this.#base}/cgi-bin/media/get`);
    url.searchParams.set('access_token', token);
    url.searchParams.set('media_id', target);
    const response = await this.#rawFetch(url, { signal, timeoutMs: 60_000 });
    const contentType = String(response.headers.get('content-type') ?? '');
    if (contentType.includes('application/json')) {
      const text = await response.text();
      let payload = {};
      try {
        payload = JSON.parse(text);
      } catch {
        payload = {};
      }
      throw this.#apiError(Number(payload.errcode ?? -1), payload.errmsg);
    }
    const data = Buffer.from(await response.arrayBuffer());
    const disposition = String(response.headers.get('content-disposition') ?? '');
    const filename = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/iu)?.[1] ?? undefined;
    return { data, filename, contentType };
  }

  async sendArtifactFile({ userId, kind = 'image', bytes, filename, signal } = {}) {
    const target = cleanString(userId);
    const data = bytes instanceof Uint8Array ? bytes : null;
    if (!target || !data || data.length === 0 || !cleanString(filename)) {
      throw new WecomAppError('bad-request', 'sendArtifactFile requires userId, bytes, and filename');
    }
    const mediaType = kind === 'file' ? 'file' : 'image';
    const upload = await this.uploadMedia({ type: mediaType, bytes: data, filename: cleanString(filename), signal });
    return this.sendMedia({ userId: target, mediaType, mediaId: upload.media_id, signal });
  }
}

export { cleanString };
